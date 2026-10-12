
/* MKAYFX RADAR V4 — /api/xau.js
   ALL liquidity / order-flow / heatmaps are OHLC-derived proxies.
   There is NO Level 2 book, bid/ask trade classification, or real CVD.
*/
const SYMBOL='XAU/USD';
const FEEDS={
  '1min': {env:'TWELVE_DATA_API_KEY',size:360,ttl:55000,mins:1},
  '5min': {env:'TWELVE_DATA_API_KEY_2',size:650,ttl:160000,mins:5},
  '15min':{env:'TWELVE_DATA_API_KEY_3',size:420,ttl:420000,mins:15},
  '1h':   {env:'TWELVE_DATA_API_KEY_3',size:320,ttl:850000,mins:60},
  '4h':   {env:'TWELVE_DATA_API_KEY_4',size:210,ttl:1700000,mins:240},
  '1day':{env:'TWELVE_DATA_API_KEY_4',size:100,ttl:3500000,mins:1440}
};
const cache=new Map(),pending=new Map();
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const round=(x,n=2)=>Number.isFinite(x)?+x.toFixed(n):null;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const fail=e=>String(e?.message||e||'Unknown error').replace(/(?:apikey|api_key|token)\s*[=:]\s*[^&\s]+/gi,'apikey=REDACTED').slice(0,170);
const utc=s=>{
  const value=String(s||'').trim().replace(' ','T');
  if(!value)return NaN;
  return Date.parse(/^\d{4}-\d\d-\d\d$/.test(value)?value+'T00:00:00Z':/(Z|[+-]\d\d:\d\d)$/i.test(value)?value:value+'Z');
};
function normalize(values){
  if(!Array.isArray(values))throw Error('Twelve Data returned no candle array');
  const a=values.map(x=>({t:utc(x.datetime),o:+x.open,h:+x.high,l:+x.low,c:+x.close,
    v:x.volume===undefined||x.volume===null||x.volume===''?null:+x.volume})).filter(b=>
    Number.isFinite(b.t)&&[b.o,b.h,b.l,b.c].every(Number.isFinite)&&
    b.h>=Math.max(b.o,b.c)&&b.l<=Math.min(b.o,b.c));
  a.sort((a,b)=>a.t-b.t);
  return [...new Map(a.map(b=>[b.t,b])).values()];
}
async function load(tf){
  const cfg=FEEDS[tf],now=Date.now(),old=cache.get(tf);
  if(old&&now-old.at<cfg.ttl)return {bars:old.bars,cached:true,stale:false};
  if(pending.has(tf))return pending.get(tf);
  const task=(async()=>{
    const key=process.env[cfg.env];
    if(!key)throw Error('Missing '+cfg.env+' in Vercel environment variables');
    const u=new URL('https://api.twelvedata.com/time_series');
    Object.entries({symbol:SYMBOL,interval:tf,outputsize:cfg.size,timezone:'UTC',order:'asc',apikey:key})
      .forEach(([k,v])=>u.searchParams.set(k,String(v)));
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),9000);
    try{
      const r=await fetch(u,{signal:ctrl.signal,headers:{accept:'application/json'}});
      const j=await r.json();
      if(!r.ok||j.status==='error'||Number(j.code)>=400)
        throw Error(`${tf}: ${String(j.message||'HTTP '+r.status).slice(0,110)}`);
      const bars=normalize(j.values);
      if(bars.length<10)throw Error(tf+': too few valid candles');
      cache.set(tf,{at:Date.now(),bars});
      return {bars,cached:false,stale:false};
    }finally{clearTimeout(timer)}
  })();
  pending.set(tf,task);
  try{return await task}
  catch(e){
    if(old&&now-old.at<cfg.ttl*10)return {bars:old.bars,cached:true,stale:true,warning:fail(e)};
    throw e;
  }finally{pending.delete(tf)}
}
const closed=(bars,mins)=>bars.filter(b=>b.t+mins*60000<=Date.now()-2500);
function ema(bars,n){let v=bars[0]?.c??NaN,k=2/(n+1);for(let i=1;i<bars.length;i++)v=bars[i].c*k+v*(1-k);return v}
function atr(bars,n=14){
  const tr=[];
  for(let i=Math.max(1,bars.length-n);i<bars.length;i++){
    const b=bars[i],p=bars[i-1].c;
    tr.push(Math.max(b.h-b.l,Math.abs(b.h-p),Math.abs(b.l-p)));
  }
  return tr.length?mean(tr):NaN;
}
function trend(b){
  if(b.length<55)return 'UNKNOWN';
  const d=ema(b,20)-ema(b,50),a=atr(b);
  if(!Number.isFinite(a)||a<=0)return 'UNKNOWN';
  return Math.abs(d)<a*.13?'RANGING':d>0?'BULLISH':'BEARISH';
}
function swings(bars,tf,width,weight){
  const r=[];
  for(let i=width;i<bars.length-width;i++){
    const b=bars[i];let hi=true,lo=true;
    for(let j=i-width;j<=i+width;j++){
      if(j===i)continue;
      if(bars[j].h>=b.h)hi=false;
      if(bars[j].l<=b.l)lo=false;
      if(!hi&&!lo)break;
    }
    if(hi)r.push({price:b.h,side:'BUY_SIDE',kind:tf+' SWING HIGH',weight,time:b.t});
    if(lo)r.push({price:b.l,side:'SELL_SIDE',kind:tf+' SWING LOW',weight,time:b.t});
  }
  return r.slice(-75);
}
const day=t=>new Date(t).toISOString().slice(0,10);
function monday(t){const d=new Date(t),w=(d.getUTCDay()+6)%7;return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-w)}
function previousDay(d){return [...d].reverse().find(x=>day(x.t)<day(Date.now()))||null}
function previousWeek(d){
  const previous=d.filter(x=>monday(x.t)<monday(Date.now()));
  if(!previous.length)return null;
  const wk=monday(previous.at(-1).t),a=previous.filter(x=>monday(x.t)===wk);
  return {h:Math.max(...a.map(x=>x.h)),l:Math.min(...a.map(x=>x.l)),t:wk};
}
const SESSIONS=[
  {id:'ASIA',name:'TOKYO',tz:'Asia/Tokyo',start:9,end:17},
  {id:'LONDON',name:'LONDON',tz:'Europe/London',start:8,end:17},
  {id:'NEW_YORK',name:'NEW YORK',tz:'America/New_York',start:8,end:17}
];
const format=Object.fromEntries(SESSIONS.map(s=>[s.id,new Intl.DateTimeFormat('en-GB',{
  timeZone:s.tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
})]));
function local(ts,id){
  const p={};for(const x of format[id].formatToParts(new Date(ts)))if(x.type!=='literal')p[x.type]=x.value;
  return {date:`${p.year}-${p.month}-${p.day}`,hour:+p.hour+(+p.minute)/60};
}
function sessions(m5){
  return SESSIONS.map(s=>{
    const now=local(Date.now(),s.id),groups=new Map();
    for(const b of m5){const p=local(b.t,s.id);if(p.hour<s.start||p.hour>=s.end)continue;
      if(!groups.has(p.date))groups.set(p.date,[]);groups.get(p.date).push(b)}
    const current=groups.get(now.date)||[];
    const previousDate=[...groups.keys()].filter(x=>x<now.date).sort().at(-1);
    const prior=groups.get(previousDate)||[];
    const extreme=(a,key)=>a.length?round(key==='h'?Math.max(...a.map(x=>x.h)):Math.min(...a.map(x=>x.l))):null;
    return {id:s.id,name:s.name,status:now.hour<s.start?'UPCOMING':now.hour>=s.end?'COMPLETE':'ACTIVE',
      high:extreme(current,'h'),low:extreme(current,'l'),complete:now.hour>=s.end,bars:current.length,
      previousHigh:extreme(prior,'h'),previousLow:extreme(prior,'l')};
  });
}
function levels(m5,m15,h1,daily,ss,price,a){
  const p=[...swings(m5.slice(-500),'M5',5,14),...swings(m15.slice(-350),'M15',4,21),
    ...swings(h1.slice(-240),'H1',3,27)];
  const pd=previousDay(daily),pw=previousWeek(daily);
  const pair=(high,low,label,weight,forming=false)=>{
    if(high==null||low==null)return;
    p.push({price:high,side:'BUY_SIDE',kind:label+' HIGH',weight,forming},
      {price:low,side:'SELL_SIDE',kind:label+' LOW',weight,forming});
  };
  if(pd)pair(pd.h,pd.l,'PREVIOUS DAY',36);
  if(pw)pair(pw.h,pw.l,'PREVIOUS WEEK',42);
  ss.forEach(s=>{pair(s.high,s.low,s.name,s.complete?27:16,!s.complete);
    pair(s.previousHigh,s.previousLow,'PRIOR '+s.name,29)});
  const tolerance=Math.max(a*.28,price*.000065,.08),groups=[];
  for(const side of ['BUY_SIDE','SELL_SIDE']){
    for(const x of p.filter(z=>z.side===side).sort((x,y)=>x.price-y.price)){
      let g=groups.find(z=>z.side===side&&Math.abs(z.price-x.price)<=tolerance);
      if(!g){g={side,price:x.price,weightSum:0,count:0,maxWeight:0,kinds:[],forming:true};groups.push(g)}
      g.price=(g.price*g.weightSum+x.price*x.weight)/(g.weightSum+x.weight);
      g.weightSum+=x.weight;g.count++;
      if(x.weight>=g.maxWeight){g.kind=x.kind;g.maxWeight=x.weight}
      if(!g.kinds.includes(x.kind))g.kinds.push(x.kind);
      if(!x.forming)g.forming=false;
    }
  }
  return groups.map((g,i)=>{
    const dist=Math.abs(g.price-price)/a,ahead=g.side==='BUY_SIDE'?g.price>price:g.price<price;
    const score=clamp(Math.round(19+g.maxWeight+Math.min(6,g.count)*6+
      Math.min(15,Math.log2(1+g.weightSum)*1.8)+(dist<=6?7:0)-
      (g.forming?12:0)-(!ahead?14:0)),1,99);
    return {id:'Z'+(i+1),price:round(g.price),side:g.side,kind:g.kind,tags:g.kinds.slice(0,4),
      confluences:g.count,score,ahead,forming:g.forming,distanceATR:round(dist,2),
      status:g.forming?'FORMING':ahead?'AHEAD':'BEHIND PRICE'};
  }).filter(z=>z.distanceATR<35||z.kind.includes('PREVIOUS'))
    .sort((x,y)=>y.score-x.score).slice(0,50);
}
function sweeps(b){
  const r=[];
  for(let i=Math.max(22,b.length-150);i<b.length;i++){
    const x=b[i],p=b.slice(i-20,i),a=atr(b.slice(Math.max(0,i-15),i+1));
    if(!Number.isFinite(a)||!a)continue;
    const h=Math.max(...p.map(z=>z.h)),l=Math.min(...p.map(z=>z.l));
    const wh=x.h-Math.max(x.o,x.c),wl=Math.min(x.o,x.c)-x.l;
    if(x.h>h+a*.06&&x.c<h-a*.025&&wh>a*.12)
      r.push({t:x.t,side:'BUY_SIDE',price:round(h),extreme:round(x.h),result:'REJECTED HIGH',
        strength:clamp(Math.round(40+wh/a*25+(h-x.c)/a*15),1,99)});
    if(x.l<l-a*.06&&x.c>l+a*.025&&wl>a*.12)
      r.push({t:x.t,side:'SELL_SIDE',price:round(l),extreme:round(x.l),result:'REJECTED LOW',
        strength:clamp(Math.round(40+wl/a*25+(x.c-l)/a*15),1,99)});
  }
  return r.sort((x,y)=>y.t-x.t).slice(0,12);
}
function fvgs(b,a){
  const out=[];
  for(let i=2;i<b.length;i++){
    const left=b[i-2],right=b[i];let low,high,side;
    if(right.l-left.h>a*.18){low=left.h;high=right.l;side='BULLISH'}
    else if(left.l-right.h>a*.18){low=right.h;high=left.l;side='BEARISH'}
    else continue;
    const later=b.slice(i+1);
    if(later.some(x=>side==='BULLISH'?x.l<=low:x.h>=high))continue;
    const partial=later.some(x=>side==='BULLISH'?x.l<high:x.h>low);
    out.push({t:right.t,low:round(low),high:round(high),side,status:partial?'PARTIAL':'OPEN'});
  }
  return out.slice(-15);
}
function flowBar(b,weight){
  const range=Math.max(.000001,b.h-b.l);
  const closeLoc=(2*b.c-b.h-b.l)/range;
  const body=(b.c-b.o)/range;
  const pressure=clamp(.60*closeLoc+.40*body,-1,1);
  const buy=weight*(1+pressure)/2,sell=weight-buy;
  return {t:b.t,o:round(b.o),h:round(b.h),l:round(b.l),c:round(b.c),
    delta:round(buy-sell,3),buy:round(buy,3),sell:round(sell,3),
    pressurePct:round(pressure*100,1),weight:round(weight,3)};
}
function orderFlow(m1,m5){
  const source=m1.length>=24?m1:m5,sourceTf=m1.length>=24?'1min':'5min';
  const recent=source.slice(-160),volumes=recent.filter(x=>Number.isFinite(x.v)&&x.v>0);
  const volumeUsable=recent.length>0&&volumes.length/recent.length>=.8&&
    new Set(volumes.map(x=>x.v)).size>=3;
  const normal=volumeUsable?mean(volumes.map(x=>x.v)):1;
  let cvd=0;
  const series=recent.map(b=>{
    const weight=volumeUsable?clamp(b.v/Math.max(normal,.001),.25,4):1;
    const bar=flowBar(b,weight);cvd+=bar.delta;
    return {...bar,cvd:round(cvd,3)};
  });
  const window=series.slice(-30),buy=window.reduce((s,x)=>s+x.buy,0),sell=window.reduce((s,x)=>s+x.sell,0);
  const total=buy+sell,net=buy-sell;
  const status=!series.length?'NO DATA':total?Math.abs(net/total)<.12?'BALANCED':net>0?'BUY PRESSURE':'SELL PRESSURE':'NO DATA';
  return {sourceTf,mode:volumeUsable?'PROVIDER_VOLUME_WEIGHTED_PROXY':'EQUAL_CANDLE_WEIGHT_PROXY',
    note:'Modeled pressure from candle range and close location; not bid/ask executions or real CVD.',
    bars:series.length,buyPct:total?round(buy/total*100,1):null,
    sellPct:total?round(sell/total*100,1):null,
    netDelta:total?round(net,2):null,cvd:series.length?round(cvd,2):null,
    imbalancePct:total?round(net/total*100,1):null,status,
    series,footprints:series.slice(-12).reverse(),tape:series.slice(-15).reverse()};
}
function heatmap(m5,levelList,a,price){
  const bars=m5.slice(-72);
  if(!bars.length)return {times:[],prices:[],activity:[],liquidity:[],close:[]};
  const min=Math.min(...bars.map(x=>x.l),price),max=Math.max(...bars.map(x=>x.h),price);
  const pad=Math.max(a*2,(max-min)*.07,.1),lo=min-pad,hi=max+pad;
  const rows=40,step=(hi-lo)/rows;
  const prices=Array.from({length:rows},(_,i)=>round(hi-(i+.5)*step,3));
  const interest=levelList.filter(z=>z.score>=60&&!z.forming);
  const avol=mean(bars.filter(x=>Number.isFinite(x.v)&&x.v>0).map(x=>x.v))||1;
  const activity=[],liquidity=[];
  for(const p of prices){
    const act=[],liq=[];
    const zone=interest.reduce((s,z)=>s+z.score*Math.exp(-.5*((p-z.price)/Math.max(a*.7,step*1.2))**2),0);
    for(const b of bars){
      const crossed=p>=b.l-step/2&&p<=b.h+step/2;
      const proximity=Math.exp(-.5*((p-b.c)/Math.max(step*2,a*.6))**2);
      const vol=Number.isFinite(b.v)&&b.v>0?clamp(b.v/avol,.4,2.5):1;
      const hit=crossed?(.40+.60*proximity)*vol:0;
      act.push(hit);
      liq.push(zone*(.60+.40*(crossed?1:.25*proximity)));
    }
    activity.push(act);liquidity.push(liq);
  }
  const normalise=matrix=>{
    const mx=Math.max(.0001,...matrix.flat());
    return matrix.map(r=>r.map(v=>Math.round(clamp(v/mx*100,0,100))));
  };
  return {times:bars.map(x=>x.t),prices,activity:normalise(activity),
    liquidity:normalise(liquidity),close:bars.map(x=>round(x.c))};
}
function assemble(feeds,errors){
  const raw={},c={};
  for(const [tf,cfg] of Object.entries(FEEDS)){
    raw[tf]=feeds[tf]?.bars||[];c[tf]=closed(raw[tf],cfg.mins);
  }
  // Prefer the freshest available candle, then the highest-resolution feed.
  const quotes=Object.entries(raw).filter(([,b])=>b.length).map(([tf,b])=>({tf,b:b.at(-1)}))
    .sort((x,y)=>y.b.t-x.b.t||FEEDS[x.tf].mins-FEEDS[y.tf].mins);
  if(!quotes.length)throw Error('No XAU/USD feed available: check API keys, access and credits');
  const q=quotes[0],price=q.b.c;
  const m5=c['5min'],m15=c['15min'],h1=c['1h'],trueAtr=atr(m5);
  const a=Number.isFinite(trueAtr)&&trueAtr>0?trueAtr:Math.max(.03,price*.001);
  const ss=sessions(m5),zz=levels(m5,m15,h1,c['1day'],ss,price,a);
  const t15=trend(m15),t1=trend(h1),aligned=t15===t1&&['BULLISH','BEARISH'].includes(t1);
  const above=zz.filter(z=>z.ahead&&z.side==='BUY_SIDE').sort((x,y)=>x.price-y.price)[0]||null;
  const below=zz.filter(z=>z.ahead&&z.side==='SELL_SIDE').sort((x,y)=>y.price-x.price)[0]||null;
  const market={trendM15:t15,trendH1:t1,atrM5:Number.isFinite(trueAtr)?round(trueAtr,3):null,
    agreement:aligned?'ALIGNED':'MIXED',bias:aligned?t1:'NEUTRAL',nearestBuySide:above,nearestSellSide:below,
    strongZones:zz.filter(z=>z.ahead&&!z.forming&&z.score>=70).length,
    lastConfirmedM5:m5.at(-1)?.t||null};
  const dataQuality=Object.fromEntries(Object.entries(FEEDS).map(([tf,cfg])=>{
    const last=raw[tf].at(-1),age=last?Math.max(0,Math.floor((Date.now()-last.t)/1000)):null;
    return [tf,{count:raw[tf].length,last:last?.t||null,ageSeconds:age,
      delayed:age===null||age>Math.max(180,cfg.mins*60*3),
      stale:!!feeds[tf]?.stale,cached:!!feeds[tf]?.cached,warning:errors[tf]||null}];
  }));
  return {ok:true,version:'4.0',symbol:SYMBOL,generatedAt:Date.now(),price:round(price),
    quoteTime:q.b.t,quoteTimeframe:q.tf,
    quoteIsCandleClose:q.b.t+FEEDS[q.tf].mins*60000<=Date.now()-2500,
    ageSeconds:Math.max(0,Math.floor((Date.now()-q.b.t)/1000)),
    disclaimer:'OHLC-only estimates. No order-book depth or actual aggressor buy/sell executions.',
    market,analytics:{trend:market.trendH1,...market},sessions:ss,levels:zz,
    sweeps:sweeps(m5),fvgs:fvgs(m5,a),orderFlow:orderFlow(c['1min'],m5),
    heatmap:heatmap(m5,zz,a,price),dataQuality,
    candles:Object.fromEntries(Object.entries(raw).map(([tf,b])=>[tf,b.slice(-340)]))};
}
export default async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','public, s-maxage=25, stale-while-revalidate=30');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const names=Object.keys(FEEDS),results=await Promise.allSettled(names.map(load));
  const feeds={},errors={};
  results.forEach((r,i)=>{
    const tf=names[i];
    if(r.status==='fulfilled'){feeds[tf]=r.value;if(r.value.warning)errors[tf]=r.value.warning}
    else errors[tf]=fail(r.reason);
  });
  try{return res.status(200).json(assemble(feeds,errors))}
  catch(e){return res.status(503).json({ok:false,error:fail(e),feedErrors:errors})}
}
