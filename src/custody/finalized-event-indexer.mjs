/**
 * Finalized-only event ingestion boundary for the custody projection.
 *
 * This module discovers candidate signatures through getSignaturesForAddress,
 * then independently checks status and fetches the transaction at finalized
 * commitment. A program-specific decoder is injected because Anchor event
 * layouts are ABI-dependent. The decoder is not trusted to establish
 * finality: its output is admitted only after the transaction and instruction
 * bindings pass the checks below.
 *
 * No wallet, signer, broadcaster, or private key is imported here.
 */
import { FINALIZED_STATUS } from './reconciliation.mjs';
import { base58Decode, base58Encode } from '../payments.mjs';

export const FINALIZED_EVENT_ERRORS = Object.freeze({
  INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',
  INVALID_RPC: 'INVALID_RPC',
  NOT_FINALIZED: 'NOT_FINALIZED',
  FAILED_TRANSACTION: 'FAILED_TRANSACTION',
  MISSING_TRANSACTION: 'MISSING_TRANSACTION',
  MALFORMED_TRANSACTION: 'MALFORMED_TRANSACTION',
  MALFORMED_EVENT: 'MALFORMED_EVENT',
  REPOSITORY_ERROR: 'REPOSITORY_ERROR',
  SCAN_PARTIAL_FAILURE: 'SCAN_PARTIAL_FAILURE'
});

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const text = value => typeof value === 'string' && value.trim().length > 0;
const SUPPORTED_NETWORKS = new Set(['devnet', 'testnet', 'mainnet-beta']);
const address = value => {
  if (!text(value)) return false;
  try { const bytes = base58Decode(value); return bytes.length === 32 && bytes.some(byte => byte !== 0) && base58Encode(bytes) === value; } catch { return false; }
};
const safeSlot = value => Number.isSafeInteger(value) && value >= 0;
const failure = (code, message, details = undefined) => ({ ok: false, code, message, ...(details === undefined ? {} : { details }) });

function jsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return plain(value) && Object.keys(value).every(key => jsonValue(value[key]));
}

function transactionMessage(transaction) {
  return transaction?.transaction?.message || transaction?.message;
}

function transactionSignatures(transaction) {
  return transaction?.transaction?.signatures || transaction?.signatures;
}

function custodyInstructionIndexes(transaction, programId) {
  const message = transactionMessage(transaction);
  const instructions = Array.isArray(message?.instructions) ? message.instructions : null;
  if (!instructions) return null;
  return instructions.map((instruction, index) => instruction?.programId === programId ? index : -1).filter(index => index >= 0);
}

function validSignature(value) {
  if (!text(value) || value.length > 128) return false;
  try { const bytes = base58Decode(value); return bytes.length === 64 && base58Encode(bytes) === value; } catch { return false; }
}

function validObservedAt(value) {
  if (value === undefined) return true;
  if (typeof value !== 'string' || value.length > 64) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validCursorKey({ network, deploymentId, address: scanAddress }) {
  return SUPPORTED_NETWORKS.has(network) && text(deploymentId) && deploymentId.length <= 128 && address(scanAddress);
}

function validEvent(event) {
  return plain(event) && text(event.deploymentId) && event.deploymentId.length <= 128 && SUPPORTED_NETWORKS.has(event.network) && address(event.programId)
    && validSignature(event.signature) && Number.isSafeInteger(event.instructionIndex) && event.instructionIndex >= 0
    && Number.isSafeInteger(event.eventIndex) && event.eventIndex >= 0 && event.eventIndex < 64
    && safeSlot(event.slot) && text(event.eventType) && event.eventType.length <= 128
    && plain(event.payload) && jsonValue(event.payload) && typeof event.observedAt === 'string'
    && validObservedAt(event.observedAt);
}

function validCursor(cursor) {
  return plain(cursor) && validCursorKey(cursor) && (cursor.beforeSignature === null || validSignature(cursor.beforeSignature))
    && (cursor.lastScannedSlot === null || safeSlot(cursor.lastScannedSlot)) && typeof cursor.exhausted === 'boolean'
    && (!cursor.exhausted || cursor.beforeSignature === null) && typeof cursor.updatedAt === 'string' && validObservedAt(cursor.updatedAt);
}

function normalizeStoredCursor(row, key) {
  if (!plain(row) || row.network !== key.network || row.deployment_id !== key.deploymentId || !address(key.address) || !Buffer.isBuffer(row.address) || row.address.length !== 32 || !validSignature(row.before_signature) && row.before_signature !== null || (row.last_scanned_slot !== null && (!/^(0|[1-9]\d*)$/.test(String(row.last_scanned_slot)) || BigInt(row.last_scanned_slot) > BigInt(Number.MAX_SAFE_INTEGER))) || typeof row.exhausted !== 'boolean' || typeof row.updated_at !== 'string' || !validObservedAt(row.updated_at)) throw new Error('The durable custody cursor is malformed.');
  const storedAddress = base58Decode(key.address);
  if (!Buffer.from(storedAddress).equals(row.address)) throw new Error('The durable custody cursor address does not match the requested scan address.');
  const lastScannedSlot = row.last_scanned_slot === null ? null : Number(row.last_scanned_slot);
  if (row.exhausted && row.before_signature !== null) throw new Error('An exhausted custody cursor cannot retain a continuation signature.');
  return Object.freeze({ network: row.network, deploymentId: row.deployment_id, address: key.address, beforeSignature: row.before_signature, lastScannedSlot, exhausted: row.exhausted, updatedAt: row.updated_at });
}

function validateEvents(events, { deploymentId, network, programId, signature, slot, transaction }) {
  if (!Array.isArray(events) || events.length > 64) return failure(FINALIZED_EVENT_ERRORS.MALFORMED_EVENT, 'The event decoder must return at most 64 events.');
  const indexes = custodyInstructionIndexes(transaction, programId);
  if (!indexes) return failure(FINALIZED_EVENT_ERRORS.MALFORMED_TRANSACTION, 'The finalized transaction has no decodable outer instruction list.');
  const allowed = new Set(indexes);
  const seen = new Set();
  for (const [eventPosition, event] of events.entries()) {
    const eventIndex = event?.eventIndex === undefined ? eventPosition : event.eventIndex;
    if (!plain(event) || (event.deploymentId !== undefined && event.deploymentId !== deploymentId) || event.network !== network || event.programId !== programId || event.signature !== signature || event.slot !== slot || !Number.isSafeInteger(event.instructionIndex) || event.instructionIndex < 0 || !allowed.has(event.instructionIndex) || !Number.isSafeInteger(eventIndex) || eventIndex !== eventPosition || eventIndex < 0 || eventIndex >= 64 || seen.has(`${event.instructionIndex}:${eventIndex}`) || !text(event.eventType) || event.eventType.length > 128 || !plain(event.payload) || !jsonValue(event.payload) || !validObservedAt(event.observedAt)) {
      return failure(FINALIZED_EVENT_ERRORS.MALFORMED_EVENT, 'Decoded events must bind exactly to finalized custody instructions and JSON-safe payloads.');
    }
    seen.add(`${event.instructionIndex}:${eventIndex}`);
  }
  return { ok: true, value: Object.freeze(events.map((event, index) => Object.freeze({
    deploymentId,
    network: event.network,
    programId: event.programId,
    signature: event.signature,
    instructionIndex: event.instructionIndex,
    eventIndex: event.eventIndex === undefined ? index : event.eventIndex,
    slot: event.slot,
    eventType: event.eventType,
    payload: event.payload,
    observedAt: event.observedAt
  })))};
}

function observedAt(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('clock must return a valid Date');
  return value.toISOString();
}

export function createPostgresCustodyEventRepository({ db, deploymentId: configuredDeploymentId, network: configuredNetwork, programId: configuredProgramId } = {}) {
  if (!db || typeof db.transaction !== 'function' || typeof db.query !== 'function') throw new Error('A PostgreSQL adapter with query and transaction is required.');
  if (!text(configuredDeploymentId) || configuredDeploymentId.length > 128 || !SUPPORTED_NETWORKS.has(configuredNetwork) || !address(configuredProgramId)) throw new Error('A bounded deployment ID, supported network and canonical custody program ID are required.');
  const create = queryable => Object.freeze({
    async insertChainEvent(event) {
      if (!validEvent(event) || event.deploymentId !== configuredDeploymentId || event.network !== configuredNetwork || event.programId !== configuredProgramId) throw new Error('The chain event is malformed or is not bound to the configured deployment custody program.');
      const result = await queryable.query(
        `INSERT INTO custody_chain_events
          (deployment_id, network, program_id, signature, instruction_index, event_index, slot, event_type, payload, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
         ON CONFLICT (deployment_id, network, program_id, signature, instruction_index, event_index) DO NOTHING
         RETURNING deployment_id, network, program_id, signature, instruction_index, event_index`,
        [event.deploymentId, event.network, Buffer.from(base58Decode(event.programId)), event.signature, event.instructionIndex, event.eventIndex, event.slot, event.eventType, JSON.stringify(event.payload), event.observedAt]
      );
      return { inserted: Array.isArray(result?.rows) && result.rows.length === 1 };
    },
    async saveCursor(cursor) {
      if (!validCursor(cursor) || cursor.deploymentId !== configuredDeploymentId || cursor.network !== configuredNetwork) throw new Error('The durable cursor is malformed or is not bound to the configured deployment network.');
      await queryable.query(
        `INSERT INTO custody_indexer_cursors
          (network, deployment_id, address, before_signature, last_scanned_slot, exhausted, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (network, deployment_id, address) DO UPDATE SET
           before_signature = EXCLUDED.before_signature,
           last_scanned_slot = EXCLUDED.last_scanned_slot,
           exhausted = EXCLUDED.exhausted,
           updated_at = EXCLUDED.updated_at`,
        [cursor.network, cursor.deploymentId, Buffer.from(base58Decode(cursor.address)), cursor.beforeSignature || null, cursor.lastScannedSlot ?? null, cursor.exhausted === true, cursor.updatedAt]
      );
      return cursor;
    }
  });
  return Object.freeze({
    async withTransaction(work) {
      if (typeof work !== 'function') throw new Error('A transaction callback is required.');
      return db.transaction(async client => work(create(client)));
    },
    async loadCursor({ network: requestedNetwork, deploymentId, address: scanAddress } = {}) {
      if (requestedNetwork !== configuredNetwork || deploymentId !== configuredDeploymentId || !validCursorKey({ network: requestedNetwork, deploymentId, address: scanAddress })) throw new Error('Configured deployment, network and scan address are required to load a custody cursor.');
      const result = await db.query(
        CURSOR_SELECT_SQL,
        [requestedNetwork, deploymentId, Buffer.from(base58Decode(scanAddress))]
      );
      const row = Array.isArray(result?.rows) ? result.rows[0] : null;
      return row ? normalizeStoredCursor(row, { network: configuredNetwork, deploymentId, address: scanAddress }) : null;
    }
  });
}

export class FinalizedCustodyEventIndexer {
  constructor({ rpc, repository, deploymentId, network, programId, address: scanAddress, decodeEvents, clock = () => new Date() } = {}) {
    if (!rpc || typeof rpc.getSignatureStatuses !== 'function' || typeof rpc.getTransaction !== 'function' || typeof rpc.getSignaturesForAddress !== 'function') throw new Error('A read-only RPC adapter with signature discovery is required.');
    if (!repository || typeof repository.withTransaction !== 'function') throw new Error('An atomic event repository is required.');
    if (!text(deploymentId) || deploymentId.length > 128 || !SUPPORTED_NETWORKS.has(network) || !address(programId) || !address(scanAddress) || typeof decodeEvents !== 'function') throw new Error('A bounded deploymentId, supported network, programId, scan address and event decoder are required.');
    if (typeof clock !== 'function') throw new Error('A clock function is required.');
    this.rpc = rpc;
    this.repository = repository;
    this.deploymentId = deploymentId;
    this.network = network;
    this.programId = programId;
    this.address = scanAddress;
    this.decodeEvents = decodeEvents;
    this.clock = clock;
  }

  async ingestSignature(signature) {
    if (!validSignature(signature)) return failure(FINALIZED_EVENT_ERRORS.MALFORMED_TRANSACTION, 'A canonical 64-byte base58 transaction signature is required.');
    let statusResult;
    try { statusResult = await this.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }); } catch (error) { return failure(FINALIZED_EVENT_ERRORS.INVALID_RPC, error instanceof Error ? error.message : 'Signature status lookup failed.'); }
    const status = statusResult?.value?.[0];
    if (!status) return failure(FINALIZED_EVENT_ERRORS.MISSING_TRANSACTION, 'The signature is not available from the configured RPC.');
    if (status.err) return failure(FINALIZED_EVENT_ERRORS.FAILED_TRANSACTION, 'Failed transactions cannot contribute custody events.', { err: status.err });
    if (status.confirmationStatus !== FINALIZED_STATUS) return failure(FINALIZED_EVENT_ERRORS.NOT_FINALIZED, 'Only finalized transactions can contribute custody events.', { status: status.confirmationStatus || 'unknown' });
    let transaction;
    try { transaction = await this.rpc.getTransaction(signature, { commitment: FINALIZED_STATUS, encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }); } catch (error) { return failure(FINALIZED_EVENT_ERRORS.INVALID_RPC, error instanceof Error ? error.message : 'Finalized transaction lookup failed.'); }
    const message = transactionMessage(transaction);
    const signatures = transactionSignatures(transaction);
    if (!plain(transaction) || !plain(message) || !plain(transaction.meta) || transaction.meta.err !== null || !safeSlot(transaction.slot) || !Array.isArray(signatures) || !signatures.includes(signature)) return failure(FINALIZED_EVENT_ERRORS.MALFORMED_TRANSACTION, 'The finalized transaction lacks a successful slot and signature binding.');
    const indexes = custodyInstructionIndexes(transaction, this.programId);
    if (!indexes || indexes.length === 0) return failure(FINALIZED_EVENT_ERRORS.MALFORMED_TRANSACTION, 'The transaction does not invoke the configured custody program.');
    let events;
    try { events = await this.decodeEvents({ deploymentId: this.deploymentId, network: this.network, programId: this.programId, signature, slot: transaction.slot, transaction }); } catch (error) { return failure(FINALIZED_EVENT_ERRORS.MALFORMED_EVENT, error instanceof Error ? error.message : 'The event decoder failed.'); }
    const checked = validateEvents(events, { deploymentId: this.deploymentId, network: this.network, programId: this.programId, signature, slot: transaction.slot, transaction });
    if (!checked.ok) return checked;
    try {
      const persisted = await this.repository.withTransaction(async tx => {
        const rows = [];
        // A decoder-supplied timestamp is untrusted metadata. Finality is
        // slot/commitment based, and persistence time must come from this
        // worker's clock rather than RPC logs or event payloads.
        const indexedAt = observedAt(this.clock);
        for (const event of checked.value) rows.push(await tx.insertChainEvent({ ...event, observedAt: indexedAt }));
        return rows;
      });
      return Object.freeze({ ok: true, signature, slot: transaction.slot, eventCount: checked.value.length, persisted });
    } catch (error) {
      return failure(FINALIZED_EVENT_ERRORS.REPOSITORY_ERROR, error instanceof Error ? error.message : 'Finalized custody events could not be persisted.');
    }
  }

  async scan({ beforeSignature = undefined, limit = 100 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) return failure(FINALIZED_EVENT_ERRORS.INVALID_CONFIGURATION, 'Indexer page limit must be between 1 and 1000.');
    if (beforeSignature !== undefined && !validSignature(beforeSignature)) return failure(FINALIZED_EVENT_ERRORS.INVALID_CONFIGURATION, 'beforeSignature must be a canonical transaction signature.');
    let entries;
    try {
      entries = await this.rpc.getSignaturesForAddress(this.address, { commitment: FINALIZED_STATUS, limit, ...(beforeSignature ? { before: beforeSignature } : {}) });
    } catch (error) { return failure(FINALIZED_EVENT_ERRORS.INVALID_RPC, error instanceof Error ? error.message : 'Signature discovery failed.'); }
    if (!Array.isArray(entries) || entries.length > limit) return failure(FINALIZED_EVENT_ERRORS.MALFORMED_TRANSACTION, 'Signature discovery returned an invalid page.');
    const results = [];
    let lastScannedSlot = null;
    for (const entry of entries) {
      if (!plain(entry) || !validSignature(entry.signature) || !safeSlot(entry.slot)) return failure(FINALIZED_EVENT_ERRORS.MALFORMED_TRANSACTION, 'Signature discovery returned an invalid entry.');
      lastScannedSlot = lastScannedSlot === null ? entry.slot : Math.max(lastScannedSlot, entry.slot);
      if (entry.err) { results.push(Object.freeze({ ok: false, signature: entry.signature, code: FINALIZED_EVENT_ERRORS.FAILED_TRANSACTION, message: 'Failed transaction skipped.' })); continue; }
      const result = await this.ingestSignature(entry.signature);
      results.push(result);
      if (!result.ok) return failure(FINALIZED_EVENT_ERRORS.SCAN_PARTIAL_FAILURE, 'Signature page was not fully indexed; the cursor must not advance.', { results });
    }
    return Object.freeze({ ok: true, results, lastScannedSlot, exhausted: entries.length < limit, nextBeforeSignature: entries.length === limit ? entries.at(-1)?.signature || null : null });
  }

  /**
   * Persist a scan checkpoint only after every non-failed signature in the
   * page has been finalized, decoded, and durably inserted. A failed page is
   * intentionally retryable and leaves the prior checkpoint untouched.
   */
  async scanAndCommitCursor({ deploymentId, beforeSignature = undefined, limit = 100 } = {}) {
    if (!text(deploymentId) || deploymentId.length > 128 || deploymentId !== this.deploymentId) return failure(FINALIZED_EVENT_ERRORS.INVALID_CONFIGURATION, 'The durable scan cursor must use the indexer deploymentId.');
    const page = await this.scan({ beforeSignature, limit });
    if (!page.ok) return page;
    try {
      const cursor = { network: this.network, deploymentId, address: this.address, beforeSignature: page.nextBeforeSignature, lastScannedSlot: page.lastScannedSlot, exhausted: page.exhausted, updatedAt: observedAt(this.clock) };
      if (typeof this.repository.withTransaction !== 'function') throw new Error('An atomic event repository is required.');
      await this.repository.withTransaction(async tx => {
        if (typeof tx.saveCursor !== 'function') throw new Error('The repository does not support durable scan cursors.');
        await tx.saveCursor(cursor);
      });
      return Object.freeze({ ...page, cursor });
    } catch (error) {
      return failure(FINALIZED_EVENT_ERRORS.REPOSITORY_ERROR, error instanceof Error ? error.message : 'The finalized scan cursor could not be persisted.');
    }
  }

  /**
   * Resume from the durable cursor. An exhausted cursor is terminal for this
   * address history and must not be interpreted as a fresh scan with no
   * `before` value; doing so would repeatedly rediscover the newest page.
   */
  async resume({ deploymentId, limit = 100 } = {}) {
    if (!text(deploymentId) || deploymentId.length > 128 || deploymentId !== this.deploymentId) return failure(FINALIZED_EVENT_ERRORS.INVALID_CONFIGURATION, 'The durable scan cursor must use the indexer deploymentId.');
    if (typeof this.repository.loadCursor !== 'function') return failure(FINALIZED_EVENT_ERRORS.REPOSITORY_ERROR, 'The repository does not support durable cursor loading.');
    let cursor;
    try { cursor = await this.repository.loadCursor({ network: this.network, deploymentId, address: this.address }); }
    catch (error) { return failure(FINALIZED_EVENT_ERRORS.REPOSITORY_ERROR, error instanceof Error ? error.message : 'The finalized scan cursor could not be loaded.'); }
    if (cursor && (cursor.network !== this.network || cursor.deploymentId !== deploymentId || cursor.address !== this.address || typeof cursor.exhausted !== 'boolean')) return failure(FINALIZED_EVENT_ERRORS.REPOSITORY_ERROR, 'The loaded finalized scan cursor does not match the indexer.');
    if (cursor?.exhausted === true) return Object.freeze({ ok: true, resumed: false, exhausted: true, cursor });
    return this.scanAndCommitCursor({ deploymentId, ...(cursor?.beforeSignature ? { beforeSignature: cursor.beforeSignature } : {}), limit });
  }
}

export const CURSOR_SELECT_SQL = `SELECT network, deployment_id, address, before_signature, last_scanned_slot, exhausted, updated_at
           FROM custody_indexer_cursors
          WHERE network = $1 AND deployment_id = $2 AND address = $3`;
