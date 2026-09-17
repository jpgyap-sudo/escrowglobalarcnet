/**
 * Read-only gate for an Escrow Global operation before a wallet adapter sees it.
 *
 * This module intentionally accepts only the SDK's instruction specifications;
 * it does not accept serialized transactions, private keys, wallet objects, an
 * RPC connection, or an instruction supplied by an arbitrary program. The
 * caller must pass the complete canonical account set after its own read-only
 * account validation. That makes the boundary useful for review and logging
 * without pretending that local validation replaces the on-chain program.
 */

import {
  ESCROW_ACTIONS,
  ESCROW_ACTION_DATA_LENGTHS,
  ESCROW_ACTION_ACCOUNT_SHAPES,
  EscrowSdkError
} from './index.mjs';

export const MAX_OPERATION_INSTRUCTIONS = 8;

function fail(code, message) {
  throw new EscrowSdkError(code, message);
}

function keyBytes(value, label) {
  if (!value || typeof value.toBytes !== 'function') fail('INVALID_PUBLIC_KEY', `${label} must be a PublicKey-like value.`);
  let raw;
  try { raw = value.toBytes(); } catch { fail('INVALID_PUBLIC_KEY', `${label} could not be read.`); }
  if (!(raw instanceof Uint8Array) || raw.length !== 32) fail('INVALID_PUBLIC_KEY', `${label} must contain exactly 32 bytes.`);
  return Uint8Array.from(raw);
}

function keyId(value, label) {
  return Array.from(keyBytes(value, label)).join(',');
}

function keySet(values, label) {
  if (!values || typeof values[Symbol.iterator] !== 'function') fail('MISSING_FIELD', `${label} must be an iterable set of public keys.`);
  const result = new Map();
  for (const value of values) result.set(keyId(value, label), value);
  return result;
}

function equalKeys(left, right) {
  const a = keyBytes(left, 'Public key');
  const b = keyBytes(right, 'Public key');
  return a.every((byte, index) => byte === b[index]);
}

function hexBytes(hex, label) {
  if (typeof hex !== 'string' || !/^[a-f0-9]{16}$/.test(hex)) fail('HASH_FAILED', `${label} must be eight bytes of lowercase hex.`);
  return Uint8Array.from(hex.match(/../g).map(pair => Number.parseInt(pair, 16)));
}

function discriminator(action, sha256Hex) {
  if (typeof sha256Hex !== 'function') fail('MISSING_DEPENDENCY', 'A SHA-256 hex function is required.');
  let digest;
  try { digest = sha256Hex(`global:${action}`); } catch { fail('HASH_FAILED', `Could not hash ${action}.`); }
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) fail('HASH_FAILED', 'SHA-256 must return 64 lowercase hexadecimal characters.');
  return hexBytes(digest.slice(0, 16), 'Instruction discriminator');
}

function includesKey(set, value, label) {
  const id = keyId(value, label);
  return set.has(id);
}

function bytesEqual(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function validateInstruction(spec, index, options, allowedActions, accountSet, writableSet, allowedSignerSet) {
  if (!spec || typeof spec !== 'object') fail('INVALID_INSTRUCTION', `Instruction ${index} is not an SDK specification.`);
  if (spec.programId === undefined || !equalKeys(spec.programId, options.programId)) fail('PROGRAM_MISMATCH', `Instruction ${index} targets a different program.`);
  if (typeof spec.action !== 'string' || !allowedActions.has(spec.action)) fail('INSTRUCTION_NOT_ALLOWED', `Instruction ${index} is not in the escrow allowlist.`);
  const expectedLength = ESCROW_ACTION_DATA_LENGTHS[spec.action];
  const expectedShape = ESCROW_ACTION_ACCOUNT_SHAPES[spec.action];
  if (!expectedShape) fail('INSTRUCTION_NOT_ALLOWED', `No account schema exists for ${spec.action}.`);
  if (spec.data === undefined || !(spec.data instanceof Uint8Array)) fail('INVALID_INSTRUCTION_DATA', `Instruction ${index} does not contain Uint8Array data.`);
  if (spec.data.length !== expectedLength) fail('INVALID_INSTRUCTION_DATA', `Instruction ${index} has the wrong data length for ${spec.action}.`);
  const expectedDiscriminator = discriminator(spec.action, options.sha256Hex);
  if (!bytesEqual(spec.data.slice(0, 8), expectedDiscriminator)) fail('INVALID_INSTRUCTION_DATA', `Instruction ${index} has a mismatched Anchor discriminator.`);

  if (!Array.isArray(spec.keys) || spec.keys.length === 0) fail('INVALID_INSTRUCTION', `Instruction ${index} has no account metas.`);
  if (spec.keys.length !== expectedShape.length) fail('ACCOUNT_SCHEMA_MISMATCH', `Instruction ${index} has the wrong account count for ${spec.action}.`);
  const seenKeys = new Set();
  const signerIds = [];
  const accountSummaries = [];
  for (const [keyIndex, entry] of spec.keys.entries()) {
    if (!entry || typeof entry !== 'object') fail('INVALID_ACCOUNT_META', `Instruction ${index} account ${keyIndex} is malformed.`);
    if (typeof entry.isSigner !== 'boolean' || typeof entry.isWritable !== 'boolean') fail('INVALID_ACCOUNT_META', `Instruction ${index} account ${keyIndex} has invalid flags.`);
    if (entry.isSigner !== expectedShape[keyIndex].isSigner || entry.isWritable !== expectedShape[keyIndex].isWritable) fail('ACCOUNT_SCHEMA_MISMATCH', `Instruction ${index} account ${keyIndex} has unexpected signer/writable flags.`);
    const id = keyId(entry.pubkey, `Instruction ${index} account ${keyIndex}`);
    if (seenKeys.has(id)) fail('DUPLICATE_ACCOUNT', `Instruction ${index} repeats an account meta.`);
    seenKeys.add(id);
    if (!includesKey(accountSet, entry.pubkey, `Instruction ${index} account ${keyIndex}`)) fail('ACCOUNT_NOT_ALLOWED', `Instruction ${index} contains an account outside the canonical set.`);
    if (entry.isWritable && !includesKey(writableSet, entry.pubkey, `Instruction ${index} writable account ${keyIndex}`)) fail('WRITABLE_ACCOUNT_NOT_ALLOWED', `Instruction ${index} contains a non-canonical writable account.`);
    if (entry.isSigner) {
      if (!allowedSignerSet.has(id)) fail('SIGNER_NOT_ALLOWED', `Instruction ${index} contains an unauthorized signer.`);
      signerIds.push(id);
    }
    accountSummaries.push(Object.freeze({ pubkey: entry.pubkey, isSigner: entry.isSigner, isWritable: entry.isWritable }));
  }

  if (!Array.isArray(spec.requiredSigners)) fail('INVALID_INSTRUCTION', `Instruction ${index} has no required signer list.`);
  const requiredIds = spec.requiredSigners.map((value, signerIndex) => keyId(value, `Instruction ${index} required signer ${signerIndex}`));
  if (new Set(requiredIds).size !== requiredIds.length) fail('DUPLICATE_SIGNER', `Instruction ${index} repeats a required signer.`);
  if (requiredIds.length !== signerIds.length || requiredIds.some(id => !signerIds.includes(id))) fail('SIGNER_METADATA_MISMATCH', `Instruction ${index} signer metadata does not match its account metas.`);
  return Object.freeze({ action: spec.action, programId: spec.programId, accounts: Object.freeze(accountSummaries), signerIds });
}

/**
 * Validate a complete, unsigned operation made of SDK instruction specs.
 *
 * `canonicalAccounts` must contain every account meta permitted for this
 * operation, including program accounts. `writableAccounts` is a stricter
 * subset and should contain only the PDAs/token accounts that the selected
 * lifecycle action is expected to mutate. Both are required deliberately:
 * accepting an omitted allowlist would turn this into an ineffective shape
 * check.
 */
export function assertEscrowOperation({
  instructions,
  programId,
  feePayer,
  allowedSigners,
  canonicalAccounts,
  writableAccounts,
  allowedActions = ESCROW_ACTIONS,
  sha256Hex
} = {}) {
  if (!Array.isArray(instructions) || instructions.length === 0) fail('EMPTY_OPERATION', 'An escrow operation must contain at least one instruction.');
  if (instructions.length > MAX_OPERATION_INSTRUCTIONS) fail('TOO_MANY_INSTRUCTIONS', `An escrow operation may contain at most ${MAX_OPERATION_INSTRUCTIONS} instructions.`);
  if (programId === undefined) fail('MISSING_FIELD', 'Program ID is required.');
  keyBytes(programId, 'Program ID');
  const options = { programId, sha256Hex };
  const accountSet = keySet(canonicalAccounts, 'Canonical accounts');
  const writableSet = keySet(writableAccounts, 'Writable accounts');
  const allowedSignerSet = keySet(allowedSigners, 'Allowed signers');
  if (accountSet.size === 0) fail('CANONICAL_ACCOUNTS_MISSING', 'Canonical account allowlist cannot be empty.');
  if (writableSet.size === 0) fail('WRITABLE_ACCOUNTS_MISSING', 'Writable account allowlist cannot be empty.');
  if (allowedSignerSet.size === 0) fail('ALLOWED_SIGNERS_MISSING', 'Allowed signer set cannot be empty.');
  if (feePayer === undefined) fail('FEE_PAYER_MISSING', 'A fee payer is required and cannot be inferred.');
  if (!includesKey(allowedSignerSet, feePayer, 'Fee payer')) fail('FEE_PAYER_NOT_ALLOWED', 'The fee payer is not in the allowed signer set.');
  if (!includesKey(accountSet, programId, 'Program ID')) fail('CANONICAL_ACCOUNTS_MISSING', 'The program ID must be in the canonical account set.');

  const actions = new Set(allowedActions);
  for (const action of actions) {
    if (!ESCROW_ACTIONS.includes(action)) fail('INSTRUCTION_NOT_ALLOWED', `Unknown escrow action in allowlist: ${action}.`);
  }
  const normalized = instructions.map((spec, index) => validateInstruction(spec, index, options, actions, accountSet, writableSet, allowedSignerSet));
  const signerOrder = [];
  const signerSeen = new Set();
  const addSigner = (value, label) => {
    const id = keyId(value, label);
    if (!allowedSignerSet.has(id)) fail('SIGNER_NOT_ALLOWED', `${label} is not allowed.`);
    if (!signerSeen.has(id)) { signerSeen.add(id); signerOrder.push(value); }
  };
  addSigner(feePayer, 'Fee payer');
  for (const item of normalized) {
    for (const id of item.signerIds) addSigner(allowedSignerSet.get(id), 'Instruction signer');
  }

  return Object.freeze({
    programId,
    feePayer,
    signers: Object.freeze(signerOrder),
    instructions: Object.freeze(normalized.map(item => Object.freeze({
      programId: item.programId,
      name: item.action,
      accounts: item.accounts
    })))
  });
}
