import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyProbeOutput } from '../scripts/probe-custody-release-sbf.mjs';
import { loadCapabilities } from '../scripts/render-capabilities.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the known SBPF v3 loader boundary is locked to UnsupportedProgramId', () => {
  const capability = loadCapabilities().entries.find(entry => entry.id === 'sbpf-v3-execution');
  assert.equal(capability.status, 'probe-blocked');
  assert.match(capability.notes, /UnsupportedProgramId/);
  assert.match(capability.notes, /Solana 2\.3\.1/);
  assert.deepEqual(classifyProbeOutput('ProgramTest error: UnsupportedProgramId', 101), {
    status: 'probe-blocked', error: 'UnsupportedProgramId', exitCode: 101,
  });
  assert.deepEqual(classifyProbeOutput('test result: ok', 0), {
    status: 'proven', error: null, exitCode: 0,
  });
  assert.equal(classifyProbeOutput('Program panicked', 101).status, 'unexpected-failure');
  const runner = fs.readFileSync(path.join(root, 'scripts', 'run-custody-sbf-tests.mjs'), 'utf8');
  assert.match(runner, /target\/deploy/);
  assert.match(runner, /BPF_OUT_DIR: artifactDirectory/);
  assert.match(runner, /SBF_OUT_DIR: artifactDirectory/);
});
