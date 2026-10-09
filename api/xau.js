/* ============================================================
   MKAYFX GOLD INSTITUTIONAL RADAR V1

   FILE: /api/gold.js

   PUBLIC DATA SOURCES:
   - CFTC Disaggregated COT
   - Twelve Data XAU/USD M5 and H1
   - FRED real yields, Treasury yields, broad USD

   No confidential information.
   No automatic trade execution.
   Scores are heuristic, not probabilities.
============================================================ */

const TD_URL =
  "https://api.twelvedata.com/time_series";

const FRED_URL =
  "https://api.stlouisfed.org/fred/series/observations";

const COT_URL =
  "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";

const cache = new Map();

const N = value => {
  if (
    value == null ||
    String(value).trim() === ""
  ) return null;

  const n = Number(
    String(value).replace(/,/g, "")
  );

  return Number.isFinite(n) ? n : null;
};

const round = (n, d = 2) =>
  Number.isFinite(n)
    ? Number(n.toFixed(d))
    : null;

const clamp = (v, a, b) =>
  Math.max(a, Math.min(b, v));

const netOrNull = (a, b) =>
  N(a) !== null && N(b) !== null
    ? N(a) - N(b)
    : null;


/* ============================================================
   FETCH / CACHE
============================================================ */

async function fetchJSON(url) {
  const controller = new AbortController();

  const id = setTimeout(
    () => controller.abort(),
    9000
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Provider HTTP ${response.status}`
      );
    }

    const body = await response.json();

    if (body.status === "error") {
      throw new Error(
        body.message || "Provider rejected request"
      );
    }

    return body;
  } finally {
    clearTimeout(id);
  }
}

async function memo(key, ttl, loader) {
  const hit = cache.get(key);

  if (
    hit &&
    Date.now() - hit.at < ttl
  ) {
    return hit.value;
  }

  const value = await loader();

  cache.set(key, {
    at: Date.now(),
    value
  });

  return value;
}


/* ============================================================
   XAU/USD PRICE ENGINE
============================================================ */

function parseCandles(data, intervalMinutes) {
  if (!Array.isArray(data.values)) {
    throw new Error(
      "No price candles returned"
    );
  }

  const candles = data.values
    .map(v => {
      const timestamp = Date.parse(
        String(v.datetime || "")
          .replace(" ", "T") + "Z"
      );

      return {
        t: timestamp,
        o: N(v.open),
        h: N(v.high),
        l: N(v.low),
        c: N(v.close)
      };
    })
    .filter(x =>
      Number.isFinite(x.t) &&
      [x.o, x.h, x.l, x.c].every(
        Number.isFinite
      )
    )
    .sort((a, b) => a.t - b.t);

  if (!candles.length) {
    throw new Error(
      "No usable price candles"
    );
  }

  // Exclude candles that have not finished.
  const complete = candles.filter(
    x =>
      x.t + intervalMinutes * 60000 <=
      Date.now() - 5000
  );

  return {
    candles: complete,
    latest: candles.at(-1)
  };
}

async function loadPrice(
  interval,
  size,
  key
) {
  if (!key) {
    throw new Error(
      "Missing TWELVE_DATA_API_KEY"
    );
  }

  const url = new URL(TD_URL);

  for (
    const [k, v] of Object.entries({
      symbol: "XAU/USD",
      interval,
      outputsize: size,
      timezone: "UTC",
      apikey: key
    })
  ) {
    url.searchParams.set(k, v);
  }

  const minutes =
    interval === "1h" ? 60 : 5;

  return memo(
    "td-" + interval,
    55000,
    async () =>
      parseCandles(
        await fetchJSON(url),
        minutes
      )
  );
}


/* ============================================================
   CFTC INSTITUTIONAL POSITIONING
============================================================ */

async function loadCOT() {
  const url = new URL(COT_URL);

  url.searchParams.set(
    "$where",
    "commodity_name = 'GOLD' AND market_and_exchange_names like 'GOLD%'"
  );

  url.searchParams.set(
    "$order",
    "report_date_as_yyyy_mm_dd DESC"
  );

  url.searchParams.set(
    "$limit",
    "52"
  );

  const rows = await memo(
    "cot",
    30 * 60000,
    () => fetchJSON(url)
  );

  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    throw new Error(
      "No CFTC gold positioning returned"
    );
  }

  const clean = rows.filter(r =>
    String(
      r.market_and_exchange_names || ""
    )
      .toUpperCase()
      .startsWith("GOLD -")
  );

  if (!clean.length) {
    throw new Error(
      "No COMEX gold records returned"
    );
  }

  const latest = clean[0];
  const prev = clean[1];

  const managedLong = N(
    latest.m_money_positions_long_all
  );

  const managedShort = N(
    latest.m_money_positions_short_all
  );

  if (
    managedLong === null ||
    managedShort === null
  ) {
    throw new Error(
      "Managed money position fields missing"
    );
  }

  const net =
    managedLong - managedShort;

  const prevL = prev
    ? N(prev.m_money_positions_long_all)
    : null;

  const prevS = prev
    ? N(prev.m_money_positions_short_all)
    : null;

  const previousNet =
    prevL !== null && prevS !== null
      ? prevL - prevS
      : null;

  const history = clean
    .map(r => {
      const l = N(
        r.m_money_positions_long_all
      );

      const s = N(
        r.m_money_positions_short_all
      );

      return l !== null && s !== null
        ? l - s
        : null;
    })
    .filter(Number.isFinite);

  const rank =
    history.length > 4
      ? 100 *
        history.filter(
          v => v <= net
        ).length /
        history.length
      : null;

  return {
    date: String(
      latest.report_date_as_yyyy_mm_dd || ""
    ).slice(0, 10),

    market:
      latest.market_and_exchange_names,

    managedLong,
    managedShort,
    managedNet: net,

    weeklyNetChange:
      Number.isFinite(previousNet)
        ? net - previousNet
        : null,

    producerNet: netOrNull(
      latest.prod_merc_positions_long_all,
      latest.prod_merc_positions_short_all
    ),

    swapNet: netOrNull(
      latest.swap_positions_long_all,
      latest.swap__positions_short_all
    ),

    openInterest: N(
      latest.open_interest_all
    ),

    openInterestChange: prev
      ? N(latest.open_interest_all) -
        N(prev.open_interest_all)
      : null,

    historicalRank: round(rank, 0),

    sampleWeeks: history.length,

    source:
      "https://publicreporting.cftc.gov/stories/s/Disaggregated-Futures-Only/ubmb-6exi/"
  };
}


/* ============================================================
   FRED MACRO ENGINE
============================================================ */

async function fredSeries(id, key) {
  const url = new URL(FRED_URL);

  for (
    const [k, v] of Object.entries({
      series_id: id,
      api_key: key,
      file_type: "json",
      sort_order: "desc",
      limit: "12"
    })
  ) {
    url.searchParams.set(k, v);
  }

  const response = await memo(
    "fred-" + id,
    30 * 60000,
    () => fetchJSON(url)
  );

  const values = (
    response.observations || []
  )
    .map(o => ({
      date: o.date,
      value: N(o.value)
    }))
    .filter(
      o => o.value !== null
    );

  if (!values.length) {
    throw new Error(
      `No FRED data for ${id}`
    );
  }

  return {
    id,

    date: values[0].date,

    value: values[0].value,

    change:
      values.length > 1
        ? round(
            values[0].value -
            values[1].value,
            3
          )
        : null,

    link:
      `https://fred.stlouisfed.org/series/${id}`
  };
}

async function loadMacro() {
  const key =
    process.env.FRED_API_KEY;

  if (!key) {
    throw new Error(
      "Missing FRED_API_KEY"
    );
  }

  const ids = [
    "DFII10",
    "DGS10",
    "DTWEXBGS"
  ];

  const result = await Promise.allSettled(
    ids.map(id => fredSeries(id, key))
  );

  const data = {};
  const errors = [];

  result.forEach((r, i) => {
    if (r.status === "fulfilled") {
      data[ids[i]] = r.value;
    } else {
      errors.push(
        `${ids[i]}: ${r.reason.message}`
      );
    }
  });

  if (!Object.keys(data).length) {
    throw new Error(
      errors.join("; ")
    );
  }

  return {
    data,
    errors
  };
}


/* ============================================================
   TECHNICAL MATHEMATICS
============================================================ */

function ema(candles, length) {
  if (
    candles.length < length
  ) return null;

  const k =
    2 / (length + 1);

  let value =
    candles[0].c;

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    value =
      candles[i].c * k +
      value * (1 - k);
  }

  return value;
}

function atr(
  candles,
  period = 14
) {
  if (
    candles.length <= period
  ) return null;

  const ranges = [];

  for (
    let i = candles.length - period;
    i < candles.length;
    i++
  ) {
    const x = candles[i];
    const previous = candles[i - 1];

    ranges.push(
      Math.max(
        x.h - x.l,
        Math.abs(
          x.h - previous.c
        ),
        Math.abs(
          x.l - previous.c
        )
      )
    );
  }

  return ranges.reduce(
    (a, b) => a + b,
    0
  ) / ranges.length;
}

function rsi(
  candles,
  period = 14
) {
  if (
    candles.length <= period
  ) return null;

  let up = 0;
  let down = 0;

  for (
    let i = candles.length - period;
    i < candles.length;
    i++
  ) {
    const diff =
      candles[i].c -
      candles[i - 1].c;

    up += Math.max(diff, 0);
    down += Math.max(-diff, 0);
  }

  if (!down) {
    return up ? 100 : 50;
  }

  return 100 -
    100 / (1 + up / down);
}


/* ============================================================
   HIGH-PRIORITY LIQUIDITY LEVELS
============================================================ */

function levelsFromCandles(
  bars,
  current,
  volatility
) {
  if (
    bars.length < 30
  ) return [];

  const tolerance = Math.max(
    volatility * 0.3,
    current * 0.0002
  );

  const clusters = [];

  function add(
    price,
    side,
    kind,
    time,
    bonus = 0
  ) {
    if (
      !Number.isFinite(price)
    ) return;

    let found = clusters.find(
      z =>
        z.side === side &&
        Math.abs(
          z.price - price
        ) <= tolerance
    );

    if (found) {
      found.price =
        (
          found.price *
          found.touches +
          price
        ) /
        (found.touches + 1);

      found.touches++;

      found.bonus = Math.max(
        found.bonus,
        bonus
      );

      if (
        time > found.time
      ) {
        found.time = time;
      }

      if (
        bonus >= found.labelBonus
      ) {
        found.kind = kind;
        found.labelBonus = bonus;
      }
    } else {
      clusters.push({
        price,
        side,
        kind,
        touches: 1,
        time,
        bonus,
        labelBonus: bonus
      });
    }
  }

  // Confirmed pivots need four candles
  // to the left and four to the right.
  for (
    let i = 4;
    i < bars.length - 4;
    i++
  ) {
    const window =
      bars.slice(
        i - 4,
        i + 5
      );

    if (
      window.every(
        (c, j) =>
          j === 4 ||
          bars[i].h > c.h
      )
    ) {
      add(
        bars[i].h,
        "HIGH",
        "Swing high",
        bars[i].t
      );
    }

    if (
      window.every(
        (c, j) =>
          j === 4 ||
          bars[i].l < c.l
      )
    ) {
      add(
        bars[i].l,
        "LOW",
        "Swing low",
        bars[i].t
      );
    }
  }

  const dates = [
    ...new Set(
      bars.map(
        b =>
          new Date(b.t)
            .toISOString()
            .slice(0, 10)
      )
    )
  ];

  // Previous observed UTC trading day.
  if (
    dates.length >= 2
  ) {
    const previousDay =
      bars.filter(
        b =>
          new Date(b.t)
            .toISOString()
            .startsWith(
              dates.at(-2)
            )
      );

    add(
      Math.max(
        ...previousDay.map(
          b => b.h
        )
      ),
      "HIGH",
      "Previous day high",
      previousDay.at(-1).t,
      24
    );

    add(
      Math.min(
        ...previousDay.map(
          b => b.l
        )
      ),
      "LOW",
      "Previous day low",
      previousDay.at(-1).t,
      24
    );
  }

  const activeDay =
    dates.at(-1);

  // Simplified fixed UTC session windows.
  // Not DST-adjusted exchange session hours.
  const windows = [
    [
      "Asia 00–08 UTC",
      0,
      8
    ],
    [
      "London 08–13 UTC",
      8,
      13
    ],
    [
      "New York 13–21 UTC",
      13,
      21
    ]
  ];

  for (
    const [
      label,
      from,
      to
    ] of windows
  ) {
    const group =
      bars.filter(b =>
        new Date(b.t)
          .toISOString()
          .startsWith(
            activeDay
          ) &&
        new Date(b.t)
          .getUTCHours() >= from &&
        new Date(b.t)
          .getUTCHours() < to
      );

    if (
      !group.length
    ) continue;

    add(
      Math.max(
        ...group.map(
          b => b.h
        )
      ),
      "HIGH",
      `${label} high`,
      group.at(-1).t,
      14
    );

    add(
      Math.min(
        ...group.map(
          b => b.l
        )
      ),
      "LOW",
      `${label} low`,
      group.at(-1).t,
      14
    );
  }

  return clusters.map(
    z => ({
      price:
        round(z.price),

      side:
        z.side,

      label:
        z.kind,

      touches:
        z.touches,

      distance:
        round(
          Math.abs(
            z.price - current
          )
        ),

      strength: clamp(
        Math.round(
          28 +
          z.bonus +
          Math.min(
            z.touches,
            5
          ) * 11
        ),
        0,
        95
      ),

      lastSeen:
        new Date(
          z.time
        ).toISOString()
    })
  )
    .sort(
      (a, b) =>
        b.strength -
          a.strength ||
        a.distance -
          b.distance
    )
    .slice(0, 16);
}


/* ============================================================
   LIQUIDITY SWEEP DETECTION
============================================================ */

function findSweeps(
  bars,
  zones,
  volatility
) {
  const alerts = [];

  if (
    !bars.length
  ) return alerts;

  for (
    const bar of bars.slice(-4)
  ) {
    for (
      const z of zones
    ) {
      // A zone must predate the signal bar.
      if (
        Date.parse(
          z.lastSeen
        ) >= bar.t
      ) continue;

      const highSweep =
        z.side === "HIGH" &&
        bar.h >
          z.price +
          volatility * 0.08 &&
        bar.c < z.price;

      const lowSweep =
        z.side === "LOW" &&
        bar.l <
          z.price -
          volatility * 0.08 &&
        bar.c > z.price;

      if (
        !highSweep &&
        !lowSweep
      ) continue;

      const wick =
        highSweep
          ? bar.h - z.price
          : z.price - bar.l;

      alerts.push({
        direction:
          highSweep
            ? "BEARISH"
            : "BULLISH",

        level:
          z.label,

        price:
          z.price,

        time:
          new Date(
            bar.t
          ).toISOString(),

        evidenceScore:
          clamp(
            Math.round(
              48 +
              Math.min(
                wick / volatility,
                1.8
              ) * 17 +
              z.strength * 0.2
            ),
            0,
            95
          )
      });
    }
  }

  return alerts
    .sort(
      (a, b) =>
        Date.parse(
          b.time
        ) -
          Date.parse(
            a.time
          ) ||
        b.evidenceScore -
          a.evidenceScore
    )
    .slice(0, 8);
}


/* ============================================================
   COMBINED INSTITUTIONAL EVIDENCE ENGINE
============================================================ */

function analyze(
  m5,
  h1,
  cot,
  macro
) {
  const bars =
    m5?.candles || [];

  const last =
    m5?.latest;

  const price =
    last?.c ?? null;

  const v = atr(bars);

  const zones =
    price !== null && v
      ? levelsFromCandles(
          bars,
          price,
          v
        )
      : [];

  const sweeps =
    v
      ? findSweeps(
          bars,
          zones,
          v
        )
      : [];

  const recentSweep =
    sweeps.find(
      x =>
        Date.now() -
          Date.parse(
            x.time
          ) <
        25 * 60000
    );

  const factors = [];

  function factor(
    label,
    direction,
    weight,
    detail
  ) {
    if (
      !Number.isFinite(
        direction
      )
    ) return;

    factors.push({
      label,

      direction:
        clamp(
          direction,
          -1,
          1
        ),

      weight,
      detail
    });
  }

  const ema20 =
    ema(bars, 20);

  const ema50 =
    ema(bars, 50);

  const h1fast =
    h1
      ? ema(
          h1.candles,
          20
        )
      : null;

  const h1slow =
    h1
      ? ema(
          h1.candles,
          50
        )
      : null;

  if (
    ema20 !== null &&
    ema50 !== null
  ) {
    factor(
      "M5 trend",
      ema20 > ema50
        ? 1
        : -1,
      20,
      "EMA20 compared with EMA50"
    );
  }

  if (
    h1fast !== null &&
    h1slow !== null
  ) {
    factor(
      "H1 trend",
      h1fast > h1slow
        ? 1
        : -1,
      24,
      "EMA20 compared with EMA50"
    );
  }

  const oi =
    cot?.openInterest;

  if (
    cot &&
    Number.isFinite(
      cot.weeklyNetChange
    ) &&
    oi > 0
  ) {
    factor(
      "Weekly managed money",

      cot.weeklyNetChange /
        (oi * 0.02),

      15,

      "Net position change as share of open interest"
    );
  }

  const real =
    macro?.data?.DFII10;

  const dollar =
    macro?.data?.DTWEXBGS;

  const nominal =
    macro?.data?.DGS10;

  if (
    Number.isFinite(
      real?.change
    )
  ) {
    factor(
      "US real yields",
      -real.change / 0.08,
      16,
      "Falling real yields generally support gold"
    );
  }

  if (
    Number.isFinite(
      dollar?.change
    )
  ) {
    factor(
      "Broad US dollar",
      -dollar.change / 0.4,
      10,
      "A weaker dollar can support gold"
    );
  }

  if (
    Number.isFinite(
      nominal?.change
    )
  ) {
    factor(
      "US nominal yields",
      -nominal.change / 0.1,
      5,
      "Yield pressure is contextual"
    );
  }

  if (
    recentSweep &&
    price !== null &&
    Date.now() -
      last.t <
    20 * 60000
  ) {
    factor(
      "Recent liquidity rejection",

      recentSweep.direction ===
        "BULLISH"
        ? 1
        : -1,

      10,

      "Recent confirmed candle rejected a prior level"
    );
  }

  const weight =
    factors.reduce(
      (s, f) =>
        s + f.weight,
      0
    );

  const score =
    weight
      ? Math.round(
          factors.reduce(
            (s, f) =>
              s +
              f.direction *
                f.weight,
            0
          ) /
          weight *
          100
        )
      : null;

  const status =
    score === null
      ? "NO DATA"
      : score > 22
        ? "BULLISH LEAN"
        : score < -22
          ? "BEARISH LEAN"
          : "MIXED / NEUTRAL";

  return {
    price:
      price === null
        ? null
        : {
            value:
              round(price),

            candleTime:
              new Date(
                last.t
              ).toISOString(),

            delayMinutes:
              Math.max(
                0,
                Math.floor(
                  (
                    Date.now() -
                    last.t
                  ) /
                    60000
                )
              ),

            marketFresh:
              Date.now() -
                last.t <
              20 * 60000,

            basis:
              "Latest available XAU/USD candle close, not guaranteed live bid/ask"
          },

    technical: {
      atr5m:
        round(v),

      ema20:
        round(ema20),

      ema50:
        round(ema50),

      rsi14:
        round(
          rsi(bars)
        ),

      h1ema20:
        round(h1fast),

      h1ema50:
        round(h1slow)
    },

    zones,
    sweeps,

    bias: {
      status,
      score,
      factors,

      coverage:
        weight,

      explanation:
        "Directional evidence index, not a win rate, forecast, or probability."
    },

    candles:
      bars.slice(-110)
        .map(
          b => ({
            ...b,

            time:
              new Date(
                b.t
              ).toISOString()
          })
        )
  };
}


/* ============================================================
   VERCEL API ENDPOINT
============================================================ */

export default async function handler(req, res) {
  if (
    req.method !== "GET"
  ) {
    return res
      .status(405)
      .json({
        error:
          "Use GET"
      });
  }

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=45, stale-while-revalidate=15"
  );

  try {
    const tdKey1 =
      process.env
        .TWELVE_DATA_API_KEY;

    const tdKey2 =
      process.env
        .TWELVE_DATA_API_KEY_2 ||
      tdKey1;

    const names = [
      "m5",
      "h1",
      "cot",
      "macro"
    ];

    const all =
      await Promise.allSettled([
        loadPrice(
          "5min",
          "650",
          tdKey1
        ),

        loadPrice(
          "1h",
          "200",
          tdKey2
        ),

        loadCOT(),

        loadMacro()
      ]);

    const data = {};
    const sources = {};
    const errors = [];

    all.forEach(
      (result, i) => {
        const name =
          names[i];

        if (
          result.status ===
          "fulfilled"
        ) {
          data[name] =
            result.value;

          sources[name] =
            "OK";
        } else {
          data[name] =
            null;

          sources[name] =
            "UNAVAILABLE";

          errors.push({
            source: name,

            message:
              result.reason?.message ||
              "Unknown provider error"
          });
        }
      }
    );

    const analysis =
      analyze(
        data.m5,
        data.h1,
        data.cot,
        data.macro
      );

    return res
      .status(200)
      .json({
        ok: Boolean(
          data.m5 ||
          data.cot ||
          data.macro
        ),

        product:
          "MKAYFX GOLD INSTITUTIONAL RADAR V1",

        generatedAt:
          new Date().toISOString(),

        sources,
        errors,

        ...analysis,

        positioning:
          data.cot,

        macro:
          data.macro?.data || {},

        macroErrors:
          data.macro?.errors || [],

        notes: [
          "CFTC COT represents public Tuesday positions, typically released Friday.",
          "Spot XAU/USD candles do not reveal actual institutional order flow.",
          "All rankings and evidence scores are heuristic, not probabilities or investment advice."
        ]
      });
  } catch (err) {
    return res
      .status(500)
      .json({
        ok: false,

        error:
          err.message ||
          "Internal error"
      });
  }
}