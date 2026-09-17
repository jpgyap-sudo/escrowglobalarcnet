/** Shared validation. Mint addresses are from Circle/Tether official docs, checked 2026-09-12. */
export const TOKENS=Object.freeze({USDC:{symbol:'USDC',decimals:6,mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'},USDT:{symbol:'USDT',decimals:6,mint:'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'},SOL:{symbol:'SOL',decimals:9,mint:'So11111111111111111111111111111111111111112'}});
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Decode(text){
 if(typeof text!=='string'||text.length<1||text.length>100)throw new Error('Invalid base58 value.');
 let n=0n;for(const c of text){const v=alphabet.indexOf(c);if(v<0)throw new Error('Invalid base58 character.');n=n*58n+BigInt(v);}
 const bytes=[];while(n){bytes.unshift(Number(n&255n));n>>=8n;}for(const c of text){if(c==='1')bytes.unshift(0);else break;}return Uint8Array.from(bytes);
}
export function base58Encode(bytes){let n=0n;for(const b of bytes)n=(n<<8n)+BigInt(b);let s='';while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const b of bytes){if(b===0)s='1'+s;else break;}return s;}
export function validateAddress(address){
 if(typeof address!=='string'||address!==address.trim()||base58Decode(address).length!==32)throw new Error('Enter a valid Solana wallet address (32 decoded bytes).');
 if(['11111111111111111111111111111111',...Object.values(TOKENS).map(t=>t.mint)].includes(address))throw new Error('A token mint or system-program address is not a receiving wallet.');return address;
}
export function decimalAmount(x,{positive=true,max=100000}={}){if(typeof x!=='string'||!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(x)||!Number.isFinite(Number(x))||Number(x)>max||(positive&&Number(x)<=0))throw new Error('Enter a positive decimal amount, up to six decimal places.');return x;}
export function makeReceiveRequest({address,token='USDC',amount=''}){
 validateAddress(address);if(!['USDC','USDT'].includes(token))throw new Error('Choose native Solana USDC or USDT.');
 const q=new URLSearchParams({'spl-token':TOKENS[token].mint,label:'Personal wallet top-up',message:'Wallet transfer only. This does not fund an Escrow Global escrow.'});if(amount)q.set('amount',decimalAmount(amount));
 return `solana:${address}?${q.toString()}`;
}
export function checkedExternalURL(value,hosts){const u=new URL(value);if(u.protocol!=='https:'||!hosts.includes(u.hostname)||u.username||u.password||(u.port&&u.port!=='443'))throw new Error('Unapproved external destination.');return u.toString();}
export const SAFE_EXTERNAL_HOSTS=['jup.ag','docs.jup.ag','support.jup.ag','developers.jup.ag','plugin.jup.ag','moonpay.com','www.moonpay.com','buy.moonpay.com','buy-sandbox.moonpay.com','support.moonpay.com','dev.moonpay.com','transak.com','www.transak.com','docs.transak.com','global.transak.com','global-stg.transak.com','global-staging.transak.com','solana.com','developers.circle.com','tether.to','apps.apple.com','play.google.com'];
