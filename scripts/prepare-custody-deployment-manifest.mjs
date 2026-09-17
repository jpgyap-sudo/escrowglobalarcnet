#!/usr/bin/env node
/**
 * Read-only custody release preparation. It reads the exact local source,
 * generated IDL and SBF bytes, then emits an unsigned manifest and the exact
 * domain-separated approval payload. It never loads keys, signs, queries RPC,
 * or broadcasts a transaction.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { base58Decode, base58Encode } from '../src/payments.mjs';
import {
  CUSTODY_MANIFEST_VERSION,
  EXPECTED_ARTIFACT_RELATIVE_PATH,
  custodyDeploymentManifestApprovalPayload,
  validateCustodyDeploymentManifestReleaseInputs
} from './custody-deployment-manifest.mjs';
import { KNOWN_CLUSTER_GENESIS_HASHES } from '../src/custody/deployment-verification.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PATHS = Object.freeze({
  source: path.join(ROOT, 'packages/custody-contracts/program/programs/escrow-global/src/lib.rs'),
  anchorToml: path.join(ROOT, 'packages/custody-contracts/program/Anchor.toml'),
  idl: path.join(ROOT, 'packages/custody-contracts/program/target/idl/escrow_global.json'),
  artifact: path.join(ROOT, EXPECTED_ARTIFACT_RELATIVE_PATH)
});
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const REQUIRED_OPTIONS = Object.freeze([
  ['deploymentId', '--deployment-id'],
  ['network', '--network'],
  ['genesisHash', '--genesis-hash'],
  ['deploymentConfigAddress', '--deployment-config-address'],
  ['feeRecipient', '--fee-recipient'],
  ['allowedMints', '--allowed-mints'],
  ['releaseApprovalId', '--release-approval-id'],
  ['deploymentSignature', '--deployment-signature'],
  ['deployedAtSlot', '--deployed-at-slot']
]);

function fail(message) {
  throw new Error(`Custody deployment manifest preparation failed: ${message}`);
}

function readRequired(filePath, label) {
  try {
    const bytes = fs.readFileSync(filePath);
    if (bytes.length === 0) fail(`${label} is empty: ${filePath}`);
    return bytes;
  } catch (error) {
    fail(`could not read ${label} ${filePath} (${error.code || error.message})`);
  }
}

function canonicalAddress(value, label) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) fail(`${label} must be a base58 Solana address.`);
  let raw;
  try { raw = base58Decode(value); } catch { fail(`${label} must be a base58 Solana address.`); }
  if (raw.length !== 32 || raw.every(byte => byte === 0) || base58Encode(raw) !== value) fail(`${label} must be a canonical non-zero 32-byte public key.`);
  return value;
}

function canonicalSignature(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) fail('deployment-signature must be a base58 transaction signature.');
  let raw;
  try { raw = base58Decode(value); } catch { fail('deployment-signature must be a base58 transaction signature.'); }
  if (raw.length !== 64 || base58Encode(raw) !== value) fail('deployment-signature must decode to a canonical 64-byte signature.');
  return value;
}

function canonicalGenesisHash(value) {
  // Solana RPC returns the genesis hash as base58. Persistent-cluster hashes
  // are pinned by the shared verifier; resettable clusters are still required
  // to use a canonical 32-byte identity.
  return canonicalAddress(value, 'genesis-hash');
}

function parseSlot(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) fail('deployed-at-slot must be a non-negative integer.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail('deployed-at-slot must fit in a JavaScript safe integer.');
  return parsed;
}

function declareId(sourceText) {
  const match = sourceText.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/);
  if (!match) fail('Rust source has no parseable declare_id!.');
  return canonicalAddress(match[1], 'Rust declare_id');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizePath(value, fallback, label, expectedBasename) {
  const resolved = path.resolve(ROOT, value || fallback);
  const relative = path.relative(ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail(`${label} must remain inside the repository.`);
  if (path.basename(resolved).toLowerCase() !== expectedBasename.toLowerCase()) fail(`${label} must have the filename ${expectedBasename}.`);
  return resolved;
}

function optionsToMetadata(options) {
  const missing = REQUIRED_OPTIONS.filter(([key]) => options[key] === undefined || options[key] === null || String(options[key]).trim() === '')
    .map(([, flag]) => flag);
  if (missing.length > 0) fail(`missing required option(s): ${missing.join(', ')}`);
  const network = String(options.network).trim();
  if (!Object.hasOwn(KNOWN_CLUSTER_GENESIS_HASHES, network)) fail('network must be devnet, testnet or mainnet-beta.');
  const deploymentId = String(options.deploymentId).trim();
  const releaseApprovalId = String(options.releaseApprovalId).trim();
  if (deploymentId.length > 128 || releaseApprovalId.length > 128) fail('deployment-id and release-approval-id must be at most 128 characters.');
  const allowedMints = String(options.allowedMints).split(',').map(value => value.trim()).filter(Boolean);
  if (allowedMints.length < 1 || allowedMints.length > 2) fail('allowed-mints must contain one or two comma-separated addresses.');
  const canonicalMints = allowedMints.map(value => canonicalAddress(value, 'allowed-mints'));
  if (new Set(canonicalMints).size !== canonicalMints.length) fail('allowed-mints must not contain duplicates.');
  const upgradeAuthority = options.upgradeAuthority === undefined || options.upgradeAuthority === null || String(options.upgradeAuthority).trim() === ''
    ? null
    : canonicalAddress(String(options.upgradeAuthority).trim(), 'upgrade-authority');
  return {
    deploymentId,
    network,
    genesisHash: canonicalGenesisHash(String(options.genesisHash).trim()),
    deploymentConfigAddress: canonicalAddress(String(options.deploymentConfigAddress).trim(), 'deployment-config-address'),
    feeRecipient: canonicalAddress(String(options.feeRecipient).trim(), 'fee-recipient'),
    allowedMints: canonicalMints,
    releaseApprovalId,
    deploymentSignature: canonicalSignature(String(options.deploymentSignature).trim()),
    deployedAtSlot: parseSlot(options.deployedAtSlot),
    upgradeAuthority
  };
}

/**
 * Prepare a deterministic unsigned release packet from local build inputs.
 * No option in this function accepts or resolves a keypair.
 */
export function prepareCustodyDeploymentManifest(options = {}) {
  const metadata = optionsToMetadata(options);
  const sourcePath = normalizePath(options.sourcePath, DEFAULT_PATHS.source, 'source path', 'lib.rs');
  const anchorTomlPath = normalizePath(options.anchorTomlPath, DEFAULT_PATHS.anchorToml, 'Anchor.toml path', 'Anchor.toml');
  const idlPath = normalizePath(options.idlPath, DEFAULT_PATHS.idl, 'IDL path', 'escrow_global.json');
  const artifactPath = normalizePath(options.artifactFilePath, DEFAULT_PATHS.artifact, 'artifact path', 'escrow_global.so');
  const sourceBytes = readRequired(sourcePath, 'Rust source');
  const anchorTomlBytes = readRequired(anchorTomlPath, 'Anchor.toml');
  const idlBytes = readRequired(idlPath, 'generated IDL');
  const artifactBytes = readRequired(artifactPath, 'SBF artifact');
  const sourceText = sourceBytes.toString('utf8');
  const anchorTomlText = anchorTomlBytes.toString('utf8');
  let idl;
  try { idl = JSON.parse(idlBytes.toString('utf8')); } catch (error) { fail(`generated IDL is not valid JSON (${error.message})`); }
  const programId = declareId(sourceText);
  const candidate = {
    manifestVersion: CUSTODY_MANIFEST_VERSION,
    deploymentId: metadata.deploymentId,
    network: metadata.network,
    programId,
    genesisHash: metadata.genesisHash,
    deploymentConfigAddress: metadata.deploymentConfigAddress,
    feeRecipient: metadata.feeRecipient,
    allowedMints: metadata.allowedMints,
    tokenProgramId: TOKEN_PROGRAM_ID,
    idlAddress: programId,
    idlSha256: sha256(idlBytes),
    artifactSha256: sha256(artifactBytes),
    artifactLength: artifactBytes.length,
    artifactPath: EXPECTED_ARTIFACT_RELATIVE_PATH,
    status: 'approved',
    releaseApprovalId: metadata.releaseApprovalId,
    deploymentSignature: metadata.deploymentSignature,
    upgradeAuthority: metadata.upgradeAuthority,
    deployedAtSlot: metadata.deployedAtSlot,
    approval: null
  };
  // This shared validator proves source/Anchor/IDL/artifact consistency while
  // intentionally stopping before the out-of-band Ed25519 approval check.
  const validated = validateCustodyDeploymentManifestReleaseInputs({
    manifest: candidate,
    sourceText,
    anchorTomlText,
    idl,
    idlBytes,
    artifactBytes
  });
  const manifest = { ...validated, approval: null };
  const payload = custodyDeploymentManifestApprovalPayload(manifest);
  return {
    manifest,
    approvalPayload: {
      encoding: 'base64',
      sha256: sha256(payload),
      value: payload.toString('base64')
    }
  };
}

const CLI_OPTIONS = Object.freeze({
  'deployment-id': { type: 'string' },
  network: { type: 'string' },
  'genesis-hash': { type: 'string' },
  'deployment-config-address': { type: 'string' },
  'fee-recipient': { type: 'string' },
  'release-approval-id': { type: 'string' },
  'deployment-signature': { type: 'string' },
  'deployed-at-slot': { type: 'string' },
  'upgrade-authority': { type: 'string' },
  source: { type: 'string' },
  'anchor-toml': { type: 'string' },
  idl: { type: 'string' },
  artifact: { type: 'string' },
  out: { type: 'string' },
  help: { type: 'boolean', short: 'h' }
});

function printUsage() {
  console.log(`Prepare an unsigned custody deployment manifest (read-only).\n\nRequired: --deployment-id --network --genesis-hash --deployment-config-address --fee-recipient --allowed-mints --release-approval-id --deployment-signature --deployed-at-slot\nOptional: --upgrade-authority --source --anchor-toml --idl --artifact --out\n\nThe command never loads keys, signs, queries RPC or broadcasts. Without --out it prints the packet to stdout.`);
}

export function parsePreparationArguments(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: CLI_OPTIONS, allowPositionals: false, strict: true });
  if (values.help) return { help: true };
  return {
    deploymentId: values['deployment-id'],
    network: values.network,
    genesisHash: values['genesis-hash'],
    deploymentConfigAddress: values['deployment-config-address'],
    feeRecipient: values['fee-recipient'],
    allowedMints: values['allowed-mints'],
    releaseApprovalId: values['release-approval-id'],
    deploymentSignature: values['deployment-signature'],
    deployedAtSlot: values['deployed-at-slot'],
    upgradeAuthority: values['upgrade-authority'],
    sourcePath: values.source,
    anchorTomlPath: values['anchor-toml'],
    idlPath: values.idl,
    artifactFilePath: values.artifact,
    outPath: values.out
  };
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parsePreparationArguments(argv);
  if (options.help) { printUsage(); return; }
  const packet = prepareCustodyDeploymentManifest(options);
  const serialized = `${JSON.stringify(packet, null, 2)}\n`;
  if (options.outPath) {
    const destination = path.resolve(ROOT, options.outPath);
    const relative = path.relative(ROOT, destination);
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail('out path must remain inside the repository.');
    if (path.extname(destination).toLowerCase() !== '.json') fail('out path must use a .json extension.');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, serialized, { encoding: 'utf8', flag: 'wx' });
    console.error(`Unsigned custody deployment packet written to ${destination}.`);
  } else {
    process.stdout.write(serialized);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runCli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
