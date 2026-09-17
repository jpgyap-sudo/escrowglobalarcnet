/**
 * Minimal dependency-free Solana PDA derivation for reconciliation.
 *
 * This mirrors Solana's `find_program_address` algorithm: SHA-256 over the
 * seeds, bump, program id and the PDA domain marker, while rejecting hashes
 * that decompress to an Ed25519 curve point. It exists so a recovery/indexing
 * worker can verify account addresses rather than trusting a supplied label.
 */
import { createHash } from 'node:crypto';
import { base58Decode, base58Encode } from '../payments.mjs';

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');
const FIELD = (1n << 255n) - 19n;
const EDWARDS_D = (-121665n * modInverse(121666n)) % FIELD;
const SQRT_M1 = modPow(2n, (FIELD - 1n) / 4n, FIELD);

function mod(value) { const result = value % FIELD; return result < 0n ? result + FIELD : result; }
function modPow(base, exponent, modulus = FIELD) {
  let value = base % modulus;
  let power = exponent;
  let result = 1n;
  while (power > 0n) {
    if (power & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    power >>= 1n;
  }
  return result;
}
function modInverse(value) { return modPow(mod(value), FIELD - 2n); }

// Solana's PDA check only needs to know whether the compressed bytes encode
// an Ed25519 point; the sign bit selects x after the curve-point test.
export function isEd25519Point(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return false;
  const copy = Uint8Array.from(bytes);
  const sign = (copy[31] & 0x80) !== 0;
  copy[31] &= 0x7f;
  let y = 0n;
  for (let index = copy.length - 1; index >= 0; index -= 1) y = (y << 8n) | BigInt(copy[index]);
  if (y >= FIELD) return false;
  const y2 = (y * y) % FIELD;
  const numerator = mod(y2 - 1n);
  const denominator = mod(EDWARDS_D * y2 + 1n);
  const x2 = (numerator * modInverse(denominator)) % FIELD;
  let x = modPow(x2, (FIELD + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = (x * SQRT_M1) % FIELD;
  if (mod(x * x - x2) !== 0n) return false;
  return !(x === 0n && sign);
}

function seedBytes(seed, index) {
  if (!(seed instanceof Uint8Array)) throw new TypeError(`PDA seed ${index} must be Uint8Array.`);
  if (seed.length > 32) throw new RangeError(`PDA seed ${index} exceeds 32 bytes.`);
  return seed;
}

function programBytes(programId) {
  let bytes;
  try { bytes = base58Decode(programId); } catch { throw new TypeError('PDA program ID must be valid base58.'); }
  if (bytes.length !== 32 || base58Encode(bytes) !== programId) throw new TypeError('PDA program ID must be canonical base58 for 32 bytes.');
  return bytes;
}

function digest(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return Uint8Array.from(hash.digest());
}

/** Return the canonical off-curve PDA and bump for the supplied seeds. */
export function findProgramAddress(seeds, programId) {
  if (!Array.isArray(seeds) || seeds.length > 16) throw new TypeError('A PDA accepts at most 16 seeds.');
  const normalizedSeeds = seeds.map(seedBytes);
  if (normalizedSeeds.reduce((total, seed) => total + seed.length, 0) > 512) throw new RangeError('PDA seeds exceed Solana\'s 512-byte limit.');
  const program = programBytes(programId);
  for (let bump = 255; bump >= 0; bump -= 1) {
    const address = digest([...normalizedSeeds, Uint8Array.of(bump), program, PDA_MARKER]);
    if (!isEd25519Point(address)) return Object.freeze({ address: base58Encode(address), bump });
  }
  throw new Error('No valid off-curve PDA bump exists for these seeds.');
}

export function utf8(value) {
  if (typeof value !== 'string') throw new TypeError('PDA text seed must be a string.');
  return new TextEncoder().encode(value);
}
export function u16le(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError('PDA u16 seed must be between 0 and 65535.');
  return Uint8Array.of(value & 255, (value >> 8) & 255);
}
