import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const compatibilityMode = process.argv.includes('--compat');
const artifactDirectory = path.resolve(
  repositoryRoot,
  compatibilityMode
    ? 'packages/custody-contracts/program/target/sbf-test-v2'
    : 'packages/custody-contracts/program/target/deploy',
);
const artifactPath = path.join(artifactDirectory, 'escrow_global.so');

const run = (command, args, env = process.env) => spawnSync(command, args, {
  cwd: repositoryRoot,
  env,
  stdio: 'inherit',
});

const cargo = process.env.CARGO ?? (process.platform === 'win32' ? 'cargo.exe' : 'cargo');

if (compatibilityMode) {
  console.log('Building the SBPF v2 compatibility artifact for ProgramTest...');
  const build = run(cargo, [
    'build-sbf',
    '--arch',
    'v2',
    '--manifest-path',
    'packages/custody-contracts/program/Cargo.toml',
    '--sbf-out-dir',
    'packages/custody-contracts/program/target/sbf-test-v2',
  ]);
  if (build.error || build.status !== 0) {
    console.error(`Unable to build the SBPF v2 compatibility artifact: ${build.error?.message ?? `exit ${build.status}`}`);
    process.exitCode = build.status ?? 1;
  }
}

if (process.exitCode !== undefined) {
  // The build failed above; do not attempt to run a stale or partial test.
} else if (!fs.existsSync(artifactPath)) {
  console.error(
    `Missing SBF artifact: ${artifactPath}. Run npm run build:custody:sbf first.`,
  );
  process.exitCode = 1;
} else if (fs.statSync(artifactPath).size === 0) {
  console.error(`SBF artifact is empty: ${artifactPath}`);
  process.exitCode = 1;
} else {
  const result = run(
    cargo,
    [
      'test',
      '--manifest-path',
      'packages/custody-contracts/program/tests/lifecycle/Cargo.toml',
      '--locked',
      '--offline',
      '--',
      '--test-threads=1',
    ],
    {
        ...process.env,
        // Set both names because solana-program-test checks BPF_OUT_DIR first
        // when discovering shared objects. They intentionally point to the
        // exact artifact directory validated above; the Rust harness loads the
        // artifact through the upgradeable genesis layout.
        BPF_OUT_DIR: artifactDirectory,
        SBF_OUT_DIR: artifactDirectory,
      },
  );

  if (result.error) {
    console.error(`Unable to run cargo test: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
