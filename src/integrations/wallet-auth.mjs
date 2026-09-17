/** Short-lived ownership proofs for ON-RAMP PREFILL ONLY; not marketplace account auth. */
import {randomBytes,createPublicKey,verify} from 'node:crypto';
import {base58Decode,validateAddress} from '../payments.mjs';
export class WalletProofs{
 constructor({origin,now=()=>Date.now(),ttl=300000,max=1000}={}){this.origin=origin;this.now=now;this.ttl=ttl;this.max=max;this.challenges=new Map();this.sessions=new Map();}
 prune(){for(const map of [this.challenges,this.sessions])for(const [k,v]of map)if(v.expires<=this.now())map.delete(k);}
 challenge(address){validateAddress(address);this.prune();if(this.challenges.size>=this.max)throw new Error('Too many wallet challenges. Retry later.');const id=randomBytes(24).toString('hex'),expires=this.now()+this.ttl;
 const message=`Escrow Global Settlement wallet ownership verification\nOrigin: ${this.origin}\nWallet: ${address}\nNonce: ${id}\nExpires: ${new Date(expires).toISOString()}\nPurpose: prefill a crypto purchase to MY OWN wallet.\nThis is not an escrow agreement, token transfer, or spending approval.`;
 this.challenges.set(id,{address,message,expires});return {id,message,expires};}
 verify({id,signature}){this.prune();const c=this.challenges.get(id);this.challenges.delete(id);if(!c||c.expires<=this.now())throw new Error('Wallet challenge expired or already used.');
 if(typeof signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))throw new Error('Invalid signature encoding.');const sig=Buffer.from(signature,'base64');if(sig.length!==64)throw new Error('Invalid Ed25519 signature length.');
 const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(base58Decode(c.address))]),format:'der',type:'spki'});
 if(!verify(null,Buffer.from(c.message),publicKey,sig))throw new Error('Wallet ownership signature rejected.');
 if(this.sessions.size>=this.max)throw new Error('Too many sessions.');const token=randomBytes(32).toString('hex');this.sessions.set(token,{address:c.address,expires:this.now()+this.ttl});return {token,address:c.address};}
 session(token){this.prune();return this.sessions.get(token)||null;}
}
