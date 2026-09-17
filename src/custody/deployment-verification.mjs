/**
 * Pure verification of a deployed upgradeable Solana program.
 *
 * This module consumes already-fetched finalized RPC evidence. It never
 * creates a transaction, loads a key, signs, or broadcasts anything.
 */
import { createHash } from 'node:crypto';
import { base58Decode, base58Encode } from '../payments.mjs';
import { findProgramAddress } from './solana-pda.mjs';

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const DEPLOYMENT_CONFIG_SEED = 'deployment-config';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const SYSVAR_RENT_ID = 'SysvarRent111111111111111111111111111111111';
const SYSVAR_CLOCK_ID = 'SysvarC1ock11111111111111111111111111111111';
export const KNOWN_CLUSTER_GENESIS_HASHES = Object.freeze({
  // Devnet and testnet may reset; their current genesis identity must be
  // approved in the signed manifest and checked against the live RPC rather
  // than frozen into this source file.
  devnet: null,
  testnet: null,
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
});

const PROGRAM_TAG = 2;
const PROGRAM_DATA_TAG = 3;
const DEPLOYMENT_CONFIG_SEED_BYTES = Uint8Array.from(Buffer.from(DEPLOYMENT_CONFIG_SEED, 'utf8'));
const DEPLOYMENT_CONFIG_ACCOUNT_LENGTH = 8 + 32 + 32 + 32 + 32 + 1;
const DEPLOYMENT_CONFIG_DISCRIMINATOR = createHash('sha256').update('account:DeploymentConfig').digest().subarray(0, 8);
// Upgradeable loader ProgramData reserves a fixed 45-byte metadata region for
// the executable, even when the authority option is None (the serialized
// Option itself is shorter in that case).
const PROGRAMDATA_METADATA_LENGTH = 45;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function result(status, checks, blockers = []) {
  return Object.freeze({ status, checks: Object.freeze(checks), blockers: Object.freeze(blockers) });
}

function check(name, ok, detail) { return Object.freeze({ name, ok, detail }); }

function readU32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readU64(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.length) return null;
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[offset + index]);
  return value;
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const bytes = Uint8Array.from(Buffer.from(value, 'base64'));
  return Buffer.from(bytes).toString('base64') === value ? bytes : null;
}

function decodeAccountData(account) {
  if (!plain(account) || !Array.isArray(account.data) || account.data.length !== 2 || account.data[1] !== 'base64') return null;
  return decodeBase64(account.data[0]);
}

function decodeProgramDataExecutable(account) {
  const bytes = decodeAccountData(account);
  if (!bytes || bytes.length < PROGRAMDATA_METADATA_LENGTH || (bytes[12] !== 0 && bytes[12] !== 1)) return null;
  return bytes;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeAddress(bytes, offset) {
  if (offset < 0 || offset + 32 > bytes.length) return null;
  return base58Encode(bytes.slice(offset, offset + 32));
}

function decodeOptionalAddress(bytes, offset) {
  if (offset < 0 || offset + 32 > bytes.length) return null;
  const raw = bytes.slice(offset, offset + 32);
  return raw.every(byte => byte === 0) ? null : base58Encode(raw);
}

export function decodeUpgradeableProgramAccount(account) {
  const bytes = decodeAccountData(account);
  if (!bytes || bytes.length !== 36 || readU32(bytes, 0) !== PROGRAM_TAG) return null;
  const programDataAddress = decodeAddress(bytes, 4);
  return programDataAddress ? Object.freeze({ programDataAddress }) : null;
}

export function decodeUpgradeableProgramDataAccount(account) {
  const bytes = decodeAccountData(account);
  if (!bytes || bytes.length < PROGRAMDATA_METADATA_LENGTH || readU32(bytes, 0) !== PROGRAM_DATA_TAG) return null;
  const slot = readU64(bytes, 4);
  if (slot === null || slot > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const option = bytes[12];
  if (option === 0) return Object.freeze({ slot: Number(slot), upgradeAuthority: null });
  if (option !== 1) return null;
  const upgradeAuthority = decodeAddress(bytes, 13);
  return upgradeAuthority ? Object.freeze({ slot: Number(slot), upgradeAuthority }) : null;
}

export function decodeDeploymentConfigAccount(account) {
  const bytes = decodeAccountData(account);
  if (!bytes || bytes.length !== DEPLOYMENT_CONFIG_ACCOUNT_LENGTH || !bytes.slice(0, 8).every((byte, index) => byte === DEPLOYMENT_CONFIG_DISCRIMINATOR[index])) return null;
  const authority = decodeAddress(bytes, 8);
  const feeRecipient = decodeAddress(bytes, 40);
  const firstMint = decodeOptionalAddress(bytes, 72);
  const secondMint = decodeOptionalAddress(bytes, 104);
  const bump = bytes[136];
  if (!authority || !feeRecipient || !firstMint || authority === SYSTEM_PROGRAM_ID || feeRecipient === SYSTEM_PROGRAM_ID || (secondMint && secondMint === firstMint)) return null;
  return Object.freeze({ authority, feeRecipient, acceptedMints: Object.freeze([firstMint, ...(secondMint ? [secondMint] : [])]), bump });
}

function accountEvidence(account) {
  if (!plain(account) || !plain(account.context) || !Number.isSafeInteger(account.context.slot) || account.context.slot < 0 || !plain(account.value)) return null;
  return Object.freeze({ ...account.value, contextSlot: account.context.slot });
}

function transactionEvidence(transaction) {
  if (!plain(transaction) || !Number.isSafeInteger(transaction.slot) || transaction.slot < 0 || !plain(transaction.meta) || !plain(transaction.transaction) || !plain(transaction.transaction.message) || !Array.isArray(transaction.transaction.message.accountKeys)) return null;
  const message = transaction.transaction.message;
  // The CLI requests encoding=json, whose static account-key objects include
  // signer metadata. Do not silently downgrade to bare pubkeys: the loader's
  // authority consent is part of the deployment proof. Address-table entries
  // cannot be transaction signers and are explicitly marked false below.
  const staticAccountEntries = message.accountKeys.map(entry => {
    if (typeof entry === 'string') return null;
    if (!plain(entry) || typeof entry.pubkey !== 'string' || typeof entry.signer !== 'boolean') return null;
    return Object.freeze({ pubkey: entry.pubkey, signer: entry.signer });
  });
  if (staticAccountEntries.some(entry => entry === null)) return null;
  const staticAccountKeys = staticAccountEntries.map(entry => entry.pubkey);
  const loaded = transaction.meta.loadedAddresses;
  let loadedWritable = [];
  let loadedReadonly = [];
  if (loaded !== undefined && loaded !== null) {
    if (!plain(loaded) || !Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly)) return null;
    loadedWritable = loaded.writable;
    loadedReadonly = loaded.readonly;
    if ([...loadedWritable, ...loadedReadonly].some(key => typeof key !== 'string')) return null;
  }
  const accountKeys = [...staticAccountKeys, ...loadedWritable, ...loadedReadonly];
  const signers = [...staticAccountEntries.map(entry => entry.signer), ...loadedWritable.map(() => false), ...loadedReadonly.map(() => false)];
  if (!Array.isArray(transaction.transaction.signatures) || transaction.transaction.signatures.length === 0 || transaction.transaction.signatures.some(value => !signature(value))) return null;
  if (accountKeys.some(key => typeof key !== 'string')) return null;
  if (!Array.isArray(message.instructions)) return null;
  const instructions = message.instructions.map(instruction => {
    if (!plain(instruction) || !Number.isSafeInteger(instruction.programIdIndex) || instruction.programIdIndex < 0 || !Array.isArray(instruction.accounts) || instruction.accounts.some(index => !Number.isSafeInteger(index) || index < 0) || typeof instruction.data !== 'string') return null;
    let data;
    try { data = base58Decode(instruction.data); } catch { return null; }
    if (data.length === 0) return null;
    if (instruction.programIdIndex >= accountKeys.length || instruction.accounts.some(index => index >= accountKeys.length)) return null;
    return Object.freeze({ programIdIndex: instruction.programIdIndex, accounts: Object.freeze([...instruction.accounts]), tag: data[0] });
  });
  if (instructions.some(instruction => instruction === null)) return null;
  return Object.freeze({ slot: transaction.slot, err: transaction.meta.err, signatures: Object.freeze([...transaction.transaction.signatures]), accountKeys: Object.freeze(accountKeys), signers: Object.freeze(signers), instructions: Object.freeze(instructions) });
}

function hasLoaderInstructionForAccounts(transaction, programId, programDataAddress, upgradeAuthority) {
  const loaderIndex = transaction.accountKeys.indexOf(BPF_LOADER_UPGRADEABLE_PROGRAM_ID);
  const programIndex = transaction.accountKeys.indexOf(programId);
  const programDataIndex = transaction.accountKeys.indexOf(programDataAddress);
  if (loaderIndex < 0 || programIndex < 0 || programDataIndex < 0) return false;
  const isSigner = index => transaction.signers[index] === true;
  return transaction.instructions.some(instruction => {
    if (instruction.programIdIndex !== loaderIndex) return false;
    const account = index => transaction.accountKeys[instruction.accounts[index]];
    // These positions mirror the canonical Solana upgradeable-loader
    // DeployWithMaxDataLen layout. Checking only ProgramData/Program would
    // allow an unrelated loader instruction to masquerade as deployment.
    if (instruction.tag === 2) {
      return instruction.accounts.length >= 8
        && instruction.accounts[1] === programDataIndex
        && instruction.accounts[2] === programIndex
        && account(4) === SYSVAR_RENT_ID
        && account(5) === SYSVAR_CLOCK_ID
        && account(6) === SYSTEM_PROGRAM_ID
        && (upgradeAuthority === null || account(7) === upgradeAuthority)
        && isSigner(instruction.accounts[7]);
    }
    // An Upgrade instruction must name the current authority. An immutable
    // ProgramData account cannot be upgraded, so it cannot be proven by this
    // path.
    if (instruction.tag === 3) {
      return upgradeAuthority !== null
        && instruction.accounts.length >= 7
        && instruction.accounts[0] === programDataIndex
        && instruction.accounts[1] === programIndex
        && account(4) === SYSVAR_RENT_ID
        && account(5) === SYSVAR_CLOCK_ID
        && account(6) === upgradeAuthority
        && isSigner(instruction.accounts[6]);
    }
    return false;
  });
}

function address(value) {
  if (typeof value !== 'string') return false;
  try {
    const bytes = base58Decode(value);
    return bytes.length === 32 && bytes.some(byte => byte !== 0) && base58Encode(bytes) === value;
  } catch { return false; }
}

function signature(value) {
  if (typeof value !== 'string' || value.length > 128) return false;
  try {
    const bytes = base58Decode(value);
    return bytes.length === 64 && base58Encode(bytes) === value;
  } catch { return false; }
}

function optionalAddress(value) {
  return value === null || address(value);
}

/**
 * Verify a manifest against finalized RPC response values. The manifest is
 * expected to have already passed verifyCustodyDeploymentManifest().
 */
export function verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, genesisHash, programAccount, programDataAccount, deploymentConfigAccount, deploymentTransaction } = {}) {
  const checks = [];
  const blockers = [];
  const fail = (name, detail, status = 'failed') => {
    checks.push(check(name, false, detail));
    blockers.push(detail);
    return result(status, checks, blockers);
  };
  const pass = (name, detail) => checks.push(check(name, true, detail));

  if (!plain(manifest) || typeof manifest.network !== 'string' || !Object.hasOwn(KNOWN_CLUSTER_GENESIS_HASHES, manifest.network) || !address(manifest.programId) || !address(programDataAddress) || !address(deploymentConfigAddress) || !address(manifest.deploymentConfigAddress) || !address(manifest.feeRecipient) || !Array.isArray(manifest.allowedMints) || manifest.allowedMints.length < 1 || manifest.allowedMints.length > 2 || manifest.allowedMints.some(mint => !address(mint)) || new Set(manifest.allowedMints).size !== manifest.allowedMints.length || !optionalAddress(manifest.upgradeAuthority) || !signature(manifest.deploymentSignature) || !Number.isSafeInteger(manifest.deployedAtSlot) || manifest.deployedAtSlot < 0 || !address(manifest.genesisHash) || typeof manifest.artifactSha256 !== 'string' || manifest.artifactSha256.length !== 64 || !/^[a-f0-9]{64}$/.test(manifest.artifactSha256) || !Number.isSafeInteger(manifest.artifactLength) || manifest.artifactLength < 1) return fail('manifest', 'Approved deployment manifest fields are incomplete or malformed.', 'blocked');
  pass('manifest', 'Approved deployment manifest fields are present.');
  let derivedProgramDataAddress;
  try { derivedProgramDataAddress = findProgramAddress([base58Decode(manifest.programId)], BPF_LOADER_UPGRADEABLE_PROGRAM_ID).address; } catch { return fail('programdata-pda', 'The canonical upgradeable-loader ProgramData PDA could not be derived.', 'blocked'); }
  if (derivedProgramDataAddress !== programDataAddress) return fail('programdata-pda', 'Supplied ProgramData address is not the canonical PDA for the manifest program ID.');
  pass('programdata-pda', 'Supplied ProgramData address matches the canonical PDA for the manifest program ID.');
  let derivedDeploymentConfig;
  try { derivedDeploymentConfig = findProgramAddress([DEPLOYMENT_CONFIG_SEED_BYTES], manifest.programId); } catch { return fail('deployment-config-pda', 'The canonical DeploymentConfig PDA could not be derived.', 'blocked'); }
  if (manifest.deploymentConfigAddress !== derivedDeploymentConfig.address || deploymentConfigAddress !== derivedDeploymentConfig.address) return fail('deployment-config-pda', 'DeploymentConfig address is not the canonical PDA for the manifest program ID.');
  pass('deployment-config-pda', 'DeploymentConfig address matches the canonical PDA for the manifest program ID.');
  const pinnedGenesisHash = KNOWN_CLUSTER_GENESIS_HASHES[manifest.network];
  if (pinnedGenesisHash !== null && manifest.genesisHash !== pinnedGenesisHash) return fail('genesis-hash', 'Deployment manifest genesis hash does not match the pinned Solana cluster identity.');
  pass('genesis-cluster', pinnedGenesisHash === null ? 'Resettable-cluster genesis hash is supplied by the approved manifest and will be matched to finalized RPC evidence.' : 'Deployment manifest genesis hash matches the pinned Solana cluster identity.');
  if (typeof genesisHash !== 'string') return fail('genesis-hash', 'Finalized RPC genesis hash is missing.', 'blocked');
  if (genesisHash !== manifest.genesisHash) return fail('genesis-hash', 'RPC genesis hash does not match the deployment manifest.');
  pass('genesis-hash', 'RPC genesis hash matches the deployment manifest.');

  const program = accountEvidence(programAccount);
  const programData = accountEvidence(programDataAccount);
  const transaction = transactionEvidence(deploymentTransaction);
  const deploymentConfig = accountEvidence(deploymentConfigAccount);
  if (!program || !programData || !deploymentConfig || !transaction) return fail('evidence-shape', 'Finalized deployment evidence is missing or malformed.', 'blocked');
  if (program.contextSlot < manifest.deployedAtSlot || programData.contextSlot < manifest.deployedAtSlot || deploymentConfig.contextSlot < manifest.deployedAtSlot) return fail('evidence-finality', 'Program account evidence is older than the declared deployment slot.', 'blocked');
  pass('evidence-finality', 'Program, ProgramData and DeploymentConfig evidence is at or after the declared deployment slot.');

  if (program.owner !== BPF_LOADER_UPGRADEABLE_PROGRAM_ID) return fail('program-owner', 'Program account is not owned by the upgradeable BPF loader.');
  pass('program-owner', 'Program account owner is the upgradeable BPF loader.');
  if (program.executable !== true) return fail('program-executable', 'Program account is not executable.');
  pass('program-executable', 'Program account is executable.');
  const decodedProgram = decodeUpgradeableProgramAccount(program);
  if (!decodedProgram) return fail('program-state', 'Program account data is not a canonical upgradeable-loader Program state.', 'blocked');
  if (decodedProgram.programDataAddress !== programDataAddress) return fail('programdata-link', 'Program account points to a different ProgramData address.');
  pass('programdata-link', 'Program account points to the derived ProgramData address.');

  if (programData.owner !== BPF_LOADER_UPGRADEABLE_PROGRAM_ID) return fail('programdata-owner', 'ProgramData account is not owned by the upgradeable BPF loader.');
  pass('programdata-owner', 'ProgramData account owner is the upgradeable BPF loader.');
  if (programData.executable !== false) return fail('programdata-executable', 'ProgramData account must not be executable.');
  pass('programdata-executable', 'ProgramData account is not executable.');
  const decodedProgramData = decodeUpgradeableProgramDataAccount(programData);
  if (!decodedProgramData) return fail('programdata-state', 'ProgramData account data is not a canonical upgradeable-loader ProgramData state.', 'blocked');
  if (decodedProgramData.upgradeAuthority !== manifest.upgradeAuthority) return fail('upgrade-authority', 'On-chain upgrade authority does not match the deployment manifest.');
  pass('upgrade-authority', 'On-chain upgrade authority matches the deployment manifest.');
  if (decodedProgramData.slot !== manifest.deployedAtSlot) return fail('programdata-slot', 'ProgramData slot does not match the declared deployment slot.');
  pass('programdata-slot', 'ProgramData slot matches the declared deployment slot.');
  if (deploymentConfig.owner !== manifest.programId) return fail('deployment-config-owner', 'DeploymentConfig account is not owned by the escrow program.');
  pass('deployment-config-owner', 'DeploymentConfig account is owned by the escrow program.');
  if (deploymentConfig.executable !== false) return fail('deployment-config-executable', 'DeploymentConfig account must not be executable.');
  pass('deployment-config-executable', 'DeploymentConfig account is not executable.');
  const decodedDeploymentConfig = decodeDeploymentConfigAccount(deploymentConfig);
  if (!decodedDeploymentConfig) return fail('deployment-config-state', 'DeploymentConfig account data is not the canonical Anchor account state.', 'blocked');
  if (decodedDeploymentConfig.bump !== derivedDeploymentConfig.bump) return fail('deployment-config-bump', 'DeploymentConfig account bump does not match the canonical PDA bump.');
  pass('deployment-config-bump', 'DeploymentConfig account bump matches the canonical PDA bump.');
  if (decodedDeploymentConfig.feeRecipient !== manifest.feeRecipient) return fail('fee-recipient', 'On-chain DeploymentConfig fee recipient does not match the approved deployment manifest.');
  pass('fee-recipient', 'On-chain DeploymentConfig fee recipient matches the approved deployment manifest.');
  if (decodedDeploymentConfig.acceptedMints.length !== manifest.allowedMints.length || decodedDeploymentConfig.acceptedMints.some((mint, index) => mint !== manifest.allowedMints[index])) return fail('accepted-mints', 'On-chain DeploymentConfig accepted mints do not match the approved deployment manifest.');
  pass('accepted-mints', 'On-chain DeploymentConfig accepted mints match the approved deployment manifest.');
  const programDataBytes = decodeProgramDataExecutable(programData);
  if (!programDataBytes || programDataBytes.length < PROGRAMDATA_METADATA_LENGTH + manifest.artifactLength) return fail('programdata-artifact', 'On-chain ProgramData executable bytes are shorter than the approved SBF artifact.');
  const executable = programDataBytes.slice(PROGRAMDATA_METADATA_LENGTH, PROGRAMDATA_METADATA_LENGTH + manifest.artifactLength);
  const padding = programDataBytes.slice(PROGRAMDATA_METADATA_LENGTH + manifest.artifactLength);
  if (padding.some(byte => byte !== 0)) return fail('programdata-artifact-padding', 'On-chain ProgramData contains non-zero bytes outside the approved SBF artifact length.');
  if (sha256(executable) !== manifest.artifactSha256) return fail('programdata-artifact', 'On-chain ProgramData executable bytes do not match the approved SBF artifact hash.');
  pass('programdata-artifact', 'On-chain ProgramData executable bytes match the approved SBF artifact hash.');

  if (transaction.slot !== manifest.deployedAtSlot) return fail('deployment-transaction-slot', 'Deployment transaction slot does not match the declared deployment slot.');
  pass('deployment-transaction-slot', 'Deployment transaction slot matches the declared deployment slot.');
  if (transaction.signatures[0] !== manifest.deploymentSignature) return fail('deployment-transaction-signature', 'Deployment transaction signature does not match the approved manifest.');
  pass('deployment-transaction-signature', 'Deployment transaction signature matches the approved manifest.');
  if (transaction.err !== null) return fail('deployment-transaction-result', 'Deployment transaction did not complete without an error.');
  pass('deployment-transaction-result', 'Deployment transaction completed without an error.');
  if (!transaction.accountKeys.includes(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) return fail('deployment-transaction-loader', 'Deployment transaction does not reference the upgradeable BPF loader.');
  pass('deployment-transaction-loader', 'Deployment transaction references the upgradeable BPF loader.');
  if (!transaction.accountKeys.includes(manifest.programId) || !transaction.accountKeys.includes(programDataAddress)) return fail('deployment-transaction-accounts', 'Deployment transaction does not reference both the program and ProgramData accounts.');
  pass('deployment-transaction-accounts', 'Deployment transaction references both program accounts.');
  if (!hasLoaderInstructionForAccounts(transaction, manifest.programId, programDataAddress, manifest.upgradeAuthority)) return fail('deployment-transaction-instruction', 'Deployment transaction has no canonical upgradeable-loader deployment or upgrade instruction bound to the program, ProgramData, sysvars, system program and authority.');
  pass('deployment-transaction-instruction', 'Deployment transaction has an upgradeable-loader instruction referencing both program accounts.');
  return result('verified', checks);
}
