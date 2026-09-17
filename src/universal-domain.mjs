/** Universal off-chain ledger. REAL CUSTODY IS NOT IMPLEMENTED. */
import * as Base from './domain.mjs';
import { initializeTermsHash } from './agreement.mjs';
import {TAXONOMY,WORKFLOWS,categoryById,workflowById} from './catalog.mjs';
import { applyPayrollCommand, assertPayrollInvariants } from './payroll-state.mjs';
export {money,units,fee,sum,escrowHeld,principalHeld,sellerPaid,orderStatus,DAY,PLATFORM_BPS,DISPUTE_BPS,DomainError} from './domain.mjs';
export {ASSET_CODES,DEMO_TOKENS,isAsset} from './domain.mjs';
export {TAXONOMY,WORKFLOWS};
export const CATEGORIES=Base.CATEGORIES;
const must=(v,m,code)=>{if(!v)throw new Base.DomainError(m,code);};
const txt=(x,label,min=1,max=6000)=>{must(typeof x==='string'&&x.trim().length>=min&&x.trim().length<=max,`${label}: use ${min}–${max} characters.`);return x.trim();};
const num=(x,label,min,max)=>{must(Number.isInteger(x)&&x>=min&&x<=max,`${label}: use an integer from ${min} to ${max}.`);return x;};
const exact=(p,keys)=>{must(p&&typeof p==='object'&&!Array.isArray(p),'Invalid payload.');for(const k of Object.keys(p))must(keys.includes(k),`Unsupported field: ${k}. Destinations cannot change.`);};
const uid=p=>`${p}_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('')}`;
const terminal=m=>['released','refunded','settled'].includes(m.status);
const record=(o,actorId,text,at)=>o.events.push({id:uid('evt'),actorId,text,at,asset:o.asset});
const clone=x=>structuredClone(x);
const isMicro=v=>typeof v==='string'&&/^(0|[1-9]\d*)$/.test(v);
const DOMAIN_LABEL=/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|xn--[a-z0-9-]+)$/;
export function normalizeDomainName(value){
  must(typeof value==='string','Domain name is required.');
  const name=value.trim().toLowerCase().replace(/\.$/,'');
  must(name.length>=3&&name.length<=253,'Domain name must be 3–253 characters.');
  must(!/\s|:\/\/|[/?#@]/.test(name),'Enter a hostname only, without protocol, path, credentials or whitespace.');
  const labels=name.split('.');
  must(labels.length>=2&&labels.every(x=>x.length>=1&&x.length<=63&&DOMAIN_LABEL.test(x)),'Enter a valid domain with labels from a–z, 0–9 and hyphens.');
  must(labels.at(-1).length>=2,'The top-level domain is too short.');
  return name;
}
const domainDate=(x,label,now)=>{must(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x),`${label} must be YYYY-MM-DD.`);const t=Date.parse(`${x}T23:59:59Z`);must(Number.isFinite(t)&&t>now-Base.DAY,`${label} must be a valid future date.`);return x;};
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(`${x}T23:59:59Z`));
const textList=(x,label,min=1,max=8)=>{must(Array.isArray(x)&&x.length>=min&&x.length<=max,`${label} must contain ${min}–${max} items.`);return x.map(v=>txt(v,label,2,160));};
const priceMap=(x,label)=>{must(x&&typeof x==='object'&&!Array.isArray(x),`${label} must be a price map.`);const keys=Object.keys(x);must(keys.length>=1&&keys.every(k=>Base.isAsset(k)),`${label} must quote USDC or USDT.`);const out={};for(const k of keys){const v=Base.units(x[k]);must(BigInt(v)>=1000000n&&BigInt(v)<=1000000000000n,`${label} is outside the supported range.`);out[k]=v;}return out;};
export function assertInvariants(s,before=null){
  assertPayrollInvariants(s);
  for(const l of s.listings){
    if(l.kind==='goods')must(Number.isInteger(l.stock)&&l.stock>=0,'Inventory cannot be negative.');
    if(l.kind==='domain'){
      must(l.categoryId==='domains'&&l.domainName===normalizeDomainName(l.domainName),'Domain listing name is invalid.');
      must(typeof l.domainKey==='string'&&l.domainKey===l.domainName,'Domain listing key is invalid.');
      must(typeof l.registrar==='string'&&l.registrar.trim().length>=2,'Domain registrar is invalid.');
      must(validDate(l.expiryDate),'Domain expiry is invalid.');
      must(['registrar_push','auth_code'].includes(l.transferMethod),'Domain transfer method is invalid.');
      must(['seller','buyer'].includes(l.renewalResponsibility),'Domain renewal responsibility is invalid.');
      must(l.ownershipConfirmed===true&&typeof l.controlChallenge==='string'&&l.controlChallenge.length>=16,'Domain seller-control declaration is invalid.');
      must(l.prices&&Object.keys(l.prices).length>=1,'Domain listing needs a price.');
      for(const k of Object.keys(l.prices))must(Base.isAsset(k)&&isMicro(l.prices[k])&&BigInt(l.prices[k])>=1000000n,'Domain price is invalid.');
      for(const k of Object.keys(l.minimumOffers||{}))must(Object.hasOwn(l.prices,k)&&isMicro(l.minimumOffers[k])&&BigInt(l.minimumOffers[k])>=1000000n&&BigInt(l.minimumOffers[k])<=BigInt(l.prices[k]),'Domain minimum offer is invalid.');
    }
  }
  for(const o of s.orders){
    const old=before?.orders.find(x=>x.id===o.id);
    if(old)for(const k of ['commerce','workflow','milestoneDefinitions'])must(JSON.stringify(old[k])===JSON.stringify(o[k]),`Immutable agreement changed: ${k}`);
    if(old)must(Boolean(old.realEstate)===Boolean(o.realEstate),'Immutable agreement changed: realEstate presence');
    if(old)must(Boolean(old.domainSale)===Boolean(o.domainSale),'Immutable agreement changed: domainSale presence');
    if(o.realEstate){
      const r=o.realEstate;
      must(o.workflow==='real_estate','Real-estate metadata requires the real-estate workflow.');
      must(typeof r.propertyReference==='string'&&r.propertyReference.length>=4&&r.propertyReference.length<=160,'Invalid property reference.');
      must(!(/\b\d{1,6}\s+[^,\n]{2,80}\s+(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|court|ct|parkway|pkwy)\b/i.test(r.propertyReference)||/\b\d{5}(?:-\d{4})?\b/.test(r.propertyReference)),'Use a fictional property reference, not a street address or postal code.');
      must(['residential_purchase','commercial_purchase','land_purchase'].includes(r.transactionType),'Unsupported real-estate transaction type.');
      must(isMicro(r.purchasePrice)&&isMicro(r.earnestDeposit)&&BigInt(r.purchasePrice)>=BigInt(r.earnestDeposit)&&BigInt(r.earnestDeposit)>=2000000n,'Real-estate price/deposit relationship is invalid.');
      must(Number.isInteger(r.inspectionDays)&&r.inspectionDays>=1&&r.inspectionDays<=30,'Inspection days are invalid.');
      must(typeof r.financingContingency==='boolean'&&typeof r.appraisalContingency==='boolean','Contingency flags are invalid.');
      must(typeof r.settlementContact==='string'&&r.settlementContact.length>=3&&r.settlementContact.length<=160,'Settlement contact is invalid.');
      must(typeof r.targetClosingDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.targetClosingDate),'Target closing date is invalid.');
      must(Array.isArray(r.closingConditions)&&r.closingConditions.length>=2&&r.closingConditions.length<=12&&r.closingConditions.every(x=>typeof x==='string'&&x.length>=8&&x.length<=500),'Closing conditions are invalid.');
      must(Base.sum(o.milestones.map(m=>m.originalAmount))===r.earnestDeposit,'Real-estate milestones must equal the earnest deposit.');
      if(old)must(JSON.stringify(old.realEstate)===JSON.stringify(r),'Immutable agreement changed: realEstate');
    }
    if(o.workflow==='domain_sale'||o.domainSale){
      const d=o.domainSale;must(d&&o.workflow==='domain_sale','Domain sale metadata requires the domain_sale workflow.');
      must(d.domainName===normalizeDomainName(d.domainName),'Domain agreement name is invalid.');
      must(typeof d.registrar==='string'&&d.registrar.length>=2,'Domain agreement registrar is invalid.');
      must(['registrar_push','auth_code'].includes(d.transferMethod),'Domain agreement transfer method is invalid.');
      must(['seller','buyer'].includes(d.renewalResponsibility),'Domain agreement renewal responsibility is invalid.');
      must(typeof d.sellerControlVerifiedAt==='number'&&d.sellerControlVerifiedAt>0,'Seller domain control must be verified.');
      must(typeof d.buyerDnsChallenge==='string'&&d.buyerDnsChallenge.length>=16,'Buyer DNS challenge is invalid.');
      must(typeof d.listingId==='string'&&s.listings.some(l=>l.id===d.listingId&&l.kind==='domain'&&l.sellerId===o.sellerId),'Domain agreement listing is invalid.');
      must(validDate(d.expiryDate),'Domain agreement expiry is invalid.');
      must(Array.isArray(d.includedAssets)&&d.includedAssets.length>=1&&d.includedAssets.every(x=>typeof x==='string'&&x.trim().length>=2&&x.length<=160),'Domain agreement included assets are invalid.');
      must(isMicro(d.askingPrice)&&isMicro(d.agreedPrice)&&BigInt(d.agreedPrice)>=1000000n&&BigInt(d.agreedPrice)<=BigInt(d.askingPrice),'Domain agreement price is invalid.');
      must(d.offerId===null||typeof d.offerId==='string','Domain agreement offer reference is invalid.');
      must(['awaiting_seller_acceptance','awaiting_funding','funded','buyer_verification','completed','disputed'].includes(d.status),'Domain agreement status is invalid.');
      must(o.milestones.length===1,'Domain sales use one transfer milestone.');
      must(o.snapshot.acceptance==='manual','Domain sales require explicit buyer verification.');
      if(before){const old=before.orders.find(x=>x.id===o.id);if(old&&old.domainSale){for(const k of ['domainName','listingId','registrar','expiryDate','transferMethod','renewalResponsibility','includedAssets','askingPrice','agreedPrice','offerId','sellerControlVerifiedAt','buyerDnsChallenge'])must(JSON.stringify(old.domainSale[k])===JSON.stringify(d[k]),`Immutable agreement changed: domainSale.${k}`);}}
    }
    if(o.commerce){
      must(o.snapshot.acceptance==='manual','Physical goods cannot auto-release from a seller submission.');
      must(Base.sum(o.milestones.map(m=>m.originalAmount))===o.commerce.total,'Goods amount mismatch.');
      must(Number.isInteger(o.commerce.quantity)&&o.commerce.quantity>=1,'Invalid quantity.');
      if(Object.prototype.hasOwnProperty.call(o.commerce,'asset')){
        must(o.commerce.asset===o.asset,'Commerce asset must match order asset.');
      }
      must(isMicro(o.commerce.unitPrice),'commerce.unitPrice must be a nonnegative integer micro-unit string.');
      must(isMicro(o.commerce.subtotal),'commerce.subtotal must be a nonnegative integer micro-unit string.');
      must(isMicro(o.commerce.shipping),'commerce.shipping must be a nonnegative integer micro-unit string.');
      must(isMicro(o.commerce.total),'commerce.total must be a nonnegative integer micro-unit string.');
      must(BigInt(o.commerce.unitPrice)*BigInt(o.commerce.quantity)===BigInt(o.commerce.subtotal),'Commerce subtotal mismatch.');
      must(BigInt(o.commerce.subtotal)+BigInt(o.commerce.shipping)===BigInt(o.commerce.total),'Commerce total mismatch.');
    }
  }
  Base.assertInvariants(s,before);
  return true;
}
function stages(order,specs){
 must(Array.isArray(specs)&&specs.length>=1&&specs.length<=8,'Use 1–8 milestones.');
 const total=Base.sum(order.milestones.map(m=>m.originalAmount));
 const defs=specs.map(x=>{
  exact(x,['title','amount','days','scope','criteria','role']);
  const amount=Base.units(x.amount);must(BigInt(amount)>=1000000n,'Each milestone must be at least 1 unit of the selected asset.');
  must(Array.isArray(x.criteria)&&x.criteria.length>=1&&x.criteria.length<=10,'Each milestone needs 1–10 acceptance tests.');
  return {title:txt(x.title,'Milestone title',3,100),amount,days:num(x.days,'Delivery days',1,180),scope:txt(x.scope,'Milestone scope',15,4000),criteria:x.criteria.map(c=>txt(c,'Acceptance test',8,500)),role:x.role==='warranty'?'warranty':'delivery'};
 });
 must(Base.sum(defs.map(x=>x.amount))===total,'Milestone amounts must equal the agreement principal.');
 const proto=clone(order.milestones[0]);
 order.milestones=defs.map(x=>({...clone(proto),id:uid('ms'),title:x.title,originalAmount:x.amount,dueOffset:x.days,scope:x.scope,criteria:x.criteria,role:x.role}));
 order.milestoneDefinitions=clone(defs);
}
function decimal(n){const s=String(n).padStart(7,'0');return s.slice(0,-6)+'.'+s.slice(-6);}
export function applyCommand(input,actorId,command,p={},context={}){
 const now=context.now??Date.now(),actor=input.users.find(x=>x.id===actorId);must(actor,'Unknown identity.','FORBIDDEN');
 if(command.startsWith('payroll_')) { must(actor.role !== 'admin', 'Review-team identities cannot manage payroll records.', 'FORBIDDEN'); return applyPayrollCommand(input,actorId,command,p,context); }
 const isBlocked=(other)=>(input.blocks||[]).some(x=>(x.actorId===actorId&&x.userId===other)||(x.userId===actorId&&x.actorId===other));
 const proposedSeller=p.sellerId||input.listings.find(x=>x.id===p.listingId)?.sellerId;
 if(['create_order','create_agreement','purchase_product'].includes(command)&&proposedSeller)must(!isBlocked(proposedSeller),'Unblock this counterparty before starting a new agreement.');
 if(command==='quote_brief'){const brief=input.briefs.find(x=>x.id===p.briefId);if(brief)must(!isBlocked(brief.buyerId),'This counterparty is blocked.');}
 if(command==='add_message'&&actor.role!=='admin'){const deal=input.orders.find(x=>x.id===p.orderId);if(deal){const other=deal.buyerId===actorId?deal.sellerId:deal.buyerId;must(!isBlocked(other),'Direct messages are blocked. Contract actions, evidence and dispute resolution remain available.');}}
 // Existing features retain the proven model, with physical-delivery guards.
 const custom=['create_product','purchase_product','create_agreement','create_domain','purchase_domain','make_domain_offer','respond_domain_offer','verify_domain_control','initiate_domain_transfer','verify_domain_transfer','reject_domain_transfer','ship_goods','carrier_update','receive_goods','request_return','authorize_return','send_return','confirm_return','refund_return','release_warranty','add_evidence','report_listing','moderate_listing','block_user'];
 if(!custom.includes(command)){
   const o=input.orders.find(x=>x.id===p.orderId),l=input.listings.find(x=>x.id===p.listingId);
   if(command==='create_order'&&l?.kind==='goods')throw new Base.DomainError('Use product checkout, including quantity, shipping and inspection terms.');
   if(o?.commerce||o?.workflow==='domain_sale'){
     if(command==='submit_delivery')throw new Base.DomainError('Goods review starts when the buyer confirms receipt, not when the seller uploads shipping information.');
     if(command==='execute_timeout')throw new Base.DomainError('Goods require inspection acceptance. Carrier events never release funds.');
     if(command==='claim_late_refund')must(!o.fulfillment.shippedAt,'This order has shipped. Use a return, negotiation, or dispute, not the no-shipment refund.');
     if(command==='approve_delivery'){
       must(o.fulfillment.receivedAt,'The buyer must confirm receipt first.');
       must(!['requested','authorized','in-transit','received'].includes(o.fulfillment.returnStatus),'A return is open. Settle it by agreement or dispute.');
       const m=o.milestones.find(x=>x.id===p.milestoneId);must(m?.role!=='warranty','Use the dedicated warranty release after the agreed period.');
     }
     if(command==='request_revision')throw new Base.DomainError('Use a product issue / return request instead of a service revision.');
     if(o?.commerce&&command==='fund_order'){
       const listing=input.listings.find(x=>x.id===o.listingId);must(listing&&listing.status==='published','Product is not available.');must(listing.stock>=o.commerce.quantity,'Insufficient stock. Ask the seller to create a new agreement.');
     }
     if(o?.workflow==='domain_sale'&&['submit_delivery','approve_delivery','execute_timeout','claim_late_refund'].includes(command))throw new Base.DomainError('Use the domain transfer verification steps for a domain sale.');
   }
   const out=Base.applyCommand(input,actorId,command,p,context);
   if(o?.workflow==='domain_sale'&&command==='accept_order'){
     const changed=out.state.orders.find(x=>x.id===o.id);changed.domainSale.status='awaiting_funding';record(changed,actorId,'Seller accepted the domain-sale terms. The buyer may fund the transfer milestone.',now);
   }
   if(o?.workflow==='domain_sale'&&command==='fund_order'){
     const changed=out.state.orders.find(x=>x.id===o.id);changed.domainSale.status='funded';record(changed,actorId,'Buyer funded the domain transfer milestone. Funds remain held until buyer control verification.',now);
   }
   if(o?.commerce&&command==='fund_order')out.state.listings.find(x=>x.id===o.listingId).stock-=o.commerce.quantity;
   if(o?.commerce&&command==='accept_terms'){
     const prior=o.milestones.find(x=>x.id===p.milestoneId),changed=out.state.orders.find(x=>x.id===o.id);
     if(prior?.proposal?.kind==='amend'&&prior.role==='delivery'){
       changed.fulfillmentHistory=[...(changed.fulfillmentHistory||[]),clone(changed.fulfillment)];
       changed.fulfillment={status:'awaiting replacement shipment',returnStatus:null,events:[],shippedAt:null,receivedAt:null};
       record(changed,actorId,'Both parties amended the goods delivery. A new shipment and buyer receipt will restart the original inspection and warranty periods. No additional commission was charged.',now);
     }
     if(changed.milestones.every(terminal)&&changed.fulfillment.returnStatus)changed.fulfillment.returnStatus='closed';
   }
   assertInvariants(out.state,input);return out;
 }
 let s=clone(input),result=null;
  if(command==='create_product'){
   exact(p,['title','categoryId','description','criteria','price','prices','stock','days','shipping','shippingPrices','inspectionDays','warrantyDays','holdbackBps','condition','returns','specifications','shippingRegion']);
   must(actor.role==='seller','Only sellers can publish products.','FORBIDDEN');
   const cat=categoryById(p.categoryId);must(cat?.group==='Physical products','Select a physical-product category.');
   const hasMap=p.prices!==undefined||p.shippingPrices!==undefined;
   const hasScalar=p.price!==undefined||p.shipping!==undefined;
   must(!(hasMap&&hasScalar),'Provide either price/shipping or prices/shippingPrices, not both.');
   must(hasMap||hasScalar,'Provide price and shipping, or prices and shippingPrices.');
   const plainMap=(m,label)=>{must(m&&typeof m==='object'&&!Array.isArray(m),`${label}: provide a plain object map.`);const ks=Object.keys(m);must(ks.length>=1,`${label}: at least one asset required.`);for(const k of ks)must(Base.ASSET_CODES.includes(k),`${label}: unsupported asset ${k}.`);return ks;};
   let prices,shippingPrices;
   if(hasMap){
     must(p.prices!==undefined&&p.shippingPrices!==undefined,'Both prices and shippingPrices are required in map mode.');
     const pk=plainMap(p.prices,'prices'),sk=plainMap(p.shippingPrices,'shippingPrices');
     must(pk.length===sk.length&&pk.every(k=>sk.includes(k)),'prices and shippingPrices must have exactly the same asset keys.');
     prices={};shippingPrices={};
     for(const k of pk){
       const pv=Base.units(p.prices[k]);must(BigInt(pv)>=1000000n,`${k} price must be at least 1 unit.`);must(BigInt(pv)<=100000n*1000000n,`${k} price exceeds maximum.`);prices[k]=pv;
       const sv=Base.units(p.shippingPrices[k]);must(BigInt(sv)>=0n,`${k} shipping cannot be negative.`);must(BigInt(sv)<=100000n*1000000n,`${k} shipping exceeds maximum.`);shippingPrices[k]=sv;
     }
   }else{
     const pv=Base.units(p.price);must(BigInt(pv)>=1000000n,'Product must cost at least 1 demo USDC.');
     const sv=Base.units(p.shipping);must(BigInt(sv)>=0n,'Shipping cannot be negative.');
     prices={USDC:pv};shippingPrices={USDC:sv};
   }
   const holdbackBps=num(p.holdbackBps,'Warranty holdback basis points',0,3000);
   for(const k of Object.keys(prices)){
     const gross=BigInt(prices[k])+BigInt(shippingPrices[k]),hold=gross*BigInt(holdbackBps)/10000n;
     must(!holdbackBps||hold>=1000000n,`${k}: the warranty holdback would create a milestone below the 1 unit minimum. Increase the product price/shipping total or lower the holdback.`);
     must(gross-hold>=1000000n,`${k}: the delivery milestone would be below the 1 unit minimum. Increase the product price or shipping total.`);
   }
   const primary=prices.USDC!==undefined?'USDC':Object.keys(prices)[0];
   const price=prices[primary],shipping=shippingPrices[primary];
   must(Array.isArray(p.criteria)&&p.criteria.length>=1&&p.criteria.length<=10,'Provide 1–10 inspection criteria.');
   const l={id:uid('product'),kind:'goods',categoryId:cat.id,category:cat.name,sellerId:actorId,title:txt(p.title,'Product title',8,120),description:txt(p.description,'Description',20),criteria:p.criteria.map(c=>txt(c,'Inspection criterion',8,500)),condition:txt(p.condition,'Condition',3,120),specifications:txt(p.specifications,'Specifications',10,3000),returns:txt(p.returns,'Return policy',20,2000),stock:num(p.stock,'Stock',1,10000),shippingPrices,shippingRegion:txt(p.shippingRegion,'Shipping region',3,160),inspectionDays:num(p.inspectionDays,'Inspection days',1,30),warrantyDays:num(p.warrantyDays,'Warranty days',0,90),holdbackBps,cover:cat.id,headline:'A clear deal.\nA confident delivery.',status:'pending',sample:false,createdAt:now,tags:[cat.name,'Inspection before acceptance'],packages:[{name:'Single item',prices,days:num(p.days,'Dispatch deadline',1,90),revisions:0,description:p.description}]};
   must(!l.holdbackBps||l.warrantyDays>0,'A holdback needs an agreed warranty period.');s.listings.unshift(l);result=l.id;
 }else if(command==='create_domain'){
   exact(p,['domainName','title','description','registrar','expiryDate','transferMethod','renewalResponsibility','includedAssets','askingPrices','minimumOffers','ownershipConfirmed','controlChallenge']);
   must(actor.role==='seller','Only sellers can publish domains.','FORBIDDEN');
   const cat=categoryById('domains');const domainName=normalizeDomainName(p.domainName);
   must(!s.listings.some(x=>x.kind==='domain'&&x.domainKey===domainName&&['pending','published','paused'].includes(x.status)),'This domain already has an active listing.');
   const prices=priceMap(p.askingPrices,'Asking prices'),minimumOffers=p.minimumOffers===undefined?{}:priceMap(p.minimumOffers,'Minimum offers');
   for(const k of Object.keys(minimumOffers))must(Object.hasOwn(prices,k)&&BigInt(minimumOffers[k])<=BigInt(prices[k]),`${k} minimum offer cannot exceed the asking price.`);
   const challenge=txt(p.controlChallenge,'DNS control challenge',16,160);must(p.ownershipConfirmed===true,'Confirm that you own the domain and may transfer it.');
   const packageScope='Transfer control of the listed domain and complete the buyer DNS control challenge. Website, email and other assets are included only if separately listed in the snapshot.';
   const l={id:uid('domain'),kind:'domain',categoryId:'domains',category:cat.name,sellerId:actorId,title:txt(p.title,'Domain listing title',8,120),description:txt(p.description,'Description',20,4000),criteria:cat.checks.map(x=>txt(x,'Domain acceptance condition',8,500)),domainName,domainKey:domainName,registrar:txt(p.registrar,'Registrar',2,120),expiryDate:domainDate(p.expiryDate,'Expiry date',now),transferMethod:p.transferMethod,renewalResponsibility:p.renewalResponsibility,includedAssets:textList(p.includedAssets,'Included assets',1,8),askingPrices:prices,prices,minimumOffers,ownershipConfirmed:true,controlChallenge:challenge,controlVerification:null,cover:'domains',headline:'A domain with a clear handover.',status:'pending',createdAt:now,sample:false,tags:['Domains & websites','Verified transfer required'],packages:[0,1,2].map(i=>({name:i===0?'Domain transfer':i===1?'Transfer + support':'Full handover',prices,days:14,revisions:0,description:packageScope}))};
   s.listings.unshift(l);result=l.id;
 }else if(command==='verify_domain_control'){
   exact(p,['listingId','proof','note']);must(actor.role==='seller','Only the seller may verify domain control.','FORBIDDEN');const l=s.listings.find(x=>x.id===p.listingId&&x.kind==='domain');must(l&&l.sellerId===actorId,'Domain listing not found.');must(l.controlChallenge===p.proof,'DNS control challenge does not match.');l.controlVerification={method:'dns_txt_simulation',verifiedAt:now,note:txt(p.note,'Verification note',8,500),proof:'matched'};result=l.id;
 }else if(command==='make_domain_offer'){
   exact(p,['listingId','amount','asset']);must(actor.role!=='admin','The review team cannot make an offer.','FORBIDDEN');const l=s.listings.find(x=>x.id===p.listingId&&x.kind==='domain'&&x.status==='published');must(l,'Domain listing is not available.');must(l.sellerId!==actorId,'You cannot make an offer on your own domain.');const asset=p.asset;must(Base.isAsset(asset)&&l.prices[asset]!==undefined,'This domain is not quoted in the selected asset.');const amount=Base.units(p.amount),minimum=l.minimumOffers?.[asset]??'1000000';must(BigInt(amount)>=BigInt(minimum)&&BigInt(amount)<=BigInt(l.prices[asset]),'Offer must be between the minimum offer and asking price.');s.domainOffers??=[];must(!s.domainOffers.some(x=>x.listingId===l.id&&x.buyerId===actorId&&['pending','countered','accepted_by_seller'].includes(x.status)),'You already have an active offer on this domain.');const offer={id:uid('offer'),listingId:l.id,sellerId:l.sellerId,buyerId:actorId,amount,asset,status:'pending',createdAt:now,expiresAt:now+3*Base.DAY,counterAmount:null,counterExpiresAt:null};s.domainOffers.push(offer);result=offer.id;
 }else if(command==='respond_domain_offer'){
   exact(p,['offerId','decision','amount']);must(actor.role==='seller','Only the domain seller may respond to an offer.','FORBIDDEN');s.domainOffers??=[];const offer=s.domainOffers.find(x=>x.id===p.offerId);must(offer&&offer.sellerId===actorId,'Offer not found.');must(offer.status==='pending'||offer.status==='countered','Offer is no longer active.');must(now<=Math.max(offer.expiresAt,offer.counterExpiresAt||0),'Offer has expired.');must(['accept','counter','reject'].includes(p.decision),'Choose accept, counter or reject.');if(p.decision==='reject'){offer.status='rejected';offer.respondedAt=now;}else if(p.decision==='accept'){offer.status='accepted_by_seller';offer.respondedAt=now;}else{const amount=Base.units(p.amount);const l=s.listings.find(x=>x.id===offer.listingId);must(BigInt(amount)>=1000000n&&BigInt(amount)<=BigInt(l.prices[offer.asset]),'Counteroffer must be within the asking price.');offer.status='countered';offer.counterAmount=amount;offer.counterExpiresAt=now+3*Base.DAY;offer.respondedAt=now;}result=offer.id;
 }else if(command==='purchase_domain'){
   exact(p,['listingId','asset','requirements','agreeTerms','offerId']);const l=s.listings.find(x=>x.id===p.listingId&&x.kind==='domain'&&x.status==='published');must(l&&l.controlVerification,'Domain is not available until the seller verifies control.');must(actor.role!=='admin'&&actor.id!==l.sellerId,'Choose a buyer identity that is not the seller.','FORBIDDEN');must(p.agreeTerms===true,'Accept the domain transfer and fee terms before creating the agreement.');let asset=p.asset,amount=l.prices[asset],offer=null;s.domainOffers??=[];if(p.offerId){offer=s.domainOffers.find(x=>x.id===p.offerId);must(offer&&offer.listingId===l.id&&offer.buyerId===actorId&&offer.asset===asset,'Offer not found for this buyer and domain.');must(['accepted_by_seller','countered'].includes(offer.status),'Offer is not ready for buyer acceptance.');if(offer.status==='countered')amount=offer.counterAmount;must(now<=Math.max(offer.expiresAt,offer.counterExpiresAt||0),'Offer has expired.');}must(Base.isAsset(asset)&&amount!==undefined,'This domain is not quoted in the selected asset.');const requirements=txt(p.requirements,'Buyer requirements',20,6000);const scope=`Transfer control of ${l.domainName} from the seller’s registrar account to the buyer’s registrar account using ${l.transferMethod==='registrar_push'?'a registrar push':'an authorization-code transfer'}.`;const out=Base.applyCommand(s,actorId,'create_order',{sellerId:l.sellerId,title:l.title,amount:decimal(amount),scope,criteria:['Seller control verification is recorded','Domain transfer or registrar push is initiated','Buyer DNS control challenge succeeds'],requirements,days:14,revisions:0,milestones:false,acceptance:'manual',asset},context);s=out.state;result=out.result;const o=s.orders.find(x=>x.id===result);o.listingId=l.id;o.workflow='domain_sale';o.domainSale={domainName:l.domainName,listingId:l.id,registrar:l.registrar,expiryDate:l.expiryDate,transferMethod:l.transferMethod,renewalResponsibility:l.renewalResponsibility,includedAssets:clone(l.includedAssets),askingPrice:l.prices[asset],agreedPrice:amount,offerId:offer?.id||null,sellerControlVerifiedAt:l.controlVerification.verifiedAt,buyerDnsChallenge:`eg-dns-${uid('challenge')}`,transferInitiatedAt:null,transferReference:null,buyerControlVerifiedAt:null,status:'awaiting_seller_acceptance'};o.snapshot.title=l.title;o.snapshot.scope=scope;o.snapshot.package='Domain transfer';o.snapshot.criteria=['Seller control verification is recorded','Domain transfer or registrar push is initiated','Buyer DNS control challenge succeeds'];o.snapshot.requirements=requirements;o.milestones[0].title='Domain transfer & buyer verification';o.milestones[0].scope=o.snapshot.scope;o.milestones[0].criteria=o.snapshot.criteria;initializeTermsHash(o);if(offer)offer.status='converted';
 }else if(command==='initiate_domain_transfer'){
   exact(p,['orderId','expectedVersion','transferReference']);const o=s.orders.find(x=>x.id===p.orderId);must(o&&o.workflow==='domain_sale','Domain sale agreement not found.');must(actorId===o.sellerId,'Only the original seller may initiate the domain transfer.','FORBIDDEN');must(p.expectedVersion===o.version,'Agreement changed. Refresh before retrying.','STALE_VERSION');must(o.fundedAt&&o.milestones[0].status==='funded','The buyer must fund the domain transfer first.');must(!o.domainSale.transferInitiatedAt,'Transfer has already been initiated.');const out=Base.applyCommand(s,actorId,'submit_delivery',{orderId:o.id,milestoneId:o.milestones[0].id,expectedVersion:o.version,text:'Domain transfer initiated by the seller.',evidence:txt(p.transferReference,'Transfer reference',8,500)},context);s=out.state;const changed=s.orders.find(x=>x.id===o.id);changed.domainSale.transferInitiatedAt=now;changed.domainSale.transferReference=txt(p.transferReference,'Transfer reference',8,500);changed.domainSale.status='buyer_verification';record(changed,actorId,'Domain transfer initiated. Buyer must complete the DNS control challenge before funds can release.',now);result=o.id;
 }else if(command==='verify_domain_transfer'){
   exact(p,['orderId','expectedVersion','dnsProof']);const o=s.orders.find(x=>x.id===p.orderId);must(o&&o.workflow==='domain_sale','Domain sale agreement not found.');must(actorId===o.buyerId,'Only the original buyer may verify domain control.','FORBIDDEN');must(p.expectedVersion===o.version,'Agreement changed. Refresh before retrying.','STALE_VERSION');must(o.fundedAt&&o.domainSale.transferInitiatedAt&&o.milestones[0].status==='submitted','Seller must initiate the funded transfer first.');must(p.dnsProof===o.domainSale.buyerDnsChallenge,'DNS control challenge does not match.');const out=Base.applyCommand(s,actorId,'approve_delivery',{orderId:o.id,milestoneId:o.milestones[0].id,expectedVersion:o.version,criteriaAccepted:true},context);s=out.state;const changed=s.orders.find(x=>x.id===o.id);changed.domainSale.buyerControlVerifiedAt=now;changed.domainSale.status='completed';record(changed,actorId,'Buyer verified DNS control. The domain transfer milestone released under the simulated escrow rules.',now);result=o.id;
 }else if(command==='reject_domain_transfer'){
   exact(p,['orderId','expectedVersion','reason','acknowledgeFee']);const o=s.orders.find(x=>x.id===p.orderId);must(o&&o.workflow==='domain_sale','Domain sale agreement not found.');must(actorId===o.buyerId||actorId===o.sellerId,'Only the original parties may reject a transfer.','FORBIDDEN');must(p.expectedVersion===o.version,'Agreement changed. Refresh before retrying.','STALE_VERSION');must(o.fundedAt&&o.milestones[0].status==='submitted','A submitted domain transfer is required.');const out=Base.applyCommand(s,actorId,'open_dispute',{orderId:o.id,milestoneId:o.milestones[0].id,expectedVersion:o.version,reason:txt(p.reason,'Transfer issue',20,4000),acknowledgeFee:p.acknowledgeFee===true},context);s=out.state;const changed=s.orders.find(x=>x.id===o.id);changed.domainSale.status='disputed';result=o.id;
 }else if(command==='purchase_product'){
   exact(p,['listingId','quantity','requirements','deliveryReference','agreeInspection','agreeFees','asset']);
   const l=s.listings.find(x=>x.id===p.listingId&&x.kind==='goods'&&x.status==='published');must(l,'Product not available.');
   const quantity=num(p.quantity,'Quantity',1,1000);must(quantity<=l.stock,'Not enough stock.');must(p.agreeInspection===true&&p.agreeFees===true,'Accept inspection and fee rules before creating the agreement.');
   const asset=p.asset===undefined?'USDC':p.asset;must(Base.isAsset(asset),'Unsupported asset.');
   const unitQuote=l.packages[0].prices?.[asset];must(unitQuote!==undefined,`This product is not offered in ${asset}.`);
   const shipQuote=l.shippingPrices?.[asset];must(shipQuote!==undefined,`Shipping is not quoted in ${asset}.`);
   const subtotal=BigInt(unitQuote)*BigInt(quantity),total=subtotal+BigInt(shipQuote);Base.units(decimal(total));
   const out=Base.applyCommand(s,actorId,'create_order',{sellerId:l.sellerId,title:l.title,amount:decimal(total),asset,scope:`${quantity} unit(s). ${l.description}\nSpecifications: ${l.specifications}\nCondition: ${l.condition}\nReturns: ${l.returns}`,criteria:l.criteria,requirements:txt(p.requirements,'Buyer requirements',20),days:l.packages[0].days,revisions:0,milestones:false,acceptance:'manual'},context);s=out.state;result=out.result;
   const o=s.orders.find(x=>x.id===result);o.listingId=l.id;o.workflow='goods';o.snapshot.package=`${quantity} item(s) · product delivery`;
   o.commerce={categoryId:l.categoryId,quantity,asset,unitPrice:unitQuote,subtotal:subtotal.toString(),shipping:shipQuote,total:total.toString(),condition:l.condition,specifications:l.specifications,returns:l.returns,inspectionDays:l.inspectionDays,warrantyDays:l.warrantyDays,holdbackBps:l.holdbackBps,shippingRegion:l.shippingRegion,deliveryReference:txt(p.deliveryReference,'Delivery reference',5,500)};
   o.fulfillment={status:'awaiting shipment',returnStatus:null,events:[],shippedAt:null,receivedAt:null};
   const hold=total*BigInt(l.holdbackBps)/10000n;
   const defs=[{title:'Delivery & inspection',amount:decimal(total-hold),days:l.packages[0].days,scope:o.snapshot.scope,criteria:l.criteria,role:'delivery'}];
   if(hold>0n)defs.push({title:'Warranty holdback',amount:decimal(hold),days:Math.min(180,l.packages[0].days+l.warrantyDays+30),scope:`Retained for the agreed ${l.warrantyDays}-day warranty after the buyer confirms receipt. Covered issues: ${l.returns}`,criteria:['Agreed warranty period has elapsed','No unresolved dispute or agreed return remains'],role:'warranty'});
   stages(o,defs);
   initializeTermsHash(o);
  }else if(command==='create_agreement'){
   exact(p,['sellerId','title','amount','scope','criteria','requirements','days','revisions','acceptance','workflow','milestoneSpecs','asset','realEstate']);
   must(workflowById(p.workflow)&&p.workflow!=='goods','Choose a supported contract/service workflow.');
   if(p.asset!==undefined)must(Base.isAsset(p.asset),'Unsupported asset.');
   const {workflow,milestoneSpecs,realEstate:rawRealEstate,...base}=p;
   let realEstate=null;
   if(workflow==='real_estate'){
     exact(rawRealEstate,['propertyReference','transactionType','purchasePrice','earnestDeposit','inspectionDays','financingContingency','appraisalContingency','settlementContact','targetClosingDate','closingConditions']);
     const purchasePrice=Base.units(rawRealEstate.purchasePrice),earnestDeposit=Base.units(rawRealEstate.earnestDeposit);
     must(BigInt(earnestDeposit)>=2000000n&&BigInt(earnestDeposit)<=BigInt(purchasePrice),'Earnest deposit must be at least 2 units and no more than the purchase price.');
     const ref=txt(rawRealEstate.propertyReference,'Property reference',4,160);
     must(!(/\b\d{1,6}\s+[^,\n]{2,80}\s+(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|court|ct|parkway|pkwy)\b/i.test(ref)||/\b\d{5}(?:-\d{4})?\b/.test(ref)),'Use a fictional property reference, not a street address or postal code.');
     must(['residential_purchase','commercial_purchase','land_purchase'].includes(rawRealEstate.transactionType),'Choose a supported transaction type.');
     const target=txt(rawRealEstate.targetClosingDate,'Target closing date',10,10);const targetMs=Date.parse(`${target}T00:00:00Z`);
     must(/^\d{4}-\d{2}-\d{2}$/.test(target)&&Number.isFinite(targetMs)&&targetMs>now-Base.DAY&&targetMs<=now+366*Base.DAY,'Target closing date must be a valid date within the next year.');
     must(Array.isArray(rawRealEstate.closingConditions),'Closing conditions must be an array.');
     const conditions=rawRealEstate.closingConditions.map(x=>txt(x,'Closing condition',8,500));
     realEstate={propertyReference:ref,transactionType:rawRealEstate.transactionType,purchasePrice,earnestDeposit,inspectionDays:num(rawRealEstate.inspectionDays,'Inspection days',1,30),financingContingency:rawRealEstate.financingContingency===true,appraisalContingency:rawRealEstate.appraisalContingency===true,settlementContact:txt(rawRealEstate.settlementContact,'Settlement contact',3,160),targetClosingDate:target,closingConditions:conditions};
     must(rawRealEstate.financingContingency===true||rawRealEstate.financingContingency===false,'Financing contingency must be explicit.');
     must(rawRealEstate.appraisalContingency===true||rawRealEstate.appraisalContingency===false,'Appraisal contingency must be explicit.');
     must(Array.isArray(rawRealEstate.closingConditions)&&conditions.length>=2&&conditions.length<=12,'Provide 2–12 closing conditions.');
     must(Base.units(base.amount)===earnestDeposit,'For this sandbox, agreement amount must equal earnest deposit.');
     base.amount=decimal(earnestDeposit);
   }
   const out=Base.applyCommand(s,actorId,'create_order',{...base,milestones:false},context);s=out.state;result=out.result;
   const o=s.orders.find(x=>x.id===result);o.workflow=workflow;
   if(realEstate){
     o.realEstate=realEstate;
     const first=BigInt(realEstate.earnestDeposit)/2n;
     stages(o,[{title:'Earnest money & due diligence',amount:decimal(first),days:realEstate.inspectionDays,scope:'Earnest deposit is held while the buyer completes the agreed inspection and due-diligence review.',criteria:realEstate.closingConditions.slice(0,Math.min(5,realEstate.closingConditions.length)),role:'delivery'},{title:'Closing release',amount:decimal(BigInt(realEstate.earnestDeposit)-first),days:Math.max(realEstate.inspectionDays,30),scope:'Release only after the closing checklist and agreed conditions are confirmed by the parties.',criteria:realEstate.closingConditions,role:'delivery'}]);
     o.snapshot.package='Real estate escrow · earnest-only sandbox';
   }else stages(o,milestoneSpecs);
   initializeTermsHash(o);
  }else if(command==='report_listing'){
    exact(p,['listingId','reason']);must(s.listings.some(x=>x.id===p.listingId),'Listing not found.');
    s.reports??=[];s.reports.push({id:uid('report'),listingId:p.listingId,actorId,reason:txt(p.reason,'Report reason',15,1500),at:now,status:'pending',decision:null,reviewedAt:null,reviewerId:null,reviewerReason:null});
  }else if(command==='moderate_listing'){
    if(!p.reportId){
      const out=Base.applyCommand(s,actorId,command,p,context);s=out.state;result=out.result;
    }else{
    exact(p,['listingId','decision','reportId','reason']);must(actor.role==='admin','Only the review team can moderate listings.','FORBIDDEN');
    const listing=s.listings.find(x=>x.id===p.listingId);must(listing,'Listing not found.');
    const report=s.reports?.find(x=>x.id===p.reportId);must(report&&report.listingId===listing.id,'Report not found for this listing.');
    must(['published','paused','hidden'].includes(listing.status),'This listing is not in a reviewable state.');
    must(['published','paused','hidden'].includes(p.decision),'Choose a supported listing decision.');
    if(p.decision==='hidden')must(typeof p.reason==='string'&&p.reason.trim().length>=15,'A reason is required when hiding a reported listing.');
    listing.status=p.decision;listing.moderationHistory??=[];listing.moderationHistory.push({reportId:report.id,decision:p.decision,reason:txt(p.reason||'Report reviewed and dismissed.','Moderation reason',15,1500),reviewerId:actorId,at:now});
    report.status=p.decision==='hidden'?'actioned':p.decision==='published'?'dismissed':'paused';report.decision=p.decision;report.reviewedAt=now;report.reviewerId=actorId;report.reviewerReason=txt(p.reason||'Report reviewed and listing state updated.','Moderation reason',15,1500);
    }
  }else if(command==='block_user'){
   exact(p,['userId']);must(p.userId!==actorId&&s.users.some(x=>x.id===p.userId),'Select another user.');s.blocks??=[];
   const index=s.blocks.findIndex(x=>x.actorId===actorId&&x.userId===p.userId);if(index<0)s.blocks.push({actorId,userId:p.userId,at:now});else s.blocks.splice(index,1);
 }else{
   const schemas={ship_goods:['carrier','tracking','evidence'],carrier_update:['status','note'],receive_goods:['acknowledge'],request_return:['reason'],authorize_return:['instructions'],send_return:['tracking','evidence'],confirm_return:['condition'],refund_return:['acknowledge'],release_warranty:['acknowledge'],add_evidence:['name','sha256','size','note']};
   exact(p,['orderId','expectedVersion',...schemas[command]]);
   const o=s.orders.find(x=>x.id===p.orderId);must(o,'Agreement not found.');must(p.expectedVersion===o.version,'Agreement changed. Refresh before retrying.','STALE_VERSION');
   const buyer=()=>must(actorId===o.buyerId,'Only the original buyer may do this.','FORBIDDEN'),seller=()=>must(actorId===o.sellerId,'Only the original seller may do this.','FORBIDDEN');
   must([o.buyerId,o.sellerId].includes(actorId)||actor.role==='admin','You are not a party to this deal.','FORBIDDEN');
   if(command==='add_evidence'){
     must([o.buyerId,o.sellerId].includes(actorId),'Only the original parties may add evidence.','FORBIDDEN');
     must(/^[a-f0-9]{64}$/.test(p.sha256),'A SHA-256 digest is required.');s.evidence??=[];s.evidence.push({id:uid('evidence'),orderId:o.id,actorId,name:txt(p.name,'File name',1,160),sha256:p.sha256,size:num(p.size,'File size',0,25000000),note:txt(p.note,'Evidence note',8,2000),at:now,storage:'digest-only'});
     record(o,actorId,'Evidence digest recorded. File contents are not uploaded or preserved by this sandbox.',now);
   }else{
     must(o.commerce&&o.fundedAt&&o.milestones.some(m=>!terminal(m)),'An unresolved funded product agreement is required.');
     const f=o.fulfillment,m=o.milestones.find(x=>x.role==='delivery');
     const noDispute=()=>must(!o.milestones.some(x=>x.status==='disputed'),'A dispute is open. Use the dispute decision or a mutually signed settlement.');
     if(command==='ship_goods'){
       seller();noDispute();must(!f.shippedAt,'Shipment already recorded.');
       f.carrier=txt(p.carrier,'Carrier',2,100);f.tracking=txt(p.tracking,'Tracking number',4,160);f.shippingEvidence=txt(p.evidence,'Shipping evidence',15,2500);f.shippedAt=now;f.status='shipped';record(o,actorId,`Shipment recorded with ${f.carrier}. This does not start inspection or release payment.`,now);
     }else if(command==='carrier_update'){
       seller();must(f.shippedAt&&!f.receivedAt,'Shipment update not available.');must(['in transit','carrier reports delivered','exception'].includes(p.status),'Unsupported carrier status.');
       f.status=p.status;record(o,actorId,`Seller-reported carrier event: ${p.status}. ${txt(p.note,'Carrier note',10,1000)} Not an independently verified tracking event.`,now);
     }else if(command==='receive_goods'){
       buyer();noDispute();must(f.shippedAt&&!f.receivedAt,'Confirm receipt after shipment, only once.');must(p.acknowledge===true,'Confirm physical receipt, not acceptance.');must(m.status==='funded','Delivery milestone is not pending.');
       f.receivedAt=now;f.status='inspection';f.inspectionEndsAt=now+o.commerce.inspectionDays*Base.DAY;f.warrantyEndsAt=now+o.commerce.warrantyDays*Base.DAY;
       m.status='submitted';m.submittedAt=now;m.reviewEndsAt=f.inspectionEndsAt;m.revision++;
       if(m.proposal?.status==='pending')m.proposal.status='superseded';
       m.deliveries.push({id:uid('receipt'),text:'Buyer confirmed receipt; inspection is now open. Receipt alone does not accept condition or release funds.',evidence:f.tracking,at:now});
       record(o,actorId,'Buyer confirmed receipt. Funds stay held while the buyer inspects the goods.',now);
     }else if(command==='request_return'){
       buyer();must(f.receivedAt&&!f.returnStatus,'A return can be requested once after receipt.');must(now<=f.inspectionEndsAt,'Inspection window ended. Use the agreed warranty dispute or negotiation.');must(!terminal(m),'Main delivery payment has already settled. Only retained funds remain available.');
       f.returnStatus='requested';f.returnReason=txt(p.reason,'Return reason',20,4000);f.returnRequestedAt=now;record(o,actorId,'Return requested. No 5% charge for this request; no refund is automatic. Formal arbitration is a separate action.',now);
     }else if(command==='authorize_return'){
       seller();must(f.returnStatus==='requested','There is no pending return request.');f.returnStatus='authorized';f.returnInstructions=txt(p.instructions,'Return instructions',20,2500);record(o,actorId,'Seller authorized the return. Payment destinations are unchanged.',now);
     }else if(command==='send_return'){
       buyer();must(f.returnStatus==='authorized','Seller must authorize return logistics first.');f.returnStatus='in-transit';f.returnTracking=txt(p.tracking,'Return tracking',4,160);f.returnEvidence=txt(p.evidence,'Return evidence',15,2500);record(o,actorId,'Buyer recorded return shipment. Funds remain held.',now);
     }else if(command==='confirm_return'){
       seller();must(f.returnStatus==='in-transit','Return is not in transit.');f.returnStatus='received';f.returnCondition=txt(p.condition,'Returned condition',15,2500);record(o,actorId,'Seller confirmed the returned goods. Refund still requires agreement or a dispute ruling.',now);
     }else if(command==='refund_return'){
       seller();noDispute();must(f.returnStatus==='received'&&p.acknowledge===true,'Confirm the agreed return and refund.');
       // The buyer requested return; seller now confirms the full retained-principal refund.
       for(const part of o.milestones.filter(x=>!terminal(x))){
         let current=s.orders.find(x=>x.id===o.id);
         let out=Base.applyCommand(s,actorId,'propose_terms',{orderId:o.id,milestoneId:part.id,expectedVersion:current.version,kind:'settle',amount:'0',scope:'Buyer requested a return. Seller received it and approves refunding all principal still held for this milestone.',days:0},context);s=out.state;
         current=s.orders.find(x=>x.id===o.id);const proposal=current.milestones.find(x=>x.id===part.id).proposal;
         // Do NOT impersonate the buyer: they must accept this proposal via the normal UI.
         record(current,actorId,`Full refund offered for ${part.title}. Original buyer must accept proposal ${proposal.id}.`,now);
       }
       result=o.id;assertInvariants(s,input);return {state:s,result};
     }else if(command==='release_warranty'){
       buyer();noDispute();must(p.acknowledge===true&&f.receivedAt&&now>=f.warrantyEndsAt,'The agreed warranty period must have elapsed.');
       must(!f.returnStatus||f.returnStatus==='closed','An unresolved return blocks warranty release.');
       must(terminal(m),'Settle the delivery milestone first.');const w=o.milestones.find(x=>x.role==='warranty'&&!terminal(x));must(w?.status==='funded','No pending warranty holdback.');if(w.termsHistory.length)must(now>=w.dueAt,'The amended holdback deadline has not elapsed.');
       w.status='submitted';w.submittedAt=now;w.reviewEndsAt=now;w.revision++;
       const out=Base.applyCommand(s,actorId,'approve_delivery',{orderId:o.id,milestoneId:w.id,expectedVersion:o.version,criteriaAccepted:true},context);s=out.state;result=o.id;assertInvariants(s,input);return {state:s,result};
     }
   }
   o.version++;result=o.id;
 }
 s.version++;assertInvariants(s,input);return {state:s,result};
}
export function createSeedState(now=Date.now()){
 let s=Base.createSeedState(now);s.universalVersion=2;s.evidence=[];s.reports=[];s.blocks=[];s.domainOffers=[];s.payrollByUser={};
 const products=[
 ['furniture','noa','Solid oak accent chair, made for everyday living','325','45',8,'Oak frame, natural oil finish, woven seat. 58 × 60 × 78 cm.','New, made to order','chair'],
 ['electronics','maya','Compact studio camera kit with tested accessories','690','18',5,'Mirrorless camera body, lens, battery and charger. Serial numbers recorded before shipment.','Used, inspected','camera'],
 ['wholesale','hana','Architectural lighting samples for your next project','240','35',20,'Four indoor lighting samples with agreed wattage, CCT and finish. Datasheets supplied.','New samples','lamp'],
 ['collectibles','leila','Original signed print, carefully packed and tracked','85','12',12,'Archival pigment print, 40 × 50 cm, unframed. Signed certificate included.','New, numbered print','print'],
 ['fashion','kai','Small-batch canvas weekender with full-grain handles','110','15',15,'Heavy canvas body, leather handles, lined compartment; dimensions 48 × 28 × 24 cm.','New','bag'],
 ['furniture','samir','Hand-finished side table with approved material swatch','180','30',10,'Solid acacia table, 45 cm diameter, 52 cm height. Finish matched to approved swatch.','New, custom finish','table']
 ];
 for(const [categoryId,sellerId,title,price,shipping,stock,specifications,condition,art] of products){
   const cat=categoryById(categoryId),out=applyCommand(s,sellerId,'create_product',{title,categoryId,description:`${specifications} Seller and buyer confirm the exact specification, delivery terms and inspection checklist before funding.`,criteria:cat.checks,prices:{USDC:price,USDT:price},shippingPrices:{USDC:shipping,USDT:shipping},stock,days:10,inspectionDays:3,warrantyDays:14,holdbackBps:1000,condition,returns:'Report transit damage or material mismatch during inspection. Agree return shipping responsibility before funding. Fourteen-day holdback covers documented material defects, not normal wear.',specifications,shippingRegion:'Illustrative domestic delivery · confirm service area'}, {now});s=out.state;
   const l=s.listings.find(x=>x.id===out.result);l.id=`goods-${art}`;l.status='published';l.art=art;l.sample=true;
 }
 let out=applyCommand(s,'buyer','purchase_product',{listingId:'goods-chair',quantity:2,requirements:'Two chairs in the natural finish. Verify dimensions and photograph packing before dispatch. All product details are demonstration data.',deliveryReference:'DEMO delivery reference only — not a real address',agreeInspection:true,agreeFees:true},{now:now-4*Base.DAY});s=out.state;const id=out.result;
 for(const [actor,command,extra] of [['noa','accept_order',{}],['buyer','fund_order',{}],['noa','ship_goods',{carrier:'Demo carrier',tracking:'DEMO-EG-2048',evidence:'Illustrative packing list and parcel photograph reference; no real shipment.'}]]){
   out=applyCommand(s,actor,command,{orderId:id,expectedVersion:s.orders.find(x=>x.id===id).version,...extra},{now:now-2*Base.DAY});s=out.state;
 }
 const domain=normalizeDomainName('harboratelier.example');
 s.listings.unshift({id:'domain-harboratelier',kind:'domain',categoryId:'domains',category:'Domains & websites',sellerId:'noa',title:'harboratelier.example · brandable domain',description:'A fictional brandable domain for a design, hospitality or creative studio. This sandbox listing demonstrates control verification and registrar transfer steps; it is not a real registrable asset.',criteria:['Seller control verification is recorded','Domain transfer or registrar push is initiated','Buyer DNS control challenge succeeds'],domainName:domain,domainKey:domain,registrar:'Demo Registrar',expiryDate:new Date(now+180*Base.DAY).toISOString().slice(0,10),transferMethod:'registrar_push',renewalResponsibility:'buyer',includedAssets:['Domain registration only','Transfer assistance checklist'],askingPrices:{USDC:'750000000',USDT:'750000000'},prices:{USDC:'750000000',USDT:'750000000'},minimumOffers:{USDC:'500000000',USDT:'500000000'},ownershipConfirmed:true,controlChallenge:'eg-demo-domain-control-2026',controlVerification:{method:'dns_txt_simulation',verifiedAt:now-Base.DAY,note:'Seeded fictional verification for the offline demo.',proof:'matched'},cover:'domains',headline:'A domain with a clear handover.',status:'published',createdAt:now-2*Base.DAY,sample:true,tags:['Domains & websites','Verified transfer required'],packages:[0,1,2].map(i=>({name:i===0?'Domain transfer':i===1?'Transfer + support':'Full handover',prices:{USDC:'750000000',USDT:'750000000'},days:14,revisions:0,description:'Transfer the fictional domain and complete the buyer DNS control challenge. No website, email account or credential sale is included.'}))});
 assertInvariants(s);return s;
}
