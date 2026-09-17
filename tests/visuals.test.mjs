import test from 'node:test';
import assert from 'node:assert/strict';
import { tutorialVisual, guidebookIntro } from '../public/tutorial-visuals.mjs';

test('tutorial visuals render accessible sandbox diagrams for supported flows', () => {
  for (const id of ['first-deal', 'fee-breakdown', 'non-custodial', 'funding-safely', 'physical-goods', 'buy-crypto', 'swap', 'wallet-qr', 'clear-scope', 'jupiter-register', 'jupiter-kyc', 'jupiter-card', 'jupiter-qr', 'milestone-planning', 'dispute-safely', 'onchain-reconciliation', 'wallet-security', 'protection-receipts', 'rights-deadlines', 'fee-sponsorship']) {
    const svg = tutorialVisual(id);
    assert.match(svg, /^\s*<svg role="img"/);
    assert.match(svg, /DEMO · SANDBOX/);
    assert.match(svg, /No live custody/);
    assert.match(svg, new RegExp(`arrow-${id}`));
  }
});

test('unknown visual ids fall back safely and the guidebook intro is static', () => {
  assert.match(tutorialVisual('unknown'), /Tutorial visual/);
  assert.match(tutorialVisual('unknown'), /simulated flow only/);
  assert.doesNotMatch(tutorialVisual('"><script>alert(1)</script>'), /script|onerror|arrow-"/i);
  assert.match(guidebookIntro(), /Learn by doing — safely/);
  assert.match(guidebookIntro(), /Sandbox — no live custody/);
});
