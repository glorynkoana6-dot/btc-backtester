/* ================================================================
   MKAYFX GOLD INTELLIGENCE V9
   LIQUIDITY WARFARE ENGINE
   ---------------------------------------------------------------
   FILE: /api/xau.js

   DATA
   ----
   API #1  TWELVE_DATA_API_KEY
           XAU/USD M1 + M5

   API #2  TWELVE_DATA_API_KEY_2
           XAU/USD M15 + H1 + H4

   API #3  TWELVE_DATA_API_KEY_3
           Deep historical XAU/USD M5

   API #4  TWELVE_DATA_API_KEY_4
           Intermarket confirmation

   MACRO   FRED_API_KEY
           Optional US macro pressure

   DESIGN
   ------
   REST ONLY.
   NO WEBSOCKET REQUIRED.

   FEATURES
   --------
   - Live XAU/USD price
   - M1 / M5 / M15 / H1 / H4
   - EMA 20 / 50 / 200 context
   - RSI
   - ATR
   - VWAP proxy
   - Asia high / low
   - London high / low
   - New York high / low
   - Previous day high / low
   - Previous week high / low
   - H1 swing liquidity
   - Equal highs / equal lows
   - FVG detection
   - BOS
   - CHOCH
   - Buy-side liquidity
   - Sell-side liquidity
   - Liquidity strength
   - Raid score
   - Sweep detection
   - Rejection detection
   - Delta proxy
   - CVD proxy
   - Absorption
   - Delta divergence
   - Historical raid behavior
   - Intermarket intelligence
   - Optional FRED macro intelligence
   - Trade idea
   - Entry / SL / TP1 / TP2
   - Liquidity path projection
   - Chart payload

   IMPORTANT
   ---------
   Liquidity scores, raid scores, scenario scores and trade
   confluence are heuristic model outputs. They are NOT
   guaranteed probabilities.
================================================================ */


const TD_BASE =
  "https://api.twelvedata.com/time_series";

const FRED_BASE =
  "https://api.stlouisfed.org/fred/series/observations";

const SYMBOL =
  "XAU/USD";


/* ================================================================
   CACHE
================================================================ */

const CACHE_MS =
  25_000;

const MACRO_CACHE_MS =
  15 * 60_000;


let engineCache = {
  at: 0,
  data: null
};

let macroCache = {
  at: 0,
  data: null
};


/* ================================================================
   BASIC HELPERS
================================================================ */

const clamp = (n, a, b) =>
  Math.max(a, Math.min(b, n));


const round = (n, d = 2) =>
  Number.isFinite(n)
    ? Number(n.toFixed(d))
    : null;


const pct = (a, b) =>
  b
    ? ((a - b) / b) * 100
    : 0;


const mean = arr =>
  arr.length
    ? arr.reduce((s, x) => s + x, 0) / arr.length
    : 0;


function safeNum(v) {

  const n =
    Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}


/* ================================================================
   API KEYS
================================================================ */

function keyPool() {

  const k1 =
    process.env.TWELVE_DATA_API_KEY || "";

  const k2 =
    process.env.TWELVE_DATA_API_KEY_2 ||
    k1;

  const k3 =
    process.env.TWELVE_DATA_API_KEY_3 ||
    k2 ||
    k1;

  const k4 =
    process.env.TWELVE_DATA_API_KEY_4 ||
    k3 ||
    k2 ||
    k1;


  return {
    k1,
    k2,
    k3,
    k4
  };
}


/* ================================================================
   FETCH JSON
================================================================ */

async function fetchJson(
  url,
  timeoutMs = 11_000
) {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );


  try {

    const r =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "MKAYFX-Gold-Intelligence/9.0"
          },

          cache:
            "no-store"
        }
      );


    if (!r.ok) {

      throw new Error(
        `HTTP ${r.status}`
      );
    }


    return await r.json();

  }
  finally {

    clearTimeout(timer);
  }
}


/* ================================================================
   TWELVE DATA
================================================================ */

async function fetchTD(
  symbol,
  interval,
  outputsize,
  preferredKey,
  fallbackKeys = []
) {

  const keys = [
    preferredKey,
    ...fallbackKeys
  ].filter(Boolean);


  if (!keys.length) {

    throw new Error(
      "Missing Twelve Data API key"
    );
  }


  let lastError =
    null;


  for (
    const key
    of [...new Set(keys)]
  ) {

    try {

      const q =
        new URLSearchParams({
          symbol,
          interval,

          outputsize:
            String(outputsize),

          order:
            "asc",

          timezone:
            "UTC",

          apikey:
            key
        });


      const json =
        await fetchJson(
          `${TD_BASE}?${q}`
        );


      if (
        json?.status === "error" ||
        !Array.isArray(json?.values)
      ) {

        throw new Error(
          json?.message ||
          `No ${symbol} ${interval} data`
        );
      }


      const candles =
        json.values
        .map(v => {

          const datetime =
            String(v.datetime)
            .replace(
              " ",
              "T"
            );


          return {

            time:
              Math.floor(
                new Date(
                  `${datetime}Z`
                ).getTime() /
                1000
              ),

            datetime:
              v.datetime,

            open:
              safeNum(v.open),

            high:
              safeNum(v.high),

            low:
              safeNum(v.low),

            close:
              safeNum(v.close),

            volume:
              safeNum(v.volume) ||
              0
          };

        })
        .filter(c =>
          [
            c.time,
            c.open,
            c.high,
            c.low,
            c.close
          ]
          .every(
            Number.isFinite
          )
        );


      if (
        candles.length <
        Math.min(
          30,
          outputsize / 3
        )
      ) {

        throw new Error(
          `Too few ${symbol} ${interval} candles`
        );
      }


      return candles;

    }
    catch (e) {

      lastError =
        e;
    }
  }


  throw (
    lastError ||
    new Error(
      `Failed ${symbol} ${interval}`
    )
  );
}


/* ================================================================
   EMA
================================================================ */

function ema(
  values,
  period
) {

  if (!values.length)
    return [];


  const k =
    2 /
    (
      period + 1
    );


  const out =
    [
      values[0]
    ];


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    out.push(
      values[i] *
      k +
      out[i - 1] *
      (
        1 - k
      )
    );
  }


  return out;
}


/* ================================================================
   RSI
================================================================ */

function rsi(
  candles,
  period = 14
) {

  if (
    candles.length <
    period + 2
  ) {

    return 50;
  }


  const closes =
    candles.map(
      c => c.close
    );


  let gains = 0;

  let losses = 0;


  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const d =
      closes[i] -
      closes[i - 1];


    if (d >= 0)
      gains += d;

    else
      losses -= d;
  }


  let ag =
    gains /
    period;

  let al =
    losses /
    period;


  for (
    let i = period + 1;
    i < closes.length;
    i++
  ) {

    const d =
      closes[i] -
      closes[i - 1];


    ag =
      (
        ag *
        (
          period - 1
        ) +
        Math.max(
          d,
          0
        )
      ) /
      period;


    al =
      (
        al *
        (
          period - 1
        ) +
        Math.max(
          -d,
          0
        )
      ) /
      period;
  }


  if (al === 0)
    return 100;


  const rs =
    ag /
    al;


  return (
    100 -
    100 /
    (
      1 + rs
    )
  );
}


/* ================================================================
   ATR
================================================================ */

function atr(
  candles,
  period = 14
) {

  if (
    candles.length <
    2
  ) {

    return 0;
  }


  const trs =
    [];


  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const c =
      candles[i];

    const p =
      candles[i - 1];


    trs.push(
      Math.max(
        c.high -
        c.low,

        Math.abs(
          c.high -
          p.close
        ),

        Math.abs(
          c.low -
          p.close
        )
      )
    );
  }


  return mean(
    trs.slice(
      -period
    )
  );
}


/* ================================================================
   VWAP PROXY
================================================================ */

function vwap(
  candles,
  lookback = 96
) {

  const a =
    candles.slice(
      -lookback
    );


  let pv = 0;

  let vol = 0;


  for (
    const c
    of a
  ) {

    const typical =
      (
        c.high +
        c.low +
        c.close
      ) /
      3;


    const weight =
      c.volume > 0
        ? c.volume
        : Math.max(
            c.high -
            c.low,
            0.0001
          );


    pv +=
      typical *
      weight;


    vol +=
      weight;
  }


  return vol
    ? pv / vol
    : (
        a.at(-1)?.close ||
        0
      );
}


/* ================================================================
   TIMEFRAME TREND
================================================================ */

function trendFrame(
  candles
) {

  const closes =
    candles.map(
      c => c.close
    );


  const e20 =
    ema(
      closes,
      20
    ).at(-1) ||
    closes.at(-1);


  const e50 =
    ema(
      closes,
      50
    ).at(-1) ||
    e20;


  const e200 =
    ema(
      closes,
      200
    ).at(-1) ||
    e50;


  const price =
    closes.at(-1);


  let bias =
    "NEUTRAL";


  let score =
    0;


  if (
    price > e20 &&
    e20 > e50
  ) {

    score += 1;
  }


  if (
    e50 > e200
  ) {

    score += 1;
  }


  if (
    price < e20 &&
    e20 < e50
  ) {

    score -= 1;
  }


  if (
    e50 < e200
  ) {

    score -= 1;
  }


  if (
    score >= 2
  ) {

    bias =
      "BULLISH";
  }

  else if (
    score <= -2
  ) {

    bias =
      "BEARISH";
  }


  return {

    bias,

    price:
      round(price),

    ema20:
      round(e20),

    ema50:
      round(e50),

    ema200:
      round(e200),

    rsi:
      round(
        rsi(candles),
        1
      ),

    atr:
      round(
        atr(candles),
        3
      )
  };
}


/* ================================================================
   PIVOTS
================================================================ */

function pivots(
  candles,
  len = 5
) {

  const highs =
    [];

  const lows =
    [];


  for (
    let i = len;
    i <
    candles.length -
    len;
    i++
  ) {

    let hi =
      true;

    let lo =
      true;


    for (
      let j = i - len;
      j <= i + len;
      j++
    ) {

      if (
        j === i
      ) {

        continue;
      }


      if (
        candles[j].high >=
        candles[i].high
      ) {

        hi =
          false;
      }


      if (
        candles[j].low <=
        candles[i].low
      ) {

        lo =
          false;
      }


      if (
        !hi &&
        !lo
      ) {

        break;
      }
    }


    if (hi) {

      highs.push({

        price:
          candles[i].high,

        time:
          candles[i].time,

        index:
          i
      });
    }


    if (lo) {

      lows.push({

        price:
          candles[i].low,

        time:
          candles[i].time,

        index:
          i
      });
    }
  }


  return {
    highs,
    lows
  };
}


/* ================================================================
   EQUAL HIGHS / LOWS
================================================================ */

function equalLevels(
  candles,
  p,
  tolerance
) {

  const out =
    [];


  const sets =
    [

      [
        "EQH",
        "BUY_SIDE",
        p.highs.slice(-14)
      ],

      [
        "EQL",
        "SELL_SIDE",
        p.lows.slice(-14)
      ]
    ];


  for (
    const [
      type,
      side,
      arr
    ]
    of sets
  ) {

    for (
      let i = 0;
      i < arr.length;
      i++
    ) {

      const matches =
        arr.filter(
          (
            x,
            j
          ) =>
            j !== i &&
            Math.abs(
              x.price -
              arr[i].price
            ) <=
            tolerance
        );


      if (
        matches.length
      ) {

        const prices =
          [
            arr[i].price,
            ...matches.map(
              x => x.price
            )
          ];


        out.push({

          type,

          side,

          price:
            mean(prices),

          touches:
            prices.length,

          time:
            arr[i].time
        });
      }
    }
  }


  const uniq =
    [];


  for (
    const l
    of out.sort(
      (
        a,
        b
      ) =>
        b.touches -
        a.touches
    )
  ) {

    if (
      !uniq.some(
        x =>
          x.type === l.type &&
          Math.abs(
            x.price -
            l.price
          ) <=
          tolerance
      )
    ) {

      uniq.push(l);
    }
  }


  return uniq.slice(
    0,
    8
  );
}


/* ================================================================
   DAY HELPERS
================================================================ */

function utcDayKey(t) {

  const d =
    new Date(
      t * 1000
    );


  return (
    `${d.getUTCFullYear()}-` +
    `${String(
      d.getUTCMonth() + 1
    ).padStart(
      2,
      "0"
    )}-` +
    `${String(
      d.getUTCDate()
    ).padStart(
      2,
      "0"
    )}`
  );
}


/* ================================================================
   PREVIOUS DAY
================================================================ */

function previousDayLevels(
  candles
) {

  const groups =
    new Map();


  for (
    const c
    of candles
  ) {

    const k =
      utcDayKey(
        c.time
      );


    if (
      !groups.has(k)
    ) {

      groups.set(
        k,
        []
      );
    }


    groups
    .get(k)
    .push(c);
  }


  const keys =
    [
      ...groups.keys()
    ];


  if (
    keys.length < 2
  ) {

    return {
      pdh: null,
      pdl: null,
      day: null
    };
  }


  const prevKey =
    keys[
      keys.length -
      2
    ];


  const a =
    groups.get(
      prevKey
    );


  return {

    pdh:
      Math.max(
        ...a.map(
          x => x.high
        )
      ),

    pdl:
      Math.min(
        ...a.map(
          x => x.low
        )
      ),

    day:
      prevKey
  };
}


/* ================================================================
   ISO WEEK
================================================================ */

function isoWeekKey(t) {

  const d =
    new Date(
      t * 1000
    );


  const x =
    new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate()
      )
    );


  const day =
    x.getUTCDay() ||
    7;


  x.setUTCDate(
    x.getUTCDate() +
    4 -
    day
  );


  const y0 =
    new Date(
      Date.UTC(
        x.getUTCFullYear(),
        0,
        1
      )
    );


  const week =
    Math.ceil(
      (
        (
          (
            x -
            y0
          ) /
          86400000
        ) +
        1
      ) /
      7
    );


  return (
    `${x.getUTCFullYear()}-W` +
    `${String(
      week
    ).padStart(
      2,
      "0"
    )}`
  );
}


/* ================================================================
   PREVIOUS WEEK
================================================================ */

function previousWeekLevels(
  candles
) {

  const groups =
    new Map();


  for (
    const c
    of candles
  ) {

    const k =
      isoWeekKey(
        c.time
      );


    if (
      !groups.has(k)
    ) {

      groups.set(
        k,
        []
      );
    }


    groups
    .get(k)
    .push(c);
  }


  const keys =
    [
      ...groups.keys()
    ];


  if (
    keys.length < 2
  ) {

    return {
      pwh: null,
      pwl: null,
      week: null
    };
  }


  const k =
    keys[
      keys.length -
      2
    ];


  const a =
    groups.get(k);


  return {

    pwh:
      Math.max(
        ...a.map(
          x => x.high
        )
      ),

    pwl:
      Math.min(
        ...a.map(
          x => x.low
        )
      ),

    week:
      k
  };
}


/* ================================================================
   SESSION LIQUIDITY
================================================================ */

function sessionLevels(
  candles
) {

  const today =
    utcDayKey(
      candles.at(-1).time
    );


  const rows =
    candles.filter(
      c =>
        utcDayKey(
          c.time
        ) ===
        today
    );


  const definitions =
    [

      {
        name:
          "ASIA",

        from:
          0,

        to:
          8
      },

      {
        name:
          "LONDON",

        from:
          7,

        to:
          16
      },

      {
        name:
          "NEW_YORK",

        from:
          12,

        to:
          21
      }
    ];


  const out =
    {};


  for (
    const session
    of definitions
  ) {

    const a =
      rows.filter(
        c => {

          const h =
            new Date(
              c.time *
              1000
            )
            .getUTCHours();


          return (
            h >=
            session.from &&
            h <
            session.to
          );
        }
      );


    out[
      session.name
    ] =
      a.length
        ? {

            high:
              Math.max(
                ...a.map(
                  x => x.high
                )
              ),

            low:
              Math.min(
                ...a.map(
                  x => x.low
                )
              ),

            open:
              a[0].open,

            close:
              a.at(-1).close,

            bars:
              a.length
          }

        : null;
  }


  return out;
}


/* ================================================================
   FAIR VALUE GAPS
================================================================ */

function fvgZones(
  candles,
  max = 10
) {

  const zones =
    [];


  for (
    let i = 2;
    i < candles.length;
    i++
  ) {

    const a =
      candles[
        i - 2
      ];


    const c =
      candles[i];


    if (
      c.low >
      a.high
    ) {

      zones.push({

        type:
          "BULLISH_FVG",

        side:
          "SUPPORT",

        low:
          a.high,

        high:
          c.low,

        time:
          c.time
      });
    }


    if (
      c.high <
      a.low
    ) {

      zones.push({

        type:
          "BEARISH_FVG",

        side:
          "RESISTANCE",

        low:
          c.high,

        high:
          a.low,

        time:
          c.time
      });
    }
  }


  return zones.slice(
    -max
  );
}


/* ================================================================
   STRUCTURE
================================================================ */

function structureState(
  candles,
  p
) {

  const price =
    candles.at(-1).close;


  const lastH =
    p.highs.at(-1);

  const prevH =
    p.highs.at(-2);

  const lastL =
    p.lows.at(-1);

  const prevL =
    p.lows.at(-2);


  let state =
    "RANGE";


  let bos =
    null;


  let choch =
    null;


  if (
    lastH &&
    prevH &&
    lastL &&
    prevL
  ) {

    const hh =
      lastH.price >
      prevH.price;


    const hl =
      lastL.price >
      prevL.price;


    const lh =
      lastH.price <
      prevH.price;


    const ll =
      lastL.price <
      prevL.price;


    if (
      hh &&
      hl
    ) {

      state =
        "BULLISH";
    }

    else if (
      lh &&
      ll
    ) {

      state =
        "BEARISH";
    }


    if (
      price >
      lastH.price
    ) {

      bos =
        "BULLISH_BOS";
    }


    if (
      price <
      lastL.price
    ) {

      bos =
        "BEARISH_BOS";
    }


    if (
      state ===
        "BEARISH" &&
      price >
        lastH.price
    ) {

      choch =
        "BULLISH_CHOCH";
    }


    if (
      state ===
        "BULLISH" &&
      price <
        lastL.price
    ) {

      choch =
        "BEARISH_CHOCH";
    }
  }


  return {

    state,

    bos,

    choch,

    lastSwingHigh:
      lastH?.price ||
      null,

    lastSwingLow:
      lastL?.price ||
      null
  };
}


/* ================================================================
   ORDER FLOW / DELTA PROXY
================================================================ */

function deltaProxy(
  candles,
  lookback = 40
) {

  const a =
    candles.slice(
      -lookback
    );


  let delta =
    0;


  let cvd =
    0;


  const cvdSeries =
    [];


  for (
    const c
    of a
  ) {

    const range =
      Math.max(
        c.high -
        c.low,
        1e-9
      );


    const pressure =
      (
        (
          c.close -
          c.open
        ) /
        range
      ) *
      (
        c.volume ||
        range
      );


    delta +=
      pressure;


    cvd +=
      pressure;


    cvdSeries.push(
      cvd
    );
  }


  const recent =
    a.slice(-5);


  const wickReject =
    mean(
      recent.map(
        c => {

          const range =
            Math.max(
              c.high -
              c.low,
              1e-9
            );


          const body =
            Math.abs(
              c.close -
              c.open
            );


          return (
            1 -
            body /
            range
          );
        }
      )
    );


  const priceMove =
    a.length > 1
      ? (
          a.at(-1).close -
          a[0].close
        )
      : 0;


  const cvdMove =
    cvdSeries.length > 1
      ? (
          cvdSeries.at(-1) -
          cvdSeries[0]
        )
      : 0;


  const divergence =
    priceMove > 0 &&
    cvdMove < 0

      ? "BEARISH"

      : priceMove < 0 &&
        cvdMove > 0

        ? "BULLISH"

        : "NONE";


  let absorption =
    "LOW";


  if (
    wickReject >
    0.62
  ) {

    absorption =
      "ELEVATED";
  }

  else if (
    wickReject >
    0.48
  ) {

    absorption =
      "MODERATE";
  }


  return {

    delta:
      round(
        delta,
        2
      ),

    cvd:
      round(
        cvd,
        2
      ),

    divergence,

    absorption
  };
}


/* ================================================================
   BUILD LIQUIDITY MAP
================================================================ */

function buildLiquidityLevels({
  m5,
  h1,
  hist,
  sessions,
  day,
  week,
  fvg
}) {

  const currentAtr =
    atr(m5) ||
    1;


  const hp =
    pivots(
      h1,
      4
    );


  const mp =
    pivots(
      m5,
      5
    );


  const eq =
    equalLevels(
      m5,
      mp,
      currentAtr *
      0.18
    );


  const levels =
    [];


  const add = (
    name,
    price,
    side,
    type,
    weight = 50,
    meta = {}
  ) => {

    if (
      Number.isFinite(
        price
      )
    ) {

      levels.push({

        name,

        price,

        side,

        type,

        weight,

        ...meta
      });
    }
  };


  add(
    "Previous Day High",
    day.pdh,
    "BUY_SIDE",
    "PDH",
    92
  );


  add(
    "Previous Day Low",
    day.pdl,
    "SELL_SIDE",
    "PDL",
    92
  );


  add(
    "Previous Week High",
    week.pwh,
    "BUY_SIDE",
    "PWH",
    96
  );


  add(
    "Previous Week Low",
    week.pwl,
    "SELL_SIDE",
    "PWL",
    96
  );


  if (
    sessions.ASIA
  ) {

    add(
      "Asia High",
      sessions.ASIA.high,
      "BUY_SIDE",
      "ASIA_HIGH",
      82
    );


    add(
      "Asia Low",
      sessions.ASIA.low,
      "SELL_SIDE",
      "ASIA_LOW",
      82
    );
  }


  if (
    sessions.LONDON
  ) {

    add(
      "London High",
      sessions.LONDON.high,
      "BUY_SIDE",
      "LONDON_HIGH",
      86
    );


    add(
      "London Low",
      sessions.LONDON.low,
      "SELL_SIDE",
      "LONDON_LOW",
      86
    );
  }


  if (
    sessions.NEW_YORK
  ) {

    add(
      "New York High",
      sessions.NEW_YORK.high,
      "BUY_SIDE",
      "NY_HIGH",
      84
    );


    add(
      "New York Low",
      sessions.NEW_YORK.low,
      "SELL_SIDE",
      "NY_LOW",
      84
    );
  }


  hp.highs
  .slice(-4)
  .forEach(
    (
      x,
      i
    ) => {

      add(
        `H1 Swing High ${i + 1}`,
        x.price,
        "BUY_SIDE",
        "H1_SWING_HIGH",
        78 -
        i *
        3,
        {
          time:
            x.time
        }
      );
    }
  );


  hp.lows
  .slice(-4)
  .forEach(
    (
      x,
      i
    ) => {

      add(
        `H1 Swing Low ${i + 1}`,
        x.price,
        "SELL_SIDE",
        "H1_SWING_LOW",
        78 -
        i *
        3,
        {
          time:
            x.time
        }
      );
    }
  );


  eq.forEach(
    (
      x,
      i
    ) => {

      add(

        x.type === "EQH"
          ? `Equal Highs ${i + 1}`
          : `Equal Lows ${i + 1}`,

        x.price,

        x.side,

        x.type,

        clamp(
          62 +
          x.touches *
          7,
          0,
          90
        ),

        {
          touches:
            x.touches,

          time:
            x.time
        }
      );
    }
  );


  fvg
  .slice(-6)
  .forEach(
    (
      z,
      i
    ) => {

      add(

        `${z.type.replaceAll(
          "_",
          " "
        )} ${i + 1}`,

        (
          z.low +
          z.high
        ) /
        2,

        z.side ===
        "SUPPORT"

          ? "SELL_SIDE"

          : "BUY_SIDE",

        z.type,

        55,

        {
          low:
            z.low,

          high:
            z.high,

          time:
            z.time
        }
      );
    }
  );


  const histP =
    pivots(
      hist,
      7
    );


  histP.highs
  .slice(-2)
  .forEach(
    (
      x,
      i
    ) => {

      add(
        `Historical Swing High ${i + 1}`,
        x.price,
        "BUY_SIDE",
        "HIST_HIGH",
        67 -
        i *
        4,
        {
          time:
            x.time
        }
      );
    }
  );


  histP.lows
  .slice(-2)
  .forEach(
    (
      x,
      i
    ) => {

      add(
        `Historical Swing Low ${i + 1}`,
        x.price,
        "SELL_SIDE",
        "HIST_LOW",
        67 -
        i *
        4,
        {
          time:
            x.time
        }
      );
    }
  );


  const unique =
    [];


  for (
    const l
    of levels.sort(
      (
        x,
        y
      ) =>
        y.weight -
        x.weight
    )
  ) {

    if (
      !unique.some(
        u =>
          u.side ===
            l.side &&
          Math.abs(
            u.price -
            l.price
          ) <=
          currentAtr *
          0.10
      )
    ) {

      unique.push(l);
    }
  }


  return unique.slice(
    0,
    24
  );
}


/* ================================================================
   HISTORICAL RAID STATS
================================================================ */

function historicalRaidStats(
  hist,
  levels,
  currentAtr
) {

  const results =
    {};


  const majorTypes =
    [
      "PDH",
      "PDL",
      "PWH",
      "PWL",
      "ASIA_HIGH",
      "ASIA_LOW"
    ];


  for (
    const type
    of majorTypes
  ) {

    results[type] = {

      samples:
        0,

      reversals:
        0,

      continuations:
        0,

      reversalRate:
        null
    };
  }


  if (
    hist.length <
    100
  ) {

    return results;
  }


  const tolerance =
    Math.max(
      currentAtr *
      0.12,
      0.15
    );


  for (
    const l
    of levels.filter(
      x =>
        majorTypes.includes(
          x.type
        )
    )
  ) {

    const stat =
      results[
        l.type
      ];


    for (
      let i = 20;
      i <
      hist.length -
      8;
      i++
    ) {

      const c =
        hist[i];


      const prev =
        hist[
          i - 1
        ];


      let swept =
        false;


      let returned =
        false;


      if (
        l.side ===
        "BUY_SIDE"
      ) {

        swept =
          c.high >
            l.price +
            tolerance *
            0.1 &&
          prev.close <=
            l.price;


        returned =
          c.close <
          l.price;
      }

      else {

        swept =
          c.low <
            l.price -
            tolerance *
            0.1 &&
          prev.close >=
            l.price;


        returned =
          c.close >
          l.price;
      }


      if (
        !swept
      ) {

        continue;
      }


      stat.samples++;


      const future =
        hist.slice(
          i + 1,
          i + 7
        );


      if (
        !future.length
      ) {

        continue;
      }


      const maxUp =
        Math.max(
          ...future.map(
            x => x.high
          )
        ) -
        c.close;


      const maxDown =
        c.close -
        Math.min(
          ...future.map(
            x => x.low
          )
        );


      const reversed =
        l.side ===
        "BUY_SIDE"

          ? (
              maxDown >
              currentAtr *
              0.65
            )

          : (
              maxUp >
              currentAtr *
              0.65
            );


      if (
        returned &&
        reversed
      ) {

        stat.reversals++;
      }

      else {

        stat.continuations++;
      }
    }


    stat.reversalRate =
      stat.samples

        ? round(
            stat.reversals /
            stat.samples *
            100,
            1
          )

        : null;
  }


  return results;
}


/* ================================================================
   RAID SCORE
================================================================ */

function evaluateLevel(
  level,
  price,
  currentAtr,
  recent,
  delta,
  historical
) {

  const distance =
    Math.abs(
      price -
      level.price
    );


  const distanceAtr =
    currentAtr
      ? distance /
        currentAtr
      : 99;


  const last =
    recent.at(-1);


  const prev =
    recent.at(-2) ||
    last;


  const buffer =
    currentAtr *
    0.12;


  let swept =
    false;


  let rejected =
    false;


  if (
    level.side ===
    "BUY_SIDE"
  ) {

    swept =
      recent
      .slice(-4)
      .some(
        c =>
          c.high >
          level.price +
          buffer *
          0.1
      );


    rejected =
      swept &&
      last.close <
        level.price &&
      last.high >
        level.price;
  }

  else {

    swept =
      recent
      .slice(-4)
      .some(
        c =>
          c.low <
          level.price -
          buffer *
          0.1
      );


    rejected =
      swept &&
      last.close >
        level.price &&
      last.low <
        level.price;
  }


  const approaching =
    distanceAtr <=
    1.4;


  const touched =
    distanceAtr <=
    0.22 ||
    (
      last.low <=
        level.price &&
      last.high >=
        level.price
    );


  const momentumToward =
    level.side ===
    "BUY_SIDE"

      ? (
          last.close >=
          prev.close
        )

      : (
          last.close <=
          prev.close
        );


  const hist =
    historical[
      level.type
    ];


  const histBoost =
    hist?.reversalRate != null

      ? (
          hist.reversalRate -
          50
        ) *
        0.18

      : 0;


  const deltaConfirm =
    level.side ===
    "BUY_SIDE"

      ? (
          delta.divergence ===
          "BEARISH"
        )

      : (
          delta.divergence ===
          "BULLISH"
        );


  let raid =
    level.weight *
    0.42;


  raid +=
    clamp(
      32 -
      distanceAtr *
      13,
      0,
      32
    );


  if (
    approaching
  ) {

    raid +=
      7;
  }


  if (
    touched
  ) {

    raid +=
      9;
  }


  if (
    swept
  ) {

    raid +=
      10;
  }


  if (
    rejected
  ) {

    raid +=
      15;
  }


  if (
    momentumToward &&
    !rejected
  ) {

    raid +=
      4;
  }


  if (
    deltaConfirm
  ) {

    raid +=
      7;
  }


  raid +=
    histBoost;


  let stage =
    "DISTANT";


  if (
    approaching
  ) {

    stage =
      "TRACKING";
  }


  if (
    touched
  ) {

    stage =
      "AT_LIQUIDITY";
  }


  if (
    swept
  ) {

    stage =
      "RAIDED";
  }


  if (
    rejected
  ) {

    stage =
      "REJECTION";
  }


  return {

    ...level,

    price:
      round(
        level.price
      ),

    distance:
      round(
        distance,
        2
      ),

    distanceAtr:
      round(
        distanceAtr,
        2
      ),

    liquidityStrength:
      clamp(
        Math.round(
          level.weight
        ),
        0,
        100
      ),

    raidScore:
      clamp(
        Math.round(
          raid
        ),
        0,
        100
      ),

    stage,

    swept,

    rejected,

    zoneLow:
      round(
        level.price -
        currentAtr *
        0.20
      ),

    zoneHigh:
      round(
        level.price +
        currentAtr *
        0.20
      ),

    historicalReversalRate:
      hist?.reversalRate ??
      null,

    historicalSamples:
      hist?.samples ??
      0
  };
}


/* ================================================================
   FRED
================================================================ */

async function fredSeries(
  id,
  key,
  limit = 4
) {

  const q =
    new URLSearchParams({

      series_id:
        id,

      api_key:
        key,

      file_type:
        "json",

      sort_order:
        "desc",

      limit:
        String(limit)
    });


  const j =
    await fetchJson(
      `${FRED_BASE}?${q}`,
      9_000
    );


  return (
    j?.observations ||
    []
  )
  .map(
    x => ({

      date:
        x.date,

      value:
        safeNum(
          x.value
        )
    })
  )
  .filter(
    x =>
      Number.isFinite(
        x.value
      )
  );
}


/* ================================================================
   MACRO PRESSURE
================================================================ */

async function macroPressure() {

  const key =
    process.env.FRED_API_KEY;


  if (
    !key
  ) {

    return {

      enabled:
        false,

      usdScore:
        0,

      goldScore:
        0,

      bias:
        "NEUTRAL",

      drivers:
        []
    };
  }


  if (
    macroCache.data &&
    Date.now() -
    macroCache.at <
    MACRO_CACHE_MS
  ) {

    return macroCache.data;
  }


  const defs =
    [

      [
        "FEDFUNDS",
        "Fed Funds",
        1
      ],

      [
        "UNRATE",
        "Unemployment",
        -1
      ],

      [
        "CPIAUCSL",
        "CPI",
        1
      ],

      [
        "PCEPI",
        "PCE",
        1
      ],

      [
        "PAYEMS",
        "Payrolls",
        1
      ]
    ];


  const rows =
    await Promise.all(

      defs.map(

        async (
          [
            id,
            name,
            usdDir
          ]
        ) => {

          try {

            const s =
              await fredSeries(
                id,
                key,
                3
              );


            const latest =
              s[0]?.value;


            const prev =
              s[1]?.value;


            const change =
              Number.isFinite(
                latest
              ) &&
              Number.isFinite(
                prev
              )

                ? (
                    latest -
                    prev
                  )

                : 0;


            const sign =
              change === 0

                ? 0

                : (
                    Math.sign(
                      change
                    ) *
                    usdDir
                  );


            return {

              id,

              name,

              latest,

              previous:
                prev,

              change:
                round(
                  change,
                  3
                ),

              usdImpulse:
                sign *
                12
            };

          }
          catch {

            return {

              id,

              name,

              latest:
                null,

              previous:
                null,

              change:
                null,

              usdImpulse:
                0
            };
          }
        }
      )
    );


  const usdScore =
    clamp(

      Math.round(

        rows.reduce(
          (
            s,
            x
          ) =>
            s +
            x.usdImpulse,
          0
        )
      ),

      -100,
      100
    );


  const goldScore =
    -usdScore;


  const data = {

    enabled:
      true,

    usdScore,

    goldScore,

    bias:
      goldScore > 15

        ? "GOLD_BULLISH"

        : goldScore < -15

          ? "GOLD_BEARISH"

          : "NEUTRAL",

    drivers:
      rows
  };


  macroCache = {

    at:
      Date.now(),

    data
  };


  return data;
}


/* ================================================================
   INTERMARKET ENGINE
================================================================ */

async function intermarket(
  k4,
  fallbacks
) {

  const specs =
    [

      [
        "XAG/USD",
        "SILVER",
        1
      ],

      [
        "EUR/USD",
        "EURUSD",
        0.65
      ],

      [
        "USD/JPY",
        "USDJPY",
        -0.55
      ],

      [
        "BTC/USD",
        "BTCUSD",
        0.25
      ]
    ];


  const rows =
    await Promise.all(

      specs.map(

        async (
          [
            symbol,
            name,
            weight
          ]
        ) => {

          try {

            const c =
              await fetchTD(
                symbol,
                "15min",
                64,
                k4,
                fallbacks
              );


            const now =
              c.at(-1).close;


            const prev =
              c[
                Math.max(
                  0,
                  c.length -
                  13
                )
              ].close;


            const changePct =
              pct(
                now,
                prev
              );


            return {

              symbol,

              name,

              changePct:
                round(
                  changePct,
                  3
                ),

              contribution:
                clamp(
                  changePct *
                  18 *
                  weight,
                  -22,
                  22
                )
            };

          }
          catch (e) {

            return {

              symbol,

              name,

              changePct:
                null,

              contribution:
                0,

              error:
                e.message
            };
          }
        }
      )
    );


  const goldScore =
    clamp(

      Math.round(

        rows.reduce(
          (
            s,
            x
          ) =>
            s +
            x.contribution,
          0
        )
      ),

      -100,
      100
    );


  return {

    goldScore,

    bias:
      goldScore > 12

        ? "BULLISH"

        : goldScore < -12

          ? "BEARISH"

          : "NEUTRAL",

    markets:
      rows
  };
}


/* ================================================================
   TRADE IDEA
================================================================ */

function buildTradeIdea({

  price,

  a,

  evaluated,

  frames,

  structure,

  delta,

  macro,

  inter

}) {

  const buyTarget =
    evaluated

    .filter(
      x =>
        x.side ===
          "BUY_SIDE" &&
        x.price >
          price
    )

    .sort(
      (
        x,
        y
      ) =>
        x.distance -
        y.distance
    )[0];


  const sellTarget =
    evaluated

    .filter(
      x =>
        x.side ===
          "SELL_SIDE" &&
        x.price <
          price
    )

    .sort(
      (
        x,
        y
      ) =>
        x.distance -
        y.distance
    )[0];


  const sellRaid =
    evaluated

    .filter(
      x =>
        x.side ===
          "BUY_SIDE" &&
        x.rejected
    )

    .sort(
      (
        x,
        y
      ) =>
        y.raidScore -
        x.raidScore
    )[0];


  const buyRaid =
    evaluated

    .filter(
      x =>
        x.side ===
          "SELL_SIDE" &&
        x.rejected
    )

    .sort(
      (
        x,
        y
      ) =>
        y.raidScore -
        x.raidScore
    )[0];


  let buy =
    0;


  let sell =
    0;


  const reasonsBuy =
    [];


  const reasonsSell =
    [];


  const add = (
    side,
    pts,
    reason
  ) => {

    if (
      side ===
      "BUY"
    ) {

      buy +=
        pts;

      reasonsBuy.push(
        reason
      );
    }

    else {

      sell +=
        pts;

      reasonsSell.push(
        reason
      );
    }
  };


  if (
    frames.h1.bias ===
    "BULLISH"
  ) {

    add(
      "BUY",
      12,
      "H1 trend bullish"
    );
  }


  if (
    frames.h1.bias ===
    "BEARISH"
  ) {

    add(
      "SELL",
      12,
      "H1 trend bearish"
    );
  }


  if (
    frames.h4.bias ===
    "BULLISH"
  ) {

    add(
      "BUY",
      11,
      "H4 macro structure bullish"
    );
  }


  if (
    frames.h4.bias ===
    "BEARISH"
  ) {

    add(
      "SELL",
      11,
      "H4 macro structure bearish"
    );
  }


  if (
    frames.m15.bias ===
    "BULLISH"
  ) {

    add(
      "BUY",
      8,
      "M15 momentum bullish"
    );
  }


  if (
    frames.m15.bias ===
    "BEARISH"
  ) {

    add(
      "SELL",
      8,
      "M15 momentum bearish"
    );
  }


  if (
    structure.state ===
      "BULLISH" ||
    structure.choch ===
      "BULLISH_CHOCH"
  ) {

    add(
      "BUY",
      12,
      "Structure supports upside"
    );
  }


  if (
    structure.state ===
      "BEARISH" ||
    structure.choch ===
      "BEARISH_CHOCH"
  ) {

    add(
      "SELL",
      12,
      "Structure supports downside"
    );
  }


  if (
    buyRaid
  ) {

    add(

      "BUY",

      clamp(
        buyRaid.raidScore *
        0.34,
        10,
        30
      ),

      `${buyRaid.name} sell-side raid rejected`
    );
  }


  if (
    sellRaid
  ) {

    add(

      "SELL",

      clamp(
        sellRaid.raidScore *
        0.34,
        10,
        30
      ),

      `${sellRaid.name} buy-side raid rejected`
    );
  }


  if (
    delta.divergence ===
    "BULLISH"
  ) {

    add(
      "BUY",
      8,
      "Bullish delta divergence"
    );
  }


  if (
    delta.divergence ===
    "BEARISH"
  ) {

    add(
      "SELL",
      8,
      "Bearish delta divergence"
    );
  }


  if (
    macro.goldScore >
    12
  ) {

    add(

      "BUY",

      clamp(
        Math.abs(
          macro.goldScore
        ) *
        0.16,
        3,
        12
      ),

      "Macro pressure supports gold"
    );
  }


  if (
    macro.goldScore <
    -12
  ) {

    add(

      "SELL",

      clamp(
        Math.abs(
          macro.goldScore
        ) *
        0.16,
        3,
        12
      ),

      "Macro pressure weighs on gold"
    );
  }


  if (
    inter.goldScore >
    10
  ) {

    add(

      "BUY",

      clamp(
        Math.abs(
          inter.goldScore
        ) *
        0.18,
        3,
        10
      ),

      "Intermarket confirmation bullish"
    );
  }


  if (
    inter.goldScore <
    -10
  ) {

    add(

      "SELL",

      clamp(
        Math.abs(
          inter.goldScore
        ) *
        0.18,
        3,
        10
      ),

      "Intermarket confirmation bearish"
    );
  }


  buy =
    clamp(
      Math.round(
        buy
      ),
      0,
      100
    );


  sell =
    clamp(
      Math.round(
        sell
      ),
      0,
      100
    );


  const gap =
    Math.abs(
      buy -
      sell
    );


  let signal =
    "WAIT";


  if (
    Math.max(
      buy,
      sell
    ) >=
      55 &&
    gap >=
      10
  ) {

    signal =
      buy > sell
        ? "BUY"
        : "SELL";
  }


  if (
    Math.max(
      buy,
      sell
    ) >=
      72 &&
    gap >=
      15
  ) {

    signal =
      buy > sell
        ? "STRONG_BUY"
        : "STRONG_SELL";
  }


  const dir =
    buy > sell
      ? 1
      : -1;


  const side =
    dir === 1
      ? "BUY"
      : "SELL";


  const entry =
    price;


  const stop =
    dir === 1

      ? (
          price -
          a *
          1.15
        )

      : (
          price +
          a *
          1.15
        );


  const risk =
    Math.abs(
      entry -
      stop
    );


  const tp1Default =
    dir === 1

      ? (
          entry +
          risk *
          1.5
        )

      : (
          entry -
          risk *
          1.5
        );


  const tp2Default =
    dir === 1

      ? (
          entry +
          risk *
          2.5
        )

      : (
          entry -
          risk *
          2.5
        );


  const targetLiquidity =
    dir === 1
      ? buyTarget
      : sellTarget;


  const tp1 =
    targetLiquidity &&
    Math.abs(
      targetLiquidity.price -
      entry
    ) >
    risk *
    0.65

      ? targetLiquidity.price

      : tp1Default;


  return {

    signal,

    preferredSide:
      side,

    buyScore:
      buy,

    sellScore:
      sell,

    agreement:
      round(
        (
          Math.max(
            buy,
            sell
          ) /
          Math.max(
            1,
            buy +
            sell
          )
        ) *
        100,
        1
      ),

    entry:
      round(
        entry
      ),

    stopLoss:
      round(
        stop
      ),

    tp1:
      round(
        tp1
      ),

    tp2:
      round(
        tp2Default
      ),

    riskDistance:
      round(
        risk
      ),

    riskRewardTP2:
      2.5,

    targetLiquidity:
      targetLiquidity
        ? {

            name:
              targetLiquidity.name,

            price:
              targetLiquidity.price,

            raidScore:
              targetLiquidity.raidScore
          }

        : null,

    reasons:
      (
        side === "BUY"
          ? reasonsBuy
          : reasonsSell
      )
      .slice(
        0,
        6
      ),

    warning:
      signal === "WAIT"

        ? "Confluence is not strong enough for a directional trade idea."

        : "Heuristic setup only. Confirm execution conditions before trading."
  };
}


/* ================================================================
   SCENARIO ENGINE
================================================================ */

function buildScenarios(
  price,
  evaluated,
  trade
) {

  const above =
    evaluated

    .filter(
      x =>
        x.price >
        price
    )

    .sort(
      (
        a,
        b
      ) =>
        a.distance -
        b.distance
    )

    .slice(
      0,
      3
    );


  const below =
    evaluated

    .filter(
      x =>
        x.price <
        price
    )

    .sort(
      (
        a,
        b
      ) =>
        a.distance -
        b.distance
    )

    .slice(
      0,
      3
    );


  return [

    {

      name:
        "UPSIDE LIQUIDITY PATH",

      probabilityScore:
        clamp(

          Math.round(

            50 +
            (
              trade.buyScore -
              trade.sellScore
            ) *
            0.45
          ),

          5,
          95
        ),

      path:
        above.map(
          x => ({

            name:
              x.name,

            price:
              x.price,

            raidScore:
              x.raidScore
          })
        )
    },


    {

      name:
        "DOWNSIDE LIQUIDITY PATH",

      probabilityScore:
        clamp(

          Math.round(

            50 +
            (
              trade.sellScore -
              trade.buyScore
            ) *
            0.45
          ),

          5,
          95
        ),

      path:
        below.map(
          x => ({

            name:
              x.name,

            price:
              x.price,

            raidScore:
              x.raidScore
          })
        )
    }
  ];
}


/* ================================================================
   MAIN ENGINE
================================================================ */

async function runEngine() {

  const {
    k1,
    k2,
    k3,
    k4
  } =
    keyPool();


  if (
    !k1
  ) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables"
    );
  }


  const [

    m1,

    m5,

    m15,

    h1,

    h4,

    hist,

    macro,

    inter

  ] =
    await Promise.all([


      /* API 1 */

      fetchTD(
        SYMBOL,
        "1min",
        360,
        k1,
        [
          k2,
          k3,
          k4
        ]
      ),


      fetchTD(
        SYMBOL,
        "5min",
        520,
        k1,
        [
          k2,
          k3,
          k4
        ]
      ),


      /* API 2 */

      fetchTD(
        SYMBOL,
        "15min",
        360,
        k2,
        [
          k1,
          k3,
          k4
        ]
      ),


      fetchTD(
        SYMBOL,
        "1h",
        420,
        k2,
        [
          k1,
          k3,
          k4
        ]
      ),


      fetchTD(
        SYMBOL,
        "4h",
        260,
        k2,
        [
          k1,
          k3,
          k4
        ]
      ),


      /* API 3 */

      fetchTD(
        SYMBOL,
        "5min",
        3000,
        k3,
        [
          k2,
          k1,
          k4
        ]
      ),


      /* MACRO */

      macroPressure()

      .catch(
        () => ({

          enabled:
            false,

          usdScore:
            0,

          goldScore:
            0,

          bias:
            "NEUTRAL",

          drivers:
            []
        })
      ),


      /* API 4 */

      intermarket(
        k4 ||
        k1,
        [
          k3,
          k2,
          k1
        ]
      )

      .catch(
        () => ({

          goldScore:
            0,

          bias:
            "NEUTRAL",

          markets:
            []
        })
      )

    ]);


  const price =
    m1.at(-1).close;


  const a5 =
    atr(m5) ||
    Math.max(
      price *
      0.0008,
      0.5
    );


  const sessions =
    sessionLevels(
      m5
    );


  const day =
    previousDayLevels(
      hist
    );


  const week =
    previousWeekLevels(
      hist
    );


  const fvg =
    fvgZones(
      m15,
      12
    );


  const mp =
    pivots(
      m5,
      5
    );


  const structure =
    structureState(
      m5,
      mp
    );


  const delta =
    deltaProxy(
      m1,
      60
    );


  const rawLevels =
    buildLiquidityLevels({

      m5,

      h1,

      hist,

      sessions,

      day,

      week,

      fvg
    });


  const historical =
    historicalRaidStats(

      hist,

      rawLevels,

      a5
    );


  const evaluated =
    rawLevels

    .map(
      l =>
        evaluateLevel(

          l,

          price,

          a5,

          m1.slice(-20),

          delta,

          historical
        )
    )

    .sort(
      (
        a,
        b
      ) =>
        b.raidScore -
        a.raidScore
    );


  const frames =
    {

      m1:
        trendFrame(
          m1
        ),

      m5:
        trendFrame(
          m5
        ),

      m15:
        trendFrame(
          m15
        ),

      h1:
        trendFrame(
          h1
        ),

      h4:
        trendFrame(
          h4
        )
    };


  const trade =
    buildTradeIdea({

      price,

      a:
        a5,

      evaluated,

      frames,

      structure,

      delta,

      macro,

      inter
    });


  const dominant =
    evaluated[0] ||
    null;


  const nearestAbove =
    evaluated

    .filter(
      x =>
        x.price >
        price
    )

    .sort(
      (
        a,
        b
      ) =>
        a.distance -
        b.distance
    )[0] ||
    null;


  const nearestBelow =
    evaluated

    .filter(
      x =>
        x.price <
        price
    )

    .sort(
      (
        a,
        b
      ) =>
        a.distance -
        b.distance
    )[0] ||
    null;


  return {

    ok:
      true,

    engine:
      "MKAYFX GOLD INTELLIGENCE V9",

    mode:
      "LIQUIDITY WARFARE / REST",

    symbol:
      "XAU/USD",

    generatedAt:
      new Date()
      .toISOString(),

    price:
      round(
        price
      ),

    quoteTime:
      new Date(
        m1.at(-1).time *
        1000
      )
      .toISOString(),

    staleSeconds:
      Math.max(
        0,
        Math.round(
          Date.now() /
          1000 -
          m1.at(-1).time
        )
      ),


    volatility:
      {

        atrM5:
          round(
            a5,
            3
          ),

        atrM15:
          round(
            atr(m15),
            3
          ),

        atrH1:
          round(
            atr(h1),
            3
          ),

        vwapM5:
          round(
            vwap(m5)
          ),

        vwapM1:
          round(
            vwap(m1)
          )
      },


    frames,


    structure,


    sessions:
      Object.fromEntries(

        Object.entries(
          sessions
        )

        .map(
          (
            [
              k,
              v
            ]
          ) => [

            k,

            v

              ? {

                  ...v,

                  high:
                    round(
                      v.high
                    ),

                  low:
                    round(
                      v.low
                    ),

                  open:
                    round(
                      v.open
                    ),

                  close:
                    round(
                      v.close
                    )
                }

              : null
          ]
        )
      ),


    externalLiquidity:
      {

        pdh:
          round(
            day.pdh
          ),

        pdl:
          round(
            day.pdl
          ),

        pwh:
          round(
            week.pwh
          ),

        pwl:
          round(
            week.pwl
          )
      },


    orderFlow:
      delta,


    macro,


    intermarket:
      inter,


    dominantLiquidity:
      dominant,


    nearestLiquidity:
      {

        above:
          nearestAbove,

        below:
          nearestBelow
      },


    liquidity:
      evaluated,


    fvg:
      fvg.map(
        z => ({

          ...z,

          low:
            round(
              z.low
            ),

          high:
            round(
              z.high
            )
        })
      ),


    historicalRaidStats:
      historical,


    tradeIdea:
      trade,


    scenarios:
      buildScenarios(
        price,
        evaluated,
        trade
      ),


    chart:
      m5
      .slice(-300)
      .map(
        c => ({

          time:
            c.time,

          open:
            c.open,

          high:
            c.high,

          low:
            c.low,

          close:
            c.close
        })
      ),


    disclaimer:
      "Liquidity, raid, confluence and scenario scores are heuristic model outputs, not guaranteed probabilities or financial advice."
  };
}


/* ================================================================
   VERCEL HANDLER
================================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();
  }


  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({

        ok:
          false,

        error:
          "GET only"
      });
  }


  try {

    const force =
      String(
        req.query?.force ||
        ""
      ) ===
      "1";


    if (
      !force &&
      engineCache.data &&
      Date.now() -
      engineCache.at <
      CACHE_MS
    ) {

      return res
      .status(200)
      .json({

        ...engineCache.data,

        cache:
          {

            hit:
              true,

            ageSeconds:
              Math.round(
                (
                  Date.now() -
                  engineCache.at
                ) /
                1000
              )
          }
      });
    }


    const data =
      await runEngine();


    engineCache =
      {

        at:
          Date.now(),

        data
      };


    return res
    .status(200)
    .json({

      ...data,

      cache:
        {

          hit:
            false,

          ageSeconds:
            0
        }
    });

  }
  catch (e) {

    console.error(
      "MKAYFX V9 error",
      e
    );


    return res
    .status(500)
    .json({

      ok:
        false,

      engine:
        "MKAYFX GOLD INTELLIGENCE V9",

      error:
        e?.message ||
        "Engine failure",

      hint:
        "Check TWELVE_DATA_API_KEY, TWELVE_DATA_API_KEY_2, TWELVE_DATA_API_KEY_3 and TWELVE_DATA_API_KEY_4 in Vercel. FRED_API_KEY is optional."
    });
  }
}