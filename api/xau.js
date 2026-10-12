/* MKAYFX INSTITUTIONAL LIQUIDITY RADAR V2
   /api/xau.js — Node.js / Vercel
   Candle-derived estimates, NOT real order-book depth.
   BUY-SIDE liquidity = above highs; SELL-SIDE liquidity = below lows.
*/
const SYMBOL = 'XAU/USD';
const API_URL = 'https://api.twelvedata.com/time_series';
const FEEDS = {
  '1min':  { key: 'TWELVE_DATA_API_KEY',   size: 360, ttl: 55000,   mins: 1 },
  '5min':  { key: 'TWELVE_DATA_API_KEY_2', size: 650, ttl: 160000,  mins: 5 },
  '15min': { key: 'TWELVE_DATA_API_KEY_3', size: 420, ttl: 420000,  mins: 15 },
  '1h':    { key: 'TWELVE_DATA_API_KEY_3', size: 320, ttl: 850000,  mins: 60 },
  '4h':    { key: 'TWELVE_DATA_API_KEY_4', size: 210, ttl: 1700000, mins: 240 },
  '1day':  { key: 'TWELVE_DATA_API_KEY_4', size: 100, ttl: 3500000, mins: 1440 }
};
const cache = new Map();
const pending = new Map();
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const round = (x,n=2) => Number(Number(x).toFixed(n));
const avg = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
const label = e => String(e?.message || e || 'Unknown error')
  .replace(/apikey\s*[=:]\s*[^&\s]+/gi,'apikey=REDACTED').slice(0,190);

function parseUTC(input) {
  const s = String(input || '').trim().replace(' ','T');
  if (!s) return NaN;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` :
    /(?:Z|[+-]\d\d:\d\d)$/.test(s) ? s : `${s}Z`;
  return Date.parse(iso);
}
function normalize(values) {
  if (!Array.isArray(values)) throw Error('Candle values unavailable for XAU/USD');
  const rows = values.map(v => ({
    t: parseUTC(v.datetime), o: Number(v.open), h: Number(v.high),
    l: Number(v.low), c: Number(v.close)
  })).filter(b => Number.isFinite(b.t) &&
    [b.o,b.h,b.l,b.c].every(Number.isFinite) && b.l <= Math.min(b.o,b.c) &&
    b.h >= Math.max(b.o,b.c));
  rows.sort((a,b)=>a.t-b.t);
  const unique = new Map(rows.map(b=>[b.t,b]));
  return [...unique.values()];
}
async function getFeed(tf) {
  const config = FEEDS[tf], now = Date.now(), old = cache.get(tf);
  if (old && now-old.time < config.ttl) return {bars:old.bars,cached:true,stale:false};
  if (pending.has(tf)) return pending.get(tf);
  const task = (async () => {
    const key = process.env[config.key];
    if (!key) throw Error(`Missing environment variable ${config.key}`);
    const url = new URL(API_URL);
    for (const [k,v] of Object.entries({symbol:SYMBOL,interval:tf,outputsize:config.size,
      timezone:'UTC',order:'asc',apikey:key})) url.searchParams.set(k,String(v));
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),9000);
    try {
      const response = await fetch(url,{signal:controller.signal,headers:{accept:'application/json'}});
      const json = await response.json();
      if (!response.ok || json.status === 'error' || (json.code && json.code >= 400))
        throw Error('Twelve Data: '+String(json.message || `HTTP ${response.status}`).slice(0,120));
      const bars = normalize(json.values);
      if (bars.length < 10) throw Error(`Too few valid ${tf} candles`);
      cache.set(tf,{time:Date.now(),bars});
      return {bars,cached:false,stale:false};
    } finally { clearTimeout(timer); }
  })();
  pending.set(tf,task);
  try { return await task; }
  catch (e) {
    if (old && now-old.time < config.ttl*10)
      return {bars:old.bars,cached:true,stale:true,warning:label(e)};
    throw e;
  } finally { pending.delete(tf); }
}
function completed(bars,minutes) {
  const until = Date.now() - 2500;
  return bars.filter(b=>b.t + minutes*60000 <= until);
}
function ema(bars,n) {
  if (!bars.length) return NaN;
  const k=2/(n+1); let v=bars[0].c;
  for (let i=1;i<bars.length;i++) v=bars[i].c*k+v*(1-k);
  return v;
}
function atr(bars,n=14) {
  if (bars.length<2) return NaN;
  const start=Math.max(1,bars.length-n); let values=[];
  for (let i=start;i<bars.length;i++) {
    const b=bars[i],p=bars[i-1].c;
    values.push(Math.max(b.h-b.l,Math.abs(b.h-p),Math.abs(b.l-p)));
  }
  return avg(values);
}
function trend(bars) {
  if (bars.length<55) return 'UNKNOWN';
  const fast=ema(bars,20), slow=ema(bars,50), v=atr(bars);
  if (!Number.isFinite(v)) return 'UNKNOWN';
  if (Math.abs(fast-slow)<v*.13) return 'RANGING';
  return fast>slow?'BULLISH':'BEARISH';
}
function swingPoints(bars,tf,width,weight) {
  const out=[];
  for (let i=width;i<bars.length-width;i++) {
    const b=bars[i]; let high=true,low=true;
    for (let j=i-width;j<=i+width;j++) {
      if (j===i) continue;
      if (bars[j].h>=b.h) high=false;
      if (bars[j].l<=b.l) low=false;
      if (!high&&!low) break;
    }
    const confirmed=bars[i+width].t;
    if (high) out.push({price:b.h,side:'BUY_SIDE',kind:`${tf} SWING HIGH`,weight,
      time:b.t,confirmedAt:confirmed});
    if (low) out.push({price:b.l,side:'SELL_SIDE',kind:`${tf} SWING LOW`,weight,
      time:b.t,confirmedAt:confirmed});
  }
  return out.slice(-75);
}
const dateKey=t=>new Date(t).toISOString().slice(0,10);
function previousDay(daily) {
  const today=dateKey(Date.now());
  return [...daily].reverse().find(b=>dateKey(b.t)<today) || null;
}
function monday(t) {
  const d=new Date(t),dow=(d.getUTCDay()+6)%7;
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-dow);
}
function previousWeek(daily) {
  const before=daily.filter(b=>monday(b.t)<monday(Date.now()));
  if (!before.length) return null;
  const start=monday(before.at(-1).t), week=before.filter(b=>monday(b.t)===start);
  return {h:Math.max(...week.map(b=>b.h)),l:Math.min(...week.map(b=>b.l)),t:week[0].t};
}
const sessionDefs=[
  {id:'ASIA',zone:'Asia/Tokyo',start:9,end:17,display:'09–17 TOKYO'},
  {id:'LONDON',zone:'Europe/London',start:8,end:17,display:'08–17 LONDON'},
  {id:'NEW_YORK',zone:'America/New_York',start:8,end:17,display:'08–17 NEW YORK'}
];
const formatters=Object.fromEntries(sessionDefs.map(s=>[s.id,
  new Intl.DateTimeFormat('en-CA',{timeZone:s.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})]));
function zonedParts(ts,id) {
  const o={};
  for (const x of formatters[id].formatToParts(new Date(ts))) if (x.type!=='literal') o[x.type]=x.value;
  return {date:`${o.year}-${o.month}-${o.day}`, hour:Number(o.hour)+Number(o.minute)/60};
}
function sessions(m5) {
  return sessionDefs.map(s=>{
    const now=zonedParts(Date.now(),s.id);
    const inside=m5.filter(b=>{
      const t=zonedParts(b.t,s.id);
      return t.date===now.date && t.hour>=s.start && t.hour<s.end;
    });
    return {id:s.id,display:s.display,status:now.hour<s.start?'UPCOMING':now.hour>=s.end?'COMPLETE':'ACTIVE',
      high:inside.length?round(Math.max(...inside.map(b=>b.h))):null,
      low:inside.length?round(Math.min(...inside.map(b=>b.l))):null,
      bars:inside.length,complete:now.hour>=s.end};
  });
}
function buildLevels(m5,m15,h1,daily,ss,price,v) {
  let candidates=[
    ...swingPoints(m5.slice(-500),'M5',5,14),
    ...swingPoints(m15.slice(-350),'M15',4,21),
    ...swingPoints(h1.slice(-240),'H1',3,27)
  ];
  const pd=previousDay(daily), pw=previousWeek(daily);
  if (pd) candidates.push(
    {price:pd.h,side:'BUY_SIDE',kind:'PREVIOUS DAY HIGH',weight:36,time:pd.t,confirmedAt:pd.t+86400000},
    {price:pd.l,side:'SELL_SIDE',kind:'PREVIOUS DAY LOW',weight:36,time:pd.t,confirmedAt:pd.t+86400000}
  );
  if (pw) candidates.push(
    {price:pw.h,side:'BUY_SIDE',kind:'PREVIOUS WEEK HIGH',weight:42,time:pw.t,confirmedAt:monday(pw.t)+7*86400000},
    {price:pw.l,side:'SELL_SIDE',kind:'PREVIOUS WEEK LOW',weight:42,time:pw.t,confirmedAt:monday(pw.t)+7*86400000}
  );
  for (const s of ss) if (s.high !== null) candidates.push(
    {price:s.high,side:'BUY_SIDE',kind:s.id.replace('_',' ')+' HIGH',weight:s.complete?26:16,
      time:Date.now(),confirmedAt:s.complete?Date.now():null,forming:!s.complete},
    {price:s.low,side:'SELL_SIDE',kind:s.id.replace('_',' ')+' LOW',weight:s.complete?26:16,
      time:Date.now(),confirmedAt:s.complete?Date.now():null,forming:!s.complete}
  );
  const tolerance=Math.max(v*.28,price*.000065,0.08);
  const groups=[];
  for (const side of ['BUY_SIDE','SELL_SIDE']) {
    const sorted=candidates.filter(x=>x.side===side).sort((a,b)=>a.price-b.price);
    for (const x of sorted) {
      let g=groups.find(z=>z.side===side && Math.abs(z.price-x.price)<=tolerance);
      if (!g) {
        g={side,price:x.price,weightSum:0,count:0,maxWeight:0,kinds:[],time:0,forming:true};
        groups.push(g);
      }
      g.price=(g.price*g.weightSum+x.price*x.weight)/(g.weightSum+x.weight);
      g.weightSum+=x.weight;
      g.count++;
      if (x.weight>=g.maxWeight) { g.kind=x.kind; g.maxWeight=x.weight; }
      if (!g.kinds.includes(x.kind)) g.kinds.push(x.kind);
      g.time=Math.max(g.time,x.time||0);
      if (!x.forming) g.forming=false;
    }
  }
  return groups.map((g,i)=>{
    const distance=Math.abs(g.price-price)/v;
    const score=clamp(Math.round(19+g.maxWeight+Math.min(6,g.count)*6+
      Math.min(15,Math.log2(1+g.weightSum)*1.8)+(distance<=6?7:0)-(g.forming?12:0)),1,99);
    return {id:`Z${i+1}`,price:round(g.price),side:g.side,kind:g.kind,
      tags:g.kinds.slice(0,4),confluences:g.count,score,forming:g.forming,
      distanceATR:round(distance,2),status:g.forming?'FORMING':'TRACKING'};
  }).filter(g=>g.distanceATR<35 || g.kind.includes('PREVIOUS'))
    .sort((a,b)=>b.score-a.score).slice(0,40);
}
function findSweeps(bars) {
  const out=[];
  for (let i=Math.max(22,bars.length-150);i<bars.length;i++) {
    const b=bars[i],prior=bars.slice(i-20,i), v=atr(bars.slice(Math.max(0,i-15),i+1));
    if (!Number.isFinite(v)||v===0) continue;
    const high=Math.max(...prior.map(x=>x.h)), low=Math.min(...prior.map(x=>x.l));
    const wickH=b.h-Math.max(b.o,b.c),wickL=Math.min(b.o,b.c)-b.l;
    if (b.h>high+v*.06 && b.c<high-v*.025 && wickH>v*.12)
      out.push({t:b.t,side:'BUY_SIDE',price:round(high),extreme:round(b.h),
        type:'BUY-SIDE LIQUIDITY RAID',result:'REJECTED HIGH',
        strength:clamp(Math.round(40+wickH/v*25+(high-b.c)/v*15),1,99)});
    if (b.l<low-v*.06 && b.c>low+v*.025 && wickL>v*.12)
      out.push({t:b.t,side:'SELL_SIDE',price:round(low),extreme:round(b.l),
        type:'SELL-SIDE LIQUIDITY RAID',result:'REJECTED LOW',
        strength:clamp(Math.round(40+wickL/v*25+(b.c-low)/v*15),1,99)});
  }
  return out.sort((a,b)=>b.t-a.t).slice(0,12);
}
function findFVG(bars,v) {
  const out=[];
  for (let i=2;i<bars.length;i++) {
    const a=bars[i-2],c=bars[i]; let low,high,side;
    if (c.l-a.h>v*.18) {low=a.h;high=c.l;side='BULLISH';}
    else if (a.l-c.h>v*.18) {low=c.h;high=a.l;side='BEARISH';}
    else continue;
    const later=bars.slice(i+1);
    const filled=later.some(x=>side==='BULLISH'?x.l<=low:x.h>=high);
    if (filled) continue;
    const touched=later.some(x=>side==='BULLISH'?x.l<high:x.h>low);
    out.push({t:c.t,low:round(low),high:round(high),side,status:touched?'PARTIAL':'OPEN'});
  }
  return out.slice(-15);
}
function density(levels,price,v) {
  if (!levels.length) return [];
  const min=price-v*12,max=price+v*12;
  const bins=26;
  const raw=Array.from({length:bins},(_,i)=>{
    const p=min+(max-min)*(i+.5)/bins;
    const strength=levels.reduce((s,z)=>s+z.score*Math.exp(-.5*Math.pow((p-z.price)/(v*.65),2)),0);
    return {price:round(p),value:strength};
  });
  const high=Math.max(1,...raw.map(x=>x.value));
  return raw.map(x=>({price:x.price,strength:Math.round(x.value/high*100)}));
}
function assemble(feeds,errors) {
  const original={}; const closed={};
  for (const [tf,cfg] of Object.entries(FEEDS)) {
    original[tf]=feeds[tf]?.bars||[];
    closed[tf]=completed(original[tf],cfg.mins);
  }
  const base=original['1min'].at(-1)||original['5min'].at(-1)||original['15min'].at(-1)||original['1h'].at(-1);
  if (!base) throw Error('No usable XAU/USD feed: check API keys, plan access and remaining credits');
  const price=base.c, m5=closed['5min'],m15=closed['15min'],h1=closed['1h'];
  const v=Number.isFinite(atr(m5)) ? Math.max(.03,atr(m5)) : Math.max(.03,price*.001);
  const ss=sessions(m5),levels=buildLevels(m5,m15,h1,closed['1day'],ss,price,v);
  const trend15=trend(m15),trend1=trend(h1);
  const agreement=trend15===trend1 && ['BULLISH','BEARISH'].includes(trend1);
  const upper=levels.filter(z=>z.side==='BUY_SIDE'&&z.price>price).sort((a,b)=>a.price-b.price)[0]||null;
  const lower=levels.filter(z=>z.side==='SELL_SIDE'&&z.price<price).sort((a,b)=>b.price-a.price)[0]||null;
  const ageSec=Math.max(0,Math.floor((Date.now()-base.t)/1000));
  const quality=Object.fromEntries(Object.keys(FEEDS).map(tf=>[tf,{
    count:original[tf].length,last:original[tf].at(-1)?.t||null,
    stale:!!feeds[tf]?.stale,cached:!!feeds[tf]?.cached,
    warning:errors[tf]||null
  }]));
  return {
    ok:true,symbol:SYMBOL,generatedAt:Date.now(),price:round(price),quoteTime:base.t,
    quoteIsCandleClose:true,ageSeconds:ageSec,
    disclaimer:'OHLC-derived liquidity estimates. Not real resting orders, institutional positions or predictive probabilities.',
    market:{atrM5:round(v,3),trendM15:trend15,trendH1:trend1,
      agreement:agreement?'ALIGNED':'MIXED',bias:agreement?trend1:'NEUTRAL',
      nearestBuySide:upper,nearestSellSide:lower,strongZones:levels.filter(z=>z.score>=70&&!z.forming).length,
      lastConfirmedM5:m5.at(-1)?.t||null},
    sessions:ss,levels,sweeps:findSweeps(m5),fvgs:findFVG(m5,v),density:density(levels,price,v),
    dataQuality:quality,
    candles:Object.fromEntries(Object.entries(original).map(([tf,bars])=>[tf,bars.slice(-340)]))
  };
}
export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','public, s-maxage=40, stale-while-revalidate=45');
  if (req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  const entries=Object.keys(FEEDS);
  const settled=await Promise.allSettled(entries.map(getFeed));
  const feeds={},errors={};
  settled.forEach((result,i)=>{
    const tf=entries[i];
    if (result.status==='fulfilled') {
      feeds[tf]=result.value;
      if (result.value.warning) errors[tf]=result.value.warning;
    } else errors[tf]=label(result.reason);
  });
  try { return res.status(200).json(assemble(feeds,errors)); }
  catch(e) { return res.status(503).json({ok:false,error:label(e),feedErrors:errors}); }
}