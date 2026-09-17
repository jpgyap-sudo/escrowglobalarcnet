/**
 * Reference-only funding quote for the future Escrow Global custody program.
 *
 * This module is deliberately pure and non-authoritative. It does not derive
 * addresses, connect to Solana, sign or serialize transactions, verify party
 * signatures, or mark any funds as deposited.
 */

const MAX_U64 = (1n << 64n) - 1n;
export const DISPUTE_FEE_BPS = 500;
const INTEGER = /^(0|[1-9][0-9]*)$/;
const INPUT_FIELDS = new Set([
  'agreementId', 'termsHash', 'termsVersion', 'asset', 'status',
  'acceptedAt', 'fundedAt', 'cancelled', 'milestones', 'feeBps'
]);
const MILESTONE_FIELDS = new Set(['id', 'principal']);

function objectWithOnlyFields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}.`);
  }
}

function positiveInteger(value, label) {
  if (typeof value !== 'string' || !INTEGER.test(value) || value === '0') {
    throw new Error(`${label} must be a positive decimal integer string.`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_U64) throw new Error(`${label} exceeds the supported token-unit limit.`);
  return parsed;
}

/** Calculate floor(principal * feeBps / 10,000) using token base units. */
export function deriveMilestoneReserve(principal, feeBps = 300) {
  if (feeBps !== 300) throw new Error('feeBps must be exactly 300 for this reference policy.');
  return ((positiveInteger(principal, 'principal') * 300n) / 10000n).toString();
}

/** Calculate the separate, non-refundable formal-dispute charge. */
export function deriveDisputeCharge(principal) {
  const charge = (positiveInteger(principal, 'principal') * BigInt(DISPUTE_FEE_BPS)) / 10000n;
  if (charge === 0n) throw new Error('The formal dispute charge must be at least one token unit.');
  return charge.toString();
}

/**
 * Quote initial funding for an accepted, unfunded agreement.
 *
 * The result is a quote only. `fundingVerified` and `authorizationVerified`
 * intentionally remain false, and `broadcastable` intentionally remains false.
 */
export function quoteFunding(input) {
  objectWithOnlyFields(input, INPUT_FIELDS, 'quoteFunding input');
  if (typeof input.agreementId !== 'string' || input.agreementId.trim() === '') {
    throw new Error('agreementId must be a non-empty string.');
  }
  const agreementId = input.agreementId.trim();
  if (agreementId.length > 160) throw new Error('agreementId exceeds the supported length.');
  if (typeof input.termsHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.termsHash)) {
    throw new Error('termsHash must be exactly 64 lowercase hexadecimal characters.');
  }
  if (!Number.isSafeInteger(input.termsVersion) || input.termsVersion < 1) {
    throw new Error('termsVersion must be a positive safe integer.');
  }
  if (!['USDC', 'USDT'].includes(input.asset)) throw new Error('asset must be USDC or USDT.');
  if (input.status !== 'accepted') throw new Error('Agreement status must be accepted.');
  if (!Number.isSafeInteger(input.acceptedAt) || input.acceptedAt <= 0) {
    throw new Error('acceptedAt must be a positive safe integer timestamp.');
  }
  if (input.fundedAt !== null && input.fundedAt !== undefined) {
    throw new Error('fundedAt must be null or undefined for an initial quote.');
  }
  if (input.cancelled !== false) throw new Error('cancelled must be false for an initial quote.');
  if (input.feeBps !== 300) throw new Error('feeBps must be exactly 300 for this reference policy.');
  if (!Array.isArray(input.milestones) || input.milestones.length === 0) {
    throw new Error('milestones must be a non-empty array.');
  }

  const seen = new Set();
  let totalPrincipal = 0n;
  let totalReserve = 0n;
  const milestones = input.milestones.map((milestone, index) => {
    const label = `milestones[${index}]`;
    objectWithOnlyFields(milestone, MILESTONE_FIELDS, label);
    if (typeof milestone.id !== 'string' || milestone.id.trim() === '') {
      throw new Error(`${label}.id must be a non-empty string.`);
    }
    const id = milestone.id.trim();
    if (id.length > 160) throw new Error(`${label}.id exceeds the supported length.`);
    if (seen.has(id)) throw new Error(`${label}.id must be unique.`);
    seen.add(id);
    const principal = positiveInteger(milestone.principal, `${label}.principal`);
    const reserve = BigInt(deriveMilestoneReserve(principal.toString()));
    totalPrincipal += principal;
    totalReserve += reserve;
    if (totalPrincipal > MAX_U64 || totalReserve > MAX_U64 || totalPrincipal + totalReserve > MAX_U64) {
      throw new Error('Funding totals exceed the supported token-unit limit.');
    }
    return { id, principal: principal.toString(), reserve: reserve.toString() };
  });

  const total = totalPrincipal + totalReserve;
  if (total > MAX_U64) throw new Error('Funding total exceeds the supported token-unit limit.');
  return {
    mode: 'reference-only',
    broadcastable: false,
    authorizationVerified: false,
    fundingVerified: false,
    agreementId,
    termsHash: input.termsHash,
    termsVersion: input.termsVersion,
    asset: input.asset,
    feeBps: 300,
    milestones,
    totalPrincipal: totalPrincipal.toString(),
    totalReserve: totalReserve.toString(),
    total: total.toString()
  };
}
