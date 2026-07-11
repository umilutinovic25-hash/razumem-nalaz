/* Razumem nalaz — parsiranje, OCR, istorija, izvoz. Sve radi lokalno u pretraživaču. */
(function(){
"use strict";
const el = id => document.getElementById(id);
const DB = window.DB, CATS = window.CATS;
const APP_VERSION = "1.1.0";

let SEX = "m";
let AGE = "odrasli";          // odrasli | dete | stariji
let showAll = true;           // filter: sve vs samo van opsega
let lastFound = null;         // poslednja uspešna analiza (za čuvanje/izvoz)
let lastMeta = null;          // {sex, age, date}

const paramByKey = {};
DB.forEach(p => paramByKey[p.key] = p);

/* ---------- Normalizacija i parsiranje ---------- */
function normalize(s){
  return s.toLowerCase()
    .replace(/[čć]/g,"c").replace(/š/g,"s").replace(/ž/g,"z").replace(/đ/g,"dj")
    .replace(/\s+/g," ").trim();
}
function parseNumber(str){
  const s = str.replace(/[–—]/g,"-");
  const m = s.match(/(?:^|[\s:=])(-?\d{1,4}(?:[.,]\d{1,3})?)/);
  if(!m) return null;
  const n = parseFloat(m[1].replace(",","."));
  return isFinite(n) ? n : null;
}
function findParam(lineNorm){
  let best=null, bestLen=0;
  for(const p of DB){
    for(const s of p.syn){
      const sn = normalize(s);
      if(lineNorm.includes(sn) && sn.length>bestLen){ best=p; bestLen=sn.length; }
    }
  }
  return best;
}
function classify(val, range){
  const [lo,hi]=range, span=(hi-lo)||1, tol=span*0.10;
  if(val < lo) return {s: val < lo-tol ? "bad":"warn", dir:"low"};
  if(val > hi) return {s: val > hi+tol ? "bad":"warn", dir:"high"};
  return {s:"ok", dir:"in"};
}
/* eGFR: CKD-EPI 2021 (bez rase). Kreatinin u umol/L -> mg/dL. */
function computeEGFR(creatUmol, age, sex){
  if(!(creatUmol>0) || !(age>0) || age>120) return null;
  const scr = creatUmol/88.4;            // mg/dL
  const female = (sex==="f");
  const k = female?0.7:0.9, a = female?-0.241:-0.302;
  const mn = Math.min(scr/k,1), mx = Math.max(scr/k,1);
  let e = 142 * Math.pow(mn,a) * Math.pow(mx,-1.200) * Math.pow(0.9938,age);
  if(female) e *= 1.012;
  return Math.round(e);
}
function egfrStage(v){
  if(v>=90) return {s:"ok",   dir:"in",  label:"Normalno (G1)",            text:"Bubrezi filtriraju u očekivanom opsegu."};
  if(v>=60) return {s:"warn", dir:"low", label:"Blago snižen (G2)",         text:"Blago snižena filtracija. Uz uredan ostali nalaz, a naročito kod starijih osoba, često nije bolest — ali se prati."};
  if(v>=45) return {s:"bad",  dir:"low", label:"Umereno snižen (G3a)",      text:"Umereno snižena funkcija bubrega — traži procenu lekara i redovno praćenje."};
  if(v>=30) return {s:"bad",  dir:"low", label:"Umereno-teško snižen (G3b)",text:"Značajnije snižena funkcija bubrega — potrebna je procena nefrologa."};
  if(v>=15) return {s:"bad",  dir:"low", label:"Teško snižen (G4)",         text:"Teško snižena funkcija bubrega — potrebna hitna lekarska procena."};
  return      {s:"bad",  dir:"low", label:"Otkazivanje (G5)",           text:"Vrlo niska filtracija — potrebna hitna lekarska procena."};
}
function classifyKey(key, val, sex, age){
  if(key==="egfr"){ const st=egfrStage(val); return {s:st.s, dir:st.dir}; }
  const p=paramByKey[key]; if(!p) return null;
  return classify(val, refFor(p, sex, age).range);
}
function refFor(p, sex, age){
  if(age==="dete"){
    if(p.child) return { range:p.child[sex]||p.child.m, band:"dete" };
    return { range:p.ref[sex], band:"dete-fallback" };
  }
  return { range:p.ref[sex], band:"odrasli" };
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
      if(p.egfr){
        const st = egfrStage(val);
        found.push({p, val, egfr:true, cls:{s:st.s,dir:st.dir}, stage:st,
          bar:{vmin:0,vmax:120,zLo:90,zHi:120}});
      } else {
        const r = refFor(p, SEX, AGE);
        found.push({p, val, range:r.range, band:r.band, cls:classify(val, r.range)});
      }
    } else if(val!==null && !p && line.length>2){
      unknown.push(line);
    }
  }

  // automatski eGFR iz kreatinina + godina (ako nije već unet)
  const years = parseInt((el("ageYears").value||"").trim(),10);
  if(!seen.has("egfr") && seen.has("kreatinin") && years>0 && years<=120){
    const cre = found.find(f=>f.p.key==="kreatinin");
    const g = cre ? computeEGFR(cre.val, years, SEX) : null;
    if(g){
      const st = egfrStage(g);
      found.push({p:paramByKey["egfr"], val:g, egfr:true, derived:true,
        cls:{s:st.s,dir:st.dir}, stage:st, bar:{vmin:0,vmax:120,zLo:90,zHi:120}});
      seen.add("egfr");
    }
  }

  render(found, unknown);
}

function render(found, unknown){
  const cards=el("cards"), sum=el("summary"), sg=el("sumGrid"), empty=el("empty");
  cards.innerHTML=""; el("unknown").innerHTML="";

  if(found.length===0){
    lastFound=null;
    empty.classList.add("show"); sum.classList.remove("show");
    el("qbox").style.display="none"; el("resultsBar").style.display="none";
    el("ageBanner").style.display="none";
    if(unknown.length) renderUnknown(unknown);
    return;
  }
  empty.classList.remove("show");
  lastFound = found.map(f=>({key:f.p.key, val:f.val}));
  lastMeta = { sex:SEX, age:AGE, date: el("nalazDate").value || todayISO() };
  el("saveNote").textContent="";

  const nBad=found.filter(f=>f.cls.s==="bad").length;
  const nWarn=found.filter(f=>f.cls.s==="warn").length;
  const nOk=found.filter(f=>f.cls.s==="ok").length;
  sg.innerHTML=`
    <div class="stat" style="--i:0"><div class="n">${found.length}</div><div class="l">prepoznatih parametara</div></div>
    <div class="stat ok" style="--i:1"><div class="n"><span class="dot" style="background:var(--ok)"></span>${nOk}</div><div class="l">u referentnom opsegu</div></div>
    <div class="stat warn" style="--i:2"><div class="n"><span class="dot" style="background:var(--warn)"></span>${nWarn}</div><div class="l">blago van opsega</div></div>
    <div class="stat bad" style="--i:3"><div class="n"><span class="dot" style="background:var(--bad)"></span>${nBad}</div><div class="l">izrazito van opsega</div></div>`;
  sum.classList.add("show");

  // filter dugme
  const outCount = nWarn+nBad;
  el("resultsBar").style.display="flex";
  el("filterToggle").textContent = showAll ? `Prikaži samo van opsega (${outCount})` : "Prikaži sve";
  el("filterToggle").style.display = outCount>0 ? "inline-flex" : "none";
  if(outCount===0) showAll=true;

  el("ageBanner").style.display = AGE==="dete" ? "flex" : "none";

  // grupiši po kategoriji (panelu), zadrži redosled iz DB
  const visible = found.filter(f=> showAll || f.cls.s!=="ok");
  const byCat = {};
  for(const f of visible){ (byCat[f.p.cat]=byCat[f.p.cat]||[]).push(f); }
  let ai = 0;
  const stagger = node => { node.style.setProperty("--i", Math.min(ai++, 14)); return node; };
  for(const cat of Object.keys(CATS)){
    const items = byCat[cat]; if(!items || !items.length) continue;
    const head = document.createElement("div");
    head.className="cat-head";
    head.innerHTML=`<span>${CATS[cat]}</span><span class="cat-count">${items.length}</span>`;
    cards.appendChild(stagger(head));
    for(const f of items) cards.appendChild(stagger(makeCard(f)));
  }

  if(unknown.length) renderUnknown(unknown);
  renderQuestions(found);
  sum.scrollIntoView({behavior:"smooth",block:"start"});
}

const ARROW_UP='<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_DOWN='<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_OK='<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function makeCard(f){
  const {p,val,cls}=f;
  const arrow = cls.dir==="high" ? ARROW_UP : cls.dir==="low" ? ARROW_DOWN : ARROW_OK;
  const badgeTxt = f.stage ? f.stage.label
      : cls.s==="ok" ? "U opsegu" : (cls.dir==="high" ? "Povišeno" : "Sniženo");

  // geometrija trake: eGFR koristi prilagođenu skalu (0–120, zona ≥90), ostali standardni opseg
  let vmin,vmax,zL,zR,barStyle="",noteTxt,loLbl,hiLbl;
  if(f.bar){
    vmin=f.bar.vmin; vmax=f.bar.vmax;
    zL=((f.bar.zLo-vmin)/(vmax-vmin))*100; zR=((f.bar.zHi-vmin)/(vmax-vmin))*100;
    barStyle=' style="background:linear-gradient(90deg,var(--bad-soft) 0%,var(--warn-soft) 42%,var(--ok-soft) 72%,var(--ok-soft) 100%)"';
    noteTxt = f.derived ? "izračunato · zelena zona = normala (≥90)" : "zelena zona = normala (≥90)";
    loLbl=fmtNum(vmin); hiLbl=fmtNum(vmax);
  } else {
    const [lo,hi]=f.range, span=(hi-lo)||1;
    vmin=lo-span*0.6; vmax=hi+span*0.6;
    zL=((lo-vmin)/(vmax-vmin))*100; zR=((hi-vmin)/(vmax-vmin))*100;
    noteTxt = f.band==="dete" ? "opseg za decu" : f.band==="dete-fallback" ? "opseg za odrasle" : "referentni opseg ("+(SEX==="m"?"M":"Ž")+")";
    loLbl=fmtNum(lo); hiLbl=fmtNum(hi);
  }
  let pos=((val-vmin)/(vmax-vmin))*100; pos=Math.max(2,Math.min(98,pos));

  const meaning = f.stage ? `<strong>${f.stage.label}.</strong> ${f.stage.text}`
      : cls.s==="ok" ? p.what
      : `<strong>${badgeTxt}.</strong> ${cls.dir==="high"?p.high:p.low}`;
  const derivedTag = f.derived ? ' <span class="derived-tag">izračunato</span>' : "";

  const card=document.createElement("div");
  card.className="card"; card.setAttribute("open-state","0");
  card.innerHTML=`
    <div class="card-main">
      <div class="pname">${p.name} <span class="pabbr">${p.abbr}</span>${derivedTag}</div>
      <div class="pval"><span class="v" style="color:${cls.s==='ok'?'var(--ink)':'var(--'+cls.s+')'}">${fmtNum(val)}</span><span class="u">${p.unit}</span></div>
      <span class="badge ${cls.s}">${arrow} ${badgeTxt}</span>
      <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="rangewrap">
        <div class="rangebar"${barStyle}>
          <div class="zone" style="left:${zL}%;right:${100-zR}%"></div>
          <div class="marker ${cls.s}" style="left:${pos}%"></div>
        </div>
        <div class="rangelabels"><span>${loLbl}</span><span>${noteTxt}</span><span>${hiLbl}</span></div>
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

/* ---------- Istorija (localStorage) ---------- */
const HKEY = "rn_history_v1";
let undoBuffer = null;

function loadHistory(){
  try{ return JSON.parse(localStorage.getItem(HKEY)||"[]"); }catch(e){ return []; }
}
function saveHistory(arr){
  try{ localStorage.setItem(HKEY, JSON.stringify(arr)); return true; }
  catch(e){ toast("Nije moguće sačuvati na ovom uređaju (privatni režim?)."); return false; }
}
function todayISO(){
  const d=new Date(), z=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate());
}
function fmtDate(iso){ const [y,m,d]=iso.split("-"); return d+"."+m+"."+y+"."; }
function ageLabel(a){ return a==="dete"?"dete":a==="stariji"?"stariji":"odrasli"; }

function statusOfItem(key,val,sex,age){
  return classifyKey(key, val, sex||"m", age||"odrasli");
}

function saveCurrent(){
  if(!lastFound || !lastFound.length){ toast("Prvo analiziraj nalaz pa ga sačuvaj."); return; }
  const date = el("nalazDate").value || todayISO();
  const rec = { id:"r"+Date.now()+Math.random().toString(36).slice(2,6),
                date, sex:SEX, age:AGE, ts:Date.now(),
                items:lastFound.map(x=>({key:x.key, val:x.val})) };
  const h = loadHistory(); h.push(rec);
  if(!saveHistory(h)) return;
  el("saveNote").textContent="✓ sačuvano";
  renderHistory(); renderTrends();
  toast("Nalaz sačuvan u istoriju ("+fmtDate(date)+").");
}
function deleteRecord(id){
  const h = loadHistory();
  const idx = h.findIndex(r=>r.id===id);
  if(idx<0) return;
  undoBuffer = h[idx];
  h.splice(idx,1); saveHistory(h); renderHistory(); renderTrends();
  actionToast("Nalaz obrisan.", "Opozovi", ()=>{
    const cur=loadHistory(); cur.push(undoBuffer); saveHistory(cur);
    undoBuffer=null; renderHistory(); renderTrends();
  });
}
function clearHistory(){
  const prev = loadHistory();
  if(!prev.length) return;
  undoBuffer = prev;
  saveHistory([]); renderHistory(); renderTrends();
  actionToast("Cela istorija obrisana.", "Opozovi", ()=>{
    saveHistory(undoBuffer); undoBuffer=null; renderHistory(); renderTrends();
  });
}
function showRecord(rec){
  const lines = rec.items.map(it=>{
    const p=paramByKey[it.key]; if(!p) return "";
    return p.name+"  "+fmtNum(it.val)+" "+p.unit;
  }).filter(Boolean);
  el("input").value = lines.join("\n");
  SEX = rec.sex || "m"; AGE = rec.age || "odrasli";
  syncSeg("sex", SEX); syncSeg("age", AGE);
  el("nalazDate").value = rec.date;
  analyze();
}

function renderHistory(){
  const h = loadHistory().slice().sort((a,b)=> b.date.localeCompare(a.date) || b.ts-a.ts);
  const sec=el("history"), list=el("histList");
  if(!h.length){ sec.style.display="none"; return; }
  sec.style.display="block"; list.innerHTML="";
  for(const rec of h){
    let ok=0,warn=0,bad=0;
    for(const it of rec.items){ const c=statusOfItem(it.key,it.val,rec.sex,rec.age); if(!c)continue;
      if(c.s==="ok")ok++; else if(c.s==="warn")warn++; else bad++; }
    const div=document.createElement("div"); div.className="hist-item";
    div.innerHTML=`
      <div class="hd">
        <div class="hist-date">${fmtDate(rec.date)}</div>
        <div class="hist-meta">${rec.items.length} ${rec.items.length===1?"parametar":"parametara"} · ${rec.sex==='m'?'muškarac':'žena'} · ${ageLabel(rec.age)}</div>
      </div>
      <div class="hist-badges">
        ${ok?`<span class="mini ok">${ok} u opsegu</span>`:""}
        ${warn?`<span class="mini warn">${warn} blago</span>`:""}
        ${bad?`<span class="mini bad">${bad} van</span>`:""}
      </div>
      <div class="hist-actions">
        <button class="icon-btn" data-act="show">Prikaži</button>
        <button class="icon-btn danger" data-act="del" aria-label="Obriši nalaz">Obriši</button>
      </div>`;
    div.querySelector('[data-act="show"]').addEventListener("click",()=>showRecord(rec));
    div.querySelector('[data-act="del"]').addEventListener("click",()=>deleteRecord(rec.id));
    list.appendChild(div);
  }
}

function renderTrends(){
  const h = loadHistory().slice().sort((a,b)=> a.date.localeCompare(b.date) || a.ts-b.ts);
  const sec=el("trends"), list=el("trendList");
  const byKey={};
  for(const rec of h) for(const it of rec.items){
    (byKey[it.key]=byKey[it.key]||[]).push({date:rec.date, val:it.val, sex:rec.sex, age:rec.age});
  }
  const keys = DB.map(p=>p.key).filter(k=> byKey[k] && byKey[k].length>=2);
  if(!keys.length){ sec.style.display="none"; return; }
  sec.style.display="block"; list.innerHTML="";
  for(const key of keys){
    const p=paramByKey[key];
    const series=byKey[key].map(s=>({date:s.date, val:s.val, sex:s.sex||"m", age:s.age||"odrasli",
      cls:classifyKey(key, s.val, s.sex||"m", s.age||"odrasli")}));
    list.appendChild(makeTrendCard(p, series));
  }
}
function makeTrendCard(p, series){
  const latest=series[series.length-1], prev=series.length>1?series[series.length-2]:null;
  const [refLo,refHi]=refFor(p, latest.sex, latest.age).range;
  const rank={ok:0,warn:1,bad:2};
  let deltaHTML="";
  if(prev){
    const d=latest.val-prev.val;
    const arrow = d>0?"↑":(d<0?"↓":"→");
    const better = rank[latest.cls.s] < rank[prev.cls.s];
    const worse  = rank[latest.cls.s] > rank[prev.cls.s];
    const cls = better?"down":(worse?"up":"flat");
    deltaHTML=`<div class="trend-delta ${cls}" title="${better?'približilo se opsegu':worse?'udaljilo od opsega':'ista kategorija'}">${arrow} ${d>0?"+":""}${fmtNum(d)} ${p.unit} od prošlog</div>`;
  } else {
    deltaHTML=`<div class="trend-delta flat">jedno merenje</div>`;
  }
  const card=document.createElement("div"); card.className="trend-card";
  card.innerHTML=`
    <div class="trend-top">
      <div class="trend-name">${p.name} <span class="trend-abbr">${p.abbr}</span></div>
      <div class="trend-latest" style="color:${latest.cls.s==='ok'?'var(--ink)':'var(--'+latest.cls.s+')'}">${fmtNum(latest.val)}<span class="u">${p.unit}</span></div>
    </div>
    ${deltaHTML}
    ${sparkline(series, refLo, refHi)}
    <div class="trend-dates"><span>${fmtDate(series[0].date)}</span><span>${fmtDate(latest.date)}</span></div>`;
  return card;
}
function sparkline(series, lo, hi){
  const W=240, H=62, padX=7, padT=9, padB=9;
  const vals=series.map(s=>s.val);
  let ymin=Math.min(lo,...vals), ymax=Math.max(hi,...vals);
  if(ymax===ymin){ ymax+=1; ymin-=1; }
  const spanY=(ymax-ymin)*0.12; ymin-=spanY; ymax+=spanY;
  const n=series.length;
  const X=i=> n===1 ? W/2 : padX + i*(W-2*padX)/(n-1);
  const Y=v=> padT + (ymax-v)/(ymax-ymin)*(H-padT-padB);
  const bandTop=Y(hi), bandBot=Y(lo);
  const pts=series.map((s,i)=>[X(i),Y(s.val)]);
  const poly=pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  const dots=series.map((s,i)=>{
    const last=i===n-1;
    const col = s.cls.s==="ok"?"var(--ok)":s.cls.s==="warn"?"var(--warn)":"var(--bad)";
    return `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="${last?4:3}" fill="${col}"${last?' stroke="var(--surface)" stroke-width="2"':''}></circle>`;
  }).join("");
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="trend">
    <rect x="0" y="${Math.min(bandTop,bandBot).toFixed(1)}" width="${W}" height="${Math.abs(bandBot-bandTop).toFixed(1)}" fill="var(--ok-soft)"></rect>
    <line x1="0" y1="${bandTop.toFixed(1)}" x2="${W}" y2="${bandTop.toFixed(1)}" stroke="var(--ok)" stroke-width="0.6" stroke-dasharray="3 3" opacity="0.55"></line>
    <line x1="0" y1="${bandBot.toFixed(1)}" x2="${W}" y2="${bandBot.toFixed(1)}" stroke="var(--ok)" stroke-width="0.6" stroke-dasharray="3 3" opacity="0.55"></line>
    ${n>1?`<polyline points="${poly}" fill="none" stroke="var(--ink-3)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></polyline>`:""}
    ${dots}
  </svg>`;
}

/* ---------- Izvoz ---------- */
function download(filename, content, mime){
  const blob = new Blob([content], {type:mime||"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 100);
}
function csvCell(v){ const s=String(v); return /[;"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }

function exportResultsCSV(){
  if(!lastFound || !lastFound.length){ toast("Nema analize za izvoz."); return; }
  const rows=[["Datum","Parametar","Skraćenica","Vrednost","Jedinica","Opseg min","Opseg max","Status"]];
  const date = lastMeta ? lastMeta.date : todayISO();
  for(const it of lastFound){
    const p=paramByKey[it.key]; const r=refFor(p, SEX, AGE);
    const c=classifyKey(it.key, it.val, SEX, AGE);
    const st = c.s==="ok"?"u opsegu":(c.dir==="high"?"povišeno":"sniženo");
    rows.push([date, p.name, p.abbr, fmtNum(it.val), p.unit, fmtNum(r.range[0]), fmtNum(r.range[1]), st]);
  }
  const csv = "﻿"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n");
  download("nalaz-"+date+".csv", csv, "text/csv;charset=utf-8");
  toast("CSV izvezen.");
}
function exportHistoryCSV(){
  const h=loadHistory(); if(!h.length){ toast("Istorija je prazna."); return; }
  const rows=[["Datum","Parametar","Skraćenica","Vrednost","Jedinica","Opseg min","Opseg max","Status","Pol","Uzrast"]];
  h.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(rec=>{
    rec.items.forEach(it=>{
      const p=paramByKey[it.key]; if(!p) return;
      const r=refFor(p, rec.sex||"m", rec.age||"odrasli");
      const c=classifyKey(it.key, it.val, rec.sex||"m", rec.age||"odrasli");
      const st = c.s==="ok"?"u opsegu":(c.dir==="high"?"povišeno":"sniženo");
      rows.push([rec.date, p.name, p.abbr, fmtNum(it.val), p.unit, fmtNum(r.range[0]), fmtNum(r.range[1]), st,
                 rec.sex==="m"?"muškarac":"žena", ageLabel(rec.age)]);
    });
  });
  const csv="﻿"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n");
  download("istorija-nalaza.csv", csv, "text/csv;charset=utf-8");
  toast("Istorija izvezena u CSV.");
}
function exportBackup(){
  const h=loadHistory();
  const data={ app:"razumem-nalaz", version:APP_VERSION, exported:new Date().toISOString(), history:h };
  download("razumem-nalaz-backup.json", JSON.stringify(data,null,2), "application/json");
  toast("Backup napravljen ("+h.length+" nalaza).");
}
function importBackup(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      const arr = Array.isArray(data) ? data : data.history;
      if(!Array.isArray(arr)) throw new Error("nevažeći format");
      const clean = arr.filter(r=>r && r.date && Array.isArray(r.items)).map(r=>({
        id: r.id || ("r"+Date.now()+Math.random().toString(36).slice(2,6)),
        date:r.date, sex:r.sex||"m", age:r.age||"odrasli", ts:r.ts||Date.now(),
        items:r.items.filter(it=>it&&paramByKey[it.key]&&typeof it.val==="number")
      })).filter(r=>r.items.length);
      if(!clean.length){ toast("Backup ne sadrži važeće nalaze."); return; }
      const prev=loadHistory(); undoBuffer=prev;
      // spoji, izbegni duple po id
      const ids=new Set(prev.map(r=>r.id));
      const merged=prev.concat(clean.filter(r=>!ids.has(r.id)));
      saveHistory(merged); renderHistory(); renderTrends();
      actionToast(`Uvezeno ${clean.length} nalaza (ukupno ${merged.length}).`, "Opozovi", ()=>{
        saveHistory(undoBuffer); undoBuffer=null; renderHistory(); renderTrends();
      });
    }catch(e){ toast("Nije moguće pročitati backup fajl."); }
  };
  reader.readAsText(file);
}
function printReport(){
  if(!lastFound || !lastFound.length){ toast("Prvo analiziraj nalaz."); return; }
  const m=lastMeta||{sex:SEX,age:AGE,date:todayISO()};
  el("printMeta").textContent = `Datum: ${fmtDate(m.date)} · ${m.sex==="m"?"Muškarac":"Žena"} · ${ageLabel(m.age)} · ${lastFound.length} parametara`;
  window.print();
}

/* ---------- Toast ---------- */
let toastT;
function toast(msg){
  const t=el("toast"); t.innerHTML=""; t.textContent=msg; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),4200);
}
function actionToast(msg, actionLabel, cb){
  const t=el("toast"); t.innerHTML="";
  const span=document.createElement("span"); span.textContent=msg;
  const btn=document.createElement("button"); btn.className="toast-act"; btn.textContent=actionLabel;
  btn.addEventListener("click",()=>{ cb(); t.classList.remove("show"); });
  t.appendChild(span); t.appendChild(btn); t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),6000);
}

/* ---------- Segmentne kontrole ---------- */
function syncSeg(group, val){
  document.querySelectorAll(`.seg[data-group="${group}"] button`).forEach(b=>
    b.setAttribute("aria-pressed", b.dataset.val===val ? "true":"false"));
}
document.querySelectorAll('.seg[data-group="sex"] button').forEach(b=>{
  b.addEventListener("click",()=>{ SEX=b.dataset.val; syncSeg("sex",SEX);
    if(el("summary").classList.contains("show")) analyze(); });
});
document.querySelectorAll('.seg[data-group="age"] button').forEach(b=>{
  b.addEventListener("click",()=>{ AGE=b.dataset.val; syncSeg("age",AGE);
    if(el("summary").classList.contains("show")) analyze(); });
});

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
  if(typeof Tesseract==="undefined"){ toast("Čitač teksta nije učitan — proveri internet pri prvom korišćenju."); return; }
  ocrRunning=true;
  const url=URL.createObjectURL(file); showOcr(url);
  try{
    const worker = await Tesseract.createWorker(["eng"], 1, {
      logger:m=>{
        if(m.status==="recognizing text") setProg(m.progress,"Čitam tekst sa slike…");
        else if(m.status && m.progress!=null) setProg(m.progress*0.4, "Pripremam čitač teksta…");
      }
    });
    await worker.setParameters({ preserve_interword_spaces:"1" });
    const { data } = await worker.recognize(file);
    await worker.terminate();
    const text=(data && data.text ? data.text : "").trim();
    el("ocr").classList.remove("show"); URL.revokeObjectURL(url); ocrRunning=false;
    if(!text){ toast("Nisam uspeo da pročitam tekst. Probaj jasniju, ravniju sliku."); return; }
    el("input").value=text; analyze();
    const n=el("cards").querySelectorAll(".card").length;
    toast(n>0 ? `Pročitano — prepoznato ${n} ${n===1?"parametar":"parametara"}. Proveri i po potrebi ispravi tekst.`
              : "Pročitao sam tekst, ali nisam prepoznao parametre. Proveri/ispravi tekst pa „Objasni nalaz“.");
  }catch(err){
    console.error(err);
    el("ocr").classList.remove("show"); ocrRunning=false; URL.revokeObjectURL(url);
    toast("Greška pri čitanju slike. Možeš uneti vrednosti ručno.");
  }
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
  el("qbox").style.display="none"; el("resultsBar").style.display="none";
  el("ageBanner").style.display="none"; lastFound=null; el("input").focus();
});
el("demo").addEventListener("click",()=>{
  el("input").value=
`Hemoglobin        118 g/L
Eritrociti        4,1 x10^12/L
MCV               76 fL
Leukociti         11,3 x10^9/L
Trombociti        260 x10^9/L
Glukoza           6,4 mmol/L
HbA1c             6,1 %
Holesterol        6,8 mmol/L
LDL               4,3 mmol/L
HDL               0,9 mmol/L
Trigliceridi      2,3 mmol/L
ALT               58 U/L
GGT               61 U/L
Kreatinin         118 umol/L
Gvožđe            7 umol/L
Feritin           12 ng/mL
Vitamin D         18 ng/mL
TSH               5,7 mIU/L`;
  el("ageYears").value = "58";
  analyze();
});
el("filterToggle").addEventListener("click",()=>{ showAll=!showAll; analyze(); });
el("btnPrint").addEventListener("click",printReport);
el("btnCsv").addEventListener("click",exportResultsCSV);
el("btnHistCsv").addEventListener("click",exportHistoryCSV);
el("btnBackup").addEventListener("click",exportBackup);
el("btnImport").addEventListener("click",()=>el("importFile").click());
el("importFile").addEventListener("change",e=>{ if(e.target.files[0]) importBackup(e.target.files[0]); e.target.value=""; });
el("clearHist").addEventListener("click",clearHistory);
el("input").addEventListener("keydown",e=>{ if((e.metaKey||e.ctrlKey)&&e.key==="Enter") analyze(); });
el("ageYears").addEventListener("input",()=>{ if(el("summary").classList.contains("show")) analyze(); });

/* Init */
el("nalazDate").value = todayISO();
el("saveBtn").addEventListener("click", saveCurrent);
syncSeg("sex",SEX); syncSeg("age",AGE);
renderHistory(); renderTrends();

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

/* ---------- Splash (instalirana aplikacija) ---------- */
if(document.documentElement.classList.contains("is-standalone")){
  const hideSplash = ()=>{ const s=el("splash"); if(!s) return;
    s.classList.add("hide"); setTimeout(()=>{ s.style.display="none"; }, 600); };
  window.addEventListener("load", ()=> setTimeout(hideSplash, 1100));
}

/* ---------- Service worker ---------- */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
})();
