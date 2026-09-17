/**
 * Escrow Global's dependency-injected Solana instruction specification layer.
 *
 * This module intentionally stops before Transaction construction, signing,
 * RPC access, simulation, or broadcasting. A caller supplies the audited
 * PublicKey implementation and a SHA-256 function, then receives an exact
 * Anchor instruction specification that can be reviewed or handed to a
 * separately controlled wallet adapter.
 */

export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const DEPLOYMENT_CONFIG_SEED = 'deployment-config';
export const BPF_UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const SDK_NETWORKS = Object.freeze(['localnet', 'devnet', 'testnet', 'mainnet-beta']);
export const ESCROW_ACTIONS = Object.freeze([
  'initialize_config', 'initialize', 'seller_accept', 'amend_terms', 'cancel_unfunded', 'fund', 'seller_submit',
  'open_dispute', 'arbiter_release', 'arbiter_refund', 'buyer_approve',
  'execute_review_timeout', 'propose_common_ground', 'approve_common_ground',
  'execute_common_ground', 'resolve_common_ground_remainder',
  'close_common_ground_proposal', 'bilateral_refund', 'claim_late_refund',
  'claim_seller', 'claim_fee', 'claim_buyer_refund', 'close_escrow', 'sweep_unentitled_dust', 'recover_prefunding_dust',
  'initialize_v2', 'create_milestone_v2', 'cancel_milestone_v2',
  'seller_accept_v2', 'amend_terms_v2', 'fund_milestone_v2', 'seller_submit_milestone_v2',
  'buyer_approve_milestone_v2', 'execute_milestone_review_timeout',
  'open_milestone_dispute_v2', 'arbiter_release_milestone_v2',
  'arbiter_refund_milestone_v2', 'bilateral_refund_milestone_v2', 'claim_milestone_late_refund_v2',
  'claim_milestone_seller_v2', 'claim_milestone_fee_v2',
  'claim_milestone_buyer_refund_v2', 'close_milestone_v2', 'sweep_milestone_unentitled_dust', 'recover_milestone_prefunding_dust', 'close_escrow_v2'
]);

// Anchor instruction data lengths, including the eight-byte discriminator.
// Keeping these lengths beside the action allowlist lets the read-only
// operation boundary reject forged specs with truncated or padded payloads.
export const ESCROW_ACTION_DATA_LENGTHS = Object.freeze({
  initialize_config: 8 + 32 + 32,
  initialize: 105,
  seller_accept: 40,
  amend_terms: 40,
  cancel_unfunded: 8,
  fund: 8,
  seller_submit: 40,
  open_dispute: 8,
  arbiter_release: 8,
  arbiter_refund: 8,
  buyer_approve: 8,
  execute_review_timeout: 8,
  propose_common_ground: 40,
  approve_common_ground: 8,
  execute_common_ground: 8,
  resolve_common_ground_remainder: 9,
  close_common_ground_proposal: 8,
  bilateral_refund: 8,
  claim_late_refund: 8,
  claim_seller: 8,
  claim_fee: 8,
  claim_buyer_refund: 8,
  close_escrow: 8,
  sweep_unentitled_dust: 8,
  recover_prefunding_dust: 8,
  initialize_v2: 74,
  create_milestone_v2: 43,
  cancel_milestone_v2: 8,
  seller_accept_v2: 40,
  amend_terms_v2: 40,
  fund_milestone_v2: 8,
  seller_submit_milestone_v2: 40,
  buyer_approve_milestone_v2: 8,
  execute_milestone_review_timeout: 8,
  open_milestone_dispute_v2: 8,
  arbiter_release_milestone_v2: 8,
  arbiter_refund_milestone_v2: 8,
  bilateral_refund_milestone_v2: 8,
  claim_milestone_late_refund_v2: 8,
  claim_milestone_seller_v2: 8,
  claim_milestone_fee_v2: 8,
  claim_milestone_buyer_refund_v2: 8,
  close_milestone_v2: 8,
  sweep_milestone_unentitled_dust: 8,
  recover_milestone_prefunding_dust: 8,
  close_escrow_v2: 8
});

const accountShape = (...flags) => Object.freeze(flags.map(([isSigner, isWritable]) => Object.freeze({ isSigner, isWritable })));
export const ESCROW_ACTION_ACCOUNT_SHAPES = Object.freeze({
  initialize_config: accountShape([true, true], [true, false], [false, false], [false, false], [false, true], [false, false]),
  initialize: accountShape([true, true], [false, false], [true, false], [false, false], [false, false], [false, true], [false, true], [false, false], [false, false]),
  seller_accept: accountShape([true, false], [false, true]),
  amend_terms: accountShape([true, false], [true, false], [false, true]),
  // Cancel only mutates the escrow state. The buyer is not a payer/close
  // destination for this instruction, so Anchor does not mark it writable.
  cancel_unfunded: accountShape([true, false], [false, true], [false, false], [false, false]),
  fund: accountShape([true, false], [false, true], [false, false], [false, true], [false, true], [false, false]),
  seller_submit: accountShape([true, false], [false, true]),
  open_dispute: accountShape([true, false], [false, true], [false, false], [false, false], [false, true], [false, true], [false, false]),
  arbiter_release: accountShape([true, false], [false, true]),
  arbiter_refund: accountShape([true, false], [false, true]),
  buyer_approve: accountShape([true, false], [false, true]),
  execute_review_timeout: accountShape([true, false], [false, true]),
  propose_common_ground: accountShape([true, true], [false, false], [false, true], [false, false]),
  approve_common_ground: accountShape([true, false], [false, true], [false, false]),
  execute_common_ground: accountShape([true, false], [false, true], [false, true]),
  resolve_common_ground_remainder: accountShape([true, false], [true, false], [false, true]),
  close_common_ground_proposal: accountShape([true, true], [false, false], [false, true]),
  bilateral_refund: accountShape([true, false], [true, false], [false, true]),
  claim_late_refund: accountShape([true, false], [false, true], [false, false], [false, true], [false, true], [false, false]),
  claim_seller: accountShape([true, false], [false, true], [false, false], [false, true], [false, true], [false, false]),
  claim_fee: accountShape([true, false], [false, true], [false, false], [false, true], [false, true], [false, false]),
  claim_buyer_refund: accountShape([true, false], [false, true], [false, false], [false, true], [false, true], [false, false]),
  close_escrow: accountShape([true, true], [false, true], [false, false], [false, true], [false, false]),
  sweep_unentitled_dust: accountShape([true, false], [false, false], [false, false], [false, true], [false, true], [false, false]),
  recover_prefunding_dust: accountShape([true, false], [false, false], [false, false], [false, true], [false, true], [false, false]),
  initialize_v2: accountShape([true, true], [false, false], [true, false], [false, false], [false, false], [false, true], [false, false]),
  create_milestone_v2: accountShape([true, true], [false, true], [false, false], [false, true], [false, true], [false, false], [false, false]),
  cancel_milestone_v2: accountShape([true, true], [false, true], [false, false], [false, true], [false, true], [false, false]),
  seller_accept_v2: accountShape([true, false], [false, true]),
  amend_terms_v2: accountShape([true, false], [true, false], [false, true]),
  fund_milestone_v2: accountShape([true, false], [false, true], [false, false], [false, true], [false, true], [false, true], [false, false]),
  seller_submit_milestone_v2: accountShape([true, false], [false, false], [false, true]),
  buyer_approve_milestone_v2: accountShape([true, false], [false, false], [false, true]),
  execute_milestone_review_timeout: accountShape([true, false], [false, false], [false, true]),
  open_milestone_dispute_v2: accountShape([true, false], [false, false], [false, false], [false, false], [false, true], [false, true], [false, true], [false, false]),
  arbiter_release_milestone_v2: accountShape([true, false], [false, false], [false, true]),
  arbiter_refund_milestone_v2: accountShape([true, false], [false, false], [false, true]),
  bilateral_refund_milestone_v2: accountShape([true, false], [true, false], [false, false], [false, true]),
  claim_milestone_late_refund_v2: accountShape([true, false], [false, false], [false, false], [false, true], [false, true], [false, false]),
  claim_milestone_seller_v2: accountShape([true, false], [false, false], [false, false], [false, true], [false, true], [false, true], [false, false]),
  claim_milestone_fee_v2: accountShape([true, false], [false, false], [false, false], [false, true], [false, true], [false, true], [false, false]),
  claim_milestone_buyer_refund_v2: accountShape([true, false], [false, false], [false, false], [false, true], [false, true], [false, true], [false, false]),
  close_milestone_v2: accountShape([true, true], [false, true], [false, true], [false, false], [false, true], [false, false]),
  sweep_milestone_unentitled_dust: accountShape([true, false], [false, false], [false, false], [false, false], [false, true], [false, true], [false, false]),
  recover_milestone_prefunding_dust: accountShape([true, false], [false, false], [false, false], [false, false], [false, true], [false, true], [false, false]),
  close_escrow_v2: accountShape([true, true], [false, true])
});

const MAX_U64 = (1n << 64n) - 1n;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const TEXT = new TextEncoder();

export class EscrowSdkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EscrowSdkError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new EscrowSdkError(code, message);
}

function required(value, label) {
  if (value === undefined || value === null) fail('MISSING_FIELD', `${label} is required.`);
  return value;
}

function bytes(value, label, length = 32) {
  const input = required(value, label);
  let output;
  if (input instanceof Uint8Array) output = input;
  else if (Array.isArray(input)) {
    if (input.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) fail('INVALID_BYTES', `${label} contains an invalid byte.`);
    output = Uint8Array.from(input);
  }
  else if (typeof input === 'string' && /^[a-f0-9]+$/.test(input) && input.length === length * 2) {
    output = Uint8Array.from(input.match(/../g).map(pair => Number.parseInt(pair, 16)));
  } else fail('INVALID_BYTES', `${label} must be exactly ${length} bytes.`);
  if (output.length !== length) fail('INVALID_BYTES', `${label} must be exactly ${length} bytes.`);
  return Uint8Array.from(output);
}

function integer(value, label, { signed = false, bits = 64 } = {}) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value))) {
    fail('INVALID_INTEGER', `${label} must be a bigint or a safe integer; unsafe numbers are rejected.`);
  }
  let parsed;
  try {
    parsed = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    fail('INVALID_INTEGER', `${label} must be an integer.`);
  }
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
  if (parsed < min || parsed > max) fail('INTEGER_RANGE', `${label} is outside its ${bits}-bit range.`);
  return parsed;
}

function equalBytes(a, b) {
  const left = a.toBytes();
  const right = b.toBytes();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function keyFactory(PublicKey) {
  if (typeof PublicKey !== 'function') fail('MISSING_DEPENDENCY', 'A PublicKey constructor is required.');
  return value => {
    let candidate;
    try { candidate = value && typeof value.toBytes === 'function' ? value : new PublicKey(required(value, 'Public key')); } catch { fail('INVALID_PUBLIC_KEY', 'Public key could not be decoded.'); }
    let raw;
    try { raw = candidate.toBytes(); } catch { fail('INVALID_PUBLIC_KEY', 'Public key bytes could not be read.'); }
    if (!(raw instanceof Uint8Array) || raw.length !== 32) fail('INVALID_PUBLIC_KEY', 'Public keys must contain 32 bytes.');
    return candidate;
  };
}

function pda(PublicKey, seeds, programId, label) {
  if (typeof PublicKey.findProgramAddressSync !== 'function') {
    fail('MISSING_DEPENDENCY', `${label} requires PublicKey.findProgramAddressSync.`);
  }
  let result;
  try { result = PublicKey.findProgramAddressSync(seeds.map(seed => Uint8Array.from(seed)), programId); } catch {
    fail('PDA_DERIVATION_FAILED', `${label} PDA derivation failed.`);
  }
  if (!Array.isArray(result) || result.length !== 2 || !Number.isInteger(result[1])) {
    fail('PDA_DERIVATION_FAILED', `${label} PDA derivation returned an invalid result.`);
  }
  let address;
  try { address = keyFactory(PublicKey)(result[0]); } catch { fail('PDA_DERIVATION_FAILED', `${label} PDA derivation returned an invalid address.`); }
  if (result[1] < 0 || result[1] > 255) fail('PDA_DERIVATION_FAILED', `${label} PDA derivation returned an invalid bump.`);
  return { address, bump: result[1] };
}

function seed(text) { return TEXT.encode(text); }

function readHexHash(value, label) {
  const result = bytes(value, label, 32);
  if (result.every(value => value === 0)) fail('INVALID_HASH', `${label} must be non-zero.`);
  return result;
}

function borsh(args) {
  const out = [];
  const add = value => out.push(...value);
  return Object.freeze({
    u16(value, label) { const n = integer(value, label, { bits: 16 }); add([Number(n & 255n), Number((n >> 8n) & 255n)]); return this; },
    u64(value, label) { let n = integer(value, label); for (let i = 0; i < 8; i++) { add([Number(n & 255n)]); n >>= 8n; } return this; },
    i64(value, label) { let n = integer(value, label, { signed: true }); if (n < 0) n += 1n << 64n; for (let i = 0; i < 8; i++) { add([Number(n & 255n)]); n >>= 8n; } return this; },
    bool(value, label) { if (typeof value !== 'boolean') fail('INVALID_BOOLEAN', `${label} must be boolean.`); add([value ? 1 : 0]); return this; },
    hash(value, label) { add(readHexHash(value, label)); return this; },
    raw(value, label) { if (!(value instanceof Uint8Array) || value.length === 0) fail('INVALID_BYTES', `${label} must contain bytes.`); add(value); return this; },
    finish() { return Uint8Array.from(out); }
  });
}

function discriminator(name, sha256Hex) {
  if (typeof sha256Hex !== 'function') fail('MISSING_DEPENDENCY', 'A SHA-256 hex function is required.');
  let digest;
  try { digest = sha256Hex(`global:${name}`); } catch { fail('HASH_FAILED', `Could not hash Anchor instruction ${name}.`); }
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) fail('HASH_FAILED', 'SHA-256 must return 64 lowercase hexadecimal characters.');
  return bytes(digest.slice(0, 16), 'instruction discriminator', 8);
}

function freezeSpec({ programId, action, keys, requiredSigners, data, bumps = {} }) {
  const keyList = keys.map(entry => Object.freeze({ ...entry }));
  const signers = requiredSigners.map(entry => entry);
  const rawData = Uint8Array.from(data);
  const spec = { programId, action, keys: Object.freeze(keyList), requiredSigners: Object.freeze(signers), bumps: Object.freeze({ ...bumps }) };
  // Returning a fresh copy prevents a consumer from mutating the frozen spec
  // through the typed-array object while retaining Uint8Array compatibility.
  Object.defineProperty(spec, 'data', { enumerable: true, get: () => rawData.slice() });
  return Object.freeze(spec);
}

function meta(pubkey, isSigner = false, isWritable = false) { return { pubkey, isSigner, isWritable }; }

function ensureDistinct(roles) {
  const seen = new Map();
  for (const [name, value] of Object.entries(roles)) {
    if (value.toBytes().every(byte => byte === 0)) fail('INVALID_ROLES', `${name} cannot be the system address.`);
    const identity = Array.from(value.toBytes()).join(',');
    if (seen.has(identity)) fail('INVALID_ROLES', `${name} must differ from ${seen.get(identity)}.`);
    seen.set(identity, name);
  }
}

function validateConfig(raw, deps) {
  const PublicKey = deps?.PublicKey;
  const asKey = keyFactory(PublicKey);
  const input = required(raw, 'SDK configuration');
  const network = required(input.network, 'Network');
  if (!SDK_NETWORKS.includes(network)) fail('UNSUPPORTED_NETWORK', `Unsupported network: ${network}.`);
  const programId = asKey(input.programId);
  if (programId.toBytes().every(byte => byte === 0)) fail('INVALID_PROGRAM_ID', 'The custody program ID cannot be the system address.');
  const genesisHash = asKey(required(input.genesisHash, 'Cluster genesis hash'));
  if (genesisHash.toBytes().every(byte => byte === 0)) fail('INVALID_GENESIS_HASH', 'The cluster genesis hash cannot be the system address.');
  const idlAddress = input.idlAddress === undefined ? null : asKey(input.idlAddress);
  if (idlAddress && !equalBytes(programId, idlAddress)) fail('PROGRAM_MISMATCH', 'Configured program ID does not match the IDL address.');
  const expected = input.expectedProgramIds?.[network];
  if (expected !== undefined && !equalBytes(programId, asKey(expected))) fail('PROGRAM_MISMATCH', 'Configured program ID does not match the network manifest.');
  const tokenProgram = asKey(input.tokenProgram || SPL_TOKEN_PROGRAM);
  if (!equalBytes(tokenProgram, asKey(SPL_TOKEN_PROGRAM))) fail('TOKEN_PROGRAM_UNSUPPORTED', 'Only the legacy SPL Token Program is supported.');
  const allowed = input.allowedMints?.[network] || input.allowedMints;
  if (!Array.isArray(allowed) || allowed.length === 0) fail('MINT_ALLOWLIST_MISSING', 'At least one network-qualified mint is required.');
  const allowedMints = Object.freeze(allowed.map(value => asKey(value)));
  if (allowedMints.some(value => value.toBytes().every(byte => byte === 0))) fail('MINT_ALLOWLIST_INVALID', 'The system address cannot be an admitted mint.');
  const fixedFeeRecipient = asKey(required(input.fixedFeeRecipient, 'Fixed fee recipient'));
  if (fixedFeeRecipient.toBytes().every(byte => byte === 0)) fail('INVALID_ROLES', 'The fee recipient cannot be the system address.');
  const systemProgram = asKey(input.systemProgram || SYSTEM_PROGRAM);
  if (!equalBytes(systemProgram, asKey(SYSTEM_PROGRAM))) fail('SYSTEM_PROGRAM_MISMATCH', 'The system program must be canonical.');
  return Object.freeze({
    network,
    programId,
    genesisHash,
    tokenProgram,
    systemProgram,
    allowedMints,
    fixedFeeRecipient,
    feeBps: 300,
    disputeFeeBps: 500
  });
}

function positiveAmount(value, label) {
  const parsed = integer(value, label);
  if (parsed === 0n) fail('INVALID_AMOUNT', `${label} must be greater than zero.`);
  return parsed;
}

function assertMint(config, asKey, mint) {
  const candidate = asKey(mint);
  if (!config.allowedMints.some(allowed => equalBytes(allowed, candidate))) fail('MINT_NOT_ALLOWED', 'The settlement mint is not admitted for this network.');
  return candidate;
}

function assertAccountMatches(asKey, supplied, derived, label) {
  if (supplied !== undefined && !equalBytes(asKey(supplied), derived)) fail('PDA_MISMATCH', `${label} does not match its canonical PDA.`);
  return derived;
}

function validateParties(asKey, config, { buyer, seller, arbiter, feeRecipient = config.fixedFeeRecipient }) {
  const roles = { buyer: asKey(buyer), seller: asKey(seller), arbiter: asKey(arbiter), feeRecipient: asKey(feeRecipient) };
  if (!equalBytes(roles.feeRecipient, config.fixedFeeRecipient)) fail('FEE_RECIPIENT_MISMATCH', 'The fee recipient must match the configured fixed recipient.');
  ensureDistinct(roles);
  return roles;
}

function deriveV1(PublicKey, programId, asKey, buyer, agreementIdHash, suppliedEscrow, suppliedVault) {
  const escrow = pda(PublicKey, [seed('escrow'), asKey(buyer).toBytes(), readHexHash(agreementIdHash, 'Agreement ID hash')], programId, 'escrow');
  const vault = pda(PublicKey, [seed('vault'), escrow.address.toBytes()], programId, 'vault');
  return { escrow: assertAccountMatches(asKey, suppliedEscrow, escrow.address, 'Escrow'), vault: assertAccountMatches(asKey, suppliedVault, vault.address, 'Vault'), bumps: { escrow: escrow.bump, vault: vault.bump } };
}

function deriveDeploymentConfig(PublicKey, programId) {
  return pda(PublicKey, [seed(DEPLOYMENT_CONFIG_SEED)], programId, 'Deployment config');
}

function deriveProgramData(PublicKey, programId, asKey) {
  return pda(PublicKey, [asKey(programId).toBytes()], asKey(BPF_UPGRADEABLE_LOADER), 'Program data');
}

function deriveV2(PublicKey, programId, asKey, buyer, agreementIdHash, index, supplied = {}) {
  const escrow = pda(PublicKey, [seed('escrow-v2'), asKey(buyer).toBytes(), readHexHash(agreementIdHash, 'Agreement ID hash')], programId, 'V2 escrow');
  const result = { escrow: assertAccountMatches(asKey, supplied.escrow, escrow.address, 'V2 escrow'), bumps: { escrow: escrow.bump } };
  if (index !== undefined) {
    const n = integer(index, 'Milestone index', { bits: 16 });
    const indexBytes = Uint8Array.from([Number(n & 255n), Number((n >> 8n) & 255n)]);
    const milestone = pda(PublicKey, [seed('milestone-v2'), escrow.address.toBytes(), indexBytes], programId, 'V2 milestone');
    const vault = pda(PublicKey, [seed('vault-v2'), milestone.address.toBytes()], programId, 'V2 vault');
    result.milestone = assertAccountMatches(asKey, supplied.milestone, milestone.address, 'V2 milestone');
    result.vault = assertAccountMatches(asKey, supplied.vault, vault.address, 'V2 vault');
    result.bumps.milestone = milestone.bump;
    result.bumps.vault = vault.bump;
  }
  return result;
}

function deriveProposal(PublicKey, programId, asKey, escrow, nonce, suppliedProposal) {
  const n = integer(nonce, 'Proposal nonce');
  const nonceBytes = new Uint8Array(8);
  let remaining = n;
  for (let i = 0; i < nonceBytes.length; i++) {
    nonceBytes[i] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  const proposal = pda(PublicKey, [seed('common-ground'), asKey(escrow).toBytes(), nonceBytes], programId, 'Common Ground proposal');
  return {
    proposal: assertAccountMatches(asKey, suppliedProposal, proposal.address, 'Common Ground proposal'),
    bump: proposal.bump
  };
}

function makeBuilder(raw, deps) {
  const PublicKey = deps.PublicKey;
  const asKey = keyFactory(PublicKey);
  const config = validateConfig(raw, deps);
  const hash = deps.sha256Hex;

  const data = (name, writer) => Uint8Array.from([...discriminator(name, hash), ...(writer ? writer.finish() : [])]);
  const base = (name, action, keys, requiredSigners, writer, bumps) => freezeSpec({ programId: config.programId, action, keys, requiredSigners, data: data(name, writer), bumps });

  function initializeConfig(args) {
    const input = required(args, 'Deployment config arguments');
    const authority = asKey(input.authority);
    const feeRecipient = asKey(input.feeRecipient);
    if (equalBytes(authority, feeRecipient)) fail('INVALID_ROLES', 'The deployment authority and fee recipient must differ.');
    if (feeRecipient.toBytes().every(byte => byte === 0)) fail('INVALID_ROLES', 'The fee recipient cannot be the system address.');
    const requestedMints = input.acceptedMints === undefined ? config.allowedMints : input.acceptedMints;
    if (!Array.isArray(requestedMints) || requestedMints.length < 1 || requestedMints.length > 2) fail('MINT_ALLOWLIST_INVALID', 'Deployment config must contain one or two accepted mints.');
    const acceptedMintsSeen = new Set();
    const acceptedMints = requestedMints.map(value => {
      const mint = assertMint(config, asKey, value);
      if (acceptedMintsSeen.has(Array.from(mint.toBytes()).join(','))) fail('MINT_ALLOWLIST_INVALID', 'Deployment config mints must be distinct.');
      acceptedMintsSeen.add(Array.from(mint.toBytes()).join(','));
      return mint;
    });
    const paddedMints = [acceptedMints[0], acceptedMints[1] || asKey(SYSTEM_PROGRAM)];
    const configPda = deriveDeploymentConfig(PublicKey, config.programId);
    const programData = deriveProgramData(PublicKey, config.programId, asKey);
    const writer = borsh().raw(paddedMints[0].toBytes(), 'Accepted mint').raw(paddedMints[1].toBytes(), 'Accepted mint padding');
    return base('initialize_config', 'initialize_config', [
      meta(authority, true, true), meta(feeRecipient, true), meta(config.programId), meta(programData.address), meta(configPda.address, false, true), meta(config.systemProgram)
    ], [authority, feeRecipient], writer, { deploymentConfig: configPda.bump, programData: programData.bump });
  }

  function initialize(args) {
    const input = required(args, 'Initialize arguments');
    const roles = validateParties(asKey, config, input);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV1(PublicKey, config.programId, asKey, roles.buyer, input.agreementIdHash, input.escrow, input.vault);
    const configPda = deriveDeploymentConfig(PublicKey, config.programId);
    positiveAmount(input.principal, 'Principal');
    const writer = borsh().hash(input.agreementIdHash, 'Agreement ID hash').hash(input.termsHash, 'Terms hash').u64(input.principal, 'Principal').i64(input.fundingDeadline, 'Funding deadline').i64(input.deliveryDeadline, 'Delivery deadline').i64(input.reviewDeadline, 'Review deadline').bool(input.timedRelease, 'Timed release');
    return base('initialize', 'initialize', [
      meta(roles.buyer, true, true), meta(roles.seller), meta(roles.arbiter, true), meta(configPda.address), meta(mint), meta(ids.escrow, false, true), meta(ids.vault, false, true), meta(config.tokenProgram), meta(config.systemProgram)
    ], [roles.buyer, roles.arbiter], writer, { ...ids.bumps, deploymentConfig: configPda.bump });
  }

  function initializeV2(args) {
    const input = required(args, 'V2 initialize arguments');
    const roles = validateParties(asKey, config, input);
    const mint = assertMint(config, asKey, input.mint);
    const milestoneCount = integer(input.milestoneCount, 'Milestone count', { bits: 16 });
    if (milestoneCount < 1n || milestoneCount > 16n) fail('INVALID_MILESTONE_COUNT', 'Milestone count must be between 1 and 16.');
    const ids = deriveV2(PublicKey, config.programId, asKey, roles.buyer, input.agreementIdHash, undefined, { escrow: input.escrow });
    const configPda = deriveDeploymentConfig(PublicKey, config.programId);
    const writer = borsh().hash(input.agreementIdHash, 'Agreement ID hash').hash(input.termsHash, 'Terms hash').u16(input.milestoneCount, 'Milestone count');
    return base('initialize_v2', 'initialize_v2', [
      meta(roles.buyer, true, true), meta(roles.seller), meta(roles.arbiter, true), meta(configPda.address), meta(mint), meta(ids.escrow, false, true), meta(config.systemProgram)
    ], [roles.buyer, roles.arbiter], writer, { ...ids.bumps, deploymentConfig: configPda.bump });
  }

  function createMilestoneV2(args) {
    const input = required(args, 'V2 milestone arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    positiveAmount(input.principal, 'Principal');
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input);
    const writer = borsh().u16(input.milestoneIndex, 'Milestone index').u64(input.principal, 'Principal').i64(input.fundingDeadline, 'Funding deadline').i64(input.deliveryDeadline, 'Delivery deadline').i64(input.reviewDeadline, 'Review deadline').bool(input.timedRelease, 'Timed release');
    return base('create_milestone_v2', 'create_milestone_v2', [
      meta(buyer, true, true), meta(ids.escrow, false, true), meta(mint), meta(ids.milestone, false, true), meta(ids.vault, false, true), meta(config.tokenProgram), meta(config.systemProgram)
    ], [buyer], writer, ids.bumps);
  }

  function cancelMilestoneV2(args) {
    const input = required(args, 'V2 cancellation arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input);
    return base('cancel_milestone_v2', 'cancel_milestone_v2', [
      meta(buyer, true, true), meta(ids.escrow, false, true), meta(mint), meta(ids.milestone, false, true), meta(ids.vault, false, true), meta(config.tokenProgram)
    ], [buyer], null, ids.bumps);
  }

  function cancelUnfunded(args) {
    const input = required(args, 'Cancellation arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    return base('cancel_unfunded', 'cancel_unfunded', [
      meta(buyer, true), meta(ids.escrow, false, true), meta(mint), meta(ids.vault)
    ], [buyer], null, ids.bumps);
  }

  function sellerAccept(args, v2 = false) {
    const input = required(args, 'Seller acceptance arguments');
    const seller = asKey(input.seller);
    const buyer = asKey(input.buyer);
    const ids = v2 ? deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, undefined, { escrow: input.escrow }) : deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const name = v2 ? 'seller_accept_v2' : 'seller_accept';
    return base(name, name, [meta(seller, true), meta(ids.escrow, false, true)], [seller], borsh().hash(input.termsHash, 'Terms hash'), ids.bumps);
  }

  function amendTerms(args, v2 = false) {
    const input = required(args, 'Terms amendment arguments');
    const buyer = asKey(input.buyer);
    const seller = asKey(input.seller);
    if (equalBytes(buyer, seller)) fail('INVALID_ROLES', 'Buyer and seller must be different signers.');
    const ids = v2
      ? deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, undefined, { escrow: input.escrow })
      : deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, undefined);
    const name = v2 ? 'amend_terms_v2' : 'amend_terms';
    return base(name, name, [meta(buyer, true), meta(seller, true), meta(ids.escrow, false, true)], [buyer, seller], borsh().hash(input.newTermsHash, 'New terms hash'), { escrow: ids.bumps.escrow });
  }

  function fund(args, v2 = false) {
    const input = required(args, 'Funding arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = v2 ? deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input) : deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const name = v2 ? 'fund_milestone_v2' : 'fund';
    const keys = v2
      ? [meta(buyer, true), meta(ids.escrow, false, true), meta(mint), meta(ids.milestone, false, true), meta(ids.vault, false, true), meta(asKey(required(input.buyerTokenAccount, 'Buyer token account')), false, true), meta(config.tokenProgram)]
      : [meta(buyer, true), meta(ids.escrow, false, true), meta(mint), meta(ids.vault, false, true), meta(asKey(required(input.buyerTokenAccount, 'Buyer token account')), false, true), meta(config.tokenProgram)];
    return base(name, name, keys, [buyer], null, ids.bumps);
  }

  function submit(args, v2 = false) {
    const input = required(args, 'Submission arguments');
    const seller = asKey(input.seller);
    const buyer = asKey(input.buyer);
    const ids = v2 ? deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input) : deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const name = v2 ? 'seller_submit_milestone_v2' : 'seller_submit';
    const keys = v2 ? [meta(seller, true), meta(ids.escrow), meta(ids.milestone, false, true)] : [meta(seller, true), meta(ids.escrow, false, true)];
    return base(name, name, keys, [seller], borsh().hash(input.deliveryHash, 'Delivery hash'), ids.bumps);
  }

  function approve(args, v2 = false) {
    const input = required(args, 'Approval arguments');
    const buyer = asKey(input.buyer);
    const ids = v2 ? deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input) : deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const name = v2 ? 'buyer_approve_milestone_v2' : 'buyer_approve';
    const keys = v2 ? [meta(buyer, true), meta(ids.escrow), meta(ids.milestone, false, true)] : [meta(buyer, true), meta(ids.escrow, false, true)];
    return base(name, name, keys, [buyer], null, ids.bumps);
  }

  function executeTimeoutV2(args) {
    const input = required(args, 'V2 timeout arguments');
    const cranker = asKey(input.cranker);
    const buyer = asKey(input.buyer);
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input);
    return base('execute_milestone_review_timeout', 'execute_milestone_review_timeout', [meta(cranker, true), meta(ids.escrow), meta(ids.milestone, false, true)], [cranker], null, ids.bumps);
  }

  function executeTimeout(args) {
    const input = required(args, 'Review-timeout arguments');
    const cranker = asKey(input.cranker);
    const buyer = asKey(input.buyer);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    return base('execute_review_timeout', 'execute_review_timeout', [
      meta(cranker, true), meta(ids.escrow, false, true)
    ], [cranker], null, ids.bumps);
  }

  function bilateralRefundV2(args) {
    const input = required(args, 'V2 bilateral-refund arguments');
    const buyer = asKey(input.buyer);
    const seller = asKey(input.seller);
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input);
    return base('bilateral_refund_milestone_v2', 'bilateral_refund_milestone_v2', [meta(buyer, true), meta(seller, true), meta(ids.escrow), meta(ids.milestone, false, true)], [buyer, seller], null, ids.bumps);
  }

  function claimLateRefundV2(args) {
    const input = required(args, 'V2 late-refund arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input);
    const destination = asKey(required(input.buyerTokenAccount, 'Buyer token account'));
    return base('claim_milestone_late_refund_v2', 'claim_milestone_late_refund_v2', [
      meta(buyer, true), meta(ids.escrow), meta(mint), meta(ids.milestone, false, true), meta(ids.vault, false, true), meta(destination, false, true), meta(config.tokenProgram)
    ], [buyer], null, ids.bumps);
  }

  function bilateralRefund(args) {
    const input = required(args, 'Bilateral-refund arguments');
    const buyer = asKey(input.buyer);
    const seller = asKey(input.seller);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    return base('bilateral_refund', 'bilateral_refund', [
      meta(buyer, true), meta(seller, true), meta(ids.escrow, false, true)
    ], [buyer, seller], null, ids.bumps);
  }

  function claimLateRefund(args) {
    const input = required(args, 'Late-refund arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const destination = asKey(required(input.buyerTokenAccount, 'Buyer token account'));
    return base('claim_late_refund', 'claim_late_refund', [
      meta(buyer, true), meta(ids.escrow, false, true), meta(mint), meta(ids.vault, false, true), meta(destination, false, true), meta(config.tokenProgram)
    ], [buyer], null, ids.bumps);
  }

  function claimV1(args, kind) {
    const input = required(args, 'V1 claim arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    let signer;
    let destination;
    let name;
    if (kind === 'seller') {
      signer = asKey(input.seller);
      destination = asKey(required(input.sellerTokenAccount, 'Seller token account'));
      name = 'claim_seller';
    } else if (kind === 'fee') {
      signer = asKey(input.feeRecipient || config.fixedFeeRecipient);
      if (!equalBytes(signer, config.fixedFeeRecipient)) fail('FEE_RECIPIENT_MISMATCH', 'The fee claimant must be the configured recipient.');
      destination = asKey(required(input.feeTokenAccount, 'Fee token account'));
      name = 'claim_fee';
    } else if (kind === 'buyer_refund') {
      signer = buyer;
      destination = asKey(required(input.buyerTokenAccount, 'Buyer token account'));
      name = 'claim_buyer_refund';
    } else fail('UNSUPPORTED_ACTION', 'Unsupported V1 claim kind.');
    return base(name, name, [
      meta(signer, true), meta(ids.escrow, false, true), meta(mint), meta(ids.vault, false, true), meta(destination, false, true), meta(config.tokenProgram)
    ], [signer], null, ids.bumps);
  }

  function closeEscrow(args) {
    const input = required(args, 'V1 close arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    return base('close_escrow', 'close_escrow', [
      meta(buyer, true, true), meta(ids.escrow, false, true), meta(mint), meta(ids.vault, false, true), meta(config.tokenProgram)
    ], [buyer], null, ids.bumps);
  }

  function sweepUnentitledDust(args) {
    const input = required(args, 'V1 dust-sweep arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const destination = asKey(required(input.buyerTokenAccount, 'Buyer token account'));
    return base('sweep_unentitled_dust', 'sweep_unentitled_dust', [
      meta(buyer), meta(ids.escrow), meta(mint), meta(ids.vault, false, true), meta(destination, false, true), meta(config.tokenProgram)
    ], [buyer], null, ids.bumps);
  }

  function recoverPrefundingDust(args) {
    const input = required(args, 'V1 pre-funding dust-recovery arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const destination = asKey(required(input.buyerTokenAccount, 'Buyer token account'));
    return base('recover_prefunding_dust', 'recover_prefunding_dust', [
      meta(buyer), meta(ids.escrow), meta(mint), meta(ids.vault, false, true), meta(destination, false, true), meta(config.tokenProgram)
    ], [buyer], null, ids.bumps);
  }

  function proposeCommonGround(args) {
    const input = required(args, 'Common Ground proposal arguments');
    const proposer = asKey(input.proposer);
    const buyer = asKey(input.buyer);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const proposal = deriveProposal(PublicKey, config.programId, asKey, ids.escrow, input.proposalNonce, input.proposal);
    const sellerAmount = integer(input.sellerAmount, 'Seller amount');
    const buyerRefund = integer(input.buyerPrincipalRefund, 'Buyer principal refund');
    if (sellerAmount === 0n && buyerRefund === 0n) fail('INVALID_AMOUNT', 'A Common Ground proposal must allocate a positive amount.');
    const writer = borsh().u64(input.proposalNonce, 'Proposal nonce').u64(input.sellerAmount, 'Seller amount').u64(input.buyerPrincipalRefund, 'Buyer principal refund').i64(input.expiresAt, 'Proposal expiry');
    return base('propose_common_ground', 'propose_common_ground', [
      meta(proposer, true, true), meta(ids.escrow), meta(proposal.proposal, false, true), meta(config.systemProgram)
    ], [proposer], writer, { ...ids.bumps, proposal: proposal.bump });
  }

  function approveCommonGround(args) {
    const input = required(args, 'Common Ground approval arguments');
    const approver = asKey(input.approver);
    const buyer = asKey(input.buyer);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const proposal = deriveProposal(PublicKey, config.programId, asKey, ids.escrow, input.proposalNonce, input.proposal);
    return base('approve_common_ground', 'approve_common_ground', [
      meta(approver, true), meta(proposal.proposal, false, true), meta(ids.escrow)
    ], [approver], null, { ...ids.bumps, proposal: proposal.bump });
  }

  function executeCommonGround(args) {
    const input = required(args, 'Common Ground execution arguments');
    const cranker = asKey(input.cranker);
    const buyer = asKey(input.buyer);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const proposal = deriveProposal(PublicKey, config.programId, asKey, ids.escrow, input.proposalNonce, input.proposal);
    return base('execute_common_ground', 'execute_common_ground', [
      meta(cranker, true), meta(proposal.proposal, false, true), meta(ids.escrow, false, true)
    ], [cranker], null, { ...ids.bumps, proposal: proposal.bump });
  }

  function resolveCommonGroundRemainder(args) {
    const input = required(args, 'Common Ground remainder arguments');
    const buyer = asKey(input.buyer);
    const seller = asKey(input.seller);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    return base('resolve_common_ground_remainder', 'resolve_common_ground_remainder', [
      meta(buyer, true), meta(seller, true), meta(ids.escrow, false, true)
    ], [buyer, seller], borsh().bool(input.toSeller, 'To-seller flag'), ids.bumps);
  }

  function closeCommonGroundProposal(args) {
    const input = required(args, 'Common Ground close arguments');
    const proposer = asKey(input.proposer);
    const buyer = asKey(input.buyer);
    const ids = deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const proposal = deriveProposal(PublicKey, config.programId, asKey, ids.escrow, input.proposalNonce, input.proposal);
    return base('close_common_ground_proposal', 'close_common_ground_proposal', [
      meta(proposer, true, true), meta(ids.escrow), meta(proposal.proposal, false, true)
    ], [proposer], null, { ...ids.bumps, proposal: proposal.bump });
  }

  function claimV2(args, kind) {
    const input = required(args, 'V2 claim arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input);
    let signer;
    let destination;
    let name;
    if (kind === 'seller') {
      signer = asKey(input.seller);
      destination = asKey(required(input.sellerTokenAccount, 'Seller token account'));
      name = 'claim_milestone_seller_v2';
    } else if (kind === 'fee') {
      signer = asKey(input.feeRecipient || config.fixedFeeRecipient);
      if (!equalBytes(signer, config.fixedFeeRecipient)) fail('FEE_RECIPIENT_MISMATCH', 'The fee claimant must be the configured recipient.');
      destination = asKey(required(input.feeTokenAccount, 'Fee token account'));
      name = 'claim_milestone_fee_v2';
    } else if (kind === 'buyer_refund') {
      signer = buyer;
      destination = asKey(required(input.buyerTokenAccount, 'Buyer token account'));
      name = 'claim_milestone_buyer_refund_v2';
    } else fail('UNSUPPORTED_ACTION', 'Unsupported V2 claim kind.');
    const keys = [meta(signer, true), meta(ids.escrow), meta(mint), meta(ids.milestone, false, true), meta(ids.vault, false, true), meta(destination, false, true), meta(config.tokenProgram)];
    return base(name, name, keys, [signer], null, ids.bumps);
  }

  function closeMilestoneV2(args) {
    const input = required(args, 'V2 close arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input);
    return base('close_milestone_v2', 'close_milestone_v2', [meta(buyer, true, true), meta(ids.escrow, false, true), meta(ids.milestone, false, true), meta(mint), meta(ids.vault, false, true), meta(config.tokenProgram)], [buyer], null, ids.bumps);
  }

  function sweepMilestoneUnentitledDust(args) {
    const input = required(args, 'V2 dust-sweep arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input);
    const destination = asKey(required(input.buyerTokenAccount, 'Buyer token account'));
    return base('sweep_milestone_unentitled_dust', 'sweep_milestone_unentitled_dust', [
      meta(buyer), meta(ids.escrow), meta(mint), meta(ids.milestone), meta(ids.vault, false, true), meta(destination, false, true), meta(config.tokenProgram)
    ], [buyer], null, ids.bumps);
  }

  function recoverMilestonePrefundingDust(args) {
    const input = required(args, 'V2 pre-funding dust-recovery arguments');
    const buyer = asKey(input.buyer);
    const mint = assertMint(config, asKey, input.mint);
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input);
    const destination = asKey(required(input.buyerTokenAccount, 'Buyer token account'));
    return base('recover_milestone_prefunding_dust', 'recover_milestone_prefunding_dust', [
      meta(buyer), meta(ids.escrow), meta(mint), meta(ids.milestone), meta(ids.vault, false, true), meta(destination, false, true), meta(config.tokenProgram)
    ], [buyer], null, ids.bumps);
  }

  function closeEscrowV2(args) {
    const input = required(args, 'V2 escrow close arguments');
    const buyer = asKey(input.buyer);
    const ids = deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, undefined, { escrow: input.escrow });
    return base('close_escrow_v2', 'close_escrow_v2', [
      meta(buyer, true, true), meta(ids.escrow, false, true)
    ], [buyer], null, ids.bumps);
  }

  function openDispute(args, v2 = false) {
    const input = required(args, 'Dispute arguments');
    const opener = asKey(input.opener);
    const buyer = asKey(input.buyer);
    const seller = asKey(input.seller);
    const arbiter = asKey(input.arbiter);
    const roles = validateParties(asKey, config, { buyer, seller, arbiter, feeRecipient: input.feeRecipient });
    const mint = assertMint(config, asKey, input.mint);
    const ids = v2 ? deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input) : deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    if (!equalBytes(opener, roles.buyer) && !equalBytes(opener, roles.seller)) fail('UNAUTHORIZED_SIGNER', 'Only an original party can open a dispute.');
    const keys = v2
      ? [meta(opener, true), meta(ids.escrow), meta(mint), meta(roles.feeRecipient), meta(ids.milestone, false, true), meta(asKey(required(input.openerTokenAccount, 'Opener token account')), false, true), meta(asKey(required(input.feeTokenAccount, 'Fee token account')), false, true), meta(config.tokenProgram)]
      : [meta(opener, true), meta(ids.escrow, false, true), meta(mint), meta(roles.feeRecipient), meta(asKey(required(input.openerTokenAccount, 'Opener token account')), false, true), meta(asKey(required(input.feeTokenAccount, 'Fee token account')), false, true), meta(config.tokenProgram)];
    const name = v2 ? 'open_milestone_dispute_v2' : 'open_dispute';
    return base(name, name, keys, [opener], null, ids.bumps);
  }

  function resolve(args, outcome, v2 = false) {
    const input = required(args, 'Resolution arguments');
    if (!['release', 'refund'].includes(outcome)) fail('INVALID_OUTCOME', 'Resolution outcome must be release or refund.');
    const arbiter = asKey(input.arbiter);
    const buyer = asKey(input.buyer);
    const ids = v2 ? deriveV2(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.milestoneIndex, input) : deriveV1(PublicKey, config.programId, asKey, buyer, input.agreementIdHash, input.escrow, input.vault);
    const name = v2 ? `arbiter_${outcome}_milestone_v2` : `arbiter_${outcome}`;
    const keys = v2 ? [meta(arbiter, true), meta(ids.escrow), meta(ids.milestone, false, true)] : [meta(arbiter, true), meta(ids.escrow, false, true)];
    return base(name, name, keys, [arbiter], null, ids.bumps);
  }

  function generic(args) {
    const input = required(args, 'Action arguments');
    const action = required(input.action, 'Action');
    switch (action) {
      case 'initialize_config': return initializeConfig(input);
      case 'initialize': return initialize(input);
      case 'initialize_v2': return initializeV2(input);
      case 'create_milestone_v2': return createMilestoneV2(input);
      case 'cancel_milestone_v2': return cancelMilestoneV2(input);
      case 'seller_accept': return sellerAccept(input);
      case 'amend_terms': return amendTerms(input);
      case 'seller_accept_v2': return sellerAccept(input, true);
      case 'amend_terms_v2': return amendTerms(input, true);
      case 'cancel_unfunded': return cancelUnfunded(input);
      case 'fund': return fund(input);
      case 'fund_milestone_v2': return fund(input, true);
      case 'seller_submit': return submit(input);
      case 'seller_submit_milestone_v2': return submit(input, true);
      case 'buyer_approve': return approve(input);
      case 'buyer_approve_milestone_v2': return approve(input, true);
      case 'execute_review_timeout': return executeTimeout(input);
      case 'execute_milestone_review_timeout': return executeTimeoutV2(input);
      case 'bilateral_refund': return bilateralRefund(input);
      case 'open_dispute': return openDispute(input);
      case 'open_milestone_dispute_v2': return openDispute(input, true);
      case 'arbiter_release': return resolve(input, 'release');
      case 'arbiter_refund': return resolve(input, 'refund');
      case 'arbiter_release_milestone_v2': return resolve(input, 'release', true);
      case 'arbiter_refund_milestone_v2': return resolve(input, 'refund', true);
      case 'propose_common_ground': return proposeCommonGround(input);
      case 'approve_common_ground': return approveCommonGround(input);
      case 'execute_common_ground': return executeCommonGround(input);
      case 'resolve_common_ground_remainder': return resolveCommonGroundRemainder(input);
      case 'close_common_ground_proposal': return closeCommonGroundProposal(input);
      case 'claim_late_refund': return claimLateRefund(input);
      case 'claim_seller': return claimV1(input, 'seller');
      case 'claim_fee': return claimV1(input, 'fee');
      case 'claim_buyer_refund': return claimV1(input, 'buyer_refund');
      case 'close_escrow': return closeEscrow(input);
      case 'sweep_unentitled_dust': return sweepUnentitledDust(input);
      case 'recover_prefunding_dust': return recoverPrefundingDust(input);
      case 'bilateral_refund_milestone_v2': return bilateralRefundV2(input);
      case 'claim_milestone_late_refund_v2': return claimLateRefundV2(input);
      case 'claim_milestone_seller_v2': return claimV2(input, 'seller');
      case 'claim_milestone_fee_v2': return claimV2(input, 'fee');
      case 'claim_milestone_buyer_refund_v2': return claimV2(input, 'buyer_refund');
      case 'close_milestone_v2': return closeMilestoneV2(input);
      case 'sweep_milestone_unentitled_dust': return sweepMilestoneUnentitledDust(input);
      case 'recover_milestone_prefunding_dust': return recoverMilestonePrefundingDust(input);
      case 'close_escrow_v2': return closeEscrowV2(input);
      default: fail('UNSUPPORTED_ACTION', `The SDK does not construct ${action} yet.`);
    }
  }

  return Object.freeze({
    config,
    deriveDeploymentConfig: () => deriveDeploymentConfig(PublicKey, config.programId),
    initializeConfig,
    deriveV1: input => deriveV1(PublicKey, config.programId, asKey, input.buyer, input.agreementIdHash, input.escrow, input.vault),
    deriveV2: input => deriveV2(PublicKey, config.programId, asKey, input.buyer, input.agreementIdHash, input.milestoneIndex, input),
    initialize,
    initializeV2,
    createMilestoneV2,
    cancelMilestoneV2,
    cancelUnfunded,
    sellerAccept,
    sellerAcceptV2: input => sellerAccept(input, true),
    amendTerms,
    amendTermsV2: input => amendTerms(input, true),
    fund,
    fundV2: input => fund(input, true),
    submit,
    submitV2: input => submit(input, true),
    approve,
    approveV2: input => approve(input, true),
    executeTimeout,
    executeTimeoutV2,
    bilateralRefund,
    openDispute,
    openDisputeV2: input => openDispute(input, true),
    proposeCommonGround,
    approveCommonGround,
    executeCommonGround,
    resolveCommonGroundRemainder,
    closeCommonGroundProposal,
    claimLateRefund,
    claimSeller: input => claimV1(input, 'seller'),
    claimFee: input => claimV1(input, 'fee'),
    claimBuyerRefund: input => claimV1(input, 'buyer_refund'),
    closeEscrow,
    sweepUnentitledDust,
    recoverPrefundingDust,
    bilateralRefundV2,
    claimLateRefundV2,
    claimMilestoneSellerV2: input => claimV2(input, 'seller'),
    claimMilestoneFeeV2: input => claimV2(input, 'fee'),
    claimMilestoneBuyerRefundV2: input => claimV2(input, 'buyer_refund'),
    closeMilestoneV2,
    sweepMilestoneUnentitledDust,
    recoverMilestonePrefundingDust,
    closeEscrowV2,
    resolve,
    resolveV2: input => resolve(input, input.outcome, true),
    build: generic
  });
}

export function createEscrowSdk(config, deps) {
  return makeBuilder(config, deps);
}
