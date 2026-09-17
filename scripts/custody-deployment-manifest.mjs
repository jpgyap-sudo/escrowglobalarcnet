import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base58Decode, base58Encode } from '../src/payments.mjs';
import { DEPLOYMENT_CONFIG_SEED, KNOWN_CLUSTER_GENESIS_HASHES } from '../src/custody/deployment-verification.mjs';
import { findProgramAddress } from '../src/custody/solana-pda.mjs';

export const EXPECTED_ARTIFACT_RELATIVE_PATH = 'packages/custody-contracts/program/target/deploy/escrow_global.so';
export const CUSTODY_MANIFEST_VERSION = 2;
export const CUSTODY_MANIFEST_APPROVAL_SCOPE = 'escrow-global/custody-deployment-manifest/v2';
const NETWORKS = new Set(['devnet', 'testnet', 'mainnet-beta']);
const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MAINNET_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MANIFEST_FIELDS = [
  'manifestVersion', 'deploymentId', 'network', 'programId', 'genesisHash',
  'deploymentConfigAddress', 'feeRecipient', 'allowedMints', 'tokenProgramId', 'idlAddress',
  'idlSha256', 'artifactSha256', 'artifactLength', 'artifactPath', 'status', 'releaseApprovalId',
  'deploymentSignature', 'upgradeAuthority', 'deployedAtSlot', 'approval'
].sort();

function error(message) {
  throw new Error(`Custody deployment manifest is invalid: ${message}`);
}

function address(value, label) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) error(`${label} must be a base58 Solana address.`);
  let raw;
  try { raw = base58Decode(value); } catch { error(`${label} must be a base58 Solana address.`); }
  if (raw.length !== 32 || raw.every(byte => byte === 0) || base58Encode(raw) !== value) error(`${label} must contain a canonical non-zero 32-byte public key.`);
  return value;
}

function optionalAddress(value, label) {
  if (value === null) return null;
  return address(value, label);
}

function mintList(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) error(`${label} must contain one or two mints.`);
  const values = value.map((entry, index) => address(entry, `${label}[${index}]`));
  if (new Set(values).size !== values.length) error(`${label} must not contain duplicates.`);
  return values;
}

function hash(value, label) {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) error(`${label} must be lowercase SHA-256 hex.`);
  return value;
}

function signature(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) error(`${label} must be a base58 transaction signature.`);
  let raw;
  try { raw = base58Decode(value); } catch { error(`${label} must be a base58 transaction signature.`); }
  if (raw.length !== 64 || base58Encode(raw) !== value) error(`${label} must be a canonical base58 value that decodes to 64 bytes.`);
  return value;
}

function requiredText(value, label, max = 256) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max) error(`${label} is required.`);
  return value.trim();
}

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value, location = '$') {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) { index += 1; continue; }
        error(`approval payload contains an invalid Unicode string at ${location}.`);
      }
      if (code >= 0xDC00 && code <= 0xDFFF) error(`approval payload contains an invalid Unicode string at ${location}.`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || Object.is(value, -0)) error(`approval payload contains an invalid number at ${location}.`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry, index) => canonicalJson(entry, `${location}[${index}]`)).join(',')}]`;
  if (!plain(value)) error(`approval payload contains an unsupported value at ${location}.`);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], `${location}.${key}`)}`).join(',')}}`;
}

/**
 * Return the exact UTF-8 bytes that a release approver must sign. The
 * signature envelope is excluded from the signed body and the fixed scope
 * provides domain separation from other Ed25519 messages.
 */
export function custodyDeploymentManifestApprovalPayload(unsignedManifest) {
  if (!plain(unsignedManifest)) error('approval payload must be a plain manifest object.');
  const { approval: _approval, ...unsigned } = unsignedManifest;
  return Buffer.from(canonicalJson({ scope: CUSTODY_MANIFEST_APPROVAL_SCOPE, manifest: unsigned }), 'utf8');
}

function verifyApproval(manifest, signedManifest, trustedApprovalPublicKey) {
  if (!plain(manifest.approval)) error('approval is required for an approved manifest.');
  const approval = manifest.approval;
  const expectedKeys = ['alg', 'publicKey', 'signature', 'signedScope'];
  if (Object.keys(approval).sort().join('\u0000') !== expectedKeys.sort().join('\u0000')) error('approval contains unknown or missing fields.');
  if (approval.alg !== 'Ed25519') error('approval.alg must be Ed25519.');
  if (approval.signedScope !== CUSTODY_MANIFEST_APPROVAL_SCOPE) error('approval.signedScope is not the supported manifest scope.');
  const publicKey = address(approval.publicKey, 'approval.publicKey');
  if (typeof trustedApprovalPublicKey !== 'string') error('a trusted approval public key must be supplied out of band.');
  const trustedKey = address(trustedApprovalPublicKey, 'trustedApprovalPublicKey');
  if (publicKey !== trustedKey) error('approval public key is not the trusted release approver key.');
  const approvalSignature = signature(approval.signature, 'approval.signature');
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  let valid = false;
  try {
    const publicKeyObject = crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(base58Decode(publicKey))]),
      format: 'der',
      type: 'spki'
    });
    // Ed25519 is specified as signing the message directly; the algorithm
    // argument must remain null rather than a hash name such as sha512.
    valid = crypto.verify(null, custodyDeploymentManifestApprovalPayload(signedManifest), publicKeyObject, Buffer.from(base58Decode(approvalSignature)));
  } catch {
    error('approval Ed25519 key or signature is malformed.');
  }
  if (!valid) error('approval Ed25519 signature does not match the manifest.');
  return Object.freeze({
    alg: 'Ed25519',
    signedScope: CUSTODY_MANIFEST_APPROVAL_SCOPE,
    publicKey,
    signature: approvalSignature
  });
}

function slot(value) {
  if (!Number.isSafeInteger(value) || value < 0) error('deployedAtSlot must be a non-negative safe integer.');
  return value;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function artifactLength(value, actualLength) {
  if (!Number.isSafeInteger(value) || value < 1) error('artifactLength must be a positive safe integer.');
  if (value !== actualLength) error('artifactLength does not match the exact SBF bytes.');
  return value;
}

function declareId(sourceText) {
  const match = typeof sourceText === 'string' ? sourceText.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/) : null;
  if (!match) error('Rust source has no parseable declare_id.');
  return address(match[1], 'Rust declare_id');
}

/**
 * Validate a release manifest against the exact local Rust source, generated
 * IDL and SBF bytes. This proves release-artifact consistency only; it does
 * not query Solana and must never be described as deployment or audit proof.
 */
/**
 * Validate every release and artifact binding except the out-of-band
 * approval signature. This is also used by the read-only manifest-preparation
 * tool, which must be able to produce the exact bytes for an approver without
 * signing or accepting an untrusted self-attestation.
 */
export function validateCustodyDeploymentManifestReleaseInputs({ manifest, sourceText, anchorTomlText, idl, idlBytes, artifactBytes } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) error('the JSON root must be an object.');
  if (Object.keys(manifest).sort().join('\u0000') !== MANIFEST_FIELDS.join('\u0000')) error('the manifest contains unknown or missing top-level fields.');
  if (manifest.manifestVersion !== CUSTODY_MANIFEST_VERSION) error(`manifestVersion must be ${CUSTODY_MANIFEST_VERSION}.`);
  const deploymentId = requiredText(manifest.deploymentId, 'deploymentId', 128);
  if (!NETWORKS.has(manifest.network)) error('network must be devnet, testnet or mainnet-beta.');
  const programId = address(manifest.programId, 'programId');
  const genesisHash = address(manifest.genesisHash, 'genesisHash');
  const pinnedGenesisHash = KNOWN_CLUSTER_GENESIS_HASHES[manifest.network];
  if (pinnedGenesisHash !== null && manifest.genesisHash !== pinnedGenesisHash) error('genesisHash must match the pinned Solana cluster identity for network.');
  const deploymentConfigAddress = address(manifest.deploymentConfigAddress, 'deploymentConfigAddress');
  let canonicalDeploymentConfigAddress;
  try { canonicalDeploymentConfigAddress = findProgramAddress([Buffer.from(DEPLOYMENT_CONFIG_SEED, 'utf8')], programId).address; }
  catch { error('the canonical deploymentConfigAddress PDA could not be derived.'); }
  if (deploymentConfigAddress !== canonicalDeploymentConfigAddress) error('deploymentConfigAddress must be the canonical PDA derived from programId and the deployment-config seed.');
  const feeRecipient = address(manifest.feeRecipient, 'feeRecipient');
  const allowedMints = mintList(manifest.allowedMints, 'allowedMints');
  if (manifest.network === 'mainnet-beta' && allowedMints.some(mint => mint !== MAINNET_USDC_MINT && mint !== MAINNET_USDT_MINT)) error('mainnet-beta allowedMints must contain only the canonical mainnet USDC or USDT mint.');
  if (manifest.tokenProgramId !== TOKEN_PROGRAM) error('tokenProgramId must be the legacy SPL Token Program currently supported by custody.');
  const sourceProgramId = declareId(sourceText);
  if (programId !== sourceProgramId) error('programId does not match Rust declare_id.');
  if (typeof anchorTomlText !== 'string' || anchorTomlText.trim().length === 0) error('Anchor.toml text is missing.');
  const anchorProgramIds = [...anchorTomlText.matchAll(/^\s*escrow_global\s*=\s*"([1-9A-HJ-NP-Za-km-z]+)"\s*$/gm)].map(match => match[1]);
  if (anchorProgramIds.length === 0) error('Anchor.toml has no escrow_global program mapping.');
  if (anchorProgramIds.some(value => value !== programId)) error('Anchor.toml escrow_global program mapping does not match programId.');
  if (!idl || typeof idl !== 'object' || Array.isArray(idl)) error('generated Anchor IDL is missing.');
  if (idl.address !== programId) error('IDL address does not match programId.');
  if (manifest.idlAddress !== programId) error('idlAddress does not match programId.');
  const sourceActions = [...sourceText.matchAll(/pub fn ([a-z0-9_]+)\s*\(/g)].map(match => match[1]).sort();
  const idlActions = (idl.instructions || []).map(instruction => instruction?.name).sort();
  if (sourceActions.length !== idlActions.length || sourceActions.some((name, index) => name !== idlActions[index])) error('generated IDL instruction set does not match Rust source.');
  const idlHash = hash(manifest.idlSha256, 'idlSha256');
  if (!(idlBytes instanceof Uint8Array) || idlBytes.length === 0) error('the exact generated IDL bytes are missing.');
  const actualIdlHash = sha256(idlBytes);
  if (idlHash !== actualIdlHash) error('idlSha256 does not match the exact generated IDL bytes.');
  if (!(artifactBytes instanceof Uint8Array) || artifactBytes.length === 0) error('the SBF artifact is missing or empty.');
  const artifactSha256 = hash(manifest.artifactSha256, 'artifactSha256');
  if (artifactSha256 !== sha256(artifactBytes)) error('artifactSha256 does not match the exact SBF bytes.');
  const artifactByteLength = artifactLength(manifest.artifactLength, artifactBytes.length);
  if (manifest.artifactPath !== EXPECTED_ARTIFACT_RELATIVE_PATH) error(`artifactPath must be ${EXPECTED_ARTIFACT_RELATIVE_PATH}.`);
  if (manifest.status !== 'approved') error('status must be approved before a release can use this manifest.');
  requiredText(manifest.releaseApprovalId, 'releaseApprovalId', 128);
  signature(manifest.deploymentSignature, 'deploymentSignature');
  const upgradeAuthority = optionalAddress(manifest.upgradeAuthority, 'upgradeAuthority');
  const deployedAtSlot = slot(manifest.deployedAtSlot);
  const signedManifest = {
    manifestVersion: CUSTODY_MANIFEST_VERSION,
    deploymentId, network: manifest.network, programId, genesisHash,
    deploymentConfigAddress, feeRecipient, allowedMints, tokenProgramId: TOKEN_PROGRAM,
    idlAddress: programId, idlSha256: idlHash, artifactSha256, artifactLength: artifactByteLength,
    artifactPath: EXPECTED_ARTIFACT_RELATIVE_PATH, status: 'approved',
    releaseApprovalId: manifest.releaseApprovalId.trim(),
    deploymentSignature: manifest.deploymentSignature.trim(),
    upgradeAuthority,
    deployedAtSlot
  };
  return Object.freeze(signedManifest);
}

export function verifyCustodyDeploymentManifest({ manifest, sourceText, anchorTomlText, idl, idlBytes, artifactBytes, trustedApprovalPublicKey } = {}) {
  const signedManifest = validateCustodyDeploymentManifestReleaseInputs({ manifest, sourceText, anchorTomlText, idl, idlBytes, artifactBytes });
  const approval = verifyApproval(manifest, signedManifest, trustedApprovalPublicKey);
  return Object.freeze({ ...signedManifest, approval });
}

export function loadAndVerifyCustodyDeploymentManifest(manifestPath, { trustedApprovalPublicKey } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const absoluteManifest = path.resolve(root, manifestPath || 'custody-deployment-manifest.json');
  const relativeManifest = path.relative(root, absoluteManifest);
  if (relativeManifest.startsWith('..') || path.isAbsolute(relativeManifest)) throw new Error(`Custody deployment manifest path must remain inside the repository: ${absoluteManifest}`);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8')); }
  catch (cause) { throw new Error(`Custody deployment manifest could not be read: ${absoluteManifest} (${cause.code || cause.message})`); }
  const sourcePath = path.join(root, 'packages/custody-contracts/program/programs/escrow-global/src/lib.rs');
  const anchorTomlPath = path.join(root, 'packages/custody-contracts/program/Anchor.toml');
  const idlPath = path.join(root, 'packages/custody-contracts/program/target/idl/escrow_global.json');
  const artifactPath = path.join(root, EXPECTED_ARTIFACT_RELATIVE_PATH);
  const idlBytes = fs.readFileSync(idlPath);
  return verifyCustodyDeploymentManifest({
    manifest,
    sourceText: fs.readFileSync(sourcePath, 'utf8'),
    anchorTomlText: fs.readFileSync(anchorTomlPath, 'utf8'),
    idl: JSON.parse(idlBytes.toString('utf8')),
    idlBytes,
    artifactBytes: fs.readFileSync(artifactPath),
    trustedApprovalPublicKey
  });
}
