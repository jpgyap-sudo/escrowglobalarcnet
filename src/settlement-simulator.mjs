/**
 * Educational settlement math only. It never authorizes, records, or moves funds.
 * Amounts are intentionally rounded to two decimal places for a readable demo.
 */
export const DEFAULT_FEE_BPS = 300;

const round = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateSettlement({ principal, releasePercent = 100, feeBps = DEFAULT_FEE_BPS } = {}) {
  const amount = Number(principal);
  const percent = Number(releasePercent);
  const bps = Number(feeBps);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) throw new Error('Principal must be between 0 and 1,000,000,000.');
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Release percentage must be between 0 and 100.');
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error('Fee basis points are invalid.');

  const reserve = round(amount * bps / 10_000);
  const releasedPrincipal = round(amount * percent / 100);
  const fee = round(reserve * percent / 100);
  const buyerRefund = round(amount - releasedPrincipal + reserve - fee);
  const totalFunded = round(amount + reserve);
  return Object.freeze({
    principal: round(amount), reserve, totalFunded, releasePercent: percent,
    releasedPrincipal, sellerPayout: releasedPrincipal, platformFee: fee,
    buyerRefund, heldAfterSettlement: round(totalFunded - releasedPrincipal - fee - buyerRefund),
    feeBps: bps, boundary: 'education-only:no-wallet:no-ledger:no-live-custody'
  });
}
