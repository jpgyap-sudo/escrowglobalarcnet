import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {validateAddress,decimalAmount} from '../payments.mjs';
const methods=['auto','credit_debit_card','apple_pay','google_pay','sepa_bank_transfer','gbp_bank_transfer'];
export function signMoonPayURL(url,secret){
 const u=new URL(url);if(!['https://buy.moonpay.com','https://buy-sandbox.moonpay.com'].includes(u.origin)||u.username||u.password||u.hash||u.searchParams.has('signature'))throw new Error('Invalid MoonPay URL to sign.');
 if(!secret)throw new Error('MoonPay secret key missing.');
 const signature=createHmac('sha256',secret).update(u.search).digest('base64');return `${u.toString()}&signature=${encodeURIComponent(signature)}`;
}
export function buildMoonPayURL(input,config,{publicIp,requestId}={}){
 const {address,token='USDC',amount,fiat='usd',method='auto'}=input;validateAddress(address);decimalAmount(amount);
 if(!['USDC','USDT'].includes(token))throw new Error('Unsupported token.');
 if(!['usd','eur','gbp','php','sgd','aud','cad'].includes(fiat))throw new Error('Unsupported fiat selection. The provider makes the final eligibility decision.');
 if(!methods.includes(method))throw new Error('Unsupported payment method.');
 const live=config.environment==='live';
 if(!['sandbox','live'].includes(config.environment))throw new Error('Invalid provider environment.');
 if(live&&!config.allowLive)throw new Error('Live on-ramp is disabled.');
 const prefix=live?'live':'test';if(!config.publicKey?.startsWith(`pk_${prefix}_`)||!config.secretKey?.startsWith(`sk_${prefix}_`))throw new Error('MoonPay keys must match the chosen environment.');
 // Explicit partner-dashboard codes: never guess a token network from a ticker.
 const currencyCode=config.currencyCodes?.[token];if(!currencyCode||!/^[a-z0-9_]{2,50}$/.test(currencyCode))throw new Error(`Configure the verified MoonPay Solana ${token} currency code from your partner dashboard.`);
 const u=new URL(live?'https://buy.moonpay.com/':'https://buy-sandbox.moonpay.com/');
 u.searchParams.set('apiKey',config.publicKey);u.searchParams.set('currencyCode',currencyCode);u.searchParams.set('walletAddress',address);u.searchParams.set('baseCurrencyCode',fiat);u.searchParams.set('baseCurrencyAmount',amount);u.searchParams.set('showWalletAddressForm','true');
 if(method!=='auto')u.searchParams.set('paymentMethod',method);
 if(requestId)u.searchParams.set('externalTransactionId',requestId);
 if(config.returnURL){const r=new URL(config.returnURL);if(r.protocol!=='https:')throw new Error('MoonPay redirect must be HTTPS.');u.searchParams.set('redirectURL',r.toString());}
 if(live){
   // Public IP must come from the verified edge, never a client JSON field or arbitrary X-Forwarded-For.
   // Deliberately IPv4-only until a reviewed IPv6 edge integration is supplied.
   const octets=String(publicIp||'').split('.').map(Number),[a,b,c]=octets;
   const reserved=isIP(publicIp||'')!==4||a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113);
   if(reserved)throw new Error('Live MoonPay requires the verified customer public IPv4 address. Configure a trusted edge before enabling it.');
   u.searchParams.set('allowedIpAddress',createHmac('sha256',config.secretKey).update(publicIp).digest('base64'));
 }
 return signMoonPayURL(u,config.secretKey);
}
export function moonPayPublicConfig(config){return {configured:Boolean(config.publicKey&&config.secretKey),environment:config.environment,enabledTokens:['USDC','USDT'].filter(t=>Boolean(config.currencyCodes?.[t])),liveAllowed:Boolean(config.allowLive)};}
