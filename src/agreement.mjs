/**
 * Canonical agreement terms for hashing and cross-service conformance.
 *
 * This is deliberately chain-neutral and sandbox-safe. It does not sign,
 * custody, or authorize money. Production clients and a custody program must
 * adopt the same schema and publish test vectors before accepting deposits.
 */
export const AGREEMENT_SCHEMA_VERSION = 1;
export const CANONICALIZATION_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

// Synchronous SHA-256 keeps the shared domain module usable in both Node and
// browser/mobile previews. Production SDKs should cross-check these vectors
// against a maintained cryptographic library before signing transactions.
const SHA256_K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
function sha256Hex(text){
  const bytes=new TextEncoder().encode(text),bitLength=bytes.length*8;
  const length=((bytes.length+9+63)>>6)<<6,data=new Uint8Array(length);data.set(bytes);data[bytes.length]=0x80;
  const view=new DataView(data.buffer);view.setUint32(length-8,Math.floor(bitLength/0x100000000)>>>0);view.setUint32(length-4,bitLength>>>0);
  let h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w=new Uint32Array(64);
  for(let offset=0;offset<length;offset+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2],s0=rotr(x,7)^rotr(x,18)^(x>>>3),s1=rotr(y,17)^rotr(y,19)^(y>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}
    let [a,b,c,d,e,f,g,hh]=h;
    for(let i=0;i<64;i++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25),ch=(e&f)^(~e&g),t1=(hh+S1+ch+SHA256_K[i]+w[i])>>>0,S0=rotr(a,2)^rotr(a,13)^rotr(a,22),maj=(a&b)^(a&c)^(b&c),t2=(S0+maj)>>>0;hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    h=new Uint32Array([(h[0]+a)>>>0,(h[1]+b)>>>0,(h[2]+c)>>>0,(h[3]+d)>>>0,(h[4]+e)>>>0,(h[5]+f)>>>0,(h[6]+g)>>>0,(h[7]+hh)>>>0]);
  }
  return Array.from(h,x=>x.toString(16).padStart(8,'0')).join('');
}

function safeString(value) {
  const normalized = value.normalize('NFC');
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = normalized.charCodeAt(i + 1);
      if (i + 1 >= normalized.length || next < 0xdc00 || next > 0xdfff) throw new TypeError('Agreement terms contain an unpaired surrogate.');
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('Agreement terms contain an unpaired surrogate.');
    }
  }
  return normalized;
}

function normalized(value, seen = new WeakSet()) {
  if (typeof value === 'string') return safeString(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Agreement terms cannot contain circular references.');
    seen.add(value);
    const output = value.map(item => normalized(item, seen));
    seen.delete(value);
    return output;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('Agreement terms cannot contain circular references.');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Agreement terms must contain plain objects.');
    seen.add(value);
    const keys = Object.keys(value).map(key => [safeString(key), key]);
    if (new Set(keys.map(([key]) => key)).size !== keys.length) throw new TypeError('Agreement terms contain colliding normalized keys.');
    const output = Object.fromEntries(keys.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([key, original]) => [key, normalized(value[original], seen)]));
    seen.delete(value);
    return output;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Agreement terms cannot contain a non-finite number.');
    if (!Number.isSafeInteger(value)) throw new TypeError('Agreement terms numbers must be safe integers; use strings for decimal amounts.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('Agreement terms contain an unsupported value.');
  }
  return value;
}

export function canonicalJSON(value) {
  return JSON.stringify(normalized(value));
}

export function agreementHash(value) {
  return sha256Hex(canonicalJSON(value));
}

export function sha256Text(value) {
  if (typeof value !== 'string') throw new TypeError('SHA-256 input must be text.');
  return sha256Hex(value);
}

/** Return only terms that parties and a future custody program must agree on. */
export function agreementTerms(order) {
  return {
    schemaVersion: AGREEMENT_SCHEMA_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    agreementId: order.id,
    chain: { network: order.network || 'sandbox', chainId: order.chainId || 'sandbox', programVersion: order.programVersion || 'not-deployed' },
    parties: {
      buyer: { id: order.buyerId, wallet: order.buyerWallet },
      seller: { id: order.sellerId, wallet: order.sellerWallet }
    },
    asset: { token: order.token, tokenProgram: order.tokenProgram || 'demo-token-program', decimals: 6 },
    fees: { recipient: order.feeWallet, currency: order.feeCurrency || order.token, commissionBps: order.feeBps, disputeBps: order.disputeBps },
    amendment: { index: order.termsVersion || 1, previousHash: order.previousTermsHash || null },
    listingId: order.listingId ?? null,
    workflow: order.workflow || 'service',
    snapshot: order.snapshot,
    commerce: order.commerce ?? null,
    milestones: (order.milestones || []).map(m => ({
      id: m.id,
      title: m.title,
      role: m.role || 'delivery',
      originalAmount: m.originalAmount,
      dueOffset: m.dueOffset,
      scope: m.scope,
      criteria: m.criteria
    }))
  };
}

export function termsHash(order) {
  return agreementHash(agreementTerms(order));
}

/** Set the initial immutable terms commitment after an order is fully built. */
export function initializeTermsHash(order) {
  const hash = termsHash(order);
  order.termsHash = hash;
  order.currentTermsHash = hash;
  order.termsVersion = 1;
  order.previousTermsHash = null;
  order.termsHashHistory = [];
  order.termsHashSeal = agreementHash({ domain: 'PACT_ORIGINAL_TERMS_V1', agreementId: order.id, hash });
  return hash;
}

/** Record a bilateral amendment while preserving the original commitment. */
export function refreshCurrentTermsHash(order, metadata = {}) {
  if (!order.currentTermsHash) return initializeTermsHash(order);
  const previousHash = order.currentTermsHash;
  const previousVersion = order.termsVersion || 1;
  order.termsVersion = previousVersion + 1;
  order.previousTermsHash = previousHash;
  const nextHash = termsHash(order);
  order.termsHashHistory = [...(order.termsHashHistory || []), {
    version: previousVersion,
    hash: previousHash,
    nextHash,
    ...metadata
  }];
  order.currentTermsHash = nextHash;
  return order.currentTermsHash;
}

export function verifyCurrentTermsHash(order) {
  if (!order.currentTermsHash) return true;
  if (order.currentTermsHash !== termsHash(order)) return false;
  if (!order.termsHashSeal) return true; // readable legacy sandbox state
  if (order.termsHashSeal !== agreementHash({ domain: 'PACT_ORIGINAL_TERMS_V1', agreementId: order.id, hash: order.termsHash })) return false;
  if (!Number.isInteger(order.termsVersion) || order.termsVersion !== (order.termsHashHistory || []).length + 1) return false;
  let previous = order.termsHash;
  const history = order.termsHashHistory || [];
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (entry.version !== i + 1 || entry.hash !== previous || typeof entry.nextHash !== 'string') return false;
    if (i < history.length - 1 && entry.nextHash !== history[i + 1].hash) return false;
    previous = entry.nextHash;
  }
  return previous === order.currentTermsHash;
}
