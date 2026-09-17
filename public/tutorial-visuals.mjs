const VISUAL_IDS = new Set(['production-readiness', 'solana-escrow-simple', 'first-deal', 'fee-breakdown', 'non-custodial', 'funding-safely', 'physical-goods', 'buy-crypto', 'swap', 'wallet-qr', 'clear-scope', 'jupiter-register', 'jupiter-kyc', 'jupiter-card', 'jupiter-qr', 'milestone-planning', 'dispute-safely', 'onchain-reconciliation', 'wallet-security', 'protection-receipts', 'rights-deadlines', 'fee-sponsorship', 'action-center']);
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Return a deterministic, static visual for a known guide. No wallet or custody side effects. */
export function tutorialVisual(id) {
  const visualId = VISUAL_IDS.has(id) ? id : 'fallback';
  const palette = {
    navy: "#0b1f3a",
    teal: "#0f9b8e",
    cream: "#f7f3e8",
    ink: "#12263f",
    line: "#c9d6e3",
    warn: "#b45309"
  };

  const wrap = (label, inner, vb = "0 0 640 360") => `
<svg role="img" aria-label="${xml(label)}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;background:${palette.cream};border-radius:12px">
  <defs>
    <marker id="arrow-${visualId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${palette.teal}"/>
    </marker>
    <style>
      .t{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;fill:${palette.ink}}
      .h{font-weight:700;font-size:18px}
      .s{font-size:13px;fill:#3b4a5a}
      .box{fill:#ffffff;stroke:${palette.line};stroke-width:1.5;rx:10}
      .step{fill:${palette.navy};color:${palette.cream}}
      .badge{fill:${palette.warn};color:#fff;font-weight:700;font-size:11px}
      .teal{fill:${palette.teal}}
      .navy{fill:${palette.navy}}
      .flow{stroke:${palette.teal};stroke-width:2;fill:none;marker-end:url(#arrow-${visualId})}
    </style>
  </defs>
  <rect x="0" y="0" width="640" height="360" fill="${palette.cream}"/>
  <text x="24" y="34" class="t h">${xml(label)}</text>
  <g transform="translate(24,52)">
    <rect x="0" y="0" width="120" height="22" rx="11" class="badge"/>
    <text x="60" y="15" text-anchor="middle" class="t" fill="#fff" font-size="11" font-weight="700">DEMO · SANDBOX</text>
  </g>
  ${inner}
  <text x="24" y="348" class="t s">No live custody · simulated flow only</text>
</svg>`;

  const stepBox = (x, y, w, h, n, title, sub) => `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="box"/>
      <circle cx="${x + 18}" cy="${y + 18}" r="12" class="navy"/>
      <text x="${x + 18}" y="${y + 23}" text-anchor="middle" class="t" fill="#fff" font-size="12" font-weight="700">${n}</text>
      <text x="${x + 38}" y="${y + 22}" class="t" font-size="14" font-weight="700">${xml(title)}</text>
      <text x="${x + 12}" y="${y + 46}" class="t s">${xml(sub)}</text>
    </g>`;

  const arrow = (x1, y1, x2, y2) =>
    `<path d="M${x1},${y1} L${x2},${y2}" class="flow"/>`;

  const diagrams = {
    "production-readiness": wrap("Before you start a deal", `
      ${stepBox(24, 90, 180, 70, 1, "Read", "The agreement")}
      ${stepBox(230, 90, 180, 70, 2, "Check", "Your role")}
      ${stepBox(436, 90, 180, 70, 3, "Review", "The payment")}
      ${stepBox(24, 200, 180, 70, 4, "Deliver", "The agreed work")}
      ${stepBox(230, 200, 180, 70, 5, "Inspect", "The result")}
      ${stepBox(436, 200, 180, 70, 6, "Decide", "Release or remedy")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 204, 200)}
      ${arrow(204, 235, 230, 235)}
      ${arrow(410, 235, 436, 235)}
    `),
    "solana-escrow-simple": wrap("How an escrow deal moves", `
      ${stepBox(24, 90, 180, 70, 1, "Agree", "Terms are clear")}
      ${stepBox(230, 90, 180, 70, 2, "Fund", "Money is set aside")}
      ${stepBox(436, 90, 180, 70, 3, "Deliver", "Work is completed")}
      ${stepBox(24, 200, 180, 70, 4, "Inspect", "Check the result")}
      ${stepBox(230, 200, 180, 70, 5, "Release", "Seller is paid")}
      ${stepBox(436, 200, 180, 70, 6, "Resolve", "Refund or help")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 204, 200)}
      ${arrow(204, 235, 230, 235)}
      ${arrow(410, 235, 436, 235)}
    `),
    "first-deal": wrap("First deal flow", `
      ${stepBox(24, 90, 180, 70, 1, "Connect demo", "Sandbox wallet only")}
      ${stepBox(230, 90, 180, 70, 2, "Pick asset", "Goods or crypto")}
      ${stepBox(436, 90, 180, 70, 3, "Review terms", "Price, fees, escrow")}
      ${stepBox(230, 200, 180, 70, 4, "Confirm", "Sign in sandbox")}
      ${stepBox(436, 200, 180, 70, 5, "Settle", "Simulated release")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "fee-breakdown": wrap("Fee and refund example", `
      <text x="24" y="91" class="t h">1,030 total paid by buyer</text>
      <text x="24" y="116" class="t s">1,000 principal + 30 reserve (3%)</text>
      <rect x="24" y="138" width="592" height="38" rx="8" fill="#0f9b8e"/>
      <rect x="24" y="138" width="574" height="38" rx="8" fill="#0b1f3a"/>
      <text x="36" y="162" class="t" fill="#fff" font-size="13" font-weight="700">Seller principal · 1,000</text>
      <rect x="598" y="138" width="18" height="38" rx="4" fill="#b45309"/>
      <text x="24" y="205" class="t s">When work is accepted</text>
      <text x="24" y="238" class="t h">Seller 1,000</text><text x="190" y="238" class="t h">Platform 30</text>
      <text x="24" y="266" class="t s">If the agreement is fully refunded before a dispute</text>
      <text x="24" y="299" class="t h">Buyer receives 1,030</text>
      <text x="362" y="299" class="t s">Unused reserve returns too</text>
    `),
    "non-custodial": wrap("A clear, user-controlled deal", `
      ${stepBox(18, 90, 142, 70, 1, "Your wallet", "You approve")}
      ${stepBox(174, 90, 142, 70, 2, "Clear terms", "Everyone agrees")}
      ${stepBox(330, 90, 142, 70, 3, "Review", "Evidence is checked")}
      ${stepBox(486, 90, 136, 70, 4, "Outcome", "Pay or refund")}
      ${arrow(160, 125, 174, 125)}
      ${arrow(316, 125, 330, 125)}
      ${arrow(472, 125, 486, 125)}
      ${stepBox(96, 200, 210, 70, 5, "Your control", "No surprise changes")}
      ${stepBox(334, 200, 210, 70, 6, "Clear outcome", "Release or refund")}
      ${arrow(245, 160, 200, 200)}
      ${arrow(401, 160, 440, 200)}
    `),
    "physical-goods": wrap("Physical goods escrow", `
      ${stepBox(24, 90, 180, 70, 1, "Buyer funds", "Sandbox escrow")}
      ${stepBox(230, 90, 180, 70, 2, "Seller ships", "Tracking shared")}
      ${stepBox(436, 90, 180, 70, 3, "Buyer confirms", "Delivery verified")}
      ${stepBox(230, 200, 180, 70, 4, "Escrow releases", "Simulated payout")}
      ${stepBox(436, 200, 180, 70, 5, "Receipt", "Demo evidence")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "buy-crypto": wrap("Buy crypto to your own wallet", `
      ${stepBox(24, 90, 180, 70, 1, "Choose token", "USDC or USDT")}
      ${stepBox(230, 90, 180, 70, 2, "Set wallet", "Your address")}
      ${stepBox(436, 90, 180, 70, 3, "Review quote", "Rate + fees")}
      ${stepBox(230, 200, 180, 70, 4, "Provider KYC", "Official provider")}
      ${stepBox(436, 200, 180, 70, 5, "Receive", "Own wallet only")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "swap": wrap("External token swap flow", `
      ${stepBox(24, 90, 180, 70, 1, "Select pair", "From → To")}
      ${stepBox(230, 90, 180, 70, 2, "Enter amount", "Balance shown")}
      ${stepBox(436, 90, 180, 70, 3, "Slippage", "Tolerance set")}
      ${stepBox(230, 200, 180, 70, 4, "Approve", "In your wallet")}
      ${stepBox(436, 200, 180, 70, 5, "Receive", "Own wallet only")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "wallet-qr": wrap("Wallet receive QR", `
      ${stepBox(24, 90, 180, 70, 1, "Enter address", "Your wallet")}
      ${stepBox(230, 90, 180, 70, 2, "Choose token", "Solana mint")}
      ${stepBox(436, 90, 180, 70, 3, "Show QR", "Transfer request")}
      ${stepBox(230, 200, 180, 70, 4, "Payer scans", "Verify details")}
      ${stepBox(436, 200, 180, 70, 5, "Receive", "Not escrow funding")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "clear-scope": wrap("Clear scope checklist", `
      ${stepBox(24, 90, 180, 70, 1, "Define deliverable", "What is included")}
      ${stepBox(230, 90, 180, 70, 2, "Set acceptance", "How it passes")}
      ${stepBox(436, 90, 180, 70, 3, "Set deadline", "When it is due")}
      ${stepBox(230, 200, 180, 70, 4, "Add remedy", "Revision or refund")}
      ${stepBox(436, 200, 180, 70, 5, "Both approve", "Then fund")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "funding-safely": wrap("Funding safety checklist", `
      ${stepBox(24, 90, 180, 70, 1, "Read", "The agreement")}
      ${stepBox(230, 90, 180, 70, 2, "Use", "Your own wallet")}
      ${stepBox(436, 90, 180, 70, 3, "Check", "Amount + recipient")}
      ${stepBox(230, 200, 180, 70, 4, "Approve", "Only what you expect")}
      ${stepBox(436, 200, 180, 70, 5, "Wait", "For the final status")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
      <text x="24" y="302" class="t s">Something looks wrong? Stop, save the receipt and contact support.</text>
    `),
    "jupiter-register": wrap("Jupiter Spend setup", `
      ${stepBox(24, 90, 180, 70, 1, "Open official app", "Check publisher")}
      ${stepBox(230, 90, 180, 70, 2, "Set up Jupiter ID", "Account access")}
      ${stepBox(436, 90, 180, 70, 3, "Check eligibility", "Country + issuer")}
      ${stepBox(230, 200, 180, 70, 4, "Complete verification", "In official flow")}
      ${stepBox(436, 200, 180, 70, 5, "Use Spend", "Separate USD balance")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "jupiter-kyc": wrap("Jupiter Spend verification", `
      ${stepBox(24, 90, 180, 70, 1, "Confirm eligibility", "Age + residence")}
      ${stepBox(230, 90, 180, 70, 2, "Prepare documents", "Official request")}
      ${stepBox(436, 90, 180, 70, 3, "Complete liveness", "Provider flow")}
      ${stepBox(230, 200, 180, 70, 4, "Wait for review", "Status in app")}
      ${stepBox(436, 200, 180, 70, 5, "Protect secrets", "Never share seed")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "jupiter-card": wrap("Jupiter card flow", `
      ${stepBox(24, 90, 180, 70, 1, "Check issuer", "Region dependent")}
      ${stepBox(230, 90, 180, 70, 2, "Deposit supported asset", "Follow app address")}
      ${stepBox(436, 90, 180, 70, 3, "Convert to USD", "Review terms")}
      ${stepBox(230, 200, 180, 70, 4, "Control card", "Freeze + limits")}
      ${stepBox(436, 200, 180, 70, 5, "Pay merchant", "Card rails")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "jupiter-qr": wrap("Jupiter merchant QR versus wallet QR", `
      ${stepBox(24, 90, 180, 70, 1, "Merchant QR", "Spend app")}
      ${stepBox(230, 90, 180, 70, 2, "Spend USD", "Card balance")}
      ${stepBox(436, 90, 180, 70, 3, "Merchant pays", "Local network")}
      ${stepBox(230, 200, 180, 70, 4, "Wallet receive QR", "Your address")}
      ${stepBox(436, 200, 180, 70, 5, "No escrow funding", "Different purpose")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "milestone-planning": wrap("Milestone planning before funding", `
      ${stepBox(24, 90, 180, 70, 1, "Define outcome", "Observable deliverable")}
      ${stepBox(230, 90, 180, 70, 2, "Split stages", "One acceptance test")}
      ${stepBox(436, 90, 180, 70, 3, "Set remedy", "Revision or refund")}
      ${stepBox(230, 200, 180, 70, 4, "Name evidence", "What proves done")}
      ${stepBox(436, 200, 180, 70, 5, "Both approve", "Then fund")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "dispute-safely": wrap("Dispute without losing the evidence trail", `
      ${stepBox(24, 90, 180, 70, 1, "Pause", "Freeze one milestone")}
      ${stepBox(230, 90, 180, 70, 2, "Collect", "Facts + timestamps")}
      ${stepBox(436, 90, 180, 70, 3, "Respond", "Other party's view")}
      ${stepBox(230, 200, 180, 70, 4, "Review", "Bounded decision")}
      ${stepBox(436, 200, 180, 70, 5, "Release or refund", "Recorded outcome")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "onchain-reconciliation": wrap("How to check a payment", `
      ${stepBox(24, 90, 180, 70, 1, "Open", "The deal")}
      ${stepBox(230, 90, 180, 70, 2, "Check", "Asset + amount")}
      ${stepBox(436, 90, 180, 70, 3, "Check", "Recipient")}
      ${stepBox(230, 200, 180, 70, 4, "Wait", "Completed status")}
      ${stepBox(436, 200, 180, 70, 5, "Keep", "Your receipt")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "wallet-security": wrap("Safe wallet checkpoints", `
      ${stepBox(24, 90, 180, 70, 1, "Use your wallet", "Never share seed")}
      ${stepBox(230, 90, 180, 70, 2, "Check network", "Asset + network")}
      ${stepBox(436, 90, 180, 70, 3, "Read request", "Amount + recipient")}
      ${stepBox(230, 200, 180, 70, 4, "Approve", "Only what you expect")}
      ${stepBox(436, 200, 180, 70, 5, "Disconnect", "When finished")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "protection-receipts": wrap("What a deal receipt shows", `
      ${stepBox(24, 90, 180, 70, 1, "Agreement", "Terms commitment")}
      ${stepBox(230, 90, 180, 70, 2, "Asset", "Currency + amount")}
      ${stepBox(436, 90, 180, 70, 3, "Parties", "Buyer + seller")}
      ${stepBox(230, 200, 180, 70, 4, "Status", "Pending or complete")}
      ${stepBox(436, 200, 180, 70, 5, "Limits", "Not a guarantee")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "rights-deadlines": wrap("Rights and deadline dashboard", `
      ${stepBox(24, 90, 180, 70, 1, "Action owner", "Buyer · seller · reviewer")}
      ${stepBox(230, 90, 180, 70, 2, "Permitted step", "One safe next action")}
      ${stepBox(436, 90, 180, 70, 3, "Deadline", "Delivery or review")}
      ${stepBox(230, 200, 180, 70, 4, "Evidence", "Criterion by criterion")}
      ${stepBox(436, 200, 180, 70, 5, "Fallback", "Caveat, not guarantee")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "fee-sponsorship": wrap("Fee support, explained", `
      ${stepBox(24, 90, 180, 70, 1, "Your approval", "Still required")}
      ${stepBox(230, 90, 180, 70, 2, "Fee support", "Covers one cost")}
      ${stepBox(436, 90, 180, 70, 3, "Limits", "Check eligibility")}
      ${stepBox(230, 200, 180, 70, 4, "Try once", "Check status first")}
      ${stepBox(436, 200, 180, 70, 5, "Get help", "If unsure")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `),
    "action-center": wrap("Your Action Center", `
      ${stepBox(24, 90, 180, 70, 1, "Open deals", "See what needs care")}
      ${stepBox(230, 90, 180, 70, 2, "Your role", "Buyer · seller · reviewer")}
      ${stepBox(436, 90, 180, 70, 3, "Priority", "Urgent first")}
      ${stepBox(230, 200, 180, 70, 4, "Deal room", "Existing safe flow")}
      ${stepBox(436, 200, 180, 70, 5, "Take action", "Follow the agreement")}
      ${arrow(204, 125, 230, 125)}
      ${arrow(410, 125, 436, 125)}
      ${arrow(526, 160, 410, 200)}
      ${arrow(410, 235, 436, 235)}
    `)
  };

  return diagrams[visualId] || wrap("Tutorial visual", `
    ${stepBox(24, 90, 180, 70, 1, "Learn", "Concept overview")}
    ${stepBox(230, 90, 180, 70, 2, "Practice", "Sandbox steps")}
    ${stepBox(436, 90, 180, 70, 3, "Review", "Checklist")}
    ${arrow(204, 125, 230, 125)}
    ${arrow(410, 125, 436, 125)}
  `);
}

export function guidebookIntro() {
  return `
<section class="guidebook-intro" aria-label="Guidebook introduction" style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12263f;background:#f7f3e8;padding:24px;border-radius:14px">
  <h2 style="margin:0 0 8px;font-size:22px">Learn by doing — safely</h2>
  <p style="margin:0 0 18px;max-width:60ch;line-height:1.5">
    Every guide pairs a clear visual with step-by-step practice in a sandbox.
    You will see real flows — funding, shipping, swapping, pairing — without
    touching live custody or real funds.
  </p>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
    <div style="background:#fff;border:1px solid #c9d6e3;border-radius:10px;padding:14px">
      <div style="font-size:26px;font-weight:700;color:#0f9b8e">23</div>
      <div style="font-size:13px;color:#3b4a5a">Guides and visual flows</div>
    </div>
    <div style="background:#fff;border:1px solid #c9d6e3;border-radius:10px;padding:14px">
      <div style="font-size:26px;font-weight:700;color:#0f9b8e">100%</div>
      <div style="font-size:13px;color:#3b4a5a">Sandbox — no live custody</div>
    </div>
    <div style="background:#fff;border:1px solid #c9d6e3;border-radius:10px;padding:14px">
      <div style="font-size:26px;font-weight:700;color:#0f9b8e">0</div>
      <div style="font-size:13px;color:#3b4a5a">Real funds required</div>
    </div>
  </div>
</section>`;
}
