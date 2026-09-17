/**
 * Unsigned payroll payout boundary for a future restricted custody adapter.
 *
 * This module deliberately does not sign, broadcast, contact an RPC, or move
 * funds. It converts an already-approved payroll period into a fixed batch
 * intent that a separately audited payroll vault/program could validate.
 * Sandbox funding is rejected by default so a simulated reservation cannot be
 * mistaken for custody; callers may opt into `allowSandbox` for fixtures only.
 */
import { agreementHash, canonicalJSON } from './agreement.mjs';
import { base58Decode } from './payments.mjs';
import { CUSTODY_NETWORKS, TOKEN_PROGRAM_IDS, SUPPORTED_TOKEN_PROGRAM } from './custody/intent.mjs';
import { parseTokenAmount, formatTokenAmount } from './payroll-domain.mjs';

export const PAYROLL_PAYOUT_PROTOCOL_VERSION = 'escrow-global-payroll-v1';
export const MAX_PAYROLL_RECIPIENTS_PER_BATCH = 40;
const MAX_U64 = (1n << 64n) - 1n;
const required = (value, label, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label} is required and must be at most ${max} characters.`);
  return value.trim();
};
const hash32 = (value, label) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || /^0+$/.test(value)) throw new Error(`${label} must be a non-zero 32-byte lowercase hexadecimal hash.`);
  return value;
};
const address = (value, label) => {
  const normalized = required(value, label, 64);
  try {
    const decoded = base58Decode(normalized);
    if (decoded.length !== 32 || decoded.every(byte => byte === 0)) throw new Error();
  } catch { throw new Error(`${label} must be a valid Solana address.`); }
  return normalized;
};
const unixMillis = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative Unix timestamp in milliseconds.`);
  return value;
};
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

function chainConfig(options) {
  const network = required(options.network, 'Settlement network', 32);
  if (!CUSTODY_NETWORKS.includes(network)) throw new Error('Settlement network is not supported by the payroll custody protocol.');
  const programId = address(options.programId, 'Payroll custody program ID');
  const expected = options.expectedProgramIds?.[network];
  if (expected === undefined || programId !== address(expected, 'Expected payroll custody program ID')) throw new Error('Payroll custody program ID does not match the configured network manifest.');
  const genesisHash = address(options.genesisHash, 'Cluster genesis hash');
  const mint = address(options.mint, 'Settlement mint');
  const admitted = Array.isArray(options.allowedMints) ? options.allowedMints : options.allowedMints?.[network];
  if (!Array.isArray(admitted) || !admitted.length) throw new Error('A network-qualified admitted mint allowlist is required for payroll custody.');
  const admittedMints = admitted.map((value, index) => address(value, `Admitted mint ${index + 1}`));
  if (!admittedMints.includes(mint)) throw new Error('Settlement mint is not admitted for this network.');
  const requestedProgram = options.tokenProgram || SUPPORTED_TOKEN_PROGRAM;
  const tokenProgram = requestedProgram === TOKEN_PROGRAM_IDS[SUPPORTED_TOKEN_PROGRAM] ? SUPPORTED_TOKEN_PROGRAM : requestedProgram;
  if (tokenProgram !== SUPPORTED_TOKEN_PROGRAM) throw new Error('Payroll custody currently supports only the SPL Token program.');
  return { network, programId, genesisHash, mint, admittedMints, tokenProgram, tokenProgramId: TOKEN_PROGRAM_IDS[tokenProgram] };
}

function approvedLines(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('Payroll plan is required.');
  if (!['approved', 'completed'].includes(plan.status)) throw new Error('Only an approved payroll plan can produce a payout intent.');
  if (!Array.isArray(plan.lines) || plan.lines.length < 1 || plan.lines.length > MAX_PAYROLL_RECIPIENTS_PER_BATCH) throw new Error(`Payroll payout batches are limited to ${MAX_PAYROLL_RECIPIENTS_PER_BATCH} recipients.`);
  if (!plan.preview || !plan.funding) throw new Error('Payroll plan must have a preview and a funding reservation.');
  const lines = plan.lines.map((line, index) => {
    if (!line || typeof line !== 'object') throw new Error(`Payroll line ${index + 1} is invalid.`);
    const staffId = required(line.staffId, `Payroll line ${index + 1} staff ID`);
    const wallet = address(line.walletAddress, `Payroll line ${index + 1} recipient wallet`);
    const units = parseTokenAmount(line.salary, `Payroll line ${index + 1} salary`);
    if (units <= 0n || units > MAX_U64) throw new Error(`Payroll line ${index + 1} salary is outside the supported range.`);
    return { staffId, wallet, units };
  });
  const staffIds = new Set(); const wallets = new Set();
  for (const line of lines) {
    if (staffIds.has(line.staffId)) throw new Error('Payroll payout staff IDs must be unique.');
    if (wallets.has(line.wallet)) throw new Error('Payroll payout wallets must be unique within a batch.');
    staffIds.add(line.staffId); wallets.add(line.wallet);
  }
  const monthlyTotal = lines.reduce((sum, line) => sum + line.units, 0n);
  const commitment = monthlyTotal * BigInt(plan.months);
  if (commitment > MAX_U64) throw new Error('Payroll commitment exceeds the supported token-unit limit.');
  if (plan.preview.total !== formatTokenAmount(monthlyTotal) || plan.preview.commitment !== formatTokenAmount(commitment)) throw new Error('Payroll preview does not match the approved payout lines.');
  if (plan.funding.amount !== formatTokenAmount(commitment) || parseTokenAmount(plan.funding.disbursed || '0', 'Disbursed payroll amount') > commitment) throw new Error('Payroll funding reservation does not match the approved commitment.');
  return { lines, monthlyTotal, commitment };
}

/** Build a fixed, unsigned one-period payroll payout intent. */
export function createPayrollPayoutIntent(plan, run, period, options = {}) {
  const lines = approvedLines(plan);
  if (!run || typeof run !== 'object' || run.planId !== plan.id || !Array.isArray(run.periods)) throw new Error('Payroll run does not belong to the approved plan.');
  const selectedPeriod = typeof period === 'string' ? run.periods.find(item => item.period === period) : period;
  if (!selectedPeriod || !run.periods.some(item => item === selectedPeriod || item.period === selectedPeriod.period)) throw new Error('Payroll period was not found in the approved run.');
  if (selectedPeriod.status !== 'not_paid') throw new Error('Only an unpaid payroll period can produce a payout intent.');
  const dueAt = selectedPeriod.dueAt ? Date.parse(selectedPeriod.dueAt) : Date.parse(`${selectedPeriod.period}T00:00:00.000Z`);
  if (!Number.isFinite(dueAt)) throw new Error('Payroll period due date is invalid.');
  const now = options.now === undefined ? Date.now() : unixMillis(options.now, 'Current time');
  if (now < dueAt) throw new Error(`Payroll period ${selectedPeriod.period} is not due yet.`);
  const disbursed = parseTokenAmount(plan.funding.disbursed || '0', 'Disbursed payroll amount');
  if (disbursed + lines.monthlyTotal > lines.commitment) throw new Error('Payroll funding reservation is exhausted.');
  if (plan.funding.source === 'sandbox_budget' && options.allowSandbox !== true) throw new Error('Sandbox funding cannot authorize a live payroll payout.');
  if (plan.funding.source !== 'sandbox_budget' && plan.funding.source !== 'payroll_vault') throw new Error('Payroll funding source is not an admitted custody vault.');
  const chain = chainConfig(options);
  const employer = address(options.employerAddress, 'Employer wallet');
  const signer = address(options.signer || employer, 'Payroll authorization signer');
  if (signer !== employer) throw new Error('Only the employer wallet can authorize a payroll payout batch.');
  const vault = address(options.vaultAddress, 'Payroll vault address');
  const batchId = agreementHash({ protocol: PAYROLL_PAYOUT_PROTOCOL_VERSION, planId: plan.id, runId: run.id, period: selectedPeriod.period });
  const intent = {
    protocol: PAYROLL_PAYOUT_PROTOCOL_VERSION,
    kind: 'payroll_payout',
    batchId,
    planId: required(plan.id, 'Payroll plan ID'),
    runId: required(run.id, 'Payroll run ID'),
    period: { period: required(selectedPeriod.period, 'Payroll period'), dueAt: selectedPeriod.dueAt || new Date(dueAt).toISOString(), timezone: selectedPeriod.timezone || 'UTC' },
    chain,
    asset: { mint: chain.mint, tokenProgram: chain.tokenProgram, tokenProgramId: chain.tokenProgramId },
    employer,
    vault,
    recipients: lines.lines.map(line => ({ staffId: line.staffId, wallet: line.wallet, amount: formatTokenAmount(line.units) })),
    total: formatTokenAmount(lines.monthlyTotal),
    funding: { committed: formatTokenAmount(lines.commitment), alreadyDisbursed: formatTokenAmount(disbursed), source: plan.funding.source },
    authorization: { signer, requiredSigners: [employer], destinationPolicy: 'fixed-approved-payroll-lines-only' },
    programInstruction: 'disburse_payroll_batch',
    createdAt: now,
    status: 'unsigned',
    broadcastable: false
  };
  intent.intentHash = agreementHash(intent);
  return deepFreeze(intent);
}

export function verifyPayrollPayoutIntent(intent) {
  if (!intent || typeof intent !== 'object' || intent.status !== 'unsigned' || intent.broadcastable !== false || typeof intent.intentHash !== 'string') return false;
  const copy = structuredClone(intent); delete copy.intentHash;
  return intent.intentHash === agreementHash(copy) && intent.programInstruction === 'disburse_payroll_batch' && intent.authorization?.destinationPolicy === 'fixed-approved-payroll-lines-only';
}

export function serializePayrollPayoutIntent(intent) {
  if (!verifyPayrollPayoutIntent(intent)) throw new Error('Only a verified unsigned payroll payout intent can be serialized.');
  return canonicalJSON(intent);
}
