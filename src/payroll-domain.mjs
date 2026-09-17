/** Pure salary-management rules. No storage, wallet, RPC, or scheduler side effects. */
export const MAX_AUTOPAY_MONTHS = 12;
export const MAX_STAFF_PER_PLAN = 100;
export const TOKEN_DECIMALS = 6;

const amountPattern = /^\d+(?:\.\d{1,6})?$/;
export function parseTokenAmount(value, label = 'Amount') {
  const raw = String(value ?? '').trim();
  if (!amountPattern.test(raw)) throw new Error(`${label} must be a non-negative amount with up to 6 decimals.`);
  const [whole, fraction = ''] = raw.split('.');
  const units = BigInt(whole) * 1000000n + BigInt((fraction + '000000').slice(0, 6));
  return units;
}

export function formatTokenAmount(units) {
  if (typeof units !== 'bigint' || units < 0n) throw new Error('Token units must be a non-negative bigint.');
  const whole = units / 1000000n;
  const fraction = (units % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function validatePayroll({ budget, staff, months = 1, mode = 'manual' }) {
  if (!Array.isArray(staff) || staff.length < 1 || staff.length > MAX_STAFF_PER_PLAN) throw new Error(`Staff must contain 1-${MAX_STAFF_PER_PLAN} active employees.`);
  if (!Number.isInteger(months) || months < 1 || months > MAX_AUTOPAY_MONTHS) throw new Error(`Automation term must be 1-${MAX_AUTOPAY_MONTHS} months.`);
  if (!['manual', 'autopay'].includes(mode)) throw new Error('Payment mode is invalid.');
  const budgetUnits = parseTokenAmount(budget, 'Monthly budget');
  const seen = new Set();
  let allocated = 0n;
  const allocations = staff.map((person, index) => {
    if (!person || typeof person !== 'object' || !person.id || seen.has(person.id)) throw new Error(`Staff row ${index + 1} must have a unique ID.`);
    seen.add(person.id);
    const salary = parseTokenAmount(person.salary, `Salary for ${person.name || person.id}`);
    if (salary === 0n) throw new Error(`Salary for ${person.name || person.id} must be greater than zero.`);
    allocated += salary;
    return Object.freeze({ id: String(person.id), name: String(person.name || person.id), role: String(person.role || 'Staff'), salaryUnits: salary });
  });
  if (allocated > budgetUnits) throw new Error(`Salaries exceed the monthly budget by ${formatTokenAmount(allocated - budgetUnits)}.`);
  return Object.freeze({ budgetUnits, allocatedUnits: allocated, unallocatedUnits: budgetUnits - allocated, commitmentUnits: allocated * BigInt(months), months, mode, allocations: Object.freeze(allocations) });
}

export function scheduleMonthlyDates(startDate, months, timezone = 'UTC') {
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); } catch { throw new Error('Use an IANA timezone for payroll schedules.'); }
  if (!Number.isInteger(months) || months < 1 || months > MAX_AUTOPAY_MONTHS) throw new Error('Invalid schedule term.');
  const rawDate = String(startDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) throw new Error('Start date is invalid.');
  const [yearPart, monthPart, dayPart] = rawDate.split('-').map(Number);
  const start = new Date(Date.UTC(yearPart, monthPart - 1, dayPart, 9));
  if (Number.isNaN(start.valueOf()) || start.getUTCFullYear() !== yearPart || start.getUTCMonth() !== monthPart - 1 || start.getUTCDate() !== dayPart) throw new Error('Start date is invalid.');
  const payday = start.getUTCDate();
  const localDueAt = (year, month, day) => {
    const desired = Date.UTC(year, month, day, 9);
    let guess = desired;
    // Resolve the local 09:00 wall-clock time to UTC without relying on
    // process-local timezone settings. Two iterations cover normal offsets
    // and DST changes while preserving the requested local calendar date.
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(part => ['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type)).map(part => [part.type, Number(part.value)]));
      const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      guess += desired - represented;
    }
    return new Date(guess);
  };
  return Object.freeze(Array.from({ length: months }, (_, index) => {
    const normalized = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const year = normalized.getUTCFullYear(), month = normalized.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(payday, lastDay);
    const date = localDueAt(year, month, day);
    return Object.freeze({ period: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, dueAt: date.toISOString(), timezone });
  }));
}
