import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { base58Decode, base58Encode } from '../src/payments.mjs';
import { findProgramAddress } from '../src/custody/solana-pda.mjs';
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, decodeDeploymentConfigAccount, decodeUpgradeableProgramAccount, decodeUpgradeableProgramDataAccount, verifyCustodyDeploymentEvidence } from '../src/custody/deployment-verification.mjs';

const key = seed => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 251 + 1));
const programId = key(1);
const programDataAddress = findProgramAddress([base58Decode(programId)], BPF_LOADER_UPGRADEABLE_PROGRAM_ID).address;
const deploymentConfigPda = findProgramAddress([Buffer.from('deployment-config')], programId);
const deploymentConfigAddress = deploymentConfigPda.address;
const authority = key(67);
const feeRecipient = key(100);
const allowedMint = key(180);
const genesisHash = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const deploymentSignature = base58Encode(new Uint8Array(64).fill(7));
const slot = 123;
const payer = key(101);
const buffer = key(140);
const spill = key(160);
const rent = 'SysvarRent111111111111111111111111111111111';
const clock = 'SysvarC1ock11111111111111111111111111111111';
const systemProgram = '11111111111111111111111111111111';
const artifactBytes = Uint8Array.of(9, 8, 7, 6, 5);
const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex');
const bytes = value => Buffer.from(value).toString('base64');
const txKey = (pubkey, signer = false) => ({ pubkey, signer });

function u32(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
function u64(value) { const result = new Uint8Array(8); let remaining = BigInt(value); for (let index = 0; index < 8; index += 1) { result[index] = Number(remaining & 255n); remaining >>= 8n; } return result; }
function concat(...parts) { return Uint8Array.from(parts.flatMap(part => [...part])); }

function account(data, { owner = BPF_LOADER_UPGRADEABLE_PROGRAM_ID, executable = false, contextSlot = 200 } = {}) {
  return { context: { slot: contextSlot }, value: { owner, executable, data: [bytes(data), 'base64'] } };
}

function programAccount({ address = programDataAddress, ...options } = {}) {
  return account(concat(u32(2), base58Decode(address)), { executable: true, ...options });
}

function programDataAccount({ upgrade = authority, deployedSlot = slot, code = artifactBytes, padding = new Uint8Array(3), ...options } = {}) {
  return account(concat(u32(3), u64(deployedSlot), Uint8Array.of(1), base58Decode(upgrade), code, padding), options);
}

function deploymentConfigAccount({ configAuthority = authority, fee = feeRecipient, acceptedMints = [allowedMint], bump = deploymentConfigPda.bump, ...options } = {}) {
  const discriminator = createHash('sha256').update('account:DeploymentConfig').digest().subarray(0, 8);
  const paddedMints = [acceptedMints[0], acceptedMints[1] || systemProgram];
  return account(concat(discriminator, base58Decode(configAuthority), base58Decode(fee), base58Decode(paddedMints[0]), base58Decode(paddedMints[1]), Uint8Array.of(bump)), { owner: programId, ...options });
}

const manifest = { network: 'devnet', programId, programDataAddress, deploymentConfigAddress, feeRecipient, allowedMints: [allowedMint], upgradeAuthority: authority, genesisHash, deploymentSignature, deployedAtSlot: slot, artifactSha256, artifactLength: artifactBytes.length };
const transaction = { slot, meta: { err: null, loadedAddresses: { writable: [], readonly: [] } }, transaction: { signatures: [deploymentSignature], message: { accountKeys: [txKey(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), txKey(programDataAddress), txKey(programId), txKey(buffer), txKey(spill), txKey(rent), txKey(clock), txKey(authority, true)], instructions: [{ programIdIndex: 0, accounts: [1, 2, 3, 4, 5, 6, 7], data: base58Encode(Uint8Array.of(3)) }] } } };
const deployTransaction = { slot, meta: { err: null, loadedAddresses: { writable: [], readonly: [] } }, transaction: { signatures: [deploymentSignature], message: { accountKeys: [txKey(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), txKey(payer, true), txKey(programDataAddress), txKey(programId), txKey(buffer), txKey(rent), txKey(clock), txKey(systemProgram), txKey(authority, true)], instructions: [{ programIdIndex: 0, accounts: [1, 2, 3, 4, 5, 6, 7, 8], data: base58Encode(Uint8Array.of(2)) }] } } };
const validEvidence = { genesisHash, programAccount: programAccount(), programDataAccount: programDataAccount(), deploymentConfigAccount: deploymentConfigAccount(), deploymentTransaction: transaction };

test('verifies finalized upgradeable-loader deployment evidence', () => {
  const verified = verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, ...validEvidence });
  assert.equal(verified.status, 'verified');
  assert.equal(verified.blockers.length, 0);
  assert.equal(verified.checks.every(check => check.ok), true);
  assert.equal(verified.checks.some(check => check.name === 'programdata-artifact' && check.ok), true);
});

test('verifies both initial deployment and upgrade instruction layouts', () => {
  assert.equal(verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, ...validEvidence, deploymentTransaction: deployTransaction }).status, 'verified');
});

test('rejects a loader instruction with forged ancillary accounts', () => {
  const forged = {
    ...deployTransaction,
    transaction: {
      ...deployTransaction.transaction,
      message: {
        ...deployTransaction.transaction.message,
        accountKeys: deployTransaction.transaction.message.accountKeys.map((value, index) => index === 5 ? key(180) : value)
      }
    }
  };
  assert.notEqual(verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, ...validEvidence, deploymentTransaction: forged }).status, 'verified');
});

test('resolves versioned transaction loaded addresses before validating account indexes', () => {
  const versionedTransaction = {
    slot,
    meta: { err: null, loadedAddresses: { writable: [programDataAddress, programId, buffer], readonly: [rent, clock, systemProgram] } },
    transaction: { signatures: [deploymentSignature], message: { accountKeys: [txKey(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), txKey(payer, true), txKey(authority, true)], instructions: [{ programIdIndex: 0, accounts: [1, 3, 4, 5, 6, 7, 8, 2], data: base58Encode(Uint8Array.of(2)) }] } }
  };
  assert.equal(verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, ...validEvidence, deploymentTransaction: versionedTransaction }).status, 'verified');
});

test('requires the loader deployment authority to be a transaction signer', () => {
  const unsignedAuthority = {
    ...transaction,
    transaction: {
      ...transaction.transaction,
      message: {
        ...transaction.transaction.message,
        accountKeys: transaction.transaction.message.accountKeys.map((entry, index) => index === 7 ? txKey(authority, false) : entry)
      }
    }
  };
  assert.notEqual(verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, ...validEvidence, deploymentTransaction: unsignedAuthority }).status, 'verified');
});

test('decoders accept canonical Program and ProgramData metadata only', () => {
  assert.deepEqual(decodeUpgradeableProgramAccount(programAccount().value), { programDataAddress });
  assert.deepEqual(decodeUpgradeableProgramDataAccount(programDataAccount().value), { slot, upgradeAuthority: authority });
  assert.deepEqual(decodeDeploymentConfigAccount(deploymentConfigAccount().value), { authority, feeRecipient, acceptedMints: [allowedMint], bump: deploymentConfigPda.bump });
  assert.equal(decodeUpgradeableProgramAccount(account(Uint8Array.of(2, 0, 0, 0))), null);
  assert.equal(decodeUpgradeableProgramDataAccount(account(concat(u32(3), u64(slot), Uint8Array.of(2), new Uint8Array(32))).value), null);
  assert.deepEqual(decodeUpgradeableProgramDataAccount(account(concat(u32(3), u64(slot), Uint8Array.of(0), new Uint8Array(32))).value), { slot, upgradeAuthority: null });
});

test('immutable ProgramData is valid when the approved manifest revokes upgrade authority', () => {
  const immutableManifest = { ...manifest, upgradeAuthority: null };
  const evidence = { ...validEvidence, programDataAccount: account(concat(u32(3), u64(slot), Uint8Array.of(0), new Uint8Array(32), artifactBytes)), deploymentTransaction: deployTransaction };
  assert.equal(verifyCustodyDeploymentEvidence({ manifest: immutableManifest, programDataAddress, deploymentConfigAddress, ...evidence }).status, 'verified');
});

test('missing RPC evidence is blocked rather than treated as deployment proof', () => {
  const result = verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, genesisHash, programAccount: null, programDataAccount: null, deploymentConfigAccount: null, deploymentTransaction: null });
  assert.equal(result.status, 'blocked');
});

test('rejects non-canonical deployment signatures and zero public-key bindings', () => {
  assert.equal(verifyCustodyDeploymentEvidence({ manifest: { ...manifest, deploymentSignature: 'not-a-signature' }, programDataAddress, deploymentConfigAddress, ...validEvidence }).status, 'blocked');
  const zero = base58Encode(new Uint8Array(32));
  assert.equal(verifyCustodyDeploymentEvidence({ manifest: { ...manifest, feeRecipient: zero }, programDataAddress, deploymentConfigAddress, ...validEvidence }).status, 'blocked');
});

test('cluster, account and transaction contradictions fail closed', () => {
  for (const evidence of [
    { ...validEvidence, genesisHash: key(140) },
    { ...validEvidence, programAccount: account(new Uint8Array(36), { owner: key(140), executable: true }) },
    { ...validEvidence, programAccount: programAccount({ address: key(140) }) },
    { ...validEvidence, programDataAccount: programDataAccount({ upgrade: key(140) }) },
    { ...validEvidence, programDataAccount: programDataAccount({ deployedSlot: slot + 1 }) },
    { ...validEvidence, deploymentConfigAccount: deploymentConfigAccount({ owner: key(140) }) },
    { ...validEvidence, deploymentConfigAccount: deploymentConfigAccount({ fee: key(140) }) },
    { ...validEvidence, deploymentConfigAccount: deploymentConfigAccount({ acceptedMints: [key(181)] }) },
    { ...validEvidence, deploymentConfigAccount: deploymentConfigAccount({ bump: (deploymentConfigPda.bump + 1) % 256 }) },
    { ...validEvidence, deploymentConfigAccount: account(new Uint8Array(137), { owner: programId }) },
    { ...validEvidence, deploymentConfigAddress: key(140) },
    { ...validEvidence, deploymentTransaction: { ...transaction, slot: slot + 1 } },
    { ...validEvidence, deploymentTransaction: { ...transaction, transaction: { ...transaction.transaction, signatures: [base58Encode(new Uint8Array(64).fill(8))] } } },
    { ...validEvidence, deploymentTransaction: { ...transaction, meta: { err: { InstructionError: [0, 'Failed'] } } } },
    { ...validEvidence, deploymentTransaction: { ...transaction, transaction: { message: { accountKeys: [programId], instructions: [{ programIdIndex: 0, accounts: [0], data: base58Encode(Uint8Array.of(2)) }] } } } },
    { ...validEvidence, deploymentTransaction: { ...transaction, transaction: { message: { accountKeys: [programId, programDataAddress], instructions: [{ programIdIndex: 0, accounts: [0, 1], data: base58Encode(Uint8Array.of(2)) }] } } } },
    { ...validEvidence, deploymentTransaction: { ...transaction, transaction: { message: { accountKeys: [BPF_LOADER_UPGRADEABLE_PROGRAM_ID, programId, programDataAddress], instructions: [{ programIdIndex: 0, accounts: [1], data: base58Encode(Uint8Array.of(2)) }] } } } },
    { ...validEvidence, deploymentTransaction: { ...transaction, transaction: { message: { accountKeys: [BPF_LOADER_UPGRADEABLE_PROGRAM_ID, programId, programDataAddress], instructions: [{ programIdIndex: 0, accounts: [1, 2], data: base58Encode(Uint8Array.of(4)) }] } } } }
  ]) {
    assert.notEqual(verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, ...evidence }).status, 'verified');
  }
});

test('malformed account shapes and stale context are blocked', () => {
  const malformed = verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, genesisHash, programAccount: { context: { slot }, value: { owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID, executable: true, data: ['not-base64', 'base64'] } }, programDataAccount: account(new Uint8Array(45)), deploymentConfigAccount: deploymentConfigAccount(), deploymentTransaction: transaction });
  assert.equal(malformed.status, 'blocked');
  const stale = verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, genesisHash, programAccount: programAccount({ contextSlot: slot - 1 }), programDataAccount: programDataAccount(), deploymentConfigAccount: deploymentConfigAccount(), deploymentTransaction: transaction });
  assert.equal(stale.status, 'blocked');
  const mismatch = verifyCustodyDeploymentEvidence({ manifest: { ...manifest, artifactSha256: '0'.repeat(64) }, programDataAddress, deploymentConfigAddress, ...validEvidence });
  assert.notEqual(mismatch.status, 'verified');
  const malformedHash = verifyCustodyDeploymentEvidence({ manifest: { ...manifest, artifactSha256: 'not-a-hash' }, programDataAddress, deploymentConfigAddress, ...validEvidence });
  assert.equal(malformedHash.status, 'blocked');
  const newlineHash = verifyCustodyDeploymentEvidence({ manifest: { ...manifest, artifactSha256: `${artifactSha256}\n` }, programDataAddress, deploymentConfigAddress, ...validEvidence });
  assert.equal(newlineHash.status, 'blocked');
  const forgedProgramDataPda = verifyCustodyDeploymentEvidence({ manifest, programDataAddress: key(201), deploymentConfigAddress, ...validEvidence });
  assert.notEqual(forgedProgramDataPda.status, 'verified');
  const dirtyPadding = verifyCustodyDeploymentEvidence({ manifest, programDataAddress, deploymentConfigAddress, ...validEvidence, programDataAccount: programDataAccount({ padding: Uint8Array.of(1) }) });
  assert.notEqual(dirtyPadding.status, 'verified');
});
