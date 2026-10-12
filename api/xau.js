/* ===========================================================
   MKAYFX INSTITUTIONAL LIQUIDITY RADAR V1
   FILE: /api/xau.js

   Twelve Data:
   API 1 = M1
   API 2 = M5
   API 3 = M15 + H1
   API 4 = H4 + D1

   NOTE:
   All liquidity scores are OHLC-based estimates.
   There is no real institutional order-book feed.
=========================================================== */

const SYMBOL = "XAU/USD";

const BASE = "https://api.twelvedata.com/time_series";

const FRAME = {
  "1min": {
    env: "TWELVE_DATA_API_KEY",
    size: 240,
    ttl: 55000,
    minutes: 1
  },
  "5min": {
    env: "TWELVE_DATA_API_KEY_2",
    size: 540,
    ttl: 175000,
    minutes: 5
  },
  "15min": {
    env: "TWELVE_DATA_API_KEY_3",
    size: 300,
    ttl: 390000,
    minutes: 15
  },
  "1h": {
    env: "TWELVE_DATA_API_KEY_3",
    size: 220,
    ttl: 900000,
    minutes: 60
  },
  "4h": {
    env: "TWELVE_DATA_API_KEY_4",
    size: 160,
    ttl: 1800000,
    minutes: 240
  },
  "1day": {
    env: "TWELVE_DATA_API_KEY_4",
    size: 45,
    ttl: 3600000,
    minutes: 1440
  }
};

const cache = new Map();
const inflight = new Map();

const clamp = (x, min, max) =>
  Math.max(min, Math.min(max, x));

const avg = a =>
  a.length
    ? a.reduce((s, x) => s + x, 0) / a.length
    : 0;

const round = (n, d = 2) =>
  Number(Number(n).toFixed(d));

const safeError = e =>
  String(e?.message || e || "Unknown error")
    .replace(/apikey=[^&\s]+/gi, "apikey=REDACTED")
    .slice(0, 170);

/* =============================
   TIME AND CANDLE NORMALIZATION
============================= */

function timeOf(s) {
  if (!s) return NaN;

  const clean = String(s)
    .trim()
    .replace(" ", "T");

  return Date.parse(
    /(?:Z|[+-]\d\d:\d\d)$/.test(clean)
      ? clean
      : `${clean}${clean.length === 10 ? "T00:00:00Z" : "Z"}`
  );
}

function barsOf(data) {
  if (!Array.isArray(data.values)) {
    throw Error(
      "No candle data returned; verify symbol access and subscription"
    );
  }

  const out = data.values
    .map(v => ({
      t: timeOf(v.datetime),
      o: +v.open,
      h: +v.high,
      l: +v.low,
      c: +v.close
    }))
    .filter(
      b =>
        Number.isFinite(b.t) &&
        [b.o, b.h, b.l, b.c].every(Number.isFinite) &&
        b.h >= b.l &&
        b.h >= Math.max(b.o, b.c) &&
        b.l <= Math.min(b.o, b.c)
    );

  out.sort((a, b) => a.t - b.t);

  return out.filter(
    (b, i) => i === 0 || b.t !== out[i - 1].t
  );
}

/* =============================
   DATA ENGINE
============================= */

async function fetchFrame(name) {
  const cfg = FRAME[name];
  const now = Date.now();
  const old = cache.get(name);

  if (old && now - old.at < cfg.ttl) {
    return {
      candles: old.data,
      stale: false,
      cached: true
    };
  }

  if (inflight.has(name)) {
    return inflight.get(name);
  }

  const job = (async () => {
    const key = process.env[cfg.env];

    if (!key) {
      throw Error(
        `Missing Vercel variable ${cfg.env}`
      );
    }

    const u = new URL(BASE);

    Object.entries({
      symbol: SYMBOL,
      interval: name,
      outputsize: cfg.size,
      order: "asc",
      timezone: "UTC",
      apikey: key
    }).forEach(([k, v]) =>
      u.searchParams.set(k, String(v))
    );

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      8500
    );

    try {
      const response = await fetch(u, {
        signal: controller.signal,
        headers: {
          Accept: "application/json"
        }
      });

      const data = await response.json();

      if (
        !response.ok ||
        data.status === "error" ||
        data.code >= 400
      ) {
        throw Error(
          `Twelve Data: ${String(
            data.message || `HTTP ${response.status}`
          ).slice(0, 125)}`
        );
      }

      const candles = barsOf(data);

      if (!candles.length) {
        throw Error(
          "Twelve Data returned zero valid candles"
        );
      }

      cache.set(name, {
        at: Date.now(),
        data: candles
      });

      return {
        candles,
        stale: false,
        cached: false
      };
    } finally {
      clearTimeout(timer);
    }
  })();

  inflight.set(name, job);

  try {
    return await job;
  } catch (e) {
    if (old && now - old.at < cfg.ttl * 12) {
      return {
        candles: old.data,
        stale: true,
        cached: true,
        warning: safeError(e)
      };
    }

    throw e;
  } finally {
    inflight.delete(name);
  }
}

function closed(bars, mins) {
  return bars.filter(
    b => b.t + mins * 60000 <= Date.now() - 2000
  );
}

/* =============================
   TECHNICAL INDICATORS
============================= */

function atr(bars, period = 14) {
  if (bars.length < 2) return 1;

  return (
    avg(
      bars.slice(-period).map((b, i, a) => {
        const prev = i
          ? a[i - 1].c
          : (
              bars[
                bars.length -
                Math.min(period, bars.length) -
                1
              ]?.c ?? b.o
            );

        return Math.max(
          b.h - b.l,
          Math.abs(b.h - prev),
          Math.abs(b.l - prev)
        );
      })
    ) || 1
  );
}

function ema(bars, n) {
  if (!bars.length) return 0;

  let x = bars[0].c;
  const k = 2 / (n + 1);

  for (let i = 1; i < bars.length; i++) {
    x = bars[i].c * k + x * (1 - k);
  }

  return x;
}

/* =============================
   SWING DETECTION
============================= */

function pivotCandidates(bars, tf, k, weight) {
  const found = [];

  for (let i = k; i < bars.length - k; i++) {
    const b = bars[i];

    const near = bars.slice(
      i - k,
      i + k + 1
    );

    if (
      near.every(
        (n, j) => j === k || b.h > n.h
      )
    ) {
      found.push({
        price: b.h,
        side: "SELL_SIDE",
        kind: `${tf} SWING HIGH`,
        t: b.t,
        weight
      });
    }

    if (
      near.every(
        (n, j) => j === k || b.l < n.l
      )
    ) {
      found.push({
        price: b.l,
        side: "BUY_SIDE",
        kind: `${tf} SWING LOW`,
        t: b.t,
        weight
      });
    }
  }

  return found.slice(-75);
}

/* =============================
   PREVIOUS DAY / WEEK
============================= */

function previousDay(dayBars) {
  const today = new Date()
    .toISOString()
    .slice(0, 10);

  return [...dayBars]
    .reverse()
    .find(
      b =>
        new Date(b.t)
          .toISOString()
          .slice(0, 10) < today
    );
}

function weekStartUTC(t) {
  const d = new Date(t);

  const day =
    (d.getUTCDay() + 6) % 7;

  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - day
  );
}

function previousWeek(dayBars) {
  const thisWeek = weekStartUTC(
    Date.now()
  );

  const arr = dayBars.filter(
    b => weekStartUTC(b.t) < thisWeek
  );

  if (!arr.length) return null;

  const week = weekStartUTC(
    arr[arr.length - 1].t
  );

  const b = arr.filter(
    x => weekStartUTC(x.t) === week
  );

  return {
    h: Math.max(...b.map(x => x.h)),
    l: Math.min(...b.map(x => x.l)),
    t: b[0].t
  };
}

/* =============================
   SESSION INTELLIGENCE
============================= */

function sessionLevels(bars) {
  const day = new Date()
    .toISOString()
    .slice(0, 10);

  const current = bars.filter(
    b =>
      new Date(b.t)
        .toISOString()
        .slice(0, 10) === day
  );

  const definitions = [
    {
      id: "ASIA",
      label: "ASIA",
      start: 0,
      end: 8
    },
    {
      id: "LONDON",
      label: "LONDON",
      start: 8,
      end: 16
    },
    {
      id: "NEW_YORK",
      label: "NEW YORK",
      start: 13,
      end: 21
    }
  ];

  const nowHour =
    new Date().getUTCHours() +
    new Date().getUTCMinutes() / 60;

  return definitions.map(s => {
    const relevant = current.filter(b => {
      const h = new Date(b.t)
        .getUTCHours();

      return (
        h >= s.start &&
        h < s.end
      );
    });

    return {
      ...s,

      status:
        nowHour < s.start
          ? "UPCOMING"
          : nowHour >= s.end
            ? "ENDED"
            : "ACTIVE",

      high: relevant.length
        ? round(
            Math.max(
              ...relevant.map(b => b.h)
            )
          )
        : null,

      low: relevant.length
        ? round(
            Math.min(
              ...relevant.map(b => b.l)
            )
          )
        : null
    };
  });
}

/* =============================
   LIQUIDITY CLUSTER ENGINE
============================= */

function collectLevels({
  m5,
  m15,
  h1,
  day,
  price,
  volatility
}) {
  let p = [
    ...pivotCandidates(
      m5, "M5", 4, 10
    ),
    ...pivotCandidates(
      m15, "M15", 3, 17
    ),
    ...pivotCandidates(
      h1, "H1", 2, 23
    )
  ];

  const pd = previousDay(day);
  const pw = previousWeek(day);
  const ss = sessionLevels(m5);

  if (pd) {
    p.push(
      {
        price: pd.h,
        side: "SELL_SIDE",
        kind: "PREVIOUS DAY HIGH",
        t: pd.t,
        weight: 30
      },
      {
        price: pd.l,
        side: "BUY_SIDE",
        kind: "PREVIOUS DAY LOW",
        t: pd.t,
        weight: 30
      }
    );
  }

  if (pw) {
    p.push(
      {
        price: pw.h,
        side: "SELL_SIDE",
        kind: "PREVIOUS WEEK HIGH",
        t: pw.t,
        weight: 34
      },
      {
        price: pw.l,
        side: "BUY_SIDE",
        kind: "PREVIOUS WEEK LOW",
        t: pw.t,
        weight: 34
      }
    );
  }

  for (const s of ss) {
    if (s.high !== null) {
      p.push(
        {
          price: s.high,
          side: "SELL_SIDE",
          kind: `${s.label} HIGH`,
          t: Date.now(),
          weight: 22
        },
        {
          price: s.low,
          side: "BUY_SIDE",
          kind: `${s.label} LOW`,
          t: Date.now(),
          weight: 22
        }
      );
    }
  }

  const threshold = Math.max(
    volatility * 0.32,
    price * 0.00008,
    0.12
  );

  p.sort(
    (a, b) =>
      a.side.localeCompare(b.side) ||
      a.price - b.price
  );

  const clusters = [];

  for (const x of p) {
    const match = clusters.find(
      z =>
        z.side === x.side &&
        Math.abs(
          z.price - x.price
        ) <= threshold
    );

    if (match) {
      const total =
        match.rawWeight + x.weight;

      match.price =
        (
          match.price *
          match.rawWeight +
          x.price * x.weight
        ) / total;

      match.rawWeight = total;
      match.touches++;

      if (x.weight >= match.weight) {
        match.kind = x.kind;
        match.weight = x.weight;
      }

      match.t = Math.max(
        match.t, x.t
      );
    } else {
      clusters.push({
        ...x,
        touches: 1,
        rawWeight: x.weight
      });
    }
  }

  return clusters
    .map((z, i) => {
      const distanceATR =
        Math.abs(
          z.price - price
        ) / volatility;

      const rank = clamp(
        Math.round(
          27 +
          z.weight +
          Math.min(
            z.touches, 7
          ) * 7 +
          (distanceATR < 5 ? 8 : 0)
        ),
        1,
        99
      );

      const raid = m5
        .slice(-80)
        .some(b =>
          z.side === "SELL_SIDE"
            ? (
                b.h >
                  z.price +
                  volatility * 0.07 &&
                b.c <
                  z.price -
                  volatility * 0.035
              )
            : (
                b.l <
                  z.price -
                  volatility * 0.07 &&
                b.c >
                  z.price +
                  volatility * 0.035
              )
        );

      return {
        id: `L${i}`,
        price: round(z.price),
        side: z.side,
        kind: z.kind,
        t: z.t,
        touches: z.touches,
        score: rank,
        distanceATR: round(
          distanceATR
        ),
        status: raid
          ? "RECENT RAID"
          : "TRACKING"
      };
    })
    .sort(
      (a, b) => b.score - a.score
    )
    .slice(0, 35);
}

/* =============================
   FAIR VALUE GAPS
============================= */

function findGaps(bars, vol) {
  const out = [];

  for (
    let i = 2;
    i < bars.length;
    i++
  ) {
    const a = bars[i - 2];
    const b = bars[i];

    if (
      b.l - a.h >
      vol * 0.22
    ) {
      out.push({
        t: a.t,
        low: round(a.h),
        high: round(b.l),
        side: "BULLISH"
      });
    }

    if (
      a.l - b.h >
      vol * 0.22
    ) {
      out.push({
        t: a.t,
        low: round(b.h),
        high: round(a.l),
        side: "BEARISH"
      });
    }
  }

  return out.slice(-18);
}

/* =============================
   LIQUIDITY SWEEP EVENTS
============================= */

function sweepEvents(
  bars,
  levels,
  vol
) {
  const chosen = levels
    .filter(
      x => x.score >= 60
    )
    .slice(0, 20);

  const events = [];

  for (
    const b of bars.slice(-72)
  ) {
    for (const lev of chosen) {
      const tested =
        lev.side === "SELL_SIDE"
          ? (
              b.h >
                lev.price +
                vol * 0.08 &&
              b.c <
                lev.price -
                vol * 0.04
            )
          : (
              b.l <
                lev.price -
                vol * 0.08 &&
              b.c >
                lev.price +
                vol * 0.04
            );

      if (tested) {
        events.push({
          time: b.t,
          price: lev.price,
          side: lev.side,
          label:
            `${
              lev.side === "SELL_SIDE"
                ? "Sell-side"
                : "Buy-side"
            } sweep rejection`,
          score: lev.score
        });
      }
    }
  }

  const uniq = new Map();

  for (const e of events) {
    uniq.set(
      `${e.time}-${e.side}`,
      e
    );
  }

  return [...uniq.values()]
    .sort(
      (a, b) => b.time - a.time
    )
    .slice(0, 6);
}

/* =============================
   MARKET STRUCTURE
============================= */

function statusText(
  price,
  h1,
  m15
) {
  const trend1 =
    h1.length >= 52
      ? (
          ema(h1, 20) >
          ema(h1, 50)
            ? "BULLISH"
            : "BEARISH"
        )
      : "UNKNOWN";

  const trend15 =
    m15.length >= 52
      ? (
          ema(m15, 20) >
          ema(m15, 50)
            ? "BULLISH"
            : "BEARISH"
        )
      : "UNKNOWN";

  return {
    h1: trend1,
    m15: trend15,

    agreement:
      trend1 === trend15 &&
      trend1 !== "UNKNOWN"
        ? "ALIGNED"
        : "MIXED",

    bias:
      trend1 === trend15
        ? trend1
        : "NEUTRAL"
  };
}

/* =============================
   BUILD DASHBOARD DATA
============================= */

function build(data, errors) {
  const bars = Object.fromEntries(
    Object.keys(FRAME).map(
      k => [
        k,
        data[k]?.candles || []
      ]
    )
  );

  const m5 = closed(
    bars["5min"], 5
  );

  const m15 = closed(
    bars["15min"], 15
  );

  const h1 = closed(
    bars["1h"], 60
  );

  const m1 = bars["1min"];

  const source =
    m1.at(-1) ||
    bars["5min"].at(-1) ||
    bars["15min"].at(-1) ||
    bars["1h"].at(-1);

  if (!source) {
    throw Error(
      "No XAU/USD candles available. Check your four keys and subscription."
    );
  }

  const price = source.c;

  const vol = round(
    atr(
      m5.length > 15
        ? m5
        : bars["5min"]
    ),
    3
  );

  const sessions = sessionLevels(m5);

  const levels = collectLevels({
    m5,
    m15,
    h1,
    day: bars["1day"],
    price,
    volatility: Math.max(
      0.05, vol
    )
  });

  const upper = levels
    .filter(
      l =>
        l.price > price &&
        l.side === "SELL_SIDE"
    )
    .sort(
      (a, b) => a.price - b.price
    );

  const lower = levels
    .filter(
      l =>
        l.price < price &&
        l.side === "BUY_SIDE"
    )
    .sort(
      (a, b) => b.price - a.price
    );

  const trend = statusText(
    price,
    h1,
    m15
  );

  const nearestUp =
    upper[0] || null;

  const nearestDown =
    lower[0] || null;

  const good = levels.filter(
    l => l.score >= 70
  );

  const gaps = findGaps(
    m5,
    Math.max(0.05, vol)
  );

  const isM1 =
    !!m1.length;

  const feedAge = Math.max(
    0,
    Math.round(
      (
        Date.now() -
        (
          source.t +
          (isM1 ? 1 : 5) *
          60000
        )
      ) / 1000
    )
  );

  return {
    ok: true,
    symbol: SYMBOL,
    generatedAt: Date.now(),

    price: round(price),
    quoteTime: source.t,

    quoteSource: isM1
      ? "M1 candle close (indicative)"
      : "Latest available candle close",

    feedAgeSeconds: feedAge,

    asOfClosedCandle:
      m5.at(-1)?.t || null,

    quality: {
      dataFrames: Object.keys(
        data
      ).length,

      totalFrames: 6,

      staleFrames: Object.entries(
        data
      )
        .filter(
          ([, v]) => v.stale
        )
        .map(
          ([k]) => k
        ),

      warnings: errors,

      model:
        "OHLC-DERIVED • NO LEVEL 2 / DOM",

      note:
        "Rank and heat intensity are heuristic, not real orders or calibrated probabilities."
    },

    analytics: {
      atr5: vol,
      trend,
      strongZones: good.length,

      upper: nearestUp,
      lower: nearestDown,

      priceToSell:
        nearestUp
          ? round(
              nearestUp.price -
              price
            )
          : null,

      priceToBuy:
        nearestDown
          ? round(
              price -
              nearestDown.price
            )
          : null,

      stance:
        trend.agreement === "ALIGNED"
          ? `${trend.bias} CONTEXT`
          : "WAIT FOR CONFIRMATION"
    },

    levels,
    sessions,

    events: sweepEvents(
      m5,
      levels,
      Math.max(0.05, vol)
    ),

    gaps,

    candles: Object.fromEntries(
      Object.entries(bars)
        .map(
          ([k, arr]) => [
            k,
            arr.slice(-310)
          ]
        )
    )
  };
}

/* =============================
   VERCEL ENDPOINT
============================= */

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=45, stale-while-revalidate=90"
  );

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const keys = Object.keys(FRAME);

  const results = await Promise.allSettled(
    keys.map(fetchFrame)
  );

  const frames = {};
  const errors = {};

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      frames[keys[i]] = r.value;

      if (r.value.warning) {
        errors[keys[i]] =
          r.value.warning;
      }
    } else {
      errors[keys[i]] =
        safeError(r.reason);
    }
  });

  try {
    return res.status(200).json(
      build(frames, errors)
    );
  } catch (e) {
    return res.status(503).json({
      ok: false,
      error: safeError(e),
      errors
    });
  }
}