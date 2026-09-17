import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base58Encode } from '../src/payments.mjs';
import { findProgramAddress } from '../src/custody/solana-pda.mjs';
import { parsePreparationArguments, prepareCustodyDeploymentManifest } from '../scripts/prepare-custody-deployment-manifest.mjs';

const key = seed => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 251 + 1));
const signature = seed => base58Encode(Uint8Array.from({ length: 64 }, (_, index) => (seed + index) % 251 + 1));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const staging = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.deploy-staging');
  fs.mkdirSync(staging, { recursive: true });
  const directory = fs.mkdtempSync(path.join(staging, 'escrow-manifest-'));
  const programId = key(1);
  const deploymentConfigAddress = findProgramAddress([Buffer.from('deployment-config')], programId).address;
  const source = `declare_id!("${programId}");\n\npub fn create() {}`;
  const anchorToml = `[programs.localnet]\nescrow_global = "${programId}"\n`;
  const idl = JSON.stringify({ address: programId, instructions: [{ name: 'create' }] });
  const files = {
    sourcePath: path.join(directory, 'lib.rs'),
    anchorTomlPath: path.join(directory, 'Anchor.toml'),
    idlPath: path.join(directory, 'escrow_global.json'),
    artifactFilePath: path.join(directory, 'escrow_global.so')
  };
  fs.writeFileSync(files.sourcePath, source);
  fs.writeFileSync(files.anchorTomlPath, anchorToml);
  fs.writeFileSync(files.idlPath, idl);
  fs.writeFileSync(files.artifactFilePath, Buffer.from([1, 2, 3, 4, 5]));
  return {
    directory,
    files,
    programId,
    options: {
      ...files,
      deploymentId: 'test-deployment-2026-09',
      network: 'testnet',
      genesisHash: key(80),
      deploymentConfigAddress,
      feeRecipient: key(120),
      allowedMints: key(180),
      releaseApprovalId: 'release-approval-1',
      deploymentSignature: signature(140),
      deployedAtSlot: '123',
      upgradeAuthority: key(160)
    }
  };
}

test('prepares a deterministic unsigned manifest and exact approval payload', () => {
  const value = fixture();
  try {
    const first = prepareCustodyDeploymentManifest(value.options);
    const second = prepareCustodyDeploymentManifest(value.options);
    assert.deepEqual(first, second);
    assert.equal(first.manifest.approval, null);
    assert.equal(first.manifest.programId, value.programId);
    assert.equal(first.manifest.status, 'approved');
    assert.deepEqual(first.manifest.allowedMints, [key(180)]);
    assert.equal(first.manifest.artifactPath, 'packages/custody-contracts/program/target/deploy/escrow_global.so');
    assert.equal(first.approvalPayload.encoding, 'base64');
    const payload = Buffer.from(first.approvalPayload.value, 'base64');
    assert.equal(first.approvalPayload.sha256, sha256(payload));
    assert.equal(first.manifest.artifactLength, 5);
    assert.match(payload.toString('utf8'), /escrow-global\/custody-deployment-manifest\/v2/);
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
});

test('requires every deployment metadata option', () => {
  const value = fixture();
  try {
    for (const keyName of ['deploymentId', 'network', 'genesisHash', 'deploymentConfigAddress', 'feeRecipient', 'allowedMints', 'releaseApprovalId', 'deploymentSignature', 'deployedAtSlot']) {
      const options = { ...value.options };
      delete options[keyName];
      assert.throws(() => prepareCustodyDeploymentManifest(options), new RegExp(keyName.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)));
    }
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
});

test('rejects malformed identities, slots and source bindings', () => {
  const value = fixture();
  try {
    assert.throws(() => prepareCustodyDeploymentManifest({ ...value.options, feeRecipient: 'not-a-public-key' }), /fee-recipient/);
    assert.throws(() => prepareCustodyDeploymentManifest({ ...value.options, genesisHash: '0' }), /genesis-hash/);
    assert.throws(() => prepareCustodyDeploymentManifest({ ...value.options, deployedAtSlot: '-1' }), /deployed-at-slot/);
    assert.throws(() => prepareCustodyDeploymentManifest({ ...value.options, deployedAtSlot: 'not-a-slot' }), /deployed-at-slot/);
    fs.writeFileSync(value.files.anchorTomlPath, `[programs.localnet]\nescrow_global = "${key(200)}"\n`);
    assert.throws(() => prepareCustodyDeploymentManifest(value.options), /Anchor.toml/);
    fs.writeFileSync(value.files.anchorTomlPath, `[programs.localnet]\nescrow_global = "${value.programId}"\n`);
    fs.writeFileSync(value.files.idlPath, JSON.stringify({ address: key(201), instructions: [{ name: 'create' }] }));
    assert.throws(() => prepareCustodyDeploymentManifest(value.options), /IDL address/);
    fs.rmSync(value.files.artifactFilePath);
    assert.throws(() => prepareCustodyDeploymentManifest(value.options), /SBF artifact/);
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
});

test('rejects a non-canonical deployment config address before emitting a packet', () => {
  const value = fixture();
  try {
    assert.throws(() => prepareCustodyDeploymentManifest({ ...value.options, deploymentConfigAddress: key(100) }), /canonical PDA/);
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
});

test('supports immutable output and never includes key-loading or RPC code', () => {
  const value = fixture();
  try {
    const packet = prepareCustodyDeploymentManifest({ ...value.options, upgradeAuthority: undefined });
    assert.equal(packet.manifest.upgradeAuthority, null);
    const source = fs.readFileSync(new URL('../scripts/prepare-custody-deployment-manifest.mjs', import.meta.url), 'utf8');
    for (const forbidden of ['@solana/web3.js', '@coral-xyz/anchor', 'ANCHOR_WALLET', 'sendTransaction', 'Connection(']) assert.equal(source.includes(forbidden), false, forbidden);
    assert.throws(() => prepareCustodyDeploymentManifest({ ...value.options, sourcePath: '..\\outside\\lib.rs' }), /inside the repository/);
    assert.throws(() => parsePreparationArguments(['--unknown']), /Unknown option/);
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
});
