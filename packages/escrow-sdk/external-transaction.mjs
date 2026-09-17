/**
 * Fail-closed boundary for a transaction signed by an external wallet.
 *
 * The SDK still does not sign, submit, or contact RPC. A wallet adapter must
 * decode the serialized transaction into the small normalized shape below;
 * this module then proves that the signed message is exactly the previously
 * reviewed SDK operation. Keeping decoding injected avoids silently treating
 * an unverified web3 object as an authorization proof.
 */

import { assertEscrowOperation } from './operation-boundary.mjs';
import { base58Decode, base58Encode } from '../../src/payments.mjs';

export const MAX_SERIALIZED_TRANSACTION_BYTES = 1232;
export const SOLANA_ED25519_SIGNATURE_LENGTH = 64;

export class ExternalTransactionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExternalTransactionError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ExternalTransactionError(code, message);
}

function safeInteger(value, label, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) fail('INVALID_BOUND', `${label} must be a safe integer >= ${min}.`);
  return value;
}

function bytes(value, label, { allowEmpty = false } = {}) {
  if (!(value instanceof Uint8Array) || (!allowEmpty && value.length === 0)) fail('INVALID_BYTES', `${label} must be a non-empty Uint8Array.`);
  return Uint8Array.from(value);
}

function transactionSignature(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 128) fail('INVALID_SIGNATURE', 'The decoded transaction signature must be a non-empty string of at most 128 characters.');
  return value;
}

function blockhash(value, label = 'Recent blockhash') {
  if (typeof value !== 'string' || value.length > 128) fail('INVALID_BLOCKHASH', `${label} must be canonical base58 for exactly 32 bytes.`);
  try {
    const raw = base58Decode(value);
    if (raw.length !== 32 || base58Encode(raw) !== value) throw new Error();
  } catch {
    fail('INVALID_BLOCKHASH', `${label} must be canonical base58 for exactly 32 bytes.`);
  }
  return value;
}

function identity(value, label) {
  if (!value || typeof value.toBytes !== 'function') fail('INVALID_PUBLIC_KEY', `${label} must be PublicKey-like.`);
  let raw;
  try { raw = value.toBytes(); } catch { fail('INVALID_PUBLIC_KEY', `${label} could not be read.`); }
  if (!(raw instanceof Uint8Array) || raw.length !== 32) fail('INVALID_PUBLIC_KEY', `${label} must contain 32 bytes.`);
  return Array.from(raw).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sameIdentity(left, right, label) {
  return identity(left, label) === identity(right, label);
}

function hex(value) {
  return Array.from(value).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function exactArray(left, right, label) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) fail('MESSAGE_MISMATCH', `${label} differs from the reviewed operation.`);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) fail('MESSAGE_MISMATCH', `${label} differs from the reviewed operation.`);
  }
}

function normalizedInstruction(spec, index) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.keys) || !(spec.data instanceof Uint8Array)) fail('INVALID_OPERATION', `Instruction ${index} is not a complete SDK specification.`);
  return Object.freeze({
    programId: spec.programId,
    data: bytes(spec.data, `Instruction ${index} data`),
    accounts: Object.freeze(spec.keys.map((entry, accountIndex) => {
      if (!entry || typeof entry !== 'object' || typeof entry.isSigner !== 'boolean' || typeof entry.isWritable !== 'boolean') fail('INVALID_OPERATION', `Instruction ${index} account ${accountIndex} is malformed.`);
      return Object.freeze({ pubkey: entry.pubkey, isSigner: entry.isSigner, isWritable: entry.isWritable });
    }))
  });
}

function normalizedOperation(instructions, boundary) {
  if (!Array.isArray(instructions) || instructions.length === 0) fail('INVALID_OPERATION', 'At least one reviewed instruction is required.');
  const checked = assertEscrowOperation({ ...boundary, instructions });
  return Object.freeze({
    programId: checked.programId,
    feePayer: checked.feePayer,
    signers: Object.freeze(checked.signers.slice()),
    instructions: Object.freeze(instructions.map(normalizedInstruction))
  });
}

/**
 * Create a durable description of what an external wallet is allowed to
 * sign. The returned request contains no transaction bytes and no key.
 */
export function createExternalSigningRequest({
  instructions,
  boundary,
  operationId,
  intentHash,
  recentBlockhash,
  lastValidBlockHeight,
  createdAtSlot
} = {}) {
  const operation = normalizedOperation(instructions, boundary || {});
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(operationId)) fail('INVALID_OPERATION_ID', 'operationId is invalid.');
  if (typeof intentHash !== 'string' || !/^[a-f0-9]{64}$/.test(intentHash)) fail('INVALID_INTENT_HASH', 'intentHash must be lowercase SHA-256 hex.');
  blockhash(recentBlockhash);
  safeInteger(lastValidBlockHeight, 'lastValidBlockHeight');
  safeInteger(createdAtSlot, 'createdAtSlot');
  return Object.freeze({
    protocol: 'escrow-global-external-signature-v1',
    operationId,
    intentHash,
    recentBlockhash,
    lastValidBlockHeight,
    createdAtSlot,
    operation
  });
}

function compareInstruction(expected, actual, index) {
  if (!actual || typeof actual !== 'object') fail('MESSAGE_MISMATCH', `Signed instruction ${index} is malformed.`);
  if (!sameIdentity(expected.programId, actual.programId, `Instruction ${index} program`)) fail('MESSAGE_MISMATCH', `Signed instruction ${index} targets a different program.`);
  if (!(actual.data instanceof Uint8Array) || hex(expected.data) !== hex(actual.data)) fail('MESSAGE_MISMATCH', `Signed instruction ${index} data differs from the reviewed operation.`);
  if (!Array.isArray(actual.accounts) || actual.accounts.length !== expected.accounts.length) fail('MESSAGE_MISMATCH', `Signed instruction ${index} account count differs from the reviewed operation.`);
  expected.accounts.forEach((account, accountIndex) => {
    const got = actual.accounts[accountIndex];
    if (!got || !sameIdentity(account.pubkey, got.pubkey, `Instruction ${index} account ${accountIndex}`) || got.isSigner !== account.isSigner || got.isWritable !== account.isWritable) {
      fail('MESSAGE_MISMATCH', `Signed instruction ${index} account ${accountIndex} differs from the reviewed operation.`);
    }
  });
}

/**
 * Validate a decoder-produced signed transaction. `decode` is deliberately
 * injected and must return:
 * `{ version: 'legacy', feePayer, recentBlockhash, instructions,
 *    signatures, messageBytes, transactionSignature?: string,
 *    durableNonceAccount?: undefined }`.
 * Each signature is `{ publicKey, signature }`; `verifySignature` receives
 * `(signature, publicKey, messageBytes)` and must return true/false.
 */
export function verifyExternalSignedTransaction({
  request,
  serializedTransaction,
  decode,
  verifySignature,
  currentBlockHeight
} = {}) {
  if (!request || request.protocol !== 'escrow-global-external-signature-v1' || !request.operation) fail('INVALID_REQUEST', 'A valid external signing request is required.');
  const serialized = bytes(serializedTransaction, 'Serialized transaction');
  if (serialized.length > MAX_SERIALIZED_TRANSACTION_BYTES) fail('TRANSACTION_TOO_LARGE', `Serialized transaction exceeds ${MAX_SERIALIZED_TRANSACTION_BYTES} bytes.`);
  if (typeof decode !== 'function' || typeof verifySignature !== 'function') fail('MISSING_DEPENDENCY', 'A transaction decoder and signature verifier are required.');
  safeInteger(currentBlockHeight, 'currentBlockHeight');
  if (currentBlockHeight > request.lastValidBlockHeight) fail('BLOCKHASH_EXPIRED', 'The signed transaction blockhash is no longer valid.');
  let decoded;
  try { decoded = decode(Uint8Array.from(serialized)); } catch { fail('DECODE_FAILED', 'The wallet transaction could not be decoded safely.'); }
  if (!decoded || decoded.version !== 'legacy') fail('UNSUPPORTED_MESSAGE_VERSION', 'Only legacy messages are accepted until address-table resolution is independently implemented.');
  if (decoded.durableNonceAccount !== undefined) fail('DURABLE_NONCE_UNSUPPORTED', 'Durable nonce transactions are not accepted by this boundary.');
  if (!sameIdentity(request.operation.feePayer, decoded.feePayer, 'Fee payer')) fail('FEE_PAYER_MISMATCH', 'The signed fee payer differs from the reviewed operation.');
  blockhash(decoded.recentBlockhash, 'Signed recent blockhash');
  if (decoded.recentBlockhash !== request.recentBlockhash) fail('BLOCKHASH_MISMATCH', 'The signed transaction uses a different recent blockhash.');
  if (!(decoded.messageBytes instanceof Uint8Array) || decoded.messageBytes.length === 0) fail('MESSAGE_BYTES_MISSING', 'The decoder did not provide canonical message bytes.');
  if (!Array.isArray(decoded.instructions) || decoded.instructions.length !== request.operation.instructions.length) fail('MESSAGE_MISMATCH', 'The signed instruction count differs from the reviewed operation.');
  request.operation.instructions.forEach((instruction, index) => compareInstruction(instruction, decoded.instructions[index], index));

  if (!Array.isArray(decoded.signatures) || decoded.signatures.length !== request.operation.signers.length) fail('SIGNATURE_SET_MISMATCH', 'The signed signer set differs from the reviewed operation.');
  const seen = new Set();
  for (const [index, entry] of decoded.signatures.entries()) {
    if (!entry || !entry.publicKey || seen.has(identity(entry.publicKey, `Signature ${index} public key`))) fail('SIGNATURE_SET_MISMATCH', 'The signed transaction contains duplicate or malformed signer identities.');
    seen.add(identity(entry.publicKey, `Signature ${index} public key`));
    if (!request.operation.signers.some(signer => sameIdentity(signer, entry.publicKey, `Signature ${index} public key`))) fail('SIGNATURE_SET_MISMATCH', 'The signed transaction contains an unauthorized signer.');
    const signature = bytes(entry.signature, `Signature ${index}`, { allowEmpty: true });
    if (signature.length !== SOLANA_ED25519_SIGNATURE_LENGTH) fail('SIGNATURE_INVALID', `Signature ${index} must contain exactly ${SOLANA_ED25519_SIGNATURE_LENGTH} Ed25519 bytes.`);
    let valid = false;
    try { valid = verifySignature(signature, entry.publicKey, decoded.messageBytes) === true; } catch { valid = false; }
    if (!valid) fail('SIGNATURE_INVALID', `Signature ${index} did not verify against the canonical message.`);
  }
  for (const signer of request.operation.signers) if (!decoded.signatures.some(entry => sameIdentity(signer, entry.publicKey, 'Required signer'))) fail('SIGNATURE_SET_MISMATCH', 'A required signer is missing.');
  return Object.freeze({
    protocol: request.protocol,
    operationId: request.operationId,
    intentHash: request.intentHash,
    feePayer: request.operation.feePayer,
    recentBlockhash: request.recentBlockhash,
    lastValidBlockHeight: request.lastValidBlockHeight,
    serializedTransaction: Uint8Array.from(serialized),
    signerCount: decoded.signatures.length,
    ...(decoded.transactionSignature === undefined ? {} : { transactionSignature: transactionSignature(decoded.transactionSignature) })
  });
}
