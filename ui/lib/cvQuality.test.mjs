import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assessCvSource, cvDownloadDecision, cvQualityPaths, extractTypstBullets,
  overrideCvQuality, readCvQuality, runCvQuality, sourceSha256,
} from './cvQuality.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-cv-quality-'));
  const paths = cvQualityPaths(root, 'acme');
  fs.mkdirSync(paths.directory, { recursive: true });
  return { root, paths };
}

const SOURCE = `#show: cv.with(name: "Alex")
= Experience
- Reduced build time by 30% by introducing a reusable test fixture.
- Owned prototype integration across electronics and mechanics.
`;

function manifest(options = { xyz: true, humanize: true }) {
  return {
    schemaVersion: 1,
    opportunityId: 'acme-engineer-2026-07',
    options,
    questions: [],
    bullets: [
      {
        text: 'Reduced build time by 30% by introducing a reusable test fixture.',
        kind: 'achievement',
        evidence: [{ source: 'question', reference: 'q1' }],
        xyz: { x: 'Reduced build time', y: '30%', z: 'introduced a reusable test fixture' },
      },
      {
        text: 'Owned prototype integration across electronics and mechanics.',
        kind: 'responsibility',
        evidence: [{ source: 'master-cv', reference: 'Experience > Acme' }],
        xyz: null,
      },
    ],
    voiceReview: { completed: true, summary: 'Removed generic wording.', changes: [] },
  };
}

test('extracts wrapped Typst bullets as normalised visible text', () => {
  assert.deepEqual(extractTypstBullets('- Delivered a prototype by\n  building a reusable fixture.\n\n= Skills'), [
    'Delivered a prototype by building a reusable fixture.',
  ]);
});

test('passes supported XYZ bullets after a recorded voice review', () => {
  const result = assessCvSource(SOURCE, manifest(), { locale: 'en-GB', pdfExists: true });
  assert.equal(result.pass, true);
  assert.equal(result.bulletCount, 2);
  assert.deepEqual(result.issues, []);
});

test('blocks unsupported claims and flags optional XYZ and voice problems', () => {
  const source = `${SOURCE}- Results-driven leader who optimized delivery.\n`;
  const result = assessCvSource(source, { ...manifest(), voiceReview: { completed: false } }, { locale: 'en-GB' });
  assert.ok(result.blocking.some((entry) => entry.id === 'unsupported-bullet'));
  assert.ok(result.warnings.some((entry) => entry.id === 'voice-review-missing'));
  assert.ok(result.warnings.some((entry) => entry.id === 'cliche'));
  assert.ok(result.warnings.some((entry) => entry.id === 'locale'));
});

test('quality reports and overrides are bound to the current CV hash', () => {
  const { root, paths } = fixture();
  fs.writeFileSync(paths.source, SOURCE);
  fs.writeFileSync(paths.pdf, 'pdf');
  fs.writeFileSync(paths.evidence, JSON.stringify({ ...manifest(), voiceReview: { completed: false } }));
  const report = runCvQuality(root, 'acme', { compile: false, now: () => '2026-07-12T12:00:00.000Z' });
  assert.equal(report.pass, false);
  assert.equal(report.cvSha256, sourceSha256(SOURCE));
  assert.equal(cvDownloadDecision(root, 'acme').overridable, true);

  const overridden = overrideCvQuality(root, 'acme', report.cvSha256, { now: () => '2026-07-12T12:01:00.000Z' });
  assert.equal(overridden.status, 'overridden');
  assert.equal(cvDownloadDecision(root, 'acme').allowed, true);

  fs.appendFileSync(paths.source, '\n// edited\n');
  assert.equal(readCvQuality(root, 'acme').status, 'stale');
  assert.equal(cvDownloadDecision(root, 'acme').allowed, false);
  assert.equal(cvDownloadDecision(root, 'acme').overridable, false);
});

test('legacy drafts require an explicit hash-bound override', () => {
  const { root, paths } = fixture();
  fs.writeFileSync(paths.source, SOURCE);
  fs.writeFileSync(paths.pdf, 'pdf');
  const legacy = readCvQuality(root, 'acme');
  assert.equal(legacy.status, 'legacy');
  assert.equal(cvDownloadDecision(root, 'acme').overridable, true);
  assert.throws(() => overrideCvQuality(root, 'acme', 'wrong'), /changed/);
  assert.equal(overrideCvQuality(root, 'acme', legacy.cvSha256).status, 'overridden');
});
