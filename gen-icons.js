/* Generiše PNG ikonice bez spoljnih biblioteka (Node + zlib).
   Tirkizna pozadina + beli EKG puls. Pokreni: node gen-icons.js */
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const ACCENT = [14,124,134];   // #0e7c86
const WHITE  = [255,255,255];
const SS = 3;                  // supersampling za glatke ivice

// EKG putanja na 24-mreži: M2 12 h4 l2-7 l4 14 l2.5-7 H22
const PATH = [[2,12],[6,12],[8,5],[12,19],[14.5,12],[22,12]];

function lerp(a,b,t){return a+(b-a)*t;}
function distSeg(px,py,ax,ay,bx,by){
  const dx=bx-ax, dy=by-ay, l2=dx*dx+dy*dy;
  let t = l2? ((px-ax)*dx+(py-ay)*dy)/l2 : 0;
  t=Math.max(0,Math.min(1,t));
  const cx=ax+t*dx, cy=ay+t*dy;
  return Math.hypot(px-cx,py-cy);
}

function drawIcon(size, maskable){
  const S = size*SS;
  const buf = new Uint8ClampedArray(S*S*4); // RGBA
  const pad = maskable ? S*0.02 : S*0.14;   // maskable = full bleed
  const radius = maskable ? 0 : S*0.22;     // rounded rect (0 = pun kvadrat za masku)

  // EKG geometrija: uklopi 24-mrežu u sadržajnu zonu
  const zone = maskable ? {x:S*0.22,y:S*0.22,w:S*0.56,h:S*0.56}
                        : {x:S*0.14,y:S*0.14,w:S*0.72,h:S*0.72};
  const gx = v => zone.x + (v/24)*zone.w;
  const gy = v => zone.y + (v/24)*zone.h;
  const pts = PATH.map(([x,y])=>[gx(x),gy(y)]);
  const stroke = S*0.045; // debljina pulsa

  for(let y=0;y<S;y++){
    for(let x=0;x<S;x++){
      const i=(y*S+x)*4;
      // pozadina (rounded rect ili pun)
      let bgA = 0;
      if(radius>0){
        const rx=Math.max(pad, Math.min(S-pad, x)) , ry=Math.max(pad, Math.min(S-pad, y));
        // distanca do zaobljenog pravougaonika
        const dx=Math.max(pad+radius - x, x-(S-pad-radius),0);
        const dy=Math.max(pad+radius - y, y-(S-pad-radius),0);
        const corner=Math.hypot(dx,dy);
        const inside = (x>=pad&&x<=S-pad&&y>=pad&&y<=S-pad) && corner<=radius;
        bgA = inside?255:0;
      } else {
        bgA = 255;
      }
      let r=ACCENT[0], g=ACCENT[1], b=ACCENT[2], a=bgA;

      // puls preko pozadine
      if(bgA>0){
        let dmin=1e9;
        for(let k=0;k<pts.length-1;k++){
          const d=distSeg(x,y,pts[k][0],pts[k][1],pts[k+1][0],pts[k+1][1]);
          if(d<dmin) dmin=d;
        }
        if(dmin < stroke){
          r=WHITE[0]; g=WHITE[1]; b=WHITE[2];
        }
      }
      buf[i]=r; buf[i+1]=g; buf[i+2]=b; buf[i+3]=a;
    }
  }
  // downsample SSxSS -> size
  const out = Buffer.alloc(size*size*4);
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      let r=0,g=0,b=0,a=0;
      for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++){
        const i=(((y*SS+sy)*S)+(x*SS+sx))*4;
        r+=buf[i]; g+=buf[i+1]; b+=buf[i+2]; a+=buf[i+3];
      }
      const n=SS*SS, o=(y*size+x)*4;
      out[o]=r/n; out[o+1]=g/n; out[o+2]=b/n; out[o+3]=a/n;
    }
  }
  return out;
}

/* --- minimalni PNG enkoder (RGBA, 8-bit) --- */
function crc32(buf){
  let c=~0;
  for(let i=0;i<buf.length;i++){
    c^=buf[i];
    for(let k=0;k<8;k++) c = (c>>>1) ^ (0xEDB88320 & -(c&1));
  }
  return (~c)>>>0;
}
function chunk(type, data){
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0);
  const t=Buffer.from(type,"ascii");
  const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,data])),0);
  return Buffer.concat([len,t,data,crc]);
}
function encodePNG(rgba,w,h){
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  // filter 0 po redu
  const raw=Buffer.alloc(h*(w*4+1));
  for(let y=0;y<h;y++){
    raw[y*(w*4+1)]=0;
    rgba.copy(raw, y*(w*4+1)+1, y*w*4, (y+1)*w*4);
  }
  const idat=zlib.deflateSync(raw,{level:9});
  return Buffer.concat([sig, chunk("IHDR",ihdr), chunk("IDAT",idat), chunk("IEND",Buffer.alloc(0))]);
}

const dir=path.join(__dirname,"icons");
fs.mkdirSync(dir,{recursive:true});
function save(name,size,maskable){
  const rgba=drawIcon(size,maskable);
  fs.writeFileSync(path.join(dir,name), encodePNG(rgba,size,size));
  console.log("  ✓",name);
}
console.log("Generišem ikonice:");
save("icon-192.png",192,false);
save("icon-512.png",512,false);
save("icon-maskable-512.png",512,true);
save("apple-touch-icon.png",180,false);

// SVG ikonica (oštra na svakoj rezoluciji)
const d="M"+PATH.map(([x,y],k)=>{
  const X=(x/24*80+10).toFixed(1), Y=(y/24*80+10).toFixed(1);
  return (k?"L":"")+X+" "+Y;
}).join(" ");
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#0e7c86"/>
<path d="${d}" fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
fs.writeFileSync(path.join(dir,"icon.svg"), svg);
console.log("  ✓ icon.svg");
console.log("Gotovo.");
