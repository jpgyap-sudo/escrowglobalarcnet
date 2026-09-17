import test from 'node:test';
import assert from 'node:assert/strict';
import { createEscrowPassport, verifyEscrowPassport, EscrowRecoveryError, LEGACY_SPL_TOKEN_PROGRAM_ID } from '../packages/escrow-recovery/index.mjs';
import { base58Decode, base58Encode } from '../src/payments.mjs';
import { findProgramAddress, utf8, u16le } from '../src/custody/solana-pda.mjs';

const key = n => base58Encode(Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 255));
const hash = n => n.toString(16).padStart(2, '0').repeat(32);
const buyer = key(1), seller = key(34), arbiter = key(67), fee = key(100), mint = key(133), program = key(166), genesis = key(199);

function passport(overrides = {}) {
  const agreementAddress = findProgramAddress([utf8('escrow-v2'), base58Bytes(buyer), hashBytes(hash(7))], program).address;
  const milestoneAddress = findProgramAddress([utf8('milestone-v2'), base58Bytes(agreementAddress), u16le(0)], program).address;
  const vaultAddress = findProgramAddress([utf8('vault-v2'), base58Bytes(milestoneAddress)], program).address;
  const milestone = {
    address: milestoneAddress, escrow: agreementAddress, vault: vaultAddress, vaultAuthority: milestoneAddress, index: 0, state: 'funded',
    principal: '1000', reserve: '30', expectedTotal: '1030', vaultAmount: '1030',
    sellerPaid: '0', feePaid: '0', buyerRefunded: '0', sellerEntitlement: '0', feeEntitlement: '0', buyerEntitlement: '0'
  };
  return {
    type: 'escrow-global-passport', version: 1, network: 'devnet', programId: program, genesisHash: genesis,
    evidence: { finality: 'finalized', accountOwnerVerified: true, stateContextVerified: true, pdaBindingsVerified: true, transferEvidenceVerified: true, slot: 123, rpcGenesisHash: genesis },
    agreement: { address: agreementAddress, programId: program, tokenProgramId: LEGACY_SPL_TOKEN_PROGRAM_ID, buyer, seller, arbiter, feeRecipient: fee, mint, agreementIdHash: hash(7), termsHash: hash(8), state: 'funded' },
    milestones: [milestone], ...overrides
  };
}

const base58Bytes = value => base58Decode(value);
const hashBytes = value => Uint8Array.from(value.match(/[a-f0-9]{2}/g), pair => Number.parseInt(pair, 16));

test('Escrow Passport validates finalized evidence and exposes exact claimable amounts', () => {
  const result = createEscrowPassport(passport(), { expectedProgramId: program, expectedGenesisHash: genesis, allowedMints: { devnet: [mint] } });
  assert.equal(result.passportHash.length, 64);
  assert.deepEqual(result.claimable[0], { index: 0, seller: '0', fee: '0', buyerRefund: '0' });
});

test('Escrow Passport rejects unverified evidence, wrong mint, vault authority and conservation', () => {
  assert.throws(() => verifyEscrowPassport(passport({ evidence: { finality: 'confirmed', accountOwnerVerified: true, stateContextVerified: true, pdaBindingsVerified: true, transferEvidenceVerified: true, slot: 1 } }), { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'UNVERIFIED_EVIDENCE');
  assert.throws(() => verifyEscrowPassport(passport({ agreement: { ...passport().agreement, mint: seller } }), { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'MINT_NOT_ALLOWED');
  assert.throws(() => verifyEscrowPassport(passport({ milestones: [{ ...passport().milestones[0], vaultAuthority: seller }] }), { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'VAULT_AUTHORITY_MISMATCH');
  assert.throws(() => verifyEscrowPassport(passport({ milestones: [{ ...passport().milestones[0], vaultAmount: '1029' }] }), { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'CONSERVATION_MISMATCH');
  assert.throws(() => verifyEscrowPassport(passport({ milestones: [{ ...passport().milestones[0], buyerEntitlement: '1030' }] }), { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'ENTITLEMENT_STATE_MISMATCH');
  assert.throws(() => verifyEscrowPassport(passport({ milestones: [{ ...passport().milestones[0], state: 'refunded', buyerEntitlement: '0', sellerEntitlement: '1000' }] }), { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'ENTITLEMENT_STATE_MISMATCH');
  assert.throws(() => verifyEscrowPassport(passport({ agreement: { ...passport().agreement, feeRecipient: seller } }), { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'INVALID_ROLES');
  assert.throws(() => verifyEscrowPassport(passport(), { expectedFeeRecipient: seller, allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'FEE_RECIPIENT_MISMATCH');
});

test('Escrow Passport rejects forged agreement, milestone and vault addresses', () => {
  const original = passport();
  assert.throws(() => verifyEscrowPassport({ ...original, agreement: { ...original.agreement, address: key(222) } }, { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'PDA_MISMATCH');
  assert.throws(() => verifyEscrowPassport({ ...original, milestones: [{ ...original.milestones[0], address: key(223) }] }, { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && ['PARENT_MISMATCH', 'PDA_MISMATCH'].includes(error.code));
  assert.throws(() => verifyEscrowPassport({ ...original, milestones: [{ ...original.milestones[0], vault: key(224) }] }, { allowedMints: [mint] }), error => error instanceof EscrowRecoveryError && error.code === 'PDA_MISMATCH');
});

test('Escrow Passport handles unfunded and claimed terminal states without inventing deposits', () => {
  const unfunded = passport({ agreement: { ...passport().agreement, state: 'accepted' }, milestones: [{ ...passport().milestones[0], state: 'unfunded', vaultAmount: '0' }] });
  assert.equal(verifyEscrowPassport(unfunded, { allowedMints: [mint] }).claimable[0].buyerRefund, '0');
  const refunded = passport({ milestones: [{ ...passport().milestones[0], state: 'refunded', vaultAmount: '1030', buyerEntitlement: '1030' }] });
  assert.equal(verifyEscrowPassport(refunded, { allowedMints: [mint] }).claimable[0].buyerRefund, '1030');
});
