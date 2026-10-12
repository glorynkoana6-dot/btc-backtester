
/* MKAYFX INSTITUTIONAL LIQUIDITY RADAR V3
   /api/xau.js — Node.js / Vercel
   OHLC-derived proxies, NOT actual resting institutional orders.
   BUY_SIDE is above highs; SELL_SIDE is below lows.
*/
const SYMBOL = 'XAU/USD';
const API_URL = 'https://api.twelvedata.com/time_series';
const FEEDS = {
  '1min':  { key:'TWELVE_DATA_API_KEY',   size:360, ttl:55000,   mins:1 },
  '5min':  { key:'TWELVE_DATA_API_KEY_2', size:650, ttl:160000,  mins:5 },
  '15min': { key:'TWELVE_DATA_API_KEY_3', size:420, ttl:420000,  mins:15 },
  '1h':    { key:'TWELVE_DATA_API_KEY_3', size:320, ttl:850000,  mins:60 },
  '4h':    { key:'TWELVE_DATA_API_KEY_4', size:210, ttl:1700000, mins:240 },
  '1day':  { key:'TWELVE_DATA_API_KEY_4', size:100, ttl:3500000, mins:1440 }
};
const cache = new Map();
const pending = new Map();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n, p=2) => Number(Number(n).toFixed(p));
const avg = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
const safeError = e => String(e?.message || e || 'Unknown error')
  .replace(/(?:apikey|api_key|token)\s*[=:]\s*[^&\s]+/gi, 'apikey=REDACTED').slice(0,180);

function parseUTC(input) {
  const s = String(input || '').trim().replace(' ', 'T');
  if (!s) return NaN;
  const str = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z`
    : /(?:Z|[+-]\d\d:\d\d)$/i.test(s) ? s : `${s}Z`;
  return Date.parse(str);
}
function normalize(values) {
  if (!Array.isArray(values)) throw Error('No candle array returned by Twelve Data');
  const rows = values.map(v => ({
    t: parseUTC(v.datetime), o:+v.open, h:+v.high, l:+v.low, c:+v.close
  })).filter(b=>Number.isFinite(b.t) && [b.o,b.h,b.l,b.c].every(Number.isFinite)
    && b.l<=Math.min(b.o,b.c) && b.h>=Math.max(b.o,b.c));
  rows.sort((a,b)=>a.t-b.t);
  return [...new Map(rows.map(b=>[b.t,b])).values()];
}
async function getFeed(tf) {
  const config = FEEDS[tf];
  const old = cache.get(tf);
  const now = Date.now();
  if (old && now-old.savedAt<config.ttl)
    return {bars:old.bars,cached:true,stale:false};
  if (pending.has(tf)) return pending.get(tf);
  const task = (async()=>{
    const key = process.env[config.key];
    if (!key) throw Error(`Missing Vercel environment variable: ${config.key}`);
    const url = new URL(API_URL);
    Object.entries({symbol:SYMBOL,interval:tf,outputsize:config.size,
      timezone:'UTC',order:'asc',apikey:key}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),9000);
    try {
      const r = await fetch(url,{signal:controller.signal,headers:{accept:'application/json'}});
      const json = await r.json();
      if (!r.ok || json.status==='error' || (Number(json.code)>=400))
        throw Error(`Twelve Data ${tf}: ${String(json.message||`HTTP ${r.status}`).slice(0,110)}`);
      const bars = normalize(json.values);
      if (bars.length<10) throw Error(`${tf}: only ${bars.length} usable candles`);
      cache.set(tf,{bars,savedAt:Date.now()});
      return {bars,cached:false,stale:false};
    } finally {clearTimeout(timeout);}
  })();
  pending.set(tf,task);
  try {return await task;}
  catch (e) {
    if (old && now-old.savedAt<config.ttl*10)
      return {bars:old.bars,cached:true,stale:true,warning:safeError(e)};
    throw e;
  } finally {pending.delete(tf);}
}
function completed(bars,mins) {
  const now = Date.now()-2500;
  return bars.filter(b=>b.t + mins*60000 <= now);
}
function ema(bars,n) {
  if (!bars.length) return NaN;
  const k=2/(n+1); let x=bars[0].c;
  for (let i=1;i<bars.length;i++) x=bars[i].c*k+x*(1-k);
  return x;
}
function atr(bars,n=14) {
  if (bars.length<2) return NaN;
  const values=[];
  for (let i=Math.max(1,bars.length-n);i<bars.length;i++) {
    const b=bars[i],prev=bars[i-1].c;
    values.push(Math.max(b.h-b.l,Math.abs(b.h-prev),Math.abs(b.l-prev)));
  }
  return avg(values);
}
function getTrend(bars) {
  if (bars.length<55) return 'UNKNOWN';
  const diff=ema(bars,20)-ema(bars,50),v=atr(bars);
  if (!Number.isFinite(v)||v<=0) return 'UNKNOWN';
  if (Math.abs(diff)<v*.13) return 'RANGING';
  return diff>0?'BULLISH':'BEARISH';
}
function swingPoints(bars,tf,width,weight) {
  const out=[];
  for(let i=width;i<bars.length-width;i++){
    const b=bars[i];let high=true,low=true;
    for(let j=i-width;j<=i+width;j++){
      if(i===j) continue;
      if(bars[j].h>=b.h) high=false;
      if(bars[j].l<=b.l) low=false;
      if(!high&&!low) break;
    }
    if(high)out.push({price:b.h,side:'BUY_SIDE',kind:`${tf} SWING HIGH`,weight,time:b.t});
    if(low)out.push({price:b.l,side:'SELL_SIDE',kind:`${tf} SWING LOW`,weight,time:b.t});
  }
  return out.slice(-75);
}
const dateKey=t=>new Date(t).toISOString().slice(0,10);
const monday=t=>{
  const d=new Date(t),dow=(d.getUTCDay()+6)%7;
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-dow);
};
function previousDay(daily) {
  return [...daily].reverse().find(b=>dateKey(b.t)<dateKey(Date.now()))||null;
}
function previousWeek(daily) {
  const past=daily.filter(b=>monday(b.t)<monday(Date.now()));
  if (!past.length) return null;
  const weekStart=monday(past.at(-1).t);
  const week=past.filter(b=>monday(b.t)===weekStart);
  return {h:Math.max(...week.map(b=>b.h)),l:Math.min(...week.map(b=>b.l)),t:week[0].t};
}
const SESSION_DEFS = [
  {id:'ASIA',zone:'Asia/Tokyo',start:9,end:17,display:'09–17 TOKYO'},
  {id:'LONDON',zone:'Europe/London',start:8,end:17,display:'08–17 LONDON'},
  {id:'NEW_YORK',zone:'America/New_York',start:8,end:17,display:'08–17 NEW YORK'}
];
const formatters=Object.fromEntries(SESSION_DEFS.map(s=>[s.id,new Intl.DateTimeFormat('en-GB',{
  timeZone:s.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
})]));
function localParts(ts,id) {
  const o={};
  for(const p of formatters[id].formatToParts(new Date(ts))) if(p.type!=='literal')o[p.type]=p.value;
  return {date:`${o.year}-${o.month}-${o.day}`,hour:+o.hour+(+o.minute)/60};
}
function getSessions(m5) {
  const now=Date.now();
  return SESSION_DEFS.map(s=>{
    const current=localParts(now,s.id);
    const groups=new Map();
    for(const b of m5){
      const p=localParts(b.t,s.id);
      if(p.hour<s.start||p.hour>=s.end)continue;
      if(!groups.has(p.date))groups.set(p.date,[]);
      groups.get(p.date).push(b);
    }
    const todays=groups.get(current.date)||[];
    const previousDates=[...groups.keys()].filter(d=>d<current.date).sort();
    const prior=groups.get(previousDates.at(-1))||[];
    const range=xs=>xs.length?{
      high:round(Math.max(...xs.map(b=>b.h))),
      low:round(Math.min(...xs.map(b=>b.l)))
    }:{high:null,low:null};
    return {id:s.id,display:s.display,
      status:current.hour<s.start?'UPCOMING':current.hour>=s.end?'COMPLETE':'ACTIVE',
      ...range(todays),bars:todays.length,complete:current.hour>=s.end,
      previousDate:previousDates.at(-1)||null,
      previousHigh:range(prior).high,previousLow:range(prior).low};
  });
}
function buildLevels(m5,m15,h1,daily,sessions,price,v) {
  const candidates=[
    ...swingPoints(m5.slice(-500),'M5',5,14),
    ...swingPoints(m15.slice(-350),'M15',4,21),
    ...swingPoints(h1.slice(-240),'H1',3,27)
  ];
  const pd=previousDay(daily),pw=previousWeek(daily);
  if(pd)candidates.push(
    {price:pd.h,side:'BUY_SIDE',kind:'PREVIOUS DAY HIGH',weight:36,time:pd.t},
    {price:pd.l,side:'SELL_SIDE',kind:'PREVIOUS DAY LOW',weight:36,time:pd.t}
  );
  if(pw)candidates.push(
    {price:pw.h,side:'BUY_SIDE',kind:'PREVIOUS WEEK HIGH',weight:42,time:pw.t},
    {price:pw.l,side:'SELL_SIDE',kind:'PREVIOUS WEEK LOW',weight:42,time:pw.t}
  );
  for(const s of sessions){
    const name=s.id.replaceAll('_',' ');
    if(s.high!==null){
      candidates.push(
        {price:s.high,side:'BUY_SIDE',kind:`${name} HIGH`,weight:s.complete?27:16,time:Date.now(),forming:!s.complete},
        {price:s.low,side:'SELL_SIDE',kind:`${name} LOW`,weight:s.complete?27:16,time:Date.now(),forming:!s.complete}
      );
    }
    if(s.previousHigh!==null){
      candidates.push(
        {price:s.previousHigh,side:'BUY_SIDE',kind:`PRIOR ${name} HIGH`,weight:29,time:Date.now()-86400000},
        {price:s.previousLow,side:'SELL_SIDE',kind:`PRIOR ${name} LOW`,weight:29,time:Date.now()-86400000}
      );
    }
  }
  const tolerance=Math.max(v*.28,price*.000065,.08);
  const groups=[];
  for(const side of ['BUY_SIDE','SELL_SIDE']) {
    const sorted=candidates.filter(x=>x.side===side).sort((a,b)=>a.price-b.price);
    for(const x of sorted){
      let g=groups.find(z=>z.side===side&&Math.abs(z.price-x.price)<=tolerance);
      if(!g){
        g={side,price:x.price,weightSum:0,count:0,maxWeight:0,kinds:[],forming:true};
        groups.push(g);
      }
      g.price=(g.price*g.weightSum+x.price*x.weight)/(g.weightSum+x.weight);
      g.weightSum+=x.weight;
      g.count++;
      if(x.weight>=g.maxWeight){g.kind=x.kind;g.maxWeight=x.weight;}
      if(!g.kinds.includes(x.kind))g.kinds.push(x.kind);
      if(!x.forming)g.forming=false;
    }
  }
  return groups.map((g,i)=>{
    const distance=Math.abs(g.price-price)/v;
    const ahead=g.side==='BUY_SIDE'?g.price>price:g.price<price;
    const score=clamp(Math.round(19+g.maxWeight+Math.min(6,g.count)*6+
      Math.min(15,Math.log2(1+g.weightSum)*1.8)+(distance<=6?7:0)-
      (g.forming?12:0)-(!ahead?14:0)),1,99);
    return {id:`Z${i+1}`,price:round(g.price),side:g.side,kind:g.kind,
      tags:g.kinds.slice(0,4),confluences:g.count,score,forming:g.forming,
      ahead,distanceATR:round(distance,2),
      status:g.forming?'FORMING':ahead?'AHEAD':'BEHIND PRICE'};
  }).filter(z=>z.distanceATR<35||z.kind.includes('PREVIOUS'))
    .sort((a,b)=>b.score-a.score).slice(0,50);
}
function findSweeps(bars){
  const out=[];
  for(let i=Math.max(22,bars.length-150);i<bars.length;i++){
    const b=bars[i],prior=bars.slice(i-20,i),v=atr(bars.slice(Math.max(0,i-15),i+1));
    if(!Number.isFinite(v)||v<=0)continue;
    const hi=Math.max(...prior.map(x=>x.h)),lo=Math.min(...prior.map(x=>x.l));
    const upperWick=b.h-Math.max(b.o,b.c),lowerWick=Math.min(b.o,b.c)-b.l;
    if(b.h>hi+v*.06&&b.c<hi-v*.025&&upperWick>v*.12)
      out.push({t:b.t,side:'BUY_SIDE',price:round(hi),extreme:round(b.h),
        type:'BUY-SIDE LIQUIDITY RAID',result:'REJECTED HIGH',
        strength:clamp(Math.round(40+upperWick/v*25+(hi-b.c)/v*15),1,99)});
    if(b.l<lo-v*.06&&b.c>lo+v*.025&&lowerWick>v*.12)
      out.push({t:b.t,side:'SELL_SIDE',price:round(lo),extreme:round(b.l),
        type:'SELL-SIDE LIQUIDITY RAID',result:'REJECTED LOW',
        strength:clamp(Math.round(40+lowerWick/v*25+(b.c-lo)/v*15),1,99)});
  }
  return out.sort((a,b)=>b.t-a.t).slice(0,12);
}
function findFVG(bars,v){
  const out=[];
  for(let i=2;i<bars.length;i++){
    const a=bars[i-2],c=bars[i];let low,high,side;
    if(c.l-a.h>v*.18){low=a.h;high=c.l;side='BULLISH';}
    else if(a.l-c.h>v*.18){low=c.h;high=a.l;side='BEARISH';}
    else continue;
    const later=bars.slice(i+1);
    if(later.some(x=>side==='BULLISH'?x.l<=low:x.h>=high))continue;
    const touched=later.some(x=>side==='BULLISH'?x.l<high:x.h>low);
    out.push({t:c.t,low:round(low),high:round(high),side,status:touched?'PARTIAL':'OPEN'});
  }
  return out.slice(-15);
}
function getDensity(levels,price,v){
  const min=price-v*12,max=price+v*12,bins=26;
  const raw=Array.from({length:bins},(_,i)=>{
    const p=min+(max-min)*(i+.5)/bins;
    const strength=levels.reduce((sum,z)=>sum+z.score*Math.exp(-.5*((p-z.price)/(v*.65))**2),0);
    return {price:round(p),value:strength};
  });
  const top=Math.max(1,...raw.map(x=>x.value));
  return raw.map(x=>({price:x.price,strength:Math.round(x.value/top*100)}));
}
function assemble(feeds,errors){
  const original={},closed={};
  for(const [tf,cfg] of Object.entries(FEEDS)){
    original[tf]=feeds[tf]?.bars||[];
    closed[tf]=completed(original[tf],cfg.mins);
  }
  const candidates=Object.entries(original)
    .filter(([,bars])=>bars.length).map(([tf,bars])=>({tf,b:bars.at(-1)}))
    .sort((a,b)=>b.b.t-a.b.t||FEEDS[a.tf].mins-FEEDS[b.tf].mins);
  if(!candidates.length)throw Error('No usable XAU/USD candles. Check your API keys, plan access and credits.');
  const quote=candidates[0],price=quote.b.c;
  const m5=closed['5min'],m15=closed['15min'],h1=closed['1h'];
  const actualATR=atr(m5);
  const v=Number.isFinite(actualATR)&&actualATR>0?actualATR:Math.max(.03,price*.001);
  const sessions=getSessions(m5),levels=buildLevels(m5,m15,h1,closed['1day'],sessions,price,v);
  const tr15=getTrend(m15),tr1=getTrend(h1);
  const agreement=tr15===tr1&&['BULLISH','BEARISH'].includes(tr1);
  const buy=levels.filter(z=>z.ahead&&z.side==='BUY_SIDE').sort((a,b)=>a.price-b.price)[0]||null;
  const sell=levels.filter(z=>z.ahead&&z.side==='SELL_SIDE').sort((a,b)=>b.price-a.price)[0]||null;
  const quality=Object.fromEntries(Object.entries(FEEDS).map(([tf,cfg])=>{
    const b=original[tf].at(-1),age=b?Math.max(0,Math.floor((Date.now()-b.t)/1000)):null;
    return [tf,{count:original[tf].length,last:b?.t||null,ageSeconds:age,
      stale:!!feeds[tf]?.stale,cached:!!feeds[tf]?.cached,
      delayed:age===null||age>Math.max(180,cfg.mins*60*3),
      warning:errors[tf]||null}];
  }));
  const market={
    atrM5:Number.isFinite(actualATR)?round(actualATR,3):null,
    trendM15:tr15,trendH1:tr1,agreement:agreement?'ALIGNED':'MIXED',
    bias:agreement?tr1:'NEUTRAL',
    nearestBuySide:buy,nearestSellSide:sell,
    strongZones:levels.filter(z=>z.ahead&&!z.forming&&z.score>=70).length,
    lastConfirmedM5:m5.at(-1)?.t||null
  };
  const quoteAge=Math.max(0,Math.floor((Date.now()-quote.b.t)/1000));
  return {
    ok:true,symbol:SYMBOL,generatedAt:Date.now(),price:round(price),
    quoteTime:quote.b.t,quoteTimeframe:quote.tf,
    quoteIsCandleClose:quote.b.t+FEEDS[quote.tf].mins*60000<=Date.now()-2500,
    ageSeconds:quoteAge,
    disclaimer:'Candle-derived liquidity estimates only; no order-book depth, institutional positions, or predictive probabilities.',
    market,
    // Compatibility for older frontends that read d.analytics.*
    analytics:{trend:market.trendH1,trendH1:market.trendH1,
      trendM15:market.trendM15,atrM5:market.atrM5,
      strongZones:market.strongZones,bias:market.bias},
    sessions,levels,sweeps:findSweeps(m5),fvgs:findFVG(m5,v),
    density:getDensity(levels,price,v),dataQuality:quality,
    candles:Object.fromEntries(Object.entries(original).map(([tf,bars])=>[tf,bars.slice(-340)]))
  };
}
export default async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','public, s-maxage=25, stale-while-revalidate=30');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const entries=Object.keys(FEEDS);
  const settled=await Promise.allSettled(entries.map(getFeed));
  const feeds={},errors={};
  settled.forEach((r,i)=>{
    const tf=entries[i];
    if(r.status==='fulfilled'){
      feeds[tf]=r.value;
      if(r.value.warning)errors[tf]=r.value.warning;
    }else errors[tf]=safeError(r.reason);
  });
  try{return res.status(200).json(assemble(feeds,errors));}
  catch(e){return res.status(503).json({ok:false,error:safeError(e),feedErrors:errors});}
}
