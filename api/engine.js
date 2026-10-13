// BLACKBOOK X4
// Candle-derived analytics, NOT exchange order-book data.

const clip = (x, a, b) =>
  Math.max(a, Math.min(b, x));

const avg = a =>
  a.length
    ? a.reduce((s, x) => s + x, 0) / a.length
    : 0;

const round = (x, n = 2) =>
  Number(Number(x).toFixed(n));

export function ema(values, period) {
  let v = values[0] || 0;

  return values.map((x, i) => {
    v = i === 0
      ? x
      : v + (x - v) * 2 / (period + 1);

    return v;
  });
}

export function atr(c, period = 14) {
  let v = 0;

  return c.map((b, i) => {
    const tr = Math.max(
      b.h - b.l,
      Math.abs(b.h - (c[i - 1]?.c ?? b.c)),
      Math.abs(b.l - (c[i - 1]?.c ?? b.c))
    );

    v = i === 0
      ? tr
      : (v * (period - 1) + tr) / period;

    return v;
  });
}

export function trend(c) {
  if (!c || c.length < 55) {
    return {
      direction: "UNKNOWN",
      strength: 0,
      ema20: null,
      ema50: null
    };
  }

  const e20 = ema(c.map(x => x.c), 20).at(-1);
  const e50 = ema(c.map(x => x.c), 50).at(-1);

  const v = atr(c).at(-1) || 1;
  const p = c.at(-1).c;

  const diff = (e20 - e50) / v;

  return {
    direction:
      diff > .12 && p > e20
        ? "BULLISH"
        : diff < -.12 && p < e20
        ? "BEARISH"
        : "MIXED",

    strength: round(
      clip(Math.abs(diff) * 32, 0, 100),
      0
    ),

    ema20: round(e20),
    ema50: round(e50)
  };
}

// Live and backtest use the same sweep strategy.
// Only the current signal candle and earlier candles are used.

export function setupAt(
  c,
  i,
  e20,
  e50,
  a,
  threshold = 70
) {
  if (i < 55 || i >= c.length) {
    return null;
  }

  const b = c[i];
  const prior = c.slice(i - 20, i);

  if (prior.length < 20) {
    return null;
  }

  const hi = Math.max(...prior.map(x => x.h));
  const lo = Math.min(...prior.map(x => x.l));

  const vol = a[i] || 1;
  const range = Math.max(.00001, b.h - b.l);

  const bull =
    b.l < lo - vol * .06 &&
    b.c > lo &&
    b.c > b.o;

  const bear =
    b.h > hi + vol * .06 &&
    b.c < hi &&
    b.c < b.o;

  if (!bull && !bear) {
    return null;
  }

  const dir = bull ? "BUY" : "SELL";
  const ref = bull ? lo : hi;

  const wick = bull
    ? Math.min(b.o, b.c) - b.l
    : b.h - Math.max(b.o, b.c);

  const finish = bull
    ? (b.c - b.l) / range
    : (b.h - b.c) / range;

  const sweep = Math.abs(
    (bull ? b.l : b.h) - ref
  ) / vol;

  const aligned = bull
    ? e20[i] > e50[i]
    : e20[i] < e50[i];

  const score = round(
    clip(
      42 +
      clip(wick / range, 0, 1) * 17 +
      finish * 14 +
      (aligned ? 13 : 0) +
      (
        range / vol > .55 &&
        range / vol < 3.2
          ? 9
          : 0
      ) +
      clip(sweep * 16, 0, 7),
      0,
      100
    ),
    0
  );

  if (score < threshold) {
    return null;
  }

  const entry = b.c;

  const stop = bull
    ? b.l - vol * .2
    : b.h + vol * .2;

  const risk = Math.abs(entry - stop);

  if (
    !Number.isFinite(risk) ||
    risk < vol * .2
  ) {
    return null;
  }

  return {
    id: `${b.t}-${dir}`,
    side: dir,
    score,

    entry: round(entry),
    stop: round(stop),

    tp1: round(
      entry + (bull ? 1 : -1) * risk * 1.5
    ),

    tp2: round(
      entry + (bull ? 1 : -1) * risk * 2
    ),

    risk: round(risk),
    level: round(ref),
    time: b.t,

    reason:
      `${dir === "BUY" ? "Sell-side" : "Buy-side"} ` +
      "20-bar sweep and rejection",

    aligned
  };
}

export function sessions(c) {
  const now = new Date();

  const d = now.toISOString().slice(0, 10);

  const prev = new Date(
    Date.parse(d + "T00:00:00Z") - 86400000
  ).toISOString().slice(0, 10);

  const pick = (day, h0, h1) =>
    c.filter(x =>
      new Date(x.t).toISOString().slice(0, 10) === day &&
      new Date(x.t).getUTCHours() >= h0 &&
      new Date(x.t).getUTCHours() < h1
    );

  const range = (arr, name) =>
    arr.length
      ? {
          name,

          high: round(
            Math.max(...arr.map(x => x.h))
          ),

          low: round(
            Math.min(...arr.map(x => x.l))
          ),

          developing: dayIsToday(name)
        }
      : null;

  const dayIsToday = name =>
    name !== "Previous day";

  return [
    range(pick(prev, 0, 24), "Previous day"),
    range(pick(d, 0, 7), "Asia"),
    range(pick(d, 7, 12), "London"),
    range(pick(d, 12, 17), "New York")
  ].filter(Boolean);
}

export function zones(
  m5,
  m15,
  h1,
  session,
  price
) {
  const out = [];

  function collect(bars, tf, left, base) {
    if (bars.length < left * 2 + 1) {
      return;
    }

    const a = atr(bars).at(-1) || 1;

    for (
      let i = Math.max(left, bars.length - 160);
      i < bars.length - left;
      i++
    ) {
      const sl = bars.slice(
        i - left,
        i + left + 1
      );

      const b = bars[i];

      if (
        b.h === Math.max(...sl.map(x => x.h))
      ) {
        out.push({
          price: b.h,
          type: "BSL",
          source: tf,
          t: b.t,
          score: base,
          atr: a
        });
      }

      if (
        b.l === Math.min(...sl.map(x => x.l))
      ) {
        out.push({
          price: b.l,
          type: "SSL",
          source: tf,
          t: b.t,
          score: base,
          atr: a
        });
      }
    }
  }

  collect(m5, "M5", 4, 42);
  collect(m15, "M15", 3, 55);
  collect(h1, "H1", 2, 66);

  for (const s of session) {
    out.push({
      price: s.high,
      type: "BSL",
      source: s.name + " high",
      t: Date.now(),
      score: 73,
      atr: atr(m5).at(-1) || 1
    });

    out.push({
      price: s.low,
      type: "SSL",
      source: s.name + " low",
      t: Date.now(),
      score: 73,
      atr: atr(m5).at(-1) || 1
    });
  }

  const unit = Math.max(
    (atr(m5).at(-1) || 1) * .20,
    price * .000035
  );

  const sorted = out.sort(
    (a, b) => b.score - a.score
  );

  const groups = [];

  for (const z of sorted) {
    let g = groups.find(x =>
      x.type === z.type &&
      Math.abs(x.price - z.price) < unit
    );

    if (g) {
      g.price =
        (g.price * g.touches + z.price) /
        (g.touches + 1);

      g.touches++;

      g.score = clip(
        Math.max(g.score, z.score) +
        Math.min(22, g.touches * 4),
        0,
        98
      );

      g.sources.add(z.source);

    } else {
      groups.push({
        ...z,
        touches: 1,
        sources: new Set([z.source])
      });
    }
  }

  return groups
    .map(g => {
      const close = m5.slice(-3);

      const broken = g.type === "BSL"
        ? close.some(
            x => x.c > g.price + unit * 1.5
          )
        : close.some(
            x => x.c < g.price - unit * 1.5
          );

      return {
        price: round(g.price),
        type: g.type,

        score: round(g.score, 0),
        touches: g.touches,

        source: [...g.sources]
          .slice(0, 3)
          .join(" · "),

        distance: round(
          Math.abs(g.price - price)
        ),

        state: broken
          ? "BREACHED"
          : "ACTIVE"
      };
    })
    .filter(x =>
      x.score >= 70 &&
      x.state === "ACTIVE"
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);
}

function metrics(trades) {
  const n = trades.length;

  const w = trades.filter(x => x.r > 0);
  const l = trades.filter(x => x.r < 0);

  const sum = trades.reduce(
    (s, x) => s + x.r,
    0
  );

  const gain = w.reduce(
    (s, x) => s + x.r,
    0
  );

  const loss = -l.reduce(
    (s, x) => s + x.r,
    0
  );

  let eq = 0;
  let peak = 0;
  let dd = 0;

  const curve = [0];

  for (const x of trades) {
    eq += x.r;

    peak = Math.max(peak, eq);

    dd = Math.max(
      dd,
      peak - eq
    );

    curve.push(round(eq, 3));
  }

  return {
    trades: n,
    wins: w.length,
    losses: l.length,

    winRate: n
      ? round(w.length / n * 100, 1)
      : 0,

    pf: loss
      ? round(gain / loss, 2)
      : gain
      ? null
      : 0,

    expectancy: n
      ? round(sum / n, 3)
      : 0,

    totalR: round(sum, 2),
    maxDdR: round(dd, 2),
    equity: curve
  };
}

export function backtest(c, options = {}) {
  const threshold = clip(
    Number(options.threshold) || 70,
    55,
    95
  );

  const rr = clip(
    Number(options.rr) || 2,
    1,
    4
  );

  const cost = clip(
    Number(options.cost ?? .35),
    0,
    5
  );

  if (c.length < 95) {
    return {
      error: "Insufficient M5 history for a meaningful test",
      settings: { threshold, rr, cost }
    };
  }

  const closes = c.map(x => x.c);

  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const a = atr(c);

  const trades = [];

  const final = c.length - 1;
  const split = Math.floor(c.length * .7);

  for (
    let i = 65;
    i < final - 1;
    i++
  ) {
    const s = setupAt(
      c,
      i,
      e20,
      e50,
      a,
      threshold
    );

    if (!s) {
      continue;
    }

    // Enter at NEXT candle open.

    const entry = c[i + 1].o;

    const dir = s.side === "BUY"
      ? 1
      : -1;

    const stop = s.stop;

    const risk = (entry - stop) * dir;

    if (
      risk <= a[i] * .2 ||
      risk > 5 * a[i]
    ) {
      continue;
    }

    const target =
      entry + dir * risk * rr;

    let exit = final;
    let fill = c[final].c;
    let why = "TIME";

    const limit = Math.min(
      i + 1 + 18,
      final
    );

    // Require a complete observation horizon.

    if (limit < i + 19) {
      break;
    }

    for (
      let j = i + 1;
      j <= limit;
      j++
    ) {
      const b = c[j];

      const sl = dir === 1
        ? b.l <= stop
        : b.h >= stop;

      const tp = dir === 1
        ? b.h >= target
        : b.l <= target;

      // SL wins ties if both targets
      // touched in one OHLC candle.

      if (sl) {
        fill = stop;
        exit = j;
        why = "SL";
        break;
      }

      if (tp) {
        fill = target;
        exit = j;
        why = "TP";
        break;
      }
    }

    if (why === "TIME") {
      exit = limit;
      fill = c[exit].c;
    }

    const r = round(
      (
        (fill - entry) * dir - cost
      ) / risk,
      3
    );

    trades.push({
      t: c[i].t,
      exit: c[exit].t,
      side: s.side,
      score: s.score,
      r,
      why
    });

    // Never overlap trades.

    i = exit;
  }

  const dev = trades.filter(
    x => x.t < c[split].t
  );

  const val = trades.filter(
    x => x.t >= c[split].t
  );

  return {
    settings: {
      threshold,
      rr,
      cost,
      holdBars: 18
    },

    all: metrics(trades),
    development: metrics(dev),
    validation: metrics(val),

    trades: trades
      .slice(-60)
      .reverse(),

    history: {
      from: c[0].t,
      to: c.at(-1).t,
      bars: c.length,
      split: c[split].t
    },

    disclaimer:
      "M5 OHLC backtest; next-open execution, " +
      "conservative same-bar SL priority, " +
      "fixed assumed round-trip price cost. " +
      "Not tick replay. Recent validation is " +
      "not proof of a durable edge."
  };
}

export function analyze(feeds, opts = {}) {
  const m1 = feeds.M1 || [];
  const m5 = feeds.M5 || [];
  const m15 = feeds.M15 || [];
  const h1 = feeds.H1 || [];
  const h4 = feeds.H4 || [];

  if (m5.length < 95) {
    throw new Error(
      "M5 historical candles unavailable or insufficient"
    );
  }

  const now = Date.now();

  // Use closed candles only for signals.

  const closed5 = m5.filter(
    x => Date.parse(x.t) + 300000 <= now + 3000
  );

  const closed15 = m15.filter(
    x => Date.parse(x.t) + 900000 <= now + 3000
  );

  const closedH1 = h1.filter(
    x => Date.parse(x.t) + 3600000 <= now + 3000
  );

  const closedH4 = h4.filter(
    x => Date.parse(x.t) + 14400000 <= now + 3000
  );

  const p =
    m1.at(-1)?.c ??
    m5.at(-1)?.c;

  const latest = closed5.at(-1);

  const fresh =
    !!latest &&
    now - (
      Date.parse(latest.t) + 300000
    ) < 900000 &&
    !!m1.length &&
    now - Date.parse(m1.at(-1).t) < 240000;

  const e20 = ema(
    closed5.map(x => x.c),
    20
  );

  const e50 = ema(
    closed5.map(x => x.c),
    50
  );

  const a = atr(closed5);

  let setup = latest
    ? setupAt(
        closed5,
        closed5.length - 1,
        e20,
        e50,
        a,
        70
      )
    : null;

  let reason =
    "No confirmed 20-bar liquidity sweep " +
    "on the latest closed M5 candle";

  if (!fresh) {
    reason =
      "Market data is stale or market is closed; " +
      "trading signals blocked";

    setup = null;

  } else if (
    setup &&
    Math.abs(p - setup.entry) >
      .45 * (a.at(-1) || 1)
  ) {
    reason =
      "Price moved too far from confirmed entry; " +
      "wait for a new setup";

    setup = null;

  } else if (setup) {
    reason = setup.reason;
  }

  const sess = sessions(
    m15.length ? m15 : m5
  );

  const z = zones(
    closed5,
    closed15,
    closedH1,
    sess,
    p
  );

  const lastC = closed5.slice(-180);

  return {
    version: "BLACKBOOK X4",
    symbol: "XAU/USD",
    price: round(p),
    asOf: new Date().toISOString(),
    fresh,

    signal: setup
      ? {
          ...setup,

          expiresAt: new Date(
            Date.parse(setup.time) + 900000
          ).toISOString()
        }
      : null,

    decision: setup
      ? setup.side
      : "WAIT",

    reason,

    trend: {
      M5: trend(closed5),
      M15: trend(closed15),
      H1: trend(closedH1),
      H4: trend(closedH4)
    },

    zones: z,
    sessions: sess,

    atr: round(a.at(-1) || 0),

    candles: lastC,

    m1: m1.slice(-180),

    backtest: backtest(
      closed5,
      opts
    ),

    metadata: {
      feedType:
        "Twelve Data indicative spot XAU/USD OHLC",

      liquidityType:
        "price-derived estimates, not orders",

      signalRules:
        "20-bar M5 sweep/rejection, EMA20/50 confirmation, score >=70, latest closed M5 candle",

      dataAgeSeconds: m1.length
        ? Math.round(
            (
              now -
              Date.parse(m1.at(-1).t)
            ) / 1000
          )
        : null
    }
  };
}