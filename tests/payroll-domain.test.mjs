import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTokenAmount, parseTokenAmount, scheduleMonthlyDates, validatePayroll } from '../src/payroll-domain.mjs';

test('salary budget uses exact token base units', () => {
  assert.throws(() => parseTokenAmount('10,000'), /non-negative amount/);
  assert.equal(parseTokenAmount('10000'), 10000000000n);
});

test('parses and formats six-decimal amounts without floating point', () => {
  const units = parseTokenAmount('2000.125');
  assert.equal(units, 2000125000n);
  assert.equal(formatTokenAmount(units), '2000.125');
});

test('validates monthly allocations and multi-month commitment', () => {
  const result = validatePayroll({ budget: '10000', months: 6, mode: 'autopay', staff: [
    { id: 'a', name: 'Ari', role: 'Design', salary: '2000' },
    { id: 'b', name: 'Bea', role: 'Engineering', salary: '3000' },
  ] });
  assert.equal(formatTokenAmount(result.unallocatedUnits), '5000');
  assert.equal(formatTokenAmount(result.commitmentUnits), '30000');
});

test('rejects over-budget, duplicate and overlong plans', () => {
  assert.throws(() => validatePayroll({ budget: '100', staff: [{ id: 'a', salary: '101' }] }), /exceed/);
  assert.throws(() => validatePayroll({ budget: '100', staff: [{ id: 'a', salary: '1' }, { id: 'a', salary: '1' }] }), /unique/);
  assert.throws(() => validatePayroll({ budget: '100', months: 13, staff: [{ id: 'a', salary: '1' }] }), /1-12/);
});

test('creates deterministic bounded monthly schedule', () => {
  const dates = scheduleMonthlyDates('2026-01-31', 3, 'Asia/Singapore');
  assert.deepEqual(dates.map(x => x.period), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(dates[0].timezone, 'Asia/Singapore');
  assert.equal(dates[0].dueAt, '2026-01-31T01:00:00.000Z', '09:00 Singapore should resolve to 01:00 UTC');
  assert.throws(() => scheduleMonthlyDates('2026-02-30', 1, 'UTC'), /Start date is invalid/);
});
