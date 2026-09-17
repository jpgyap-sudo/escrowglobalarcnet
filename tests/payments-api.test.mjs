import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {base58Encode} from '../src/payments.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),delay=ms=>new Promise(r=>setTimeout(r,ms));
test('Payment API proves destination ownership without enabling live custody',async t=>{
 const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pact-pay-')),url=`http://127.0.0.1:${port}`,child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),DATA_FILE:path.join(temp,'state.json'),ESCROW_MODE:'sandbox',MOONPAY_ENV:'sandbox',MOONPAY_PUBLIC_KEY:'pk_test_api_fixture',MOONPAY_SECRET_KEY:'sk_test_private_fixture',MOONPAY_SOLANA_USDC_CODE:'usdc_sol_fixture',MOONPAY_SOLANA_USDT_CODE:'usdt_sol_fixture'},stdio:'ignore'});
 const post=(route,data,headers={})=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 try{
 let healthy=false;for(let i=0;i<240;i++){try{if((await fetch(url+'/api/health')).ok){healthy=true;break;}}catch{}await delay(50);}assert.equal(healthy,true,'sandbox server did not become healthy before the API checks');
 const before=(await(await fetch(url+'/api/state')).json()).state;
 await t.test('Public configuration exposes capabilities but no API keys',async()=>{const r=await fetch(url+'/api/payments/config'),x=await r.text();assert.equal(r.status,200);assert.ok(!x.includes('fixture'));const c=JSON.parse(x);assert.equal(c.escrow.liveCustody,false);assert.equal(c.nativeLiveEnabled,false);assert.equal(c.jupiterSpend.guideOnly,true);});
 await t.test('No real escrow deposit transaction can be requested',async()=>{const r=await post('/api/payments/escrow-transaction',{});assert.equal(r.status,501);assert.equal((await r.json()).code,'LIVE_CUSTODY_UNAVAILABLE');});
 await t.test('Checkout without an ownership proof fails',async()=>{const r=await post('/api/onramp/moonpay/session',{token:'USDC',amount:'50'});assert.equal(r.status,401);});
 await t.test('A hostile origin cannot request a wallet proof',async()=>{const r=await post('/api/wallet/challenge',{address:'bad'},{Origin:'https://hostile.example'});assert.equal(r.status,403);});
 const pair=generateKeyPairSync('ed25519'),address=base58Encode(pair.publicKey.export({type:'spki',format:'der'}).subarray(-32));let cookie,proof;
 await t.test('Signed proof establishes HttpOnly, same-site, bounded purpose session',async()=>{proof=await(await post('/api/wallet/challenge',{address})).json();const r=await post('/api/wallet/verify',{id:proof.id,signature:sign(null,Buffer.from(proof.message),pair.privateKey).toString('base64')});assert.equal(r.status,200);cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);const data=await r.json();assert.equal(data.address,address);assert.equal(data.purpose,'onramp-prefill-only');assert.equal(data.token,undefined);cookie=cookie.split(';')[0];});
 await t.test('A used ownership nonce is rejected',async()=>{const r=await post('/api/wallet/verify',{id:proof.id,signature:sign(null,Buffer.from(proof.message),pair.privateKey).toString('base64')});assert.equal(r.status,400);});
 await t.test('On-ramp cannot accept a caller-supplied replacement wallet',async()=>{const r=await post('/api/onramp/moonpay/session',{token:'USDC',amount:'50',address},{Cookie:cookie});assert.equal(r.status,400);assert.match((await r.json()).error,/Unsupported input/);});
 await t.test('Checkout signs the authenticated wallet and remains separate from escrow',async()=>{const r=await post('/api/onramp/moonpay/session',{token:'USDT',amount:'50',fiat:'usd',method:'credit_debit_card'},{Cookie:cookie});assert.equal(r.status,200);const data=await r.json(),u=new URL(data.url);assert.equal(u.origin,'https://buy-sandbox.moonpay.com');assert.equal(u.searchParams.get('walletAddress'),address);assert.equal(u.searchParams.get('currencyCode'),'usdt_sol_fixture');assert.ok(u.searchParams.get('signature'));assert.equal(data.destination,'user-wallet-not-escrow');});
 await t.test('Payment routes cannot credit simulated escrow balances',async()=>{const after=(await(await fetch(url+'/api/state')).json()).state;assert.deepEqual(after,before);});
 await t.test('Secrets and arbitrary source paths are not served',async()=>{for(const route of ['/.env','/src/integrations/moonpay.mjs','/src/integrations/account-auth.mjs','/data/state.json','/package.json'])assert.equal((await fetch(url+route)).status,404);});
 }finally{if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}fs.rmSync(temp,{recursive:true,force:true});}
});
