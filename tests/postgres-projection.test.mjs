import test from 'node:test';
import assert from 'node:assert/strict';
import { base58Encode } from '../src/payments.mjs';
import { createPostgresCustodyProjectionRepository, AGREEMENT_SQL, MILESTONE_SQL } from '../src/custody/postgres-projection.mjs';

const address = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 255));
const ids = { agreement: address(1), buyer: address(33), seller: address(66), arbiter: address(99), fee: address(132), mint: address(165), vault: address(198), milestone: address(20) };

function v1Agreement(overrides = {}) {
  return {
    agreement_id: 'agreement-1', deployment_id: 'deployment-1', agreement_address: ids.agreement,
    agreement_id_hash: 'a'.repeat(64), terms_hash: 'b'.repeat(64), buyer: ids.buyer, seller: ids.seller,
    arbiter: ids.arbiter, fee_recipient: ids.fee, mint: ids.mint, protocol_version: 'v1', state: 'Funded',
    state_revision: '0', principal: '1000', fee_reserve: '30', expected_total: '1030',
    seller_entitlement: '0', fee_entitlement: '0', buyer_entitlement: '0', unresolved_principal: '1000',
    vault_address: ids.vault, vault_amount: '1030', observed_slot: 900, ...overrides
  };
}

function v2Snapshot() {
  return {
    agreement: {
      agreement_id: 'agreement-2', deployment_id: 'deployment-1', agreement_address: ids.agreement,
      agreement_id_hash: 'c'.repeat(64), terms_hash: 'd'.repeat(64), buyer: ids.buyer, seller: ids.seller,
      arbiter: ids.arbiter, fee_recipient: ids.fee, mint: ids.mint, protocol_version: 'v2', state: 'Accepted',
      state_revision: '0', principal: null, fee_reserve: null, expected_total: null, seller_entitlement: null,
      fee_entitlement: null, buyer_entitlement: null, unresolved_principal: null, vault_address: null,
      vault_amount: null, observed_slot: 901
    },
    milestone: { agreement_id: 'agreement-2', milestone_index: 0, milestone_address: ids.milestone, vault_address: ids.vault,
      principal: '1000', fee_reserve: '30', expected_total: '1030', state: 'Funded', seller_entitlement: '0',
      fee_entitlement: '0', buyer_entitlement: '0', vault_amount: '1030', observed_slot: 901 }
  };
}

function fakeDb({ rowCount = 1 } = {}) {
  const calls = [];
  return { calls, db: { async transaction(work) { return work({ async query(text, params) { calls.push({ text, params }); return { rowCount }; } }); } } };
}

test('persists a V1 projection transactionally with bytea bindings and parameterized SQL', async () => {
  const fake = fakeDb();
  const repo = createPostgresCustodyProjectionRepository({ db: fake.db, clock: () => '2026-09-13T00:00:00.000Z' });
  const result = await repo.persist({ agreement: v1Agreement(), milestones: [] });
  assert.deepEqual(result, { agreementApplied: true, milestoneApplied: [] });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].text, AGREEMENT_SQL);
  assert.equal(fake.calls[0].params[0], 'agreement-1');
  assert.equal(Buffer.isBuffer(fake.calls[0].params[2]), true);
  assert.equal(fake.calls[0].params[23], '2026-09-13T00:00:00.000Z');
  assert.match(fake.calls[0].text, /ON CONFLICT \(agreement_id\)/);
  assert.match(fake.calls[0].text, /WHERE EXCLUDED\.state_revision/);
  assert.doesNotMatch(fake.calls[0].text, /principal = EXCLUDED\.principal|fee_reserve = EXCLUDED\.fee_reserve|expected_total = EXCLUDED\.expected_total/);
});

test('persists a V2 parent and milestone in one transaction', async () => {
  const fake = fakeDb();
  const repo = createPostgresCustodyProjectionRepository({ db: fake.db, clock: () => '2026-09-13T00:00:00.000Z' });
  const result = await repo.persist(v2Snapshot());
  assert.deepEqual(result, { agreementApplied: true, milestoneApplied: [true] });
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].text, AGREEMENT_SQL);
  assert.equal(fake.calls[1].text, MILESTONE_SQL);
  assert.equal(fake.calls[1].params[0], 'agreement-2');
  assert.equal(Buffer.isBuffer(fake.calls[1].params[2]), true);
});

test('reports an older projection as unapplied instead of moving persistence backward', async () => {
  const fake = fakeDb({ rowCount: 0 });
  const repo = createPostgresCustodyProjectionRepository({ db: fake.db });
  const result = await repo.persist({ agreement: v1Agreement() });
  assert.deepEqual(result, { agreementApplied: false, milestoneApplied: [] });
});

test('rejects malformed persistence rows before opening a transaction', async () => {
  let transactions = 0;
  const repo = createPostgresCustodyProjectionRepository({ db: { async transaction() { transactions += 1; } } });
  await assert.rejects(() => repo.persist({ agreement: v1Agreement({ principal: '01' }) }), /canonical u64/);
  assert.equal(transactions, 0);
});

test('rejects zero public-key bindings before opening a transaction', async () => {
  let transactions = 0;
  const repo = createPostgresCustodyProjectionRepository({ db: { async transaction() { transactions += 1; } } });
  const zero = base58Encode(new Uint8Array(32));
  await assert.rejects(() => repo.persist({ agreement: v1Agreement({ buyer: zero }) }), /valid canonical Solana address/);
  assert.equal(transactions, 0);
});
