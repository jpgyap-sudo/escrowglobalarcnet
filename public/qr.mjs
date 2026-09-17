/** QR byte-mode encoder, error correction L, versions 1–20, fixed mask 0.
 * QR structural constants follow ISO/IEC 18004; verified against python-qrcode.
 * Not a payment verifier. QR content must be independently checked by a wallet. */
const BLOCKS=[[[26,19]],[[44,34]],[[70,55]],[[100,80]],[[134,108]],[[86,68],[86,68]],[[98,78],[98,78]],[[121,97],[121,97]],[[146,116],[146,116]],[[86,68],[86,68],[87,69],[87,69]],[[101,81],[101,81],[101,81],[101,81]],[[116,92],[116,92],[117,93],[117,93]],[[133,107],[133,107],[133,107],[133,107]],[[145,115],[145,115],[145,115],[146,116]],[[109,87],[109,87],[109,87],[109,87],[109,87],[110,88]],[[122,98],[122,98],[122,98],[122,98],[122,98],[123,99]],[[135,107],[136,108],[136,108],[136,108],[136,108],[136,108]],[[150,120],[150,120],[150,120],[150,120],[150,120],[151,121]],[[141,113],[141,113],[141,113],[142,114],[142,114],[142,114],[142,114]],[[135,107],[135,107],[135,107],[136,108],[136,108],[136,108],[136,108],[136,108]]];
const ALIGN=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90]];
const EXP=new Uint8Array(512),LOG=new Uint8Array(256);
let g=1;for(let i=0;i<255;i++){EXP[i]=g;LOG[g]=i;g<<=1;if(g&256)g^=0x11d;}for(let i=255;i<512;i++)EXP[i]=EXP[i-255];
const mul=(a,b)=>a&&b?EXP[LOG[a]+LOG[b]]:0;
function parity(data,n){let gen=[1];for(let i=0;i<n;i++){const out=Array(gen.length+1).fill(0);for(let j=0;j<gen.length;j++){out[j]^=gen[j];out[j+1]^=mul(gen[j],EXP[i]);}gen=out;}const work=[...data,...Array(n).fill(0)];for(let i=0;i<data.length;i++){const k=work[i];if(k)for(let j=0;j<gen.length;j++)work[i+j]^=mul(gen[j],k);}return work.slice(-n);}
function bch(value,polynomial){let x=value;const degree=n=>31-Math.clz32(n);while(degree(x)>=degree(polynomial))x^=polynomial<<(degree(x)-degree(polynomial));return x;}
export function qrMatrix(text){
 const bytes=new TextEncoder().encode(String(text));let v=1;
 for(;v<=20;v++){const cap=BLOCKS[v-1].reduce((n,b)=>n+b[1],0)*8;if(4+(v<10?8:16)+bytes.length*8<=cap)break;}
 if(v>20)throw new Error('Payment request is too long for this QR encoder.');
 const capacity=BLOCKS[v-1].reduce((n,b)=>n+b[1],0),bits=[];
 const put=(val,len)=>{for(let i=len-1;i>=0;i--)bits.push((val>>>i)&1);};
 put(4,4);put(bytes.length,v<10?8:16);bytes.forEach(x=>put(x,8));
 for(let n=Math.min(4,capacity*8-bits.length);n>0;n--)bits.push(0);while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((n,b)=>(n<<1)|b,0));
 for(let i=0;data.length<capacity;i++)data.push(i%2?0x11:0xec);
 let offset=0;const blocks=BLOCKS[v-1].map(([t,d])=>{const a=data.slice(offset,offset+d);offset+=d;return[a,parity(a,t-d)];});
 const words=[];for(let k=0;k<2;k++){const max=Math.max(...blocks.map(b=>b[k].length));for(let i=0;i<max;i++)for(const b of blocks)if(i<b[k].length)words.push(b[k][i]);}
 const n=v*4+17,m=Array.from({length:n},()=>Array(n).fill(null));
 function finder(r,c){for(let y=-1;y<=7;y++)for(let x=-1;x<=7;x++){if(r+y<0||r+y>=n||c+x<0||c+x>=n)continue;m[r+y][c+x]=(y>=0&&y<=6&&(x===0||x===6))||(x>=0&&x<=6&&(y===0||y===6))||(y>=2&&y<=4&&x>=2&&x<=4);}}
 finder(0,0);finder(n-7,0);finder(0,n-7);
 for(const r of ALIGN[v-1])for(const c of ALIGN[v-1]){if(m[r][c]!==null)continue;for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)m[r+y][c+x]=Math.abs(y)===2||Math.abs(x)===2||(x===0&&y===0);}
 for(let i=8;i<n-8;i++){if(m[i][6]===null)m[i][6]=i%2===0;if(m[6][i]===null)m[6][i]=i%2===0;}
 const format=((8<<10)|bch(8<<10,0x537))^0x5412;
 for(let i=0;i<15;i++){const val=Boolean((format>>>i)&1);if(i<6)m[i][8]=val;else if(i<8)m[i+1][8]=val;else m[n-15+i][8]=val;
 if(i<8)m[8][n-i-1]=val;else if(i<9)m[8][15-i]=val;else m[8][15-i-1]=val;}
 m[n-8][8]=true;
 if(v>=7){const version=(v<<12)|bch(v<<12,0x1f25);for(let i=0;i<18;i++){const val=Boolean((version>>>i)&1);m[Math.floor(i/3)][i%3+n-11]=val;m[i%3+n-11][Math.floor(i/3)]=val;}}
 let row=n-1,inc=-1,bitIndex=7,wordIndex=0;
 for(let col=n-1;col>0;col-=2){if(col===6)col--;while(true){for(let c=0;c<2;c++){if(m[row][col-c]!==null)continue;let dark=wordIndex<words.length?Boolean((words[wordIndex]>>>bitIndex)&1):false;if((row+col-c)%2===0)dark=!dark;m[row][col-c]=dark;bitIndex--;if(bitIndex<0){wordIndex++;bitIndex=7;}}
 row+=inc;if(row<0||row>=n){row-=inc;inc=-inc;break;}}}
 return m;
}
export function qrSVG(text){const m=qrMatrix(text),n=m.length+8;let p='';for(let y=0;y<m.length;y++)for(let x=0;x<m.length;x++)if(m[y][x])p+=`M${x+4} ${y+4}h1v1h-1z`;return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" role="img" aria-label="Solana wallet transfer QR, not escrow" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="white"/><path d="${p}" fill="black"/></svg>`;}
