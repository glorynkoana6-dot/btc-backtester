/* MKAYFX BLACKBOOK X1 FREE
 * Real Binance spot PAXGUSDT trade + Level 2 aggregate depth feed.
 * It does NOT show CME, hidden orders, order IDs, or XAU/USD executions.
 * A correct local order book needs a REST snapshot plus sequenced diff updates.
 */
const SYMBOL = 'PAXGUSDT';
const REST = 'https://data-api.binance.vision/api/v3';
const STREAM = 'wss://data-stream.binance.vision/stream?streams=' +
  'paxgusdt@trade/paxgusdt@depth@100ms/paxgusdt@kline_1m';

const $ = id => document.getElementById(id);
const N = v => Number(v);

const money = v => Number.isFinite(v)
  ? v.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  : '—';

const vol = v => Number.isFinite(v)
  ? v.toLocaleString('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    })
  : '—';

const signed = v => Number.isFinite(v)
  ? (v >= 0 ? '+' : '') + vol(v)
  : '—';

const tSast = ms => new Date(ms).toLocaleTimeString(
  'en-GB', {
    timeZone: 'Africa/Johannesburg',
    hour12: false
  }
);

const escapeHTML = s => String(s).replace(
  /[&<>"']/g,
  c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c])
);

const state = {
  ws: null,
  run: 0,
  reconnect: null,
  manual: false,
  active: false,
  synced: false,
  syncing: false,

  buffer: [],
  bid: new Map(),
  ask: new Map(),
  bookId: 0,

  lastDepth: 0,
  lastTrade: 0,
  lastPrice: null,
  lastError: '',

  trades: [],
  tradeCount: 0,
  cvd: 0,
  cvdPoints: [],
  volumeQueue: [],

  candle: [],
  heat: [],
  heatPaused: false,

  events: [],
  depthCount: 0,
  added: 0,
  removed: 0,

  alertThreshold: 10000,
  bucket: 1,
  notifications: false,

  spotPrice: null,
  spotTime: null,
  spotError: 'Not configured'
};

function eventLog(title, detail = '', kind = 'blue') {
  state.events.unshift({
    time: Date.now(),
    title,
    detail,
    kind
  });

  state.events.length = Math.min(
    state.events.length,
    65
  );
}

async function getJSON(url) {
  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(12000)
  });

  if (!res.ok) {
    throw new Error(
      'HTTP ' + res.status + ' from public market data API'
    );
  }

  const obj = await res.json();

  if (obj?.code < 0) {
    throw new Error(
      obj.msg || 'Exchange rejected request'
    );
  }

  return obj;
}

function setStatus(label, good = false) {
  $('statusText').textContent = label;
  $('status').classList.toggle('live', good);
}

function resetStreamData() {
  state.bid.clear();
  state.ask.clear();

  state.bookId = 0;
  state.synced = false;
  state.syncing = false;
  state.buffer = [];

  state.heat = [];
  state.trades = [];
  state.cvdPoints = [];
  state.volumeQueue = [];

  state.cvd = 0;
  state.lastPrice = null;
  state.tradeCount = 0;
  state.depthCount = 0;

  state.added = 0;
  state.removed = 0;

  state.lastDepth = 0;
  state.lastTrade = 0;
}

function connect() {
  state.manual = false;

  clearTimeout(state.reconnect);

  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }

  const run = ++state.run;

  resetStreamData();

  setStatus('CONNECTING');

  $('connectBtn').textContent = 'DISCONNECT';

  $('sourceInfo').textContent =
    'Source: Binance public spot market data';

  try {
    state.ws = new WebSocket(STREAM);
  } catch (err) {
    state.lastError = err.message;

    eventLog(
      'WebSocket unsupported',
      err.message,
      'red'
    );

    scheduleReconnect(run);
    return;
  }

  const socket = state.ws;

  socket.onopen = () => {
    if (run !== state.run) return;

    state.active = true;

    setStatus('SYNCING');

    eventLog(
      'Market stream opened',
      'Buffering depth events and loading exchange snapshot'
    );

    syncOrderBook(run);
  };

  socket.onmessage = message => {
    if (run !== state.run) return;

    let data;

    try {
      data = JSON.parse(message.data).data;
    } catch {
      return;
    }

    if (!data) return;

    if (data.e === 'depthUpdate') {
      state.lastDepth = Date.now();

      if (!state.synced) {
        state.buffer.push(data);

        if (state.buffer.length > 12000) {
          state.lastError = 'Depth buffer overflow';
          socket.close();
        }
      } else {
        applyDepth(data, run);
      }

    } else if (data.e === 'trade') {
      receiveTrade(data);

    } else if (data.e === 'kline') {
      receiveCandle(data.k);
    }
  };

  socket.onerror = () => {
    if (run === state.run) {
      state.lastError = 'Market WebSocket failed';
    }
  };

  socket.onclose = () => {
    if (run !== state.run) return;

    state.active = false;
    state.synced = false;

    setStatus('OFFLINE');

    eventLog(
      'Market stream disconnected',
      state.lastError || 'Socket closed',
      'red'
    );

    if (!state.manual) {
      scheduleReconnect(run);
    }
  };

  loadCandles(run);
}

function scheduleReconnect(run) {
  if (run !== state.run || state.manual) return;

  setStatus('RETRYING');

  state.reconnect = setTimeout(() => {
    if (run === state.run && !state.manual) {
      connect();
    }
  }, 4500);
}

function disconnect() {
  state.manual = true;

  clearTimeout(state.reconnect);

  ++state.run;

  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }

  state.active = false;
  state.synced = false;
  state.syncing = false;

  $('connectBtn').textContent = 'CONNECT';

  setStatus('OFFLINE');

  eventLog(
    'Stream manually disconnected',
    'Existing readings are historical until reconnected'
  );
}

/*
 * BINANCE ORDER BOOK SYNCHRONIZATION
 * Fetch initial exchange snapshot.
 * Replay buffered incremental depth updates.
 * Detect gaps rather than continuing with an incorrect book.
 */
async function syncOrderBook(run) {
  if (state.syncing || run !== state.run) return;

  state.syncing = true;
  state.synced = false;

  try {
    let ready = false;

    for (let attempt = 0; attempt < 7; attempt++) {
      if (run !== state.run || state.manual) return;

      const snap = await getJSON(
        `${REST}/depth?symbol=${SYMBOL}&limit=1000`
      );

      if (run !== state.run) return;

      if (
        !Number.isSafeInteger(snap.lastUpdateId) ||
        !Array.isArray(snap.bids) ||
        !Array.isArray(snap.asks)
      ) {
        throw Error(
          'Invalid exchange order-book snapshot'
        );
      }

      if (
        state.buffer.length &&
        snap.lastUpdateId + 1 < state.buffer[0].U
      ) {
        continue;
      }

      state.bid = new Map(
        snap.bids.map(([p, q]) => [N(p), N(q)])
      );

      state.ask = new Map(
        snap.asks.map(([p, q]) => [N(p), N(q)])
      );

      state.bookId = snap.lastUpdateId;

      const held = state.buffer.splice(0);

      state.synced = true;

      for (const ev of held) {
        if (!state.synced) break;
        applyDepth(ev, run);
      }

      if (state.synced) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      throw Error(
        'Cannot sequence snapshot with live depth stream'
      );
    }

    setStatus('LIVE', true);

    state.lastError = '';

    eventLog(
      'Order book synchronized',
      'Binance snapshot ID ' + state.bookId
    );

  } catch (err) {
    if (run !== state.run) return;

    state.lastError = err.message;

    eventLog(
      'Order book synchronization failed',
      err.message,
      'red'
    );

    if (
      state.ws &&
      state.ws.readyState < 2
    ) {
      state.ws.close();
    }

  } finally {
    state.syncing = false;
  }
}

function applyDepth(d, run) {
  if (d.u <= state.bookId) return;

  if (d.U > state.bookId + 1) {
    state.synced = false;
    state.buffer = [d];

    eventLog(
      'Depth sequence gap',
      'Missing book events — automatically resynchronizing',
      'red'
    );

    if (!state.syncing) {
      syncOrderBook(run);
    }

    setStatus('SYNCING');
    return;
  }

  const changes = [];

  for (
    const [side, updates] of [
      [state.bid, d.b],
      [state.ask, d.a]
    ]
  ) {
    const label = side === state.bid ? 'BID' : 'ASK';

    for (const [ps, qs] of updates) {
      const p = N(ps);
      const q = N(qs);

      if (
        !Number.isFinite(p) ||
        !Number.isFinite(q) ||
        p <= 0 ||
        q < 0
      ) {
        continue;
      }

      const old = side.get(p) || 0;

      if (q === 0) {
        side.delete(p);
      } else {
        side.set(p, q);
      }

      const delta = q - old;

      if (delta > 0) {
        state.added += delta;
      }

      if (delta < 0) {
        state.removed += -delta;
      }

      if (Math.abs(delta) >= 0.15) {
        changes.push({
          label,
          p,
          delta
        });
      }
    }
  }

  state.bookId = d.u;
  state.depthCount++;

  /*
   * Aggregate changes do NOT establish that an individual
   * institutional order was placed or cancelled.
   */
  if (changes.length) {
    changes.sort(
      (a, b) =>
        Math.abs(b.delta) - Math.abs(a.delta)
    );

    const c = changes[0];

    if (
      !state.lastBookEventAt ||
      Date.now() - state.lastBookEventAt > 1600
    ) {
      eventLog(
        `${c.label} displayed liquidity ${
          c.delta > 0 ? 'increased' : 'decreased'
        }`,
        `${signed(c.delta)} PAXG at ${money(c.p)} USDT`,
        'blue'
      );

      state.lastBookEventAt = Date.now();
    }
  }
}

/*
 * REAL EXECUTED TRADES
 * Binance m=true => buyer was maker => SELL taker.
 * Binance m=false => BUY taker.
 */
function receiveTrade(d) {
  const price = N(d.p);
  const qty = N(d.q);
  const time = N(d.T);

  if (!(price > 0 && qty > 0 && time > 0)) {
    return;
  }

  const side = d.m ? 'SELL' : 'BUY';
  const value = price * qty;

  state.lastPrice = price;
  state.lastTrade = Date.now();

  state.tradeCount++;

  state.cvd += side === 'BUY'
    ? qty
    : -qty;

  state.trades.unshift({
    id: d.t,
    price,
    qty,
    time,
    side,
    value
  });

  if (state.trades.length > 3000) {
    state.trades.length = 3000;
  }

  state.volumeQueue.push({
    time: Date.now(),
    qty
  });

  if (value >= state.alertThreshold) {
    eventLog(
      `Large executed ${side} trade`,
      `${money(value)} USDT · ${vol(qty)} PAXG @ ${money(price)}`,
      side === 'BUY' ? 'green' : 'red'
    );

    if (
      state.notifications &&
      Notification.permission === 'granted' &&
      document.hidden
    ) {
      new Notification(
        'MKAYFX: ' + side + ' execution',
        {
          body:
            money(value) +
            ' USDT at ' +
            money(price)
        }
      );
    }
  }
}

function receiveCandle(k) {
  if (!k) return;

  const bar = {
    time: N(k.t),
    open: N(k.o),
    high: N(k.h),
    low: N(k.l),
    close: N(k.c),
    volume: N(k.v)
  };

  if (
    !Number.isFinite(bar.time) ||
    !Number.isFinite(bar.close)
  ) {
    return;
  }

  const last =
    state.candle[state.candle.length - 1];

  if (last && last.time === bar.time) {
    state.candle[state.candle.length - 1] = bar;

  } else if (!last || bar.time > last.time) {
    state.candle.push(bar);
  }

  if (state.candle.length > 210) {
    state.candle.splice(
      0,
      state.candle.length - 210
    );
  }

  if (state.lastPrice === null) {
    state.lastPrice = bar.close;
  }
}

async function loadCandles(run) {
  try {
    const bars = await getJSON(
      `${REST}/klines?symbol=${SYMBOL}&interval=1m&limit=150`
    );

    if (run !== state.run) return;

    if (!Array.isArray(bars)) {
      throw Error('Invalid candles response');
    }

    const loaded = bars.map(k => ({
      time: N(k[0]),
      open: N(k[1]),
      high: N(k[2]),
      low: N(k[3]),
      close: N(k[4]),
      volume: N(k[5])
    }));

    const byTime = new Map(
      [...loaded, ...state.candle]
        .map(b => [b.time, b])
    );

    state.candle = [...byTime.values()]
      .sort((a, b) => a.time - b.time)
      .slice(-210);

    if (
      state.lastPrice === null &&
      state.candle.length
    ) {
      state.lastPrice =
        state.candle.at(-1).close;
    }

  } catch (err) {
    if (run === state.run) {
      eventLog(
        'Candlestick history unavailable',
        err.message,
        'red'
      );
    }
  }
}

/*
 * OPTIONAL XAU/USD SPOT FEED
 * Calls the Vercel serverless function, never Twelve Data
 * directly with an exposed API key.
 */
async function refreshSpot() {
  try {
    const r = await fetch('/api/xau', {
      cache: 'no-store',
      signal: AbortSignal.timeout(12000)
    });

    const obj = await r.json();

    if (!r.ok || !obj.ok) {
      throw Error(
        obj.error || 'Feed unavailable'
      );
    }

    state.spotPrice = obj.price;

    state.spotTime =
      obj.candleTime +
      ' (' +
      obj.providerTimezone +
      ')';

    state.spotError = '';

  } catch (err) {
    state.spotPrice = null;
    state.spotTime = null;
    state.spotError = err.message;
  }
}

function sortedBook() {
  const bids = [...state.bid.entries()]
    .sort((a, b) => b[0] - a[0]);

  const asks = [...state.ask.entries()]
    .sort((a, b) => a[0] - b[0]);

  return { bids, asks };
}

function observedMid() {
  if (!state.synced) {
    return state.lastPrice;
  }

  const b = Math.max(...state.bid.keys());
  const a = Math.min(...state.ask.keys());

  return Number.isFinite(b) &&
    Number.isFinite(a)
    ? (a + b) / 2
    : state.lastPrice;
}

function sampleBook() {
  if (
    !state.synced ||
    state.heatPaused
  ) {
    return;
  }

  const mid = observedMid();

  if (!(mid > 0)) return;

  const step = state.bucket;
  const limit = mid + step * 32;
  const low = mid - step * 32;

  state.heat.push({
    time: Date.now(),
    mid,
    bids: [...state.bid].filter(
      x => x[0] >= low && x[0] <= limit
    ),
    asks: [...state.ask].filter(
      x => x[0] >= low && x[0] <= limit
    )
  });

  if (state.heat.length > 95) {
    state.heat.shift();
  }
}

function cleanVolume() {
  const cutoff = Date.now() - 60000;

  while (
    state.volumeQueue.length &&
    state.volumeQueue[0].time < cutoff
  ) {
    state.volumeQueue.shift();
  }

  state.cvdPoints.push({
    time: Date.now(),
    cvd: state.cvd
  });

  if (state.cvdPoints.length > 180) {
    state.cvdPoints.shift();
  }
}

function renderMetrics() {
  const { bids, asks } = sortedBook();

  const bid = bids[0]?.[0];
  const ask = asks[0]?.[0];

  $('price').textContent =
    state.lastPrice
      ? money(state.lastPrice)
      : '—';

  $('priceStatus').textContent =
    state.lastTrade
      ? 'Last execution ' + tSast(state.lastTrade)
      : 'Latest Binance 1m candle';

  $('spread').textContent =
    state.synced && ask && bid
      ? money(ask - bid)
      : '—';

  const bQty = bids
    .slice(0, 15)
    .reduce((n, x) => n + x[1], 0);

  const aQty = asks
    .slice(0, 15)
    .reduce((n, x) => n + x[1], 0);

  $('imbalance').textContent =
    state.synced && (bQty + aQty) > 0
      ? (
          100 * bQty / (bQty + aQty)
        ).toFixed(1) + '%'
      : '—';

  $('cvd').textContent =
    state.tradeCount
      ? signed(state.cvd)
      : '—';

  $('cvd').className =
    state.cvd >= 0
      ? 'positive'
      : 'negative';

  $('volume').textContent =
    state.volumeQueue.length
      ? vol(
          state.volumeQueue.reduce(
            (s, t) => s + t.qty,
            0
          )
        )
      : '—';

  $('spot').textContent =
    state.spotPrice
      ? money(state.spotPrice)
      : '—';

  $('spotStatus').textContent =
    state.spotTime || state.spotError;

  $('bookState').textContent =
    state.synced
      ? 'SYNCHRONIZED'
      : 'NOT SYNCHRONIZED';

  $('sequence').textContent =
    state.synced
      ? state.bookId.toLocaleString()
      : '—';

  $('tradeCount').textContent =
    state.tradeCount.toLocaleString() +
    ' RECEIVED';

  $('clock').textContent =
    tSast(Date.now()) + ' SAST';

  if (
    state.active &&
    state.synced
  ) {
    setStatus('LIVE', true);
  }

  $('connectBtn').textContent =
    state.manual || !state.ws
      ? 'CONNECT'
      : 'DISCONNECT';
}

function renderBook() {
  if (!state.synced) {
    $('bookRows').innerHTML =
      '<div class="empty">Depth synchronization required…</div>';
    return;
  }

  const { bids, asks } = sortedBook();

  const topB = bids.slice(0, 9);
  const topA = asks.slice(0, 9).reverse();

  const max = Math.max(
    0.001,
    ...topB.map(x => x[1]),
    ...topA.map(x => x[1])
  );

  const line = (p, q, side) => `
    <div class="bookLine ${side}">
      <span
        class="barSide"
        style="
          --shade:${side === 'bid' ? '#225c51' : '#612b41'};
          --size:${Math.round(100 * q / max)}%
        ">
        ${side === 'bid' ? vol(q) : '—'}
      </span>

      <span>${money(p)}</span>

      <span
        class="barSide"
        style="
          --shade:${side === 'ask' ? '#612b41' : '#225c51'};
          --size:${Math.round(100 * q / max)}%
        ">
        ${side === 'ask' ? vol(q) : '—'}
      </span>
    </div>
  `;

  $('bookRows').innerHTML =
    topA
      .map(([p, q]) => line(p, q, 'ask'))
      .join('') +

    `<div class="bookLine mid">
      <span>BEST BID</span>
      <span>
        ${money(bids[0]?.[0])} /
        ${money(asks[0]?.[0])}
      </span>
      <span>BEST ASK</span>
    </div>` +

    topB
      .map(([p, q]) => line(p, q, 'bid'))
      .join('');
}

function renderTape() {
  $('tradeRows').innerHTML =
    state.trades.length
      ? state.trades
          .slice(0, 45)
          .map(t => `
            <div class="tapeLine ${
              t.value >= state.alertThreshold
                ? 'big'
                : ''
            }">
              <span class="time">
                ${tSast(t.time)}
              </span>

              <span>${money(t.price)}</span>
              <span>${vol(t.qty)}</span>

              <span class="${
                t.side === 'BUY'
                  ? 'buy'
                  : 'sell'
              }">
                ${t.side}
              </span>
            </div>
          `)
          .join('')
      : '<div class="empty">Waiting for executed trades…</div>';
}

function renderEvents() {
  $('eventRows').innerHTML =
    state.events.length
      ? state.events
          .slice(0, 38)
          .map(e => `
            <div class="eventRow">
              <time>
                ${tSast(e.time)}
              </time>

              <div>
                <strong class="${
                  e.kind === 'red'
                    ? 'redText'
                    : e.kind === 'green'
                      ? 'greenText'
                      : 'blueText'
                }">
                  ${escapeHTML(e.title)}
                </strong>

                <small>
                  ${escapeHTML(e.detail)}
                </small>
              </div>
            </div>
          `)
          .join('')
      : '<div class="empty">No events recorded.</div>';
}

function renderFootprint() {
  if (!state.trades.length) {
    $('footRows').innerHTML =
      '<div class="empty">Waiting for live trades…</div>';
    return;
  }

  const step = state.bucket;
  const grouped = new Map();

  for (const t of state.trades) {
    const p =
      Math.round(t.price / step) * step;

    if (!grouped.has(p)) {
      grouped.set(p, {
        buy: 0,
        sell: 0
      });
    }

    grouped
      .get(p)[t.side.toLowerCase()] += t.qty;
  }

  const price = state.lastPrice || 0;

  let rows = [...grouped]
    .sort((a, b) => b[0] - a[0]);

  const closest = rows
    .slice()
    .sort(
      (a, b) =>
        Math.abs(a[0] - price) -
        Math.abs(b[0] - price)
    )
    .slice(0, 17)
    .map(x => x[0]);

  rows = rows.filter(
    ([p]) => closest.includes(p)
  );

  const max = Math.max(
    0.01,
    ...rows.flatMap(
      ([, q]) => [q.buy, q.sell]
    )
  );

  $('footRows').innerHTML =
    rows.map(([p, q]) => `
      <div class="footLine">
        <span
          class="s"
          style="
            background:linear-gradient(
              90deg,
              transparent,
              #6a293a ${100 * q.sell / max}%,
              transparent
            )
          ">
          ${vol(q.sell)}
        </span>

        <span class="p">
          ${money(p)}
        </span>

        <span
          class="b"
          style="
            background:linear-gradient(
              90deg,
              transparent,
              #1c5d4d ${100 * q.buy / max}%,
              transparent
            )
          ">
          ${vol(q.buy)}
        </span>
      </div>
    `).join('');
}

function setupCanvas(canvas) {
  const dpr = Math.min(
    devicePixelRatio || 1,
    2
  );

  const rect =
    canvas.getBoundingClientRect();

  if (!rect.width || !rect.height) {
    return null;
  }

  const w = Math.round(
    rect.width * dpr
  );

  const h = Math.round(
    rect.height * dpr
  );

  if (
    canvas.width !== w ||
    canvas.height !== h
  ) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d');

  ctx.setTransform(
    dpr, 0, 0, dpr, 0, 0
  );

  ctx.clearRect(
    0, 0,
    rect.width,
    rect.height
  );

  return {
    ctx,
    w: rect.width,
    h: rect.height
  };
}

function emptyCanvas(ctx, w, h, message) {
  ctx.fillStyle = '#7d96ae';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';

  ctx.fillText(
    message,
    w / 2,
    h / 2
  );

  ctx.textAlign = 'left';
}

function grid(
  ctx, w, h,
  l = 12,
  r = 68,
  t = 13,
  b = 24
) {
  ctx.strokeStyle = '#1a2a3e';
  ctx.lineWidth = 1;

  for (let i = 0; i <= 5; i++) {
    const y =
      t + (h - t - b) * i / 5;

    ctx.beginPath();
    ctx.moveTo(l, y);
    ctx.lineTo(w - r, y);
    ctx.stroke();
  }
}

function renderCandles() {
  const c =
    setupCanvas($('chartCanvas'));

  if (!c) return;

  const { ctx, w, h } = c;

  const series =
    state.candle.slice(-70);

  if (!series.length) {
    emptyCanvas(
      ctx, w, h,
      'Loading real exchange candles…'
    );
    return;
  }

  const l = 10;
  const r = 74;
  const t = 15;
  const b = 38;

  const W = w - l - r;
  const H = h - t - b;

  const hi = Math.max(
    ...series.map(d => d.high)
  );

  const lo = Math.min(
    ...series.map(d => d.low)
  );

  const pad = Math.max(
    (hi - lo) * 0.11,
    0.5
  );

  const min = lo - pad;
  const max = hi + pad;

  const y = p =>
    t + (max - p) * H / (max - min);

  const cw = W / series.length;

  grid(ctx, w, h, l, r, t, b);

  ctx.fillStyle = '#879ab1';
  ctx.font = '10px ui-monospace,monospace';

  for (let i = 0; i <= 5; i++) {
    const p =
      max - (max - min) * i / 5;

    ctx.fillText(
      money(p),
      w - r + 9,
      t + H * i / 5 + 3
    );
  }

  const maxVol = Math.max(
    0.001,
    ...series.map(d => d.volume)
  );

  for (
    let i = 0;
    i < series.length;
    i++
  ) {
    const bar = series[i];

    const x =
      l + (i + 0.5) * cw;

    const up =
      bar.close >= bar.open;

    ctx.fillStyle = up
      ? '#3ee8ab'
      : '#ff637b';

    ctx.strokeStyle = ctx.fillStyle;

    ctx.globalAlpha = 0.2;

    ctx.fillRect(
      x - cw * 0.3,
      h - b + 1,
      cw * 0.6,
      22 * bar.volume / maxVol
    );

    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.moveTo(x, y(bar.high));
    ctx.lineTo(x, y(bar.low));
    ctx.stroke();

    const yo = y(bar.open);
    const yc = y(bar.close);

    ctx.fillRect(
      x - Math.max(1, cw * 0.32),
      Math.min(yo, yc),
      Math.max(2, cw * 0.64),
      Math.max(1, Math.abs(yo - yc))
    );
  }

  // Overlay only actually received executions.
  const start = series[0].time;
  const last =
    series.at(-1).time + 60000;

  for (
    const tr of state.trades.slice(0, 130)
  ) {
    if (
      tr.time < start ||
      tr.time >= last
    ) {
      continue;
    }

    const x =
      l +
      ((tr.time - start) /
        (last - start)) * W;

    ctx.beginPath();

    ctx.arc(
      x,
      y(tr.price),
      Math.min(
        6,
        2 + Math.sqrt(tr.value / 5000)
      ),
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      tr.side === 'BUY'
        ? '#55b9ff99'
        : '#f3c97999';

    ctx.fill();
  }

  if (state.lastPrice) {
    ctx.strokeStyle = '#55b9ff';

    ctx.setLineDash([4, 5]);

    ctx.beginPath();
    ctx.moveTo(
      l,
      y(state.lastPrice)
    );

    ctx.lineTo(
      w - r,
      y(state.lastPrice)
    );

    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#91a7bc';

  ctx.fillText(
    tSast(series[0].time),
    l,
    h - 7
  );

  ctx.fillText(
    tSast(series.at(-1).time),
    w - r - 60,
    h - 7
  );
}

function renderHeatmap() {
  const c =
    setupCanvas($('heatCanvas'));

  if (!c) return;

  const { ctx, w, h } = c;

  if (!state.heat.length) {
    emptyCanvas(
      ctx, w, h,
      'Heatmap begins after synchronized depth snapshots…'
    );
    return;
  }

  const l = 10;
  const r = 80;
  const t = 12;
  const b = 28;

  const W = w - l - r;
  const H = h - t - b;

  const rows = 46;
  const cols = state.heat.length;
  const step = state.bucket;

  const mid =
    observedMid() ||
    state.heat.at(-1).mid;

  const anchor =
    Math.round(mid / step) * step;

  const dx =
    W / Math.max(95, cols);

  const dy =
    H / rows;

  const prepared =
    state.heat.map(s => {
      const map = new Map();

      for (
        const [side, list] of [
          ['bid', s.bids],
          ['ask', s.asks]
        ]
      ) {
        for (const [price, qty] of list) {
          const idx =
            Math.round(
              (anchor - price) / step
            ) +
            Math.floor(rows / 2);

          if (
            idx >= 0 &&
            idx < rows
          ) {
            const key =
              side + ':' + idx;

            map.set(
              key,
              (map.get(key) || 0) + qty
            );
          }
        }
      }

      return map;
    });

  let maxQ = 0;

  for (const m of prepared) {
    for (const q of m.values()) {
      maxQ = Math.max(maxQ, q);
    }
  }

  ctx.fillStyle = '#0b1524';

  ctx.fillRect(
    l, t, W, H
  );

  prepared.forEach((m, i) => {
    const x =
      l + (95 - cols + i) * dx;

    for (const [key, q] of m) {
      const [side, idx] =
        key.split(':');

      const alpha =
        0.13 +
        0.87 * Math.sqrt(
          q / Math.max(maxQ, 0.001)
        );

      ctx.fillStyle =
        side === 'bid'
          ? `rgba(45,232,165,${alpha})`
          : `rgba(255,100,126,${alpha})`;

      ctx.fillRect(
        x,
        t + N(idx) * dy,
        Math.ceil(dx) + 0.2,
        dy + 0.3
      );
    }
  });

  ctx.font =
    '10px ui-monospace,monospace';

  ctx.fillStyle = '#a1b5cc';
  ctx.strokeStyle = '#203148';

  for (
    let j = 0;
    j <= rows;
    j += 5
  ) {
    const y = t + j * dy;

    ctx.beginPath();
    ctx.moveTo(l, y);
    ctx.lineTo(w - r, y);
    ctx.stroke();

    ctx.fillText(
      money(
        anchor +
        (Math.floor(rows / 2) - j) * step
      ),
      w - r + 7,
      y + 3
    );
  }

  ctx.strokeStyle = '#f3c979';
  ctx.setLineDash([3, 4]);

  ctx.beginPath();

  ctx.moveTo(
    l,
    t + rows / 2 * dy
  );

  ctx.lineTo(
    w - r,
    t + rows / 2 * dy
  );

  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#8298b2';

  ctx.fillText(
    tSast(state.heat[0].time),
    l,
    h - 8
  );

  ctx.fillText(
    tSast(state.heat.at(-1).time),
    w - r - 65,
    h - 8
  );

  if (state.heatPaused) {
    ctx.fillStyle = '#f3c979';
    ctx.font = 'bold 12px sans-serif';

    ctx.fillText(
      'PAUSED',
      l + 14,
      t + 18
    );
  }
}

function renderCVD() {
  const c =
    setupCanvas($('cvdCanvas'));

  if (!c) return;

  const { ctx, w, h } = c;

  const points =
    state.cvdPoints;

  if (!points.length) {
    emptyCanvas(
      ctx, w, h,
      'CVD starts when trade messages arrive…'
    );
    return;
  }

  const l = 13;
  const r = 76;
  const t = 12;
  const b = 27;

  const W = w - l - r;
  const H = h - t - b;

  const nums =
    points.map(x => x.cvd);

  const high = Math.max(
    0,
    ...nums
  );

  const low = Math.min(
    0,
    ...nums
  );

  const pad = Math.max(
    (high - low) * 0.15,
    0.01
  );

  const max = high + pad;
  const min = low - pad;

  const y = v =>
    t +
    (max - v) * H / (max - min);

  const x = i =>
    l +
    i * W / Math.max(
      1,
      points.length - 1
    );

  grid(ctx, w, h, l, r, t, b);

  ctx.strokeStyle = '#385268';
  ctx.setLineDash([3, 5]);

  ctx.beginPath();

  ctx.moveTo(l, y(0));
  ctx.lineTo(w - r, y(0));
  ctx.stroke();

  ctx.setLineDash([]);

  ctx.beginPath();

  points.forEach((p, i) => {
    if (i) {
      ctx.lineTo(
        x(i),
        y(p.cvd)
      );
    } else {
      ctx.moveTo(
        x(i),
        y(p.cvd)
      );
    }
  });

  ctx.lineWidth = 2;

  ctx.strokeStyle =
    points.at(-1).cvd >= 0
      ? '#3ee8ab'
      : '#ff637b';

  ctx.stroke();

  ctx.fillStyle = '#98aac1';
  ctx.font = '10px monospace';

  for (let i = 0; i <= 4; i++) {
    ctx.fillText(
      vol(
        max - (max - min) * i / 4
      ),
      w - r + 9,
      t + H * i / 4 + 3
    );
  }

  ctx.fillText(
    tSast(points[0].time),
    l,
    h - 6
  );

  ctx.fillText(
    tSast(points.at(-1).time),
    w - r - 64,
    h - 6
  );
}

function draw() {
  renderMetrics();
  renderBook();
  renderTape();
  renderEvents();
  renderFootprint();

  renderCandles();
  renderHeatmap();
  renderCVD();
}

// USER CONTROLS

$('connectBtn').addEventListener(
  'click',
  () =>
    state.ws && !state.manual
      ? disconnect()
      : connect()
);

$('pauseBtn').addEventListener(
  'click',
  () => {
    state.heatPaused =
      !state.heatPaused;

    $('pauseBtn').textContent =
      state.heatPaused
        ? 'RESUME HEATMAP'
        : 'PAUSE HEATMAP';
  }
);

$('bucket').addEventListener(
  'change',
  e => {
    state.bucket =
      N(e.target.value) || 1;

    state.heat = [];

    eventLog(
      'Heatmap bucket changed',
      'History restarted at new price resolution'
    );
  }
);

$('threshold').addEventListener(
  'change',
  e => {
    state.alertThreshold = Math.max(
      100,
      N(e.target.value) || 10000
    );

    e.target.value =
      state.alertThreshold;
  }
);

$('clearBtn').addEventListener(
  'click',
  () => {
    state.events = [];
    renderEvents();
  }
);

$('notifyBtn').addEventListener(
  'click',
  async () => {
    if (!('Notification' in window)) {
      eventLog(
        'Notifications unavailable',
        'Browser does not support notifications',
        'red'
      );
      return;
    }

    const result =
      await Notification.requestPermission();

    state.notifications =
      result === 'granted';

    $('notifyBtn').textContent =
      state.notifications
        ? 'ALERTS ON'
        : 'ALERTS DISABLED';

    if (state.notifications) {
      eventLog(
        'Browser alerts enabled',
        'Fires on large real executions while tab is hidden'
      );
    }
  }
);

// LIVE TERMINAL REFRESH
setInterval(() => {
  if (state.active) {
    cleanVolume();
    sampleBook();
  }

  draw();
}, 1000);

// OPTIONAL SPOT GOLD
setInterval(
  refreshSpot,
  65000
);

// RESPONSIVE DRAWING
window.addEventListener(
  'resize',
  () => {
    renderCandles();
    renderHeatmap();
    renderCVD();
  }
);

// CLEAN SOCKET CLOSURE
window.addEventListener(
  'beforeunload',
  () => {
    state.manual = true;

    if (state.ws) {
      state.ws.close();
    }
  }
);

// BOOT
refreshSpot();
draw();
connect();