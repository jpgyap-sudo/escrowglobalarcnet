import {validateAddress} from '/payments.mjs';
/** Wallet Standard discovery without a wallet-specific injected-global dependency. */
const wallets=new Set();
const appAPI=Object.freeze({register:(...items)=>{for(const w of items)wallets.add(w);return ()=>items.forEach(w=>wallets.delete(w));},get:()=>[...wallets]});
window.addEventListener('wallet-standard:register-wallet',event=>{try{event.detail(appAPI);}catch{/* Invalid wallet registration is ignored. */}});
try{window.dispatchEvent(new CustomEvent('wallet-standard:app-ready',{detail:appAPI}));}catch{}
export function availableWallets(){return [...wallets].filter(w=>w.chains?.some(c=>c.startsWith('solana:'))&&w.features?.['standard:connect']);}
export async function connectWallet(index=0){
 const list=availableWallets(),wallet=list[index];if(!wallet)throw new Error('No Wallet Standard wallet found. Install a supported Solana wallet or open Escrow Global in your wallet’s dApp browser. No seed phrase is needed.');
 const out=await wallet.features['standard:connect'].connect();const account=out.accounts?.find(a=>a.chains?.includes('solana:mainnet'))||out.accounts?.[0];if(!account)throw new Error('Wallet did not return an account.');validateAddress(account.address);return {wallet,account};
}
export async function proveWallet(connection,fetcher=fetch){
 if(!connection?.wallet.features['solana:signMessage'])throw new Error('This wallet does not support message signing. Use a compatible wallet for protected on-ramp prefill.');
 const challenge=await fetcher('/api/wallet/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:connection.account.address})}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j;});
 const result=await connection.wallet.features['solana:signMessage'].signMessage({account:connection.account,message:new TextEncoder().encode(challenge.message)});
 const bytes=result[0]?.signature;if(!bytes)throw new Error('Wallet signature missing.');
 const signature=btoa(String.fromCharCode(...bytes));
 const response=await fetcher('/api/wallet/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:challenge.id,signature})});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
