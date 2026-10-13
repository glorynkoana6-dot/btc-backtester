
/* MKAYFX BLACKBOOK X3 — client engine.
   Actual market source: Binance PAXG/USDT public spot data.
   Reference only: Twelve Data XAU/USD. NO broker orders.
   Local paper trade results are approximate; historical REST trades do not qualify signals.
*/
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const STREAMS = "paxgusdt@trade/paxgusdt@depth20@100ms/paxgusdt@kline_1m";
  const URLS = [
    `wss://data-stream.binance.vision:443/stream?streams=${STREAMS}`,
    `wss://stream.binance.com:443/stream?streams=${STREAMS}`
  ];
  const STORE = "mkayfx-blackbook-x3-v1";
  const fmt = (v, dp = 2) => Number.isFinite(v) ? v.toLocaleString("en-US", {minimumFractionDigits: dp, maximumFractionDigits: dp}) : "—";
  const short = v => !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e6 ? `${fmt(v / 1e6, 2)}M` : Math.abs(v) >= 1000 ? `${fmt(v / 1000, 1)}K` : fmt(v);
  const signed = (v, dp = 2) => Number.isFinite(v) ? `${v > 0 ? "+" : ""}${fmt(v, dp)}` : "—";
  const tm = t => new Date(t).toLocaleTimeString("en-GB", {timeZone: "Africa/Johannesburg", hour12: false});
  const num = Number;
  const good = v => Number.isFinite(v) && v > 0;
  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const S = {
    begin: Date.now(), mode: "connecting", lastFrame: 0, lastDepth: 0,
    lastLiveTrade: 0, lastLiveClose: 0, lastClosedBar: 0,
    price: NaN, priceAt: 0, xau: null, ticker: null,
    book: {bids:[], asks:[]}, bars:[], trades:[], seen: new Set(), seenQueue:[],
    heat:[], heatAt:0, cvd:0, liveTotal:0, events:[], lastAlertAt:0, lastQuoteAlert:0, lastSavedAt:0,
    records:[], lastIdeaBar:0, decision:"Waiting for market data", checks:[],
    candidateScore:null, trend1:"—", trend5:"—", trend15:"—", atr:NaN,
    buyShare:NaN, takerShare:NaN, absorption:"Insufficient observations",
    settings:{minScore:75,rr:2,fee:10,slippage:2,bucket:1}, alerts:false
  };
  let ws = null, restTimer = null, retryTimer = null, restBusy = false;
  let attempts = 0, pendingRender = null, toastTimer = null, paused = false;

  // ---------- Persistent local journal ----------
  function save() {
    try {
      const heat = S.heat.slice(-100).map(f => ({at:f.at,
        bids:f.bids.map(x=>[x.p,x.q]), asks:f.asks.map(x=>[x.p,x.q])}));
      localStorage.setItem(STORE, JSON.stringify({
        records:S.records.slice(-300),lastIdeaBar:S.lastIdeaBar,
        settings:S.settings,heat
      }));
    } catch (e) { /* Private mode / storage quota; UI still runs */ }
  }
  function restore() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!data || typeof data !== "object") return;
      for (const key of Object.keys(S.settings)) {
        const v = +data.settings?.[key];
        if (Number.isFinite(v)) S.settings[key] = v;
      }
      S.settings.minScore = clamp(S.settings.minScore,70,85);
      S.settings.rr = clamp(S.settings.rr,1.5,3);
      S.settings.fee = clamp(S.settings.fee,0,100);
      S.settings.slippage = clamp(S.settings.slippage,0,100);
      if (![.5,1,2,5].includes(S.settings.bucket)) S.settings.bucket=1;
      S.lastIdeaBar = Number(data.lastIdeaBar) || 0;
      if (Array.isArray(data.records)) S.records = data.records.slice(-300).filter(x=>x && typeof x === "object");
      S.records.forEach(r => {
        if (["PENDING","OPEN"].includes(r.status)) {
          r.status = "INTERRUPTED"; r.closedAt = Date.now(); r.note = "Page ended before a continuous market outcome could be observed";
          r.netR = null;
        }
      });
      if (Array.isArray(data.heat)) S.heat = data.heat.slice(-100).filter(f => f && Date.now()-f.at < 6*3600000).map(f => ({
        at:+f.at, bids:(f.bids||[]).map(x=>({p:+x[0],q:+x[1]})),
        asks:(f.asks||[]).map(x=>({p:+x[0],q:+x[1]}))
      })).filter(f=>f.bids.length && f.asks.length);
    } catch (e) { /* Bad previously stored state is ignored */ }
  }
  function currentPaper() {return S.records.find(r=>r.status==="PENDING"||r.status==="OPEN") || null;}
  function recordEvent(title, description="", type="info") {
    S.events.unshift({at:Date.now(),title,description,type});
    S.events.length=Math.min(90,S.events.length);
    renderEvents();
  }
  function renderEvents() {
    $("events").innerHTML=S.events.length?S.events.slice(0,35).map(e=>
      `<div class="event ${e.type}"><time>${tm(e.at)}</time><div><b>${esc(e.title)}</b><p>${esc(e.description)}</p></div></div>`
    ).join(""):'<p class="empty">No events yet.</p>';
  }
  function toast(message) {
    const el=$("toast");el.textContent=message;el.classList.add("show");
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),4000);
  }
  function scheduleRender() {if(pendingRender)return;pendingRender=setTimeout(()=>{pendingRender=null;render();},280);}

  // ---------- Live trades and maker-side normalization ----------
  function parseBuyerMaker(t) {
    if(typeof t.m === "boolean")return t.m;
    if(typeof t.isBuyerMaker === "boolean")return t.isBuyerMaker;
    return null; // Never assume unknown data is a buy or sell.
  }
  function ingestTrade(raw, live=false) {
    const id=String(raw?.t ?? raw?.id ?? "");
    const price=+(raw?.p ?? raw?.price), qty=+(raw?.q ?? raw?.qty), at=+(raw?.T ?? raw?.time);
    if(!id||!good(price)||!good(qty)||!Number.isFinite(at)||S.seen.has(id))return;
    const maker=parseBuyerMaker(raw), buy=maker===null?null:!maker;
    S.seen.add(id);S.seenQueue.push(id);
    if(S.seenQueue.length>5000)S.seen.delete(S.seenQueue.shift());
    const t={id,price,qty,at,buy,live,notional:price*qty};
    S.trades.push(t);S.trades.sort((a,b)=>b.at-a.at||Number(b.id)-Number(a.id));
    if(S.trades.length>900)S.trades.length=900;
    if(at>=S.priceAt){S.price=price;S.priceAt=at;}
    if(live){
      S.lastLiveTrade=Date.now();
      S.liveTotal++;
      if(buy!==null)S.cvd += buy?qty:-qty;
      handlePaperTick(t);
      if(t.notional>=10000 && Date.now()-S.lastAlertAt>3000){
        S.lastAlertAt=Date.now();
        recordEvent("Large executed trade",`${buy===null?"UNKNOWN":buy?"BUY":"SELL"} ${fmt(t.notional,0)} USDT @ ${fmt(price)}`,"warn");
        if(S.alerts)toast(`LARGE TRADE ${fmt(t.notional,0)} USDT`);
      }
    }
    scheduleRender();
  }
  // ---------- Top-20 order book snapshots ----------
  function ingestBook(raw, fromLive) {
    if(!Array.isArray(raw?.bids)||!Array.isArray(raw?.asks))return;
    const clean=(arr,descending)=>arr.map(x=>({p:+x[0],q:+x[1]})).filter(x=>good(x.p)&&good(x.q)).sort((a,b)=>descending?b.p-a.p:a.p-b.p).slice(0,20);
    const bids=clean(raw.bids,true), asks=clean(raw.asks,false);
    if(!bids.length||!asks.length||bids[0].p>=asks[0].p)return;
    if(!fromLive && S.mode==="ws" && S.lastDepth)return; // Don't regress a live book to REST.
    const old=S.book;S.book={bids,asks};S.lastDepth=Date.now();
    if(!good(S.price)){S.price=(bids[0].p+asks[0].p)/2;}
    if(fromLive && Date.now()-S.lastQuoteAlert>5000 && old.bids.length && old.asks.length){
      const prior=[...old.bids,...old.asks];
      const mean=prior.reduce((sum,x)=>sum+x.q,0)/prior.length;
      const big=prior.find(x=>x.q>=mean*4 && ![...bids,...asks].some(y=>y.p===x.p&&y.q>=x.q*.2));
      if(big){S.lastQuoteAlert=Date.now();recordEvent("Large displayed quote reduced",`${fmt(big.p)}: previous ${fmt(big.q,4)} PAXG; cancellation/execution unknown`,"warn");}
    }
    if(Date.now()-S.heatAt>=2000){
      S.heatAt=Date.now();S.heat.push({at:S.heatAt,bids:bids.map(x=>({...x})),asks:asks.map(x=>({...x}))});
      if(S.heat.length>100)S.heat.shift();
    }
    scheduleRender();
  }
  function ingestBar(raw, source="rest") {
    const b={t:+raw.t,o:+raw.o,h:+raw.h,l:+raw.l,c:+raw.c,v:+raw.v,closed:!!raw.closed,source};
    if(!Number.isFinite(b.t)||![b.o,b.h,b.l,b.c].every(good)||!Number.isFinite(b.v)||b.v<0||b.h<b.l)return;
    const index=S.bars.findIndex(x=>x.t===b.t);
    if(index===-1)S.bars.push(b);
    else {
      const existing=S.bars[index];
      if(source==="rest" && existing.source==="ws")return;
      S.bars[index]={...b,closed:b.closed||existing.closed};
    }
    S.bars.sort((a,b)=>a.t-b.t);
    if(S.bars.length>850)S.bars=S.bars.slice(-850);
    scheduleRender();
  }
  function ingestStream(raw) {
    let message;try{message=JSON.parse(raw);}catch{return;}
    const d=message?.data ?? message;if(!d)return;
    S.lastFrame=Date.now();
    if(d.e==="trade")ingestTrade(d,true);
    else if(Array.isArray(d.bids)&&Array.isArray(d.asks))ingestBook(d,true);
    else if(d.e==="kline" && d.k){
      const k=d.k;
      ingestBar({t:k.t,o:k.o,h:k.h,l:k.l,c:k.c,v:k.v,closed:k.x},"ws");
      if(k.x && +k.t>S.lastLiveClose){
        S.lastLiveClose=+k.t;S.lastClosedBar=Date.now();
        evaluate();
      }
    }
    updateConnection();
  }

  // ---------- Bootstrap and REST failover ----------
  async function fetchMarket(history=false) {
    if(paused || restBusy)return;
    restBusy=true;
    try {
      const response=await fetch(`/api/market${history?"?history=1":""}`,{cache:"no-store"});
      const d=await response.json();
      if(!response.ok||!d.ok)throw Error(Object.values(d.errors||{}).join("; ")||"Exchange data unavailable");
      if(Array.isArray(d.candles))d.candles.forEach(c=>ingestBar(c,"rest"));
      if(d.depth)ingestBook(d.depth,false);
      if(Array.isArray(d.trades))d.trades.forEach(t=>ingestTrade(t,false));
      if(d.ticker){S.ticker=d.ticker;if(!good(S.price)&&good(+d.ticker.lastPrice))S.price=+d.ticker.lastPrice;}
      if(S.mode!=="ws"){S.mode="rest";S.lastFrame=Date.now();}
      if(Object.keys(d.errors||{}).length&&history)recordEvent("Partial market bootstrap",JSON.stringify(d.errors),"warn");
      scheduleRender();updateConnection();
    } catch(e){if(S.mode!=="ws")S.mode="error";recordEvent("REST market endpoint failed",e.message,"bad");updateConnection();}
    finally {restBusy=false;}
  }
  async function fetchXau(){
    if(paused)return;
    try{const r=await fetch("/api/xau",{cache:"no-store"});const d=await r.json();
      if(d.ok&&good(+d.price)){S.xau=d;$("xauPrice").textContent=fmt(+d.price);$("xauMeta").textContent=`1m reference close · ${d.candleUTC} UTC`;}
      else $("xauMeta").textContent=d.error||"Reference unavailable";
    }catch{$("xauMeta").textContent="Reference unavailable";}
  }
  function beginRest(){if(paused||document.hidden)return;if(!restTimer){fetchMarket();restTimer=setInterval(()=>fetchMarket(),12000);}S.mode="rest";updateConnection();}
  function stopRest(){clearInterval(restTimer);restTimer=null;}
  function interruptPaper(reason){const r=currentPaper();if(!r)return;r.status="INTERRUPTED";r.closedAt=Date.now();r.netR=null;r.note=reason;recordEvent("Paper tracking interrupted",reason,"warn");save();}
  function reconnectLater(){if(retryTimer||paused||document.hidden)return;const wait=Math.min(3500*2**Math.min(attempts,4),55000);retryTimer=setTimeout(()=>{retryTimer=null;connect();},wait);}
  function connect(){
    if(ws||paused||document.hidden)return;
    if(typeof WebSocket==="undefined"){recordEvent("WebSocket unavailable","Using REST only; new signals are disabled","warn");beginRest();return;}
    const url=URLS[attempts++%URLS.length];let conn;
    try{conn=new WebSocket(url);}catch(e){recordEvent("Socket creation failed",e.message,"warn");beginRest();reconnectLater();return;}
    ws=conn;let opened=false;
    const timeout=setTimeout(()=>{if(!opened&&ws===conn)conn.close();},9000);
    conn.onopen=()=>{if(ws!==conn)return;opened=true;clearTimeout(timeout);attempts=0;S.mode="ws";S.lastFrame=Date.now();S.lastDepth=0;S.lastLiveTrade=0;S.lastLiveClose=0;stopRest();recordEvent("Live exchange stream connected","PAXG trade + 20-level snapshots + 1m candles","good");updateConnection();};
    conn.onmessage=e=>{if(ws===conn)ingestStream(e.data);};
    conn.onerror=()=>{if(ws===conn)conn.close();};
    conn.onclose=()=>{clearTimeout(timeout);if(ws!==conn)return;ws=null;if(paused||document.hidden)return;interruptPaper("Live stream disconnected; execution path unknown");recordEvent("Stream disconnected","REST fallback active; attempting to reconnect","warn");beginRest();reconnectLater();};
  }
  function disconnect(){clearTimeout(retryTimer);retryTimer=null;stopRest();if(ws){const old=ws;ws=null;try{old.close();}catch{}}}
  function restart(){interruptPaper("Reconnected before paper result confirmed");disconnect();paused=false;S.mode="connecting";S.lastDepth=0;S.lastLiveTrade=0;S.lastLiveClose=0;S.lastFrame=0;updateConnection();fetchMarket(S.bars.length<400);connect();}
  function updateConnection(){
    const age=Date.now()-S.lastFrame,live=S.mode==="ws"&&age<30000,rest=S.mode==="rest"&&age<30000;
    $("connection").className="connection"+(live?" live":rest?"":" off");
    $("connText").textContent=live?"LIVE STREAM":rest?"REST FALLBACK":S.mode==="connecting"?"CONNECTING":"DATA OFFLINE";
    $("marketMode").textContent=live?"LIVE ORDER FLOW":rest?"REST / SIGNALS OFF":"NO LIVE CONFIRMATION";
    $("feedHealth").textContent=live?`STREAM ${Math.round(age/1000)}s · DEPTH ${S.lastDepth?Math.round((Date.now()-S.lastDepth)/1000)+"s":"WAIT"}`:rest?"REST SNAPSHOTS — NO SIGNALS":"STALE OR OFFLINE";
  }

  // ---------- Market structure / indicators ----------
  function ema(bars,length){
    if(bars.length<length)return NaN;
    let v=bars.slice(0,length).reduce((a,b)=>a+b.c,0)/length;
    const alpha=2/(length+1);
    for(let i=length;i<bars.length;i++)v+=alpha*(bars[i].c-v);
    return v;
  }
  function atr(bars,length=14){
    if(bars.length<length+1)return NaN;
    const tr=[];
    for(let i=1;i<bars.length;i++)tr.push(Math.max(bars[i].h-bars[i].l,Math.abs(bars[i].h-bars[i-1].c),Math.abs(bars[i].l-bars[i-1].c)));
    return tr.slice(-length).reduce((a,b)=>a+b,0)/length;
  }
  function aggregate(bars,minutes){
    const step=minutes*60000, output=[];let group=[], key=null;
    function push(){
      if(group.length!==minutes || group[0].t!==key)return;
      for(let i=1;i<group.length;i++)if(group[i].t!==group[i-1].t+60000)return;
      output.push({t:key,o:group[0].o,h:Math.max(...group.map(b=>b.h)),l:Math.min(...group.map(b=>b.l)),c:group.at(-1).c,v:group.reduce((a,b)=>a+b.v,0),closed:true});
    }
    for(const bar of bars){const k=Math.floor(bar.t/step)*step;if(k!==key){if(group.length)push();group=[];key=k;}group.push(bar);}
    if(group.length)push();return output;
  }
  function trend(bars){const a=ema(bars,9),b=ema(bars,21);return !Number.isFinite(a)||!Number.isFinite(b)?"—":a>b?"UP":a<b?"DOWN":"FLAT";}
  function takerStats(){
    const ts=S.trades.filter(t=>t.live&&t.buy!==null&&t.at>=Date.now()-90000);
    const buy=ts.filter(t=>t.buy).reduce((a,b)=>a+b.qty,0);
    const sell=ts.filter(t=>!t.buy).reduce((a,b)=>a+b.qty,0);
    return {count:ts.length,buy,sell,share:buy+sell?buy/(buy+sell):NaN};
  }
  function bookStats(){
    const b=S.book.bids.slice(0,15).reduce((a,x)=>a+x.q,0);
    const a=S.book.asks.slice(0,15).reduce((x,y)=>x+y.q,0);
    return b+a?b/(b+a):NaN;
  }
  function freshReason(last){
    if(S.mode!=="ws"||!ws||ws.readyState!==WebSocket.OPEN)return "Live stream required (REST is insufficient)";
    if(Date.now()-S.lastFrame>12000)return "WebSocket messages are stale";
    if(Date.now()-S.lastDepth>10000)return "Order-book depth is stale";
    if(Date.now()-S.lastLiveTrade>45000)return "No recent live executions";
    if(!good(S.price)||Date.now()-S.priceAt>45000)return "Latest executed price is stale";
    if(S.lastLiveClose!==last?.t||Date.now()-S.lastClosedBar>16000)return "Waiting for a newly completed stream candle";
    return "";
  }
  function evaluate(){
    const bars=S.bars.filter(b=>b.closed&&b.t+60000<=Date.now());
    const last=bars.at(-1),b5=aggregate(bars,5),b15=aggregate(bars,15),tf=takerStats();
    S.atr=atr(bars);S.trend1=trend(bars);S.trend5=trend(b5);S.trend15=trend(b15);
    S.buyShare=bookStats();S.takerShare=tf.share;
    const recent=S.trades.filter(t=>t.live&&t.buy!==null&&t.at>=Date.now()-60000);
    const buyRecent=recent.filter(t=>t.buy).reduce((a,t)=>a+t.qty,0), sellRecent=recent.filter(t=>!t.buy).reduce((a,t)=>a+t.qty,0);
    const three=bars.slice(-3);const range=three.length===3?Math.max(...three.map(b=>b.h))-Math.min(...three.map(b=>b.l)):NaN;
    S.absorption="NO CLEAR CANDIDATE";
    if(recent.length>=5&&Number.isFinite(S.atr)&&range<=S.atr*.8){
      if(buyRecent>sellRecent*2.2)S.absorption="BUYING ABSORBED?";
      if(sellRecent>buyRecent*2.2)S.absorption="SELLING ABSORBED?";
    }
    $("trend1").textContent=S.trend1;$("trend5").textContent=S.trend5;$("trend15").textContent=S.trend15;
    $("atr").textContent=fmt(S.atr);$("pressure").textContent=Number.isFinite(tf.share)?`${fmt(tf.share*100,1)}% BUY · ${tf.count} events`:"WAITING";
    $("absorption").textContent=S.absorption;
    if(currentPaper()){renderSignal();return;}
    if(bars.length<35 || b5.length<22 || b15.length<22 || !good(S.atr)){
      S.decision="Building complete M1/M5/M15 candle history";S.candidateScore=null;S.checks=[];renderSignal();return;
    }
    const stale=freshReason(last);
    if(stale){S.decision=stale;S.candidateScore=null;S.checks=[["Live data freshness",false]];renderSignal();return;}
    const prev=bars.slice(-13,-1);const previousHigh=Math.max(...prev.map(b=>b.h)),previousLow=Math.min(...prev.map(b=>b.l));
    const body=Math.abs(last.c-last.o)/Math.max(last.h-last.l,1e-8);
    const avgVol=bars.slice(-21,-1).reduce((a,b)=>a+b.v,0)/20;
    const spread=S.book.asks[0].p-S.book.bids[0].p;
    const candidates=[1,-1].map(dir=>{
      const buy=dir===1;
      const breakout=buy?(last.c>previousHigh&&last.o<=previousHigh&&last.c>last.o):(last.c<previousLow&&last.o>=previousLow&&last.c<last.o);
      const sweep=buy?(last.l<previousLow&&last.c>previousLow&&last.c>last.o):(last.h>previousHigh&&last.c<previousHigh&&last.c<last.o);
      const trigger=breakout?"BREAKOUT":sweep?"SWEEP REJECTION":null;
      const t1=buy?S.trend1==="UP":S.trend1==="DOWN",t5=buy?S.trend5==="UP":S.trend5==="DOWN",t15=buy?S.trend15==="UP":S.trend15==="DOWN";
      const candle=body>=.45&&(buy?last.c>last.o:last.c<last.o);
      const depth=buy?S.buyShare>=.54:S.buyShare<=.46;
      const tape=tf.count>=3&&(buy?tf.share>=.56:tf.share<=.44);
      const vol=avgVol>0&&last.v>=avgVol;
      const cost=Number.isFinite(spread)&&spread>=0&&spread<=Math.max(S.atr*.6,S.price*.0012);
      const chase=Math.abs(S.price-last.c)<=S.atr*.6 && (S.price-last.c)*dir<=S.atr*.35;
      const score=(t1?15:0)+(t5?10:0)+(t15?10:0)+(trigger?20:0)+(candle?10:0)+(depth?12:0)+(tape?13:0)+(vol?5:0)+(cost?5:0);
      const checks=[["M1 direction",t1],["M5 direction",t5],["M15 direction",t15],["Sweep or breakout",!!trigger],["Strong close",candle],["Resting depth confirms",depth],["Live trade aggression",tape],["Spread acceptable",cost],["Entry not chased",chase]];
      return {dir,side:buy?"BUY":"SELL",score,checks,trigger,qualified:t1&&t5&&!!trigger&&candle&&depth&&tape&&cost&&chase&&score>=S.settings.minScore};
    }).sort((a,b)=>b.score-a.score);
    const winner=candidates[0];S.candidateScore=winner.score;S.checks=winner.checks;
    if(!winner.qualified){const failed=winner.checks.filter(c=>!c[1]).map(c=>c[0]);S.decision=failed.length?`NO TRADE — ${failed.slice(0,3).join(" · ")}`:`Score below ${S.settings.minScore}`;renderSignal();return;}
    if(S.lastIdeaBar===last.t){S.decision="Already evaluated this completed candle";renderSignal();return;}
    const structural=winner.dir===1?Math.min(...bars.slice(-6).map(b=>b.l)):Math.max(...bars.slice(-6).map(b=>b.h));
    const protective=winner.dir===1?structural-S.atr*.12:structural+S.atr*.12;
    const risk=Math.max(S.atr*.95,(S.price-protective)*winner.dir);
    if(!good(risk)||risk>S.atr*3){S.decision="NO TRADE — structural stop too wide";renderSignal();return;}
    const entry=S.price,stop=entry-winner.dir*risk,target=entry+winner.dir*risk*S.settings.rr;
    if(![entry,stop,target].every(good)){S.decision="NO TRADE — invalid levels";renderSignal();return;}
    S.lastIdeaBar=last.t;
    const r={id:`${last.t}-${winner.side}`,createdAt:Date.now(),candleAt:last.t,side:winner.side,
      dir:winner.dir,setup:winner.trigger,score:winner.score,checks:winner.checks,
      plannedEntry:entry,plannedSL:stop,plannedTP:target,rr:S.settings.rr,
      risk,entry:null,stop:null,target:null,exit:null,netR:null,status:"PENDING",
      feeBps:S.settings.fee,slippageBps:S.settings.slippage,
      note:"Pending first subsequent live trade (maximum 30 seconds)"};
    S.records.unshift(r);S.records.length=Math.min(S.records.length,300);save();
    recordEvent(`${r.side} research idea · ${r.score}/100`,`${r.setup} | reference ${fmt(entry)} | SL ${fmt(stop)} | TP ${fmt(target)}`,"good");
    if(S.alerts)toast(`${r.side} PAXG IDEA · score ${r.score}/100`);
    renderSignal();renderPaper();
  }

  // ---------- Forward paper fills and conservative exits ----------
  function finalize(r,status,trade,reason){
    if(!r||r.status!=="OPEN")return;
    const spread=S.book.bids.length&&S.book.asks.length&&Date.now()-S.lastDepth<10000?S.book.asks[0].p-S.book.bids[0].p:0;
    const extra=Math.max(0,spread/2)+trade.price*r.slippageBps/10000;
    // Paper exit is always made worse by the half-spread and configured slippage.
    let exit=trade.price-r.dir*extra;
    if(status==="TP")exit=r.dir===1?Math.min(exit,r.target):Math.max(exit,r.target);
    if(status==="SL")exit=r.dir===1?Math.min(exit,r.stop):Math.max(exit,r.stop);
    r.exit=exit;r.closedAt=trade.at;r.status=status;r.note=reason;
    const gross=r.dir*(exit-r.entry);
    const fees=(Math.abs(r.entry)+Math.abs(exit))*r.feeBps/10000;
    r.netR=(gross-fees)/r.risk;
    recordEvent(`Paper ${status}`,`${r.side} net ${signed(r.netR,3)}R · exit ~${fmt(exit)}`,status==="TP"?"good":"warn");
    save();renderPaper();
  }
  function handlePaperTick(t){
    const r=currentPaper();if(!r||!t.live)return;
    if(r.status==="PENDING"){
      if(t.at<=r.createdAt)return;
      if(Date.now()-r.createdAt>30000){r.status="MISSED";r.closedAt=Date.now();r.note="No timely live paper entry";save();renderPaper();return;}
      if(Date.now()-S.lastDepth>10000)return; // No reliable quote to approximate an entry.
      const spread=Math.max(0,S.book.asks[0].p-S.book.bids[0].p);
      const adverse=spread/2+t.price*r.slippageBps/10000;
      r.entry=t.price+r.dir*adverse;r.stop=r.entry-r.dir*r.risk;r.target=r.entry+r.dir*r.risk*r.rr;
      r.filledAt=t.at;r.status="OPEN";r.note="Hypothetical fill at observed trade, plus estimated costs";
      recordEvent("Paper entry estimated",`${r.side} ${fmt(r.entry)} | SL ${fmt(r.stop)} | TP ${fmt(r.target)}`,"good");
      save();renderPaper();return;
    }
    if(r.status==="OPEN"){
      if(t.at<=r.filledAt)return;
      if(r.dir===1&&t.price<=r.stop || r.dir===-1&&t.price>=r.stop)finalize(r,"SL",t,"Stop touched by subsequently observed trade");
      else if(r.dir===1&&t.price>=r.target || r.dir===-1&&t.price<=r.target)finalize(r,"TP",t,"Target touched by subsequently observed trade");
      else if(t.at-r.filledAt>=20*60000)finalize(r,"TIME_EXIT",t,"20-minute paper holding limit");
    }
  }
  function periodicPaper(){
    const r=currentPaper();if(!r)return;
    if(r.status==="PENDING"&&Date.now()-r.createdAt>30000){r.status="MISSED";r.closedAt=Date.now();r.note="No timely live paper fill";save();renderPaper();}
    // OPEN paper positions require another live tick to close; no simulated future prices.
  }
  function renderSignal(){
    const r=currentPaper(),dir=$("direction");
    dir.textContent=r?`${r.side} IDEA`:"NO TRADE";
    dir.className="direction"+(r?(r.side==="BUY"?" positive":" negative"):"");
    $("signalBadge").textContent=r?`PAPER ${r.status}`:"WAITING FOR SETUP";
    $("reason").textContent=r?`${r.setup} · reference entry, awaiting/monitoring hypothetical paper execution`:S.decision;
    $("score").textContent=r?r.score:Number.isFinite(S.candidateScore)?S.candidateScore:"—";
    $("entry").textContent=r?fmt(r.entry??r.plannedEntry):"—";
    $("stop").textContent=r?fmt(r.stop??r.plannedSL):"—";
    $("target").textContent=r?fmt(r.target??r.plannedTP):"—";
    $("riskRatio").textContent=r?`1 : ${fmt(r.rr,1)}`:"—";
    $("signalTime").textContent=r?`Created ${tm(r.createdAt)} SAST`:`Updated ${tm(Date.now())} SAST`;
    $("signalState").textContent=r?`Paper status: ${r.status}`:"No broker orders placed";
    $("checks").innerHTML=(r?r.checks:S.checks).map(([name,ok])=>`<span class="check ${ok?"good":"bad"}">${ok?"✓":"×"} ${esc(name)}</span>`).join("")||'<span class="check">Awaiting completed candle</span>';
  }

  // ---------- Paper analytics + export ----------
  function renderPaper(){
    const records=S.records, done=records.filter(r=>["TP","SL","TIME_EXIT"].includes(r.status)&&Number.isFinite(r.netR));
    const wins=done.filter(r=>r.netR>0),losses=done.filter(r=>r.netR<=0);
    const sum=done.reduce((a,r)=>a+r.netR,0),profit=wins.reduce((a,r)=>a+r.netR,0),loss=Math.abs(losses.reduce((a,r)=>a+r.netR,0));
    let equity=0,peak=0,dd=0;
    [...done].sort((a,b)=>a.closedAt-b.closedAt).forEach(r=>{equity+=r.netR;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);});
    $("statTrades").textContent=done.length;
    $("statWin").textContent=done.length?fmt(wins.length/done.length*100,1)+"%":"—";
    $("statPF").textContent=loss>0?fmt(profit/loss):"—";
    $("statExp").textContent=done.length?signed(sum/done.length,3)+"R":"—";
    $("statR").textContent=done.length?signed(sum,3)+"R":"—";
    $("statDD").textContent=done.length?fmt(dd,3)+"R":"—";
    $("statR").className=sum>0?"positive":sum<0?"negative":"";
    $("statExtra").textContent=`${records.filter(r=>r.status==="OPEN").length} open · ${records.filter(r=>r.status==="PENDING").length} pending · ${records.filter(r=>r.status==="MISSED").length} missed · ${records.filter(r=>r.status==="INTERRUPTED").length} interrupted. Net R uses estimated fee, spread and slippage; historical backtesting is NOT performed.`;
    $("paperRows").innerHTML=records.length?records.slice(0,45).map(r=>`<tr><td>${tm(r.createdAt)}</td><td class="${r.side==="BUY"?"buy":"sell"}">${esc(r.side)} ${esc(r.setup||"")}</td><td>${fmt(r.score,0)}</td><td>${fmt(r.plannedEntry)}</td><td>${fmt(r.entry)}</td><td>${esc(r.status)}</td><td class="${r.netR>0?"positive":r.netR<0?"negative":""}">${r.netR===null?"—":signed(r.netR,3)}</td></tr>`).join(""):'<tr><td colspan="7" class="empty">No paper trades yet. Only forward live ideas appear here.</td></tr>';
  }
  function exportCSV(){
    const keys=["id","createdAt","side","setup","score","status","plannedEntry","plannedSL","plannedTP","entry","stop","target","filledAt","exit","closedAt","rr","risk","feeBps","slippageBps","netR","note"];
    const csv=[keys.join(","),...S.records.map(r=>keys.map(k=>`"${String(r[k]??"").replace(/"/g,'""')}"`).join(","))].join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="mkayfx_blackbook_x3_paper.csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  // ---------- Tape, footprint, quote walls ----------
  function drawBook(id,levels,color){
    const max=Math.max(.00001,...levels.map(x=>x.q));
    $(id).innerHTML=levels.length?levels.slice(0,15).map(x=>`<div class="book-row" style="--fill:${fmt(100*x.q/max,1)}%;--bar:${color}"><b>${fmt(x.p)}</b><em>${fmt(x.q,4)}</em></div>`).join(""):'<p class="empty">No book snapshot</p>';
  }
  function drawTape(){
    $("tradeMeta").textContent=`${S.liveTotal} LIVE EVENTS`;
    $("tape").innerHTML=S.trades.length?S.trades.slice(0,55).map(t=>`<div class="trade-row"><span>${tm(t.at)}</span><b class="${t.buy===null?"":t.buy?"buy":"sell"}">${t.buy===null?"?":t.buy?"BUY":"SELL"}${t.live?"":"·"}</b><span>${fmt(t.price)}</span><span>${short(t.notional)}</span></div>`).join(""):'<p class="empty">Waiting for real exchange executions...</p>';
  }
  function drawFootprint(){
    const data=S.trades.filter(t=>t.buy!==null&&t.at>=Date.now()-180000),m=new Map();
    for(const t of data){const k=Math.floor(t.price/S.settings.bucket)*S.settings.bucket;const v=m.get(k)||{buy:0,sell:0};v[t.buy?"buy":"sell"]+=t.qty;m.set(k,v);}
    const rows=[...m].sort((a,b)=>(b[1].buy+b[1].sell)-(a[1].buy+a[1].sell)).slice(0,16).sort((a,b)=>b[0]-a[0]);
    $("footprint").innerHTML=rows.length?rows.map(([p,v])=>`<div class="foot-row"><span>${fmt(p)}</span><span class="sell">${fmt(v.sell,3)}</span><span class="buy">${fmt(v.buy,3)}</span><span class="${v.buy>=v.sell?"buy":"sell"}">${signed(v.buy-v.sell,3)}</span></div>`).join(""):'<p class="empty">Waiting for observed executed trades...</p>';
  }
  function drawWalls(){
    const frames=S.heat.slice(-12);
    if(frames.length<4){$("walls").innerHTML='<p class="empty">Collecting at least four snapshots...</p>';return;}
    const m=new Map(),bucket=S.settings.bucket;
    for(const f of frames)for(const side of ["bids","asks"]) {
      const summed=new Map();for(const x of f[side]){const k=Math.floor(x.p/bucket)*bucket;summed.set(k,(summed.get(k)||0)+x.q);}
      for(const [p,q] of summed){const id=side+":"+p;const v=m.get(id)||{p,side,hits:0,total:0,max:0};v.hits++;v.total+=q;v.max=Math.max(v.max,q);m.set(id,v);}
    }
    const current=[...S.book.bids,...S.book.asks].map(x=>x.q).sort((a,b)=>a-b);
    const median=current.length?current[Math.floor(current.length/2)]:0;
    const walls=[...m.values()].filter(v=>v.hits>=4&&v.total/v.hits>=median*1.8).sort((a,b)=>(b.total/b.hits)-(a.total/a.hits)).slice(0,6);
    $("walls").innerHTML=walls.length?walls.map(v=>`<div class="wall"><div><strong class="${v.side==="bids"?"buy":"sell"}">${v.side==="bids"?"BID":"ASK"} WALL · ${fmt(v.p)}</strong><small>Visible in ${v.hits}/${frames.length} recent samples</small></div><em>AVG ${fmt(v.total/v.hits,4)} PAXG<br>MAX ${fmt(v.max,4)}</em></div>`).join(""):'<p class="empty">No unusually persistent top-20 wall observed.</p>';
  }
  // ---------- Canvas chart / heatmap ----------
  function prepareCanvas(id){const el=$(id),r=el.getBoundingClientRect();if(r.width<3||r.height<3)return null;const dpr=Math.min(devicePixelRatio||1,2);el.width=Math.round(r.width*dpr);el.height=Math.round(r.height*dpr);const ctx=el.getContext("2d");ctx.scale(dpr,dpr);return {ctx,w:r.width,h:r.height};}
  function noCanvas(g,msg){g.ctx.font="12px system-ui";g.ctx.fillStyle="#8ca3bd";g.ctx.textAlign="center";g.ctx.fillText(msg,g.w/2,g.h/2);g.ctx.textAlign="left";}
  function drawCandles(){
    const g=prepareCanvas("candles");if(!g)return;const {ctx,w,h}=g,bars=S.bars.slice(-70);if(!bars.length)return noCanvas(g,"Loading Binance one-minute candles...");
    const L=12,R=68,T=15,B=29,W=w-L-R,H=h-T-B;
    let low=Math.min(...bars.map(x=>x.l)),high=Math.max(...bars.map(x=>x.h));const pad=Math.max(.05,(high-low)*.11);low-=pad;high+=pad;
    const y=p=>T+(high-p)/(high-low)*H;
    ctx.font="10px system-ui";ctx.fillStyle="#8da4c0";
    for(let i=0;i<=4;i++){const yy=T+H*i/4;ctx.strokeStyle="#263a51";ctx.beginPath();ctx.moveTo(L,yy);ctx.lineTo(w-R,yy);ctx.stroke();ctx.fillText(fmt(high-(high-low)*i/4),w-R+6,yy+3);}
    const cw=W/bars.length;
    bars.forEach((b,i)=>{const x=L+(i+.5)*cw;ctx.fillStyle=ctx.strokeStyle=b.c>=b.o?"#3de2ad":"#fa6a83";ctx.beginPath();ctx.moveTo(x,y(b.h));ctx.lineTo(x,y(b.l));ctx.stroke();ctx.fillRect(x-Math.max(1,cw*.31),Math.min(y(b.o),y(b.c)),Math.max(2,cw*.62),Math.max(1,Math.abs(y(b.c)-y(b.o))));});
    const active=currentPaper();const lines=active?[[active.entry??active.plannedEntry,"#70c4ff","ENTRY"],[active.stop??active.plannedSL,"#fa6c86","SL"],[active.target??active.plannedTP,"#35dfaa","TP"]]:[[S.price,"#70c4ff","LAST"]];
    for(const [p,color,label] of lines){if(!good(p)||p>high||p<low)continue;ctx.save();ctx.setLineDash([4,4]);ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(L,y(p));ctx.lineTo(w-R,y(p));ctx.stroke();ctx.restore();ctx.fillStyle=color;ctx.fillText(label,w-R-35,y(p)-3);}
    ctx.fillStyle="#90a7c2";for(const i of [0,Math.floor((bars.length-1)/2),bars.length-1])ctx.fillText(new Date(bars[i].t).toLocaleTimeString("en-GB",{timeZone:"Africa/Johannesburg",hour:"2-digit",minute:"2-digit"}),L+cw*i,h-5);
  }
  function drawHeat(){
    const g=prepareCanvas("heatmap");if(!g)return;const {ctx,w,h}=g,frames=S.heat;if(!frames.length)return noCanvas(g,"Collecting top-20 visible depth snapshots...");
    const f=frames.at(-1),bucket=S.settings.bucket,center=Math.round(((f.bids[0].p+f.asks[0].p)/2)/bucket),rows=26;
    const L=12,R=73,T=12,B=25,W=w-L-R,H=h-T-B,cw=W/frames.length,rh=H/rows;
    const maps=frames.map(frame=>{const m=new Map();for(const side of ["bids","asks"])for(const x of frame[side]){const p=Math.floor(x.p/bucket+1e-8),v=m.get(p)||{bid:0,ask:0};v[side==="bids"?"bid":"ask"]+=x.q;m.set(p,v);}return m;});
    let max=0;for(const m of maps)for(let row=0;row<rows;row++){const v=m.get(center+Math.floor(rows/2)-row);if(v)max=Math.max(max,v.bid,v.ask);}
    ctx.fillStyle="#0d1b2c";ctx.fillRect(L,T,W,H);
    maps.forEach((m,col)=>{for(let row=0;row<rows;row++){const v=m.get(center+Math.floor(rows/2)-row);if(!v||!max)continue;const buy=v.bid>=v.ask,q=Math.max(v.bid,v.ask),a=clamp(.1+.82*Math.sqrt(q/max),.1,.94);ctx.fillStyle=buy?`rgba(45,222,168,${a})`:`rgba(250,95,125,${a})`;ctx.fillRect(L+col*cw,T+row*rh,Math.max(1,cw+.35),Math.max(1,rh-.4));}});
    // Explicitly mark gaps between persisted snapshots and new sessions.
    for(let col=1;col<frames.length;col++)if(frames[col].at-frames[col-1].at>10000){
      const x=L+col*cw;ctx.strokeStyle="#e9effa";ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(x,T);ctx.lineTo(x,T+H);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.font="10px system-ui";ctx.fillStyle="#98aec8";
    for(let r=0;r<rows;r+=4){const py=T+r*rh;ctx.strokeStyle="#253950";ctx.beginPath();ctx.moveTo(L,py);ctx.lineTo(L+W,py);ctx.stroke();ctx.fillText(fmt((center+Math.floor(rows/2)-r)*bucket),L+W+5,py+8);}
    ctx.fillText("OLDER",L+3,h-4);ctx.fillText("LATEST",L+W-39,h-4);
  }
  // ---------- UI refresh ----------
  function render(){
    $("price").textContent=fmt(S.price);$("priceMeta").textContent=S.ticker&&Number.isFinite(+S.ticker.priceChangePercent)?`${signed(+S.ticker.priceChangePercent,2)}% · 24h PAXG change`:"Latest observed PAXG/USDT price";
    const b=S.book.bids,a=S.book.asks;$("spread").textContent=b.length&&a.length?fmt(a[0].p-b[0].p):"—";
    $("imbalance").textContent=Number.isFinite(bookStats())?fmt(bookStats()*100,1)+"%":"—";
    $("cvd").textContent=S.liveTotal?signed(S.cvd,4):"—";$("cvd").className=S.cvd>0?"positive":S.cvd<0?"negative":"";
    const recent=S.trades.filter(t=>t.live&&t.at>=Date.now()-60000);$("volume60").textContent=S.liveTotal?short(recent.reduce((a,t)=>a+t.notional,0)):"—";
    $("depthMeta").textContent=S.lastDepth?tm(S.lastDepth)+" SAST":"WAITING";$("heatMeta").textContent=`${S.heat.length} RECENT SAMPLES`;
    $("candleMeta").textContent=`${S.bars.filter(x=>x.closed).length} CLOSED M1`;
    drawBook("bids",b,"#35dfaa");drawBook("asks",a,"#fa6c86");drawTape();drawFootprint();drawWalls();drawCandles();drawHeat();renderSignal();
  }
  function init(){
    restore();
    const settings={minScore:"minScore",rr:"rr",fee:"fee",slippage:"slippage",bucket:"bucket"};
    for(const [k,id] of Object.entries(settings)){
      $(id).value=String(S.settings[k]);$(id).addEventListener("change",e=>{
        const raw=+e.target.value;if(!Number.isFinite(raw))return;
        S.settings[k]=k==="minScore"?clamp(raw,70,85):k==="rr"?clamp(raw,1.5,3):k==="bucket"?([.5,1,2,5].includes(raw)?raw:1):clamp(raw,0,100);
        e.target.value=String(S.settings[k]);save();evaluate();scheduleRender();
      });
    }
    $("reconnect").addEventListener("click",()=>{recordEvent("Manual reconnect","Refreshing snapshot and live connection");restart();});
    $("alerts").addEventListener("click",()=>{S.alerts=!S.alerts;$("alerts").textContent=S.alerts?"ALERTS ON":"ENABLE ALERTS";toast(S.alerts?"In-page alerts enabled":"Alerts disabled");});
    $("clearEvents").addEventListener("click",()=>{S.events=[];renderEvents();});
    $("export").addEventListener("click",exportCSV);
    $("clearPaper").addEventListener("click",()=>{
      if(!confirm("Permanently clear this browser's BLACKBOOK X3 paper records? Export CSV first if needed."))return;
      S.records=[];save();renderPaper();evaluate();recordEvent("Paper journal cleared","This browser's local paper records were reset","warn");
    });
    window.addEventListener("resize",scheduleRender);
    document.addEventListener("visibilitychange",()=>{
      if(document.hidden){paused=true;interruptPaper("App went into background; market event sequence may have gaps");disconnect();}
      else {restart();fetchXau();}
    });
    window.addEventListener("pageshow",()=>{if(!document.hidden&&paused)restart();});
    setInterval(()=>{
      $("clock").textContent=`${tm(Date.now())} SAST`;
      if(paused)return;
      updateConnection();periodicPaper();evaluate();scheduleRender();
      if(ws&&ws.readyState===WebSocket.OPEN&&Date.now()-S.lastFrame>35000)ws.close();
      if(S.heat.length&&Date.now()-S.lastSavedAt>15000){S.lastSavedAt=Date.now();save();}
    },4000);
    setInterval(fetchXau,90000);
    renderEvents();renderPaper();render();
    recordEvent("BLACKBOOK X3 initialized","PAXG spot public order flow + browser-local paper lab");
    fetchMarket(true);connect();fetchXau();
  }
  init();
})();
