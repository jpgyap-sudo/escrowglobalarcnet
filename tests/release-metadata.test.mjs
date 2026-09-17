import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('release metadata is valid and cannot claim live custody readiness', () => {
  const release = JSON.parse(fs.readFileSync(new URL('../RELEASE.json', import.meta.url), 'utf8'));
  assert.equal(release.escrowMode, 'sandbox');
  assert.equal(release.liveCustodyImplemented, false);
  assert.equal(release.productionAuthenticationImplemented, false);
  assert.equal(release.nodeTests.passed, 449);
  assert.equal(release.nodeTests.failed, 0);
  assert.equal(release.custodyProgramVerticalSlice.deployed, false);
  assert.equal(release.custodyProgramVerticalSlice.audited, false);
  assert.equal(release.custodyProgramVerticalSlice.liveEndpointEnabled, false);
  assert.equal(release.custodyProgramVerticalSlice.artifactFreshByTimestamp, true);
  assert.equal(release.custodyProgramVerticalSlice.unitTestsPassed, release.custodyVerification.nativeRustTestsPassed);
  assert.equal(release.custodyVerification.sbfFresh, true);
  assert.equal(release.custodyVerification.programTestSourceRuntimeVerified, true);
  assert.equal(release.custodyVerification.programTestReleaseArtifactRuntimeVerified, false);
  assert.equal(release.custodyVerification.programTestRuntimeVerified, false);
  assert.equal(release.custodyVerification.fullNodeTestsPassed, release.nodeTests.passed);
  assert.equal(release.custodyVerification.releaseApprovalRequired, true);
  assert.equal(release.staticPreviewDeployment.provider, 'github-pages');
  assert.equal(release.staticPreviewDeployment.status, 'historical-snapshot');
  assert.equal(release.staticPreviewDeployment.automaticWorkflowPresent, false);
  assert.equal(release.staticPreviewDeployment.sandboxOnly, true);
  assert.match(release.staticPreviewDeployment.url, /^https:\/\/jpgyap-sudo\.github\.io\/escrow-global\/$/);
});
