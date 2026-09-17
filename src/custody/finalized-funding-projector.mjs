/**
 * Join the finalized funding verifier to durable account projection.
 *
 * `reconcileFundingOnRpc()` remains the transaction/evidence gate. Once its
 * result is verified, this adapter loads the corresponding finalized raw
 * accounts and delegates the single repository transaction to the account
 * projector. It never signs, broadcasts, accepts browser finality, or lets a
 * caller replace the verified funding slot/vault binding.
 */
import { loadFinalizedProjectionInput } from './solana-reconciliation.mjs';
import { createFinalizedAccountProjector } from './finalized-account-projector.mjs';
import { base58Decode, base58Encode } from '../payments.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message) => Object.freeze({ ok: false, code, message });
const signature = value => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 128) return false;
  try { const bytes = base58Decode(value); return bytes.length === 64 && base58Encode(bytes) === value; } catch { return false; }
};

export const FINALIZED_FUNDING_PROJECTION_ERRORS = Object.freeze({
  INVALID_EVIDENCE: 'INVALID_EVIDENCE',
  INVALID_LOADER: 'INVALID_LOADER',
  EVIDENCE_MISMATCH: 'EVIDENCE_MISMATCH',
  PROJECTION_FAILED: 'PROJECTION_FAILED'
});

function requireEvidence({ evidence, intent, vault }) {
  if (!plain(evidence) || !plain(intent) || !signature(evidence.signature) || !/^[a-f0-9]{64}$/.test(evidence.intentHash || '') || evidence.intentHash !== intent.intentHash || !/^(0|[1-9]\d*)$/.test(evidence.amount || '') || evidence.status !== 'finalized' || evidence.pdaBindingsVerified !== true || !Number.isSafeInteger(evidence.slot) || evidence.slot < 0 || evidence.vault !== vault) {
    return failure(FINALIZED_FUNDING_PROJECTION_ERRORS.INVALID_EVIDENCE, 'Finalized projection requires verified evidence with a safe slot, PDA proof and the exact vault binding.');
  }
  return null;
}

/**
 * Create a non-signing bridge from verified funding evidence to account
 * projection. The loader and repository remain dependency-injected so tests
 * and production can choose their own RPC/database adapters.
 */
export function createFinalizedFundingProjector({ repository, loadInput = loadFinalizedProjectionInput, projectAndPersist = undefined } = {}) {
  if (typeof loadInput !== 'function') throw new Error('A finalized projection loader is required.');
  const persist = projectAndPersist || createFinalizedAccountProjector({ repository });
  if (!persist || typeof persist.projectAndPersist !== 'function') throw new Error('A finalized account projector is required.');
  return Object.freeze({
    async projectVerifiedFunding({ intent, deployment, agreementAddress, milestoneAddress, vault, rpc, evidence, persistOptions } = {}) {
      const evidenceError = requireEvidence({ evidence, intent, vault });
      if (evidenceError) return evidenceError;
      let loaded;
      try {
        loaded = await loadInput({ intent, rpc, deployment, agreementAddress, milestoneAddress, vault, transactionSlot: evidence.slot });
      } catch (error) {
        return failure(FINALIZED_FUNDING_PROJECTION_ERRORS.PROJECTION_FAILED, error instanceof Error ? error.message : 'Finalized account projection loading failed.');
      }
      if (!plain(loaded) || typeof loaded.ok !== 'boolean') return failure(FINALIZED_FUNDING_PROJECTION_ERRORS.INVALID_LOADER, 'The finalized projection loader returned an invalid result.');
      if (!loaded.ok) return loaded;
      if (!plain(loaded.value) || typeof loaded.value.vaultAmount !== 'string' || !/^(0|[1-9]\d*)$/.test(loaded.value.vaultAmount)) return failure(FINALIZED_FUNDING_PROJECTION_ERRORS.EVIDENCE_MISMATCH, 'The finalized vault amount is not a canonical token-unit value.');
      try {
        if (BigInt(loaded.value.vaultAmount) < BigInt(evidence.amount)) return failure(FINALIZED_FUNDING_PROJECTION_ERRORS.EVIDENCE_MISMATCH, 'The finalized vault balance is below the verified funding amount.');
      } catch {
        return failure(FINALIZED_FUNDING_PROJECTION_ERRORS.EVIDENCE_MISMATCH, 'The finalized vault amount is not a valid token-unit value.');
      }
      try {
        const result = await persist.projectAndPersist(loaded.value, persistOptions);
        return Object.freeze({ ok: true, value: result });
      } catch (error) {
        return failure(FINALIZED_FUNDING_PROJECTION_ERRORS.PROJECTION_FAILED, error instanceof Error ? error.message : 'Finalized account projection persistence failed.');
      }
    }
  });
}

export default createFinalizedFundingProjector;
