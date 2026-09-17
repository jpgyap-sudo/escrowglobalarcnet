/**
 * Minimal read-only Solana JSON-RPC adapter for custody reconciliation.
 *
 * This adapter deliberately exposes no sendTransaction, wallet, signer, or
 * private-key capability. It is an HTTP transport boundary only; the worker
 * in solana-reconciliation.mjs remains responsible for finality, deployment
 * identity, account ownership, instruction shape, and economic verification.
 */

export const SOLANA_RPC_ERRORS = Object.freeze({
  INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',
  HTTP_FAILURE: 'HTTP_FAILURE',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  RPC_ERROR: 'RPC_ERROR',
  TIMEOUT: 'TIMEOUT',
  QUORUM_MISMATCH: 'QUORUM_MISMATCH'
});

const NETWORKS = new Set(['localnet', 'devnet', 'testnet', 'mainnet-beta']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  fail(SOLANA_RPC_ERRORS.INVALID_RESPONSE, 'The RPC result contains a non-JSON value.');
}

export class SolanaRpcError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SolanaRpcError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new SolanaRpcError(code, message, details);
}

function endpointUrl(endpoint, network) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'An RPC endpoint is required.');
  if (!NETWORKS.has(network)) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'The RPC network is not supported.');
  let url;
  try { url = new URL(endpoint); } catch { fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'The RPC endpoint must be a valid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'The RPC endpoint must use HTTP(S) without credentials or a fragment.');
  if (network !== 'localnet' && url.protocol !== 'https:') fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'Non-localnet RPC endpoints must use HTTPS.');
  if (network === 'localnet' && url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'Plain HTTP RPC is permitted only for a local loopback endpoint.');
  return url.toString();
}

function safeTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'RPC timeout must be between 1 and 120000 milliseconds.');
  return value;
}

function responseJson(response) {
  if (!response || typeof response.json !== 'function') fail(SOLANA_RPC_ERRORS.INVALID_RESPONSE, 'The RPC transport did not return a JSON response.');
  if (response.ok === false) fail(SOLANA_RPC_ERRORS.HTTP_FAILURE, `The RPC endpoint returned HTTP ${response.status || 'error'}.`);
  return response.json();
}

/**
 * Create an injected, read-only JSON-RPC client. The endpoint may include a
 * provider path/query token supplied by the deployment environment, but the
 * adapter never logs or returns the URL.
 */
export function createSolanaRpc({ endpoint, network, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const url = endpointUrl(endpoint, network);
  if (typeof fetchImpl !== 'function') fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'A fetch implementation is required.');
  const timeout = safeTimeout(timeoutMs);
  let nextId = 1;

  async function call(method, params = []) {
    const id = nextId++;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    let timedOut = false;
    const request = Promise.resolve().then(async () => {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        ...(controller ? { signal: controller.signal } : {})
      });
      return responseJson(response);
    });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try { controller?.abort(); } catch { /* best effort cancellation */ }
        reject(new SolanaRpcError(SOLANA_RPC_ERRORS.TIMEOUT, 'The RPC request timed out.'));
      }, timeout);
    });
    let response;
    try {
      const payload = await Promise.race([request, deadline]);
      if (!plain(payload) || payload.jsonrpc !== '2.0' || payload.id !== id) fail(SOLANA_RPC_ERRORS.INVALID_RESPONSE, 'The RPC response envelope is malformed.');
      if (payload.error !== undefined) {
        const error = plain(payload.error) ? payload.error : {};
        fail(SOLANA_RPC_ERRORS.RPC_ERROR, typeof error.message === 'string' ? error.message : 'The RPC endpoint returned an error.', { code: error.code, data: error.data });
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'result')) fail(SOLANA_RPC_ERRORS.INVALID_RESPONSE, 'The RPC response has no result.');
      return payload.result;
    } catch (error) {
      if (error instanceof SolanaRpcError) throw error;
      if (timedOut || error?.name === 'AbortError') throw new SolanaRpcError(SOLANA_RPC_ERRORS.TIMEOUT, 'The RPC request timed out.');
      throw new SolanaRpcError(SOLANA_RPC_ERRORS.HTTP_FAILURE, error instanceof Error ? error.message : 'The RPC request failed.');
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    getGenesisHash: () => call('getGenesisHash'),
    getLatestBlockhash: (config = {}) => call('getLatestBlockhash', [config]),
    getBlockHeight: (config = {}) => call('getBlockHeight', [config]),
    getSignaturesForAddress: (address, config = {}) => call('getSignaturesForAddress', [address, config]),
    getSignatureStatuses: (signatures, config = {}) => call('getSignatureStatuses', [signatures, config]),
    getTransaction: (signature, config = {}) => call('getTransaction', [signature, config]),
    getAccountInfo: (address, config = {}) => call('getAccountInfo', [address, config]),
    getMultipleAccounts: (addresses, config = {}) => call('getMultipleAccounts', [addresses, config])
  });
}

/**
 * Create the explicitly opt-in submission transport. It can relay bytes that
 * an external wallet already signed, but it has no key, signer, or account
 * mutation capability. Keep this separate from createSolanaRpc so a
 * reconciliation worker cannot accidentally gain a broadcast method.
 */
export function createSolanaSubmissionRpc({ endpoint, network, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const url = endpointUrl(endpoint, network);
  if (typeof fetchImpl !== 'function') fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'A fetch implementation is required.');
  const timeout = safeTimeout(timeoutMs);
  let nextId = 1;

  async function call(method, params = []) {
    const id = nextId++;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    let timedOut = false;
    const request = Promise.resolve().then(async () => {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        ...(controller ? { signal: controller.signal } : {})
      });
      return responseJson(response);
    });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try { controller?.abort(); } catch { /* best effort cancellation */ }
        reject(new SolanaRpcError(SOLANA_RPC_ERRORS.TIMEOUT, 'The RPC request timed out.'));
      }, timeout);
    });
    try {
      const payload = await Promise.race([request, deadline]);
      if (!plain(payload) || payload.jsonrpc !== '2.0' || payload.id !== id) fail(SOLANA_RPC_ERRORS.INVALID_RESPONSE, 'The RPC response envelope is malformed.');
      if (payload.error !== undefined) {
        const error = plain(payload.error) ? payload.error : {};
        fail(SOLANA_RPC_ERRORS.RPC_ERROR, typeof error.message === 'string' ? error.message : 'The RPC endpoint returned an error.', { code: error.code, data: error.data });
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'result')) fail(SOLANA_RPC_ERRORS.INVALID_RESPONSE, 'The RPC response has no result.');
      return payload.result;
    } catch (error) {
      if (error instanceof SolanaRpcError) throw error;
      if (timedOut || error?.name === 'AbortError') throw new SolanaRpcError(SOLANA_RPC_ERRORS.TIMEOUT, 'The RPC request timed out.');
      throw new SolanaRpcError(SOLANA_RPC_ERRORS.HTTP_FAILURE, error instanceof Error ? error.message : 'The RPC request failed.');
    } finally {
      clearTimeout(timer);
    }
  }

  function bytes(value) {
    if (!(value instanceof Uint8Array) || value.length === 0 || value.length > 1232) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'A signed transaction must be a non-empty Uint8Array of at most 1232 bytes.');
    return Uint8Array.from(value);
  }
  function config(value) {
    if (!plain(value)) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'Transaction submission configuration must be an object.');
    const allowed = ['skipPreflight', 'preflightCommitment', 'maxRetries', 'minContextSlot'];
    if (Object.keys(value).some(key => !allowed.includes(key))) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'Unsupported transaction submission option.');
    if (value.skipPreflight !== undefined && typeof value.skipPreflight !== 'boolean') fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'skipPreflight must be boolean.');
    if (value.preflightCommitment !== undefined && !['processed', 'confirmed', 'finalized'].includes(value.preflightCommitment)) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'preflightCommitment is invalid.');
    if (value.maxRetries !== undefined && (!Number.isSafeInteger(value.maxRetries) || value.maxRetries < 0)) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'maxRetries must be a non-negative safe integer.');
    if (value.minContextSlot !== undefined && (!Number.isSafeInteger(value.minContextSlot) || value.minContextSlot < 0)) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'minContextSlot must be a non-negative safe integer.');
    return { encoding: 'base64', skipPreflight: value.skipPreflight === true, preflightCommitment: value.preflightCommitment || 'finalized', maxRetries: value.maxRetries === undefined ? 0 : value.maxRetries, ...(value.minContextSlot === undefined ? {} : { minContextSlot: value.minContextSlot }) };
  }

  return Object.freeze({
    getGenesisHash: () => call('getGenesisHash'),
    getLatestBlockhash: (options = {}) => call('getLatestBlockhash', [options]),
    getBlockHeight: (options = {}) => call('getBlockHeight', [options]),
    getSignatureStatuses: (signatures, options = {}) => call('getSignatureStatuses', [signatures, options]),
    getTransaction: (signature, options = {}) => call('getTransaction', [signature, options]),
    sendRawTransaction: (serializedTransaction, options = {}) => call('sendTransaction', [Buffer.from(bytes(serializedTransaction)).toString('base64'), config(options)])
  });
}

/**
 * Create a fail-closed read-only adapter that requires every configured RPC
 * provider to return the exact same JSON result. This is intentionally an
 * opt-in high-value reconciliation boundary: a single provider outage or
 * disagreement is an unknown result, never permission to trust one provider.
 */
export function createQuorumSolanaRpc({ clients, providerIds } = {}) {
  if (!Array.isArray(clients) || clients.length < 2) fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'An RPC quorum requires at least two existing clients.');
  const providers = clients.slice();
  if (!Array.isArray(providerIds) || providerIds.length !== providers.length || providerIds.some(id => typeof id !== 'string' || id.trim() === '') || new Set(providerIds).size !== providerIds.length) {
    fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'An RPC quorum requires one unique, non-empty provider identity per client.');
  }
  const methods = ['getGenesisHash', 'getSignaturesForAddress', 'getSignatureStatuses', 'getTransaction', 'getAccountInfo', 'getMultipleAccounts'];
  if (providers.some(client => !client || methods.some(method => typeof client[method] !== 'function'))) {
    fail(SOLANA_RPC_ERRORS.INVALID_CONFIGURATION, 'Every RPC quorum client must expose the complete read-only method set.');
  }

  async function agree(method, args) {
    const results = await Promise.allSettled(providers.map(client => client[method](...args)));
    const failures = results.map((result, index) => result.status === 'rejected' ? { index, code: result.reason?.code || 'RPC_FAILURE' } : null).filter(Boolean);
    if (failures.length > 0) {
      throw new SolanaRpcError(SOLANA_RPC_ERRORS.QUORUM_MISMATCH, 'RPC providers did not all return a result.', { providerCount: providers.length, failures });
    }
    const first = results[0].value;
    const expected = canonicalJson(first);
    if (results.some(result => canonicalJson(result.value) !== expected)) {
      throw new SolanaRpcError(SOLANA_RPC_ERRORS.QUORUM_MISMATCH, 'RPC providers returned conflicting results.', { providerCount: providers.length });
    }
    return first;
  }

  return Object.freeze({
    getGenesisHash: () => agree('getGenesisHash', []),
    getSignaturesForAddress: (address, config = {}) => agree('getSignaturesForAddress', [address, config]),
    getSignatureStatuses: (signatures, config = {}) => agree('getSignatureStatuses', [signatures, config]),
    getTransaction: (signature, config = {}) => agree('getTransaction', [signature, config]),
    getAccountInfo: (address, config = {}) => agree('getAccountInfo', [address, config]),
    getMultipleAccounts: (addresses, config = {}) => agree('getMultipleAccounts', [addresses, config])
  });
}
