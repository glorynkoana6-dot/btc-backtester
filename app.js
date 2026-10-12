
/*
 MKAYFX BLACKBOOK X2 — Browser engine
 Binance PAXG/USDT public market data (NOT XAUUSD futures).
 Trade ideas are rule-based research, not executable orders.
*/

(() => {
  "use strict";

  const SYMBOL = "paxgusdt";
  const CHANNELS = `${SYMBOL}@trade/${SYMBOL}@depth20@100ms/${SYMBOL}@kline_1m`;
  const STREAM = `wss://data-stream.binance.vision:443/stream?streams=${CHANNELS}`;
  const STREAM_BACKUP = `wss://stream.binance.com:443/stream?streams=${CHANNELS}`;

  const $ = id => document.getElementById(id);
  const n = v => Number(v);
  const valid = v => Number.isFinite(v) && v > 0;

  const fmt = (v, d = 2) =>
    Number.isFinite(v)
      ? v.toLocaleString("en-US", {
          minimumFractionDigits: d,
          maximumFractionDigits: d
        })
      : "—";

  const compact = v =>
    !Number.isFinite(v)
      ? "—"
      : Math.abs(v) >= 1e6
        ? fmt(v / 1e6, 2) + "M"
        : Math.abs(v) >= 1000
          ? fmt(v / 1000, 1) + "K"
          : fmt(v);

  const signed = (v, d = 3) =>
    Number.isFinite(v)
      ? (v > 0 ? "+" : "") + fmt(v, d)
      : "—";

  const clock = t =>
    new Date(t).toLocaleTimeString("en-GB", {
      timeZone: "Africa/Johannesburg",
      hour12: false
    });

  const esc = x =>
    String(x).replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);

  const clamp = (x, a, b) =>
    Math.max(a, Math.min(b, x));

  const s = {
    start: Date.now(),
    mode: "connecting",
    lastFrame: 0,
    lastDepth: 0,
    lastLiveTrade: 0,
    price: NaN,
    priceAt: 0,
    ticker: null,

    book: {
      bids: [],
      asks: []
    },

    candles: [],
    trades: [],
    ids: new Set(),
    idQueue: [],
    heat: [],
    lastHeat: 0,

    cvd: 0,
    liveCount: 0,
    events: [],
    xau: null,

    threshold: 10000,
    bucket: 1,
    scoreMin: 75,
    rr: 1.8,

    alerts: false,
    active: null,
    lastIdeaBar: 0,
    lastAlert: 0,

    decision: "Waiting for market data",
    decisionScore: null,
    decisionChecks: [],

    trend: "—",
    atr: NaN,
    pressure: NaN,
    depthShare: NaN
  };

  let socket = null;
  let polling = null;
  let reconnect = null;
  let busy = false;
  let attempts = 0;
  let rendering = null;
  let xauPolling = null;
  let toastTimer = null;
  let stopped = false;

  // ================================
  // EVENT JOURNAL
  // ================================

  function log(title, detail = "", type = "info") {
    s.events.unshift({
      at: Date.now(),
      title,
      detail,
      type
    });

    s.events.length = Math.min(
      s.events.length,
      100
    );

    $("events").innerHTML =
      s.events.slice(0, 35).map(e => `
        <div class="event ${e.type}">
          <time>${clock(e.at)}</time>
          <div>
            <b>${esc(e.title)}</b>
            <p>${esc(e.detail)}</p>
          </div>
        </div>
      `).join("");
  }

  function toast(msg) {
    const el = $("toast");

    el.textContent = msg;
    el.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(
      () => el.classList.remove("show"),
      4300
    );
  }

  function renderSoon() {
    if (rendering) return;

    rendering = setTimeout(() => {
      rendering = null;
      render();
    }, 250);
  }

  // ================================
  // ORDER BOOK PROCESSING
  // ================================

  function ingestBook(obj) {
    if (
      !Array.isArray(obj?.bids) ||
      !Array.isArray(obj?.asks)
    ) {
      return;
    }

    const parse = (rows, desc) =>
      rows
        .map(x => ({
          p: n(x[0]),
          q: n(x[1])
        }))
        .filter(x =>
          valid(x.p) && valid(x.q)
        )
        .sort((a, b) =>
          desc
            ? b.p - a.p
            : a.p - b.p
        )
        .slice(0, 20);

    const bids = parse(obj.bids, true);
    const asks = parse(obj.asks, false);

    if (
      !bids.length ||
      !asks.length ||
      bids[0].p >= asks[0].p
    ) {
      return;
    }

    s.book = { bids, asks };
    s.lastDepth = Date.now();

    if (!valid(s.price)) {
      s.price = (
        bids[0].p + asks[0].p
      ) / 2;
    }

    if (Date.now() - s.lastHeat > 2000) {
      s.lastHeat = Date.now();

      s.heat.push({
        bids: bids.map(x => ({ ...x })),
        asks: asks.map(x => ({ ...x })),
        at: Date.now()
      });

      if (s.heat.length > 70) {
        s.heat.shift();
      }
    }

    renderSoon();
  }

  // ================================
  // EXECUTED TRADE PROCESSING
  // ================================

  function ingestTrade(t, fromRest = false) {
    const id = String(
      t.t ?? t.id ?? ""
    );

    const price = n(
      t.p ?? t.price
    );

    const qty = n(
      t.q ?? t.qty
    );

    const at = n(
      t.T ?? t.time
    );

    if (
      !id ||
      !valid(price) ||
      !valid(qty) ||
      !Number.isFinite(at) ||
      s.ids.has(id)
    ) {
      return;
    }

    s.ids.add(id);
    s.idQueue.push(id);

    if (s.idQueue.length > 3500) {
      s.ids.delete(
        s.idQueue.shift()
      );
    }

    // Binance m=false:
    // Aggressor is the buyer.
    // Binance m=true:
    // Aggressor is the seller.

    const buy = t.m === false;

    const trade = {
      id,
      price,
      qty,
      at,
      buy,
      notional: price * qty,
      live: !fromRest
    };

    s.trades.push(trade);

    s.trades.sort(
      (a, b) =>
        b.at - a.at ||
        n(b.id) - n(a.id)
    );

    s.trades.length = Math.min(
      600,
      s.trades.length
    );

    if (at >= s.priceAt) {
      s.price = price;
      s.priceAt = at;
    }

    if (
      !fromRest &&
      at >= s.start
    ) {
      s.cvd += buy ? qty : -qty;
      s.liveCount++;
      s.lastLiveTrade = Date.now();

      if (
        trade.notional >= s.threshold &&
        Date.now() - s.lastAlert >= 1300
      ) {
        s.lastAlert = Date.now();

        const detail =
          `${buy ? "BUY" : "SELL"} ` +
          `${fmt(trade.notional, 0)} USDT ` +
          `@ ${fmt(price)}`;

        log(
          "Large executed PAXG trade",
          detail,
          "warn"
        );

        if (s.alerts) {
          toast(
            "LARGE TRADE · " + detail
          );
        }
      }
    }

    renderSoon();
  }

  // ================================
  // CANDLE PROCESSING
  // ================================

  function ingestCandle(c) {
    const bar = {
      t: n(c.t),
      o: n(c.o),
      h: n(c.h),
      l: n(c.l),
      c: n(c.c),
      v: n(c.v),
      closed: !!c.closed
    };

    if (
      ![
        bar.t,
        bar.o,
        bar.h,
        bar.l,
        bar.c,
        bar.v
      ].every(Number.isFinite) ||
      ![
        bar.o,
        bar.h,
        bar.l,
        bar.c
      ].every(valid) ||
      bar.h < bar.l
    ) {
      return;
    }

    const i = s.candles.findIndex(
      x => x.t === bar.t
    );

    if (i === -1) {
      s.candles.push(bar);
    } else {
      s.candles[i] = {
        ...bar,
        closed:
          s.candles[i].closed ||
          bar.closed
      };
    }

    s.candles.sort(
      (a, b) => a.t - b.t
    );

    if (s.candles.length > 150) {
      s.candles =
        s.candles.slice(-150);
    }

    renderSoon();
  }

  // ================================
  // LIVE WEBSOCKET MESSAGES
  // ================================

  function onFeed(message) {
    let d;

    try {
      const raw = JSON.parse(message);
      d = raw.data || raw;
    } catch (_) {
      return;
    }

    if (!d) return;

    s.lastFrame = Date.now();

    if (d.e === "trade") {
      ingestTrade(d);

    } else if (
      Array.isArray(d.bids) &&
      Array.isArray(d.asks)
    ) {
      ingestBook(d);

    } else if (
      d.e === "kline" &&
      d.k
    ) {
      const k = d.k;

      ingestCandle({
        t: k.t,
        o: k.o,
        h: k.h,
        l: k.l,
        c: k.c,
        v: k.v,
        closed: k.x
      });
    }

    updateConnection();
  }

  // ================================
  // HTTP FALLBACK
  // ================================

  function stopPolling() {
    clearInterval(polling);
    polling = null;
  }

  function beginPolling() {
    if (
      stopped ||
      document.hidden
    ) {
      return;
    }

    s.mode = "poll";

    if (!polling) {
      fetchMarket();

      polling = setInterval(
        fetchMarket,
        12000
      );
    }

    updateConnection();
  }

  async function fetchMarket() {
    if (busy || stopped) return;

    busy = true;

    try {
      const response = await fetch(
        "/api/market",
        {
          cache: "no-store"
        }
      );

      const d = await response.json();

      if (
        !response.ok ||
        !d.ok
      ) {
        throw Error(
          (d.errors || []).join("; ") ||
          "No public data"
        );
      }

      if (Array.isArray(d.candles)) {
        d.candles.forEach(
          ingestCandle
        );
      }

      if (
        d.depth &&
        s.mode !== "ws"
      ) {
        ingestBook(d.depth);
      }

      if (Array.isArray(d.trades)) {
        d.trades.forEach(
          t => ingestTrade(t, true)
        );
      }

      if (d.ticker) {
        s.ticker = d.ticker;
      }

      if (
        !valid(s.price) &&
        valid(n(d.ticker?.lastPrice))
      ) {
        s.price = n(
          d.ticker.lastPrice
        );
      }

      if (s.mode !== "ws") {
        s.mode = "poll";
        s.lastFrame = Date.now();
      }

      renderSoon();
      updateConnection();

    } catch (e) {
      if (s.mode !== "ws") {
        s.mode = "error";
      }

      log(
        "HTTP snapshot failed",
        e.message ||
        "Exchange request failed",
        "bad"
      );

      updateConnection();

    } finally {
      busy = false;
    }
  }

  // ================================
  // SEPARATE XAU/USD REFERENCE
  // ================================

  async function fetchXau() {
    if (stopped) return;

    try {
      const response = await fetch(
        "/api/xau",
        {
          cache: "no-store"
        }
      );

      const d = await response.json();

      if (
        d.ok &&
        valid(n(d.price))
      ) {
        s.xau = d;

        $("xauPrice").textContent =
          fmt(n(d.price));

        $("xauInfo").textContent =
          `1m candle · ${d.candleUTC} UTC`;

      } else {
        $("xauInfo").textContent =
          d.error ||
          "Reference unavailable";
      }

    } catch (_) {
      $("xauInfo").textContent =
        "Reference unavailable";
    }
  }

  // ================================
  // WEBSOCKET CONNECTION
  // ================================

  function connect() {
    if (
      stopped ||
      document.hidden ||
      socket
    ) {
      return;
    }

    if (
      typeof WebSocket === "undefined"
    ) {
      log(
        "WebSocket unavailable",
        "Using public REST snapshots",
        "warn"
      );

      beginPolling();
      return;
    }

    attempts++;

    const url =
      attempts % 2
        ? STREAM
        : STREAM_BACKUP;

    let ws;

    try {
      ws = new WebSocket(url);
    } catch (e) {
      log(
        "WebSocket setup failed",
        e.message,
        "warn"
      );

      beginPolling();
      retry();
      return;
    }

    socket = ws;
    let opened = false;

    const timeout = setTimeout(() => {
      if (
        !opened &&
        socket === ws
      ) {
        ws.close();
      }
    }, 9000);

    ws.onopen = () => {
      if (socket !== ws) return;

      opened = true;
      clearTimeout(timeout);

      attempts = 0;
      s.mode = "ws";
      s.lastFrame = Date.now();

      stopPolling();

      log(
        "WebSocket connected",
        "Binance PAXG trades / top-20 book / M1 candles",
        "good"
      );

      updateConnection();
    };

    ws.onmessage = ev => {
      if (socket === ws) {
        onFeed(ev.data);
      }
    };

    ws.onerror = () => {
      if (socket === ws) {
        ws.close();
      }
    };

    ws.onclose = () => {
      clearTimeout(timeout);

      if (socket !== ws) {
        return;
      }

      socket = null;

      if (
        !stopped &&
        !document.hidden
      ) {
        log(
          "Stream disconnected",
          "Switching to REST and retrying",
          "warn"
        );

        beginPolling();
        retry();
      }
    };
  }

  function retry() {
    if (
      stopped ||
      document.hidden ||
      reconnect
    ) {
      return;
    }

    reconnect = setTimeout(() => {
      reconnect = null;
      connect();
    }, Math.min(
      3000 * Math.pow(
        2,
        Math.min(attempts, 4)
      ),
      45000
    ));
  }

  function disconnect() {
    clearTimeout(reconnect);
    reconnect = null;

    stopPolling();

    if (socket) {
      const old = socket;
      socket = null;

      try {
        old.close();
      } catch (_) {
        // Ignore close error.
      }
    }
  }

  function restart() {
    disconnect();

    stopped = false;
    s.mode = "connecting";
    s.lastDepth = 0;
    s.lastLiveTrade = 0;

    updateConnection();

    fetchMarket();
    connect();
  }

  // ================================
  // CONNECTION HEALTH
  // ================================

  function updateConnection() {
    const age =
      Date.now() - s.lastFrame;

    const live =
      s.mode === "ws" &&
      age < 35000;

    const poll =
      s.mode === "poll" &&
      age < 30000;

    const tag = $("connection");

    tag.className =
      "pill" +
      (
        live
          ? " live"
          : poll
            ? ""
            : s.mode === "connecting"
              ? ""
              : " off"
      );

    $("connectionText").textContent =
      live
        ? "LIVE STREAM"
        : poll
          ? "REST FALLBACK"
          : s.mode === "connecting"
            ? "CONNECTING"
            : "OFFLINE";

    $("freshness").textContent =
      live
        ? `${Math.round(age / 1000)}s stream · book ${
            s.lastDepth
              ? Math.round(
                  (Date.now() - s.lastDepth) / 1000
                ) + "s"
              : "waiting"
          }`
        : poll
          ? "REST ONLY · signals paused"
          : "OFFLINE · signals paused";

    $("marketMode").textContent =
      live
        ? "LIVE"
        : poll
          ? "POLLING"
          : "DATA UNAVAILABLE";
  }

  // ================================
  // BLACKBOOK X2 SIGNAL ENGINE
  // ================================

  /*
    Strictly completed 1-minute candles.

    Signals require:
    - EMA trend alignment
    - Breakout or liquidity sweep
    - Strong directional candle
    - Current resting book agreement
    - Live taker-volume agreement
    - Acceptable spread
    - No excessive entry chase

    Scores are NOT calibrated probabilities.
  */

  function ema(bars, length) {
    if (
      bars.length < length
    ) {
      return NaN;
    }

    let value =
      bars.slice(0, length).reduce(
        (sum, b) => sum + b.c,
        0
      ) / length;

    const a = 2 / (length + 1);

    for (
      let i = length;
      i < bars.length;
      i++
    ) {
      value += (
        bars[i].c - value
      ) * a;
    }

    return value;
  }

  function atr(bars, length = 14) {
    if (
      bars.length < length + 1
    ) {
      return NaN;
    }

    const tr = [];

    for (
      let i = 1;
      i < bars.length;
      i++
    ) {
      tr.push(
        Math.max(
          bars[i].h - bars[i].l,
          Math.abs(
            bars[i].h -
            bars[i - 1].c
          ),
          Math.abs(
            bars[i].l -
            bars[i - 1].c
          )
        )
      );
    }

    return tr.slice(-length).reduce(
      (a, b) => a + b,
      0
    ) / length;
  }

  function depthStats() {
    const bids =
      s.book.bids.slice(0, 15).reduce(
        (a, b) => a + b.q,
        0
      );

    const asks =
      s.book.asks.slice(0, 15).reduce(
        (a, b) => a + b.q,
        0
      );

    return bids + asks
      ? bids / (bids + asks)
      : NaN;
  }

  function tradeStats() {
    /*
      Only browser WebSocket events count as
      fresh trade confirmation.

      REST backfill is not treated as an
      uninterrupted execution stream.
    */

    const recent = s.trades.filter(
      t =>
        t.live &&
        t.at >= Math.max(
          s.start,
          Date.now() - 90000
        )
    );

    const buy = recent
      .filter(t => t.buy)
      .reduce(
        (a, b) => a + b.qty,
        0
      );

    const sell = recent
      .filter(t => !t.buy)
      .reduce(
        (a, b) => a + b.qty,
        0
      );

    return {
      count: recent.length,
      buy,
      sell,
      share:
        buy + sell
          ? buy / (buy + sell)
          : NaN
    };
  }

  function freshnessError(lastClosed) {
    if (
      s.mode !== "ws" ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return "No fresh WebSocket order-flow confirmation";
    }

    if (
      Date.now() - s.lastFrame > 12000
    ) {
      return "Stream has stopped updating";
    }

    if (
      Date.now() - s.lastDepth > 12000
    ) {
      return "Order-book snapshot is stale";
    }

    if (
      Date.now() - s.lastLiveTrade > 45000
    ) {
      return "Recent executed trades are missing";
    }

    if (
      !lastClosed ||
      Date.now() -
        (lastClosed.t + 60000) > 105000
    ) {
      return "Completed 1m candle is stale";
    }

    if (
      !valid(s.price) ||
      Date.now() - s.priceAt > 45000
    ) {
      return "Latest traded price is stale";
    }

    return "";
  }

  // ================================
  // SCORING CANDIDATES
  // ================================

  function makeCandidate(side, context) {
    const {
      last,
      prev,
      ema9,
      ema21,
      currentAtr,
      share,
      taker,
      volRatio,
      spread
    } = context;

    const buy = side === "BUY";
    const dir = buy ? 1 : -1;

    const body =
      Math.abs(last.c - last.o) /
      Math.max(
        last.h - last.l,
        1e-10
      );

    const high = Math.max(
      ...prev.map(x => x.h)
    );

    const low = Math.min(
      ...prev.map(x => x.l)
    );

    const breakout = buy
      ? last.c > high &&
        last.o <= high &&
        last.c > last.o
      : last.c < low &&
        last.o >= low &&
        last.c < last.o;

    const sweep = buy
      ? last.l < low &&
        last.c > low &&
        last.c > last.o
      : last.h > high &&
        last.c < high &&
        last.c < last.o;

    const trigger =
      breakout
        ? "CONFIRMED BREAKOUT"
        : sweep
          ? "SWEEP REJECTION"
          : "NONE";

    const trend = buy
      ? ema9 > ema21
      : ema9 < ema21;

    const bookOK = buy
      ? share >= .55
      : share <= .45;

    const pressureOK =
      taker.count >= 4 &&
      (
        buy
          ? taker.share >= .56
          : taker.share <= .44
      );

    const candleOK =
      body >= .42 &&
      (
        buy
          ? last.c > last.o
          : last.c < last.o
      );

    const spreadOK =
      Number.isFinite(spread) &&
      spread >= 0 &&
      spread <= currentAtr * .65;

    const closeDist = Math.abs(
      s.price - last.c
    );

    const chaseOK =
      (s.price - last.c) * dir <=
        currentAtr * .35 &&
      closeDist <=
        currentAtr * .8;

    // 100 total possible points.

    const score =
      (trend ? 15 : 0) +
      (trigger !== "NONE" ? 23 : 0) +
      (candleOK ? 12 : 0) +
      (bookOK ? 20 : 0) +
      (pressureOK ? 20 : 0) +
      (volRatio >= 1 ? 5 : 0) +
      (spreadOK ? 5 : 0);

    const checks = [
      ["Trend aligned", trend],
      [
        "Completed candle trigger",
        trigger !== "NONE"
      ],
      ["Candle body", candleOK],
      ["Visible book agrees", bookOK],
      ["Live taker flow agrees", pressureOK],
      ["Spread acceptable", spreadOK],
      ["Not chasing price", chaseOK]
    ];

    const qualified =
      trend &&
      trigger !== "NONE" &&
      candleOK &&
      bookOK &&
      pressureOK &&
      spreadOK &&
      chaseOK &&
      score >= s.scoreMin;

    if (!qualified) {
      return {
        side,
        score,
        trigger,
        checks,
        qualified: false
      };
    }

    // Latest observed trade price is only
    // an indicative entry reference.

    const entry = s.price;

    const previousBars =
      s.candles
        .filter(x =>
          x.closed &&
          x.t < last.t
        )
        .slice(-5);

    const structural = buy
      ? Math.min(
          last.l,
          ...previousBars.map(x => x.l)
        )
      : Math.max(
          last.h,
          ...previousBars.map(x => x.h)
        );

    const referenceStop =
      structural -
      dir * currentAtr * .18;

    const distance = buy
      ? entry - referenceStop
      : referenceStop - entry;

    const risk = Math.max(
      currentAtr * .95,
      distance
    );

    if (
      !valid(risk) ||
      risk > currentAtr * 2.8
    ) {
      return {
        side,
        score,
        trigger,
        checks: [
          ...checks,
          ["Stop distance reasonable", false]
        ],
        qualified: false
      };
    }

    const stop =
      entry - dir * risk;

    const target =
      entry + dir * risk * s.rr;

    if (
      ![
        entry,
        stop,
        target
      ].every(valid)
    ) {
      return {
        side,
        score,
        trigger,
        checks,
        qualified: false
      };
    }

    return {
      side,
      score,
      trigger,
      checks,
      qualified: true,
      entry,
      stop,
      target,
      rr: s.rr,

      reason:
        `${trigger.toLowerCase()} · ` +
        `EMA trend aligned · ` +
        `${fmt(share * 100, 1)}% ` +
        `bid-side book · ` +
        `${fmt(taker.share * 100, 1)}% ` +
        `taker-buy share`
    };
  }

  // ================================
  // AUTOMATIC SIGNAL EVALUATION
  // ================================

  function evaluate() {
    const complete =
      s.candles.filter(
        b =>
          b.closed &&
          b.t + 60000 <= Date.now()
      );

    const last =
      complete.at(-1);

    s.atr = atr(complete);

    const e9 = ema(
      complete,
      9
    );

    const e21 = ema(
      complete,
      21
    );

    s.trend =
      !Number.isFinite(e9) ||
      !Number.isFinite(e21)
        ? "—"
        : e9 > e21
          ? "UP"
          : e9 < e21
            ? "DOWN"
            : "FLAT";

    s.depthShare = depthStats();

    const taker = tradeStats();
    s.pressure = taker.share;

    $("trend").textContent =
      s.trend;

    $("atr").textContent =
      fmt(s.atr, 2);

    $("pressure").textContent =
      Number.isFinite(taker.share)
        ? `${fmt(taker.share * 100, 1)}% BUY (${taker.count} trades)`
        : "WAITING";

    $("bookBias").textContent =
      Number.isFinite(s.depthShare)
        ? `${fmt(s.depthShare * 100, 1)}% bids`
        : "WAITING";

    if (s.active) {
      /*
        Ideas expire after four minutes.

        No fill is assumed.
        No historical win/loss is fabricated.
      */

      if (
        Date.now() -
          s.active.createdAt >
        4 * 60000
      ) {
        log(
          "Trade idea expired",
          `${s.active.side} ` +
          `${fmt(s.active.entry)} — ` +
          `not an executed order`,
          "warn"
        );

        s.active = null;

      } else {
        showSignal();
        return;
      }
    }

    if (
      complete.length < 35 ||
      !valid(s.atr)
    ) {
      s.decision =
        "Need at least 35 completed 1-minute candles";

      s.decisionScore = null;
      s.decisionChecks = [];

      showSignal();
      return;
    }

    const stale = freshnessError(
      last
    );

    if (stale) {
      s.decision = stale;
      s.decisionScore = null;

      s.decisionChecks = [
        [
          "Fresh exchange inputs",
          false
        ]
      ];

      showSignal();
      return;
    }

    const prev =
      complete.slice(-13, -1);

    if (prev.length < 12) {
      return;
    }

    const vol =
      complete
        .slice(-21, -1)
        .reduce(
          (a, b) => a + b.v,
          0
        ) / 20;

    const bid =
      s.book.bids[0]?.p;

    const ask =
      s.book.asks[0]?.p;

    const spread =
      valid(bid) && valid(ask)
        ? ask - bid
        : NaN;

    const ctx = {
      last,
      prev,
      ema9: e9,
      ema21: e21,
      currentAtr: s.atr,
      share: s.depthShare,
      taker,
      volRatio:
        vol > 0
          ? last.v / vol
          : 0,
      spread
    };

    const candidates = [
      makeCandidate("BUY", ctx),
      makeCandidate("SELL", ctx)
    ].sort(
      (a, b) =>
        b.score - a.score
    );

    const winner =
      candidates[0];

    s.decisionScore =
      winner.score;

    s.decisionChecks =
      winner.checks;

    if (
      winner.qualified &&
      s.lastIdeaBar !== last.t
    ) {
      s.lastIdeaBar = last.t;

      s.active = {
        ...winner,
        candleAt: last.t,
        createdAt: Date.now()
      };

      log(
        `${winner.side} research idea`,
        `Entry ~${fmt(winner.entry)} · ` +
        `SL ${fmt(winner.stop)} · ` +
        `TP ${fmt(winner.target)} · ` +
        `Score ${winner.score}/100`,
        "good"
      );

      if (s.alerts) {
        toast(
          `${winner.side} IDEA · ` +
          `PAXG/USDT · ` +
          `${winner.score}/100`
        );
      }

    } else {
      const failed =
        winner.checks
          .filter(x => !x[1])
          .map(x => x[0]);

      s.decision =
        failed.length
          ? `No confirmed setup: ${
              failed.slice(0, 3).join(", ")
            }`
          : "Score below threshold / waiting for next candle";
    }

    showSignal();
  }

  // ================================
  // SIGNAL PANEL RENDERER
  // ================================

  function showSignal() {
    const idea = s.active;

    $("direction").textContent =
      idea
        ? `${idea.side} IDEA`
        : "NO TRADE";

    $("direction").className =
      "direction " +
      (
        idea
          ? idea.side === "BUY"
            ? "positive"
            : "negative"
          : ""
      );

    $("signalBadge").textContent =
      idea
        ? "IDEA ACTIVE"
        : "WAITING FOR CONFLUENCE";

    $("signalReason").textContent =
      idea
        ? idea.reason
        : s.decision;

    $("score").textContent =
      idea
        ? idea.score
        : Number.isFinite(
            s.decisionScore
          )
          ? s.decisionScore
          : "—";

    $("entry").textContent =
      idea
        ? fmt(idea.entry)
        : "—";

    $("stop").textContent =
      idea
        ? fmt(idea.stop)
        : "—";

    $("target").textContent =
      idea
        ? fmt(idea.target)
        : "—";

    $("riskReward").textContent =
      idea
        ? `1 : ${fmt(idea.rr, 1)}`
        : "—";

    $("signalTime").textContent =
      idea
        ? `Trigger candle ${
            clock(
              idea.candleAt + 60000
            )
          } SAST`
        : "Last evaluation: " +
          clock(Date.now());

    $("signalStatus").textContent =
      idea
        ? "Reference levels only · expires after 4 minutes"
        : "No broker order placed";

    const checks =
      idea
        ? idea.checks
        : s.decisionChecks;

    $("checks").innerHTML =
      checks.length
        ? checks.map(
            ([name, ok]) => `
              <span class="check ${ok ? "ok" : "fail"}">
                ${ok ? "✓" : "×"}
                ${esc(name)}
              </span>
            `
          ).join("")
        : '<span class="check">Waiting for market observations</span>';
  }

  // ================================
  // ORDER BOOK RENDERER
  // ================================

  function bookRows(
    id,
    data,
    color
  ) {
    const top =
      data.slice(0, 15);

    const max = Math.max(
      .000001,
      ...top.map(x => x.q)
    );

    $(id).innerHTML =
      top.length
        ? top.map(x => `
            <div
              class="book-row"
              style="
                --fill:${
                  clamp(
                    100 * x.q / max,
                    0,
                    100
                  )
                }%;
                --bar:${color}
              "
            >
              <b>${fmt(x.p)}</b>
              <em>${fmt(x.q, 4)}</em>
            </div>
          `).join("")
        : '<div class="empty">No visible depth</div>';
  }

  // ================================
  // LIVE TRADE TAPE
  // ================================

  function renderTape() {
    $("tradeCount").textContent =
      `${s.liveCount} LIVE EVENTS`;

    $("tape").innerHTML =
      s.trades.length
        ? s.trades.slice(0, 50).map(t => `
            <div class="tape-row">
              <span>${clock(t.at)}</span>

              <b class="${t.buy ? "bull" : "bear"}">
                ${t.buy ? "BUY" : "SELL"}
              </b>

              <span>${fmt(t.price)}</span>
              <span>${compact(t.notional)}</span>
            </div>
          `).join("")
        : '<div class="empty">Waiting for actual trades…</div>';
  }

  // ================================
  // FOOTPRINT RENDERER
  // ================================

  function renderFootprint() {
    const data =
      s.trades.filter(
        t =>
          t.at >=
          Date.now() - 180000
      );

    const levels =
      new Map();

    for (const t of data) {
      const key =
        Math.floor(
          t.price / s.bucket
        ) * s.bucket;

      const p =
        levels.get(key) || {
          buy: 0,
          sell: 0
        };

      p[t.buy ? "buy" : "sell"] +=
        t.qty;

      levels.set(key, p);
    }

    const selected =
      [...levels]
        .sort(
          (a, b) =>
            (
              b[1].buy +
              b[1].sell
            ) -
            (
              a[1].buy +
              a[1].sell
            )
        )
        .slice(0, 14)
        .sort(
          (a, b) =>
            b[0] - a[0]
        );

    $("footprint").innerHTML =
      selected.length
        ? selected.map(
            ([p, v]) => `
              <div class="foot-row">
                <span>${fmt(p)}</span>

                <span class="bear">
                  ${fmt(v.sell, 3)}
                </span>

                <span class="bull">
                  ${fmt(v.buy, 3)}
                </span>

                <span class="${
                  v.buy >= v.sell
                    ? "bull"
                    : "bear"
                }">
                  ${signed(
                    v.buy - v.sell,
                    3
                  )}
                </span>
              </div>
            `
          ).join("")
        : '<div class="empty">Waiting for observed trades…</div>';
  }

  // ================================
  // CANVAS UTILITIES
  // ================================

  function canvas(id) {
    const element = $(id);
    const box =
      element.getBoundingClientRect();

    if (
      box.width < 2 ||
      box.height < 2
    ) {
      return null;
    }

    const dpr =
      Math.min(
        window.devicePixelRatio || 1,
        2
      );

    element.width =
      Math.round(
        box.width * dpr
      );

    element.height =
      Math.round(
        box.height * dpr
      );

    const ctx =
      element.getContext("2d");

    ctx.scale(dpr, dpr);

    return {
      ctx,
      w: box.width,
      h: box.height
    };
  }

  function textCenter(
    c,
    message
  ) {
    c.ctx.fillStyle = "#849bb8";
    c.ctx.font = "12px system-ui";
    c.ctx.textAlign = "center";

    c.ctx.fillText(
      message,
      c.w / 2,
      c.h / 2
    );

    c.ctx.textAlign = "left";
  }

  // ================================
  // CANDLESTICK CHART
  // ================================

  function drawCandles() {
    const g = canvas(
      "candles"
    );

    if (!g) return;

    const { ctx, w, h } = g;
    const bars =
      s.candles.slice(-65);

    if (!bars.length) {
      return textCenter(
        g,
        "Waiting for Binance candle data…"
      );
    }

    const L = 11;
    const R = 64;
    const T = 13;
    const B = 25;

    const W = w - L - R;
    const H = h - T - B;

    let high =
      Math.max(
        ...bars.map(b => b.h)
      );

    let low =
      Math.min(
        ...bars.map(b => b.l)
      );

    const padding =
      Math.max(
        .01,
        (high - low) * .10
      );

    high += padding;
    low -= padding;

    const y = x =>
      T +
      (high - x) /
      (high - low) * H;

    for (
      let j = 0;
      j <= 4;
      j++
    ) {
      const yy =
        T + j * H / 4;

      ctx.strokeStyle = "#22344c";
      ctx.beginPath();
      ctx.moveTo(L, yy);
      ctx.lineTo(L + W, yy);
      ctx.stroke();

      ctx.fillStyle = "#8099b5";
      ctx.font = "10px system-ui";

      ctx.fillText(
        fmt(
          high -
          (high - low) * j / 4
        ),
        L + W + 5,
        yy + 3
      );
    }

    const slot =
      W / bars.length;

    bars.forEach(
      (b, i) => {
        const x =
          L + (i + .5) * slot;

        ctx.strokeStyle =
          ctx.fillStyle =
            b.c >= b.o
              ? "#3fdfaa"
              : "#fa6680";

        ctx.beginPath();
        ctx.moveTo(x, y(b.h));
        ctx.lineTo(x, y(b.l));
        ctx.stroke();

        ctx.fillRect(
          x - Math.max(
            1,
            slot * .3
          ),
          Math.min(
            y(b.c),
            y(b.o)
          ),
          Math.max(
            2,
            slot * .6
          ),
          Math.max(
            1,
            Math.abs(
              y(b.c) - y(b.o)
            )
          )
        );
      }
    );

    if (
      valid(s.price) &&
      s.price <= high &&
      s.price >= low
    ) {
      ctx.strokeStyle = "#6abfff";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();

      ctx.moveTo(
        L,
        y(s.price)
      );

      ctx.lineTo(
        L + W,
        y(s.price)
      );

      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.font = "10px system-ui";
    ctx.fillStyle = "#849bb8";

    [
      0,
      Math.floor(
        (bars.length - 1) / 2
      ),
      bars.length - 1
    ].forEach(i => {
      ctx.fillText(
        new Date(
          bars[i].t
        ).toLocaleTimeString(
          "en-GB",
          {
            timeZone:
              "Africa/Johannesburg",

            hour: "2-digit",
            minute: "2-digit"
          }
        ),
        L + i * slot,
        h - 5
      );
    });
  }

  // ================================
  // LIQUIDITY HEATMAP
  // ================================

  function drawHeat() {
    const g = canvas(
      "heatmap"
    );

    if (!g) return;

    if (!s.heat.length) {
      return textCenter(
        g,
        "Heatmap records depth while this page is open…"
      );
    }

    const { ctx, w, h } = g;

    const data = s.heat;
    const bucket = s.bucket;
    const count = 26;

    const latest =
      data.at(-1);

    const midpoint =
      (
        latest.bids[0].p +
        latest.asks[0].p
      ) / 2;

    const center =
      Math.round(
        midpoint / bucket
      );

    const left = 9;
    const top = 11;
    const right = 74;
    const bottom = 24;

    const W =
      w - left - right;

    const H =
      h - top - bottom;

    const cw =
      W / data.length;

    const rh =
      H / count;

    const frames =
      data.map(item => {
        const m = new Map();

        for (
          const [name, type] of [
            ["bids", "buy"],
            ["asks", "sell"]
          ]
        ) {
          for (
            const level of item[name]
          ) {
            const k =
              Math.floor(
                level.p / bucket +
                1e-8
              );

            const v =
              m.get(k) || {
                buy: 0,
                sell: 0
              };

            v[type] +=
              level.q;

            m.set(k, v);
          }
        }

        return m;
      });

    let max = 0;

    for (const m of frames) {
      for (
        let row = 0;
        row < count;
        row++
      ) {
        const v = m.get(
          center +
          Math.floor(count / 2) -
          row
        );

        if (v) {
          max = Math.max(
            max,
            v.buy,
            v.sell
          );
        }
      }
    }

    ctx.fillStyle = "#0e1b2b";

    ctx.fillRect(
      left,
      top,
      W,
      H
    );

    frames.forEach(
      (m, col) => {
        for (
          let row = 0;
          row < count;
          row++
        ) {
          const v = m.get(
            center +
            Math.floor(count / 2) -
            row
          );

          if (!v || !max) {
            continue;
          }

          const buy =
            v.buy >= v.sell;

          const size =
            Math.max(
              v.buy,
              v.sell
            );

          const alpha = clamp(
            .12 +
            Math.sqrt(size / max) *
            .8,
            .12,
            .95
          );

          ctx.fillStyle =
            buy
              ? `rgba(50,229,172,${alpha})`
              : `rgba(255,93,128,${alpha})`;

          ctx.fillRect(
            left + col * cw,
            top + row * rh,
            Math.max(
              1,
              cw + .25
            ),
            Math.max(
              1,
              rh - .4
            )
          );
        }
      }
    );

    ctx.font = "10px system-ui";
    ctx.fillStyle = "#9cb2cc";

    for (
      let row = 0;
      row < count;
      row += 4
    ) {
      const py =
        top + row * rh;

      ctx.strokeStyle = "#213249";
      ctx.beginPath();
      ctx.moveTo(left, py);
      ctx.lineTo(left + W, py);
      ctx.stroke();

      ctx.fillText(
        fmt(
          (
            center +
            Math.floor(count / 2) -
            row
          ) * bucket
        ),
        left + W + 5,
        py + 8
      );
    }

    ctx.fillText(
      "OLDER",
      left + 4,
      h - 5
    );

    ctx.fillText(
      "LATEST",
      left + W - 40,
      h - 5
    );
  }

  // ================================
  // MAIN DASHBOARD RENDER
  // ================================

  function render() {
    $("price").textContent =
      valid(s.price)
        ? fmt(s.price)
        : "—";

    const pc =
      n(
        s.ticker?.priceChangePercent
      );

    $("priceInfo").textContent =
      s.ticker &&
      Number.isFinite(pc)
        ? `${signed(pc, 2)}% 24h move`
        : "Latest observed PAXG price";

    const book = s.book;

    const bid =
      book.bids[0]?.p;

    const ask =
      book.asks[0]?.p;

    $("spread").textContent =
      valid(bid) &&
      valid(ask)
        ? fmt(ask - bid)
        : "—";

    s.depthShare = depthStats();

    $("imbalance").textContent =
      Number.isFinite(
        s.depthShare
      )
        ? fmt(
            s.depthShare * 100,
            1
          ) + "%"
        : "—";

    $("cvd").textContent =
      s.liveCount
        ? signed(s.cvd, 4)
        : "—";

    $("cvd").className =
      s.cvd > 0
        ? "positive"
        : s.cvd < 0
          ? "negative"
          : "";

    const recent =
      s.trades.filter(
        t =>
          t.live &&
          t.at >=
            Date.now() - 60000
      );

    $("volume60").textContent =
      s.liveCount
        ? compact(
            recent.reduce(
              (a, b) =>
                a + b.notional,
              0
            )
          )
        : "—";

    $("candleCount").textContent =
      `${
        s.candles.filter(
          b => b.closed
        ).length
      } CLOSED / M1`;

    $("heatCount").textContent =
      `${s.heat.length} SAMPLES`;

    $("depthTime").textContent =
      s.lastDepth
        ? clock(s.lastDepth) +
          " SAST"
        : "WAITING";

    bookRows(
      "bids",
      book.bids,
      "#41e0af"
    );

    bookRows(
      "asks",
      book.asks,
      "#ff627e"
    );

    renderTape();
    renderFootprint();

    drawCandles();
    drawHeat();
  }

  // ================================
  // INITIALIZATION
  // ================================

  function init() {
    $("clock").textContent =
      clock(Date.now()) +
      " SAST";

    $("minimumScore").addEventListener(
      "change",
      ev => {
        s.scoreMin =
          n(ev.target.value);

        evaluate();
      }
    );

    $("rr").addEventListener(
      "change",
      ev => {
        s.rr =
          n(ev.target.value);

        evaluate();
      }
    );

    $("threshold").addEventListener(
      "change",
      ev => {
        s.threshold = Math.max(
          100,
          n(ev.target.value) ||
          10000
        );

        ev.target.value =
          s.threshold;
      }
    );

    $("bucket").addEventListener(
      "change",
      ev => {
        s.bucket =
          n(ev.target.value) || 1;

        renderSoon();
      }
    );

    $("reconnect").addEventListener(
      "click",
      () => {
        log(
          "Manual reconnection",
          "Refreshing public market sources"
        );

        restart();
      }
    );

    $("clear").addEventListener(
      "click",
      () => {
        s.events = [];

        $("events").innerHTML = "";
      }
    );

    $("alerts").addEventListener(
      "click",
      () => {
        s.alerts = !s.alerts;

        $("alerts").textContent =
          s.alerts
            ? "ALERTS ON"
            : "ENABLE ALERTS";

        toast(
          s.alerts
            ? "In-page alerts enabled"
            : "In-page alerts disabled"
        );
      }
    );

    window.addEventListener(
      "resize",
      renderSoon
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          stopped = true;

          disconnect();

          s.mode = "connecting";

        } else {
          restart();
          fetchXau();
        }
      }
    );

    window.addEventListener(
      "pageshow",
      () => {
        if (
          !document.hidden &&
          stopped
        ) {
          restart();
        }
      }
    );

    setInterval(() => {
      if (stopped) return;

      $("clock").textContent =
        clock(Date.now()) +
        " SAST";

      updateConnection();
      evaluate();
      renderSoon();

      if (
        socket &&
        socket.readyState ===
          WebSocket.OPEN &&
        Date.now() -
          s.lastFrame > 35000
      ) {
        socket.close();
      }

    }, 4000);

    xauPolling = setInterval(
      fetchXau,
      90000
    );

    log(
      "BLACKBOOK X2 started",
      "PAXG/USDT research; live confirmation required"
    );

    showSignal();
    render();

    restart();
    fetchXau();
  }

  init();

})();
