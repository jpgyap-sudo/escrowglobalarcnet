/**
 * Escrow Global — executable, OFF-CHAIN reference model. SANDBOX ONLY.
 * This is not a smart contract, custody service, wallet, or authentication system.
 * Monetary values are decimal strings of integer micro-units (6 decimals).
 * applyCommand is transactional: failed commands never mutate the input state.
 */
import { ASSET_CODES, DEMO_TOKENS, isAsset, emptyBalances, emptyTreasuryBalances, emptyInitialFunds } from './settlement-assets.mjs';
import { initializeTermsHash, refreshCurrentTermsHash, verifyCurrentTermsHash } from './agreement.mjs';
export { ASSET_CODES, DEMO_TOKENS, isAsset };
export const PLATFORM_BPS = 300;
export const DISPUTE_BPS = 500;
export const DAY = 86400000;
export const DEMO_TREASURY = 'DEMO_PLATFORM_FEES_NOT_A_WALLET';
export const CATEGORIES = ['Development', 'Design', 'AI & automation', 'Video & animation', 'Writing', 'Marketing'];
const MAX = 100000n * 1000000n;
const terminal = m => ['released', 'refunded', 'settled'].includes(m.status);
const uid = p => { const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12)); return `${p}_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`; };
export class DomainError extends Error { constructor(message, code = 'INVALID_ACTION') { super(message); this.code = code; } }
const must = (condition, message, code) => { if (!condition) throw new DomainError(message, code); };
export function units(value) {
  must(typeof value === 'string' && /^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value), 'Use a nonnegative decimal amount, with up to 6 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  must(result <= MAX, 'The sandbox maximum is 100,000 demo units per amount.');
  return result.toString();
}
export function money(value, decimals) {
  const n = BigInt(value);
  const whole = (n / 1000000n).toLocaleString('en-US');
  const fraction = (n % 1000000n).toString().padStart(6, '0');
  if (decimals === 0) return whole;
  if (decimals === 2) return whole + '.' + fraction.slice(0, 2);
  if (decimals === 6) return whole + '.' + fraction;
  if (decimals !== undefined) return whole + '.' + fraction.slice(0, decimals);
  if (fraction.slice(2) === '0000') return whole + '.' + fraction.slice(0, 2);
  let end = 6;
  while (end > 2 && fraction[end - 1] === '0') end--;
  return whole + '.' + fraction.slice(0, end);
}
export const fee = (value, bps = PLATFORM_BPS) => (BigInt(value) * BigInt(bps) / 10000n).toString();
export const sum = values => values.reduce((n, v) => n + BigInt(v), 0n).toString();
export const escrowHeld = order => sum(order.milestones.flatMap(m => [m.held, m.reserve]));
export const principalHeld = order => sum(order.milestones.map(m => m.held));
export const sellerPaid = order => sum(order.milestones.map(m => m.sellerPaid));
export function orderStatus(order) {
  if (!order.acceptedAt) return order.cancelled ? 'cancelled' : 'awaiting acceptance';
  if (!order.fundedAt) return order.cancelled ? 'cancelled' : 'awaiting funding';
  if (order.milestones.some(m => m.status === 'disputed')) return 'disputed';
  if (order.milestones.every(terminal)) return BigInt(sellerPaid(order)) === 0n ? 'refunded' : 'completed';
  if (order.milestones.some(m => m.status === 'submitted')) return 'in review';
  return 'in progress';
}
function text(value, name, min = 1, max = 6000) {
  must(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max, `${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
function integer(value, name, min, max) {
  must(Number.isInteger(value) && value >= min && value <= max, `${name} must be an integer from ${min} to ${max}.`);
  return value;
}
function exact(payload, allowed) {
  must(payload && typeof payload === 'object' && !Array.isArray(payload), 'A command payload is required.');
  for (const key of Object.keys(payload)) must(allowed.includes(key), `Unsupported field: ${key}. Payment destinations and fee rules cannot be changed.`);
}
function getUser(s, id) { const u = s.users.find(u => u.id === id); must(u, 'Unknown demo identity.', 'FORBIDDEN'); return u; }
function isParty(order, actor) { return [order.buyerId, order.sellerId].includes(actor.id); }
function event(order, actor, description, now) {
  order.events.push({ id: uid('evt'), actorId: actor.id, text: description, at: now, asset: order.asset });
}
function credit(user, asset, value) {
  must(isAsset(asset), 'Unknown asset.');
  user.balances[asset] = (BigInt(user.balances[asset]) + BigInt(value)).toString();
}
function debit(user, asset, value) {
  must(isAsset(asset), 'Unknown asset.');
  must(BigInt(user.balances[asset]) >= BigInt(value), 'This demo identity does not have enough simulated credit in the selected asset.');
  user.balances[asset] = (BigInt(user.balances[asset]) - BigInt(value)).toString();
}
function invalidateProposal(m, status = 'superseded') {
  if (m.proposal?.status === 'pending') m.proposal.status = status;
  m.revision++;
}
function settle(s, order, m, sellerAmount, now) {
  const asset = order.asset;
  must(isAsset(asset), 'Order asset is invalid.');
  const amount = BigInt(sellerAmount);
  must(amount >= 0n && amount <= BigInt(m.held), 'Settlement cannot exceed this milestone’s held principal.');
  const commission = BigInt(fee(sellerAmount, order.feeBps));
  const refund = BigInt(m.held) - amount;
  const unusedReserve = BigInt(m.reserve) - commission;
  must(unusedReserve >= 0n, 'Insufficient commission reserve.');
  const buyer = getUser(s, order.buyerId), seller = getUser(s, order.sellerId);
  // Destinations are resolved ONLY from the immutable order parties.
  credit(seller, asset, amount);
  credit(buyer, asset, refund + unusedReserve);
  s.treasury.balances[asset].commission = (BigInt(s.treasury.balances[asset].commission) + commission).toString();
  m.sellerPaid = (BigInt(m.sellerPaid) + amount).toString();
  m.buyerRefunded = (BigInt(m.buyerRefunded) + refund).toString();
  m.feePaid = (BigInt(m.feePaid) + commission).toString();
  m.status = amount === 0n ? 'refunded' : refund === 0n ? 'released' : 'settled';
  m.held = '0'; m.reserve = '0'; m.settledAt = now;
  if (m.dispute?.status === 'open') m.dispute.status = 'resolved';
  invalidateProposal(m);
}
export function totalFunds(s, asset = 'USDC') {
  must(isAsset(asset), 'Unknown asset.');
  const userSum = sum(s.users.map(u => u.balances[asset]));
  const escrowSum = sum(s.orders.filter(o => o.asset === asset).map(escrowHeld));
  const t = s.treasury.balances[asset];
  return sum([userSum, escrowSum, t.commission, t.disputeFees]);
}
const MICRO_RE = /^(0|[1-9]\d*)$/;
const isMicro = v => typeof v === 'string' && MICRO_RE.test(v);
const MONEY_FIELDS = ['originalAmount','held','reserve','sellerPaid','buyerRefunded','feePaid'];
function checkBalancesExact(obj, label) {
  must(obj && typeof obj === 'object' && !Array.isArray(obj), `${label} must be an object.`);
  const keys = Object.keys(obj);
  must(keys.length === ASSET_CODES.length && ASSET_CODES.every(a => keys.includes(a)), `${label} must contain exactly ${ASSET_CODES.join(' and ')}.`);
  for (const a of ASSET_CODES) must(isMicro(obj[a]), `${label}.${a} must be a nonnegative integer micro-unit string.`);
}
function checkSparsePrices(prices, label) {
  must(prices && typeof prices === 'object' && !Array.isArray(prices), `${label} must be a map.`);
  const keys = Object.keys(prices);
  must(keys.length >= 1, `${label} must quote at least one asset.`);
  for (const k of keys) {
    must(ASSET_CODES.includes(k), `${label} contains unsupported asset: ${k}.`);
    must(isMicro(prices[k]), `${label}.${k} must be a nonnegative integer micro-unit string.`);
    must(BigInt(prices[k]) >= 1000000n, `${label}.${k} must be at least 1 demo unit.`);
    must(BigInt(prices[k]) <= MAX, `${label}.${k} exceeds the sandbox maximum.`);
  }
  return keys.slice().sort().join(',');
}
export function assertInvariants(s, before = null) {
  must(s && typeof s === 'object', 'State required.');
  must(s.schemaVersion === 3, 'State schemaVersion must be 3.');
  must(s.mode === 'sandbox', 'State mode must be sandbox.');
  must(!Object.prototype.hasOwnProperty.call(s, 'universalVersion') || s.universalVersion === 2, 'State universalVersion must be 2 when present.');
  must(Number.isSafeInteger(s.version) && s.version >= 1, 'State version must be a safe integer >= 1.');
  must(Array.isArray(s.reviews), 'reviews must be an array.');
  must(Array.isArray(s.users), 'users must be an array.');
  must(Array.isArray(s.orders), 'orders must be an array.');
  must(Array.isArray(s.listings), 'listings must be an array.');
  must(Array.isArray(s.briefs), 'briefs must be an array.');
  for (const u of s.users) {
    must(u && typeof u === 'object', 'User record required.');
    must(!('balance' in u), 'Writable scalar balance is not allowed.');
    checkBalancesExact(u.balances, `User ${u.id} balances`);
  }
  must(s.treasury && typeof s.treasury === 'object', 'treasury required.');
  must(!('amount' in s.treasury) && !('balance' in s.treasury) && !('commission' in s.treasury) && !('disputeFees' in s.treasury), 'Scalar treasury amounts are not allowed.');
  must(s.treasury.balances && typeof s.treasury.balances === 'object', 'treasury.balances required.');
  const tKeys = Object.keys(s.treasury.balances);
  must(tKeys.length === ASSET_CODES.length && ASSET_CODES.every(a => tKeys.includes(a)), `treasury.balances must contain exactly ${ASSET_CODES.join(' and ')}.`);
  for (const asset of ASSET_CODES) {
    const t = s.treasury.balances[asset];
    must(t && typeof t === 'object' && !Array.isArray(t), `treasury.balances.${asset} required.`);
    const tk = Object.keys(t);
    must(tk.length === 2 && tk.includes('commission') && tk.includes('disputeFees'), `treasury.balances.${asset} must contain exactly commission and disputeFees.`);
    must(isMicro(t.commission), `treasury.balances.${asset}.commission must be a nonnegative integer micro-unit string.`);
    must(isMicro(t.disputeFees), `treasury.balances.${asset}.disputeFees must be a nonnegative integer micro-unit string.`);
  }
  must(!('initialFunds' in s), 'Scalar initialFunds is not allowed.');
  checkBalancesExact(s.initialFundsByAsset, 'initialFundsByAsset');
  for (const l of s.listings) {
    must(l && typeof l === 'object', 'Listing record required.');
    const expectedPackages = l.kind === 'goods' ? 1 : 3;
    must(Array.isArray(l.packages) && l.packages.length === expectedPackages, `Listing ${l.id} must have ${expectedPackages} package(s).`);
    let refKeys = null;
    for (const pkg of l.packages) {
      must(pkg && typeof pkg === 'object', `Listing ${l.id} package required.`);
      must(!('price' in pkg), `Listing ${l.id} package must not carry scalar price.`);
      const keySig = checkSparsePrices(pkg.prices, `Listing ${l.id} package ${pkg.name} prices`);
      if (refKeys === null) refKeys = keySig;
      else must(keySig === refKeys, `Listing ${l.id} packages must quote the same asset set.`);
    }
    if (l.kind === 'goods') {
      must(!('shipping' in l), `Listing ${l.id} must not carry scalar shipping.`);
      must(l.shippingPrices && typeof l.shippingPrices === 'object' && !Array.isArray(l.shippingPrices), `Listing ${l.id} shippingPrices map is required.`);
      const shipKeys = Object.keys(l.shippingPrices);
      must(shipKeys.length >= 1, `Listing ${l.id} shippingPrices must quote at least one asset.`);
      for (const k of shipKeys) {
        must(ASSET_CODES.includes(k), `Listing ${l.id} shippingPrices contains unsupported asset: ${k}.`);
        must(isMicro(l.shippingPrices[k]), `Listing ${l.id} shippingPrices.${k} must be a nonnegative integer micro-unit string.`);
        must(BigInt(l.shippingPrices[k]) <= MAX, `Listing ${l.id} shippingPrices.${k} exceeds the sandbox maximum.`);
      }
      const pkgKeys = Object.keys(l.packages[0].prices).slice().sort().join(',');
      const shipSig = shipKeys.slice().sort().join(',');
      must(pkgKeys === shipSig, `Listing ${l.id} shippingPrices must have exactly the same asset keys as its package prices.`);
    }
  }
  for (const b of s.briefs) {
    must(b && typeof b === 'object', 'Brief record required.');
    must(isAsset(b.asset), `Brief ${b.id} asset must be USDC or USDT.`);
    must(isMicro(b.budget), `Brief ${b.id} budget must be a nonnegative integer micro-unit string.`);
    must(BigInt(b.budget) >= 1000000n, `Brief ${b.id} budget must be at least 1 demo unit.`);
    must(BigInt(b.budget) <= MAX, `Brief ${b.id} budget exceeds the sandbox maximum.`);
    must(Array.isArray(b.proposals), `Brief ${b.id} proposals must be an array.`);
    for (const q of b.proposals) {
      must(q && typeof q === 'object', `Brief ${b.id} proposal required.`);
      must(q.asset === b.asset, `Brief ${b.id} proposal asset must match brief asset.`);
      must(isMicro(q.amount), `Brief ${b.id} proposal amount must be a nonnegative integer micro-unit string.`);
      must(BigInt(q.amount) >= 1000000n, `Brief ${b.id} proposal amount must be at least 1 demo unit.`);
      must(BigInt(q.amount) <= MAX, `Brief ${b.id} proposal amount exceeds the sandbox maximum.`);
    }
  }
  for (const o of s.orders) {
    must(o && typeof o === 'object', 'Order record required.');
    must(o.buyerId !== o.sellerId, 'Self orders are not allowed.');
    must(isAsset(o.asset), `Order ${o.id} asset must be USDC or USDT.`);
    must(o.token === DEMO_TOKENS[o.asset], `Order ${o.id} token must match DEMO_TOKENS[${o.asset}].`);
    must(o.feeBps === PLATFORM_BPS, `Order ${o.id} feeBps must equal PLATFORM_BPS.`);
    must(o.disputeBps === DISPUTE_BPS, `Order ${o.id} disputeBps must equal DISPUTE_BPS.`);
    must(o.feeWallet === DEMO_TREASURY, `Order ${o.id} feeWallet must equal DEMO_TREASURY.`);
    if (o.snapshot && Object.hasOwn(o.snapshot, 'asset')) must(o.snapshot.asset === o.asset, `Order ${o.id} snapshot.asset must match order.asset.`);
    must(Array.isArray(o.milestones), `Order ${o.id} milestones required.`);
    for (const m of o.milestones) {
      must(m && typeof m === 'object', `Order ${o.id} milestone required.`);
      for (const f of MONEY_FIELDS) must(isMicro(m[f]), `Order ${o.id} milestone ${m.id} ${f} must be a nonnegative integer micro-unit string.`);
      if (o.fundedAt) {
        must(sum([m.held, m.sellerPaid, m.buyerRefunded]) === m.originalAmount, 'Milestone principal conservation failed.');
        must(m.reserve === fee(m.held, o.feeBps), 'Milestone reserve mismatch.');
      }
      if (terminal(m)) must(m.held === '0' && m.reserve === '0', 'Settled milestones cannot retain funds.');
    }
    const old = before?.orders?.find(x => x.id === o.id);
    if (old) for (const k of ['buyerId','sellerId','buyerWallet','sellerWallet','feeWallet','token','asset','feeBps','disputeBps','snapshot']) {
      must(JSON.stringify(old[k]) === JSON.stringify(o[k]), `Immutable order field changed: ${k}`);
    }
    must(verifyCurrentTermsHash(o), 'Agreement terms hash does not match the current terms.');
  }
  for (const asset of ASSET_CODES) {
    must(totalFunds(s, asset) === s.initialFundsByAsset[asset], `Internal error: conservation of simulated ${asset} funds failed.`);
  }
  return true;
}
function makePackages(base, scope, days) {
  return ['Essential', 'Professional', 'Complete'].map((name, i) => ({
    name, prices: { USDC: units(String(base * [1, 2, 3.5][i])), USDT: units(String(base * [1, 2, 3.5][i])) },
    days: days + i * 3, revisions: i + 1,
    description: [scope, `${scope} Plus expanded deliverables and source handover.`, `${scope} Full handover, documentation, and a post-delivery walkthrough.`][i]
  }));
}
export function createEmptyState(now = Date.now()) {
  const users = [
    ['buyer','Alex Morgan','AM','buyer','Building an independent business.'],
    ['maya','Maya Chen','MC','seller','Product designer and frontend developer.'],
    ['samir','Samir Patel','SP','seller','Practical AI and workflow automation.'],
    ['noa','Noa Rivera','NR','seller','Brand identity with a thoughtful point of view.'],
    ['leila','Leila Hassan','LH','seller','Motion designer and visual storyteller.'],
    ['kai','Kai Brooks','KB','seller','Clear words for ambitious products.'],
    ['hana','Hana Park','HP','seller','Growth systems and content strategy.'],
    ['reviewer','Escrow Global Review Team','EG','admin','Restricted resolution authority in this sandbox.']
  ].map(([id,name,initials,role,bio]) => ({id,name,initials,role,bio,wallet:`DEMO_${id.toUpperCase()}_NOT_A_REAL_WALLET`,balances:{USDC:units('25000'),USDT:units('25000')}}));
  const seed = [
    ['web','maya','Build a website that turns your idea into a business','Development',450,7,'A responsive, five-section landing page with a working contact form.','web','Design it.\nBuild it.\nShip it.',['Responsive at 390 px and 1440 px','Working contact form with validation','Source files and deployment instructions']],
    ['ai','samir','Automate the busywork with a custom AI workflow','AI & automation',250,5,'One documented automation connecting up to three agreed tools.','ai','Less busywork.\nMore possibility.',['Demonstration with agreed sample inputs','Error handling and human approval step','Workflow export and setup guide']],
    ['brand','noa','Design a distinctive identity for your next big thing','Design',180,5,'A primary logo, wordmark, color palette, and a concise style guide.','brand','A little bold.\nEntirely you.',['Two initial visual directions','Final SVG and PNG exports','Font licensing and color specifications']],
    ['motion','leila','Bring your product story to life with motion','Video & animation',300,6,'A 30-second product animation from your approved script.','motion','Make your\nfirst impression\nmove.',['Approved storyboard before animation','1080p MP4 export and captions','Music and asset license notes']],
    ['copy','kai','Write a landing page people actually want to read','Writing',120,3,'Conversion-focused copy for five landing-page sections.','copy','Good words.\nGreat outcomes.',['One headline set and five sections','Editable document and source notes','No unsupported product claims']],
    ['growth','hana','Create a launch plan with a clear next step','Marketing',220,5,'An actionable launch plan and four-week editorial calendar.','growth','From idea\nto your people.',['Audience and channel rationale','Four-week content calendar','Measurement plan; no revenue guarantee']],
    ['app','maya','Design an intuitive dashboard for your product','Design',350,6,'Three dashboard screens in an editable design file.','app','Complexity,\nmade clear.',['Desktop and mobile layouts','Reusable component library','Developer handover notes']],
    ['agent','samir','Build a support assistant with human handoff','AI & automation',500,8,'A sandbox knowledge assistant using your approved help content.','agent','Helpful by design.',['Responses grounded in supplied documents','Clear fallback and human escalation','Test cases and deployment guide']]
  ];
  const listings = seed.map(([id,sellerId,title,category,base,days,scope,cover,headline,criteria]) => ({
    id,sellerId,title,category,description:scope,cover,headline,criteria,packages:makePackages(base,scope,days),
    tags:[category, 'Fixed scope', 'Milestone ready'],status:'published',createdAt:now, sample:true
  }));
  const initialFundsByAsset = { USDC: '0', USDT: '0' };
  for (const asset of ASSET_CODES) {
    initialFundsByAsset[asset] = sum(users.map(u => u.balances[asset]));
  }
  return {schemaVersion:3,version:1,mode:'sandbox',createdAt:now,users,listings,orders:[],briefs:[],reviews:[],treasury:{wallet:DEMO_TREASURY,balances:emptyTreasuryBalances()},initialFundsByAsset};
}
/** Return {state,result}. Identity selection is for local simulation, not authentication. */
export function applyCommand(input, actorId, command, p = {}, context = {}) {
  const s = structuredClone(input), now = context.now ?? Date.now(), actor = getUser(s, actorId);
  let result = null;
  if (command === 'create_listing') {
    exact(p,['title','category','description','criteria','packages','cover']);
    must(actor.role === 'seller', 'Only a seller can create a service.', 'FORBIDDEN');
    must(CATEGORIES.includes(p.category), 'Choose a supported category.');
    must(Array.isArray(p.criteria) && p.criteria.length >= 1 && p.criteria.length <= 10,'Provide 1–10 acceptance criteria.');
    must(Array.isArray(p.packages) && p.packages.length === 3, 'Provide three packages.');
    const packages = p.packages.map(pkg => {
      exact(pkg,['name','price','prices','days','revisions','description']);
      must(!('price' in pkg) || !('prices' in pkg), 'Provide either price (legacy USDC) or prices map, not both.');
      let prices;
      if ('prices' in pkg) {
        must(pkg.prices && typeof pkg.prices === 'object' && !Array.isArray(pkg.prices), 'Package prices must be a map.');
        const keys = Object.keys(pkg.prices);
        must(keys.length >= 1, 'Each package must quote at least one asset.');
        prices = {};
        for (const key of keys) {
          must(ASSET_CODES.includes(key), `Unsupported asset in package prices: ${key}.`);
          const v = units(pkg.prices[key]);
          must(BigInt(v) >= 1000000n, 'Each quoted package price must be at least 1 demo unit.');
          prices[key] = v;
        }
      } else {
        must(typeof pkg.price === 'string', 'Package price is required.');
        const v = units(pkg.price);
        must(BigInt(v) >= 1000000n, 'Each quoted package price must be at least 1 demo unit.');
        prices = { USDC: v };
      }
      return {name:text(pkg.name,'Package name',2,40),prices,days:integer(pkg.days,'Delivery days',1,90),revisions:integer(pkg.revisions,'Revisions',0,20),description:text(pkg.description,'Package scope',15,2000)};
    });
    const quotedSets = packages.map(pkg => Object.keys(pkg.prices).slice().sort().join(','));
    must(quotedSets.every(x => x === quotedSets[0]), 'All packages in a listing must quote the same asset set.');
    const listing = {id:uid('svc'),sellerId:actor.id,title:text(p.title,'Service title',10,120),category:p.category,
      description:text(p.description,'Description',20,6000),criteria:p.criteria.map(x=>text(x,'Acceptance condition',8,500)),packages,
      cover:['web','ai','brand','motion','copy','growth','app','agent'].includes(p.cover)?p.cover:'web',headline:'Your next\ngreat project.',tags:[p.category,'Fixed scope'],status:'pending',createdAt:now,sample:false};
    s.listings.unshift(listing); result = listing.id;
  } else if (command === 'moderate_listing') {
    exact(p,['listingId','decision']); must(actor.role === 'admin','Only the review team can moderate listings.','FORBIDDEN');
    const listing = s.listings.find(x=>x.id===p.listingId); must(listing,'Service not found.');
    must(['published','hidden'].includes(p.decision),'Choose publish or hide.'); listing.status=p.decision;
  } else if (command === 'pause_listing') {
    exact(p,['listingId']); const l=s.listings.find(x=>x.id===p.listingId); must(l && l.sellerId===actor.id,'This is not your service.','FORBIDDEN');
    must(['published','paused'].includes(l.status),'Only an approved listing can be paused.'); l.status=l.status==='published'?'paused':'published';
  } else if (command === 'create_order') {
    exact(p,['listingId','packageIndex','sellerId','title','amount','scope','criteria','requirements','days','revisions','milestones','acceptance','asset']);
    must(actor.role !== 'admin','The review team cannot be a party to a deal.','FORBIDDEN');
    let listing=null, pkg=null, asset='USDC';
    if (p.listingId) {
      listing=s.listings.find(x=>x.id===p.listingId && x.status==='published'); must(listing,'This service is not available.');
      pkg=listing.packages[integer(p.packageIndex,'Package',0,2)];
      for (const key of ['sellerId','title','amount','scope','criteria','days','revisions']) must(!(key in p),`A listed package cannot override ${key}.`);
      if (p.asset !== undefined) {
        must(isAsset(p.asset), 'Asset must be USDC or USDT.');
        must(Object.hasOwn(pkg.prices, p.asset), 'This package does not quote the selected asset.');
        asset = p.asset;
      } else {
        must(Object.hasOwn(pkg.prices, 'USDC'), 'This package does not quote USDC.');
        asset = 'USDC';
      }
    } else {
      if (p.asset !== undefined) { must(isAsset(p.asset), 'Asset must be USDC or USDT.'); asset = p.asset; }
      else asset = 'USDC';
    }
    const seller=getUser(s,listing?.sellerId??p.sellerId);
    must(seller.role==='seller' && seller.id!==actor.id,'Choose a different seller. Self-dealing is not allowed.');
    const amount=pkg ? pkg.prices[asset] : units(p.amount); must(BigInt(amount)>=1000000n,'Deal must be at least 1 demo unit.');
    const scope=pkg?.description??text(p.scope,'Scope',20,6000);
    const criteria=listing?.criteria??p.criteria;
    must(Array.isArray(criteria)&&criteria.length>=1&&criteria.length<=10,'Provide acceptance conditions.');
    const days=pkg?.days??integer(p.days,'Delivery days',1,90);
    const title=listing?.title??text(p.title,'Title',8,120);
    must(['manual','timed'].includes(p.acceptance),'Select an acceptance policy.');
    const split = p.milestones === true ? [20,50,30] : [100];
    const mAmounts=split.map((pct,i)=>i===split.length-1?BigInt(amount)-split.slice(0,i).reduce((n,x)=>n+BigInt(amount)*BigInt(x)/100n,0n):BigInt(amount)*BigInt(pct)/100n);
    const o={id:uid('deal'),buyerId:actor.id,sellerId:seller.id,buyerWallet:actor.wallet,sellerWallet:seller.wallet,feeWallet:DEMO_TREASURY,
      token:DEMO_TOKENS[asset],asset,feeBps:PLATFORM_BPS,disputeBps:DISPUTE_BPS,listingId:listing?.id??null,
      title,createdAt:now,acceptedAt:null,fundedAt:null,cancelled:false,version:1,
      snapshot:{title,scope,criteria:criteria.map(x=>text(x,'Acceptance criterion',8,500)),requirements:text(p.requirements,'Buyer requirements',20,6000),
        package:pkg?.name??'Private agreement',days,revisions:pkg?.revisions??integer(p.revisions??1,'Revisions',0,20),acceptance:p.acceptance,asset,
        commissionPolicy:'Buyer adds 3%; earned on seller principal released; unused reserve refunded.',disputePolicy:'Initiator pays an additional non-refundable 5% of the milestone principal in dispute.'},
      milestones:mAmounts.map((n,i)=>({id:uid('ms'),title:split.length===1?'Delivery & handover':['Direction & plan','Build & deliver','Handover & finish'][i],
        originalAmount:n.toString(),held:'0',reserve:'0',sellerPaid:'0',buyerRefunded:'0',feePaid:'0',status:'unfunded',
        dueOffset:split.length===1?days:Math.max(1,Math.ceil(days*(i+1)/3)),dueAt:null,criteria:criteria.map(x=>text(x,'Acceptance criterion',8,500)),scope,
        revisionsUsed:0,revision:1,deliveries:[],proposal:null,proposalHistory:[],dispute:null,disputeHistory:[],termsHistory:[]})),events:[],messages:[]};
    initializeTermsHash(o);
    event(o,actor,'Buyer approved the agreement. Waiting for the seller’s acceptance.',now); s.orders.unshift(o); result=o.id;
  } else if (command === 'post_brief') {
    exact(p,['title','category','budget','description','asset']); must(actor.role!=='admin','A review identity cannot post a brief.','FORBIDDEN');
    must(CATEGORIES.includes(p.category),'Choose a category.');
    const asset = p.asset === undefined ? 'USDC' : p.asset;
    must(isAsset(asset), 'Asset must be USDC or USDT.');
    const budget=units(p.budget); must(BigInt(budget)>=1000000n,'Budget must be at least 1.');
    const b={id:uid('brief'),buyerId:actor.id,title:text(p.title,'Brief title',10,120),category:p.category,budget,asset,description:text(p.description,'Brief',30,5000),createdAt:now,proposals:[]};
    s.briefs.unshift(b);result=b.id;
  } else if (command === 'quote_brief') {
    exact(p,['briefId','amount','scope','days']); must(actor.role==='seller','Only sellers can send offers.','FORBIDDEN');
    const b=s.briefs.find(x=>x.id===p.briefId); must(b && b.buyerId!==actor.id,'Brief not available.');
    must(!b.proposals.some(x=>x.sellerId===actor.id),'You already have an offer on this brief.');
    const amount=units(p.amount); must(BigInt(amount)>=1000000n,'Offer must be at least 1.');
    b.proposals.push({id:uid('quote'),sellerId:actor.id,amount,asset:b.asset,scope:text(p.scope,'Offer scope',20,3000),days:integer(p.days,'Delivery days',1,90),at:now});
  } else {
    const schemas={
      accept_order:['orderId','expectedVersion'],cancel_unfunded:['orderId','expectedVersion'],fund_order:['orderId','expectedVersion'],
      submit_delivery:['orderId','milestoneId','expectedVersion','text','evidence'],
      approve_delivery:['orderId','milestoneId','expectedVersion','criteriaAccepted'],
      request_revision:['orderId','milestoneId','expectedVersion','reason'],
      open_dispute:['orderId','milestoneId','expectedVersion','reason','acknowledgeFee'],
      resolve_release:['orderId','milestoneId','expectedVersion','reason'],resolve_refund:['orderId','milestoneId','expectedVersion','reason'],
      propose_terms:['orderId','milestoneId','expectedVersion','kind','amount','scope','days'],
      accept_terms:['orderId','milestoneId','expectedVersion','proposalId'],reject_terms:['orderId','milestoneId','expectedVersion','proposalId'],
      execute_timeout:['orderId','milestoneId','expectedVersion'],claim_late_refund:['orderId','milestoneId','expectedVersion'],
      add_message:['orderId','expectedVersion','text'],leave_review:['orderId','expectedVersion','rating','text']
    };
    must(command in schemas,'Unknown command. No arbitrary transfer or wallet-change endpoint exists.'); exact(p,schemas[command]);
    const o=s.orders.find(x=>x.id===p.orderId); must(o,'Deal not found.');
    must(isParty(o,actor)||actor.role==='admin','Only the parties and review team can access this deal.','FORBIDDEN');
    must(verifyCurrentTermsHash(o), 'Agreement terms hash does not match the current terms.');
    must(p.expectedVersion===o.version,'This deal changed. Refresh before trying again.','STALE_VERSION');
    const m=p.milestoneId?o.milestones.find(x=>x.id===p.milestoneId):null;
    if (p.milestoneId) must(m,'Milestone not found.');
    const buyer=()=>must(actor.id===o.buyerId,'Only the original buyer can do this.','FORBIDDEN');
    const seller=()=>must(actor.id===o.sellerId,'Only the original seller can do this.','FORBIDDEN');
    const party=()=>must(isParty(o,actor),'Only the original parties can do this.','FORBIDDEN');
    const live=()=>must(m && o.fundedAt && !terminal(m),'This milestone has no unresolved funded principal.');
    switch(command){
      case 'accept_order': seller();must(!o.cancelled&&!o.acceptedAt,'Agreement cannot be accepted.');o.acceptedAt=now;event(o,actor,'Seller approved the exact agreement and fixed payment destinations.',now);break;
      case 'cancel_unfunded': party();must(!o.fundedAt&&!o.cancelled,'Only an unfunded agreement can be cancelled here.');o.cancelled=true;event(o,actor,'Unfunded agreement cancelled. No funds moved.',now);break;
      case 'fund_order': {
        buyer();must(o.acceptedAt&&!o.fundedAt&&!o.cancelled,'Both parties must accept before a single funding transaction.');
        const total=sum(o.milestones.flatMap(x=>[x.originalAmount,fee(x.originalAmount,o.feeBps)])); debit(actor,o.asset,total);
        o.fundedAt=now; for(const x of o.milestones){x.held=x.originalAmount;x.reserve=fee(x.held,o.feeBps);x.status='funded';x.dueAt=now+x.dueOffset*DAY;}
        event(o,actor,`${money(total)} demo ${o.asset} locked, including the commission reserve. No real funds moved.`,now);break;
      }
      case 'submit_delivery':
        seller();live();must(m.status==='funded','This milestone is not ready for a submission.');
        m.deliveries.push({id:uid('delivery'),text:text(p.text,'Delivery notes',20,6000),evidence:text(p.evidence||'No external reference supplied.','Evidence reference',1,2000),at:now});
        m.submittedAt=now;m.reviewEndsAt=now+3*DAY;m.status='submitted';invalidateProposal(m);event(o,actor,`Submitted “${m.title}” for buyer review.`,now);break;
      case 'approve_delivery':
        buyer();live();must(m.status==='submitted','A delivery must be submitted and not disputed.');must(p.criteriaAccepted===true,'Confirm that the current acceptance checklist is satisfied.');
        settle(s,o,m,m.held,now);event(o,actor,`Accepted “${m.title}”. Payment released to the original seller.`,now);break;
      case 'request_revision':
        buyer();live();must(m.status==='submitted','Only a submitted delivery can be revised.');must(m.revisionsUsed<o.snapshot.revisions,'Included revisions are used. Negotiate new terms or open a dispute.');
        m.revisionsUsed++;m.status='funded';m.dueAt=Math.max(m.dueAt,now+3*DAY);invalidateProposal(m);event(o,actor,`Revision requested for “${m.title}”: ${text(p.reason,'Revision request',15,3000)}`,now);break;
      case 'open_dispute': {
        party();live();must(['funded','submitted'].includes(m.status),'This milestone is already disputed.');
        must(p.acknowledgeFee===true,'Explicitly accept the additional non-refundable dispute charge.');
        const reason=text(p.reason,'Dispute reason',20,6000),charge=fee(m.held,o.disputeBps);debit(actor,o.asset,charge);
        s.treasury.balances[o.asset].disputeFees=(BigInt(s.treasury.balances[o.asset].disputeFees)+BigInt(charge)).toString();
        if(m.dispute) m.disputeHistory.push(m.dispute);
        m.dispute={id:uid('case'),claimantId:actor.id,reason,fee:charge,at:now,status:'open'};m.status='disputed';invalidateProposal(m);
        event(o,actor,`Dispute opened on “${m.title}”; ${money(charge)} additional demo ${o.asset} charged to the initiator. Funds frozen.`,now);break;
      }
      case 'resolve_release':case 'resolve_refund':
        must(actor.role==='admin','Only the review team can rule on a dispute.','FORBIDDEN');live();must(m.status==='disputed','The team cannot settle an undisputed milestone.');
        m.dispute.decision=command==='resolve_release'?'release':'refund';m.dispute.rationale=text(p.reason,'Written decision',20,6000);m.dispute.decidedAt=now;
        settle(s,o,m,command==='resolve_release'?m.held:'0',now);event(o,actor,`Team decision: ${command==='resolve_release'?'release to original seller':'refund to original buyer'}. ${m.dispute.rationale}`,now);break;
      case 'propose_terms': {
        party();live();must(['settle','amend'].includes(p.kind),'Choose a settlement or revised agreement.');
        const amount=units(p.amount);must(BigInt(amount)<=BigInt(m.held),'Amount exceeds the unresolved milestone principal.');
        if(p.kind==='amend') must(BigInt(amount)>0n,'Revised retained principal must be positive. Use a settlement for a full refund.');
        const scope=text(p.scope,'Proposed agreement',20,6000),days=p.kind==='amend'?integer(p.days,'New delivery days',1,90):0;
        if(m.proposal){if(m.proposal.status==='pending')m.proposal.status='superseded';m.proposalHistory.push(m.proposal);}
        m.proposal={id:uid('proposal'),kind:p.kind,amount,scope,days,proposerId:actor.id,status:'pending',milestoneRevision:m.revision,at:now,expiresAt:now+3*DAY};
        event(o,actor,`Proposed ${p.kind==='settle'?'a final split settlement':'a revised scope and deadline'} for “${m.title}”. No money moved.`,now);break;
      }
      case 'accept_terms': {
        party();live();const q=m.proposal;
        must(q&&q.id===p.proposalId&&q.status==='pending','No matching pending proposal.');must(q.proposerId!==actor.id,'The other party must accept. One party cannot approve both sides.');
        must(q.expiresAt>now,'This proposal expired. Create a new proposal.');must(q.milestoneRevision===m.revision,'The milestone changed. Create a new proposal.');
        q.status='accepted';q.acceptedBy=actor.id;q.acceptedAt=now;
        if(q.kind==='settle') settle(s,o,m,q.amount,now);
        else {
          const refund=BigInt(m.held)-BigInt(q.amount),newReserve=fee(q.amount,o.feeBps),unused=BigInt(m.reserve)-BigInt(newReserve);
          credit(getUser(s,o.buyerId),o.asset,refund+unused);m.buyerRefunded=(BigInt(m.buyerRefunded)+refund).toString();
          m.termsHistory.push({scope:m.scope,criteria:[...m.criteria],dueAt:m.dueAt,held:m.held,at:now,proposalId:q.id});
          m.held=q.amount;m.reserve=newReserve;m.scope=q.scope;m.criteria=[q.scope];m.dueOffset=q.days;m.dueAt=now+q.days*DAY;m.status='funded';m.submittedAt=null;m.reviewEndsAt=null;m.revisionsUsed=0;
          if(m.dispute?.status==='open'){m.dispute.status='settled by agreement';m.dispute.decidedAt=now;}
          refreshCurrentTermsHash(o,{at:now,proposalId:q.id,kind:'amend'});
          invalidateProposal(m);
        }
        event(o,actor,`Both parties approved proposal ${q.id}. ${q.kind==='settle'?'The agreed split was paid.':'The agreed refund, retained balance, and new deadline are effective.'} Destinations unchanged.`,now);break;
      }
      case 'reject_terms':
        party();live();must(m.proposal?.id===p.proposalId&&m.proposal.status==='pending','Proposal not pending.');m.proposal.status='rejected';event(o,actor,'Pending proposal rejected or withdrawn; original terms remain in force.',now);break;
      case 'execute_timeout':
        live();must(o.snapshot.acceptance==='timed'&&m.status==='submitted'&&now>=m.reviewEndsAt,'A pre-agreed, undisputed review deadline must have elapsed.');settle(s,o,m,m.held,now);event(o,actor,'Pre-agreed review deadline elapsed; release executed to the original seller.',now);break;
      case 'claim_late_refund':
        buyer();live();must(m.status==='funded'&&now>m.dueAt+2*DAY,'No-submission refund is available only after the delivery deadline plus a 48-hour grace period.');settle(s,o,m,'0',now);event(o,actor,'No delivery was submitted by the agreed deadline and grace period. Refund executed.',now);break;
      case 'add_message':
        o.messages.push({id:uid('msg'),actorId:actor.id,text:text(p.text,'Message',1,6000),at:now});break;
      case 'leave_review':
        buyer();must(orderStatus(o)==='completed'&&BigInt(sellerPaid(o))>0n,'A paid completed deal is required to leave a review.');
        must(!s.reviews.some(x=>x.orderId===o.id),'This deal already has a review.');
        s.reviews.push({id:uid('review'),orderId:o.id,listingId:o.listingId,sellerId:o.sellerId,buyerId:o.buyerId,rating:integer(p.rating,'Rating',1,5),text:text(p.text,'Review',15,2000),at:now});break;
    }
    o.version++;
    result=o.id;
  }
  s.version++;
  assertInvariants(s,input);
  return {state:s,result};
}
export function createSeedState(now=Date.now()) {
  let s=createEmptyState(now);
  const run=(actor,cmd,p,t=now)=>{const out=applyCommand(s,actor,cmd,p,{now:t});s=out.state;return out.result;};
  const create=(listingId,idx,milestones,age)=>run('buyer','create_order',{listingId,packageIndex:idx,requirements:'Launch an independent product business. Use the supplied brand brief, approved copy, and acceptance checklist. Please deliver editable source files.',milestones,acceptance:'manual',asset:'USDC'},now-age*DAY);
  const act=(id,actor,cmd,extra={},t=now)=>run(actor,cmd,{orderId:id,expectedVersion:s.orders.find(o=>o.id===id).version,...extra},t);
  const web=create('web',1,true,4);act(web,'maya','accept_order',{},now-4*DAY+1000);act(web,'buyer','fund_order',{},now-4*DAY+2000);
  let o=s.orders.find(o=>o.id===web);
  act(web,'maya','submit_delivery',{milestoneId:o.milestones[0].id,text:'The agreed direction and page structure are ready. All checklist items are mapped to the project plan.',evidence:'Sample direction document (no uploaded file).'},now-3*DAY);
  act(web,'buyer','approve_delivery',{milestoneId:o.milestones[0].id,criteriaAccepted:true},now-3*DAY+1000);
  o=s.orders.find(o=>o.id===web);act(web,'maya','submit_delivery',{milestoneId:o.milestones[1].id,text:'The responsive build and validated contact form are ready for your review against the acceptance checklist.',evidence:'Sample delivery reference only; no live website is attached.'},now-DAY);
  act(web,'maya','add_message',{text:'The second milestone is ready. Please review the responsive layouts and the form before approving payment.'},now-DAY+1000);
  const video=create('motion',1,false,3);act(video,'leila','accept_order',{},now-3*DAY+1000);act(video,'buyer','fund_order',{},now-3*DAY+2000);
  o=s.orders.find(o=>o.id===video);act(video,'leila','submit_delivery',{milestoneId:o.milestones[0].id,text:'Here is the initial cut based on the approved storyboard. The final export and captions are included in the delivery notes.',evidence:'Sample video reference only.'},now-2*DAY);
  act(video,'buyer','open_dispute',{milestoneId:o.milestones[0].id,reason:'The delivery does not include the agreed captions. We disagree about whether a captioned version was included in the original scope.',acknowledgeFee:true},now-DAY);
  act(video,'leila','add_message',{text:'I can add the captions. I propose one additional day to finish the missing deliverable rather than cancelling the order.'},now-DAY+1000);
  const brand=create('brand',0,false,1);
  run('buyer','post_brief',{title:'Design a clean onboarding flow for a new product',category:'Design',budget:'650',description:'We need three onboarding screens, mobile and desktop layouts, editable source files, and clear developer handoff. Please propose fixed scope and a realistic delivery schedule.',asset:'USDC'},now-DAY);
  assertInvariants(s);return s;
}
