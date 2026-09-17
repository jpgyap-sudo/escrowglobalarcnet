/**
 * Coordinate verified finalized account projection into durable storage.
 *
 * The account projector is intentionally a small, non-signing composition
 * boundary. The pure projector performs the complete identity/PDA/layout/
 * ledger checks; the injected repository owns the database transaction. This
 * module does not fetch RPC data, accept browser assertions as proof, or
 * retry a stale projection.
 */
import { projectFinalizedAccountSnapshot } from './account-projection.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireEvidence(input) {
  if (!plain(input)) throw new Error('A finalized account evidence envelope is required.');
  if (input.finalized !== true) throw new Error('Only finalized account evidence can be projected.');
  if (input.pdaBindingsVerified !== true) throw new Error('Only PDA-verified account evidence can be projected.');
  if (input.kind !== 'v1' && input.kind !== 'v2') throw new Error('Account evidence kind must be v1 or v2.');
}

function requireResult(result, protocolVersion) {
  if (!plain(result) || typeof result.agreementApplied !== 'boolean' || !Array.isArray(result.milestoneApplied)) {
    throw new Error('The projection repository returned an invalid application result.');
  }
  const expectedMilestoneCount = protocolVersion === 'v2' ? 1 : 0;
  if (result.milestoneApplied.length !== expectedMilestoneCount || result.milestoneApplied.some(value => typeof value !== 'boolean')) {
    throw new Error('The projection repository returned an invalid milestone application result.');
  }
  const applied = (result.agreementApplied ? 1 : 0) + result.milestoneApplied.filter(Boolean).length;
  const rows = 1 + expectedMilestoneCount;
  return Object.freeze({
    agreementApplied: result.agreementApplied,
    milestoneApplied: Object.freeze([...result.milestoneApplied]),
    applied,
    stale: rows - applied,
    complete: applied === rows
  });
}

/**
 * @param {object} options
 * @param {{persist: Function}} options.repository
 * @param {Function} [options.project] test-only projector override
 */
export function createFinalizedAccountProjector({ repository, project = projectFinalizedAccountSnapshot } = {}) {
  if (!plain(repository) || typeof repository.persist !== 'function') throw new Error('A projection repository with persist() is required.');
  if (typeof project !== 'function') throw new Error('The account projector must be a function.');

  return Object.freeze({
    async projectAndPersist(input, persistOptions = undefined) {
      requireEvidence(input);
      const snapshot = project(input);
      if (!plain(snapshot) || !plain(snapshot.agreement)) throw new Error('The account projector returned no agreement row.');
      const protocolVersion = snapshot.agreement.protocol_version;
      if (protocolVersion !== 'v1' && protocolVersion !== 'v2') throw new Error('The account projector returned an invalid protocol version.');
      if (protocolVersion === 'v2' && !plain(snapshot.milestone)) throw new Error('The V2 account projector returned no milestone row.');
      if (protocolVersion === 'v1' && (!Array.isArray(snapshot.milestones) || snapshot.milestones.length !== 0)) throw new Error('The V1 account projector returned unexpected milestone rows.');

      // One repository call is the atomicity boundary. The PostgreSQL
      // implementation persists a V2 parent and milestone in one transaction;
      // this coordinator never splits that operation or retries a stale row.
      const result = await repository.persist(snapshot, persistOptions);
      return requireResult(result, protocolVersion);
    }
  });
}

export default createFinalizedAccountProjector;
