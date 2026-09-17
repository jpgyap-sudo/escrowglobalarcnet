import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuorumSolanaRpc, createSolanaRpc, createSolanaSubmissionRpc, SOLANA_RPC_ERRORS, SolanaRpcError } from '../src/custody/solana-rpc.mjs';

const endpoint = 'https://rpc.example.test/escrow?key=opaque-provider-token';

function response(payload, overrides = {}) {
  return { ok: true, async json() { return payload; }, ...overrides };
}

test('read-only RPC adapter sends canonical JSON-RPC requests and exposes no broadcast method', async () => {
  const requests = [];
  const rpc = createSolanaRpc({ endpoint, network: 'mainnet-beta', timeoutMs: 1000, fetchImpl: async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return response({ jsonrpc: '2.0', id: requests.at(-1).body.id, result: requests.at(-1).body.method === 'getGenesisHash' ? 'genesis-hash' : { value: [] } });
  } });
  // The fake result is shape-agnostic here; transport behavior is the subject.
  assert.equal(await rpc.getGenesisHash(), 'genesis-hash');
  await rpc.getSignaturesForAddress('account', { commitment: 'finalized', limit: 10 });
  await rpc.getSignatureStatuses(['signature'], { searchTransactionHistory: true });
  await rpc.getTransaction('signature', { commitment: 'finalized', encoding: 'jsonParsed' });
  await rpc.getAccountInfo('account', { commitment: 'finalized', encoding: 'base64', minContextSlot: 42 });
  await rpc.getMultipleAccounts(['account-1', 'account-2'], { commitment: 'finalized', encoding: 'base64' });
  assert.equal(requests.length, 6);
  assert.equal(requests[0].url, endpoint);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(requests[2].body.params, [['signature'], { searchTransactionHistory: true }]);
  assert.equal(requests[4].body.params[1].minContextSlot, 42);
  assert.deepEqual(requests[5].body.params[0], ['account-1', 'account-2']);
  assert.equal('sendTransaction' in rpc, false);
});

test('submission RPC relays only bounded externally signed bytes with fixed base64 encoding', async () => {
  const requests = [];
  const rpc = createSolanaSubmissionRpc({ endpoint, network: 'mainnet-beta', fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });
    return response({ jsonrpc: '2.0', id: body.id, result: 'relay-signature' });
  } });
  assert.equal(await rpc.sendRawTransaction(Uint8Array.of(1, 2, 3), { maxRetries: 0 }), 'relay-signature');
  assert.equal(requests[0].body.method, 'sendTransaction');
  assert.equal(requests[0].body.params[0], 'AQID');
  assert.deepEqual(requests[0].body.params[1], { encoding: 'base64', skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 0 });
  assert.throws(() => rpc.sendRawTransaction(Uint8Array.of(1), { skipPreflight: true, unexpected: true }), error => error.code === SOLANA_RPC_ERRORS.INVALID_CONFIGURATION);
});

test('RPC adapter rejects unsafe endpoint configurations before network access', () => {
  assert.throws(() => createSolanaRpc({ endpoint: 'http://rpc.example.test', network: 'mainnet-beta' }), error => error instanceof SolanaRpcError && error.code === SOLANA_RPC_ERRORS.INVALID_CONFIGURATION);
  assert.throws(() => createSolanaRpc({ endpoint: 'http://user:secret@localhost:8899', network: 'localnet' }), error => error instanceof SolanaRpcError && error.code === SOLANA_RPC_ERRORS.INVALID_CONFIGURATION);
  assert.throws(() => createSolanaRpc({ endpoint: 'http://192.168.1.10:8899', network: 'localnet' }), error => error instanceof SolanaRpcError && error.code === SOLANA_RPC_ERRORS.INVALID_CONFIGURATION);
  assert.throws(() => createSolanaRpc({ endpoint: 'https://rpc.example.test', network: 'mainnet-beta', timeoutMs: 0 }), error => error instanceof SolanaRpcError && error.code === SOLANA_RPC_ERRORS.INVALID_CONFIGURATION);
});

test('RPC adapter fails closed on malformed, error and timed-out responses', async () => {
  const malformed = createSolanaRpc({ endpoint, network: 'mainnet-beta', fetchImpl: async () => response({ jsonrpc: '2.0', id: 99, result: null }) });
  await assert.rejects(malformed.getGenesisHash(), error => error.code === SOLANA_RPC_ERRORS.INVALID_RESPONSE);
  const rpcError = createSolanaRpc({ endpoint, network: 'mainnet-beta', fetchImpl: async () => response({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'provider unavailable' } }) });
  await assert.rejects(rpcError.getGenesisHash(), error => error.code === SOLANA_RPC_ERRORS.RPC_ERROR);
  const slow = createSolanaRpc({ endpoint, network: 'mainnet-beta', timeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(slow.getGenesisHash(), error => error.code === SOLANA_RPC_ERRORS.TIMEOUT);
  const slowBody = createSolanaRpc({ endpoint, network: 'mainnet-beta', timeoutMs: 5, fetchImpl: () => response({ jsonrpc: '2.0', id: 1, result: 'never-read' }, { json: () => new Promise(() => {}) }) });
  await assert.rejects(slowBody.getGenesisHash(), error => error.code === SOLANA_RPC_ERRORS.TIMEOUT);
});

test('RPC quorum requires exact agreement across read-only providers', async () => {
  const makeClient = value => Object.freeze({
    getGenesisHash: async () => value,
    getSignaturesForAddress: async () => [{ signature: value, slot: 1, err: null }],
    getSignatureStatuses: async () => ({ value: [value] }),
    getTransaction: async () => ({ slot: value }),
    getAccountInfo: async () => ({ value }),
    getMultipleAccounts: async () => ({ context: { slot: 1 }, value: [value] })
  });
  const quorum = createQuorumSolanaRpc({ clients: [makeClient('same'), makeClient('same')], providerIds: ['primary', 'secondary'] });
  assert.equal(await quorum.getGenesisHash(), 'same');
  assert.deepEqual(await quorum.getMultipleAccounts(['account']), { context: { slot: 1 }, value: ['same'] });
  assert.equal('sendTransaction' in quorum, false);
  await assert.rejects(createQuorumSolanaRpc({ clients: [makeClient('one'), makeClient('two')], providerIds: ['primary', 'secondary'] }).getGenesisHash(), error => error instanceof SolanaRpcError && error.code === SOLANA_RPC_ERRORS.QUORUM_MISMATCH);
  await assert.rejects(createQuorumSolanaRpc({ clients: [makeClient('same'), { ...makeClient('same'), getTransaction: async () => { throw Object.assign(new Error('down'), { code: 'TIMEOUT' }); } }], providerIds: ['primary', 'secondary'] }).getTransaction('signature'), error => error instanceof SolanaRpcError && error.code === SOLANA_RPC_ERRORS.QUORUM_MISMATCH);
});

test('RPC quorum rejects a missing provider or incomplete client set', () => {
  const client = createSolanaRpc({ endpoint, network: 'mainnet-beta', fetchImpl: async () => response({ jsonrpc: '2.0', id: 1, result: null }) });
  assert.throws(() => createQuorumSolanaRpc({ clients: [client], providerIds: ['only'] }), error => error instanceof SolanaRpcError && error.code === SOLANA_RPC_ERRORS.INVALID_CONFIGURATION);
  assert.throws(() => createQuorumSolanaRpc({ clients: [{ getGenesisHash() {} }, { getGenesisHash() {} }], providerIds: ['primary', 'secondary'] }), error => error instanceof SolanaRpcError && error.code === SOLANA_RPC_ERRORS.INVALID_CONFIGURATION);
  assert.throws(() => createQuorumSolanaRpc({ clients: [client, client], providerIds: ['same', 'same'] }), error => error instanceof SolanaRpcError && error.code === SOLANA_RPC_ERRORS.INVALID_CONFIGURATION);
});
