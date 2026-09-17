#!/usr/bin/env node
/**
 * Read-only on-chain deployment verifier. It requires an approved local
 * custody-deployment-manifest.json and a caller-supplied HTTPS RPC endpoint.
 * It never loads a key, signs, or broadcasts.
 */
import { base58Decode } from '../src/payments.mjs';
import { createSolanaRpc } from '../src/custody/solana-rpc.mjs';
import { findProgramAddress } from '../src/custody/solana-pda.mjs';
import { loadAndVerifyCustodyDeploymentManifest } from './custody-deployment-manifest.mjs';
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, DEPLOYMENT_CONFIG_SEED, verifyCustodyDeploymentEvidence } from '../src/custody/deployment-verification.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const manifestPath = option('--manifest');
  const endpoint = option('--rpc') || process.env.SOLANA_RPC_URL;
  const trustedApprovalPublicKey = option('--approval-key') || process.env.CUSTODY_APPROVAL_PUBLIC_KEY;
  let manifest;
  try {
    manifest = loadAndVerifyCustodyDeploymentManifest(manifestPath, { trustedApprovalPublicKey });
  } catch (error) {
    output({ status: 'blocked', blockers: [error instanceof Error ? error.message : String(error)] });
    process.exitCode = 1;
    return;
  }
  if (!endpoint) {
    output({ status: 'blocked', blockers: ['No RPC endpoint supplied. Use --rpc or SOLANA_RPC_URL.'] });
    process.exitCode = 1;
    return;
  }

  let programDataAddress;
  let deploymentConfigAddress;
  try {
    programDataAddress = findProgramAddress([base58Decode(manifest.programId)], BPF_LOADER_UPGRADEABLE_PROGRAM_ID).address;
    deploymentConfigAddress = findProgramAddress([Uint8Array.from(Buffer.from(DEPLOYMENT_CONFIG_SEED, 'utf8'))], manifest.programId).address;
  } catch (error) {
    output({ status: 'blocked', blockers: [error instanceof Error ? error.message : String(error)] });
    process.exitCode = 1;
    return;
  }

  try {
    const rpc = createSolanaRpc({ endpoint, network: manifest.network, timeoutMs: 15_000 });
    const accountOptions = { commitment: 'finalized', encoding: 'base64' };
    const transactionOptions = { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 0 };
    const [genesisHash, programAccount, programDataAccount, deploymentConfigAccount, deploymentTransaction] = await Promise.all([
      rpc.getGenesisHash(),
      rpc.getAccountInfo(manifest.programId, accountOptions),
      rpc.getAccountInfo(programDataAddress, accountOptions),
      rpc.getAccountInfo(deploymentConfigAddress, accountOptions),
      rpc.getTransaction(manifest.deploymentSignature, transactionOptions)
    ]);
    const verified = verifyCustodyDeploymentEvidence({
      manifest,
      programDataAddress,
      deploymentConfigAddress,
      genesisHash,
      programAccount,
      programDataAccount,
      deploymentConfigAccount,
      deploymentTransaction
    });
    output({ status: verified.status, network: manifest.network, programId: manifest.programId, programDataAddress, deploymentConfigAddress, checks: verified.checks, blockers: verified.blockers });
    if (verified.status !== 'verified') process.exitCode = 1;
  } catch (error) {
    output({ status: 'blocked', network: manifest.network, programId: manifest.programId, blockers: [error instanceof Error ? error.message : String(error)] });
    process.exitCode = 1;
  }
}

main();
