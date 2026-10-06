/* ================================================================
   MKAYFX GOLD LIQUIDITY INTELLIGENCE ENGINE V7
   ---------------------------------------------------------------
   FILE
   /api/xau.js

   PURPOSE
   ---------------------------------------------------------------
   XAU/USD intelligence engine.

   This is NOT designed to force a BUY/SELL trade every refresh.

   DATA ARCHITECTURE
   ---------------------------------------------------------------
   TWELVE_DATA_API_KEY
   → XAU/USD M1 / M5
   → live execution intelligence

   TWELVE_DATA_API_KEY_2
   → XAU/USD M15 / H1 / H4
   → higher timeframe structure

   TWELVE_DATA_API_KEY_3
   → XAU/USD historical M5
   → liquidity sweep statistics

   TWELVE_DATA_API_KEY_4
   → XAG/USD
   → EUR/USD
   → GBP/USD
   → USD/JPY
   → BTC/USD
   → secondary XAU/USD quote

   FRED_API_KEY
   → US 2Y
   → US 10Y
   → Fed Funds
   → macro / yield pressure

   FEATURES
   ---------------------------------------------------------------
   • Current XAU price
   • ATR / RSI / EMA
   • VWAP proxy
   • M1 / M5 / M15 / H1 / H4 structure
   • BOS / CHOCH
   • Displacement
   • Asia high / low
   • London high / low
   • New York high / low
   • PDH / PDL
   • PWH / PWL
   • Equal highs / equal lows
   • H1 swing liquidity
   • M15 FVGs
   • Liquidity ranking
   • Raid strength
   • Liquidity strength
   • Projected sweep zones
   • Historical sweep probability
   • Historical return probability
   • Median / P75 / P90 raid depth
   • Sample count / confidence
   • Delta proxy
   • CVD proxy
   • Absorption proxy
   • Delta divergence proxy
   • Liquidity trap windows
   • Intermarket gold pressure
   • XAG confirmation
   • EURUSD confirmation
   • GBPUSD confirmation
   • USDJPY confirmation
   • BTC confirmation
   • Secondary XAU price validation
   • FRED yield pressure
   • Final consensus model

   IMPORTANT
   ---------------------------------------------------------------
   Spot forex/metals volume from data vendors is not centralized
   exchange order flow.

   Delta, CVD, footprint and absorption are therefore statistical
   candle/volume proxies — not true exchange bid/ask footprint data.
================================================================ */


/* ================================================================
   CONFIG
================================================================ */

const TD_BASE =
  "https://api.twelvedata.com";

const FRED_BASE =
  "https://api.stlouisfed.org/fred";


const KEY_1 =
  process.env.TWELVE_DATA_API_KEY || "";

const KEY_2 =
  process.env.TWELVE_DATA_API_KEY_2 ||
  KEY_1;

const KEY_3 =
  process.env.TWELVE_DATA_API_KEY_3 ||
  KEY_1;

const KEY_4 =
  process.env.TWELVE_DATA_API_KEY_4 ||
  KEY_1;

const FRED_KEY =
  process.env.FRED_API_KEY || "";


const SYMBOL =
  "XAU/USD";


const LIVE_CACHE_MS =
  45 * 1000;

const INTERMARKET_CACHE_MS =
  5 * 60 * 1000;

const HISTORY_CACHE_MS =
  15 * 60 * 1000;

const MACRO_CACHE_MS =
  20 * 60 * 1000;


const MAX_HISTORY =
  5000;


let liveCache = {
  time: 0,
  value: null
};

let intermarketCache = {
  time: 0,
  value: null
};

let historyCache = {
  time: 0,
  value: null
};

let macroCache = {
  time: 0,
  value: null
};


/* ================================================================
   GENERAL HELPERS
================================================================ */

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


function safeNumber(
  value,
  fallback = 0
) {

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


function round(
  value,
  decimals = 2
) {

  const n =
    Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  const p =
    10 ** decimals;

  return (
    Math.round(
      n * p
    ) / p
  );
}


function mean(values) {

  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length
  );
}


function median(values) {

  if (!values.length) {
    return 0;
  }

  const sorted =
    [...values]
      .sort(
        (a, b) =>
          a - b
      );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2
  ) {
    return sorted[middle];
  }

  return (
    (
      sorted[middle - 1] +
      sorted[middle]
    ) /
    2
  );
}


function percentile(
  values,
  p
) {

  if (!values.length) {
    return 0;
  }

  const sorted =
    [...values]
      .sort(
        (a, b) =>
          a - b
      );

  const index =
    (sorted.length - 1) *
    p;

  const lower =
    Math.floor(index);

  const upper =
    Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  return (
    sorted[lower] +
    (
      sorted[upper] -
      sorted[lower]
    ) *
    (
      index -
      lower
    )
  );
}


function stdev(values) {

  if (
    values.length < 2
  ) {
    return 0;
  }

  const avg =
    mean(values);

  return Math.sqrt(
    mean(
      values.map(
        value =>
          (
            value -
            avg
          ) ** 2
      )
    )
  );
}


function isoDay(
  timestamp
) {

  return (
    new Date(timestamp)
      .toISOString()
      .slice(
        0,
        10
      )
  );
}


function isoWeekKey(
  timestamp
) {

  const date =
    new Date(timestamp);

  const temporary =
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      )
    );

  const day =
    temporary.getUTCDay() || 7;

  temporary.setUTCDate(
    temporary.getUTCDate() +
    4 -
    day
  );

  const yearStart =
    new Date(
      Date.UTC(
        temporary.getUTCFullYear(),
        0,
        1
      )
    );

  const week =
    Math.ceil(
      (
        (
          temporary -
          yearStart
        ) /
        86400000 +
        1
      ) /
      7
    );

  return (
    temporary.getUTCFullYear() +
    "-W" +
    String(week).padStart(
      2,
      "0"
    )
  );
}


function utcHour(
  timestamp
) {

  return (
    new Date(timestamp)
      .getUTCHours()
  );
}


function last(
  array
) {

  return array[
    array.length - 1
  ];
}


function unique(
  values
) {

  return [
    ...new Set(values)
  ];
}


/* ================================================================
   TWELVE DATA
================================================================ */

function parseTDValues(
  json
) {

  if (
    !json ||
    !Array.isArray(
      json.values
    )
  ) {

    throw new Error(
      json?.message ||
      "Twelve Data returned no candle values."
    );
  }


  return (
    json.values

      .map(
        item => {

          const rawDate =
            String(
              item.datetime
            );

          /*
             Twelve Data UTC timestamps may not contain
             an explicit Z. Add it when necessary.
          */

          const formattedDate =
            rawDate.includes("T")
              ? rawDate
              : rawDate.replace(
                  " ",
                  "T"
                );

          const timestamp =
            Date.parse(
              formattedDate.endsWith("Z")
                ? formattedDate
                : formattedDate + "Z"
            );


          return {

            time:
              timestamp,

            open:
              Number(
                item.open
              ),

            high:
              Number(
                item.high
              ),

            low:
              Number(
                item.low
              ),

            close:
              Number(
                item.close
              ),

            volume:
              Number.isFinite(
                Number(
                  item.volume
                )
              )
                ? Number(
                    item.volume
                  )
                : 0
          };
        }
      )

      .filter(
        candle =>

          Number.isFinite(
            candle.time
          ) &&

          Number.isFinite(
            candle.open
          ) &&

          Number.isFinite(
            candle.high
          ) &&

          Number.isFinite(
            candle.low
          ) &&

          Number.isFinite(
            candle.close
          )
      )

      .sort(
        (a, b) =>
          a.time -
          b.time
      )
  );
}


async function tdSeries({
  symbol,
  interval,
  outputsize,
  apiKey
}) {

  if (!apiKey) {

    throw new Error(
      "Missing Twelve Data API key."
    );
  }


  const url =

    `${TD_BASE}/time_series` +

    `?symbol=${
      encodeURIComponent(
        symbol
      )
    }` +

    `&interval=${
      encodeURIComponent(
        interval
      )
    }` +

    `&outputsize=${
      outputsize
    }` +

    `&order=asc` +

    `&timezone=UTC` +

    `&apikey=${
      encodeURIComponent(
        apiKey
      )
    }`;


  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "MKAYFX-GOLD-V7"
        }
      }
    );


  if (!response.ok) {

    throw new Error(
      `Twelve Data HTTP ${response.status}`
    );
  }


  const json =
    await response.json();


  if (
    json.status === "error"
  ) {

    throw new Error(
      json.message ||
      "Twelve Data API error."
    );
  }


  return (
    parseTDValues(
      json
    )
  );
}


async function tdQuote({
  symbol,
  apiKey
}) {

  const url =

    `${TD_BASE}/quote` +

    `?symbol=${
      encodeURIComponent(
        symbol
      )
    }` +

    `&apikey=${
      encodeURIComponent(
        apiKey
      )
    }`;


  const response =
    await fetch(url);


  if (!response.ok) {

    throw new Error(
      `Twelve Data quote HTTP ${response.status}`
    );
  }


  const json =
    await response.json();


  if (
    json.status === "error"
  ) {

    throw new Error(
      json.message ||
      "Twelve Data quote error."
    );
  }


  return {

    symbol,

    price:
      safeNumber(
        json.close ||
        json.price
      ),

    open:
      safeNumber(
        json.open
      ),

    high:
      safeNumber(
        json.high
      ),

    low:
      safeNumber(
        json.low
      ),

    previousClose:
      safeNumber(
        json.previous_close
      ),

    change:
      safeNumber(
        json.change
      ),

    percentChange:
      safeNumber(
        json.percent_change
      ),

    timestamp:
      json.timestamp ||
      null
  };
}


/* ================================================================
   INDICATORS
================================================================ */

function ema(
  values,
  period
) {

  if (!values.length) {
    return [];
  }


  const multiplier =
    2 /
    (
      period +
      1
    );


  const output = [];

  let previous =
    values[0];


  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    if (
      i === 0
    ) {

      previous =
        values[i];

    } else {

      previous =
        values[i] *
        multiplier +
        previous *
        (
          1 -
          multiplier
        );
    }


    output.push(
      previous
    );
  }


  return output;
}


function sma(
  values,
  period
) {

  const output = [];

  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    if (
      i + 1 <
      period
    ) {

      output.push(null);

      continue;
    }


    output.push(
      mean(
        values.slice(
          i -
          period +
          1,
          i +
          1
        )
      )
    );
  }


  return output;
}


function atrSeries(
  candles,
  period = 14
) {

  if (
    candles.length < 2
  ) {
    return [];
  }


  const trueRanges = [
    candles[0].high -
    candles[0].low
  ];


  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const candle =
      candles[i];

    const previous =
      candles[i - 1];


    trueRanges.push(

      Math.max(

        candle.high -
        candle.low,

        Math.abs(
          candle.high -
          previous.close
        ),

        Math.abs(
          candle.low -
          previous.close
        )
      )
    );
  }


  return ema(
    trueRanges,
    period
  );
}


function atr(
  candles,
  period = 14
) {

  const values =
    atrSeries(
      candles,
      period
    );


  return (
    values.length
      ? last(values)
      : 0
  );
}


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

    const difference =

      candles[i].close -
      candles[i - 1].close;


    if (
      difference > 0
    ) {

      gains +=
        difference;

    } else {

      losses +=
        Math.abs(
          difference
        );
    }
  }


  const avgGain =
    gains / period;

  const avgLoss =
    losses / period;


  if (
    avgLoss === 0
  ) {
    return 100;
  }


  const rs =
    avgGain /
    avgLoss;


  return (
    100 -
    100 /
    (
      1 +
      rs
    )
  );
}


function macd(
  candles
) {

  const closes =
    candles.map(
      candle =>
        candle.close
    );


  if (
    closes.length < 35
  ) {

    return {
      macd: 0,
      signal: 0,
      histogram: 0
    };
  }


  const fast =
    ema(
      closes,
      12
    );

  const slow =
    ema(
      closes,
      26
    );


  const macdLine =
    closes.map(
      (_, i) =>
        fast[i] -
        slow[i]
    );


  const signal =
    ema(
      macdLine,
      9
    );


  return {

    macd:
      last(macdLine),

    signal:
      last(signal),

    histogram:
      last(macdLine) -
      last(signal)
  };
}


function roc(
  candles,
  lookback = 10
) {

  if (
    candles.length <=
    lookback
  ) {
    return 0;
  }


  const now =
    last(candles).close;

  const past =
    candles[
      candles.length -
      lookback -
      1
    ].close;


  if (!past) {
    return 0;
  }


  return (
    (
      now -
      past
    ) /
    past *
    100
  );
}


function vwapProxy(
  candles,
  lookback = 100
) {

  const data =
    candles.slice(
      -lookback
    );


  if (!data.length) {
    return 0;
  }


  let pv = 0;
  let volume = 0;


  for (
    const candle
    of data
  ) {

    const typical =
      (
        candle.high +
        candle.low +
        candle.close
      ) /
      3;


    /*
      When true volume is unavailable use candle range
      as a tiny activity proxy.
    */

    const weight =
      candle.volume > 0
        ? candle.volume
        : Math.max(
            candle.high -
            candle.low,
            0.0001
          );


    pv +=
      typical *
      weight;

    volume +=
      weight;
  }


  return (
    volume > 0
      ? pv / volume
      : last(data).close
  );
}


/* ================================================================
   RESAMPLING
================================================================ */

function intervalMs(
  minutes
) {

  return (
    minutes *
    60 *
    1000
  );
}


function resample(
  candles,
  minutes
) {

  if (!candles.length) {
    return [];
  }


  const bucketSize =
    intervalMs(
      minutes
    );


  const buckets =
    new Map();


  for (
    const candle
    of candles
  ) {

    const bucket =
      Math.floor(
        candle.time /
        bucketSize
      ) *
      bucketSize;


    if (
      !buckets.has(
        bucket
      )
    ) {

      buckets.set(
        bucket,
        {
          time: bucket,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume:
            candle.volume || 0
        }
      );

    } else {

      const current =
        buckets.get(
          bucket
        );


      current.high =
        Math.max(
          current.high,
          candle.high
        );

      current.low =
        Math.min(
          current.low,
          candle.low
        );

      current.close =
        candle.close;

      current.volume +=
        candle.volume || 0;
    }
  }


  return (
    [...buckets.values()]
      .sort(
        (a, b) =>
          a.time -
          b.time
      )
  );
}


/* ================================================================
   STRUCTURE
================================================================ */

function pivotHigh(
  candles,
  index,
  left = 3,
  right = 3
) {

  if (
    index < left ||
    index + right >=
    candles.length
  ) {
    return false;
  }


  const value =
    candles[index].high;


  for (
    let i =
      index -
      left;

    i <=
      index +
      right;

    i++
  ) {

    if (
      i === index
    ) {
      continue;
    }

    if (
      candles[i].high >=
      value
    ) {
      return false;
    }
  }


  return true;
}


function pivotLow(
  candles,
  index,
  left = 3,
  right = 3
) {

  if (
    index < left ||
    index + right >=
    candles.length
  ) {
    return false;
  }


  const value =
    candles[index].low;


  for (
    let i =
      index -
      left;

    i <=
      index +
      right;

    i++
  ) {

    if (
      i === index
    ) {
      continue;
    }

    if (
      candles[i].low <=
      value
    ) {
      return false;
    }
  }


  return true;
}


function swings(
  candles,
  lookback = 120
) {

  const data =
    candles.slice(
      -lookback
    );


  const highs = [];
  const lows = [];


  for (
    let i = 3;
    i < data.length - 3;
    i++
  ) {

    if (
      pivotHigh(
        data,
        i
      )
    ) {

      highs.push({
        time:
          data[i].time,

        price:
          data[i].high
      });
    }


    if (
      pivotLow(
        data,
        i
      )
    ) {

      lows.push({
        time:
          data[i].time,

        price:
          data[i].low
      });
    }
  }


  return {
    highs,
    lows
  };
}


function structure(
  candles
) {

  if (
    candles.length < 55
  ) {

    return {
      bias: "NEUTRAL",
      score: 0,
      ema20: null,
      ema50: null,
      bos: null,
      choch: null,
      lastSwingHigh: null,
      lastSwingLow: null
    };
  }


  const closes =
    candles.map(
      candle =>
        candle.close
    );


  const ema20 =
    last(
      ema(
        closes,
        20
      )
    );


  const ema50 =
    last(
      ema(
        closes,
        50
      )
    );


  const price =
    last(
      candles
    ).close;


  const swingData =
    swings(
      candles,
      100
    );


  const swingHigh =
    swingData.highs.length
      ? last(
          swingData.highs
        )
      : null;


  const swingLow =
    swingData.lows.length
      ? last(
          swingData.lows
        )
      : null;


  let score = 0;

  if (
    price >
    ema20
  ) {

    score += 1;

  } else {

    score -= 1;
  }


  if (
    ema20 >
    ema50
  ) {

    score += 1;

  } else {

    score -= 1;
  }


  const recent =
    candles.slice(
      -10
    );

  const previous =
    candles.slice(
      -20,
      -10
    );


  const recentHigh =
    Math.max(
      ...recent.map(
        x =>
          x.high
      )
    );


  const previousHigh =
    Math.max(
      ...previous.map(
        x =>
          x.high
      )
    );


  const recentLow =
    Math.min(
      ...recent.map(
        x =>
          x.low
      )
    );


  const previousLow =
    Math.min(
      ...previous.map(
        x =>
          x.low
      )
    );


  if (
    recentHigh >
      previousHigh &&
    recentLow >
      previousLow
  ) {

    score += 2;
  }


  if (
    recentHigh <
      previousHigh &&
    recentLow <
      previousLow
  ) {

    score -= 2;
  }


  let bos = null;
  let choch = null;


  if (
    swingHigh &&
    price >
      swingHigh.price
  ) {

    bos =
      "BULLISH BOS";
  }


  if (
    swingLow &&
    price <
      swingLow.price
  ) {

    bos =
      "BEARISH BOS";
  }


  if (
    score <= -1 &&
    swingHigh &&
    price >
      swingHigh.price
  ) {

    choch =
      "BULLISH CHOCH";
  }


  if (
    score >= 1 &&
    swingLow &&
    price <
      swingLow.price
  ) {

    choch =
      "BEARISH CHOCH";
  }


  return {

    bias:
      score >= 2
        ? "BULLISH"
        : score <= -2
          ? "BEARISH"
          : "NEUTRAL",

    score,

    ema20:
      round(
        ema20,
        2
      ),

    ema50:
      round(
        ema50,
        2
      ),

    bos,

    choch,

    lastSwingHigh:
      swingHigh
        ? {
            price:
              round(
                swingHigh.price,
                2
              ),

            time:
              swingHigh.time
          }
        : null,

    lastSwingLow:
      swingLow
        ? {
            price:
              round(
                swingLow.price,
                2
              ),

            time:
              swingLow.time
          }
        : null
  };
}


/* ================================================================
   DISPLACEMENT
================================================================ */

function displacement(
  candles
) {

  if (
    candles.length < 30
  ) {

    return {
      active: false,
      direction: null,
      strength: 0
    };
  }


  const ranges =
    candles
      .slice(
        -25,
        -1
      )
      .map(
        candle =>
          candle.high -
          candle.low
      );


  const avgRange =
    mean(ranges);


  const candle =
    last(candles);


  const range =
    candle.high -
    candle.low;


  const body =
    Math.abs(
      candle.close -
      candle.open
    );


  const bodyRatio =
    range > 0
      ? body / range
      : 0;


  const expansion =
    avgRange > 0
      ? range /
        avgRange
      : 0;


  const active =
    expansion >= 1.5 &&
    bodyRatio >= 0.65;


  return {

    active,

    direction:
      active
        ? (
            candle.close >
            candle.open
              ? "BULLISH"
              : "BEARISH"
          )
        : null,

    expansion:
      round(
        expansion,
        2
      ),

    bodyRatio:
      round(
        bodyRatio,
        2
      ),

    strength:
      round(
        clamp(
          expansion *
          bodyRatio *
          50,
          0,
          100
        ),
        1
      )
  };
}


/* ================================================================
   SESSION ENGINE
================================================================ */

const SESSION_DEFS = {

  ASIA: {
    start: 0,
    end: 7
  },

  LONDON: {
    start: 7,
    end: 16
  },

  NEW_YORK: {
    start: 12,
    end: 21
  }
};


function sessionRange(
  candles,
  day,
  session
) {

  const data =
    candles.filter(
      candle => {

        if (
          isoDay(
            candle.time
          ) !== day
        ) {
          return false;
        }


        const hour =
          utcHour(
            candle.time
          );


        return (
          hour >=
            session.start &&
          hour <
            session.end
        );
      }
    );


  if (!data.length) {
    return null;
  }


  return {

    high:
      Math.max(
        ...data.map(
          x =>
            x.high
        )
      ),

    low:
      Math.min(
        ...data.map(
          x =>
            x.low
        )
      ),

    open:
      data[0].open,

    close:
      last(
        data
      ).close,

    startTime:
      data[0].time,

    endTime:
      last(
        data
      ).time,

    bars:
      data.length
  };
}


function currentSessions(
  candles
) {

  if (!candles.length) {
    return {};
  }


  const currentDay =
    isoDay(
      last(
        candles
      ).time
    );


  const output = {};


  for (
    const [
      name,
      definition
    ]
    of
    Object.entries(
      SESSION_DEFS
    )
  ) {

    const range =
      sessionRange(
        candles,
        currentDay,
        definition
      );


    output[name] =
      range
        ? {

            high:
              round(
                range.high,
                2
              ),

            low:
              round(
                range.low,
                2
              ),

            range:
              round(
                range.high -
                range.low,
                2
              ),

            open:
              round(
                range.open,
                2
              ),

            close:
              round(
                range.close,
                2
              )
          }
        : null;
  }


  return output;
}


/* ================================================================
   PREVIOUS DAY / WEEK
================================================================ */

function previousDayLevels(
  candles
) {

  const days =
    unique(
      candles.map(
        candle =>
          isoDay(
            candle.time
          )
      )
    );


  if (
    days.length < 2
  ) {
    return null;
  }


  const previousDay =
    days[
      days.length -
      2
    ];


  const data =
    candles.filter(
      candle =>
        isoDay(
          candle.time
        ) ===
        previousDay
    );


  if (!data.length) {
    return null;
  }


  return {

    date:
      previousDay,

    high:
      round(
        Math.max(
          ...data.map(
            x =>
              x.high
          )
        ),
        2
      ),

    low:
      round(
        Math.min(
          ...data.map(
            x =>
              x.low
          )
        ),
        2
      )
  };
}


function previousWeekLevels(
  candles
) {

  const weeks =
    unique(
      candles.map(
        candle =>
          isoWeekKey(
            candle.time
          )
      )
    );


  if (
    weeks.length < 2
  ) {
    return null;
  }


  const previousWeek =
    weeks[
      weeks.length -
      2
    ];


  const data =
    candles.filter(
      candle =>
        isoWeekKey(
          candle.time
        ) ===
        previousWeek
    );


  if (!data.length) {
    return null;
  }


  return {

    week:
      previousWeek,

    high:
      round(
        Math.max(
          ...data.map(
            x =>
              x.high
          )
        ),
        2
      ),

    low:
      round(
        Math.min(
          ...data.map(
            x =>
              x.low
          )
        ),
        2
      )
  };
}


/* ================================================================
   EQUAL HIGHS / LOWS
================================================================ */

function detectEqualLevels(
  candles,
  atrValue
) {

  const swingData =
    swings(
      candles,
      160
    );


  const tolerance =
    Math.max(
      atrValue *
      0.12,
      0.05
    );


  const equalHighs = [];
  const equalLows = [];


  for (
    let i = 0;
    i <
      swingData.highs.length;
    i++
  ) {

    for (
      let j =
        i + 1;

      j <
        swingData.highs.length;

      j++
    ) {

      const first =
        swingData.highs[i];

      const second =
        swingData.highs[j];


      if (
        Math.abs(
          first.price -
          second.price
        ) <=
        tolerance
      ) {

        equalHighs.push({

          level:
            (
              first.price +
              second.price
            ) /
            2,

          firstTime:
            first.time,

          secondTime:
            second.time
        });
      }
    }
  }


  for (
    let i = 0;
    i <
      swingData.lows.length;
    i++
  ) {

    for (
      let j =
        i + 1;

      j <
        swingData.lows.length;

      j++
    ) {

      const first =
        swingData.lows[i];

      const second =
        swingData.lows[j];


      if (
        Math.abs(
          first.price -
          second.price
        ) <=
        tolerance
      ) {

        equalLows.push({

          level:
            (
              first.price +
              second.price
            ) /
            2,

          firstTime:
            first.time,

          secondTime:
            second.time
        });
      }
    }
  }


  return {

    highs:
      equalHighs
        .slice(-5)
        .map(
          item => ({
            ...item,
            level:
              round(
                item.level,
                2
              )
          })
        ),

    lows:
      equalLows
        .slice(-5)
        .map(
          item => ({
            ...item,
            level:
              round(
                item.level,
                2
              )
          })
        )
  };
}


/* ================================================================
   FAIR VALUE GAPS
================================================================ */

function fairValueGaps(
  candles,
  maxResults = 8
) {

  const gaps = [];


  for (
    let i = 2;
    i < candles.length;
    i++
  ) {

    const first =
      candles[
        i - 2
      ];

    const third =
      candles[i];


    /*
      Bullish imbalance:
      third candle low > first candle high
    */

    if (
      third.low >
      first.high
    ) {

      gaps.push({

        direction:
          "BULLISH",

        low:
          first.high,

        high:
          third.low,

        midpoint:
          (
            first.high +
            third.low
          ) /
          2,

        time:
          third.time
      });
    }


    /*
      Bearish imbalance:
      third candle high < first candle low
    */

    if (
      third.high <
      first.low
    ) {

      gaps.push({

        direction:
          "BEARISH",

        low:
          third.high,

        high:
          first.low,

        midpoint:
          (
            third.high +
            first.low
          ) /
          2,

        time:
          third.time
      });
    }
  }


  return (
    gaps
      .slice(
        -maxResults
      )
      .map(
        gap => ({

          direction:
            gap.direction,

          low:
            round(
              gap.low,
              2
            ),

          high:
            round(
              gap.high,
              2
            ),

          midpoint:
            round(
              gap.midpoint,
              2
            ),

          time:
            gap.time
        })
      )
  );
}


/* ================================================================
   DELTA / CVD / ABSORPTION PROXY
================================================================ */

function deltaEngine(
  candles
) {

  if (!candles.length) {

    return {
      delta: 0,
      cvd: 0,
      bias: "BALANCED",
      absorption: null,
      divergence: null
    };
  }


  const data =
    candles.slice(
      -100
    );


  let cvd = 0;

  const rows = [];


  for (
    const candle
    of data
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
        (
          candle.close -
          candle.low
        ) /
        range
      ) *
      2 -
      1;


    const activity =
      candle.volume > 0
        ? candle.volume
        : range;


    const delta =
      activity *
      clamp(
        (
          body /
          range
        ) *
        0.65 +
        closeLocation *
        0.35,
        -1,
        1
      );


    cvd +=
      delta;


    rows.push({

      time:
        candle.time,

      price:
        candle.close,

      delta,

      cvd,

      range,

      bodyRatio:
        Math.abs(
          body
        ) /
        range
    });
  }


  const recent =
    rows.slice(
      -12
    );


  const delta =
    recent.reduce(
      (
        sum,
        row
      ) =>
        sum +
        row.delta,
      0
    );


  /*
     ABSORPTION PROXY
     High candle activity / range with small progress.
  */

  const lastRow =
    last(rows);

  const avgRange =
    mean(
      rows
        .slice(
          -20,
          -1
        )
        .map(
          row =>
            row.range
        )
    );


  let absorption = null;


  if (
    lastRow &&
    avgRange > 0
  ) {

    const rangeExpansion =
      lastRow.range /
      avgRange;


    if (
      rangeExpansion >= 1.25 &&
      lastRow.bodyRatio <= 0.35
    ) {

      absorption =

        lastRow.delta > 0
          ? "BUYING ABSORBED"
          : lastRow.delta < 0
            ? "SELLING ABSORBED"
            : "TWO-WAY ABSORPTION";
    }
  }


  /*
     DELTA DIVERGENCE PROXY
  */

  let divergence = null;


  if (
    rows.length >= 20
  ) {

    const older =
      rows[
        rows.length -
        15
      ];

    const newer =
      last(rows);


    const priceMove =
      newer.price -
      older.price;


    const cvdMove =
      newer.cvd -
      older.cvd;


    if (
      priceMove > 0 &&
      cvdMove < 0
    ) {

      divergence =
        "BEARISH DELTA DIVERGENCE";
    }


    if (
      priceMove < 0 &&
      cvdMove > 0
    ) {

      divergence =
        "BULLISH DELTA DIVERGENCE";
    }
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

    bias:
      delta > 0
        ? "BUYING PRESSURE"
        : delta < 0
          ? "SELLING PRESSURE"
          : "BALANCED",

    absorption,

    divergence
  };
}


/* ================================================================
   HISTORICAL SESSION SWEEP MODEL
================================================================ */

function calculateHistoricalSessionStats(
  candles,
  sessionName
) {

  const definition =
    SESSION_DEFS[
      sessionName
    ];


  const days =
    unique(
      candles.map(
        candle =>
          isoDay(
            candle.time
          )
      )
    );


  let samples = 0;

  let highSweeps = 0;
  let highReturns = 0;

  let lowSweeps = 0;
  let lowReturns = 0;


  const highRaids = [];
  const lowRaids = [];


  for (
    const day
    of days
  ) {

    const session =
      sessionRange(
        candles,
        day,
        definition
      );


    if (!session) {
      continue;
    }


    const future =

      candles.filter(
        candle =>

          candle.time >
            session.endTime &&

          candle.time <=
            session.endTime +
            16 *
            60 *
            60 *
            1000
      );


    if (
      future.length < 3
    ) {
      continue;
    }


    const sessionCandles =
      candles.filter(
        candle =>
          candle.time >=
            session.startTime &&
          candle.time <=
            session.endTime
      );


    const localATR =
      atr(
        sessionCandles.length >= 20
          ? sessionCandles
          : candles.filter(
              candle =>
                isoDay(
                  candle.time
                ) === day
            ),
        14
      );


    if (
      !Number.isFinite(
        localATR
      ) ||
      localATR <= 0
    ) {
      continue;
    }


    samples++;


    const maxFuture =
      Math.max(
        ...future.map(
          candle =>
            candle.high
        )
      );


    const minFuture =
      Math.min(
        ...future.map(
          candle =>
            candle.low
        )
      );


    if (
      maxFuture >
      session.high
    ) {

      highSweeps++;


      const raid =
        (
          maxFuture -
          session.high
        ) /
        localATR;


      /*
        Cap continuation extremes in distribution stats.
        Sweep occurrence remains counted.
      */

      highRaids.push(
        clamp(
          raid,
          0,
          8
        )
      );


      const firstSweep =
        future.findIndex(
          candle =>
            candle.high >
            session.high
        );


      if (
        firstSweep >= 0
      ) {

        const after =
          future.slice(
            firstSweep,
            firstSweep + 18
          );


        if (
          after.some(
            candle =>
              candle.close <
              session.high
          )
        ) {

          highReturns++;
        }
      }
    }


    if (
      minFuture <
      session.low
    ) {

      lowSweeps++;


      const raid =
        (
          session.low -
          minFuture
        ) /
        localATR;


      lowRaids.push(
        clamp(
          raid,
          0,
          8
        )
      );


      const firstSweep =
        future.findIndex(
          candle =>
            candle.low <
            session.low
        );


      if (
        firstSweep >= 0
      ) {

        const after =
          future.slice(
            firstSweep,
            firstSweep + 18
          );


        if (
          after.some(
            candle =>
              candle.close >
              session.low
          )
        ) {

          lowReturns++;
        }
      }
    }
  }


  function pack(
    swept,
    returned,
    raids
  ) {

    const sweepRate =
      samples > 0
        ? swept /
          samples *
          100
        : 0;


    const returnRate =
      swept > 0
        ? returned /
          swept *
          100
        : 0;


    let confidence =
      "LOW";


    if (
      samples >= 40
    ) {

      confidence =
        "HIGH";

    } else if (
      samples >= 20
    ) {

      confidence =
        "MEDIUM";
    }


    return {

      samples,

      swept,

      returned,

      sweepRate:
        round(
          sweepRate,
          1
        ),

      returnRate:
        round(
          returnRate,
          1
        ),

      medianRaidATR:
        round(
          median(
            raids
          ),
          2
        ),

      p75RaidATR:
        round(
          percentile(
            raids,
            0.75
          ),
          2
        ),

      p90RaidATR:
        round(
          percentile(
            raids,
            0.90
          ),
          2
        ),

      confidence
    };
  }


  return {

    high:
      pack(
        highSweeps,
        highReturns,
        highRaids
      ),

    low:
      pack(
        lowSweeps,
        lowReturns,
        lowRaids
      )
  };
}


/* ================================================================
   LIQUIDITY POOLS
================================================================ */

function buildLiquidityPools({
  price,
  atrValue,
  sessions,
  previousDay,
  previousWeek,
  h1,
  equalLevels,
  statistics
}) {

  const pools = [];


  function add({
    name,
    level,
    side,
    type,
    historical = null,
    baseStrength = 50
  }) {

    if (
      !Number.isFinite(
        Number(
          level
        )
      )
    ) {
      return;
    }


    const numericLevel =
      Number(level);


    const distance =
      Math.abs(
        price -
        numericLevel
      );


    const distanceATR =
      atrValue > 0
        ? distance /
          atrValue
        : 0;


    const proximityScore =
      clamp(
        100 -
        distanceATR *
        18,
        0,
        100
      );


    const untouchedScore =

      side === "BUY_SIDE"
        ? price <
            numericLevel
          ? 100
          : 35

        : price >
            numericLevel
          ? 100
          : 35;


    const historicalSweep =
      historical?.sweepRate ??
      40;


    const historicalReturn =
      historical?.returnRate ??
      50;


    const sampleWeight =
      historical
        ? clamp(
            historical.samples /
            40,
            0.35,
            1
          )
        : 0.5;


    const historicalScore =

      (
        historicalSweep *
        0.65 +

        historicalReturn *
        0.35

      ) *
      sampleWeight;


    const liquidityStrength =
      clamp(
        baseStrength *
        0.30 +

        historicalScore *
        0.30 +

        proximityScore *
        0.25 +

        untouchedScore *
        0.15,
        0,
        100
      );


    const raidDepthATR =
      historical?.medianRaidATR ??
      0.25;


    const raidStrength =
      clamp(

        historicalSweep *
          0.40 +

        proximityScore *
          0.30 +

        historicalReturn *
          0.15 +

        baseStrength *
          0.15,

        0,
        100
      );


    let projectedZoneLow =
      numericLevel;

    let projectedZoneHigh =
      numericLevel;


    if (
      side ===
      "BUY_SIDE"
    ) {

      projectedZoneLow =
        numericLevel;

      projectedZoneHigh =
        numericLevel +
        raidDepthATR *
        atrValue;

    } else {

      projectedZoneHigh =
        numericLevel;

      projectedZoneLow =
        numericLevel -
        raidDepthATR *
        atrValue;
    }


    pools.push({

      name,

      type,

      side,

      level:
        round(
          numericLevel,
          2
        ),

      distance:
        round(
          distance,
          2
        ),

      distanceATR:
        round(
          distanceATR,
          2
        ),

      liquidityStrength:
        round(
          liquidityStrength,
          1
        ),

      raidStrength:
        round(
          raidStrength,
          1
        ),

      sweepProbability:
        round(
          historicalSweep,
          1
        ),

      returnProbability:
        round(
          historicalReturn,
          1
        ),

      projectedRaidATR:
        round(
          raidDepthATR,
          2
        ),

      projectedZone: {

        low:
          round(
            projectedZoneLow,
            2
          ),

        high:
          round(
            projectedZoneHigh,
            2
          )
      },

      sampleCount:
        historical?.samples ??
        null,

      confidence:
        historical?.confidence ??
        "MODEL"
    });
  }


  if (
    sessions.ASIA
  ) {

    add({
      name:
        "ASIA HIGH",
      level:
        sessions.ASIA.high,
      side:
        "BUY_SIDE",
      type:
        "SESSION",
      historical:
        statistics?.ASIA?.high,
      baseStrength:
        68
    });


    add({
      name:
        "ASIA LOW",
      level:
        sessions.ASIA.low,
      side:
        "SELL_SIDE",
      type:
        "SESSION",
      historical:
        statistics?.ASIA?.low,
      baseStrength:
        68
    });
  }


  if (
    sessions.LONDON
  ) {

    add({
      name:
        "LONDON HIGH",
      level:
        sessions.LONDON.high,
      side:
        "BUY_SIDE",
      type:
        "SESSION",
      historical:
        statistics?.LONDON?.high,
      baseStrength:
        76
    });


    add({
      name:
        "LONDON LOW",
      level:
        sessions.LONDON.low,
      side:
        "SELL_SIDE",
      type:
        "SESSION",
      historical:
        statistics?.LONDON?.low,
      baseStrength:
        76
    });
  }


  if (
    sessions.NEW_YORK
  ) {

    add({
      name:
        "NEW YORK HIGH",
      level:
        sessions.NEW_YORK.high,
      side:
        "BUY_SIDE",
      type:
        "SESSION",
      historical:
        statistics?.NEW_YORK?.high,
      baseStrength:
        80
    });


    add({
      name:
        "NEW YORK LOW",
      level:
        sessions.NEW_YORK.low,
      side:
        "SELL_SIDE",
      type:
        "SESSION",
      historical:
        statistics?.NEW_YORK?.low,
      baseStrength:
        80
    });
  }


  if (
    previousDay
  ) {

    add({
      name:
        "PREVIOUS DAY HIGH",
      level:
        previousDay.high,
      side:
        "BUY_SIDE",
      type:
        "DAILY",
      baseStrength:
        86
    });


    add({
      name:
        "PREVIOUS DAY LOW",
      level:
        previousDay.low,
      side:
        "SELL_SIDE",
      type:
        "DAILY",
      baseStrength:
        86
    });
  }


  if (
    previousWeek
  ) {

    add({
      name:
        "PREVIOUS WEEK HIGH",
      level:
        previousWeek.high,
      side:
        "BUY_SIDE",
      type:
        "WEEKLY",
      baseStrength:
        92
    });


    add({
      name:
        "PREVIOUS WEEK LOW",
      level:
        previousWeek.low,
      side:
        "SELL_SIDE",
      type:
        "WEEKLY",
      baseStrength:
        92
    });
  }


  const h1Swings =
    swings(
      h1,
      150
    );


  for (
    const swing
    of
    h1Swings.highs.slice(
      -3
    )
  ) {

    add({
      name:
        "H1 SWING HIGH",
      level:
        swing.price,
      side:
        "BUY_SIDE",
      type:
        "H1_SWING",
      baseStrength:
        72
    });
  }


  for (
    const swing
    of
    h1Swings.lows.slice(
      -3
    )
  ) {

    add({
      name:
        "H1 SWING LOW",
      level:
        swing.price,
      side:
        "SELL_SIDE",
      type:
        "H1_SWING",
      baseStrength:
        72
    });
  }


  for (
    const item
    of
    equalLevels.highs
  ) {

    add({
      name:
        "EQUAL HIGHS",
      level:
        item.level,
      side:
        "BUY_SIDE",
      type:
        "EQUAL_LEVEL",
      baseStrength:
        84
    });
  }


  for (
    const item
    of
    equalLevels.lows
  ) {

    add({
      name:
        "EQUAL LOWS",
      level:
        item.level,
      side:
        "SELL_SIDE",
      type:
        "EQUAL_LEVEL",
      baseStrength:
        84
    });
  }


  /*
     Deduplicate near-identical pools.
  */

  const sorted =
    pools.sort(
      (
        a,
        b
      ) =>

        b.liquidityStrength -
        a.liquidityStrength
    );


  const filtered = [];


  for (
    const pool
    of sorted
  ) {

    const duplicate =
      filtered.some(
        existing =>

          existing.side ===
            pool.side &&

          Math.abs(
            existing.level -
            pool.level
          ) <=
            atrValue *
            0.08
      );


    if (
      !duplicate
    ) {
      filtered.push(
        pool
      );
    }
  }


  return (
    filtered
      .sort(
        (
          a,
          b
        ) =>

          (
            b.raidStrength +
            b.liquidityStrength
          ) -

          (
            a.raidStrength +
            a.liquidityStrength
          )
      )
      .slice(
        0,
        20
      )
  );
}


/* ================================================================
   RAID / SWEEP DETECTION
================================================================ */

function detectActiveSweep(
  candles,
  pools,
  atrValue
) {

  if (
    candles.length < 4
  ) {
    return null;
  }


  const latest =
    last(candles);


  const previous =
    candles[
      candles.length -
      2
    ];


  const candidates = [];


  for (
    const pool
    of pools
  ) {

    if (
      pool.side ===
      "BUY_SIDE"
    ) {

      const swept =
        latest.high >
        pool.level;


      const rejected =
        latest.close <
        pool.level;


      const previousInside =
        previous.close <
        pool.level;


      if (
        swept &&
        rejected &&
        previousInside
      ) {

        candidates.push({

          pool:
            pool.name,

          direction:
            "BUY_SIDE_SWEEP",

          level:
            pool.level,

          raidDepth:
            round(
              latest.high -
              pool.level,
              2
            ),

          raidATR:
            round(
              atrValue > 0
                ? (
                    latest.high -
                    pool.level
                  ) /
                  atrValue
                : 0,
              2
            ),

          rejection:
            true
        });
      }

    } else {

      const swept =
        latest.low <
        pool.level;


      const rejected =
        latest.close >
        pool.level;


      const previousInside =
        previous.close >
        pool.level;


      if (
        swept &&
        rejected &&
        previousInside
      ) {

        candidates.push({

          pool:
            pool.name,

          direction:
            "SELL_SIDE_SWEEP",

          level:
            pool.level,

          raidDepth:
            round(
              pool.level -
              latest.low,
              2
            ),

          raidATR:
            round(
              atrValue > 0
                ? (
                    pool.level -
                    latest.low
                  ) /
                  atrValue
                : 0,
              2
            ),

          rejection:
            true
        });
      }
    }
  }


  return (
    candidates.length
      ? candidates[0]
      : null
  );
}


/* ================================================================
   TRAP WINDOWS
================================================================ */

function buildTrapWindows({
  price,
  atrValue,
  pools,
  fvgs
}) {

  const traps = [];


  for (
    const pool
    of pools.slice(
      0,
      8
    )
  ) {

    if (
      pool.distanceATR >
      1.5
    ) {
      continue;
    }


    const nearbyFVG =
      fvgs.find(
        gap =>
          Math.abs(
            gap.midpoint -
            pool.level
          ) <=
          atrValue *
          0.65
      );


    const width =
      Math.max(
        atrValue *
        0.15,
        0.25
      );


    traps.push({

      name:
        `${pool.name} TRAP WINDOW`,

      side:
        pool.side,

      level:
        pool.level,

      low:
        round(
          pool.side ===
          "BUY_SIDE"
            ? pool.level
            : pool.level -
              width,
          2
        ),

      high:
        round(
          pool.side ===
          "BUY_SIDE"
            ? pool.level +
              width
            : pool.level,
          2
        ),

      distanceATR:
        pool.distanceATR,

      liquidityStrength:
        pool.liquidityStrength,

      raidStrength:
        pool.raidStrength,

      nearbyFVG:
        Boolean(
          nearbyFVG
        ),

      score:
        round(
          clamp(
            pool.raidStrength *
            0.55 +
            pool.liquidityStrength *
            0.35 +
            (
              nearbyFVG
                ? 10
                : 0
            ),
            0,
            100
          ),
          1
        )
    });
  }


  return (
    traps.sort(
      (
        a,
        b
      ) =>
        b.score -
        a.score
    )
  );
}


/* ================================================================
   INTERMARKET ENGINE — API #4
================================================================ */

function percentageMove(
  candles,
  bars
) {

  if (
    !candles ||
    candles.length <=
      bars
  ) {
    return 0;
  }


  const current =
    last(candles).close;


  const previous =
    candles[
      candles.length -
      bars -
      1
    ].close;


  if (!previous) {
    return 0;
  }


  return (
    (
      current -
      previous
    ) /
    previous *
    100
  );
}


async function loadIntermarket() {

  if (
    intermarketCache.value &&
    Date.now() -
      intermarketCache.time <
      INTERMARKET_CACHE_MS
  ) {

    return (
      intermarketCache.value
    );
  }


  const symbols = [

    "XAG/USD",
    "EUR/USD",
    "GBP/USD",
    "USD/JPY",
    "BTC/USD"
  ];


  const results =
    await Promise.all(

      symbols.map(
        symbol =>

          tdSeries({
            symbol,
            interval:
              "1h",
            outputsize:
              80,
            apiKey:
              KEY_4
          })
          .catch(
            () => []
          )
      )
    );


  const data = {};


  symbols.forEach(
    (
      symbol,
      index
    ) => {

      data[symbol] =
        results[index];
    }
  );


  const configs = {

    "XAG/USD": {
      label:
        "Silver",
      weight:
        0.36,
      direction:
        1
    },

    "EUR/USD": {
      label:
        "EUR/USD",
      weight:
        0.20,
      direction:
        1
    },

    "GBP/USD": {
      label:
        "GBP/USD",
      weight:
        0.12,
      direction:
        1
    },

    "USD/JPY": {
      label:
        "USD/JPY",
      weight:
        0.22,
      direction:
        -1
    },

    "BTC/USD": {
      label:
        "Bitcoin",
      weight:
        0.10,
      direction:
        1
    }
  };


  const markets = [];

  let weightedTotal = 0;
  let activeWeight = 0;


  for (
    const [
      symbol,
      config
    ]
    of
    Object.entries(
      configs
    )
  ) {

    const candles =
      data[symbol];


    if (
      !candles ||
      candles.length < 15
    ) {
      continue;
    }


    const move1 =
      percentageMove(
        candles,
        1
      );

    const move3 =
      percentageMove(
        candles,
        3
      );

    const move6 =
      percentageMove(
        candles,
        6
      );

    const move12 =
      percentageMove(
        candles,
        12
      );


    const combinedMove =

      move1 *
      0.15 +

      move3 *
      0.25 +

      move6 *
      0.25 +

      move12 *
      0.35;


    /*
      This transforms percentage movement into a
      standardized directional score.
    */

    const rawScore =
      clamp(
        combinedMove *
        80,
        -100,
        100
      );


    const goldContribution =
      rawScore *
      config.direction;


    weightedTotal +=
      goldContribution *
      config.weight;


    activeWeight +=
      config.weight;


    markets.push({

      symbol,

      label:
        config.label,

      price:
        round(
          last(
            candles
          ).close,
          symbol ===
          "BTC/USD"
            ? 1
            : 5
        ),

      move1h:
        round(
          move1,
          3
        ),

      move3h:
        round(
          move3,
          3
        ),

      move6h:
        round(
          move6,
          3
        ),

      move12h:
        round(
          move12,
          3
        ),

      goldContribution:
        round(
          goldContribution,
          1
        ),

      goldBias:
        goldContribution >= 15
          ? "BULLISH GOLD"
          : goldContribution <= -15
            ? "BEARISH GOLD"
            : "NEUTRAL"
    });
  }


  const score =
    activeWeight > 0
      ? weightedTotal /
        activeWeight
      : 0;


  const result = {

    score:
      round(
        score,
        1
      ),

    bias:
      score >= 15
        ? "BULLISH"
        : score <= -15
          ? "BEARISH"
          : "NEUTRAL",

    strength:
      Math.abs(
        score
      ) >= 60
        ? "STRONG"
        : Math.abs(
            score
          ) >= 30
          ? "MODERATE"
          : "WEAK",

    markets:
      markets.sort(
        (
          a,
          b
        ) =>
          Math.abs(
            b.goldContribution
          ) -
          Math.abs(
            a.goldContribution
          )
      )
  };


  intermarketCache = {
    time:
      Date.now(),

    value:
      result
  };


  return result;
}


/* ================================================================
   FRED
================================================================ */

async function fredSeries(
  seriesId
) {

  if (
    !FRED_KEY
  ) {
    return [];
  }


  const url =

    `${FRED_BASE}/series/observations` +

    `?series_id=${
      encodeURIComponent(
        seriesId
      )
    }` +

    `&api_key=${
      encodeURIComponent(
        FRED_KEY
      )
    }` +

    `&file_type=json` +

    `&sort_order=desc` +

    `&limit=20`;


  const response =
    await fetch(url);


  if (
    !response.ok
  ) {

    throw new Error(
      `FRED ${seriesId} HTTP ${response.status}`
    );
  }


  const json =
    await response.json();


  return (
    (
      json.observations ||
      []
    )
    .filter(
      row =>
        row.value !== "." &&
        Number.isFinite(
          Number(
            row.value
          )
        )
    )
    .map(
      row => ({
        date:
          row.date,

        value:
          Number(
            row.value
          )
      })
    )
  );
}


function fredChange(
  series
) {

  if (
    !series ||
    series.length < 2
  ) {
    return 0;
  }


  return (
    series[0].value -
    series[1].value
  );
}


async function loadMacro() {

  if (
    macroCache.value &&
    Date.now() -
      macroCache.time <
      MACRO_CACHE_MS
  ) {

    return (
      macroCache.value
    );
  }


  if (
    !FRED_KEY
  ) {

    return {

      enabled:
        false,

      score:
        0,

      bias:
        "NEUTRAL",

      reason:
        "FRED_API_KEY not configured."
    };
  }


  try {

    const [
      twoYear,
      tenYear,
      fedFunds
    ] =
      await Promise.all([

        fredSeries(
          "DGS2"
        ),

        fredSeries(
          "DGS10"
        ),

        fredSeries(
          "FEDFUNDS"
        )
      ]);


    const change2 =
      fredChange(
        twoYear
      );


    const change10 =
      fredChange(
        tenYear
      );


    /*
       Falling yields generally provide support
       for non-yielding gold.
    */

    const score =
      clamp(

        (
          -change2 *
          320
        ) +

        (
          -change10 *
          260
        ),

        -100,
        100
      );


    const result = {

      enabled:
        true,

      score:
        round(
          score,
          1
        ),

      bias:
        score >= 15
          ? "BULLISH GOLD"
          : score <= -15
            ? "BEARISH GOLD"
            : "NEUTRAL",

      twoYear:
        twoYear.length
          ? {

              value:
                round(
                  twoYear[0].value,
                  3
                ),

              change:
                round(
                  change2,
                  3
                ),

              date:
                twoYear[0].date
            }
          : null,

      tenYear:
        tenYear.length
          ? {

              value:
                round(
                  tenYear[0].value,
                  3
                ),

              change:
                round(
                  change10,
                  3
                ),

              date:
                tenYear[0].date
            }
          : null,

      fedFunds:
        fedFunds.length
          ? {

              value:
                round(
                  fedFunds[0].value,
                  3
                ),

              date:
                fedFunds[0].date
            }
          : null
    };


    macroCache = {

      time:
        Date.now(),

      value:
        result
    };


    return result;

  } catch (
    error
  ) {

    return {

      enabled:
        false,

      score:
        0,

      bias:
        "UNAVAILABLE",

      error:
        error.message
    };
  }
}


/* ================================================================
   SECONDARY XAU VALIDATION
================================================================ */

function feedValidation(
  primaryPrice,
  secondaryPrice,
  atrValue
) {

  if (
    !primaryPrice ||
    !secondaryPrice
  ) {

    return {

      available:
        false,

      status:
        "SECONDARY FEED UNAVAILABLE"
    };
  }


  const difference =
    Math.abs(
      primaryPrice -
      secondaryPrice
    );


  const differenceATR =
    atrValue > 0
      ? difference /
        atrValue
      : 0;


  let status =
    "GOOD";


  if (
    differenceATR >
    0.25
  ) {

    status =
      "DISAGREEMENT";

  } else if (
    differenceATR >
    0.10
  ) {

    status =
      "CAUTION";
  }


  return {

    available:
      true,

    status,

    primary:
      round(
        primaryPrice,
        2
      ),

    secondary:
      round(
        secondaryPrice,
        2
      ),

    difference:
      round(
        difference,
        2
      ),

    differenceATR:
      round(
        differenceATR,
        3
      )
  };
}


/* ================================================================
   MARKET REGIME
================================================================ */

function marketRegime(
  candles
) {

  if (
    candles.length < 50
  ) {

    return {
      regime:
        "UNKNOWN",
      volatility:
        "UNKNOWN",
      trendStrength:
        0
    };
  }


  const ranges =
    candles
      .slice(
        -40
      )
      .map(
        candle =>
          candle.high -
          candle.low
      );


  const recent =
    mean(
      ranges.slice(
        -10
      )
    );


  const previous =
    mean(
      ranges.slice(
        -30,
        -10
      )
    );


  let volatility =
    "NORMAL";


  if (
    recent >
    previous *
    1.35
  ) {

    volatility =
      "EXPANDING";

  } else if (
    recent <
    previous *
    0.72
  ) {

    volatility =
      "CONTRACTING";
  }


  const s =
    structure(
      candles
    );


  const closes =
    candles.map(
      candle =>
        candle.close
    );


  const e20 =
    last(
      ema(
        closes,
        20
      )
    );


  const e50 =
    last(
      ema(
        closes,
        50
      )
    );


  const localATR =
    atr(
      candles,
      14
    );


  const trendStrength =
    localATR > 0
      ? Math.abs(
          e20 -
          e50
        ) /
        localATR
      : 0;


  let regime =
    "RANGING";


  if (
    trendStrength >=
    0.7
  ) {

    regime =
      s.bias ===
      "BULLISH"
        ? "TRENDING UP"
        : s.bias ===
          "BEARISH"
          ? "TRENDING DOWN"
          : "TRANSITION";
  }


  return {

    regime,

    volatility,

    trendStrength:
      round(
        trendStrength,
        2
      )
  };
}


/* ================================================================
   HISTORY LOADER — API #3
================================================================ */

async function loadHistory() {

  if (
    historyCache.value &&
    Date.now() -
      historyCache.time <
      HISTORY_CACHE_MS
  ) {

    return (
      historyCache.value
    );
  }


  const candles =
    await tdSeries({

      symbol:
        SYMBOL,

      interval:
        "5min",

      outputsize:
        MAX_HISTORY,

      apiKey:
        KEY_3
    });


  const statistics = {

    ASIA:
      calculateHistoricalSessionStats(
        candles,
        "ASIA"
      ),

    LONDON:
      calculateHistoricalSessionStats(
        candles,
        "LONDON"
      ),

    NEW_YORK:
      calculateHistoricalSessionStats(
        candles,
        "NEW_YORK"
      )
  };


  const result = {

    candles:
      candles.length,

    first:
      candles.length
        ? candles[0].time
        : null,

    last:
      candles.length
        ? last(
            candles
          ).time
        : null,

    statistics
  };


  historyCache = {

    time:
      Date.now(),

    value:
      result
  };


  return result;
}


/* ================================================================
   FINAL CONSENSUS
================================================================ */

function buildConsensus({
  m5,
  m15,
  h1,
  h4,
  liquidityPools,
  intermarket,
  macro,
  delta,
  activeSweep,
  displacementM5,
  feedQuality
}) {

  const s5 =
    structure(
      m5
    );

  const s15 =
    structure(
      m15
    );

  const s1 =
    structure(
      h1
    );

  const s4 =
    structure(
      h4
    );


  let technicalScore =

    s5.score *
      9 +

    s15.score *
      14 +

    s1.score *
      18 +

    s4.score *
      21;


  technicalScore =
    clamp(
      technicalScore,
      -100,
      100
    );


  const target =
    liquidityPools.length
      ? liquidityPools[0]
      : null;


  let liquidityDirectional =
    0;


  if (
    target
  ) {

    const direction =
      target.side ===
      "BUY_SIDE"
        ? 1
        : -1;


    liquidityDirectional =
      (
        target.liquidityStrength *
        0.50 +

        target.raidStrength *
        0.50
      ) *
      direction;
  }


  let deltaDirectional =
    0;


  if (
    delta.bias ===
    "BUYING PRESSURE"
  ) {

    deltaDirectional =
      clamp(
        Math.abs(
          delta.delta
        ) /
        8,
        0,
        100
      );

  } else if (
    delta.bias ===
    "SELLING PRESSURE"
  ) {

    deltaDirectional =
      -clamp(
        Math.abs(
          delta.delta
        ) /
        8,
        0,
        100
      );
  }


  let sweepAdjustment =
    0;


  if (
    activeSweep
  ) {

    /*
      Buy-side sweep + rejection can favor downside reversal.
      Sell-side sweep + rejection can favor upside reversal.
    */

    sweepAdjustment =

      activeSweep.direction ===
      "BUY_SIDE_SWEEP"
        ? -18
        : 18;
  }


  let displacementAdjustment =
    0;


  if (
    displacementM5.active
  ) {

    displacementAdjustment =

      displacementM5.direction ===
      "BULLISH"
        ? displacementM5.strength *
          0.20
        : -displacementM5.strength *
          0.20;
  }


  let qualityPenalty =
    0;


  if (
    feedQuality.status ===
    "DISAGREEMENT"
  ) {

    qualityPenalty =
      20;
  }


  const raw =

    technicalScore *
      0.28 +

    liquidityDirectional *
      0.25 +

    intermarket.score *
      0.20 +

    (
      macro.score || 0
    ) *
      0.11 +

    deltaDirectional *
      0.08 +

    sweepAdjustment +

    displacementAdjustment;


  const score =
    clamp(
      raw,
      -100,
      100
    );


  const direction =
    score >= 20
      ? "BULLISH"
      : score <= -20
        ? "BEARISH"
        : "NEUTRAL";


  const baseConfidence =
    Math.abs(
      score
    );


  const confidence =
    clamp(
      baseConfidence -
      qualityPenalty,
      0,
      100
    );


  const reasons = [];


  reasons.push(
    `M5 ${s5.bias}`
  );

  reasons.push(
    `M15 ${s15.bias}`
  );

  reasons.push(
    `H1 ${s1.bias}`
  );

  reasons.push(
    `H4 ${s4.bias}`
  );


  if (
    target
  ) {

    reasons.push(
      `Top liquidity: ${target.name} ${target.raidStrength}/100 raid strength`
    );
  }


  reasons.push(
    `Intermarket ${intermarket.bias} ${intermarket.score}`
  );


  if (
    macro.enabled
  ) {

    reasons.push(
      `Macro ${macro.bias} ${macro.score}`
    );
  }


  if (
    delta.divergence
  ) {

    reasons.push(
      delta.divergence
    );
  }


  if (
    delta.absorption
  ) {

    reasons.push(
      delta.absorption
    );
  }


  if (
    activeSweep
  ) {

    reasons.push(
      `${activeSweep.pool} sweep detected`
    );
  }


  return {

    direction,

    score:
      round(
        score,
        1
      ),

    confidence:
      round(
        confidence,
        1
      ),

    components: {

      technical:
        round(
          technicalScore,
          1
        ),

      liquidity:
        round(
          liquidityDirectional,
          1
        ),

      intermarket:
        round(
          intermarket.score,
          1
        ),

      macro:
        round(
          macro.score || 0,
          1
        ),

      flow:
        round(
          deltaDirectional,
          1
        ),

      sweep:
        round(
          sweepAdjustment,
          1
        ),

      displacement:
        round(
          displacementAdjustment,
          1
        )
    },

    dominantLiquidityTarget:
      target,

    reasons
  };
}


/* ================================================================
   MAIN ENGINE
================================================================ */

async function buildIntelligence() {

  if (
    liveCache.value &&
    Date.now() -
      liveCache.time <
      LIVE_CACHE_MS
  ) {

    return {

      ...liveCache.value,

      cached:
        true
    };
  }


  if (
    !KEY_1
  ) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }


  /*
    LIVE XAU DATA

    Key 1:
    M1 / M5

    Key 2:
    M15 / H1 / H4
  */

  const [

    m1,
    m5,
    m15,
    h1,
    h4,
    primaryQuote,

    history,
    intermarket,
    macro,

    secondaryQuote

  ] =
    await Promise.all([

      tdSeries({
        symbol:
          SYMBOL,
        interval:
          "1min",
        outputsize:
          500,
        apiKey:
          KEY_1
      }),

      tdSeries({
        symbol:
          SYMBOL,
        interval:
          "5min",
        outputsize:
          1200,
        apiKey:
          KEY_1
      }),

      tdSeries({
        symbol:
          SYMBOL,
        interval:
          "15min",
        outputsize:
          700,
        apiKey:
          KEY_2
      }),

      tdSeries({
        symbol:
          SYMBOL,
        interval:
          "1h",
        outputsize:
          600,
        apiKey:
          KEY_2
      }),

      tdSeries({
        symbol:
          SYMBOL,
        interval:
          "4h",
        outputsize:
          400,
        apiKey:
          KEY_2
      }),

      tdQuote({
        symbol:
          SYMBOL,
        apiKey:
          KEY_1
      })
      .catch(
        () => null
      ),

      loadHistory(),

      loadIntermarket(),

      loadMacro(),

      tdQuote({
        symbol:
          SYMBOL,
        apiKey:
          KEY_4
      })
      .catch(
        () => null
      )
    ]);


  const candlePrice =
    last(
      m1
    )?.close ||
    last(
      m5
    )?.close ||
    0;


  const price =
    primaryQuote?.price ||
    candlePrice;


  const atrM1 =
    atr(
      m1,
      14
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


  const sessions =
    currentSessions(
      m5
    );


  const pd =
    previousDayLevels(
      m5
    );


  const pw =
    previousWeekLevels(
      m5
    );


  const equalLevels =
    detectEqualLevels(
      m5,
      atrM5
    );


  const fvgs =
    fairValueGaps(
      m15,
      10
    );


  const statistics =
    history.statistics;


  const liquidityPools =
    buildLiquidityPools({

      price,

      atrValue:
        atrM5,

      sessions,

      previousDay:
        pd,

      previousWeek:
        pw,

      h1,

      equalLevels,

      statistics
    });


  const delta =
    deltaEngine(
      m1
    );


  const activeSweep =
    detectActiveSweep(
      m5,
      liquidityPools,
      atrM5
    );


  const trapWindows =
    buildTrapWindows({

      price,

      atrValue:
        atrM5,

      pools:
        liquidityPools,

      fvgs
    });


  const displacementM1 =
    displacement(
      m1
    );


  const displacementM5 =
    displacement(
      m5
    );


  const feedQuality =
    feedValidation(

      price,

      secondaryQuote?.price,

      atrM5
    );


  const regime =
    marketRegime(
      m5
    );


  const consensus =
    buildConsensus({

      m5,
      m15,
      h1,
      h4,

      liquidityPools,

      intermarket,

      macro,

      delta,

      activeSweep,

      displacementM5,

      feedQuality
    });


  const rsiM1 =
    rsi(
      m1,
      14
    );


  const rsiM5 =
    rsi(
      m5,
      14
    );


  const rsiM15 =
    rsi(
      m15,
      14
    );


  const macdM5 =
    macd(
      m5
    );


  const macdM15 =
    macd(
      m15
    );


  const vwap =
    vwapProxy(
      m5,
      150
    );


  const structureData = {

    M1:
      structure(
        m1
      ),

    M5:
      structure(
        m5
      ),

    M15:
      structure(
        m15
      ),

    H1:
      structure(
        h1
      ),

    H4:
      structure(
        h4
      )
  };


  const nearestBuySide =
    liquidityPools
      .filter(
        pool =>
          pool.side ===
          "BUY_SIDE" &&
          pool.level >
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


  const nearestSellSide =
    liquidityPools
      .filter(
        pool =>
          pool.side ===
          "SELL_SIDE" &&
          pool.level <
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


  const response = {

    ok:
      true,

    engine:
      "MKAYFX GOLD LIQUIDITY INTELLIGENCE V7",

    symbol:
      SYMBOL,

    generatedAt:
      new Date()
        .toISOString(),

    cached:
      false,


    apiArchitecture: {

      api1:
        "XAU M1 / M5",

      api2:
        "XAU M15 / H1 / H4",

      api3:
        "XAU historical liquidity statistics",

      api4:
        "XAG + EURUSD + GBPUSD + USDJPY + BTCUSD + secondary XAU",

      fred:
        "US yields and macro"
    },


    market: {

      price:
        round(
          price,
          2
        ),

      previousClose:
        round(
          primaryQuote?.previousClose,
          2
        ),

      change:
        round(
          primaryQuote?.change,
          2
        ),

      percentChange:
        round(
          primaryQuote?.percentChange,
          3
        ),

      atr: {

        M1:
          round(
            atrM1,
            2
          ),

        M5:
          round(
            atrM5,
            2
          ),

        M15:
          round(
            atrM15,
            2
          )
      },

      rsi: {

        M1:
          round(
            rsiM1,
            1
          ),

        M5:
          round(
            rsiM5,
            1
          ),

        M15:
          round(
            rsiM15,
            1
          )
      },

      macd: {

        M5: {
          macd:
            round(
              macdM5.macd,
              3
            ),

          signal:
            round(
              macdM5.signal,
              3
            ),

          histogram:
            round(
              macdM5.histogram,
              3
            )
        },

        M15: {
          macd:
            round(
              macdM15.macd,
              3
            ),

          signal:
            round(
              macdM15.signal,
              3
            ),

          histogram:
            round(
              macdM15.histogram,
              3
            )
        }
      },

      rocM5:
        round(
          roc(
            m5,
            10
          ),
          3
        ),

      vwap:
        round(
          vwap,
          2
        ),

      vwapPosition:
        price >
        vwap
          ? "ABOVE VWAP"
          : price <
            vwap
            ? "BELOW VWAP"
            : "AT VWAP",

      regime
    },


    dataQuality:
      feedQuality,


    sessions,


    previousDay:
      pd,


    previousWeek:
      pw,


    structure:
      structureData,


    displacement: {

      M1:
        displacementM1,

      M5:
        displacementM5
    },


    liquidity: {

      nearestBuySide,

      nearestSellSide,

      dominant:
        liquidityPools[0] ||
        null,

      pools:
        liquidityPools,

      activeSweep
    },


    equalLevels,


    fairValueGaps:
      fvgs,


    flow: {

      ...delta,

      note:
        "Derived candle/volume proxy — not true exchange bid/ask footprint."
    },


    historicalLiquidity: {

      candleCount:
        history.candles,

      firstTimestamp:
        history.first,

      lastTimestamp:
        history.last,

      sessions:
        statistics
    },


    trapWindows,


    intermarket,


    macro,


    consensus,


    health: {

      key1:
        Boolean(
          KEY_1
        ),

      key2:
        Boolean(
          KEY_2
        ),

      key3:
        Boolean(
          KEY_3
        ),

      key4:
        Boolean(
          KEY_4
        ),

      fred:
        Boolean(
          FRED_KEY
        )
    }
  };


  liveCache = {

    time:
      Date.now(),

    value:
      response
  };


  return response;
}


/* ================================================================
   HANDLER
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


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return (
      res
        .status(204)
        .end()
    );
  }


  if (
    req.method !==
    "GET"
  ) {

    return (
      res
        .status(405)
        .json({
          ok:
            false,

          error:
            "Method not allowed."
        })
    );
  }


  try {

    const result =
      await buildIntelligence();


    return (
      res
        .status(200)
        .json(
          result
        )
    );

  } catch (
    error
  ) {

    console.error(
      "XAU ENGINE ERROR:",
      error
    );


    return (
      res
        .status(500)
        .json({

          ok:
            false,

          engine:
            "MKAYFX GOLD LIQUIDITY INTELLIGENCE V7",

          error:
            error?.message ||
            "Unknown server error.",

          generatedAt:
            new Date()
              .toISOString()
        })
    );
  }
}