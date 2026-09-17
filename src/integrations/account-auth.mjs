/**
 * Purpose-bound wallet sessions for a future authenticated API.
 *
 * This is intentionally separate from WalletProofs: the existing class only
 * proves ownership for an on-ramp prefill and must never become marketplace
 * login by accident. Sessions are in-memory in this sandbox and do not
 * authorize escrow commands or replace party signatures.
 */
import { randomBytes, createPublicKey, verify } from 'node:crypto';
import { base58Decode, validateAddress } from '../payments.mjs';

const DEFAULT_SCOPES = Object.freeze(['account:read']);
const scopeSet = scopes => {
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 8 || scopes.some(x => typeof x !== 'string' || !/^[a-z][a-z0-9:_-]{0,63}$/.test(x))) {
    throw new Error('Invalid account session scopes.');
  }
  return [...new Set(scopes)].sort();
};

export class WalletAccountSessions {
  constructor({ origin, now = () => Date.now(), ttl = 300000, max = 1000, scopes = DEFAULT_SCOPES } = {}) {
    if (typeof origin !== 'string' || !origin) throw new Error('An account-auth origin is required.');
    if (!Number.isInteger(ttl) || ttl < 30000 || ttl > 3600000) throw new Error('Account session TTL must be 30 seconds to 1 hour.');
    if (!Number.isInteger(max) || max < 1 || max > 100000) throw new Error('Account session capacity is invalid.');
    this.origin = origin;
    this.now = now;
    this.ttl = ttl;
    this.max = max;
    this.scopes = scopeSet(scopes);
    this.challenges = new Map();
    this.sessions = new Map();
  }

  prune() {
    const now = this.now();
    for (const map of [this.challenges, this.sessions]) for (const [key, value] of map) if (value.expires <= now) map.delete(key);
  }

  challenge(address) {
    validateAddress(address);
    this.prune();
    if (this.challenges.size >= this.max) throw new Error('Too many account login challenges. Retry later.');
    const id = randomBytes(24).toString('hex'), expires = this.now() + this.ttl;
    const message = `Escrow Global account login\nOrigin: ${this.origin}\nWallet: ${address}\nNonce: ${id}\nExpires: ${new Date(expires).toISOString()}\nPurpose: authenticate an Escrow Global account session.\nScopes: ${this.scopes.join(',')}\nThis does not approve an escrow agreement, transfer, funding, payout, refund, or custody action.`;
    this.challenges.set(id, { address, message, expires, scopes: this.scopes });
    return { id, message, expires, scopes: this.scopes };
  }

  verify({ id, signature }) {
    this.prune();
    const challenge = this.challenges.get(id);
    this.challenges.delete(id); // consume before signature verification to prevent replay/oracle probing
    if (!challenge || challenge.expires <= this.now()) throw new Error('Account login challenge expired or already used.');
    if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error('Invalid account signature encoding.');
    const bytes = Buffer.from(signature, 'base64');
    if (bytes.length !== 64) throw new Error('Invalid Ed25519 account signature length.');
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(base58Decode(challenge.address))]), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(challenge.message), publicKey, bytes)) throw new Error('Account login signature rejected.');
    this.prune();
    if (this.sessions.size >= this.max) throw new Error('Too many account sessions.');
    const token = randomBytes(32).toString('hex'), issuedAt = this.now();
    const session = { token, address: challenge.address, accountId: `wallet:${challenge.address}`, scopes: challenge.scopes, issuedAt, expires: issuedAt + this.ttl };
    this.sessions.set(token, session);
    return { ...session };
  }

  session(token) {
    this.prune();
    const session = typeof token === 'string' ? this.sessions.get(token) : null;
    return session ? { ...session } : null;
  }

  authorize(token, scope = 'account:read') {
    const session = this.session(token);
    if (!session || !session.scopes.includes(scope)) return null;
    return session;
  }

  revoke(token) {
    if (typeof token !== 'string') return false;
    return this.sessions.delete(token);
  }
}
