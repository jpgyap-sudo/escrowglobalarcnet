/**
 * Escrow Global — settlement asset registry. SANDBOX ONLY.
 * All balances are simulated integer micro-unit strings (6 decimals).
 * No real mint addresses, custody, or transfers exist in this model.
 */
export const ASSET_CODES = Object.freeze(['USDC', 'USDT']);

export const DEMO_TOKENS = Object.freeze({
  USDC: 'DEMO_USDC_6_DECIMALS_NO_REAL_MINT',
  USDT: 'DEMO_USDT_6_DECIMALS_NO_REAL_MINT'
});

export function isAsset(value) {
  return typeof value === 'string' && ASSET_CODES.includes(value);
}

export function assertAsset(value, label = 'asset') {
  if (!isAsset(value)) {
    const err = new Error(`${label} must be one of ${ASSET_CODES.join(', ')}.`);
    err.code = 'INVALID_ASSET';
    throw err;
  }
  return value;
}

export function emptyBalances() {
  return { USDC: '0', USDT: '0' };
}

export function emptyTreasuryBalances() {
  return {
    USDC: { commission: '0', disputeFees: '0' },
    USDT: { commission: '0', disputeFees: '0' }
  };
}

export function emptyInitialFunds() {
  return { USDC: '0', USDT: '0' };
}
