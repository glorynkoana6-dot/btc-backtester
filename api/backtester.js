/* ============================================================
   MKAYFX BTC LIQUIDITY BACKTESTER V4
   /api/backtest.js

   MARKET
   ------
   BTC-USD

   DATA
   ----
   Coinbase historical M5 candles

   IMPORTANT BACKTEST RULES
   ------------------------
   - No future candle information used for entry
   - Signal calculated after M5 candle CLOSE
   - Entry occurs at NEXT M5 candle OPEN
   - One trade at a time
   - Conservative SL-first assumption if TP and SL
     are both touched in the same candle
   - Historical order-book data is NOT faked
   - Historical delta uses volume/price-action proxy

   QUERY EXAMPLES
   --------------
   /api/backtest

   /api/backtest?days=7

   /api/backtest?days=14&rr=2

   /api/backtest?days=14&rr=2.5&minScore=55

   /api/backtest?days=30&rr=2&minScore=52

   OPTIONAL
   --------
   equity=200
   risk=1

============================================================ */


const PRODUCT =
  "BTC-USD";


const BASE_URL =
  "https://api.exchange.coinbase.com";


const GRANULARITY =
  300;


const SETTINGS = {

  DEFAULT_DAYS:
    14,

  MAX_DAYS:
    30,

  DEFAULT_RR:
    2,

  DEFAULT_MIN_SCORE:
    54,

  MIN_SCORE_GAP:
    5,

  ATR_PERIOD:
    14,

  STOP_ATR:
    0.50,

  VOLUME_LOOKBACK:
    20,

  SWING_STRENGTH:
    2,

  ROUND_STEP:
    1000,

  MAJOR_ROUND_STEP:
    5000,

  MAX_LIQUIDITY_DISTANCE_ATR:
    2.2,

  MAX_HOLD_BARS:
    72,

  COOLDOWN_BARS:
    2,

  CHUNK_CANDLES:
    280

};


/* ============================================================
   HELPERS
============================================================ */

function num(v, fallback = 0) {

  const n =
    Number(v);


  return Number.isFinite(n)
    ? n
    : fallback;

}


function round(v, digits = 2) {

  if (
    v === null ||
    v === undefined ||
    !Number.isFinite(Number(v))
  ) {

    return null;

  }


  const p =
    10 ** digits;


  return Math.round(
    Number(v) * p
  ) / p;

}


function average(values) {

  if (!values.length) {

    return 0;

  }


  return values.reduce(
    (a, b) =>
      a + b,
    0
  ) / values.length;

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


function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );

}


function errorText(error) {

  if (!error) {

    return "Unknown error";

  }


  if (
    typeof error ===
    "string"
  ) {

    return error;

  }


  if (
    error instanceof Error
  ) {

    return error.message;

  }


  try {

    return JSON.stringify(error);

  }

  catch {

    return "Unknown error";

  }

}


/* ============================================================
   HTTP
============================================================ */

async function getJSON(
  url,
  timeout = 9000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeout
    );


  try {

    const response =
      await fetch(
        url,
        {

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "MKAYFX-BACKTEST-V4"

          },

          signal:
            controller.signal

        }
      );


    const raw =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(raw);

    }

    catch {

      throw new Error(
        `Invalid Coinbase JSON (${response.status})`
      );

    }


    if (!response.ok) {

      throw new Error(
        data?.message ||
        `Coinbase HTTP ${response.status}`
      );

    }


    return data;

  }

  finally {

    clearTimeout(timer);

  }

}


/* ============================================================
   COINBASE HISTORICAL CHUNK
============================================================ */

async function fetchChunk(
  startMs,
  endMs
) {

  const start =
    new Date(
      startMs
    ).toISOString();


  const end =
    new Date(
      endMs
    ).toISOString();


  const url =

    `${BASE_URL}/products/${PRODUCT}/candles` +

    `?granularity=${GRANULARITY}` +

    `&start=${encodeURIComponent(start)}` +

    `&end=${encodeURIComponent(end)}`;


  const raw =
    await getJSON(url);


  if (!Array.isArray(raw)) {

    throw new Error(
      "Historical Coinbase response was not an array"
    );

  }


  return raw.map(
    row => ({

      timestamp:
        num(
          row[0]
        ) * 1000,

      low:
        num(
          row[1]
        ),

      high:
        num(
          row[2]
        ),

      open:
        num(
          row[3]
        ),

      close:
        num(
          row[4]
        ),

      volume:
        num(
          row[5]
        )

    })
  );

}


/* ============================================================
   DOWNLOAD HISTORY
============================================================ */

async function fetchHistory(
  days
) {

  const end =
    Date.now();


  const start =
    end -
    days *
    86400000;


  const chunkMs =
    SETTINGS.CHUNK_CANDLES *
    GRANULARITY *
    1000;


  const windows = [];


  let cursor =
    start;


  while (
    cursor < end
  ) {

    const next =
      Math.min(
        cursor +
        chunkMs,
        end
      );


    windows.push({

      start:
        cursor,

      end:
        next

    });


    cursor =
      next;

  }


  const all = [];


  /*
     Fetch only a few chunks at once
     to reduce rate-limit problems.
  */

  for (
    let i = 0;
    i < windows.length;
    i += 4
  ) {

    const batch =
      windows.slice(
        i,
        i + 4
      );


    const results =
      await Promise.all(

        batch.map(
          window =>
            fetchChunk(
              window.start,
              window.end
            )
        )

      );


    for (
      const result of results
    ) {

      all.push(
        ...result
      );

    }


    if (
      i + 4 <
      windows.length
    ) {

      await sleep(120);

    }

  }


  const map =
    new Map();


  for (
    const candle of all
  ) {

    if (
      candle.timestamp > 0
    ) {

      map.set(
        candle.timestamp,
        candle
      );

    }

  }


  return [
    ...map.values()
  ].sort(
    (a, b) =>
      a.timestamp -
      b.timestamp
  );

}


/* ============================================================
   RESAMPLE
============================================================ */

function resample(
  candles,
  minutes
) {

  const interval =
    minutes *
    60000;


  const buckets =
    new Map();


  for (
    const candle of candles
  ) {

    const start =
      Math.floor(
        candle.timestamp /
        interval
      ) *
      interval;


    if (!buckets.has(start)) {

      buckets.set(
        start,
        {

          timestamp:
            start,

          closeTime:
            start +
            interval,

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close,

          volume:
            candle.volume

        }
      );

    }

    else {

      const x =
        buckets.get(start);


      x.high =
        Math.max(
          x.high,
          candle.high
        );


      x.low =
        Math.min(
          x.low,
          candle.low
        );


      x.close =
        candle.close;


      x.volume +=
        candle.volume;

    }

  }


  return [
    ...buckets.values()
  ].sort(
    (a, b) =>
      a.timestamp -
      b.timestamp
  );

}


/* ============================================================
   EMA
============================================================ */

function emaSeries(
  values,
  period
) {

  if (!values.length) {

    return [];

  }


  const k =
    2 /
    (period + 1);


  let current =
    values[0];


  const output = [];


  for (
    const value of values
  ) {

    current =
      value * k +
      current * (1 - k);


    output.push(
      current
    );

  }


  return output;

}


/* ============================================================
   STRUCTURE
============================================================ */

function structure(
  candles
) {

  if (
    candles.length < 12
  ) {

    return {
      bias: "NEUTRAL"
    };

  }


  const closes =
    candles.map(
      x => x.close
    );


  const e20 =
    emaSeries(
      closes,
      20
    ).at(-1);


  const e50 =
    emaSeries(
      closes,
      50
    ).at(-1);


  const e200 =
    emaSeries(
      closes,
      200
    ).at(-1);


  const price =
    closes.at(-1);


  let bull = 0;

  let bear = 0;


  if (price > e20) {

    bull++;

  }

  else {

    bear++;

  }


  if (e20 > e50) {

    bull++;

  }

  else {

    bear++;

  }


  if (e50 > e200) {

    bull++;

  }

  else {

    bear++;

  }


  const recent =
    candles.slice(-10);


  if (
    recent.length === 10
  ) {

    const first =
      recent.slice(
        0,
        5
      );


    const second =
      recent.slice(5);


    const firstHigh =
      Math.max(
        ...first.map(
          x => x.high
        )
      );


    const secondHigh =
      Math.max(
        ...second.map(
          x => x.high
        )
      );


    const firstLow =
      Math.min(
        ...first.map(
          x => x.low
        )
      );


    const secondLow =
      Math.min(
        ...second.map(
          x => x.low
        )
      );


    if (
      secondHigh >
      firstHigh &&
      secondLow >
      firstLow
    ) {

      bull += 2;

    }


    if (
      secondHigh <
      firstHigh &&
      secondLow <
      firstLow
    ) {

      bear += 2;

    }

  }


  return {

    bias:

      bull > bear

        ? "BULLISH"

        : bear > bull

          ? "BEARISH"

          : "NEUTRAL",

    bull,

    bear

  };

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


  const values = [];


  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const c =
      candles[i];


    const p =
      candles[i - 1];


    values.push(

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


  return average(
    values.slice(-period)
  );

}


/* ============================================================
   DAY / WEEK KEYS
============================================================ */

function dayKey(
  timestamp
) {

  const d =
    new Date(timestamp);


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


function weekKey(
  timestamp
) {

  const d =
    new Date(timestamp);


  const day =
    d.getUTCDay();


  const offset =
    day === 0
      ? 6
      : day - 1;


  return Date.UTC(

    d.getUTCFullYear(),

    d.getUTCMonth(),

    d.getUTCDate() -
      offset

  );

}


/* ============================================================
   PRE-CALCULATE DAILY/WEEKLY
============================================================ */

function buildDailyMap(
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


    if (!map.has(key)) {

      map.set(
        key,
        {

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close,

          firstTimestamp:
            candle.timestamp

        }
      );

    }

    else {

      const x =
        map.get(key);


      x.high =
        Math.max(
          x.high,
          candle.high
        );


      x.low =
        Math.min(
          x.low,
          candle.low
        );


      x.close =
        candle.close;

    }

  }


  return map;

}


function buildWeekMap(
  candles
) {

  const map =
    new Map();


  for (
    const candle of candles
  ) {

    const key =
      weekKey(
        candle.timestamp
      );


    if (!map.has(key)) {

      map.set(
        key,
        {

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close

        }
      );

    }

    else {

      const x =
        map.get(key);


      x.high =
        Math.max(
          x.high,
          candle.high
        );


      x.low =
        Math.min(
          x.low,
          candle.low
        );


      x.close =
        candle.close;

    }

  }


  return map;

}


/* ============================================================
   PREVIOUS DAY
============================================================ */

function previousDay(
  timestamp,
  dailyMap
) {

  const keys =
    [...dailyMap.keys()]
      .sort();


  const current =
    dayKey(timestamp);


  const index =
    keys.indexOf(
      current
    );


  if (index <= 0) {

    return null;

  }


  const previous =
    dailyMap.get(
      keys[index - 1]
    );


  const today =
    dailyMap.get(
      current
    );


  return {

    previousDayHigh:
      previous.high,

    previousDayLow:
      previous.low,

    dailyOpen:
      today?.open

  };

}


/* ============================================================
   PREVIOUS WEEK
============================================================ */

function previousWeek(
  timestamp,
  weeklyMap
) {

  const keys =
    [...weeklyMap.keys()]
      .sort(
        (a, b) =>
          a - b
      );


  const current =
    weekKey(timestamp);


  const index =
    keys.indexOf(
      current
    );


  if (index <= 0) {

    return null;

  }


  const previous =
    weeklyMap.get(
      keys[index - 1]
    );


  const currentWeek =
    weeklyMap.get(
      current
    );


  return {

    previousWeekHigh:
      previous.high,

    previousWeekLow:
      previous.low,

    weeklyOpen:
      currentWeek?.open

  };

}


/* ============================================================
   SESSION LEVELS USING PAST BARS ONLY
============================================================ */

function historicalSessions(
  history,
  timestamp
) {

  const d =
    new Date(timestamp);


  const midnight =
    Date.UTC(

      d.getUTCFullYear(),

      d.getUTCMonth(),

      d.getUTCDate()

    );


  function range(
    startHour,
    endHour
  ) {

    const start =
      midnight +
      startHour *
      3600000;


    const end =
      midnight +
      endHour *
      3600000;


    const bars =
      history.filter(
        x =>
          x.timestamp >= start &&
          x.timestamp < end &&
          x.timestamp < timestamp
      );


    if (!bars.length) {

      return null;

    }


    return {

      high:
        Math.max(
          ...bars.map(
            x => x.high
          )
        ),

      low:
        Math.min(
          ...bars.map(
            x => x.low
          )
        )

    };

  }


  return {

    asia:
      range(
        0,
        8
      ),

    london:
      range(
        7,
        16
      ),

    newYork:
      range(
        13,
        22
      )

  };

}


/* ============================================================
   VWAP
============================================================ */

function historicalVWAP(
  history,
  timestamp
) {

  const currentDay =
    dayKey(
      timestamp
    );


  const bars =
    history.filter(
      x =>
        dayKey(
          x.timestamp
        ) === currentDay &&
        x.timestamp < timestamp
    );


  if (!bars.length) {

    return null;

  }


  let pv = 0;

  let volume = 0;


  for (
    const bar of bars
  ) {

    const typical =
      (
        bar.high +
        bar.low +
        bar.close
      ) / 3;


    pv +=
      typical *
      bar.volume;


    volume +=
      bar.volume;

  }


  return volume
    ? pv / volume
    : null;

}


/* ============================================================
   CONFIRMED SWINGS
============================================================ */

function precomputeSwings(
  candles,
  strength = 2
) {

  const highs = [];

  const lows = [];


  for (
    let i = strength;
    i <
      candles.length -
      strength;
    i++
  ) {

    let high = true;

    let low = true;


    for (
      let j = 1;
      j <= strength;
      j++
    ) {

      if (
        candles[i].high <=
          candles[i - j].high ||
        candles[i].high <=
          candles[i + j].high
      ) {

        high = false;

      }


      if (
        candles[i].low >=
          candles[i - j].low ||
        candles[i].low >=
          candles[i + j].low
      ) {

        low = false;

      }

    }


    const confirmedAt =
      candles[
        i + strength
      ].timestamp;


    if (high) {

      highs.push({

        price:
          candles[i].high,

        pivotTimestamp:
          candles[i].timestamp,

        confirmedAt

      });

    }


    if (low) {

      lows.push({

        price:
          candles[i].low,

        pivotTimestamp:
          candles[i].timestamp,

        confirmedAt

      });

    }

  }


  return {
    highs,
    lows
  };

}


/* ============================================================
   PROXY DELTA

   Historical candle data cannot recreate
   the exact live Coinbase trade tape.

   This estimates aggression using candle
   efficiency and volume.
============================================================ */

function proxyDelta(
  candles
) {

  const recent =
    candles.slice(-12);


  let buy =
    0;


  let sell =
    0;


  for (
    const candle of recent
  ) {

    const range =
      Math.max(
        candle.high -
        candle.low,
        0.000001
      );


    const body =
      candle.close -
      candle.open;


    const efficiency =
      Math.abs(body) /
      range;


    const pressure =
      candle.volume *
      (
        0.35 +
        efficiency * 0.65
      );


    if (body > 0) {

      buy += pressure;

    }


    if (body < 0) {

      sell += pressure;

    }

  }


  const total =
    buy + sell;


  return total
    ? (
      (buy - sell) /
      total *
      100
    )
    : 0;

}


/* ============================================================
   VOLUME RATIO
============================================================ */

function volumeRatio(
  candles
) {

  if (
    candles.length < 21
  ) {

    return 1;

  }


  const previous =
    candles
      .slice(
        -21,
        -1
      )
      .map(
        x => x.volume
      );


  const avg =
    average(previous);


  return avg
    ? candles.at(-1).volume /
      avg
    : 1;

}


/* ============================================================
   REJECTION
============================================================ */

function rejection(
  candle
) {

  const range =
    candle.high -
    candle.low;


  if (range <= 0) {

    return {

      bullish: false,

      bearish: false

    };

  }


  const bodyHigh =
    Math.max(
      candle.open,
      candle.close
    );


  const bodyLow =
    Math.min(
      candle.open,
      candle.close
    );


  const upper =
    candle.high -
    bodyHigh;


  const lower =
    bodyLow -
    candle.low;


  return {

    bullish:

      lower /
      range >=
      0.35 &&
      candle.close >
      candle.open,


    bearish:

      upper /
      range >=
      0.35 &&
      candle.close <
      candle.open

  };

}


/* ============================================================
   STRUCTURE TRIGGER
============================================================ */

function trigger(
  history
) {

  if (
    history.length < 8
  ) {

    return {

      bullish: false,

      bearish: false

    };

  }


  const current =
    history.at(-1);


  const previous =
    history.slice(
      -8,
      -1
    );


  const high =
    Math.max(
      ...previous.map(
        x => x.high
      )
    );


  const low =
    Math.min(
      ...previous.map(
        x => x.low
      )
    );


  return {

    bullish:
      current.close > high,

    bearish:
      current.close < low

  };

}


/* ============================================================
   ROUND NUMBERS
============================================================ */

function roundLevels(
  price
) {

  return {

    lower:

      Math.floor(
        price /
        SETTINGS.ROUND_STEP
      ) *
      SETTINGS.ROUND_STEP,


    upper:

      Math.ceil(
        price /
        SETTINGS.ROUND_STEP
      ) *
      SETTINGS.ROUND_STEP,


    majorLower:

      Math.floor(
        price /
        SETTINGS.MAJOR_ROUND_STEP
      ) *
      SETTINGS.MAJOR_ROUND_STEP,


    majorUpper:

      Math.ceil(
        price /
        SETTINGS.MAJOR_ROUND_STEP
      ) *
      SETTINGS.MAJOR_ROUND_STEP

  };

}


/* ============================================================
   COMPLETED HTF BARS
============================================================ */

function completedBars(
  candles,
  timestamp
) {

  return candles.filter(
    x =>
      x.closeTime <=
      timestamp +
      GRANULARITY *
      1000
  );

}


/* ============================================================
   BUILD LIQUIDITY AT HISTORICAL MOMENT
============================================================ */

function historicalLiquidity({

  price,

  atrValue,

  timestamp,

  history,

  dailyMap,

  weeklyMap,

  confirmedSwings

}) {

  const pools = [];


  function add(
    name,
    level,
    side,
    weight,
    type
  ) {

    if (
      !Number.isFinite(
        Number(level)
      )
    ) {

      return;

    }


    const distance =
      Math.abs(
        price -
        level
      );


    const distanceATR =
      atrValue
        ? distance /
          atrValue
        : 999;


    if (
      distanceATR >
      SETTINGS
        .MAX_LIQUIDITY_DISTANCE_ATR
    ) {

      return;

    }


    pools.push({

      name,

      level,

      side,

      type,

      weight,

      distanceATR

    });

  }


  const daily =
    previousDay(
      timestamp,
      dailyMap
    );


  const weekly =
    previousWeek(
      timestamp,
      weeklyMap
    );


  if (daily) {

    add(
      "PDH",
      daily.previousDayHigh,
      "BUY_SIDE",
      24,
      "PDH"
    );


    add(
      "PDL",
      daily.previousDayLow,
      "SELL_SIDE",
      24,
      "PDL"
    );

  }


  if (weekly) {

    add(
      "PWH",
      weekly.previousWeekHigh,
      "BUY_SIDE",
      27,
      "PWH"
    );


    add(
      "PWL",
      weekly.previousWeekLow,
      "SELL_SIDE",
      27,
      "PWL"
    );

  }


  const session =
    historicalSessions(
      history,
      timestamp
    );


  if (session.asia) {

    add(
      "Asia High",
      session.asia.high,
      "BUY_SIDE",
      14,
      "ASIA"
    );


    add(
      "Asia Low",
      session.asia.low,
      "SELL_SIDE",
      14,
      "ASIA"
    );

  }


  if (session.london) {

    add(
      "London High",
      session.london.high,
      "BUY_SIDE",
      15,
      "LONDON"
    );


    add(
      "London Low",
      session.london.low,
      "SELL_SIDE",
      15,
      "LONDON"
    );

  }


  if (session.newYork) {

    add(
      "NY High",
      session.newYork.high,
      "BUY_SIDE",
      15,
      "NY"
    );


    add(
      "NY Low",
      session.newYork.low,
      "SELL_SIDE",
      15,
      "NY"
    );

  }


  const recentHighs =
    confirmedSwings.highs
      .filter(
        x =>
          x.confirmedAt <=
          timestamp
      )
      .slice(-4);


  const recentLows =
    confirmedSwings.lows
      .filter(
        x =>
          x.confirmedAt <=
          timestamp
      )
      .slice(-4);


  for (
    const x of recentHighs
  ) {

    add(
      "Swing High",
      x.price,
      "BUY_SIDE",
      15,
      "SWING"
    );

  }


  for (
    const x of recentLows
  ) {

    add(
      "Swing Low",
      x.price,
      "SELL_SIDE",
      15,
      "SWING"
    );

  }


  const rounds =
    roundLevels(price);


  add(
    "Round Above",
    rounds.upper,
    "BUY_SIDE",
    10,
    "ROUND"
  );


  add(
    "Round Below",
    rounds.lower,
    "SELL_SIDE",
    10,
    "ROUND"
  );


  /*
     Rank liquidity by importance +
     closeness.
  */

  return pools.sort(
    (a, b) => {

      const scoreA =
        a.weight -
        a.distanceATR * 5;


      const scoreB =
        b.weight -
        b.distanceATR * 5;


      return scoreB - scoreA;

    }
  );

}


/* ============================================================
   SCORE HISTORICAL SWEEP
============================================================ */

function scoreSweep({

  candle,

  pool,

  M15,

  H1,

  H4,

  currentVWAP,

  proxy,

  volumeRatioValue,

  rejectionData,

  structureTrigger,

  minScore

}) {

  if (!pool) {

    return null;

  }


  let direction =
    null;


  let score =
    pool.weight;


  const reasons = [];


  /*
     BUY SIDE sweep -> potential SELL.
  */

  if (
    pool.side ===
    "BUY_SIDE" &&
    candle.high >
      pool.level &&
    candle.close <
      pool.level
  ) {

    direction =
      "SELL";


    score += 25;


    reasons.push(
      `${pool.name} buy-side sweep rejected`
    );

  }


  /*
     SELL SIDE sweep -> potential BUY.
  */

  if (
    pool.side ===
    "SELL_SIDE" &&
    candle.low <
      pool.level &&
    candle.close >
      pool.level
  ) {

    direction =
      "BUY";


    score += 25;


    reasons.push(
      `${pool.name} sell-side sweep rejected`
    );

  }


  if (!direction) {

    return null;

  }


  /* ========================================================
     REJECTION
  ======================================================== */

  if (
    direction === "BUY" &&
    rejectionData.bullish
  ) {

    score += 8;

    reasons.push(
      "Bullish rejection candle"
    );

  }


  if (
    direction === "SELL" &&
    rejectionData.bearish
  ) {

    score += 8;

    reasons.push(
      "Bearish rejection candle"
    );

  }


  /* ========================================================
     M15
  ======================================================== */

  if (
    direction === "BUY" &&
    M15.bias === "BULLISH"
  ) {

    score += 12;

    reasons.push(
      "M15 bullish"
    );

  }


  if (
    direction === "SELL" &&
    M15.bias === "BEARISH"
  ) {

    score += 12;

    reasons.push(
      "M15 bearish"
    );

  }


  /* ========================================================
     H1
  ======================================================== */

  if (
    direction === "BUY" &&
    H1.bias === "BULLISH"
  ) {

    score += 8;

    reasons.push(
      "H1 bullish"
    );

  }


  if (
    direction === "SELL" &&
    H1.bias === "BEARISH"
  ) {

    score += 8;

    reasons.push(
      "H1 bearish"
    );

  }


  /* ========================================================
     H4
  ======================================================== */

  if (
    direction === "BUY" &&
    H4.bias === "BULLISH"
  ) {

    score += 4;

  }


  if (
    direction === "SELL" &&
    H4.bias === "BEARISH"
  ) {

    score += 4;

  }


  /*
     Penalise directly fighting H4.
  */

  if (
    direction === "BUY" &&
    H4.bias === "BEARISH"
  ) {

    score -= 5;

  }


  if (
    direction === "SELL" &&
    H4.bias === "BULLISH"
  ) {

    score -= 5;

  }


  /* ========================================================
     HISTORICAL DELTA PROXY
  ======================================================== */

  if (
    direction === "BUY" &&
    proxy > 8
  ) {

    score += 8;

    reasons.push(
      "Positive volume pressure"
    );

  }


  if (
    direction === "SELL" &&
    proxy < -8
  ) {

    score += 8;

    reasons.push(
      "Negative volume pressure"
    );

  }


  /* ========================================================
     VOLUME
  ======================================================== */

  if (
    volumeRatioValue >= 1.25
  ) {

    score += 6;

    reasons.push(
      "Elevated volume"
    );

  }


  /* ========================================================
     VWAP
  ======================================================== */

  if (
    Number.isFinite(
      currentVWAP
    )
  ) {

    if (
      direction === "BUY" &&
      candle.close >
      currentVWAP
    ) {

      score += 5;

    }


    if (
      direction === "SELL" &&
      candle.close <
      currentVWAP
    ) {

      score += 5;

    }

  }


  /* ========================================================
     BOS
  ======================================================== */

  if (
    direction === "BUY" &&
    structureTrigger.bullish
  ) {

    score += 8;

    reasons.push(
      "Bullish M5 structure break"
    );

  }


  if (
    direction === "SELL" &&
    structureTrigger.bearish
  ) {

    score += 8;

    reasons.push(
      "Bearish M5 structure break"
    );

  }


  score =
    clamp(
      score,
      0,
      100
    );


  if (
    score < minScore
  ) {

    return null;

  }


  return {

    direction,

    score,

    reasons,

    pool

  };

}


/* ============================================================
   SIMULATE TRADE
============================================================ */

function simulateTrade({

  candles,

  signalIndex,

  direction,

  atrValue,

  sweepCandle,

  rr

}) {

  const entryIndex =
    signalIndex + 1;


  if (
    entryIndex >=
    candles.length
  ) {

    return null;

  }


  const entryCandle =
    candles[entryIndex];


  const entry =
    entryCandle.open;


  let stop;


  if (
    direction === "BUY"
  ) {

    stop =
      Math.min(

        entry -
        atrValue *
        SETTINGS.STOP_ATR,

        sweepCandle.low -
        atrValue *
        0.10

      );

  }

  else {

    stop =
      Math.max(

        entry +
        atrValue *
        SETTINGS.STOP_ATR,

        sweepCandle.high +
        atrValue *
        0.10

      );

  }


  const risk =
    direction === "BUY"

      ? entry - stop

      : stop - entry;


  if (
    risk <= 0 ||
    !Number.isFinite(risk)
  ) {

    return null;

  }


  const target =
    direction === "BUY"

      ? entry +
        risk *
        rr

      : entry -
        risk *
        rr;


  const maximumIndex =
    Math.min(

      candles.length - 1,

      entryIndex +
      SETTINGS.MAX_HOLD_BARS

    );


  for (
    let i = entryIndex;
    i <= maximumIndex;
    i++
  ) {

    const candle =
      candles[i];


    if (
      direction === "BUY"
    ) {

      const hitStop =
        candle.low <=
        stop;


      const hitTarget =
        candle.high >=
        target;


      /*
         Both touched:
         conservative assumption = STOP first.
      */

      if (
        hitStop &&
        hitTarget
      ) {

        return {

          entryIndex,

          exitIndex:
            i,

          entry,

          stop,

          target,

          exit:
            stop,

          outcome:
            "LOSS",

          r:
            -1

        };

      }


      if (hitStop) {

        return {

          entryIndex,

          exitIndex:
            i,

          entry,

          stop,

          target,

          exit:
            stop,

          outcome:
            "LOSS",

          r:
            -1

        };

      }


      if (hitTarget) {

        return {

          entryIndex,

          exitIndex:
            i,

          entry,

          stop,

          target,

          exit:
            target,

          outcome:
            "WIN",

          r:
            rr

        };

      }

    }


    if (
      direction === "SELL"
    ) {

      const hitStop =
        candle.high >=
        stop;


      const hitTarget =
        candle.low <=
        target;


      if (
        hitStop &&
        hitTarget
      ) {

        return {

          entryIndex,

          exitIndex:
            i,

          entry,

          stop,

          target,

          exit:
            stop,

          outcome:
            "LOSS",

          r:
            -1

        };

      }


      if (hitStop) {

        return {

          entryIndex,

          exitIndex:
            i,

          entry,

          stop,

          target,

          exit:
            stop,

          outcome:
            "LOSS",

          r:
            -1

        };

      }


      if (hitTarget) {

        return {

          entryIndex,

          exitIndex:
            i,

          entry,

          stop,

          target,

          exit:
            target,

          outcome:
            "WIN",

          r:
            rr

        };

      }

    }

  }


  /*
     Time exit.
  */

  const finalCandle =
    candles[maximumIndex];


  const finalPrice =
    finalCandle.close;


  const r =

    direction === "BUY"

      ? (
        finalPrice -
        entry
      ) / risk

      : (
        entry -
        finalPrice
      ) / risk;


  return {

    entryIndex,

    exitIndex:
      maximumIndex,

    entry,

    stop,

    target,

    exit:
      finalPrice,

    outcome:

      r > 0.05
        ? "TIME_WIN"

        : r < -0.05
          ? "TIME_LOSS"
          : "BREAKEVEN",

    r:
      round(
        r,
        3
      )

  };

}


/* ============================================================
   BACKTEST
============================================================ */

function runBacktest({

  candles,

  rr,

  minScore,

  startingEquity,

  riskPercent

}) {

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


  const h4 =
    resample(
      candles,
      240
    );


  const dailyMap =
    buildDailyMap(
      candles
    );


  const weeklyMap =
    buildWeekMap(
      candles
    );


  const confirmedSwings =
    precomputeSwings(
      m15,
      SETTINGS.SWING_STRENGTH
    );


  const trades = [];


  let equity =
    startingEquity;


  let peakEquity =
    equity;


  let maxDrawdown =
    0;


  let i = 250;


  while (
    i <
    candles.length - 2
  ) {

    const history =
      candles.slice(
        0,
        i + 1
      );


    const current =
      candles[i];


    const atrValue =
      atr(
        history,
        14
      );


    if (
      !atrValue
    ) {

      i++;

      continue;

    }


    const completedM15 =
      completedBars(
        m15,
        current.timestamp
      );


    const completedH1 =
      completedBars(
        h1,
        current.timestamp
      );


    const completedH4 =
      completedBars(
        h4,
        current.timestamp
      );


    if (
      completedM15.length < 20 ||
      completedH1.length < 20 ||
      completedH4.length < 10
    ) {

      i++;

      continue;

    }


    const M15 =
      structure(
        completedM15
      );


    const H1 =
      structure(
        completedH1
      );


    const H4 =
      structure(
        completedH4
      );


    /*
       Liquidity is built using candles
       BEFORE the current sweep candle.
    */

    const priorHistory =
      candles.slice(
        0,
        i
      );


    const pools =
      historicalLiquidity({

        price:
          current.close,

        atrValue,

        timestamp:
          current.timestamp,

        history:
          priorHistory,

        dailyMap,

        weeklyMap,

        confirmedSwings

      });


    if (!pools.length) {

      i++;

      continue;

    }


    const rejectionData =
      rejection(
        current
      );


    const triggerData =
      trigger(
        history
      );


    const deltaProxy =
      proxyDelta(
        history
      );


    const volumeRatioValue =
      volumeRatio(
        history
      );


    const currentVWAP =
      historicalVWAP(
        history,
        current.timestamp +
        GRANULARITY *
        1000
      );


    let setup =
      null;


    /*
       Try several best pools because the closest
       pool may not be the one actually swept.
    */

    for (
      const pool of
      pools.slice(0, 8)
    ) {

      const candidate =
        scoreSweep({

          candle:
            current,

          pool,

          M15,

          H1,

          H4,

          currentVWAP,

          proxy:
            deltaProxy,

          volumeRatioValue,

          rejectionData,

          structureTrigger:
            triggerData,

          minScore

        });


      if (
        candidate &&
        (
          !setup ||
          candidate.score >
          setup.score
        )
      ) {

        setup =
          candidate;

      }

    }


    if (!setup) {

      i++;

      continue;

    }


    const simulation =
      simulateTrade({

        candles,

        signalIndex:
          i,

        direction:
          setup.direction,

        atrValue,

        sweepCandle:
          current,

        rr

      });


    if (!simulation) {

      i++;

      continue;

    }


    const riskMoney =
      equity *
      (
        riskPercent /
        100
      );


    const pnl =
      riskMoney *
      simulation.r;


    const before =
      equity;


    equity +=
      pnl;


    peakEquity =
      Math.max(
        peakEquity,
        equity
      );


    const drawdown =
      peakEquity > 0

        ? (
          peakEquity -
          equity
        ) /
        peakEquity *
        100

        : 0;


    maxDrawdown =
      Math.max(
        maxDrawdown,
        drawdown
      );


    trades.push({

      number:
        trades.length + 1,

      direction:
        setup.direction,

      setup:
        setup.pool.name,

      score:
        round(
          setup.score,
          1
        ),

      signalTime:
        new Date(
          current.timestamp
        ).toISOString(),

      entryTime:
        new Date(
          candles[
            simulation.entryIndex
          ].timestamp
        ).toISOString(),

      exitTime:
        new Date(
          candles[
            simulation.exitIndex
          ].timestamp
        ).toISOString(),

      entry:
        round(
          simulation.entry
        ),

      stop:
        round(
          simulation.stop
        ),

      target:
        round(
          simulation.target
        ),

      exit:
        round(
          simulation.exit
        ),

      result:
        simulation.outcome,

      r:
        round(
          simulation.r,
          3
        ),

      equityBefore:
        round(
          before,
          2
        ),

      pnl:
        round(
          pnl,
          2
        ),

      equityAfter:
        round(
          equity,
          2
        ),

      reasons:
        setup.reasons

    });


    /*
       Continue after trade exit.
    */

    i =
      simulation.exitIndex +
      SETTINGS.COOLDOWN_BARS;

  }


  /* ========================================================
     STATS
  ======================================================== */

  const wins =
    trades.filter(
      x =>
        x.r > 0
    ).length;


  const losses =
    trades.filter(
      x =>
        x.r < 0
    ).length;


  const breakeven =
    trades.filter(
      x =>
        x.r === 0
    ).length;


  const totalR =
    trades.reduce(
      (
        total,
        trade
      ) =>
        total +
        trade.r,
      0
    );


  const grossProfit =
    trades
      .filter(
        x =>
          x.r > 0
      )
      .reduce(
        (
          total,
          trade
        ) =>
          total +
          trade.r,
        0
      );


  const grossLoss =
    Math.abs(
      trades
        .filter(
          x =>
            x.r < 0
        )
        .reduce(
          (
            total,
            trade
          ) =>
            total +
            trade.r,
          0
        )
    );


  const profitFactor =
    grossLoss > 0

      ? grossProfit /
        grossLoss

      : grossProfit > 0
        ? 999
        : 0;


  const winRate =
    trades.length

      ? wins /
        trades.length *
        100

      : 0;


  const averageR =
    trades.length

      ? totalR /
        trades.length

      : 0;


  const buyTrades =
    trades.filter(
      x =>
        x.direction ===
        "BUY"
    );


  const sellTrades =
    trades.filter(
      x =>
        x.direction ===
        "SELL"
    );


  return {

    metrics: {

      trades:
        trades.length,

      wins,

      losses,

      breakeven,

      winRate:
        round(
          winRate,
          2
        ),

      totalR:
        round(
          totalR,
          2
        ),

      averageR:
        round(
          averageR,
          3
        ),

      profitFactor:
        round(
          profitFactor,
          2
        ),

      maxDrawdownPercent:
        round(
          maxDrawdown,
          2
        ),

      startingEquity:
        round(
          startingEquity,
          2
        ),

      endingEquity:
        round(
          equity,
          2
        ),

      returnPercent:

        round(

          (
            equity -
            startingEquity
          ) /
          startingEquity *
          100,

          2

        ),

      buyTrades:
        buyTrades.length,

      sellTrades:
        sellTrades.length

    },

    trades

  };

}


/* ============================================================
   HANDLER
============================================================ */

module.exports =
async function handler(
  req,
  res
) {

  const started =
    Date.now();


  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  try {

    const days =
      clamp(
        num(
          req.query?.days,
          SETTINGS.DEFAULT_DAYS
        ),
        2,
        SETTINGS.MAX_DAYS
      );


    const rr =
      clamp(
        num(
          req.query?.rr,
          SETTINGS.DEFAULT_RR
        ),
        1,
        5
      );


    const minScore =
      clamp(
        num(
          req.query?.minScore,
          SETTINGS.DEFAULT_MIN_SCORE
        ),
        35,
        90
      );


    const startingEquity =
      clamp(
        num(
          req.query?.equity,
          200
        ),
        10,
        10000000
      );


    const riskPercent =
      clamp(
        num(
          req.query?.risk,
          1
        ),
        0.1,
        10
      );


    const candles =
      await fetchHistory(
        days
      );


    if (
      candles.length < 500
    ) {

      throw new Error(
        `Only ${candles.length} historical M5 candles downloaded`
      );

    }


    const result =
      runBacktest({

        candles,

        rr,

        minScore,

        startingEquity,

        riskPercent

      });


    return res
      .status(200)
      .json({

        ok: true,

        engine:
          "MKAYFX BTC LIQUIDITY BACKTEST V4",

        source:
          "Coinbase Exchange",

        product:
          PRODUCT,

        settings: {

          days,

          timeframe:
            "M5",

          rr,

          minScore,

          startingEquity,

          riskPercent,

          maxHoldBars:
            SETTINGS.MAX_HOLD_BARS,

          conservativeSameBarRule:
            "SL FIRST"

        },

        data: {

          candles:
            candles.length,

          firstCandle:
            new Date(
              candles[0]
                .timestamp
            ).toISOString(),

          lastCandle:
            new Date(
              candles.at(-1)
                .timestamp
            ).toISOString()

        },

        metrics:
          result.metrics,

        trades:
          result.trades.slice(
            -200
          ),

        latencyMs:
          Date.now() -
          started

      });

  }

  catch (error) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          errorText(error),

        latencyMs:
          Date.now() -
          started

      });

  }

};