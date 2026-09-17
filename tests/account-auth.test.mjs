import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { base58Encode } from '../src/payments.mjs';
import { WalletAccountSessions } from '../src/integrations/account-auth.mjs';

function wallet() {
  const pair = generateKeyPairSync('ed25519');
  const address = base58Encode(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  return { ...pair, address };
}

test('account login is distinct, purpose-bound, scoped, and revocable', () => {
  const w = wallet();
  const auth = new WalletAccountSessions({ origin: 'https://sandbox.escrow.global', scopes: ['account:read', 'agreement:draft'] });
  const challenge = auth.challenge(w.address);
  assert.match(challenge.message, /account session/);
  assert.match(challenge.message, /does not approve an escrow agreement/);
  const session = auth.verify({ id: challenge.id, signature: sign(null, Buffer.from(challenge.message), w.privateKey).toString('base64') });
  assert.equal(session.address, w.address);
  assert.equal(session.accountId, `wallet:${w.address}`);
  assert.deepEqual(session.scopes, ['account:read', 'agreement:draft']);
  assert.equal(auth.authorize(session.token, 'agreement:draft').address, w.address);
  assert.equal(auth.authorize(session.token, 'escrow:fund'), null);
  assert.equal(auth.revoke(session.token), true);
  assert.equal(auth.session(session.token), null);
});

test('wrong signer consumes the login nonce and cannot create a session', () => {
  const w = wallet(), other = wallet(), auth = new WalletAccountSessions({ origin: 'https://sandbox.escrow.global' });
  const challenge = auth.challenge(w.address), bad = sign(null, Buffer.from(challenge.message), other.privateKey).toString('base64');
  assert.throws(() => auth.verify({ id: challenge.id, signature: bad }), /rejected/);
  assert.throws(() => auth.verify({ id: challenge.id, signature: bad }), /already used/);
});

test('expired login challenges and sessions are pruned', () => {
  let now = 1000;
  const w = wallet(), auth = new WalletAccountSessions({ origin: 'https://sandbox.escrow.global', now: () => now, ttl: 30000 });
  const challenge = auth.challenge(w.address);
  now += 30001;
  assert.throws(() => auth.verify({ id: challenge.id, signature: 'a'.repeat(88) }), /expired/);
  const next = auth.challenge(w.address);
  const session = auth.verify({ id: next.id, signature: sign(null, Buffer.from(next.message), w.privateKey).toString('base64') });
  now += 30001;
  assert.equal(auth.session(session.token), null);
});

test('account auth rejects malformed scope configuration', () => {
  assert.throws(() => new WalletAccountSessions({ origin: 'x', scopes: ['Not A Scope'] }), /scopes/);
  assert.throws(() => new WalletAccountSessions({ origin: 'x', ttl: 1000 }), /TTL/);
});
