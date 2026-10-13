/* BLACKBOOK X4
   Browser interface + Binance PAXG flow
   + local paper journal.
*/

"use strict";

const $ = id => document.getElementById(id);

const money = x =>
  Number.isFinite(Number(x))
    ? Number(x).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    : "—";

const short = x =>
  Number.isFinite(Number(x))
    ? Number(x).toLocaleString("en-US", {
        maximumFractionDigits: 0
      })
    : "—";

const clock = t =>
  new Date(t).toLocaleTimeString("en-GB", {
    timeZone: "Africa/Johannesburg",
    hour12: false
  });

const safe = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );

const clamp = (x, a, b) =>
  Math.max(a, Math.min(b, x));

let gold = null;
let testing = null;
let refreshing = false;
let ws = null;
let retry = 0;
let wsTimer = null;

const paxg = {
  connected: false,
  lastAt: 0,
  price: null,
  depth: null,
  depthAt: 0,
  candles: [],
  tape: [],
  seen: new Set(),
  buy: 0,
  sell: 0,
  history: [],
  events: [],
  footprint: new Map()
};

// Restore recent depth history.

try {
  const old = JSON.parse(
    localStorage.getItem("blackbookX4Depth") || "[]"
  );

  if (Array.isArray(old)) {
    paxg.history = old
      .filter(x => Date.now() - x.t < 3600000)
      .slice(-95);
  }
} catch {}

let journal = [];

try {
  journal = JSON.parse(
    localStorage.getItem("blackbookX4Journal") || "[]"
  );

  if (!Array.isArray(journal)) {
    journal = [];
  }
} catch {
  journal = [];
}

function save() {
  try {
    localStorage.setItem(
      "blackbookX4Journal",
      JSON.stringify(journal.slice(0, 150))
    );
  } catch {
    showNotice(
      "Local storage unavailable; journal may not persist."
    );
  }
}

function showNotice(msg) {
  $("notification").textContent = msg;
  $("notification").classList.toggle("hidden", !msg);
}

function state(id, ok) {
  $(id).classList.toggle("good", ok);
  $(id).classList.toggle("bad", !ok);
}

function showStatus() {
  const good = !!gold?.fresh;

  state("sideXauDot", good);
  state("mainDot", good);

  state(
    "sidePaxgDot",
    paxg.connected &&
    Date.now() - paxg.lastAt < 15000
  );

  $("sideXauState").textContent =
    good ? "ONLINE" : "STALE";

  $("sidePaxgState").textContent =
    paxg.connected ? "STREAM" : "OFFLINE";

  $("systemStatus").textContent =
    good ? "XAU ONLINE" : "XAU STALE";

  $("depthStatus").textContent =
    paxg.connected
      ? "LIVE SNAPSHOTS"
      : "REST / DISCONNECTED";
}

function drawClock() {
  $("clock").textContent =
    clock(Date.now()) + " SAST";

  showStatus();
}

function renderGold() {
  if (!gold) return;

  $("price").textContent = money(gold.price);

  $("asof").textContent =
    "Last update " +
    clock(gold.asOf) +
    " SAST · " +
    gold.metadata.feedType;

  $("regime").textContent =
    gold.trend.M5.direction;

  $("regime").className =
    gold.trend.M5.direction === "BULLISH"
      ? "positive"
      : gold.trend.M5.direction === "BEARISH"
      ? "negative"
      : "";

  $("atr").textContent =
    money(gold.atr);

  $("zoneCount").textContent =
    String(gold.zones.length);

  $("chartAge").textContent =
    "M1 age " +
    gold.metadata.dataAgeSeconds +
    "s";

  const s = gold.signal;
  const side = s?.side || "WAIT";

  $("signalMini").textContent = side;
  $("decision").textContent = side;

  $("decision").className =
    "decision " + side.toLowerCase();

  $("signalOrb").textContent =
    side === "BUY"
      ? "↗"
      : side === "SELL"
      ? "↘"
      : "◇";

  $("signalTag").textContent =
    s
      ? `SCORE ${s.score} / 100`
      : "NO CONFIRMED ENTRY";

  $("signalReason").textContent =
    gold.reason;

  $("signalScore").textContent =
    s
      ? s.score + " / 100"
      : "— / 100";

  $("scoreFill").style.width =
    (s?.score || 0) + "%";

  for (
    const [id, val] of Object.entries({
      entry: s?.entry,
      stop: s?.stop,
      tp1: s?.tp1,
      tp2: s?.tp2
    })
  ) {
    $(id).textContent =
      val == null ? "—" : money(val);
  }

  $("paperButton").disabled =
    !gold.fresh ||
    !s ||
    Date.now() > Date.parse(s.expiresAt) ||
    journal.some(x => x.signalId === s.id);

  $("paperButton").textContent =
    journal.some(x => x.signalId === s?.id)
      ? "SIGNAL ALREADY RECORDED"
      : "ADD CONFIRMED SIGNAL TO PAPER JOURNAL";

  $("trendRows").innerHTML =
    ["M5", "M15", "H1", "H4"]
      .map(tf => {
        const t = gold.trend[tf];

        return `
         <div class="trend-row">
          <b>${tf}</b>
          <span>${safe(t.direction)}</span>

          <strong class="${
            t.direction === "BULLISH"
              ? "positive"
              : t.direction === "BEARISH"
              ? "negative"
              : ""
          }">
           ${t.strength}%
          </strong>
         </div>`;
      })
      .join("");

  $("sessionRows").innerHTML =
    gold.sessions.length
      ? gold.sessions.map(s => `
        <div class="list-row">
         <span>${safe(s.name)}</span>
         <strong>
          ${money(s.low)} — ${money(s.high)}
         </strong>
        </div>
      `).join("")
      : '<div class="placeholder">Session ranges not available</div>';

  $("healthRows").innerHTML =
    gold.health.map(h => `
      <div class="list-row">
       <span>
        ${h.timeframe} · ${safe(h.status)}
       </span>

       <strong>
        ${h.lastBar ? clock(h.lastBar) : "—"}
       </strong>
      </div>
    `).join("");

  $("zoneRows").innerHTML =
    gold.zones.length
      ? gold.zones.map(z => `
        <div class="zone-row">

         <span class="zone-side ${z.type.toLowerCase()}">
          ${z.type}
         </span>

         <div>
          <b>${money(z.price)}</b>

          <small>
           ${safe(z.source)} ·
           ${z.touches} cluster hits ·
           Δ${money(z.distance)}
          </small>
         </div>

         <span class="zone-score">
          ${z.score}
         </span>

        </div>
      `).join("")
      : '<div class="placeholder">No zones meet the ≥70 score filter</div>';

  $("chartEmpty").classList.toggle(
    "hidden",
    gold.candles.length > 0
  );

  $("zoneEmpty").classList.toggle(
    "hidden",
    gold.zones.length > 0
  );

  drawPrice();
  drawZones();
  renderBacktest();
  renderJournal();
}

async function loadGold(params = "") {
  if (refreshing) return;

  refreshing = true;

  $("refresh").textContent = "◌";

  try {
    const response = await fetch(
      "/api/xau" + params,
      { cache: "no-store" }
    );

    const j = await response.json();

    if (!response.ok) {
      throw new Error(
        j.error || "XAU provider request failed"
      );
    }

    gold = j;
    testing = j.backtest;

    showNotice(
      !j.fresh
        ? "Gold feed is stale or the market is closed. Signals are blocked."
        : ""
    );

    renderGold();
    updatePaper();

  } catch (e) {
    gold = null;

    showNotice(
      "Gold engine: " + e.message
    );

    $("decision").textContent = "OFFLINE";

    $("signalReason").textContent =
      "Check your Twelve Data API keys and Vercel function logs";

    $("paperButton").disabled = true;

  } finally {
    refreshing = false;

    $("refresh").textContent = "↻";

    showStatus();
  }
}

function prepareCanvas(id) {
  const c = $(id);

  const r = c.getBoundingClientRect();

  const w = Math.max(200, r.width);
  const h = Math.max(120, r.height);

  const d = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  const ctx = c.getContext("2d");

  c.width = Math.round(w * d);
  c.height = Math.round(h * d);

  ctx.setTransform(d, 0, 0, d, 0, 0);

  ctx.clearRect(0, 0, w, h);

  return { ctx, w, h };
}

function grid(
  ctx,
  w,
  h,
  x0 = 15,
  y0 = 15,
  x1 = w - 55,
  y1 = h - 25
) {
  ctx.strokeStyle =
    "rgba(151,192,220,.085)";

  ctx.lineWidth = 1;

  for (let i = 0; i <= 5; i++) {
    const y =
      y0 + (y1 - y0) * i / 5;

    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
}

function drawPrice() {
  if (!gold?.candles?.length) return;

  const { ctx, w, h } =
    prepareCanvas("priceChart");

  const a = gold.candles.slice(-100);

  const min = Math.min(
    ...a.map(x => x.l)
  );

  const max = Math.max(
    ...a.map(x => x.h)
  );

  const pad =
    (max - min) * .13 || 1;

  const low = min - pad;
  const high = max + pad;

  const x0 = 14;
  const x1 = w - 65;
  const top = 18;
  const bottom = h - 27;

  const y = v =>
    bottom -
    (v - low) /
    (high - low) *
    (bottom - top);

  const cw =
    (x1 - x0) / a.length;

  grid(
    ctx,
    w,
    h,
    x0,
    top,
    x1,
    bottom
  );

  ctx.font = "10px monospace";

  for (let i = 0; i <= 5; i++) {
    const p =
      high - (high - low) * i / 5;

    ctx.fillStyle = "#738fa9";

    ctx.fillText(
      money(p),
      x1 + 7,
      top + (bottom - top) * i / 5 + 4
    );
  }

  gold.zones
    .filter(z =>
      z.price > low &&
      z.price < high
    )
    .slice(0, 8)
    .forEach(z => {
      const cy = y(z.price);

      const color =
        z.type === "SSL"
          ? "80,239,218"
          : "239,103,189";

      ctx.fillStyle =
        `rgba(${color},.065)`;

      ctx.fillRect(
        x0,
        cy - 4,
        x1 - x0,
        8
      );

      ctx.strokeStyle =
        `rgba(${color},.54)`;

      ctx.setLineDash([5, 5]);

      ctx.beginPath();
      ctx.moveTo(x0, cy);
      ctx.lineTo(x1, cy);
      ctx.stroke();

      ctx.setLineDash([]);
    });

  a.forEach((b, i) => {
    const x =
      x0 + cw * (i + .5);

    const up =
      b.c >= b.o;

    ctx.strokeStyle = up
      ? "#50efda"
      : "#ff748e";

    ctx.fillStyle = up
      ? "#2fc4b1"
      : "#c34f79";

    ctx.beginPath();

    ctx.moveTo(
      x,
      y(b.h)
    );

    ctx.lineTo(
      x,
      y(b.l)
    );

    ctx.stroke();

    ctx.fillRect(
      x - Math.max(1, cw * .26),
      Math.min(y(b.o), y(b.c)),
      Math.max(2, cw * .53),
      Math.max(1, Math.abs(
        y(b.o) - y(b.c)
      ))
    );
  });

  const py = y(gold.price);

  if (
    py > top &&
    py < bottom
  ) {
    ctx.strokeStyle =
      "rgba(255,209,138,.85)";

    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.moveTo(x0, py);
    ctx.lineTo(x1, py);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.fillStyle = "#ffd18a";

    ctx.fillText(
      money(gold.price),
      x1 + 7,
      py - 5
    );
  }

  ctx.fillStyle = "#6d88a2";
  ctx.font = "10px sans-serif";

  ctx.fillText(
    clock(a[0].t),
    x0,
    h - 8
  );

  ctx.fillText(
    clock(a.at(-1).t),
    x1 - 65,
    h - 8
  );
}

function drawZones() {
  if (!gold?.zones?.length) return;

  const { ctx, w, h } =
    prepareCanvas("zoneCanvas");

  const zones = gold.zones;

  const vals =
    zones.map(x => x.price);

  const mid = gold.price;

  const range =
    Math.max(
      ...vals.map(v =>
        Math.abs(v - mid)
      ),
      gold.atr * 4,
      2
    ) * 1.22;

  const high = mid + range;
  const low = mid - range;

  const y = p =>
    h - 22 -
    (p - low) /
    (high - low) *
    (h - 42);

  grid(
    ctx,
    w,
    h,
    18,
    15,
    w - 80,
    h - 22
  );

  zones.forEach(z => {
    const cy = y(z.price);

    if (
      cy < 15 ||
      cy > h - 22
    ) {
      return;
    }

    const tint =
      z.type === "SSL"
        ? "80,239,218"
        : "239,103,189";

    const opacity =
      z.score / 100 * .36;

    const gr =
      ctx.createLinearGradient(
        18,
        0,
        w - 85,
        0
      );

    gr.addColorStop(
      0,
      `rgba(${tint},.01)`
    );

    gr.addColorStop(
      .55,
      `rgba(${tint},${opacity})`
    );

    gr.addColorStop(
      1,
      `rgba(${tint},.025)`
    );

    ctx.fillStyle = gr;

    ctx.fillRect(
      18,
      cy - 6 - (z.score - 70) / 5,
      w - 104,
      12 + (z.score - 70) / 2.5
    );

    ctx.strokeStyle =
      `rgba(${tint},.6)`;

    ctx.beginPath();
    ctx.moveTo(18, cy);
    ctx.lineTo(w - 85, cy);
    ctx.stroke();

    ctx.fillStyle =
      z.type === "SSL"
        ? "#50efda"
        : "#ef67bd";

    ctx.font =
      "bold 10px monospace";

    ctx.fillText(
      money(z.price),
      w - 78,
      cy + 3
    );
  });

  const cy = y(mid);

  ctx.strokeStyle = "#ffd18a";
  ctx.setLineDash([4, 3]);

  ctx.beginPath();
  ctx.moveTo(18, cy);
  ctx.lineTo(w - 85, cy);
  ctx.stroke();

  ctx.setLineDash([]);

  ctx.fillStyle = "#ffd18a";
  ctx.fillText(
    "NOW",
    20,
    cy - 7
  );
}

function renderBacktest() {
  if (!testing) return;

  if (testing.error) {
    $("testNote").textContent =
      testing.error;

    return;
  }

  const b = testing.all;

  for (
    const [id, val] of Object.entries({
      testTrades: b.trades,
      testWin: b.winRate + "%",
      testPf:
        b.pf === null ? "∞" : b.pf,
      testR: b.totalR + "R",
      testDD: b.maxDdR + "R"
    })
  ) {
    $(id).textContent =
      String(val);
  }

  $("testR").className =
    b.totalR >= 0
      ? "positive"
      : "negative";

  $("devResult").textContent =
    testing.development.totalR +
    "R / " +
    testing.development.trades +
    " trades";

  $("valResult").textContent =
    testing.validation.totalR +
    "R / " +
    testing.validation.trades +
    " trades";

  $("valResult").className =
    testing.validation.totalR > 0
      ? "positive"
      : "negative";

  $("sampleRange").textContent =
    testing.history.bars +
    " M5 bars";

  $("testNote").textContent =
    testing.disclaimer;

  drawEquity();
}

function drawEquity() {
  if (!testing?.all?.equity) return;

  const { ctx, w, h } =
    prepareCanvas("equityChart");

  const v =
    testing.all.equity;

  const lo =
    Math.min(0, ...v);

  const hi =
    Math.max(0, ...v);

  const pad =
    Math.max(1, (hi - lo) * .15);

  const y = x =>
    h - 23 -
    (x - (lo - pad)) /
    (hi - lo + 2 * pad) *
    (h - 42);

  const x = i =>
    20 +
    i / (v.length - 1 || 1) *
    (w - 42);

  grid(
    ctx,
    w,
    h,
    20,
    16,
    w - 20,
    h - 23
  );

  ctx.beginPath();

  ctx.moveTo(
    x(0),
    y(v[0])
  );

  v.forEach((p, i) =>
    ctx.lineTo(
      x(i),
      y(p)
    )
  );

  ctx.strokeStyle =
    v.at(-1) >= 0
      ? "#50efda"
      : "#ff748e";

  ctx.lineWidth = 2.3;

  ctx.shadowBlur = 14;
  ctx.shadowColor = ctx.strokeStyle;

  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#829ab1";
  ctx.font = "10px monospace";

  ctx.fillText(
    "CUMULATIVE NET R · HISTORICAL",
    20,
    18
  );

  ctx.fillText(
    v.at(-1) + "R",
    w - 75,
    20
  );
}

async function runTest() {
  $("runBacktest").disabled = true;

  $("runBacktest").textContent =
    "RUNNING...";

  const q = new URLSearchParams({
    threshold: $("threshold").value,
    rr: $("rr").value,
    cost: $("cost").value
  });

  await loadGold("?" + q);

  $("runBacktest").disabled = false;

  $("runBacktest").textContent =
    "RUN HISTORICAL TEST ↗";
}

function addEvent(label, detail) {
  paxg.events.unshift({
    t: Date.now(),
    label,
    detail
  });

  paxg.events =
    paxg.events.slice(0, 32);

  $("events").innerHTML =
    paxg.events
      .slice(0, 9)
      .map(x => `
       <div class="event-row">
        <strong>${safe(x.label)}</strong>
        ${safe(x.detail)}
        <small>· ${clock(x.t)}</small>
       </div>
      `)
      .join("");
}

function addTrade(t, count = true) {
  if (
    !Number.isFinite(t.p) ||
    !Number.isFinite(t.q) ||
    !t.id
  ) {
    return;
  }

  if (paxg.seen.has(t.id)) {
    return;
  }

  paxg.seen.add(t.id);

  if (paxg.seen.size > 3000) {
    paxg.seen = new Set(
      [...paxg.seen].slice(-2000)
    );
  }

  paxg.tape.unshift(t);

  paxg.tape =
    paxg.tape.slice(0, 110);

  paxg.price = t.p;

  if (count) {
    const notion = t.p * t.q;

    if (t.side === "BUY") {
      paxg.buy += notion;
    } else {
      paxg.sell += notion;
    }

    const bucket =
      (Math.round(t.p / 2) * 2).toFixed(2);

    const item =
      paxg.footprint.get(bucket) || {
        buy: 0,
        sell: 0
      };

    item[t.side.toLowerCase()] += notion;

    paxg.footprint.set(
      bucket,
      item
    );

    if (paxg.footprint.size > 80) {
      paxg.footprint.delete(
        paxg.footprint.keys().next().value
      );
    }

    if (notion > 15000) {
      addEvent(
        "LARGE PAXG MARKET " + t.side,
        "Observed trade value " +
        money(notion) +
        " USDT"
      );
    }
  }
}

function setDepth(v) {
  if (!v?.bids || !v?.asks) {
    return;
  }

  const before = paxg.depth;

  paxg.depth = {
    bids: v.bids.map(
      ([p, q]) => [+p, +q]
    ),

    asks: v.asks.map(
      ([p, q]) => [+p, +q]
    )
  };

  paxg.depthAt = Date.now();

  if (
    paxg.depthAt -
    (paxg.history.at(-1)?.t || 0) >
    1200
  ) {
    paxg.history.push({
      t: paxg.depthAt,
      bids: paxg.depth.bids,
      asks: paxg.depth.asks
    });

    paxg.history =
      paxg.history.slice(-95);

    if (
      !paxg.savedDepthAt ||
      Date.now() - paxg.savedDepthAt > 5000
    ) {
      paxg.savedDepthAt = Date.now();

      try {
        localStorage.setItem(
          "blackbookX4Depth",
          JSON.stringify(paxg.history)
        );
      } catch {}
    }
  }

  if (before) {
    const v0 = before.bids.reduce(
      (s, x) => s + x[1],
      0
    );

    const v1 = paxg.depth.bids.reduce(
      (s, x) => s + x[1],
      0
    );

    if (
      v0 > 0 &&
      Math.abs(v1 / v0 - 1) > .5 &&
      Date.now() -
      (paxg.lastEventAt || 0) >
      30000
    ) {
      paxg.lastEventAt = Date.now();

      addEvent(
        "VISIBLE DEPTH SHIFT",
        "PAXG top-20 bid quantity changed " +
        Math.round((v1 / v0 - 1) * 100) +
        "%"
      );
    }
  }
}

function renderPaxg() {
  if (paxg.price !== null) {
    $("paxgPrice").textContent =
      money(paxg.price);
  }

  $("buyVolume").textContent =
    short(paxg.buy);

  $("sellVolume").textContent =
    short(paxg.sell);

  const net =
    paxg.buy - paxg.sell;

  $("cvd").textContent =
    (net >= 0 ? "+" : "") +
    short(net);

  $("cvd").className =
    net >= 0
      ? "positive"
      : "negative";

  if (paxg.depth) {
    const bids = paxg.depth.bids
      .slice()
      .sort((a, b) => b[0] - a[0]);

    const asks = paxg.depth.asks
      .slice()
      .sort((a, b) => a[0] - b[0]);

    const mx = Math.max(
      1,
      ...[...bids, ...asks].map(
        x => x[1]
      )
    );

    $("ladder").innerHTML = [
      ...asks.slice(0, 10).reverse().map(
        ([p, q]) => `
        <div class="ladder-row ask"
         style="--w:${q / mx * 100}%">

         <span>ASK</span>
         <strong>${money(p)}</strong>
         <span>${q.toFixed(4)}</span>
        </div>`
      ),

      ...bids.slice(0, 10).map(
        ([p, q]) => `
        <div class="ladder-row bid"
         style="--w:${q / mx * 100}%">

         <span>BID</span>
         <strong>${money(p)}</strong>
         <span>${q.toFixed(4)}</span>
        </div>`
      )
    ].join("");
  }

  $("tape").innerHTML =
    paxg.tape
      .slice(0, 22)
      .map(t => `
      <div class="tape-row">

       <span>${clock(t.t)}</span>

       <strong class="${
         t.side === "BUY"
           ? "positive"
           : "negative"
       }">
        ${money(t.p)}
       </strong>

       <b>${t.q.toFixed(4)}</b>

      </div>
      `)
      .join("") ||
    '<div class="placeholder">No observed trades</div>';

  const items =
    [...paxg.footprint]
      .sort((a, b) => +b[0] - +a[0])
      .slice(0, 22);

  const mx = Math.max(
    1,
    ...items.flatMap(
      x => [
        x[1].buy,
        x[1].sell
      ]
    )
  );

  $("footprint").innerHTML =
    items.length
      ? items.map(([p, v]) => `
        <div class="fp-row">

         <div class="fp-track sell">
          <i style="width:${v.sell / mx * 100}%"></i>
         </div>

         <b>${p}</b>

         <div class="fp-track">
          <i style="width:${v.buy / mx * 100}%"></i>
         </div>

        </div>
      `).join("")
      : '<div class="placeholder">Collecting observed trades...</div>';

  drawDepth();
  showStatus();
}

function drawDepth() {
  if (!paxg.history.length) {
    return;
  }

  const { ctx, w, h } =
    prepareCanvas("depthCanvas");

  const s =
    paxg.history.slice(-75);

  const prices = s.flatMap(x =>
    [...x.bids, ...x.asks].map(
      z => z[0]
    )
  );

  if (!prices.length) return;

  const low = Math.min(...prices);
  const high = Math.max(...prices);

  if (high <= low) return;

  const all = s.flatMap(x =>
    [...x.bids, ...x.asks].map(
      z => z[1]
    )
  );

  const max = Math.max(
    1,
    ...all
  );

  const x0 = 10;
  const x1 = w - 65;
  const top = 15;
  const bottom = h - 27;

  const cw =
    (x1 - x0) / s.length;

  const rows = 36;
  const dy =
    (bottom - top) / rows;

  grid(
    ctx,
    w,
    h,
    x0,
    top,
    x1,
    bottom
  );

  s.forEach((ss, i) => {
    for (
      const side of ["bids", "asks"]
    ) {
      for (
        const [p, q] of ss[side]
      ) {
        const row = clamp(
          Math.floor(
            (high - p) /
            (high - low) *
            rows
          ),
          0,
          rows - 1
        );

        const intensity =
          Math.sqrt(q / max);

        const col =
          side === "bids"
            ? "80,239,218"
            : "239,103,189";

        ctx.fillStyle =
          `rgba(${col},${.12 + intensity * .8})`;

        ctx.fillRect(
          x0 + i * cw,
          top + row * dy,
          Math.max(cw + 1, 2),
          Math.max(dy + 1, 2)
        );
      }
    }
  });

  ctx.fillStyle = "#829cb2";
  ctx.font = "10px monospace";

  for (let i = 0; i <= 5; i++) {
    ctx.fillText(
      money(
        high - (high - low) * i / 5
      ),
      x1 + 5,
      top + (bottom - top) * i / 5 + 4
    );
  }

  ctx.fillText(
    "PAXG VISIBLE BOOK HISTORY",
    x0,
    h - 7
  );
}

async function loadPaxgRest() {
  try {
    const r = await fetch(
      "/api/market",
      { cache: "no-store" }
    );

    const data = await r.json();

    if (!r.ok) {
      throw new Error(data.error);
    }

    if (data.depth) {
      setDepth(data.depth);
    }

    if (data.trades) {
      for (const t of data.trades) {
        addTrade(t, false);
      }
    }

    if (data.candles) {
      paxg.candles = data.candles;
    }

    renderPaxg();

  } catch (e) {
    if (!paxg.connected) {
      addEvent(
        "PAXG REST UNAVAILABLE",
        String(e.message).slice(0, 100)
      );
    }
  }
}

function connectPaxg() {
  if (
    document.hidden ||
    ws && (
      ws.readyState === 0 ||
      ws.readyState === 1
    )
  ) {
    return;
  }

  clearTimeout(wsTimer);

  try {
    ws = new WebSocket(
      "wss://stream.binance.com:443/stream?streams=" +
      "paxgusdt@trade/" +
      "paxgusdt@depth20@100ms/" +
      "paxgusdt@kline_1m"
    );

    ws.onopen = () => {
      paxg.connected = true;
      paxg.lastAt = Date.now();
      retry = 0;

      addEvent(
        "PAXG STREAM CONNECTED",
        "Actual Binance PAXG token trade/depth events"
      );

      showStatus();
    };

    ws.onmessage = e => {
      try {
        const p =
          JSON.parse(e.data).data;

        if (!p) return;

        paxg.lastAt = Date.now();

        if (p.e === "trade") {
          addTrade({
            id: p.t,
            p: +p.p,
            q: +p.q,
            t: p.T,
            side: p.m ? "SELL" : "BUY"
          });

        } else if (
          p.bids &&
          p.asks
        ) {
          setDepth(p);

        } else if (
          p.e === "kline" &&
          p.k
        ) {
          const c = {
            t: new Date(
              p.k.t
            ).toISOString(),

            o: +p.k.o,
            h: +p.k.h,
            l: +p.k.l,
            c: +p.k.c,
            v: +p.k.v
          };

          const old =
            paxg.candles.findIndex(
              x => x.t === c.t
            );

          if (old >= 0) {
            paxg.candles[old] = c;
          } else {
            paxg.candles.push(c);
          }

          paxg.candles =
            paxg.candles.slice(-80);
        }

        if (
          !paxg.renderAt ||
          Date.now() - paxg.renderAt > 350
        ) {
          paxg.renderAt = Date.now();
          renderPaxg();
        }

      } catch {}
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };

    ws.onclose = () => {
      paxg.connected = false;

      showStatus();

      const delay = Math.min(
        30000,
        1000 * 2 ** Math.min(retry++, 5)
      );

      wsTimer = setTimeout(
        connectPaxg,
        delay
      );
    };

  } catch {
    paxg.connected = false;

    wsTimer = setTimeout(
      connectPaxg,
      15000
    );
  }
}

function paperNew() {
  const s = gold?.signal;

  if (
    !s ||
    !gold?.fresh ||
    Date.now() > Date.parse(s.expiresAt)
  ) {
    return;
  }

  const price = gold.price;

  const dir =
    s.side === "BUY"
      ? 1
      : -1;

  const risk =
    (price - s.stop) * dir;

  if (risk <= 0) {
    showNotice(
      "Entry is already beyond the proposed stop. Trade not recorded."
    );

    return;
  }

  if (
    journal.some(
      x => x.signalId === s.id
    )
  ) {
    return;
  }

  journal.unshift({
    id: String(Date.now()),
    signalId: s.id,

    openedAt: Date.now(),
    lastChecked: Date.now(),

    side: s.side,
    score: s.score,

    entry: price,
    stop: s.stop,

    tp: price + dir * risk * 2,
    risk,

    status: "OPEN",

    r: null,
    exit: null,
    closedAt: null
  });

  journal = journal.slice(0, 150);

  save();
  renderJournal();
  renderGold();
}

function updatePaper() {
  if (!gold?.m1?.length) {
    return;
  }

  const closed =
    gold.m1.filter(
      x =>
        Date.parse(x.t) + 60000 <=
        Date.now() - 3000
    );

  const available = closed[0]
    ? Date.parse(closed[0].t)
    : Infinity;

  let changed = false;

  for (const j of journal) {
    if (j.status !== "OPEN") {
      continue;
    }

    const start =
      Math.ceil(j.openedAt / 60000) *
      60000;

    if (start < available) {
      j.status = "UNVERIFIED";
      changed = true;
      continue;
    }

    const bars = closed.filter(
      x =>
        Date.parse(x.t) >= start &&
        Date.parse(x.t) + 60000 >
          j.lastChecked
    );

    let last = j.lastChecked;

    for (const b of bars) {
      const time = Date.parse(b.t);

      const dir =
        j.side === "BUY"
          ? 1
          : -1;

      const sl = dir === 1
        ? b.l <= j.stop
        : b.h >= j.stop;

      const tp = dir === 1
        ? b.h >= j.tp
        : b.l <= j.tp;

      if (
        last > j.openedAt &&
        time > last + 180000
      ) {
        j.status = "UNVERIFIED";
        changed = true;
        break;
      }

      if (sl || tp) {
        j.exit = sl
          ? j.stop
          : j.tp;

        j.status = sl
          ? "SL"
          : "TP";

        j.closedAt =
          time + 60000;

        j.r = Number(
          (
            (
              (j.exit - j.entry) * dir -
              .35
            ) / j.risk
          ).toFixed(3)
        );

        changed = true;
        break;
      }

      last = time + 60000;
      j.lastChecked = last;
      changed = true;
    }
  }

  if (changed) {
    save();
    renderJournal();
  }
}

function renderJournal() {
  const done = journal.filter(
    j =>
      j.status === "TP" ||
      j.status === "SL"
  );

  const net = done.reduce(
    (s, j) => s + (j.r || 0),
    0
  );

  $("journalCount").textContent =
    journal.length;

  $("journalFinished").textContent =
    done.length;

  $("journalWin").textContent =
    done.length
      ? (
          done.filter(j => j.r > 0).length /
          done.length * 100
        ).toFixed(1) + "%"
      : "—";

  $("journalR").textContent =
    net.toFixed(2) + "R";

  $("journalR").className =
    net >= 0
      ? "positive"
      : "negative";

  $("journalBody").innerHTML =
    journal.length
      ? journal.slice(0, 70).map(j => `
        <tr>

         <td>${clock(j.openedAt)}</td>

         <td class="${
           j.side === "BUY"
             ? "positive"
             : "negative"
         }">
          ${j.side}
         </td>

         <td>${j.score}</td>

         <td>${money(j.entry)}</td>

         <td>
          ${money(j.stop)} /
          ${money(j.tp)}
         </td>

         <td>${j.status}</td>

         <td class="${
           j.r == null
             ? ""
             : j.r >= 0
             ? "positive"
             : "negative"
         }">
          ${j.r == null
            ? "—"
            : j.r + "R"}
         </td>

        </tr>
      `).join("")
      : '<tr><td colspan="7">No paper trades recorded</td></tr>';
}

function exportCsv() {
  const cols = [
    "openedAt",
    "signalId",
    "side",
    "score",
    "entry",
    "stop",
    "tp",
    "status",
    "closedAt",
    "exit",
    "r"
  ];

  const csv = [
    cols.join(","),

    ...journal.map(r =>
      cols.map(k =>
        '"' +
        String(r[k] ?? "").replaceAll('"', '""') +
        '"'
      ).join(",")
    )
  ].join("\n");

  const blob = new Blob(
    [csv],
    { type: "text/csv" }
  );

  const u =
    URL.createObjectURL(blob);

  const a =
    document.createElement("a");

  a.href = u;

  a.download =
    "mkayfx-blackbook-x4-paper-trades.csv";

  a.click();

  setTimeout(
    () => URL.revokeObjectURL(u),
    2000
  );
}

function bootstrap() {
  setInterval(
    drawClock,
    1000
  );

  drawClock();

  $("refresh").onclick =
    () => loadGold();

  $("runBacktest").onclick =
    runTest;

  $("paperButton").onclick =
    paperNew;

  $("exportCsv").onclick =
    exportCsv;

  $("clearJournal").onclick = () => {
    if (
      confirm(
        "Delete this device's BLACKBOOK X4 paper trade history?"
      )
    ) {
      journal = [];
      save();
      renderJournal();
    }
  };

  for (
    const id of [
      "threshold",
      "rr",
      "cost"
    ]
  ) {
    $(id).addEventListener(
      "input",
      () => {
        $("thresholdValue").textContent =
          $("threshold").value;

        $("rrValue").textContent =
          Number(
            $("rr").value
          ).toFixed(1);

        $("costValue").textContent =
          Number(
            $("cost").value
          ).toFixed(2);
      }
    );
  }

  for (
    const b of document.querySelectorAll(
      ".navitem"
    )
  ) {
    b.onclick = () => {
      document.querySelectorAll(
        ".navitem"
      ).forEach(
        x => x.classList.remove(
          "active"
        )
      );

      b.classList.add("active");

      $(b.dataset.target).scrollIntoView({
        behavior: "smooth"
      });
    };
  }

  let resizeTimer;

  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(
        () => {
          drawPrice();
          drawZones();
          drawDepth();
          drawEquity();
        },
        140
      );
    }
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        loadGold();

        if (!paxg.connected) {
          connectPaxg();
        }

      } else if (
        ws?.readyState === 1
      ) {
        ws.close();
      }
    }
  );

  renderJournal();

  loadGold();

  loadPaxgRest().finally(
    connectPaxg
  );

  // Refresh Twelve Data at a controlled pace.

  setInterval(
    () => {
      if (!document.hidden) {
        loadGold();
      }
    },
    60000
  );

  // Binance REST fallback when streaming is down.

  setInterval(
    () => {
      if (
        !document.hidden &&
        !paxg.connected
      ) {
        loadPaxgRest();
      }
    },
    30000
  );

  // Detect silent WebSocket disconnections.

  setInterval(
    () => {
      if (
        paxg.connected &&
        Date.now() - paxg.lastAt >
        23000
      ) {
        try {
          ws.close();
        } catch {}
      }
    },
    9000
  );
}

bootstrap();