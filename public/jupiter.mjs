import {TOKENS} from '/payments.mjs';
let scriptPromise;
export async function mountJupiter(targetId,{output='USDC',onSuccess=()=>{},onError=()=>{}}={}){
 if(window.PACT_NATIVE)throw new Error('Trading is disabled in the native submission template pending wallet integration and store/regional approval. Use an approved web deployment.');
 if(location.protocol==='file:')throw new Error('Start the local server with npm start before loading the live Jupiter widget.');
 if(!['USDC','USDT'].includes(output))throw new Error('Unsupported output token.');
 if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{
   if(window.Jupiter)return resolve();const script=document.createElement('script');script.src='https://plugin.jup.ag/plugin-v1.js';script.defer=true;
   const timer=setTimeout(()=>{script.remove();scriptPromise=null;reject(new Error('Jupiter timed out. Check connectivity or use the official Jupiter website.'));},20000);
   script.onload=()=>{clearTimeout(timer);if(window.Jupiter)resolve();else{scriptPromise=null;reject(new Error('Jupiter widget did not initialize.'));}};
   script.onerror=()=>{clearTimeout(timer);script.remove();scriptPromise=null;reject(new Error('Jupiter could not load. External network access is required.'));};document.head.append(script);
 });
 await scriptPromise;if(!document.getElementById(targetId))return;
 window.Jupiter.init({displayMode:'integrated',integratedTargetId:targetId,formProps:{initialInputMint:TOKENS.SOL.mint,initialOutputMint:TOKENS[output].mint},onSuccess:info=>onSuccess(info),onSwapError:error=>onError(error)});
}
export function closeJupiter(){try{window.Jupiter?.close?.();}catch{}}
