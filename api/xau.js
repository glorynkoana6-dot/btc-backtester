/* ================================================================
   MKAYFX GOLD LIQUIDITY INTELLIGENCE ENGINE V7.1
   ---------------------------------------------------------------
   /api/xau.js

   DATA ARCHITECTURE
   ---------------------------------------------------------------
   API #1
   TWELVE_DATA_API_KEY
   → XAU/USD M1 + M5
   → live/execution intelligence

   API #2
   TWELVE_DATA_API_KEY_2
   → XAU/USD M15 + H1 + H4
   → higher-timeframe structure

   API #3
   TWELVE_DATA_API_KEY_3
   → XAU/USD historical M5
   → session/sweep statistics

   API #4
   TWELVE_DATA_API_KEY_4
   → XAG/USD
   → EUR/USD
   → GBP/USD
   → USD/JPY
   → BTC/USD
   → secondary XAU quote verification

   FRED
   FRED_API_KEY
   → US 2Y
   → US 10Y
   → Fed Funds

   FEATURES
   ---------------------------------------------------------------
   • XAU price
   • ATR
   • RSI
   • MACD
   • ROC
   • EMA20 / EMA50
   • VWAP proxy
   • MTF structure
   • BOS
   • CHOCH
   • displacement
   • Asia / London / New York sessions
   • PDH / PDL
   • PWH / PWL
   • H1 swing liquidity
   • equal highs / equal lows
   • M15 FVG
   • liquidity strength
   • raid strength
   • projected raid zones
   • historical sweep probability
   • return probability
   • median/P75/P90 raid depth
   • sample confidence
   • active sweeps
   • delta proxy
   • CVD proxy
   • absorption proxy
   • delta divergence
   • trap windows
   • intermarket confirmation
   • FRED macro pressure
   • secondary price validation
   • final consensus model

   NOTE
   ---------------------------------------------------------------
   Spot XAU volume is not centralized exchange order flow.
   Delta/CVD/absorption are proxies derived from candle activity.
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
   HELPERS
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

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
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
    [...values].sort(
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
    [...values].sort(
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

  if (
    lower === upper
  ) {
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

  const temp =
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      )
    );

  const day =
    temp.getUTCDay() || 7;

  temp.setUTCDate(
    temp.getUTCDate() +
    4 -
    day
  );

  const yearStart =
    new Date(
      Date.UTC(
        temp.getUTCFullYear(),
        0,
        1
      )
    );

  const week =
    Math.ceil(
      (
        (
          temp -
          yearStart
        ) /
        86400000 +
        1
      ) /
      7
    );

  return (
    `${temp.getUTCFullYear()}-W${String(
      week
    ).padStart(
      2,
      "0"
    )}`
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

  return (
    array[
      array.length - 1
    ]
  );
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

          const raw =
            String(
              item.datetime
            );

          const formatted =
            raw.includes("T")
              ? raw
              : raw.replace(
                  " ",
                  "T"
                );

          const time =
            Date.parse(
              formatted.endsWith("Z")
                ? formatted
                : formatted + "Z"
            );


          return {

            time,

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
      "Twelve Data API key missing."
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
            "MKAYFX-V7"
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
      "Twelve Data error"
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

  if (!apiKey) {
    return null;
  }


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
      `Quote HTTP ${response.status}`
    );
  }


  const json =
    await response.json();


  if (
    json.status === "error"
  ) {

    throw new Error(
      json.message ||
      "Quote error"
    );
  }


  return {

    symbol,

    price:
      safeNumber(
        json.close ||
        json.price
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
      )
  };
}


/* ================================================================
   EMA
================================================================ */

function ema(
  values,
  period
) {

  if (!values.length) {
    return [];
  }


  const k =
    2 /
    (
      period +
      1
    );


  let current =
    values[0];


  const output = [];


  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    if (
      i === 0
    ) {

      current =
        values[i];

    } else {

      current =
        values[i] *
        k +
        current *
        (
          1 -
          k
        );
    }


    output.push(
      current
    );
  }


  return output;
}


/* ================================================================
   ATR
================================================================ */

function atrSeries(
  candles,
  period = 14
) {

  if (
    candles.length < 2
  ) {
    return [];
  }


  const ranges = [
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


    ranges.push(

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


  return (
    ema(
      ranges,
      period
    )
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


  const averageGain =
    gains /
    period;

  const averageLoss =
    losses /
    period;


  if (
    averageLoss === 0
  ) {
    return 100;
  }


  const rs =
    averageGain /
    averageLoss;


  return (
    100 -
    100 /
    (
      1 +
      rs
    )
  );
}


/* ================================================================
   MACD
================================================================ */

function macd(
  candles
) {

  if (
    candles.length < 35
  ) {

    return {
      macd: 0,
      signal: 0,
      histogram: 0
    };
  }


  const closes =
    candles.map(
      candle =>
        candle.close
    );


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


  const line =
    closes.map(
      (_, index) =>
        fast[index] -
        slow[index]
    );


  const signal =
    ema(
      line,
      9
    );


  return {

    macd:
      last(line),

    signal:
      last(signal),

    histogram:
      last(line) -
      last(signal)
  };
}


/* ================================================================
   ROC
================================================================ */

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


  const current =
    last(candles).close;


  const previous =
    candles[
      candles.length -
      lookback -
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


/* ================================================================
   VWAP PROXY
================================================================ */

function vwapProxy(
  candles,
  lookback = 150
) {

  const data =
    candles.slice(
      -lookback
    );


  if (!data.length) {
    return 0;
  }


  let total =
    0;

  let totalVolume =
    0;


  for (
    const candle
    of data
  ) {

    const typicalPrice =
      (
        candle.high +
        candle.low +
        candle.close
      ) /
      3;


    const volume =
      candle.volume > 0
        ? candle.volume
        : Math.max(
            candle.high -
            candle.low,
            0.0001
          );


    total +=
      typicalPrice *
      volume;

    totalVolume +=
      volume;
  }


  return (
    totalVolume
      ? total /
        totalVolume
      : last(data).close
  );
}


/* ================================================================
   PIVOTS
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


  const level =
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
      level
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


  const level =
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
      level
    ) {
      return false;
    }
  }


  return true;
}


/* ================================================================
   SWINGS
================================================================ */

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
    i <
      data.length - 3;
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


/* ================================================================
   STRUCTURE
================================================================ */

function structure(
  candles
) {

  if (
    candles.length < 55
  ) {

    return {

      bias:
        "NEUTRAL",

      score:
        0,

      ema20:
        null,

      ema50:
        null,

      bos:
        null,

      choch:
        null,

      lastSwingHigh:
        null,

      lastSwingLow:
        null
    };
  }


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


  const price =
    last(candles).close;


  const swingData =
    swings(
      candles,
      120
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
    e20
  ) {

    score++;

  } else {

    score--;
  }


  if (
    e20 >
    e50
  ) {

    score++;

  } else {

    score--;
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
        e20,
        2
      ),

    ema50:
      round(
        e50,
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

      active:
        false,

      direction:
        null,

      strength:
        0
    };
  }


  const previousRanges =
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


  const averageRange =
    mean(
      previousRanges
    );


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
      ? body /
        range
      : 0;


  const expansion =
    averageRange > 0
      ? range /
        averageRange
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
   SESSIONS
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
      last(data).close,

    startTime:
      data[0].time,

    endTime:
      last(data).time,

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


  const day =
    isoDay(
      last(candles).time
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
        day,
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
   PREVIOUS DAY
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


  const day =
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
        day
    );


  if (!data.length) {
    return null;
  }


  return {

    date:
      day,

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
   PREVIOUS WEEK
================================================================ */

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


  const week =
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
        week
    );


  if (!data.length) {
    return null;
  }


  return {

    week,

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
      180
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
            round(
              (
                first.price +
                second.price
              ) /
              2,
              2
            ),

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
            round(
              (
                first.price +
                second.price
              ) /
              2,
              2
            ),

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
      equalHighs.slice(
        -5
      ),

    lows:
      equalLows.slice(
        -5
      )
  };
}


/* ================================================================
   FAIR VALUE GAPS
================================================================ */

function fairValueGaps(
  candles,
  maxResults = 10
) {

  const gaps = [];


  for (
    let i = 2;
    i <
      candles.length;
    i++
  ) {

    const first =
      candles[
        i - 2
      ];

    const third =
      candles[i];


    if (
      third.low >
      first.high
    ) {

      gaps.push({

        direction:
          "BULLISH",

        low:
          round(
            first.high,
            2
          ),

        high:
          round(
            third.low,
            2
          ),

        midpoint:
          round(
            (
              first.high +
              third.low
            ) /
            2,
            2
          ),

        time:
          third.time
      });
    }


    if (
      third.high <
      first.low
    ) {

      gaps.push({

        direction:
          "BEARISH",

        low:
          round(
            third.high,
            2
          ),

        high:
          round(
            first.low,
            2
          ),

        midpoint:
          round(
            (
              third.high +
              first.low
            ) /
            2,
            2
          ),

        time:
          third.time
      });
    }
  }


  return (
    gaps.slice(
      -maxResults
    )
  );
}


/* ================================================================
   DELTA / CVD PROXY
================================================================ */

function deltaEngine(
  candles
) {

  if (!candles.length) {

    return {

      delta:
        0,

      cvd:
        0,

      bias:
        "BALANCED",

      absorption:
        null,

      divergence:
        null
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


    const location =
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
        location *
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


  const recentDelta =
    recent.reduce(
      (
        sum,
        row
      ) =>
        sum +
        row.delta,
      0
    );


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


  let absorption =
    null;


  if (
    avgRange > 0
  ) {

    const expansion =
      lastRow.range /
      avgRange;


    if (
      expansion >= 1.25 &&
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


  let divergence =
    null;


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
        recentDelta,
        2
      ),

    cvd:
      round(
        cvd,
        2
      ),

    bias:
      recentDelta > 0
        ? "BUYING PRESSURE"
        : recentDelta < 0
          ? "SELLING PRESSURE"
          : "BALANCED",

    absorption,

    divergence
  };
}


/* ================================================================
   HISTORICAL SESSION STATS
================================================================ */

function historicalSessionStats(
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


    const before =
      candles.filter(
        candle =>
          candle.time <=
          session.endTime
      );


    const localATR =
      atr(
        before.slice(
          -100
        ),
        14
      );


    if (
      !localATR ||
      localATR <= 0
    ) {
      continue;
    }


    samples++;


    const futureHigh =
      Math.max(
        ...future.map(
          candle =>
            candle.high
        )
      );


    const futureLow =
      Math.min(
        ...future.map(
          candle =>
            candle.low
        )
      );


    if (
      futureHigh >
      session.high
    ) {

      highSweeps++;


      const raid =
        (
          futureHigh -
          session.high
        ) /
        localATR;


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
      futureLow <
      session.low
    ) {

      lowSweeps++;


      const raid =
        (
          session.low -
          futureLow
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
      samples
        ? swept /
          samples *
          100
        : 0;


    const returnRate =
      swept
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
   HISTORICAL LOADER
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

    statistics: {

      ASIA:
        historicalSessionStats(
          candles,
          "ASIA"
        ),

      LONDON:
        historicalSessionStats(
          candles,
          "LONDON"
        ),

      NEW_YORK:
        historicalSessionStats(
          candles,
          "NEW_YORK"
        )
    }
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
        Number(level)
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


    const proximity =
      clamp(
        100 -
        distanceATR *
        18,
        0,
        100
      );


    const validDirection =
      side === "BUY_SIDE"
        ? (
            numericLevel >
            price
              ? 100
              : 30
          )
        : (
            numericLevel <
            price
              ? 100
              : 30
          );


    const sweepProbability =
      historical?.sweepRate ??
      40;


    const returnProbability =
      historical?.returnRate ??
      50;


    const sampleFactor =
      historical
        ? clamp(
            historical.samples /
            40,
            0.35,
            1
          )
        : 0.55;


    const historicalScore =
      (
        sweepProbability *
        0.65 +
        returnProbability *
        0.35
      ) *
      sampleFactor;


    const liquidityStrength =
      clamp(

        baseStrength *
          0.30 +

        historicalScore *
          0.30 +

        proximity *
          0.25 +

        validDirection *
          0.15,

        0,
        100
      );


    const raidStrength =
      clamp(

        sweepProbability *
          0.40 +

        proximity *
          0.30 +

        returnProbability *
          0.15 +

        baseStrength *
          0.15,

        0,
        100
      );


    const raidATR =
      historical?.medianRaidATR ??
      0.25;


    let zoneLow =
      numericLevel;

    let zoneHigh =
      numericLevel;


    if (
      side ===
      "BUY_SIDE"
    ) {

      zoneHigh =
        numericLevel +
        raidATR *
        atrValue;

    } else {

      zoneLow =
        numericLevel -
        raidATR *
        atrValue;
    }


    pools.push({

      name,
      side,
      type,

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
          sweepProbability,
          1
        ),

      returnProbability:
        round(
          returnProbability,
          1
        ),

      projectedRaidATR:
        round(
          raidATR,
          2
        ),

      projectedZone: {

        low:
          round(
            zoneLow,
            2
          ),

        high:
          round(
            zoneHigh,
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
      160
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


  const ordered =
    pools.sort(
      (
        a,
        b
      ) =>

        (
          b.liquidityStrength +
          b.raidStrength
        ) -

        (
          a.liquidityStrength +
          a.raidStrength
        )
    );


  const filtered = [];


  for (
    const pool
    of ordered
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


    if (!duplicate) {
      filtered.push(
        pool
      );
    }
  }


  return (
    filtered.slice(
      0,
      20
    )
  );
}


/* ================================================================
   ACTIVE SWEEP
================================================================ */

function detectActiveSweep(
  candles,
  pools,
  atrValue
) {

  if (
    candles.length < 3
  ) {
    return null;
  }


  const current =
    last(candles);


  const previous =
    candles[
      candles.length -
      2
    ];


  for (
    const pool
    of pools
  ) {

    if (
      pool.side ===
      "BUY_SIDE"
    ) {

      if (
        previous.close <
          pool.level &&
        current.high >
          pool.level &&
        current.close <
          pool.level
      ) {

        return {

          pool:
            pool.name,

          direction:
            "BUY_SIDE_SWEEP",

          level:
            pool.level,

          raidDepth:
            round(
              current.high -
              pool.level,
              2
            ),

          raidATR:
            round(
              atrValue > 0
                ? (
                    current.high -
                    pool.level
                  ) /
                  atrValue
                : 0,
              2
            ),

          rejection:
            true
        };
      }

    } else {

      if (
        previous.close >
          pool.level &&
        current.low <
          pool.level &&
        current.close >
          pool.level
      ) {

        return {

          pool:
            pool.name,

          direction:
            "SELL_SIDE_SWEEP",

          level:
            pool.level,

          raidDepth:
            round(
              pool.level -
              current.low,
              2
            ),

          raidATR:
            round(
              atrValue > 0
                ? (
                    pool.level -
                    current.low
                  ) /
                  atrValue
                : 0,
              2
            ),

          rejection:
            true
        };
      }
    }
  }


  return null;
}


/* ================================================================
   TRAP WINDOWS
================================================================ */

function buildTrapWindows({
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


    const fvg =
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

      nearbyFVG:
        Boolean(
          fvg
        ),

      score:
        round(
          clamp(

            pool.raidStrength *
              0.55 +

            pool.liquidityStrength *
              0.35 +

            (
              fvg
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
   INTERMARKET
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


  const fetched =
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
        fetched[index];
    }
  );


  const settings = {

    "XAG/USD": {
      label:
        "SILVER",
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
        "BITCOIN",
      weight:
        0.10,
      direction:
        1
    }
  };


  let total =
    0;

  let totalWeight =
    0;


  const markets = [];


  for (
    const [
      symbol,
      config
    ]
    of
    Object.entries(
      settings
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


    const momentum =

      move1 *
        0.15 +

      move3 *
        0.25 +

      move6 *
        0.25 +

      move12 *
        0.35;


    const normalized =
      clamp(
        momentum *
        80,
        -100,
        100
      );


    const contribution =
      normalized *
      config.direction;


    total +=
      contribution *
      config.weight;


    totalWeight +=
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
          contribution,
          1
        ),

      goldBias:
        contribution >= 15
          ? "BULLISH GOLD"
          : contribution <= -15
            ? "BEARISH GOLD"
            : "NEUTRAL"
    });
  }


  const score =
    totalWeight > 0
      ? total /
        totalWeight
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

    markets
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

  if (!FRED_KEY) {
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


  if (!response.ok) {

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


  if (!FRED_KEY) {

    return {

      enabled:
        false,

      score:
        0,

      bias:
        "NEUTRAL"
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
   FEED VALIDATION
================================================================ */

function feedValidation(
  primary,
  secondary,
  atrValue
) {

  if (
    !primary ||
    !secondary
  ) {

    return {

      available:
        false,

      status:
        "SECONDARY UNAVAILABLE"
    };
  }


  const difference =
    Math.abs(
      primary -
      secondary
    );


  const ratio =
    atrValue > 0
      ? difference /
        atrValue
      : 0;


  let status =
    "GOOD";


  if (
    ratio > 0.25
  ) {

    status =
      "DISAGREEMENT";

  } else if (
    ratio > 0.10
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
        primary,
        2
      ),

    secondary:
      round(
        secondary,
        2
      ),

    difference:
      round(
        difference,
        2
      ),

    differenceATR:
      round(
        ratio,
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


  const bias =
    structure(
      candles
    ).bias;


  let regime =
    "RANGING";


  if (
    trendStrength >=
    0.7
  ) {

    regime =
      bias === "BULLISH"
        ? "TRENDING UP"
        : bias === "BEARISH"
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
   CONSENSUS MODEL
================================================================ */

function buildConsensus({
  m5,
  m15,
  h1,
  h4,
  pools,
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


  let technical =

    s5.score *
      9 +

    s15.score *
      14 +

    s1.score *
      18 +

    s4.score *
      21;


  technical =
    clamp(
      technical,
      -100,
      100
    );


  const dominant =
    pools[0] ||
    null;


  let liquidity =
    0;


  if (
    dominant
  ) {

    const direction =
      dominant.side ===
      "BUY_SIDE"
        ? 1
        : -1;


    liquidity =
      (
        dominant.liquidityStrength *
        0.50 +

        dominant.raidStrength *
        0.50
      ) *
      direction;
  }


  let flow =
    0;


  if (
    delta.bias ===
    "BUYING PRESSURE"
  ) {

    flow =
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

    flow =
      -clamp(
        Math.abs(
          delta.delta
        ) /
        8,
        0,
        100
      );
  }


  let sweep =
    0;


  if (
    activeSweep
  ) {

    sweep =
      activeSweep.direction ===
      "BUY_SIDE_SWEEP"
        ? -18
        : 18;
  }


  let displacementScore =
    0;


  if (
    displacementM5.active
  ) {

    displacementScore =
      displacementM5.direction ===
      "BULLISH"
        ? displacementM5.strength *
          0.20
        : -displacementM5.strength *
          0.20;
  }


  const rawScore =

    technical *
      0.28 +

    liquidity *
      0.25 +

    intermarket.score *
      0.20 +

    (
      macro.score ||
      0
    ) *
      0.11 +

    flow *
      0.08 +

    sweep +

    displacementScore;


  const score =
    clamp(
      rawScore,
      -100,
      100
    );


  const direction =
    score >= 20
      ? "BULLISH"
      : score <= -20
        ? "BEARISH"
        : "NEUTRAL";


  let confidence =
    Math.abs(
      score
    );


  if (
    feedQuality.status ===
    "DISAGREEMENT"
  ) {

    confidence -=
      20;
  }


  confidence =
    clamp(
      confidence,
      0,
      100
    );


  const reasons = [

    `M5 ${s5.bias}`,
    `M15 ${s15.bias}`,
    `H1 ${s1.bias}`,
    `H4 ${s4.bias}`,
    `Intermarket ${intermarket.bias} ${intermarket.score}`
  ];


  if (
    dominant
  ) {

    reasons.push(
      `Top liquidity ${dominant.name} | raid ${dominant.raidStrength}/100`
    );
  }


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
      `${activeSweep.pool} sweep/rejection`
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
          technical,
          1
        ),

      liquidity:
        round(
          liquidity,
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
          flow,
          1
        ),

      sweep:
        round(
          sweep,
          1
        ),

      displacement:
        round(
          displacementScore,
          1
        )
    },

    dominantLiquidityTarget:
      dominant,

    reasons
  };
}


/* ================================================================
   MAIN
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


  if (!KEY_1) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }


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


  const fallbackPrice =
    last(m1)?.close ||
    last(m5)?.close ||
    0;


  const price =
    primaryQuote?.price ||
    fallbackPrice;


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


  const previousDay =
    previousDayLevels(
      m5
    );


  const previousWeek =
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


  const pools =
    buildLiquidityPools({

      price,

      atrValue:
        atrM5,

      sessions,

      previousDay,

      previousWeek,

      h1,

      equalLevels,

      statistics:
        history.statistics
    });


  const activeSweep =
    detectActiveSweep(
      m5,
      pools,
      atrM5
    );


  const delta =
    deltaEngine(
      m1
    );


  const traps =
    buildTrapWindows({

      atrValue:
        atrM5,

      pools,

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


  const vwap =
    vwapProxy(
      m5,
      150
    );


  const macdM5 =
    macd(
      m5
    );


  const macdM15 =
    macd(
      m15
    );


  const structures = {

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


  const consensus =
    buildConsensus({

      m5,
      m15,
      h1,
      h4,

      pools,

      intermarket,

      macro,

      delta,

      activeSweep,

      displacementM5,

      feedQuality
    });


  const nearestBuySide =
    pools
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
    pools
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


  const result = {

    ok:
      true,

    engine:
      "MKAYFX GOLD LIQUIDITY INTELLIGENCE V7.1",

    symbol:
      SYMBOL,

    generatedAt:
      new Date()
        .toISOString(),

    cached:
      false,


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
            rsi(
              m1,
              14
            ),
            1
          ),

        M5:
          round(
            rsi(
              m5,
              14
            ),
            1
          ),

        M15:
          round(
            rsi(
              m15,
              14
            ),
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


    previousDay,


    previousWeek,


    structure:
      structures,


    displacement: {

      M1:
        displacementM1,

      M5:
        displacementM5
    },


    liquidity: {

      dominant:
        pools[0] ||
        null,

      nearestBuySide,

      nearestSellSide,

      activeSweep,

      pools
    },


    equalLevels,


    fairValueGaps:
      fvgs,


    flow: {

      ...delta,

      note:
        "Candle/volume proxy, not exchange bid/ask footprint."
    },


    historicalLiquidity: {

      candleCount:
        history.candles,

      firstTimestamp:
        history.first,

      lastTimestamp:
        history.last,

      sessions:
        history.statistics
    },


    trapWindows:
      traps,


    intermarket,


    macro,


    consensus,


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
        "US 2Y / US 10Y / Fed Funds"
    },


    health: {

      api1:
        Boolean(
          KEY_1
        ),

      api2:
        Boolean(
          KEY_2
        ),

      api3:
        Boolean(
          KEY_3
        ),

      api4:
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
      result
  };


  return result;
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
            "Method not allowed"
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
      "MKAYFX XAU ERROR:",
      error
    );


    return (
      res
        .status(500)
        .json({

          ok:
            false,

          engine:
            "MKAYFX GOLD LIQUIDITY INTELLIGENCE V7.1",

          error:
            error?.message ||
            "Unknown server error",

          generatedAt:
            new Date()
              .toISOString()
        })
    );
  }
}