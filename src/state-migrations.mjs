import { assertInvariants, DomainError } from './universal-domain.mjs';
import { DEMO_TOKENS } from './settlement-assets.mjs';

const MICRO_RE = /^(0|[1-9]\d*)$/;

function fail(msg) {
  throw new DomainError(msg, 'MIGRATION_ERROR');
}

function isMicro(v) {
  return typeof v === 'string' && MICRO_RE.test(v);
}

function requireMicro(v, label) {
  if (!isMicro(v)) fail(`Invalid micro-unit value for ${label}`);
  return v;
}

function requireAbsent(obj, key, label) {
  if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
    fail(`Legacy field ${label} must be absent`);
  }
}

function migrateUnchecked(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('State must be an object');
  }

  const clone = structuredClone(input);

  // Payroll is an additive sandbox slice. Older saved demos receive an empty
  // actor-scoped bucket; no existing agreement or balance is altered.
  if (clone.payrollByUser === undefined) clone.payrollByUser = {};
  if (clone.payrollByUser === null || typeof clone.payrollByUser !== 'object' || Array.isArray(clone.payrollByUser)) fail('payrollByUser must be an object');

  if (clone.mode !== 'sandbox') {
    fail('State mode must be sandbox');
  }

  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(clone, 'schemaVersion');

  if (hasSchemaVersion) {
    if (clone.schemaVersion !== 3) {
      fail('Unknown schemaVersion');
    }
    if (Object.prototype.hasOwnProperty.call(clone, 'universalVersion')) {
      if (clone.universalVersion !== 2) {
        fail('Unsupported universalVersion');
      }
    }
    if (clone.domainOffers === undefined) clone.domainOffers = [];
    if (!Array.isArray(clone.domainOffers)) fail('domainOffers must be an array');
    if (!Number.isSafeInteger(clone.version) || clone.version < 1) {
      fail('Invalid version');
    }
    assertInvariants(clone);
    return clone;
  }

  // Legacy scalar state migration
  if (!Number.isSafeInteger(clone.version) || clone.version < 1) {
    fail('Invalid version');
  }
  if (Object.prototype.hasOwnProperty.call(clone, 'universalVersion')) {
    if (clone.universalVersion !== 2) {
      fail('Unsupported universalVersion');
    }
  }

  if (!Array.isArray(clone.users)) fail('users must be an array');
  if (!Array.isArray(clone.listings)) fail('listings must be an array');
  if (!Array.isArray(clone.orders)) fail('orders must be an array');
  if (!Array.isArray(clone.briefs)) fail('briefs must be an array');
  if (!Array.isArray(clone.reviews)) fail('reviews must be an array');
  if (clone.treasury === null || typeof clone.treasury !== 'object' || Array.isArray(clone.treasury)) {
    fail('treasury must be an object');
  }

  // Reject mixed legacy/new shapes
  for (const u of clone.users) {
    if (u && typeof u === 'object') {
      requireAbsent(u, 'balances', 'user.balances');
    }
  }
  requireAbsent(clone.treasury, 'balances', 'treasury.balances');
  requireAbsent(clone, 'initialFundsByAsset', 'initialFundsByAsset');

  for (const l of clone.listings) {
    if (l && typeof l === 'object') {
      requireAbsent(l, 'shippingPrices', 'listing.shippingPrices');
      if (Array.isArray(l.packages)) {
        for (const p of l.packages) {
          if (p && typeof p === 'object') {
            requireAbsent(p, 'prices', 'listing.packages[].prices');
          }
        }
      }
    }
  }

  for (const o of clone.orders) {
    if (o && typeof o === 'object') {
      requireAbsent(o, 'asset', 'order.asset');
    }
  }

  for (const b of clone.briefs) {
    if (b && typeof b === 'object') {
      requireAbsent(b, 'asset', 'brief.asset');
      if (Array.isArray(b.proposals)) {
        for (const p of b.proposals) {
          if (p && typeof p === 'object') {
            requireAbsent(p, 'asset', 'brief.proposals[].asset');
          }
        }
      }
    }
  }

  // Validate legacy scalar monetary fields
  for (const u of clone.users) {
    if (!u || typeof u !== 'object') fail('Invalid user record');
    requireMicro(u.balance, 'user.balance');
  }

  requireMicro(clone.treasury.commission, 'treasury.commission');
  requireMicro(clone.treasury.disputeFees, 'treasury.disputeFees');
  requireMicro(clone.initialFunds, 'initialFunds');

  for (const l of clone.listings) {
    if (!l || typeof l !== 'object') fail('Invalid listing record');
    if (!Array.isArray(l.packages)) fail('listing.packages must be an array');
    for (const p of l.packages) {
      if (!p || typeof p !== 'object') fail('Invalid package record');
      requireMicro(p.price, 'listing.packages[].price');
    }
    if (l.kind === 'goods') {
      requireMicro(l.shipping, 'listing.shipping');
    }
  }

  for (const o of clone.orders) {
    if (!o || typeof o !== 'object') fail('Invalid order record');
    if (o.token !== DEMO_TOKENS.USDC) fail('Invalid order.token');
    if (!Array.isArray(o.milestones)) fail('order.milestones must be an array');
    for (const m of o.milestones) {
      if (!m || typeof m !== 'object') fail('Invalid milestone record');
      requireMicro(m.originalAmount, 'milestone.originalAmount');
      requireMicro(m.held, 'milestone.held');
      requireMicro(m.reserve, 'milestone.reserve');
      requireMicro(m.sellerPaid, 'milestone.sellerPaid');
      requireMicro(m.buyerRefunded, 'milestone.buyerRefunded');
      requireMicro(m.feePaid, 'milestone.feePaid');
    }
  }

  for (const b of clone.briefs) {
    if (!b || typeof b !== 'object') fail('Invalid brief record');
    requireMicro(b.budget, 'brief.budget');
    if (!Array.isArray(b.proposals)) fail('brief.proposals must be an array');
    for (const p of b.proposals) {
      if (!p || typeof p !== 'object') fail('Invalid proposal record');
      requireMicro(p.amount, 'proposal.amount');
    }
  }

  // Scalar conservation check
  let userSum = 0n;
  for (const u of clone.users) {
    userSum += BigInt(u.balance);
  }
  let treasurySum = BigInt(clone.treasury.commission) + BigInt(clone.treasury.disputeFees);
  let orderSum = 0n;
  for (const o of clone.orders) {
    for (const m of o.milestones) {
      orderSum += BigInt(m.held) + BigInt(m.reserve);
    }
  }
  const total = userSum + treasurySum + orderSum;
  if (total !== BigInt(clone.initialFunds)) {
    fail('Conservation invariant violated');
  }

  // Convert users
  for (const u of clone.users) {
    const old = u.balance;
    u.balances = { USDC: old, USDT: '0' };
    delete u.balance;
  }

  // Convert treasury
  const commission = clone.treasury.commission;
  const disputeFees = clone.treasury.disputeFees;
  delete clone.treasury.commission;
  delete clone.treasury.disputeFees;
  clone.treasury.balances = {
    USDC: { commission, disputeFees },
    USDT: { commission: '0', disputeFees: '0' }
  };

  // Convert initialFunds
  const initialFunds = clone.initialFunds;
  clone.initialFundsByAsset = { USDC: initialFunds, USDT: '0' };
  delete clone.initialFunds;

  // Convert listings
  for (const l of clone.listings) {
    for (const p of l.packages) {
      const old = p.price;
      p.prices = { USDC: old };
      delete p.price;
    }
    if (l.kind === 'goods') {
      const old = l.shipping;
      l.shippingPrices = { USDC: old };
      delete l.shipping;
    }
  }

  // Convert orders
  for (const o of clone.orders) {
    o.asset = 'USDC';
  }

  // Convert briefs
  for (const b of clone.briefs) {
    b.asset = 'USDC';
    for (const p of b.proposals) {
      p.asset = 'USDC';
    }
  }

  // Reviewer rename
  for (const u of clone.users) {
    if (u.id === 'reviewer' && u.name === 'Pact Review Team') {
      u.name = 'Escrow Global Review Team';
      u.initials = 'EG';
    }
  }

  clone.schemaVersion = 3;
  if (clone.domainOffers === undefined) clone.domainOffers = [];

  assertInvariants(clone);

  return clone;
}

export function migrateState(input) {
  try {
    return migrateUnchecked(input);
  } catch (e) {
    const msg = e && typeof e.message === 'string' && e.message
      ? e.message
      : 'unknown error';
    throw new DomainError('Saved sandbox data could not be migrated: ' + msg, 'MIGRATION_ERROR');
  }
}
