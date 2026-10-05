/* ============================================================
   MKAYFX XAUUSD LIQUIDITY INTELLIGENCE
   /api/xau.js

   PROVIDER
   --------
   Massive / Polygon

   SYMBOL
   ------
   C:XAUUSD

   ENVIRONMENT VARIABLE
   --------------------
   MASSIVE_API_KEY

   FEATURES
   --------
   - XAU/USD price
   - M1 base data
   - M5 / M15 / H1 resampling
   - Asia high / low
   - London high / low
   - NY high / low
   - Previous day high / low
   - Intraday VWAP approximation
   - ATR
   - RSI
   - EMA structure
   - Liquidity pools
   - Equal highs / lows
   - Sweep projection
   - Raid scoring
   - Overshoot estimation
   - Reversal watch zone
   - Delta / footprint proxy

   NOTE
   ----
   Massive forex aggregates are quote-derived, not centralized
   exchange trade prints. Volume/delta calculations are proxies.
============================================================ */


/* ============================================================
   CONFIG
============================================================ */

const SYMBOL = "C:XAUUSD";

const API_BASE =
  "https://api.massive.com";

const API_KEY =
  process.env.MASSIVE_API_KEY;

const CACHE_MS =
  15_000;

let cache = {
  time: 0,
  data: null
};


/* ============================================================
   HELPERS
============================================================ */

function num(value, fallback = 0) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function round(value, decimals = 2) {

  if (!Number.isFinite(value)) {
    return null;
  }

  const p =
    Math.pow(10, decimals);

  return (
    Math.round(value * p) / p
  );
}


function avg(values) {

  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (a, b) => a + b,
      0
    ) / values.length
  );
}


function sum(values) {

  return values.reduce(
    (a, b) => a + b,
    0
  );
}


function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


/* ============================================================
   DATE HELPERS
============================================================ */

function isoDate(date) {

  return date
    .toISOString()
    .slice(0, 10);
}


function saParts(
  date = new Date()
) {

  const formatter =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:
          "Africa/Johannesburg",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit",

        hour12:
          false
      }
    );


  const parts =
    formatter
      .formatToParts(date);


  const map = {};


  for (
    const part of parts
  ) {

    if (
      part.type !==
      "literal"
    ) {

      map[
        part.type
      ] =
        part.value;
    }
  }


  return {

    year:
      Number(map.year),

    month:
      Number(map.month),

    day:
      Number(map.day),

    hour:
      Number(map.hour),

    minute:
      Number(map.minute),

    second:
      Number(map.second)
  };
}


function dayKey(
  timestamp
) {

  const date =
    new Date(timestamp);


  const p =
    saParts(date);


  return (
    `${p.year}-` +
    `${String(p.month).padStart(2, "0")}-` +
    `${String(p.day).padStart(2, "0")}`
  );
}


function minuteOfDay(
  timestamp
) {

  const p =
    saParts(
      new Date(timestamp)
    );


  return (
    p.hour * 60 +
    p.minute
  );
}


/* ============================================================
   FETCH XAUUSD DATA
============================================================ */

async function fetchXAU() {

  if (!API_KEY) {

    throw new Error(
      "Missing MASSIVE_API_KEY environment variable."
    );
  }


  const now =
    new Date();


  /*
    Pull multiple calendar days so we have enough
    M1 data for PDH/PDL and session calculations.
  */

  const fromDate =
    new Date(
      now.getTime() -
      4 * 24 * 60 * 60 * 1000
    );


  const from =
    isoDate(fromDate);

  const to =
    isoDate(now);


  const url =
    `${API_BASE}` +
    `/v2/aggs/ticker/` +
    `${encodeURIComponent(SYMBOL)}` +
    `/range/1/minute/` +
    `${from}/${to}` +
    `?adjusted=true` +
    `&sort=asc` +
    `&limit=50000` +
    `&apiKey=${encodeURIComponent(API_KEY)}`;


  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Accept:
            "application/json"
        },

        cache:
          "no-store"
      }
    );


  const text =
    await response.text();


  let payload;


  try {

    payload =
      JSON.parse(text);

  } catch {

    throw new Error(
      `Massive returned invalid JSON: ${text.slice(0, 200)}`
    );
  }


  if (!response.ok) {

    throw new Error(
      payload?.error ||
      payload?.message ||
      `Massive HTTP ${response.status}`
    );
  }


  if (
    payload?.status &&
    payload.status !== "OK" &&
    payload.status !== "DELAYED"
  ) {

    throw new Error(
      payload?.error ||
      payload?.message ||
      `Massive status: ${payload.status}`
    );
  }


  const results =
    payload?.results;


  if (
    !Array.isArray(results) ||
    !results.length
  ) {

    throw new Error(
      "Massive returned no XAUUSD candles. Your plan may not include forex minute aggregates."
    );
  }


  const candles =
    results
      .map(item => ({

        timestamp:
          num(item.t),

        time:
          new Date(
            num(item.t)
          ).toISOString(),

        open:
          num(item.o),

        high:
          num(item.h),

        low:
          num(item.l),

        close:
          num(item.c),

        volume:
          num(item.v),

        vwap:
          num(item.vw),

        quotes:
          num(item.n)
      }))
      .filter(c =>
        c.timestamp &&
        c.open &&
        c.high &&
        c.low &&
        c.close
      );


  return candles;
}


/* ============================================================
   RESAMPLE
============================================================ */

function resample(
  candles,
  minutes
) {

  const bucketMs =
    minutes *
    60 *
    1000;


  const groups =
    new Map();


  for (
    const candle of candles
  ) {

    const bucket =
      Math.floor(
        candle.timestamp /
        bucketMs
      ) *
      bucketMs;


    if (
      !groups.has(bucket)
    ) {

      groups.set(
        bucket,
        {

          timestamp:
            bucket,

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close,

          volume:
            candle.volume,

          quotes:
            candle.quotes
        }
      );

    } else {

      const bar =
        groups.get(bucket);


      bar.high =
        Math.max(
          bar.high,
          candle.high
        );


      bar.low =
        Math.min(
          bar.low,
          candle.low
        );


      bar.close =
        candle.close;


      bar.volume +=
        candle.volume;


      bar.quotes +=
        candle.quotes;
    }
  }


  return Array
    .from(
      groups.values()
    )
    .sort(
      (a, b) =>
        a.timestamp -
        b.timestamp
    );
}


/* ============================================================
   ATR
============================================================ */

function atr(
  candles,
  period = 14
) {

  if (
    candles.length <
    period + 1
  ) {

    return 0;
  }


  const values =
    [];


  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const current =
      candles[i];

    const previous =
      candles[i - 1];


    const tr =
      Math.max(

        current.high -
        current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )
      );


    values.push(tr);
  }


  return avg(
    values.slice(
      -period
    )
  );
}


/* ============================================================
   EMA
============================================================ */

function ema(
  values,
  period
) {

  if (!values.length) {
    return 0;
  }


  const k =
    2 /
    (period + 1);


  let value =
    values[0];


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    value =
      values[i] * k +
      value * (1 - k);
  }


  return value;
}


/* ============================================================
   RSI
============================================================ */

function rsi(
  candles,
  period = 14
) {

  if (
    candles.length <=
    period
  ) {

    return 50;
  }


  let gains = 0;
  let losses = 0;


  for (
    let i =
      candles.length -
      period;

    i <
      candles.length;

    i++
  ) {

    if (i <= 0) {
      continue;
    }


    const change =
      candles[i].close -
      candles[i - 1].close;


    if (
      change > 0
    ) {

      gains +=
        change;

    } else {

      losses +=
        Math.abs(change);
    }
  }


  if (
    losses === 0
  ) {

    return 100;
  }


  const rs =
    gains /
    losses;


  return (
    100 -
    100 /
    (1 + rs)
  );
}


/* ============================================================
   VWAP
============================================================ */

function vwap(
  candles
) {

  let pv = 0;
  let weight = 0;


  for (
    const c of candles
  ) {

    const typical =
      (
        c.high +
        c.low +
        c.close
      ) / 3;


    /*
      Forex aggregates are quote-derived.

      n = number of quote/events where available.
      v can also be used when supplied.
    */

    const w =
      c.quotes > 0
        ? c.quotes
        : (
            c.volume > 0
              ? c.volume
              : 1
          );


    pv +=
      typical *
      w;


    weight +=
      w;
  }


  return (
    weight > 0
      ? pv / weight
      : 0
  );
}


/* ============================================================
   RANGE
============================================================ */

function rangeOf(
  candles
) {

  if (!candles.length) {

    return {
      high: null,
      low: null,
      open: null,
      close: null
    };
  }


  return {

    high:
      Math.max(
        ...candles.map(
          c => c.high
        )
      ),

    low:
      Math.min(
        ...candles.map(
          c => c.low
        )
      ),

    open:
      candles[0].open,

    close:
      candles[
        candles.length - 1
      ].close
  };
}


/* ============================================================
   SESSION FILTER
============================================================ */

function filterSession(
  candles,
  startMinute,
  endMinute
) {

  return candles.filter(
    candle => {

      const minute =
        minuteOfDay(
          candle.timestamp
        );


      if (
        startMinute <
        endMinute
      ) {

        return (
          minute >= startMinute &&
          minute < endMinute
        );
      }


      return (
        minute >= startMinute ||
        minute < endMinute
      );
    }
  );
}


/* ============================================================
   GROUP DAYS
============================================================ */

function groupDays(
  candles
) {

  const map =
    new Map();


  for (
    const candle of candles
  ) {

    const key =
      dayKey(
        candle.timestamp
      );


    if (
      !map.has(key)
    ) {

      map.set(
        key,
        []
      );
    }


    map
      .get(key)
      .push(candle);
  }


  return map;
}


/* ============================================================
   SWINGS
============================================================ */

function detectSwings(
  candles,
  left = 3,
  right = 3
) {

  const highs = [];
  const lows = [];


  for (
    let i = left;
    i <
      candles.length -
      right;
    i++
  ) {

    const current =
      candles[i];


    let high =
      true;

    let low =
      true;


    for (
      let j =
        i - left;

      j <=
        i + right;

      j++
    ) {

      if (
        j === i
      ) {
        continue;
      }


      if (
        candles[j].high >=
        current.high
      ) {

        high =
          false;
      }


      if (
        candles[j].low <=
        current.low
      ) {

        low =
          false;
      }
    }


    if (high) {

      highs.push({

        price:
          current.high,

        timestamp:
          current.timestamp
      });
    }


    if (low) {

      lows.push({

        price:
          current.low,

        timestamp:
          current.timestamp
      });
    }
  }


  return {
    highs,
    lows
  };
}


/* ============================================================
   EQUAL LEVELS
============================================================ */

function equalLevels(
  swings,
  tolerance
) {

  const levels = [];


  function scan(
    list,
    type
  ) {

    for (
      let i = 0;
      i < list.length;
      i++
    ) {

      for (
        let j =
          i + 1;
        j < list.length;
        j++
      ) {

        const difference =
          Math.abs(
            list[i].price -
            list[j].price
          );


        if (
          difference <=
          tolerance
        ) {

          levels.push({

            type,

            price:
              (
                list[i].price +
                list[j].price
              ) / 2
          });


          break;
        }
      }
    }
  }


  scan(
    swings.highs.slice(-20),
    "EQUAL_HIGHS"
  );


  scan(
    swings.lows.slice(-20),
    "EQUAL_LOWS"
  );


  return levels;
}


/* ============================================================
   FOOTPRINT / DELTA PROXY
============================================================ */

function deltaProxy(
  candle
) {

  const range =
    Math.max(
      candle.high -
      candle.low,
      0.00001
    );


  const body =
    candle.close -
    candle.open;


  const closeLocation =
    (
      candle.close -
      candle.low
    ) /
    range;


  const directional =
    body /
    range;


  const pressure =
    clamp(
      directional * 0.7 +
      (
        closeLocation -
        0.5
      ) * 0.6,
      -1,
      1
    );


  const activity =
    candle.quotes > 0
      ? candle.quotes
      : (
          candle.volume > 0
            ? candle.volume
            : 1
        );


  return (
    activity *
    pressure
  );
}


function footprint(
  candles
) {

  const recent =
    candles.slice(-60);


  let cvd = 0;


  const bars =
    recent.map(
      candle => {

        const delta =
          deltaProxy(
            candle
          );


        cvd +=
          delta;


        return {

          timestamp:
            candle.timestamp,

          delta:
            round(
              delta,
              2
            ),

          cvd:
            round(
              cvd,
              2
            )
        };
      }
    );


  const last20 =
    bars.slice(-20);


  const totalDelta =
    sum(
      last20.map(
        b =>
          b.delta
      )
    );


  const bias =
    totalDelta > 0
      ? "BUYING_PRESSURE"
      : totalDelta < 0
        ? "SELLING_PRESSURE"
        : "BALANCED";


  return {

    delta:
      round(
        totalDelta,
        2
      ),

    cvd:
      round(
        cvd,
        2
      ),

    bias,

    latestBars:
      bars.slice(-10)
  };
}


/* ============================================================
   STRUCTURE
============================================================ */

function structure(
  m5,
  m15,
  h1
) {

  const price =
    m5[
      m5.length - 1
    ].close;


  const emaM5 =
    ema(
      m5.map(
        c => c.close
      ),
      20
    );


  const emaM15 =
    ema(
      m15.map(
        c => c.close
      ),
      20
    );


  const emaH1 =
    ema(
      h1.map(
        c => c.close
      ),
      20
    );


  let bias =
    "NEUTRAL";


  if (
    price > emaM5 &&
    price > emaM15 &&
    price > emaH1
  ) {

    bias =
      "BULLISH";
  }


  if (
    price < emaM5 &&
    price < emaM15 &&
    price < emaH1
  ) {

    bias =
      "BEARISH";
  }


  return {

    bias,

    m5:
      price > emaM5
        ? "BULLISH"
        : "BEARISH",

    m15:
      price > emaM15
        ? "BULLISH"
        : "BEARISH",

    h1:
      price > emaH1
        ? "BULLISH"
        : "BEARISH",

    emaM5:
      round(
        emaM5
      ),

    emaM15:
      round(
        emaM15
      ),

    emaH1:
      round(
        emaH1
      )
  };
}


/* ============================================================
   REGIME
============================================================ */

function regime(
  m5,
  atrM5
) {

  const closes =
    m5.map(
      c => c.close
    );


  const fast =
    ema(
      closes,
      20
    );


  const slow =
    ema(
      closes,
      50
    );


  const separation =
    Math.abs(
      fast -
      slow
    );


  if (
    separation >
    atrM5 *
    0.7
  ) {

    return (
      fast > slow
        ? "TRENDING_BULLISH"
        : "TRENDING_BEARISH"
    );
  }


  if (
    separation <
    atrM5 *
    0.25
  ) {

    return "COMPRESSION";
  }


  return "RANGING";
}


/* ============================================================
   LIQUIDITY LEVEL
============================================================ */

function level(
  label,
  type,
  side,
  price,
  strength
) {

  return {

    label,
    type,
    side,
    price,
    strength
  };
}


/* ============================================================
   SCORE LIQUIDITY
============================================================ */

function scorePool(
  pool,
  price,
  atrM5,
  fp,
  struct
) {

  const distance =
    Math.abs(
      price -
      pool.price
    );


  const distanceATR =
    atrM5 > 0
      ? distance /
        atrM5
      : 100;


  let score =
    pool.strength;


  if (
    distanceATR <=
    0.5
  ) {

    score +=
      22;

  } else if (
    distanceATR <=
    1
  ) {

    score +=
      15;

  } else if (
    distanceATR <=
    2
  ) {

    score +=
      9;
  }


  if (
    pool.side ===
      "BUY_SIDE" &&
    fp.bias ===
      "BUYING_PRESSURE"
  ) {

    score +=
      7;
  }


  if (
    pool.side ===
      "SELL_SIDE" &&
    fp.bias ===
      "SELLING_PRESSURE"
  ) {

    score +=
      7;
  }


  if (
    pool.side ===
      "BUY_SIDE" &&
    struct.bias ===
      "BULLISH"
  ) {

    score +=
      6;
  }


  if (
    pool.side ===
      "SELL_SIDE" &&
    struct.bias ===
      "BEARISH"
  ) {

    score +=
      6;
  }


  score =
    clamp(
      score,
      0,
      95
    );


  return {

    score:
      round(
        score,
        1
      ),

    distance:
      round(
        distance
      ),

    distanceATR:
      round(
        distanceATR,
        2
      )
  };
}


/* ============================================================
   SWEEP PROJECTION
============================================================ */

function projectSweep(
  pool,
  atrM5,
  score
) {

  let mult =
    0.12;


  if (
    score >= 80
  ) {

    mult =
      0.28;

  } else if (
    score >= 70
  ) {

    mult =
      0.20;

  } else if (
    score >= 60
  ) {

    mult =
      0.15;
  }


  const overshoot =
    Math.max(
      atrM5 *
      mult,
      0.5
    );


  if (
    pool.side ===
    "BUY_SIDE"
  ) {

    return {

      sweepZone: {

        low:
          round(
            pool.price
          ),

        high:
          round(
            pool.price +
            overshoot
          )
      },

      likelyRaidEnd:
        round(
          pool.price +
          overshoot
        ),

      reversalWatchZone: {

        low:
          round(
            pool.price +
            overshoot *
            0.35
          ),

        high:
          round(
            pool.price +
            overshoot *
            1.25
          )
      },

      overshoot:
        round(
          overshoot
        )
    };
  }


  return {

    sweepZone: {

      low:
        round(
          pool.price -
          overshoot
        ),

      high:
        round(
          pool.price
        )
    },

    likelyRaidEnd:
      round(
        pool.price -
        overshoot
      ),

    reversalWatchZone: {

      low:
        round(
          pool.price -
          overshoot *
          1.25
        ),

      high:
        round(
          pool.price -
          overshoot *
          0.35
        )
    },

    overshoot:
      round(
        overshoot
      )
  };
}


/* ============================================================
   MAIN ANALYSIS
============================================================ */

function analyse(
  candles
) {

  const latest =
    candles[
      candles.length - 1
    ];


  const price =
    latest.close;


  const m5 =
    resample(
      candles,
      5
    );


  const m15 =
    resample(
      candles,
      15
    );


  const h1 =
    resample(
      candles,
      60
    );


  const atrM5 =
    atr(
      m5,
      14
    );


  const atrM15 =
    atr(
      m15,
      14
    );


  const rsiM5 =
    rsi(
      m5,
      14
    );


  const struct =
    structure(
      m5,
      m15,
      h1
    );


  const marketRegime =
    regime(
      m5,
      atrM5
    );


  const fp =
    footprint(
      candles
    );


  const groups =
    groupDays(
      candles
    );


  const keys =
    Array.from(
      groups.keys()
    );


  const todayKey =
    dayKey(
      latest.timestamp
    );


  const today =
    groups.get(
      todayKey
    ) || [];


  const previousKeys =
    keys.filter(
      key =>
        key !==
        todayKey
    );


  const previousKey =
    previousKeys[
      previousKeys.length - 1
    ];


  const previous =
    previousKey
      ? groups.get(
          previousKey
        )
      : [];


  const previousRange =
    rangeOf(
      previous
    );


  /*
    SAST session approximations.

    Asia:
    01:00 - 09:00

    London:
    09:00 - 17:00

    New York:
    14:00 - 23:00

    Exact UTC alignment changes with DST,
    so these are operational dashboard windows.
  */

  const asia =
    filterSession(
      today,
      60,
      9 * 60
    );


  const london =
    filterSession(
      today,
      9 * 60,
      17 * 60
    );


  const ny =
    filterSession(
      today,
      14 * 60,
      23 * 60
    );


  const asiaRange =
    rangeOf(
      asia
    );


  const londonRange =
    rangeOf(
      london
    );


  const nyRange =
    rangeOf(
      ny
    );


  const sessionVWAP =
    vwap(
      today.length
        ? today
        : candles.slice(
            -300
          )
    );


  const swings =
    detectSwings(
      m5,
      3,
      3
    );


  const equals =
    equalLevels(
      swings,
      Math.max(
        atrM5 *
        0.12,
        0.4
      )
    );


  const levels =
    [];


  if (
    previousRange.high
  ) {

    levels.push(
      level(
        "Previous Day High",
        "PDH",
        "BUY_SIDE",
        previousRange.high,
        68
      )
    );
  }


  if (
    previousRange.low
  ) {

    levels.push(
      level(
        "Previous Day Low",
        "PDL",
        "SELL_SIDE",
        previousRange.low,
        68
      )
    );
  }


  if (
    asiaRange.high
  ) {

    levels.push(
      level(
        "Asia High",
        "ASIA_HIGH",
        "BUY_SIDE",
        asiaRange.high,
        72
      )
    );
  }


  if (
    asiaRange.low
  ) {

    levels.push(
      level(
        "Asia Low",
        "ASIA_LOW",
        "SELL_SIDE",
        asiaRange.low,
        72
      )
    );
  }


  if (
    londonRange.high
  ) {

    levels.push(
      level(
        "London High",
        "LONDON_HIGH",
        "BUY_SIDE",
        londonRange.high,
        67
      )
    );
  }


  if (
    londonRange.low
  ) {

    levels.push(
      level(
        "London Low",
        "LONDON_LOW",
        "SELL_SIDE",
        londonRange.low,
        67
      )
    );
  }


  if (
    nyRange.high
  ) {

    levels.push(
      level(
        "New York High",
        "NY_HIGH",
        "BUY_SIDE",
        nyRange.high,
        63
      )
    );
  }


  if (
    nyRange.low
  ) {

    levels.push(
      level(
        "New York Low",
        "NY_LOW",
        "SELL_SIDE",
        nyRange.low,
        63
      )
    );
  }


  for (
    const swing of
    swings.highs.slice(-4)
  ) {

    levels.push(
      level(
        "M5 Swing High",
        "M5_SWING_HIGH",
        "BUY_SIDE",
        swing.price,
        48
      )
    );
  }


  for (
    const swing of
    swings.lows.slice(-4)
  ) {

    levels.push(
      level(
        "M5 Swing Low",
        "M5_SWING_LOW",
        "SELL_SIDE",
        swing.price,
        48
      )
    );
  }


  for (
    const item of
    equals.slice(-6)
  ) {

    levels.push(
      level(

        item.type ===
        "EQUAL_HIGHS"
          ? "Equal Highs"
          : "Equal Lows",

        item.type,

        item.type ===
        "EQUAL_HIGHS"
          ? "BUY_SIDE"
          : "SELL_SIDE",

        item.price,

        75
      )
    );
  }


  /*
    Deduplicate similar liquidity prices.
  */

  const unique =
    [];


  for (
    const candidate of levels
  ) {

    const existing =
      unique.find(
        item =>
          item.side ===
          candidate.side &&
          Math.abs(
            item.price -
            candidate.price
          ) <=
          Math.max(
            atrM5 *
            0.05,
            0.25
          )
      );


    if (!existing) {

      unique.push(
        candidate
      );

    } else if (
      candidate.strength >
      existing.strength
    ) {

      Object.assign(
        existing,
        candidate
      );
    }
  }


  const liquidityPools =
    unique
      .map(pool => {

        const scored =
          scorePool(
            pool,
            price,
            atrM5,
            fp,
            struct
          );


        const projection =
          projectSweep(
            pool,
            atrM5,
            scored.score
          );


        let stage =
          "DISTANT";


        if (
          scored.distanceATR <=
          2
        ) {

          stage =
            "TRACKING";
        }


        if (
          scored.distanceATR <=
          0.75
        ) {

          stage =
            "APPROACHING";
        }


        if (
          scored.distanceATR <=
          0.2
        ) {

          stage =
            "RAID_ZONE";
        }


        return {

          ...pool,

          ...scored,

          ...projection,

          stage,

          raidScore:
            scored.score
        };
      })
      .sort(
        (a, b) =>
          b.raidScore -
          a.raidScore
      );


  const highest =
    liquidityPools[0] ||
    null;


  return {

    ok:
      true,

    symbol:
      "XAUUSD",

    providerSymbol:
      SYMBOL,

    provider:
      "Massive / Polygon",

    generatedAt:
      new Date()
        .toISOString(),

    latestBarTime:
      latest.time,

    price:
      round(
        price
      ),


    market: {

      regime:
        marketRegime,

      atrM5:
        round(
          atrM5
        ),

      atrM15:
        round(
          atrM15
        ),

      rsiM5:
        round(
          rsiM5,
          1
        ),

      vwap:
        round(
          sessionVWAP
        ),

      priceVsVWAP:
        price >
        sessionVWAP
          ? "ABOVE"
          : "BELOW"
    },


    structure:
      struct,


    footprint:
      fp,


    sessions: {

      timezone:
        "SAST",

      asia: {

        high:
          round(
            asiaRange.high
          ),

        low:
          round(
            asiaRange.low
          )
      },

      london: {

        high:
          round(
            londonRange.high
          ),

        low:
          round(
            londonRange.low
          )
      },

      newYork: {

        high:
          round(
            nyRange.high
          ),

        low:
          round(
            nyRange.low
          )
      }
    },


    previousDay: {

      high:
        round(
          previousRange.high
        ),

      low:
        round(
          previousRange.low
        )
    },


    highestRankedLiquidity:
      highest,


    liquidityPools:
      liquidityPools.slice(
        0,
        12
      ),


    trapWindows: [

      {
        name:
          "LONDON OPEN",

        startSAST:
          "09:00",

        endSAST:
          "10:30",

        risk:
          "HIGH"
      },

      {
        name:
          "LONDON / NY OVERLAP",

        startSAST:
          "14:00",

        endSAST:
          "17:00",

        risk:
          "VERY_HIGH"
      },

      {
        name:
          "NY OPEN",

        startSAST:
          "15:30",

        endSAST:
          "17:00",

        risk:
          "VERY_HIGH"
      }
    ],


    source: {

      api:
        "Massive / Polygon",

      ticker:
        SYMBOL,

      endpoint:
        "/v2/aggs/ticker/C:XAUUSD/range/1/minute",

      timeframe:
        "1m",

      candles:
        candles.length,

      delayedPossible:
        true
    },


    warnings: [

      "Massive forex aggregates are generated from quoted bid/ask prices rather than a centralized exchange trade tape.",

      "Footprint and delta values are analytical proxies rather than true order-flow bid/ask delta.",

      "Liquidity raid and sweep projections are estimates, not guaranteed reversal levels."
    ]
  };
}


/* ============================================================
   VERCEL HANDLER
============================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS"
  );


  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(200)
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

    const now =
      Date.now();


    if (
      cache.data &&
      now -
      cache.time <
      CACHE_MS
    ) {

      return res
        .status(200)
        .json({

          ...cache.data,

          cached:
            true
        });
    }


    const candles =
      await fetchXAU();


    const data =
      analyse(
        candles
      );


    cache = {

      time:
        Date.now(),

      data
    };


    return res
      .status(200)
      .json({

        ...data,

        cached:
          false
      });


  } catch (
    error
  ) {

    console.error(
      "[XAU MASSIVE ERROR]",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        symbol:
          "XAUUSD",

        provider:
          "Massive / Polygon",

        providerSymbol:
          SYMBOL,

        error:
          error?.message ||
          "XAUUSD analysis failed.",

        troubleshooting: {

          environmentVariable:
            "MASSIVE_API_KEY",

          ticker:
            "C:XAUUSD",

          endpoint:
            "https://api.massive.com/v2/aggs/ticker/C:XAUUSD/range/1/minute/{from}/{to}",

          note:
            "If you receive NOT_AUTHORIZED, your Massive plan does not include the required forex/currencies endpoint."
        }
      });
  }
}