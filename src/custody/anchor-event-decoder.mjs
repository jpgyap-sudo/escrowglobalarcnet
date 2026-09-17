/**
 * Dependency-free Anchor `Program data:` event decoder for the generated IDL.
 * It accepts only declared event discriminators and Borsh types, binds each
 * event to the outer custody instruction active in the log, rejects nested
 * self-invocation (which would make log provenance ambiguous), and rejects
 * unknown, truncated, or trailing bytes. Finality remains the indexer's job.
 */
import { base58Encode } from '../payments.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

export class AnchorEventDecodeError extends Error {
  constructor(message) { super(message); this.name = 'AnchorEventDecodeError'; }
}

class Reader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  take(length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) throw new AnchorEventDecodeError('Anchor event data is truncated.');
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  u8() { return this.take(1)[0]; }
  u16() { const b = this.take(2); return b[0] | (b[1] << 8); }
  u64() { let value = 0n; for (let index = 0; index < 8; index++) value |= BigInt(this.take(1)[0]) << BigInt(index * 8); return value.toString(); }
  i64() { const unsigned = BigInt(this.u64()); return (unsigned >= (1n << 63n) ? unsigned - (1n << 64n) : unsigned).toString(); }
  bool() { const value = this.u8(); if (value > 1) throw new AnchorEventDecodeError('Anchor event boolean is not canonical.'); return value === 1; }
  get remaining() { return this.bytes.length - this.offset; }
}

function discriminatorKey(value) {
  if (!Array.isArray(value) || value.length !== 8 || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new AnchorEventDecodeError('IDL event discriminator is malformed.');
  return value.join(',');
}

function decodeType(reader, spec, definitions) {
  if (typeof spec === 'string') {
    if (spec === 'u8') return reader.u8();
    if (spec === 'u16') return reader.u16();
    if (spec === 'u64') return reader.u64();
    if (spec === 'i64') return reader.i64();
    if (spec === 'bool') return reader.bool();
    if (spec === 'pubkey') return base58Encode(reader.take(32));
    throw new AnchorEventDecodeError(`Unsupported Anchor event type: ${spec}`);
  }
  if (!plain(spec)) throw new AnchorEventDecodeError('Anchor event type specification is malformed.');
  if (Array.isArray(spec.array) && spec.array.length === 2) {
    const [itemType, count] = spec.array;
    if (!Number.isSafeInteger(count) || count < 0 || count > 1024) throw new AnchorEventDecodeError('Anchor event array length is unsafe.');
    const values = Array.from({ length: count }, () => decodeType(reader, itemType, definitions));
    return itemType === 'u8' ? values.map(value => value.toString(16).padStart(2, '0')).join('') : values;
  }
  if (plain(spec.defined) && text(spec.defined.name)) {
    const definition = definitions.get(spec.defined.name);
    if (!definition || !plain(definition.type) || !text(definition.type.kind)) throw new AnchorEventDecodeError(`Anchor event type definition is missing or malformed: ${spec.defined.name}`);
    const type = definition.type;
    if (type.kind === 'struct') {
      if (!Array.isArray(type.fields)) throw new AnchorEventDecodeError('Anchor event struct fields are malformed.');
      return Object.fromEntries(type.fields.map(field => {
        if (!plain(field) || !text(field.name)) throw new AnchorEventDecodeError('Anchor event field is malformed.');
        return [field.name, decodeType(reader, field.type, definitions)];
      }));
    }
    if (type.kind === 'enum') {
      if (!Array.isArray(type.variants)) throw new AnchorEventDecodeError('Anchor event enum variants are malformed.');
      const variant = type.variants[reader.u8()];
      if (!plain(variant) || !text(variant.name)) throw new AnchorEventDecodeError('Anchor event enum discriminant is invalid.');
      if (!Array.isArray(variant.fields) || variant.fields.length === 0) return variant.name;
      return { variant: variant.name, fields: variant.fields.map(field => decodeType(reader, field.type || field, definitions)) };
    }
  }
  throw new AnchorEventDecodeError('Unsupported Anchor event type specification.');
}

export function createAnchorEventDecoder({ idl, programId } = {}) {
  if (!plain(idl) || !Array.isArray(idl.events) || !Array.isArray(idl.types) || !text(programId)) throw new Error('An Anchor IDL with events, types and programId is required.');
  const events = new Map(idl.events.map(event => [discriminatorKey(event.discriminator), event]));
  if (events.size !== idl.events.length || idl.events.some(event => !text(event.name))) throw new Error('Anchor IDL event names or discriminators are not unique.');
  const definitions = new Map(idl.types.filter(type => plain(type) && text(type.name)).map(type => [type.name, type]));
  if (definitions.size !== idl.types.filter(type => plain(type) && text(type.name)).length) throw new Error('Anchor IDL type names are not unique.');

  return Object.freeze(({ transaction, network, signature, slot }) => {
    const logs = transaction?.meta?.logMessages;
    const instructions = transaction?.transaction?.message?.instructions;
    if (!Array.isArray(logs) || logs.some(log => typeof log !== 'string') || !Array.isArray(instructions)) throw new AnchorEventDecodeError('Finalized transaction logs or instructions are missing.');
    const custodyIndexes = instructions.map((instruction, index) => instruction?.programId === programId ? index : -1).filter(index => index >= 0);
    const invoke = `Program ${programId} invoke [1]`;
    let currentInstruction = null;
    let nextInvocation = 0;
    const result = [];
    for (const log of logs) {
      if (log.startsWith(`Program ${programId} invoke [`)) {
        if (log !== invoke) throw new AnchorEventDecodeError('Nested custody-program invocation is outside the outer-instruction event boundary.');
      }
      if (log === invoke) { currentInstruction = custodyIndexes[nextInvocation++] ?? null; continue; }
      if (currentInstruction !== null && log === `Program ${programId} success`) { currentInstruction = null; continue; }
      if (currentInstruction === null || !log.startsWith('Program data: ')) continue;
      const encoded = log.slice('Program data: '.length);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new AnchorEventDecodeError('Anchor event log is not canonical base64.');
      const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
      if (Buffer.from(bytes).toString('base64') !== encoded) throw new AnchorEventDecodeError('Anchor event log base64 is not canonical.');
      const event = events.get(Array.from(bytes.slice(0, 8)).join(','));
      if (!event) throw new AnchorEventDecodeError('Unknown Anchor event emitted by the custody program.');
      const definition = definitions.get(event.name);
      if (!definition) throw new AnchorEventDecodeError(`IDL has no type definition for event ${event.name}.`);
      const reader = new Reader(bytes.slice(8));
      const payload = decodeType(reader, { defined: { name: event.name } }, definitions);
      if (reader.remaining !== 0) throw new AnchorEventDecodeError(`Anchor event ${event.name} contains trailing bytes.`);
      result.push({ network, signature, instructionIndex: currentInstruction, slot, programId, eventType: event.name, payload });
    }
    return result;
  });
}
