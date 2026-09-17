import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Small append-only operation journal for the local server.
 *
 * This is deliberately independent from the JSON read model. Each line is
 * hash-linked and includes the resulting state hash, so an operator can tell
 * whether the read model and the recorded command history agree. It is an
 * audit/reconciliation aid, not a substitute for a database WAL or an
 * on-chain indexer.
 */

export function canonicalJSON(value) {
  if (value === null) return 'null';
  if (typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Journal values must be finite JSON numbers.');
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol' || value === undefined) throw new TypeError('Journal values must be JSON-safe primitives.');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError('Journal arrays cannot be sparse.');
      items.push(canonicalJSON(value[index]));
    }
    return `[${items.join(',')}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Journal values must be plain objects.');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJSON(value)).digest('hex');
}

export function stateHash(state) {
  return sha256(state);
}

function readRecords(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) {
      const wrapped = new Error(`Journal line ${index + 1} is not valid JSON.`);
      wrapped.code = 'JOURNAL_CORRUPT';
      throw wrapped;
    }
  });
}

function withoutHash(record) {
  const { hash, ...payload } = record;
  return payload;
}

export class OperationJournal {
  constructor(file) {
    if (typeof file !== 'string' || !file.trim()) throw new Error('Journal file is required.');
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try { fs.chmodSync(path.dirname(this.file), 0o700); } catch {}
    if (!fs.existsSync(this.file)) {
      const fd = fs.openSync(this.file, 'wx', 0o600);
      fs.closeSync(fd);
    }
    try { fs.chmodSync(this.file, 0o600); } catch {}
    this.lockFile = `${this.file}.lock`;
  }

  withMutationLock(fn) {
    const waitCell = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 2_000;
    let fd;
    while (fd === undefined) {
      try {
        fd = fs.openSync(this.lockFile, 'wx', 0o600);
      } catch (error) {
        if (error?.code !== 'EEXIST' || Date.now() >= deadline) {
          const busy = new Error('Operation journal is busy or has a stale mutation lock.');
          busy.code = 'JOURNAL_BUSY';
          throw busy;
        }
        Atomics.wait(waitCell, 0, 0, 10);
      }
    }
    try { return fn(); } finally {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(this.lockFile); } catch {}
    }
  }

  verify() {
    let records;
    try { records = readRecords(this.file); } catch (error) {
      return { valid: false, entries: 0, lastHash: null, error: error.message, code: error.code || 'JOURNAL_CORRUPT' };
    }
    let previous = 'GENESIS';
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record || typeof record !== 'object' || Array.isArray(record)) return {
        valid: false, entries: records.length, lastHash: previous === 'GENESIS' ? null : previous,
        error: `Journal record ${index + 1} is not an object.`, code: 'JOURNAL_CORRUPT'
      };
      const expected = sha256(withoutHash(record));
      if (record.schema !== 'operation-journal-v1' || record.sequence !== index + 1 || record.prevHash !== previous || record.hash !== expected) {
        return {
          valid: false,
          entries: records.length,
          lastHash: previous === 'GENESIS' ? null : previous,
          error: `Journal hash chain failed at line ${index + 1}.`,
          code: 'JOURNAL_CORRUPT'
        };
      }
      previous = record.hash;
    }
    return { valid: true, entries: records.length, lastHash: records.at(-1)?.hash || null, error: null, code: null };
  }

  appendUnlocked(event = {}) {
    const health = this.verify();
    if (!health.valid) {
      const error = new Error(health.error || 'Journal is corrupt.');
      error.code = 'JOURNAL_CORRUPT';
      throw error;
    }
    const record = {
      schema: 'operation-journal-v1',
      sequence: health.entries + 1,
      prevHash: health.lastHash || 'GENESIS',
      at: event.at || new Date().toISOString(),
      kind: event.kind || 'state.commit',
      actorId: event.actorId ?? null,
      command: event.command ?? null,
      idempotencyKey: event.idempotencyKey ?? null,
      result: event.result ?? null,
      stateVersion: event.stateVersion ?? null,
      stateHash: event.stateHash ?? null
    };
    record.hash = sha256(record);
    const line = `${canonicalJSON(record)}\n`;
    const fd = fs.openSync(this.file, 'a', 0o600);
    try {
      fs.writeSync(fd, line, null, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return record;
  }

  append(event = {}) {
    return this.withMutationLock(() => this.appendUnlocked(event));
  }

  /**
   * Record verified custody evidence exactly once for this local process. The
   * journal is hash-linked and append-only; a retry with the same operationId
   * returns the original record, while a different payload fails closed.
   * Production deployments still need a transactional durable store with a
   * unique operationId constraint across workers.
   */
  appendIdempotentEvidence(evidence) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || typeof evidence.operationId !== 'string' || evidence.operationId.trim() === '') {
      throw new Error('Verified custody evidence requires an operationId.');
    }
    return this.withMutationLock(() => {
      const health = this.verify();
      if (!health.valid) {
        const error = new Error(health.error || 'Journal is corrupt.');
        error.code = 'JOURNAL_CORRUPT';
        throw error;
      }
      const existing = readRecords(this.file).find(record => record.kind === 'custody.funding.verified' && record.result?.operationId === evidence.operationId);
      if (existing) {
        if (canonicalJSON(existing.result) !== canonicalJSON(evidence)) {
          const error = new Error('The operationId is already bound to different custody evidence.');
          error.code = 'JOURNAL_IDEMPOTENCY_CONFLICT';
          throw error;
        }
        return existing;
      }
      return this.appendUnlocked({ kind: 'custody.funding.verified', result: evidence });
    });
  }

  /** Find a previously committed custody-evidence result without trusting a
   * caller-provided replay flag. The read is serialized with writers so a
   * worker cannot observe a partial append while deciding whether to query
   * the chain again. */
  findCustodyEvidence(operationId) {
    if (typeof operationId !== 'string' || operationId.trim() === '') throw new Error('operationId is required.');
    return this.withMutationLock(() => {
      const health = this.verify();
      if (!health.valid) {
        const error = new Error(health.error || 'Journal is corrupt.');
        error.code = 'JOURNAL_CORRUPT';
        throw error;
      }
      return readRecords(this.file).find(record => record.kind === 'custody.funding.verified' && record.result?.operationId === operationId) || null;
    });
  }

  rows(limit = 100) {
    return this.page(limit).rows;
  }

  page(limit = 100, before = null) {
    const health = this.verify();
    if (!health.valid) {
      const error = new Error(health.error || 'Journal is corrupt.');
      error.code = 'JOURNAL_CORRUPT';
      throw error;
    }
    if (limit === null || limit === undefined || limit === '') limit = 100;
    if (!/^\d+$/.test(String(limit)) || Number(limit) < 1 || Number(limit) > 500) throw new Error('Journal limit must be an integer from 1 to 500.');
    const count = Number(limit);
    if (before !== null && (!/^\d+$/.test(String(before)) || Number(before) < 1 || Number(before) > health.entries + 1)) throw new Error('Journal cursor is invalid.');
    const cursor = before === null || before === undefined || before === '' ? health.entries + 1 : Number(before);
    const rows = readRecords(this.file).filter(record => record.sequence < cursor).slice(-count).reverse();
    const nextCursor = rows.at(-1)?.sequence ?? null;
    return { rows, nextCursor, hasMore: nextCursor !== null && nextCursor > 1 };
  }
}
