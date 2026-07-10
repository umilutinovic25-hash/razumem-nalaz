/* Razumem nalaz — parsiranje, OCR i prikaz. Sve radi lokalno u pretraživaču. */
(function(){
"use strict";
const el = id => document.getElementById(id);
let SEX = "m";

/* ---------- Normalizacija i parsiranje teksta ---------- */
function normalize(s){
  return s.toLowerCase()
    .replace(/[čć]/g,"c").replace(/š/g,"s").replace(/ž/g,"z").replace(/đ/g,"dj")
    .replace(/\s+/g," ").trim();
}
function parseNumber(str){
  // izbaci deo posle "referentni/opseg" da ne pokupimo granice opsega umesto rezultata
  let s = str.replace(/[–—]/g,"-");
  // uzmi prvi "samostalan" broj; zarez kao decimala
  const m = s.match(/(?:^|[\s:=])(-?\d{1,4}(?:[.,]\d{1,3})?)/);
  if(!m) return null;
  const n = parseFloat(m[1].replace(",","."));
  return isFinite(n) ? n : null;
}
function findParam(lineNorm){
  let best=null, bestLen=0;
  for(const p of window.DB){
    for(const s of p.syn){
      const sn = normalize(s);
      // reč mora da se pojavi kao deo reda; duži poklopac pobeđuje (LDL vs HDL i sl.)
      if(lineNorm.includes(sn) && sn.length>bestLen){ best=p; bestLen=sn.length; }
    }
  }
  return best;
}
function classify(val, ref){
  const [lo,hi]=ref, span=(hi-lo)||1, tol=span*0.10;
  if(val < lo) return {s: val < lo-tol ? "bad":"warn", dir:"low"};
  if(val > hi) return {s: val > hi+tol ? "bad":"warn", dir:"high"};
  return {s:"ok", dir:"in"};
}
function fmtNum(n){ return (Math.round(n*100)/100).toString().replace(".",","); }

/* ---------- Analiza ---------- */
function analyze(){
  const lines = el("input").value.split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const found=[], unknown=[], seen=new Set();
  for(const line of lines){
    const norm = normalize(line);
    const p = findParam(norm);
    const val = parseNumber(line);
    if(p && val!==null && !seen.has(p.key)){
      seen.add(p.key);
      found.push({p, val, cls:classify(val, p.ref[SEX])});
    } else if(val!==null && !p && line.length>2){
      unknown.push(line);
    }
  }
  render(found, unknown);
}

function render(found, unknown){
  const cards=el("cards"), sum=el("summary"), sg=el("sumGrid"), empty=el("empty");
  cards.innerHTML=""; el("unknown").innerHTML="";

  if(found.length===0){
    empty.classList.add("show"); sum.classList.remove("show"); el("qbox").style.display="none";
    if(unknown.length) renderUnknown(unknown);
    return;
  }
  empty.classList.remove("show");

  const nBad=found.filter(f=>f.cls.s==="bad").length;
  const nWarn=found.filter(f=>f.cls.s==="warn").length;
  const nOk=found.filter(f=>f.cls.s==="ok").length;
  sg.innerHTML=`
    <div class="stat"><div class="n">${found.length}</div><div class="l">prepoznatih parametara</div></div>
    <div class="stat ok"><div class="n"><span class="dot" style="background:var(--ok)"></span>${nOk}</div><div class="l">u referentnom opsegu</div></div>
    <div class="stat warn"><div class="n"><span class="dot" style="background:var(--warn)"></span>${nWarn}</div><div class="l">blago van opsega</div></div>
    <div class="stat bad"><div class="n"><span class="dot" style="background:var(--bad)"></span>${nBad}</div><div class="l">izrazito van opsega</div></div>`;
  sum.classList.add("show");

  const order={bad:0,warn:1,ok:2};
  found.sort((a,b)=>order[a.cls.s]-order[b.cls.s]);
  for(const f of found) cards.appendChild(makeCard(f));
  if(unknown.length) renderUnknown(unknown);
  renderQuestions(found);
  sum.scrollIntoView({behavior:"smooth",block:"start"});
}

function makeCard(f){
  const {p,val,cls}=f;
  const [lo,hi]=p.ref[SEX];
  const badgeTxt = cls.s==="ok" ? "U opsegu" : (cls.dir==="high" ? "Povišeno" : "Sniženo");
  const arrow = cls.dir==="high"
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : cls.dir==="low"
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const span=(hi-lo)||1, vmin=lo-span*0.6, vmax=hi+span*0.6;
  let pos=((val-vmin)/(vmax-vmin))*100; pos=Math.max(2,Math.min(98,pos));
  const zL=((lo-vmin)/(vmax-vmin))*100, zR=((hi-vmin)/(vmax-vmin))*100;

  const meaning = cls.s==="ok" ? p.what
      : `<strong>${badgeTxt}.</strong> ${cls.dir==="high"?p.high:p.low}`;

  const card=document.createElement("div");
  card.className="card"; card.setAttribute("open-state","0");
  card.innerHTML=`
    <div class="card-main">
      <div class="pname">${p.name} <span class="pabbr">${p.abbr}</span></div>
      <div class="pval"><span class="v" style="color:${cls.s==='ok'?'var(--ink)':'var(--'+cls.s+')'}">${fmtNum(val)}</span><span class="u">${p.unit}</span></div>
      <span class="badge ${cls.s}">${arrow} ${badgeTxt}</span>
      <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="rangewrap">
        <div class="rangebar">
          <div class="zone" style="left:${zL}%;right:${100-zR}%"></div>
          <div class="marker ${cls.s}" style="left:${pos}%"></div>
        </div>
        <div class="rangelabels"><span>${fmtNum(lo)}</span><span>referentni opseg (${SEX==='m'?'M':'Ž'})</span><span>${fmtNum(hi)}</span></div>
      </div>
      <div class="explain">
        <p class="what">${p.what}</p>
        <div class="mean">${meaning}</div>
      </div>
    </div>`;
  card.querySelector(".card-main").addEventListener("click",()=>{
    card.setAttribute("open-state", card.getAttribute("open-state")==="1"?"0":"1");
  });
  return card;
}

function renderUnknown(unknown){
  el("unknown").innerHTML = `Nisam prepoznao ${unknown.length} ${unknown.length===1?"red":"reda"}: `+
    unknown.slice(0,6).map(u=>`<code>${u.replace(/</g,"&lt;").slice(0,44)}</code>`).join(" ")+
    (unknown.length>6?" …":"");
}

function renderQuestions(found){
  const problem = found.filter(f=>f.cls.s!=="ok");
  const q=[];
  if(problem.length===0){
    q.push("Svi prepoznati parametri su u referentnom opsegu — ima li i pored toga nešto što bi trebalo pratiti?");
    q.push("Koliko često da ponavljam ovakvu kontrolu s obzirom na moje godine i istoriju?");
  } else {
    for(const f of problem.slice(0,5)){
      const d = f.cls.dir==="high"?"povišen":"snižen";
      q.push(`Moj ${f.p.name} je ${d} (${fmtNum(f.val)} ${f.p.unit}) — šta to konkretno znači u mom slučaju i da li zahteva dalje ispitivanje?`);
    }
    q.push("Da li ovi rezultati zajedno upućuju na nešto što treba dodatno proveriti?");
    q.push("Kada i koje analize da ponovim da vidimo da li se vrednosti menjaju?");
  }
  el("qlist").innerHTML = q.map(x=>`<li>${x}</li>`).join("");
  el("qbox").style.display="block";
}

/* ---------- OCR (čitanje sa slike) ---------- */
let ocrRunning=false;
function showOcr(thumbURL){
  el("ocrThumb").src=thumbURL;
  el("ocrLab").textContent="Pripremam čitač teksta…";
  el("ocrBar").style.width="4%"; el("ocrPct").textContent="";
  el("ocr").classList.add("show"); el("ocrSpin").style.display="block";
}
function setProg(pct,label){
  el("ocrBar").style.width=Math.max(4,Math.round(pct*100))+"%";
  el("ocrPct").textContent=Math.round(pct*100)+"%";
  if(label) el("ocrLab").textContent=label;
}
async function runOCR(file){
  if(ocrRunning) return;
  if(typeof Tesseract==="undefined"){
    toast("Čitač teksta nije učitan — proveri internet pri prvom korišćenju.");
    return;
  }
  ocrRunning=true;
  const url=URL.createObjectURL(file);
  showOcr(url);
  try{
    const worker = await Tesseract.createWorker(["eng"], 1, {
      logger:m=>{
        if(m.status==="recognizing text") setProg(m.progress,"Čitam tekst sa slike…");
        else if(m.status && m.progress!=null) setProg(m.progress*0.4, "Pripremam čitač teksta…");
      }
    });
    // brojevi + tipični znaci u nalazima
    await worker.setParameters({ preserve_interword_spaces:"1" });
    const { data } = await worker.recognize(file);
    await worker.terminate();
    const text=(data && data.text ? data.text : "").trim();
    el("ocr").classList.remove("show");
    URL.revokeObjectURL(url);
    ocrRunning=false;
    if(!text){ toast("Nisam uspeo da pročitam tekst. Probaj jasniju, ravniju sliku."); return; }
    el("input").value=text;
    analyze();
    const n=el("cards").children.length;
    toast(n>0 ? `Pročitano — prepoznato ${n} ${n===1?"parametar":"parametara"}. Proveri i po potrebi ispravi tekst.`
              : "Pročitao sam tekst, ali nisam prepoznao parametre. Proveri/ispravi tekst pa „Objasni nalaz“.");
  }catch(err){
    console.error(err);
    el("ocr").classList.remove("show"); ocrRunning=false;
    URL.revokeObjectURL(url);
    toast("Greška pri čitanju slike. Možeš uneti vrednosti ručno.");
  }
}

/* ---------- Toast ---------- */
let toastT;
function toast(msg){
  const t=el("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),4200);
}

/* ---------- Vezivanje kontrola ---------- */
el("btnCamera").addEventListener("click",()=>el("fileCamera").click());
el("btnGallery").addEventListener("click",()=>el("fileGallery").click());
el("fileCamera").addEventListener("change",e=>{ if(e.target.files[0]) runOCR(e.target.files[0]); e.target.value=""; });
el("fileGallery").addEventListener("change",e=>{ if(e.target.files[0]) runOCR(e.target.files[0]); e.target.value=""; });

el("analyze").addEventListener("click",analyze);
el("clear").addEventListener("click",()=>{
  el("input").value=""; el("cards").innerHTML=""; el("unknown").innerHTML="";
  el("summary").classList.remove("show"); el("empty").classList.remove("show");
  el("qbox").style.display="none"; el("input").focus();
});
el("demo").addEventListener("click",()=>{
  el("input").value=
`Hemoglobin        118 g/L
Eritrociti        4,1 x10^12/L
Leukociti         11,3 x10^9/L
Trombociti        260 x10^9/L
Glukoza           6,4 mmol/L
Holesterol        6,8 mmol/L
LDL               4,3 mmol/L
HDL               0,9 mmol/L
Gvožđe            7 umol/L
Feritin           12 ng/mL
ALT               58 U/L
TSH               5,7 mIU/L
Vitamin D         18 ng/mL`;
  analyze();
});
document.querySelectorAll(".seg button").forEach(b=>{
  b.addEventListener("click",()=>{
    SEX=b.dataset.sex;
    document.querySelectorAll(".seg button").forEach(x=>x.setAttribute("aria-pressed", x===b?"true":"false"));
    if(el("summary").classList.contains("show")) analyze();
  });
});
el("input").addEventListener("keydown",e=>{ if((e.metaKey||e.ctrlKey)&&e.key==="Enter") analyze(); });

/* ---------- Tema ---------- */
const themeLbl=el("themeLbl");
function currentDark(){
  const t=document.documentElement.getAttribute("data-theme");
  return t ? t==="dark" : matchMedia("(prefers-color-scheme:dark)").matches;
}
function syncLbl(){ themeLbl.textContent = currentDark()?"Svetla":"Tamna"; }
el("themeBtn").addEventListener("click",()=>{
  document.documentElement.setAttribute("data-theme", currentDark()?"light":"dark"); syncLbl();
});
syncLbl();

/* ---------- Service worker (offline) ---------- */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
})();
