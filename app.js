
/*
====================================================
 MKAYFX BLACKBOOK X2
 FILE: app.js

 REAL BINANCE PAXGUSDT MARKET DATA

 CONNECTION SYSTEM
 1. Binance WebSocket
 2. Alternate Binance WebSocket
 3. Vercel REST backup

 MARKET ANALYTICS
 - Executed trade tape
 - Top 20 order book
 - Top 15 depth imbalance
 - Liquidity heatmap
 - Cumulative volume delta
 - Footprint
 - 1-minute candles
 - Large trade alerts

 No synthetic trades or fabricated order book.
====================================================
*/

(() => {
"use strict";

/* ===============================================
   CONFIGURATION
=============================================== */

const SYMBOL = "PAXGUSDT";

const STREAMS = [
  "paxgusdt@trade",
  "paxgusdt@depth20@100ms",
  "paxgusdt@bookTicker",
  "paxgusdt@kline_1m"
].join("/");

const WS_ENDPOINTS = [
  "wss://data-stream.binance.vision:443/stream?streams=" +
    STREAMS,

  "wss://stream.binance.com:443/stream?streams=" +
    STREAMS
];

const REST_URL = "/api/market";

const REST_INTERVAL = 12000;
const SPOT_INTERVAL = 90000;
const CONNECT_TIMEOUT = 12000;
const STALE_TIMEOUT = 65000;

const MAX_TRADES = 250;
const MAX_HEAT = 90;
const MAX_EVENTS = 60;

const $ = id => document.getElementById(id);

const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

const money = value => {
  if (!Number.isFinite(value)) return "—";

  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const qty = value => {
  if (!Number.isFinite(value)) return "—";

  return value.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  });
};

const clockFormat = new Intl.DateTimeFormat(
  "en-GB",
  {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }
);

function timeText(t = Date.now()) {
  return clockFormat.format(new Date(t));
}

/* ===============================================
   GLOBAL ENGINE STATE
=============================================== */

const S = {
  socket: null,
  running: true,

  socketOpen: false,
  socketOpenedAt: 0,
  lastWsAt: 0,

  lastRestAt: 0,
  lastTradeAt: 0,
  lastBookAt: 0,

  lastError: "",
  wsLabel: "CONNECTING",
  restLabel: "WAITING",

  attempts: 0,
  retryTimer: null,
  connectTimer: null,

  fetching: false,
  renderTimer: null,

  price: NaN,
  bestBid: NaN,
  bestAsk: NaN,
  spot: NaN,

  book: {
    bids: [],
    asks: [],
    lastUpdateId: null
  },

  bookSource: "",

  candles: [],
  trades: [],
  seenTrades: new Set(),

  totalTrades: 0,
  cvd: 0,
  cvdHistory: [],

  heat: [],
  events: [],

  alertEnabled: false,
  notificationGranted: false,
  heatPaused: false,

  lastHeatAt: 0,
  lastLiquidityEventAt: 0
};

/* ===============================================
   EVENT JOURNAL
=============================================== */

function logEvent(message, type = "info") {
  S.events.unshift({
    time: Date.now(),
    message,
    type
  });

  S.events = S.events.slice(0, MAX_EVENTS);

  renderEvents();
}

function reportError(message) {
  S.lastError = message;
  $("diagnostic").textContent = message;
  logEvent(message, "error");
}

/* ===============================================
   CONNECTION STATUS
=============================================== */

function updateConnection() {
  const now = Date.now();

  const wsFresh =
    S.socketOpen &&
    S.lastWsAt > 0 &&
    now - S.lastWsAt < 25000;

  const restFresh =
    S.lastRestAt > 0 &&
    now - S.lastRestAt < 30000;

  let mode = "OFFLINE";
  let css = "offline";

  if (wsFresh) {
    mode = "LIVE WS";
    css = "online";
  } else if (restFresh) {
    mode = "REST BACKUP";
    css = "backup";
  } else if (
    S.socket &&
    (
      S.socket.readyState === WebSocket.CONNECTING ||
      S.socket.readyState === WebSocket.OPEN
    )
  ) {
    mode = "CONNECTING";
    css = "connecting";
  }

  $("status").className = "pill " + css;
  $("statusText").textContent = mode;
  $("engineMode").textContent = mode;

  $("wsState").textContent = S.wsLabel;
  $("restState").textContent = S.restLabel;

  $("retryCount").textContent =
    Math.max(0, S.attempts - 1);

  const last = Math.max(
    S.lastWsAt,
    S.lastRestAt,
    S.lastTradeAt,
    S.lastBookAt
  );

  $("lastEvent").textContent =
    last ? timeText(last) : "—";

  if (wsFresh) {
    $("sourceInfo").textContent =
      "LIVE WEBSOCKET · Binance PAXGUSDT";

    $("diagnostic").textContent =
      "WebSocket market events are being received.";

  } else if (restFresh) {
    $("sourceInfo").textContent =
      "REST BACKUP · Periodic real Binance snapshots";

    $("diagnostic").textContent =
      "WebSocket unavailable or inactive. " +
      "REST polling is supplying available market data. " +
      "Some trades and depth changes may be missed.";

  } else if (mode === "CONNECTING") {
    $("sourceInfo").textContent =
      "Connecting to public market data...";

    $("diagnostic").textContent =
      "Waiting for Binance market data.";

  } else {
    $("sourceInfo").textContent =
      "No verified fresh market data";

    $("diagnostic").textContent =
      S.lastError ||
      "Both market-data connections are unavailable.";
  }
}

/* ===============================================
   WEBSOCKET CONNECTION
=============================================== */

function connectWebSocket() {
  if (!S.running) return;

  clearTimeout(S.retryTimer);
  clearTimeout(S.connectTimer);

  if (S.socket) {
    const oldSocket = S.socket;
    S.socket = null;

    try {
      oldSocket.close();
    } catch (_) {}
  }

  const index =
    S.attempts % WS_ENDPOINTS.length;

  const url = WS_ENDPOINTS[index];

  S.attempts++;

  S.socketOpen = false;
  S.wsLabel = "CONNECTING";

  logEvent(
    "WebSocket attempt " +
    S.attempts +
    " using Binance endpoint " +
    (index + 1)
  );

  let socket;

  try {
    socket = new WebSocket(url);
  } catch (error) {
    S.wsLabel = "FAILED";
    reportError(
      "WebSocket creation failed: " +
      error.message
    );
    scheduleReconnect();
    return;
  }

  S.socket = socket;

  S.connectTimer = setTimeout(() => {
    if (
      S.socket === socket &&
      socket.readyState === WebSocket.CONNECTING
    ) {
      S.wsLabel = "TIMEOUT";
      logEvent(
        "WebSocket handshake timed out.",
        "error"
      );
      socket.close();
    }
  }, CONNECT_TIMEOUT);

  socket.onopen = () => {
    if (S.socket !== socket) return;

    clearTimeout(S.connectTimer);

    S.socketOpen = true;
    S.socketOpenedAt = Date.now();
    S.wsLabel = "SOCKET OPEN";

    logEvent(
      "WebSocket opened. Awaiting exchange events.",
      "success"
    );

    updateConnection();
  };

  socket.onmessage = event => {
    if (S.socket !== socket) return;

    let packet;

    try {
      packet = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    const data = packet.data || packet;

    S.lastWsAt = Date.now();
    S.wsLabel = "RECEIVING";

    if (!data || typeof data !== "object") {
      return;
    }

    // Actual executed trade
    if (data.e === "trade") {
      processTrade(data, "WS", false);
    }

    // Partial top-20 book snapshot
    else if (
      Array.isArray(data.bids) &&
      Array.isArray(data.asks)
    ) {
      applyBook(data, "WS");
    }

    // Best bid and best ask
    else if (data.e === "bookTicker") {
      const bid = num(data.b);
      const ask = num(data.a);

      if (Number.isFinite(bid)) S.bestBid = bid;
      if (Number.isFinite(ask)) S.bestAsk = ask;
    }

    // One-minute candle update
    else if (data.e === "kline" && data.k) {
      applyKline(data.k);
    }

    queueRender();
  };

  socket.onerror = () => {
    if (S.socket !== socket) return;

    S.wsLabel = "ERROR";

    logEvent(
      "WebSocket transport error. " +
      "Trying REST backup and reconnect.",
      "error"
    );
  };

  socket.onclose = event => {
    if (S.socket !== socket) return;

    clearTimeout(S.connectTimer);

    S.socket = null;
    S.socketOpen = false;

    S.wsLabel =
      "CLOSED " + (event.code || "");

    logEvent(
      "WebSocket closed. Code " +
      event.code,
      "warning"
    );

    updateConnection();
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (!S.running) return;

  clearTimeout(S.retryTimer);

  const delay = Math.min(
    30000,
    2000 * Math.pow(
      1.6,
      Math.min(S.attempts, 6)
    )
  );

  S.retryTimer = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

function reconnectNow() {
  clearTimeout(S.retryTimer);
  clearTimeout(S.connectTimer);

  S.attempts = 0;

  S.lastWsAt = 0;
  S.lastError = "";

  S.running = true;

  connectWebSocket();
  pollREST();

  logEvent(
    "Manual connection restart requested."
  );
}

/* ===============================================
   REST BACKUP ENGINE
=============================================== */

async function pollREST() {
  if (S.fetching || !S.running) return;

  S.fetching = true;
  S.restLabel = "FETCHING";

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, 11000);

  try {
    const response = await fetch(
      REST_URL + "?t=" + Date.now(),
      {
        cache: "no-store",
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        "Market API HTTP " + response.status
      );
    }

    const data = await response.json();

    if (!data.ok) {
      throw new Error(
        "No Binance REST data available"
      );
    }

    S.lastRestAt = Date.now();
    S.restLabel = "HEALTHY";

    const wsFresh =
      S.socketOpen &&
      Date.now() - S.lastWsAt < 20000;

    // Do not overwrite a fresh live trade price.
    if (!wsFresh && Number.isFinite(num(data.price))) {
      S.price = num(data.price);
    }

    // Prefer fresh WebSocket order-book data.
    const bookFresh =
      S.bookSource === "WS" &&
      Date.now() - S.lastBookAt < 15000;

    if (data.book && !bookFresh) {
      applyBook(data.book, "REST");
    }

    // REST trades are real but polling may skip executions.
    if (Array.isArray(data.trades) && !wsFresh) {
      const ordered = [...data.trades].sort(
        (a, b) => num(a.time) - num(b.time)
      );

      const firstLoad = S.totalTrades === 0;

      for (const trade of ordered) {
        processTrade(trade, "REST", firstLoad);
      }
    }

    if (Array.isArray(data.candles)) {
      if (
        !S.candles.length ||
        !wsFresh
      ) {
        applyCandles(data.candles);
      }
    }

    const errors = Object.entries(
      data.errors || {}
    );

    if (errors.length) {
      S.restLabel = "PARTIAL";
    }

  } catch (error) {
    S.restLabel = "FAILED";

    const message =
      "REST backup failed: " + error.message;

    if (S.lastError !== message) {
      reportError(message);
    }

  } finally {
    clearTimeout(timer);
    S.fetching = false;

    updateConnection();
    queueRender();
  }
}

/* ===============================================
   OPTIONAL XAU/USD SPOT QUOTE
=============================================== */

async function pollSpot() {
  try {
    const response = await fetch(
      "/api/spot?t=" + Date.now(),
      { cache: "no-store" }
    );

    const data = await response.json();

    if (data.ok && Number.isFinite(num(data.price))) {
      S.spot = num(data.price);

      $("spotStatus").textContent =
        "Twelve Data · last response " +
        timeText();

    } else if (data.configured === false) {
      $("spotStatus").textContent =
        "Add TWELVE_DATA_API_KEY on Vercel";

    } else {
      $("spotStatus").textContent =
        "Spot quote unavailable";
    }

  } catch (_) {
    $("spotStatus").textContent =
      "Spot quote API unavailable";
  }

  queueRender();
}

/* ===============================================
   CANDLE PROCESSING
=============================================== */

function applyCandles(data) {
  const candles = [];

  for (const row of data) {
    if (!Array.isArray(row)) continue;

    const c = {
      t: num(row[0]),
      o: num(row[1]),
      h: num(row[2]),
      l: num(row[3]),
      c: num(row[4]),
      v: num(row[5])
    };

    if (
      Number.isFinite(c.t) &&
      Number.isFinite(c.o) &&
      Number.isFinite(c.h) &&
      Number.isFinite(c.l) &&
      Number.isFinite(c.c)
    ) {
      candles.push(c);
    }
  }

  if (candles.length) {
    S.candles = candles.slice(-150);
  }
}

function applyKline(k) {
  const candle = {
    t: num(k.t),
    o: num(k.o),
    h: num(k.h),
    l: num(k.l),
    c: num(k.c),
    v: num(k.v)
  };

  if (
    !Number.isFinite(candle.t) ||
    !Number.isFinite(candle.c)
  ) {
    return;
  }

  const index = S.candles.findIndex(
    x => x.t === candle.t
  );

  if (index >= 0) {
    S.candles[index] = candle;
  } else {
    S.candles.push(candle);
    S.candles.sort((a, b) => a.t - b.t);
  }

  S.candles = S.candles.slice(-150);
}

/* ===============================================
   EXECUTED TRADE PROCESSING
=============================================== */

function processTrade(raw, source, backfill) {
  const id = String(
    raw.t ?? raw.id ?? raw.a ?? ""
  );

  if (!id || S.seenTrades.has(id)) {
    return;
  }

  const price = num(raw.p ?? raw.price);
  const amount = num(raw.q ?? raw.qty);
  const time = num(
    raw.T ?? raw.time ?? Date.now()
  );

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(amount) ||
    price <= 0 ||
    amount <= 0
  ) {
    return;
  }

  S.seenTrades.add(id);

  if (S.seenTrades.size > 2500) {
    const first = S.seenTrades.values().next().value;
    S.seenTrades.delete(first);
  }

  // m=true means buyer was maker.
  // Therefore the aggressor was the seller.
  const side = raw.m ? "SELL" : "BUY";

  const trade = {
    id,
    price,
    amount,
    time,
    side,
    source,
    notional: price * amount
  };

  S.trades.unshift(trade);

  if (S.trades.length > MAX_TRADES) {
    S.trades.pop();
  }

  S.totalTrades++;

  S.cvd += side === "BUY"
    ? amount
    : -amount;

  S.cvdHistory.push({
    time,
    value: S.cvd
  });

  S.cvdHistory =
    S.cvdHistory.slice(-250);

  S.lastTradeAt = Date.now();

  if (source === "WS") {
    S.price = price;
  } else if (!Number.isFinite(S.price)) {
    S.price = price;
  }

  const threshold = Math.max(
    100,
    num($("threshold").value) || 10000
  );

  if (!backfill && trade.notional >= threshold) {
    const message =
      "LARGE " + side +
      " TRADE · $" +
      money(trade.notional);

    logEvent(
      message,
      side === "BUY" ? "buy" : "sell"
    );

    if (S.alertEnabled) {
      sendTradeAlert(message);
    }
  }

  queueRender();
}

/* ===============================================
   REAL ORDER BOOK
=============================================== */

function cleanLevels(levels, descending) {
  if (!Array.isArray(levels)) return [];

  return levels
    .map(level => ({
      price: num(level[0]),
      amount: num(level[1])
    }))
    .filter(x =>
      Number.isFinite(x.price) &&
      Number.isFinite(x.amount) &&
      x.price > 0 &&
      x.amount > 0
    )
    .sort((a, b) =>
      descending
        ? b.price - a.price
        : a.price - b.price
    )
    .slice(0, 20);
}

function applyBook(data, source) {
  const bids = cleanLevels(data.bids, true);
  const asks = cleanLevels(data.asks, false);

  if (!bids.length || !asks.length) {
    return;
  }

  const previousBid = S.book.bids[0];
  const previousAsk = S.book.asks[0];

  S.book = {
    bids,
    asks,
    lastUpdateId:
      data.lastUpdateId ??
      S.book.lastUpdateId
  };

  S.bestBid = bids[0].price;
  S.bestAsk = asks[0].price;

  S.bookSource = source;
  S.lastBookAt = Date.now();

  $("bookState").textContent =
    source + " SNAPSHOT";

  if (
    previousBid &&
    previousAsk &&
    Date.now() - S.lastLiquidityEventAt > 5000
  ) {
    const bidChange =
      bids[0].amount - previousBid.amount;

    const askChange =
      asks[0].amount - previousAsk.amount;

    if (
      Math.abs(bidChange) >= 0.5 ||
      Math.abs(askChange) >= 0.5
    ) {
      const text =
        "Displayed depth changed · BID " +
        qty(bidChange) +
        " · ASK " +
        qty(askChange);

      logEvent(text);

      S.lastLiquidityEventAt = Date.now();
    }
  }

  recordHeat();
  queueRender();
}

/* ===============================================
   LIQUIDITY HEATMAP HISTORY
=============================================== */

function getBucket() {
  return Math.max(
    0.5,
    num($("bucket").value) || 1
  );
}

function bucketPrice(price) {
  const b = getBucket();

  return Math.round(price / b) * b;
}

function recordHeat() {
  if (S.heatPaused) return;

  if (Date.now() - S.lastHeatAt < 1400) {
    return;
  }

  const levels = [];

  for (const x of S.book.bids) {
    levels.push({
      price: bucketPrice(x.price),
      qty: x.amount,
      side: "BID"
    });
  }

  for (const x of S.book.asks) {
    levels.push({
      price: bucketPrice(x.price),
      qty: x.amount,
      side: "ASK"
    });
  }

  S.heat.push({
    time: Date.now(),
    levels
  });

  if (S.heat.length > MAX_HEAT) {
    S.heat.shift();
  }

  S.lastHeatAt = Date.now();
}

/* ===============================================
   METRICS
=============================================== */

function renderMetrics() {
  $("price").textContent = money(S.price);

  $("spot").textContent = money(S.spot);

  const spread =
    S.bestAsk - S.bestBid;

  $("spread").textContent =
    Number.isFinite(spread) && spread >= 0
      ? "$" + money(spread)
      : "—";

  const bids = S.book.bids.slice(0, 15);
  const asks = S.book.asks.slice(0, 15);

  const bidTotal = bids.reduce(
    (sum, x) => sum + x.amount, 0
  );

  const askTotal = asks.reduce(
    (sum, x) => sum + x.amount, 0
  );

  const total = bidTotal + askTotal;

  const imbalance =
    total > 0
      ? 100 * bidTotal / total
      : NaN;

  $("imbalance").textContent =
    Number.isFinite(imbalance)
      ? imbalance.toFixed(1) + "%"
      : "—";

  $("cvd").textContent =
    S.totalTrades
      ? qty(S.cvd)
      : "—";

  const cutoff = Date.now() - 60000;

  const volume = S.trades
    .filter(x => x.time >= cutoff)
    .reduce(
      (sum, x) => sum + x.amount, 0
    );

  $("volume").textContent =
    S.totalTrades
      ? qty(volume)
      : "—";

  $("priceStatus").textContent =
    S.lastTradeAt
      ? "Last received trade " +
        timeText(S.lastTradeAt)
      : S.lastRestAt
        ? "Binance REST price"
        : "Waiting for Binance";

  $("sequence").textContent =
    S.book.lastUpdateId ?? "—";

  $("tradeCount").textContent =
    S.totalTrades + " RECEIVED";
}

/* ===============================================
   DOM ROW HELPERS
=============================================== */

function createRow(className, values, classes = []) {
  const row = document.createElement("div");
  row.className = className;

  values.forEach((value, index) => {
    const cell = document.createElement("span");

    cell.textContent = String(value ?? "");

    if (classes[index]) {
      cell.className = classes[index];
    }

    row.appendChild(cell);
  });

  return row;
}

function setEmpty(container, message) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = message;

  container.replaceChildren(div);
}

/* ===============================================
   ORDER BOOK TABLE
=============================================== */

function renderBook() {
  const root = $("bookRows");

  if (
    !S.book.bids.length ||
    !S.book.asks.length
  ) {
    setEmpty(
      root,
      "Waiting for real Binance order book..."
    );
    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (let i = 0; i < 15; i++) {
    const ask = S.book.asks[i];
    const bid = S.book.bids[i];

    fragment.appendChild(
      createRow(
        "bookRow",
        [
          ask ? qty(ask.amount) : "—",
          ask ? money(ask.price) : "—",
          bid ? money(bid.price) : "—",
          bid ? qty(bid.amount) : "—"
        ],
        ["sell", "sell", "buy", "buy"]
      )
    );
  }

  root.replaceChildren(fragment);
}

/* ===============================================
   EXECUTED TRADE TAPE
=============================================== */

function renderTape() {
  const root = $("tradeRows");

  if (!S.trades.length) {
    setEmpty(
      root,
      "No executed trades received yet."
    );
    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (const trade of S.trades.slice(0, 35)) {
    const sideClass =
      trade.side === "BUY" ? "buy" : "sell";

    fragment.appendChild(
      createRow(
        "tapeRow",
        [
          timeText(trade.time),
          money(trade.price),
          qty(trade.amount),
          trade.side
        ],
        ["muted", "", "", sideClass]
      )
    );
  }

  root.replaceChildren(fragment);
}

/* ===============================================
   FOOTPRINT
=============================================== */

function renderFootprint() {
  const root = $("footRows");

  if (!S.trades.length) {
    setEmpty(root, "Waiting for trade data...");
    return;
  }

  const groups = new Map();

  for (const trade of S.trades) {
    const price = bucketPrice(trade.price);
    const key = price.toFixed(2);

    if (!groups.has(key)) {
      groups.set(key, {
        price,
        buy: 0,
        sell: 0
      });
    }

    const item = groups.get(key);

    if (trade.side === "BUY") {
      item.buy += trade.amount;
    } else {
      item.sell += trade.amount;
    }
  }

  const rows = [...groups.values()]
    .sort((a, b) => b.price - a.price)
    .slice(0, 20);

  const fragment =
    document.createDocumentFragment();

  for (const item of rows) {
    fragment.appendChild(
      createRow(
        "footRow",
        [
          qty(item.sell),
          money(item.price),
          qty(item.buy)
        ],
        ["sell", "", "buy"]
      )
    );
  }

  root.replaceChildren(fragment);
}

/* ===============================================
   EVENT JOURNAL
=============================================== */

function renderEvents() {
  const root = $("eventRows");

  if (!S.events.length) {
    setEmpty(root, "No events recorded.");
    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (const event of S.events.slice(0, 35)) {
    const row = document.createElement("div");

    row.className =
      "eventRow " + event.type;

    const time = document.createElement("span");
    time.textContent = timeText(event.time);

    const message = document.createElement("span");
    message.textContent = event.message;

    row.append(time, message);
    fragment.appendChild(row);
  }

  root.replaceChildren(fragment);
}

/* ===============================================
   CANVAS HELPERS
=============================================== */

function prepareCanvas(id) {
  const canvas = $(id);

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (width < 10 || height < 10) {
    return null;
  }

  const dpr = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext("2d");

  ctx.setTransform(
    dpr, 0, 0, dpr, 0, 0
  );

  ctx.fillStyle = "#0a1323";
  ctx.fillRect(0, 0, width, height);

  return {
    ctx,
    width,
    height
  };
}

function gridLines(ctx, x, y, w, h, count = 4) {
  ctx.strokeStyle = "rgba(135,165,205,.10)";
  ctx.lineWidth = 1;

  for (let i = 0; i <= count; i++) {
    const py = y + h * i / count;

    ctx.beginPath();
    ctx.moveTo(x, py);
    ctx.lineTo(x + w, py);
    ctx.stroke();
  }
}

function emptyCanvas(data, message) {
  const { ctx, width, height } = data;

  ctx.fillStyle = "#8296b1";
  ctx.font = "13px system-ui";
  ctx.textAlign = "center";

  ctx.fillText(
    message,
    width / 2,
    height / 2
  );

  ctx.textAlign = "left";
}

/* ===============================================
   CANDLESTICK CHART
=============================================== */

function drawChart() {
  const canvas = prepareCanvas("chartCanvas");

  if (!canvas) return;

  const { ctx, width: w, height: h } = canvas;

  const candles = S.candles.slice(-65);

  if (!candles.length) {
    emptyCanvas(
      canvas,
      "Waiting for real Binance candles..."
    );
    return;
  }

  const left = 12;
  const top = 16;
  const right = 74;
  const bottom = 28;

  const plotW = w - left - right;
  const plotH = h - top - bottom;

  if (plotW <= 0 || plotH <= 0) return;

  let high = Math.max(...candles.map(x => x.h));
  let low = Math.min(...candles.map(x => x.l));

  const padding = Math.max(
    (high - low) * 0.10,
    0.5
  );

  high += padding;
  low -= padding;

  const y = price =>
    top + (high - price) /
    (high - low) * plotH;

  gridLines(ctx, left, top, plotW, plotH);

  ctx.font = "11px system-ui";
  ctx.fillStyle = "#91a4bd";

  for (let i = 0; i <= 4; i++) {
    const price =
      high - (high - low) * i / 4;

    ctx.fillText(
      price.toFixed(2),
      w - right + 5,
      top + plotH * i / 4 + 4
    );
  }

  const step = plotW / candles.length;
  const bodyW = Math.max(
    2,
    Math.min(12, step * 0.65)
  );

  candles.forEach((c, i) => {
    const x = left + step * (i + 0.5);

    const bullish = c.c >= c.o;

    ctx.strokeStyle =
      bullish ? "#32dfae" : "#ff647e";

    ctx.fillStyle = ctx.strokeStyle;

    ctx.beginPath();
    ctx.moveTo(x, y(c.h));
    ctx.lineTo(x, y(c.l));
    ctx.stroke();

    const a = y(c.o);
    const b = y(c.c);

    ctx.fillRect(
      x - bodyW / 2,
      Math.min(a, b),
      bodyW,
      Math.max(1.5, Math.abs(a - b))
    );
  });

  // Mark received real executions on matching candles.
  const first = candles[0].t;
  const last = candles[candles.length - 1].t;

  for (const trade of S.trades.slice(0, 70)) {
    const t = Math.floor(trade.time / 60000) *
      60000;

    if (t < first || t > last) continue;

    const index = candles.findIndex(
      c => c.t === t
    );

    if (index < 0) continue;

    const x = left + step * (index + 0.5);

    ctx.fillStyle =
      trade.side === "BUY"
        ? "rgba(86,188,255,.8)"
        : "rgba(255,173,87,.8)";

    ctx.beginPath();
    ctx.arc(
      x,
      y(trade.price),
      2.3,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.fillStyle = "#91a4bd";
  ctx.font = "11px system-ui";

  const labelCount = 4;

  for (let i = 0; i <= labelCount; i++) {
    const index = Math.min(
      candles.length - 1,
      Math.floor(
        i * (candles.length - 1) / labelCount
      )
    );

    const c = candles[index];

    const x = left + step * (index + 0.5);

    ctx.fillText(
      timeText(c.t).slice(0, 5),
      x - 14,
      h - 8
    );
  }
}

/* ===============================================
   LIQUIDITY HEATMAP CANVAS
=============================================== */

function drawHeatmap() {
  const canvas = prepareCanvas("heatCanvas");

  if (!canvas) return;

  const { ctx, width: w, height: h } = canvas;

  if (!S.heat.length) {
    emptyCanvas(
      canvas,
      "Waiting for real depth snapshots..."
    );
    return;
  }

  const left = 10;
  const top = 15;
  const right = 76;
  const bottom = 25;

  const plotW = w - left - right;
  const plotH = h - top - bottom;

  if (plotW <= 0 || plotH <= 0) return;

  const bucket = getBucket();

  const center = Number.isFinite(S.price)
    ? bucketPrice(S.price)
    : bucketPrice(
        (S.bestBid + S.bestAsk) / 2
      );

  if (!Number.isFinite(center)) return;

  const rows = 36;
  const slots = 90;

  const samples = S.heat.slice(-slots);

  const cellW = plotW / slots;
  const cellH = plotH / rows;

  let maxQty = 0;

  for (const sample of samples) {
    for (const item of sample.levels) {
      maxQty = Math.max(
        maxQty,
        item.qty
      );
    }
  }

  maxQty = Math.max(maxQty, 0.001);

  samples.forEach((sample, i) => {
    const column =
      slots - samples.length + i;

    const x = left + column * cellW;

    for (const item of sample.levels) {
      const diff =
        (item.price - center) / bucket;

      const row =
        Math.floor(rows / 2 - diff);

      if (row < 0 || row >= rows) continue;

      const intensity = Math.min(
        0.9,
        0.12 + (item.qty / maxQty) * 0.78
      );

      const color =
        item.side === "BID"
          ? "rgba(35,220,164," +
            intensity + ")"
          : "rgba(255,85,118," +
            intensity + ")";

      ctx.fillStyle = color;

      ctx.fillRect(
        x,
        top + row * cellH,
        Math.max(1, cellW),
        Math.max(1, cellH)
      );
    }
  });

  gridLines(
    ctx,
    left,
    top,
    plotW,
    plotH
  );

  ctx.strokeStyle = "#53baff";
  ctx.setLineDash([4, 5]);

  ctx.beginPath();
  ctx.moveTo(
    left,
    top + plotH / 2
  );
  ctx.lineTo(
    left + plotW,
    top + plotH / 2
  );
  ctx.stroke();

  ctx.setLineDash([]);

  ctx.font = "11px system-ui";
  ctx.fillStyle = "#9aacc4";

  for (let i = 0; i <= 6; i++) {
    const price =
      center + (rows / 2 - i * 6) * bucket;

    const y = top + plotH * i / 6;

    ctx.fillText(
      price.toFixed(2),
      w - right + 5,
      y + 5
    );
  }

  ctx.fillText(
    samples.length + " snapshots",
    left + 5,
    h - 7
  );
}

/* ===============================================
   CUMULATIVE VOLUME DELTA CHART
=============================================== */

function drawCVD() {
  const canvas = prepareCanvas("cvdCanvas");

  if (!canvas) return;

  const { ctx, width: w, height: h } = canvas;

  const data = S.cvdHistory.slice(-150);

  if (data.length < 2) {
    emptyCanvas(
      canvas,
      "Waiting for executed trade delta..."
    );
    return;
  }

  const left = 18;
  const right = 65;
  const top = 20;
  const bottom = 28;

  const plotW = w - left - right;
  const plotH = h - top - bottom;

  if (plotW <= 0 || plotH <= 0) return;

  const values = data.map(x => x.value);

  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);

  const range = Math.max(
    0.01,
    max - min
  );

  const upper = max + range * 0.12;
  const lower = min - range * 0.12;

  const y = v =>
    top + (upper - v) /
    (upper - lower) * plotH;

  const x = i =>
    left + i / (data.length - 1) * plotW;

  gridLines(ctx, left, top, plotW, plotH);

  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.setLineDash([4, 5]);

  ctx.beginPath();
  ctx.moveTo(left, y(0));
  ctx.lineTo(left + plotW, y(0));
  ctx.stroke();

  ctx.setLineDash([]);

  const gradient = ctx.createLinearGradient(
    0,
    top,
    0,
    top + plotH
  );

  gradient.addColorStop(
    0,
    "rgba(79,181,255,.22)"
  );

  gradient.addColorStop(
    1,
    "rgba(79,181,255,0)"
  );

  ctx.beginPath();

  data.forEach((point, i) => {
    const px = x(i);
    const py = y(point.value);

    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });

  ctx.lineTo(
    x(data.length - 1),
    top + plotH
  );

  ctx.lineTo(
    x(0),
    top + plotH
  );

  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();

  data.forEach((point, i) => {
    if (i === 0) {
      ctx.moveTo(x(i), y(point.value));
    } else {
      ctx.lineTo(x(i), y(point.value));
    }
  });

  ctx.strokeStyle = "#58baff";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = "11px system-ui";
  ctx.fillStyle = "#9aacc4";

  ctx.fillText(
    qty(upper),
    w - right + 5,
    top + 7
  );

  ctx.fillText(
    qty(0),
    w - right + 5,
    y(0) + 4
  );

  ctx.fillText(
    qty(lower),
    w - right + 5,
    top + plotH
  );

  ctx.fillText(
    timeText(data[0].time),
    left,
    h - 8
  );

  ctx.fillText(
    timeText(data[data.length - 1].time),
    Math.max(left, w - right - 75),
    h - 8
  );
}

/* ===============================================
   ALERT ENGINE
=============================================== */

function sendTradeAlert(message) {
  if (
    S.notificationGranted &&
    "Notification" in window
  ) {
    try {
      new Notification(
        "MKAYFX BLACKBOOK",
        {
          body: message
        }
      );
    } catch (_) {
      // In-app journal remains active.
    }
  }
}

async function toggleAlerts() {
  S.alertEnabled = !S.alertEnabled;

  if (
    S.alertEnabled &&
    "Notification" in window
  ) {
    try {
      const permission =
        await Notification.requestPermission();

      S.notificationGranted =
        permission === "granted";
    } catch (_) {
      S.notificationGranted = false;
    }
  }

  $("notifyBtn").textContent =
    S.alertEnabled
      ? "DISABLE ALERTS"
      : "ENABLE ALERTS";

  logEvent(
    S.alertEnabled
      ? "Large trade alerts enabled in journal."
      : "Large trade alerts disabled."
  );
}

/* ===============================================
   RENDER SCHEDULER
=============================================== */

function renderAll() {
  renderMetrics();
  renderBook();
  renderTape();
  renderFootprint();
  renderEvents();

  drawChart();
  drawHeatmap();
  drawCVD();

  updateConnection();
}

function queueRender() {
  if (S.renderTimer !== null) return;

  S.renderTimer = setTimeout(() => {
    S.renderTimer = null;
    renderAll();
  }, 300);
}

/* ===============================================
   CONTROLS
=============================================== */

function initializeControls() {
  $("connectBtn").addEventListener(
    "click",
    reconnectNow
  );

  $("pauseBtn").addEventListener(
    "click",
    () => {
      S.heatPaused = !S.heatPaused;

      $("pauseBtn").textContent =
        S.heatPaused
          ? "RESUME HEATMAP"
          : "PAUSE HEATMAP";

      logEvent(
        S.heatPaused
          ? "Heatmap recording paused."
          : "Heatmap recording resumed."
      );
    }
  );

  $("notifyBtn").addEventListener(
    "click",
    toggleAlerts
  );

  $("clearBtn").addEventListener(
    "click",
    () => {
      S.events = [];
      renderEvents();
    }
  );

  $("bucket").addEventListener(
    "change",
    () => {
      // Old heat history uses the previous
      // bucket size and must be reset.
      S.heat = [];
      S.lastHeatAt = 0;

      logEvent(
        "Price bucket changed to $" +
        getBucket().toFixed(2)
      );

      recordHeat();
      queueRender();
    }
  );

  window.addEventListener(
    "resize",
    queueRender
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        const socketUnavailable =
          !S.socket ||
          S.socket.readyState !== WebSocket.OPEN;

        if (socketUnavailable) {
          connectWebSocket();
        }

        pollREST();
        queueRender();
      }
    }
  );
}

/* ===============================================
   HEALTH WATCHDOG
=============================================== */

function watchdog() {
  $("clock").textContent =
    timeText() + " SAST";

  // Restart a connection that opened but stopped
  // providing market data.
  if (
    S.socket &&
    S.socket.readyState === WebSocket.OPEN
  ) {
    const last = S.lastWsAt ||
      S.socketOpenedAt;

    if (
      last &&
      Date.now() - last > STALE_TIMEOUT
    ) {
      logEvent(
        "WebSocket stale. Restarting connection.",
        "warning"
      );

      S.socket.close();
    }
  }

  renderMetrics();
  updateConnection();
}

/* ===============================================
   START ENGINE
=============================================== */

function start() {
  initializeControls();

  logEvent(
    "MKAYFX BLACKBOOK X2 engine initialized.",
    "success"
  );

  $("clock").textContent =
    timeText() + " SAST";

  // Start REST immediately so a failed WebSocket
  // does not leave the dashboard empty.
  pollREST();

  // Run direct WebSocket simultaneously.
  connectWebSocket();

  // Keep the REST backup refreshed.
  setInterval(
    pollREST,
    REST_INTERVAL
  );

  // Optional independent gold spot price.
  pollSpot();

  setInterval(
    pollSpot,
    SPOT_INTERVAL
  );

  // Display freshness and connection health.
  setInterval(
    watchdog,
    1000
  );

  renderAll();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    start
  );
} else {
  start();
}

})();
