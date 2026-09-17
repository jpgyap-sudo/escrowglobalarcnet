import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKFLOWS } from '../src/catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('salary disbursement is a dedicated workflow and account route', () => {
  const payroll = WORKFLOWS.find(item => item.id === 'salary_disbursement');
  assert.equal(payroll?.kind, 'payroll');
  assert.match(payroll.description, /bounded|budget/i);
  const ui = fs.readFileSync(path.join(root, 'public', 'universal-ui.mjs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'app.mjs'), 'utf8');
  assert.match(ui, /function payroll\(\)/);
  assert.match(ui, /Employer account only/);
  assert.match(ui, /data-u-form="payroll-add"/);
  assert.match(ui, /escrow-global-payroll-roster-/);
  assert.match(ui, /payroll-approve/);
  assert.match(ui, /payroll_add_staff/);
  assert.match(ui, /payroll-save-roster/);
  assert.match(ui, /payroll_update_staff/);
  assert.match(ui, /payroll_authorize_plan/);
  assert.match(ui, /acknowledge:true/);
  assert.match(ui, /payroll_execute_period/);
  assert.match(ui, /payroll_archive_staff/);
  assert.match(ui, /payroll-archive/);
  assert.match(ui, /payroll_pause_plan/);
  assert.match(ui, /payroll_resume_plan/);
  assert.match(ui, /payroll_cancel_plan/);
  assert.match(ui, /payroll-cancel/);
  assert.match(ui, /payroll-export/);
  assert.match(ui, /payroll-csv/);
  assert.match(ui, /text\/csv/);
  assert.match(ui, /sandbox-payroll-receipt/);
  assert.match(ui, /Record due demo payout/);
  assert.match(ui, /Recipient wallet label/);
  assert.match(ui, /walletAddress/);
  assert.match(ui, /payroll-summary/);
  assert.match(ui, /MONTHLY PAYROLL/);
  assert.match(ui, /DISBURSED TO DATE/);
  assert.match(ui, /nextPeriod/);
  assert.match(ui, /ACCOUNT PAYROLL HISTORY/);
  assert.match(ui, /sandbox_recorded/);
  assert.match(ui, /Demo only · no real funds/);
  assert.match(app, /parts\[1\]==='payroll'\?U\.payroll\(\)/);
});

test('preview wiring does not expose live payroll endpoints', () => {
  const ui = fs.readFileSync(path.join(root, 'public', 'universal-ui.mjs'), 'utf8');
  assert.doesNotMatch(ui, /sendPayroll|transferTokens|signTransaction/);
  assert.match(ui, /api\/payroll\?actorId/);
  assert.match(ui, /Funding, signing and finality are unavailable/);
});

test('payroll UI rehydrates stale local roster IDs safely and durable worker storage is documented', () => {
  const ui = fs.readFileSync(path.join(root, 'public', 'universal-ui.mjs'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'src', 'payroll-idempotency-sqlite.mjs'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'src', 'payroll-payout-worker.mjs'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
  const docs = fs.readFileSync(path.join(root, 'docs', 'payroll-salary-management.md'), 'utf8');
  assert.match(ui, /if\(!row\.serverId\|\|!current\)/);
  assert.match(store, /INSERT OR IGNORE/);
  assert.match(store, /WHERE key=\? AND state=\?/);
  assert.match(worker, /production_readiness_blocked/);
  assert.match(docs, /Implementation and rollout plan/);
  assert.match(server, /payrollStartupTick/);
});
