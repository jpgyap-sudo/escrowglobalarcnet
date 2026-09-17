import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function classifyProbeOutput(output, exitCode) {
  const text = String(output);
  if (/UnsupportedProgramId/.test(text)) {
    return { status: 'probe-blocked', error: 'UnsupportedProgramId', exitCode };
  }
  if (exitCode === 0) return { status: 'proven', error: null, exitCode };
  return { status: 'unexpected-failure', error: null, exitCode };
}

export function runReleaseProbe({ cwd = ROOT, node = process.execPath } = {}) {
  const result = spawnSync(node, ['scripts/run-custody-sbf-tests.mjs'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return {
    ...classifyProbeOutput(output, result.status ?? 1),
    output,
    spawnError: result.error?.message ?? null,
  };
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  const result = runReleaseProbe();
  console.log(JSON.stringify({
    status: result.status,
    error: result.error,
    exitCode: result.exitCode,
    spawnError: result.spawnError,
  }, null, 2));
  if (result.status !== 'probe-blocked') process.exitCode = 1;
}
