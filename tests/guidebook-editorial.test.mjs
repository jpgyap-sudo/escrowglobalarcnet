import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES } from '../public/learn.mjs';

const visitorText = guide => JSON.stringify({
  tag: guide.tag,
  title: guide.title,
  intro: guide.intro,
  steps: guide.steps,
  note: guide.note,
  sources: guide.sources
});

test('visitor guidebook does not expose engineering or deployment instructions', () => {
  const technicalTerms = /\b(?:ABI|PDA|SBPF|Anchor|RPC|reconciler|reconciliation|deployment manifest|program ID|unsigned intent|instruction discriminator)\b/i;
  const offenders = GUIDES
    .map(guide => ({ id: guide.id, text: visitorText(guide) }))
    .filter(entry => technicalTerms.test(entry.text));

  assert.deepEqual(offenders, [], `technical terms found in visitor guides: ${offenders.map(x => x.id).join(', ')}`);
});

test('visitor escrow guides retain the sandbox safety boundary', () => {
  for (const id of ['production-readiness', 'solana-escrow-simple', 'funding-safely', 'wallet-security']) {
    const guide = GUIDES.find(entry => entry.id === id);
    assert.ok(guide, `${id} guide exists`);
    assert.match(`${guide.intro} ${guide.note}`, /sandbox/i);
    assert.match(`${guide.intro} ${guide.note}`, /no real funds|never send/i);
  }
});
