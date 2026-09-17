import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { base58Encode } from '../src/payments.mjs';
import { findProgramAddress } from '../src/custody/solana-pda.mjs';
import { custodyDeploymentManifestApprovalPayload, loadAndVerifyCustodyDeploymentManifest, verifyCustodyDeploymentManifest } from '../scripts/custody-deployment-manifest.mjs';

const key = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 251 + 1));
const programId = key(1);
const deploymentConfigAddress = findProgramAddress([Buffer.from('deployment-config')], programId).address;
const idl = { address: programId, instructions: [] };
const sourceText = `declare_id!("${programId}");`;
const anchorTomlText = `[programs.localnet]\nescrow_global = "${programId}"`;
const idlBytes = Buffer.from(JSON.stringify(idl));
const artifactBytes = Uint8Array.from([1, 2, 3, 4]);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const allowedMint = key(180);
const unsignedManifest = {
  manifestVersion: 2, deploymentId: 'escrow-devnet-2026-09', network: 'devnet',
  programId, genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', deploymentConfigAddress,
  feeRecipient: key(100), allowedMints: [allowedMint], tokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  idlAddress: programId, idlSha256: sha256(idlBytes),
  artifactSha256: sha256(artifactBytes), artifactLength: artifactBytes.length, artifactPath: 'packages/custody-contracts/program/target/deploy/escrow_global.so',
  status: 'approved', releaseApprovalId: 'approval-2026-09-13', deploymentSignature: base58Encode(new Uint8Array(64).fill(7)),
  upgradeAuthority: key(133), deployedAtSlot: 123
};

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const rawApprovalPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const signManifest = value => ({
  ...value,
  approval: {
    alg: 'Ed25519',
    signedScope: 'escrow-global/custody-deployment-manifest/v2',
    publicKey: base58Encode(rawApprovalPublicKey),
    signature: base58Encode(crypto.sign(null, custodyDeploymentManifestApprovalPayload(value), privateKey))
  }
});
const manifest = signManifest(unsignedManifest);
const trustedApprovalPublicKey = base58Encode(rawApprovalPublicKey);
const verify = options => verifyCustodyDeploymentManifest({ trustedApprovalPublicKey, ...options });

test('custody deployment manifest validates exact artifact and identity bindings', () => {
  const verified = verify({ manifest, sourceText, anchorTomlText, idl, idlBytes, artifactBytes });
  assert.equal(verified.programId, programId);
  assert.deepEqual(verified.allowedMints, [allowedMint]);
  assert.equal(verified.status, 'approved');
  assert.equal(Object.isFrozen(verified), true);
});

test('custody deployment manifest accepts an approved resettable-cluster genesis identity', () => {
  const resettable = signManifest({
    ...unsignedManifest,
    deploymentId: 'escrow-testnet-reset-2026-09',
    network: 'testnet',
    genesisHash: key(200)
  });
  const verified = verify({ manifest: resettable, sourceText, anchorTomlText, idl, idlBytes, artifactBytes });
  assert.equal(verified.network, 'testnet');
  assert.equal(verified.genesisHash, key(200));
});

test('custody deployment manifest permits an explicitly immutable ProgramData authority', () => {
  const verified = verify({ manifest: signManifest({ ...unsignedManifest, upgradeAuthority: null }), sourceText, anchorTomlText, idl, idlBytes, artifactBytes });
  assert.equal(verified.upgradeAuthority, null);
});

test('custody deployment manifest rejects changed artifact or IDL bytes', () => {
  assert.throws(() => verify({ manifest, sourceText, anchorTomlText, idl, idlBytes, artifactBytes: Uint8Array.of(9) }), /artifactSha256/);
  assert.throws(() => verify({ manifest: { ...manifest, artifactLength: artifactBytes.length + 1 }, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /artifactLength/);
  const changedIdl = { ...idl, instructions: [{ name: 'changed' }] };
  assert.throws(() => verify({ manifest, sourceText, anchorTomlText, idl: changedIdl, idlBytes: Buffer.from(JSON.stringify(changedIdl)), artifactBytes }), /generated IDL instruction set|idlSha256/);
});

test('custody deployment manifest rejects starter, unapproved and wrong-network identities', () => {
  assert.throws(() => verify({ manifest: { ...manifest, programId: key(166), idlAddress: key(166) }, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /programId/);
  assert.throws(() => verify({ manifest: { ...manifest, status: 'candidate' }, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /approved/);
  assert.throws(() => verify({ manifest: { ...manifest, network: 'localnet' }, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /network/);
  assert.throws(() => verify({ manifest: { ...manifest, network: 'mainnet-beta', genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', allowedMints: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'] }, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /genesisHash/);
  assert.throws(() => verify({ manifest: { ...manifest, allowedMints: [allowedMint, allowedMint] }, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /allowedMints/);
});

test('custody deployment manifest rejects an Anchor.toml program-ID mismatch', () => {
  assert.throws(() => verify({ manifest, sourceText, anchorTomlText: `[programs.localnet]\nescrow_global = "${key(166)}"`, idl, idlBytes, artifactBytes }), /Anchor.toml/);
});

test('custody deployment manifest rejects a non-canonical DeploymentConfig PDA', () => {
  assert.throws(() => verify({ manifest: { ...manifest, deploymentConfigAddress: key(67) }, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /canonical PDA/);
  const wrongProgramPda = findProgramAddress([Buffer.from('deployment-config')], key(166)).address;
  assert.throws(() => verify({ manifest: { ...manifest, deploymentConfigAddress: wrongProgramPda }, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /canonical PDA/);
});

test('custody deployment manifest loader rejects paths outside the repository', () => {
  assert.throws(() => loadAndVerifyCustodyDeploymentManifest('..\\outside\\custody-deployment-manifest.json', { trustedApprovalPublicKey }), /inside the repository/);
});

test('custody deployment manifest rejects approval tampering and missing signatures', () => {
  const tampered = { ...manifest, deploymentId: 'other-deployment' };
  assert.throws(() => verify({ manifest: tampered, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /approval Ed25519 signature/);
  const missing = { ...manifest };
  delete missing.approval;
  assert.throws(() => verify({ manifest: missing, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /unknown or missing top-level fields/);
});

test('custody deployment manifest rejects unsigned extension fields', () => {
  assert.throws(() => verify({ manifest: { ...manifest, operatorNote: 'not signed' }, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /unknown or missing top-level fields/);
});

test('custody deployment manifest rejects a self-signed or wrong trusted approver key', () => {
  assert.throws(() => verifyCustodyDeploymentManifest({ manifest, sourceText, anchorTomlText, idl, idlBytes, artifactBytes }), /trusted approval public key/);
  assert.throws(() => verify({ manifest, sourceText, anchorTomlText, idl, idlBytes, artifactBytes, trustedApprovalPublicKey: key(200) }), /trusted approval public key|not the trusted/);
});

test('custody deployment approval payload is stable across object key order', () => {
  const reordered = Object.fromEntries(Object.entries(manifest).reverse());
  assert.deepEqual(custodyDeploymentManifestApprovalPayload(manifest), custodyDeploymentManifestApprovalPayload(reordered));
});
