/**
 * Transactional PostgreSQL writer for rows produced by
 * projectFinalizedAccountSnapshot().
 *
 * This adapter accepts an injected database client only. It does not obtain
 * chain data, sign, submit, or derive authority from a browser request.
 */
import { base58Decode, base58Encode } from '../payments.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const safeSlot = value => Number.isSafeInteger(value) && value >= 0;
const byteaAddress = (value, label) => {
  if (!text(value)) throw new Error(`${label} is required.`);
  let bytes;
  try { bytes = Buffer.from(base58Decode(value)); } catch { throw new Error(`${label} must be a valid Solana address.`); }
  if (bytes.length !== 32 || bytes.every(byte => byte === 0) || base58Encode(bytes) !== value) throw new Error(`${label} must be a valid canonical Solana address.`);
  return bytes;
};
const byteaHash = (value, label) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || /^0+$/.test(value)) throw new Error(`${label} must be a non-zero lowercase hash.`);
  return Buffer.from(value, 'hex');
};
const amount = (value, label, nullable = false) => {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > ((1n << 64n) - 1n)) throw new Error(`${label} must be a canonical u64 decimal string.`);
  return value;
};

function timestamp(value, clock) {
  const candidate = value === undefined ? clock() : value;
  if (typeof candidate !== 'string' || Number.isNaN(Date.parse(candidate))) throw new Error('observedAt must be an ISO timestamp.');
  return new Date(candidate).toISOString();
}

function agreementParams(row, observedAt) {
  if (!plain(row)) throw new Error('A projected agreement row is required.');
  if (!text(row.agreement_id) || row.agreement_id.length > 128) throw new Error('agreement_id is invalid.');
  if (row.protocol_version !== 'v1' && row.protocol_version !== 'v2') throw new Error('protocol_version is invalid.');
  if (!text(row.state) || !safeSlot(row.observed_slot)) throw new Error('Projected agreement state and slot are required.');
  const requiredAddresses = ['agreement_address', 'buyer', 'seller', 'arbiter', 'fee_recipient', 'mint'];
  const addresses = Object.fromEntries(requiredAddresses.map(key => [key, byteaAddress(row[key], `agreement.${key}`)]));
  const params = [
    row.agreement_id,
    text(row.deployment_id) ? row.deployment_id : (() => { throw new Error('agreement.deployment_id is required.'); })(),
    addresses.agreement_address,
    byteaHash(row.agreement_id_hash, 'agreement.agreement_id_hash'),
    byteaHash(row.terms_hash, 'agreement.terms_hash'),
    addresses.buyer,
    addresses.seller,
    addresses.arbiter,
    addresses.fee_recipient,
    addresses.mint,
    row.protocol_version,
    row.state,
    amount(row.state_revision, 'agreement.state_revision'),
    amount(row.principal, 'agreement.principal', true),
    amount(row.fee_reserve, 'agreement.fee_reserve', true),
    amount(row.expected_total, 'agreement.expected_total', true),
    amount(row.seller_entitlement, 'agreement.seller_entitlement', true),
    amount(row.fee_entitlement, 'agreement.fee_entitlement', true),
    amount(row.buyer_entitlement, 'agreement.buyer_entitlement', true),
    amount(row.unresolved_principal, 'agreement.unresolved_principal', true),
    row.vault_address === null ? null : byteaAddress(row.vault_address, 'agreement.vault_address'),
    amount(row.vault_amount, 'agreement.vault_amount', true),
    row.observed_slot,
    observedAt,
    observedAt
  ];
  return params;
}

function milestoneParams(row, observedAt) {
  if (!plain(row) || !text(row.agreement_id) || !Number.isSafeInteger(row.milestone_index) || row.milestone_index < 0 || row.milestone_index > 15 || !text(row.state) || !safeSlot(row.observed_slot)) throw new Error('Projected milestone row is malformed.');
  return [
    row.agreement_id,
    row.milestone_index,
    byteaAddress(row.milestone_address, 'milestone.milestone_address'),
    byteaAddress(row.vault_address, 'milestone.vault_address'),
    amount(row.principal, 'milestone.principal'),
    amount(row.fee_reserve, 'milestone.fee_reserve'),
    amount(row.expected_total, 'milestone.expected_total'),
    row.state,
    amount(row.seller_entitlement, 'milestone.seller_entitlement'),
    amount(row.fee_entitlement, 'milestone.fee_entitlement'),
    amount(row.buyer_entitlement, 'milestone.buyer_entitlement'),
    amount(row.vault_amount, 'milestone.vault_amount'),
    row.observed_slot,
    observedAt
  ];
}

const AGREEMENT_SQL = `INSERT INTO custody_agreements
  (agreement_id, deployment_id, agreement_address, agreement_id_hash, terms_hash,
   buyer, seller, arbiter, fee_recipient, mint, protocol_version, state,
   state_revision, principal, fee_reserve, expected_total, seller_entitlement,
   fee_entitlement, buyer_entitlement, unresolved_principal, vault_address,
   vault_amount, observed_slot, first_seen_at, last_seen_at)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16, $17, $18, $19, $20, $21, $22, $23, $24::timestamptz, $25::timestamptz)
 ON CONFLICT (agreement_id) DO UPDATE SET
   state = EXCLUDED.state, state_revision = EXCLUDED.state_revision,
   seller_entitlement = EXCLUDED.seller_entitlement,
   fee_entitlement = EXCLUDED.fee_entitlement,
   buyer_entitlement = EXCLUDED.buyer_entitlement,
   unresolved_principal = EXCLUDED.unresolved_principal,
   vault_amount = EXCLUDED.vault_amount,
   observed_slot = EXCLUDED.observed_slot, last_seen_at = EXCLUDED.last_seen_at
 -- A projection is admitted only when both monotonicity dimensions advance;
 -- a newer revision with an older finalized slot is not a valid replacement.
 WHERE EXCLUDED.state_revision >= custody_agreements.state_revision
   AND EXCLUDED.observed_slot >= COALESCE(custody_agreements.observed_slot, 0)
 RETURNING agreement_id`;

const MILESTONE_SQL = `INSERT INTO custody_milestones
  (agreement_id, milestone_index, milestone_address, vault_address, principal,
   fee_reserve, expected_total, state, seller_entitlement, fee_entitlement,
   buyer_entitlement, vault_amount, observed_slot, updated_at)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14::timestamptz)
 ON CONFLICT (agreement_id, milestone_index) DO UPDATE SET
   state = EXCLUDED.state, seller_entitlement = EXCLUDED.seller_entitlement,
   fee_entitlement = EXCLUDED.fee_entitlement,
   buyer_entitlement = EXCLUDED.buyer_entitlement,
   vault_amount = EXCLUDED.vault_amount, observed_slot = EXCLUDED.observed_slot,
   updated_at = EXCLUDED.updated_at
 WHERE EXCLUDED.observed_slot >= COALESCE(custody_milestones.observed_slot, 0)
 RETURNING agreement_id, milestone_index`;

export function createPostgresCustodyProjectionRepository({ db, clock = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new Error('A PostgreSQL adapter with transaction is required.');
  if (typeof clock !== 'function') throw new Error('clock must be a function.');
  return Object.freeze({
    async persist(snapshot, { observedAt = undefined } = {}) {
      if (!plain(snapshot) || !plain(snapshot.agreement)) throw new Error('A projected account snapshot is required.');
      const at = timestamp(observedAt, clock);
      const agreement = agreementParams(snapshot.agreement, at);
      const milestones = snapshot.agreement.protocol_version === 'v2' ? [snapshot.milestone] : (Array.isArray(snapshot.milestones) ? snapshot.milestones : []);
      if (snapshot.agreement.protocol_version === 'v2' && milestones.length !== 1) throw new Error('A V2 projection requires exactly one milestone row.');
      return db.transaction(async client => {
        if (!client || typeof client.query !== 'function') throw new Error('The PostgreSQL transaction client must expose query.');
        const agreementResult = await client.query(AGREEMENT_SQL, agreement);
        const milestoneResults = [];
        for (const row of milestones) milestoneResults.push(await client.query(MILESTONE_SQL, milestoneParams(row, at)));
        return Object.freeze({ agreementApplied: Number(agreementResult?.rowCount || 0) > 0, milestoneApplied: milestoneResults.map(result => Number(result?.rowCount || 0) > 0) });
      });
    }
  });
}

export { AGREEMENT_SQL, MILESTONE_SQL };
