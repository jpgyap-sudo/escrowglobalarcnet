import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const programRoot = path.join(root, 'packages', 'custody-contracts', 'program');
const idlPath = path.join(programRoot, 'target', 'idl', 'escrow_global.json');
const typePath = path.join(programRoot, 'target', 'types', 'escrow_global.ts');

function parseBlocks(output) {
  const lines = output.split(/\r?\n/);
  let state = 'pass';
  let buffer = [];
  let address = '';
  let program;
  const events = [];
  const types = new Map();
  let errors = [];
  const constants = [];

  const finishJson = () => {
    const value = JSON.parse(buffer.join('\n'));
    buffer = [];
    return value;
  };

  for (const line of lines) {
    if (state === 'pass') {
      if (line === '--- IDL begin address ---') state = 'address';
      else if (line === '--- IDL begin const ---') { state = 'const'; buffer = []; }
      else if (line === '--- IDL begin event ---') { state = 'event'; buffer = []; }
      else if (line === '--- IDL begin errors ---') { state = 'errors'; buffer = []; }
      else if (line === '--- IDL begin program ---') { state = 'program'; buffer = []; }
      continue;
    }

    if (state === 'address') {
      address = line.replace(/[^a-zA-Z0-9]/g, '');
      state = 'pass';
      continue;
    }
    if (state === 'const') {
      if (line === '--- IDL end const ---') {
        constants.push(finishJson());
        state = 'pass';
      } else buffer.push(line);
      continue;
    }
    if (state === 'event') {
      if (line === '--- IDL end event ---') {
        const value = finishJson();
        events.push(value.event);
        for (const type of value.types ?? []) types.set(type.name, type);
        state = 'pass';
      } else buffer.push(line);
      continue;
    }
    if (state === 'errors') {
      if (line === '--- IDL end errors ---') {
        errors = finishJson();
        state = 'pass';
      } else buffer.push(line);
      continue;
    }
    if (state === 'program') {
      if (line === '--- IDL end program ---') {
        program = finishJson();
        for (const type of program.types ?? []) types.set(type.name, type);
        state = 'pass';
      } else buffer.push(line);
    }
  }

  if (!program) throw new Error('Anchor did not print a program IDL block.');
  program.address = address;
  program.constants = constants;
  program.events = events;
  program.errors = errors;
  program.types = [...types.values()];

  // Anchor removes Rust module prefixes when doing so is unambiguous.
  const stripModule = (value) => typeof value === 'string'
    ? value.replace(/\b[a-zA-Z0-9_]+::/g, '')
    : value;
  const normalized = JSON.parse(JSON.stringify(program, (_, value) => stripModule(value)));
  for (const key of ['accounts', 'constants', 'events', 'instructions', 'types']) {
    if (Array.isArray(normalized[key])) normalized[key].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return normalized;
}

function camel(value) {
  if (Array.isArray(value)) return value.map(camel);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, camel(item)]));
  }
  if (typeof value === 'string') return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  return value;
}

const logIndex = process.argv.indexOf('--log');
let output;
if (logIndex !== -1) {
  const logPath = process.argv[logIndex + 1];
  if (!logPath) throw new Error('--log requires a cargo test output file.');
  output = fs.readFileSync(path.resolve(logPath), 'utf8');
} else {
  const cargo = process.env.CARGO ?? (
    process.platform === 'win32'
      ? path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin', 'cargo.exe')
      : 'cargo'
  );
  const result = spawnSync(cargo, [
    'test', '--locked', '-p', 'escrow-global', '__anchor_private_print_idl',
    '--features', 'idl-build', '--', '--show-output', '--quiet',
  ], {
    cwd: programRoot,
    encoding: 'utf8',
    env: { ...process.env },
    maxBuffer: 16 * 1024 * 1024,
  });
  output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(output.slice(-12000));
    process.exit(result.status ?? 1);
  }
}

const idl = parseBlocks(output);
fs.mkdirSync(path.dirname(idlPath), { recursive: true });
fs.mkdirSync(path.dirname(typePath), { recursive: true });
fs.writeFileSync(idlPath, `${JSON.stringify(idl, null, 2)}\n`);
const typeIdl = camel(idl);
fs.writeFileSync(typePath, `/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at \`target/idl/escrow_global.json\`.
 */
export type EscrowGlobal = ${JSON.stringify(typeIdl, null, 2)};
`);

console.log(`Generated ${idlPath}`);
console.log(`Generated ${typePath}`);
console.log(`Custody ABI: ${idl.instructions?.length ?? 0} instructions, ${idl.events?.length ?? 0} events.`);
