import { loadAndVerifyCustodyDeploymentManifest } from './custody-deployment-manifest.mjs';

try {
  const args = process.argv.slice(2);
  const approvalKeyIndex = args.indexOf('--approval-key');
  const trustedApprovalPublicKey = approvalKeyIndex >= 0 ? args[approvalKeyIndex + 1] : process.env.CUSTODY_APPROVAL_PUBLIC_KEY;
  const manifestPath = args.find((value, index) => value !== '--approval-key' && args[index - 1] !== '--approval-key');
  const verified = loadAndVerifyCustodyDeploymentManifest(manifestPath, { trustedApprovalPublicKey });
  console.log(`Custody release manifest is internally consistent: ${verified.deploymentId} (${verified.network}, ${verified.programId}).`);
  console.log('This check does not prove that the program is deployed, upgraded safely or audited.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
