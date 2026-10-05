/* ============================================================
   MKAYFX BTC LIQUIDITY INTELLIGENCE V4
   /api/btc.js

   DATA SOURCE
   -----------
   Coinbase Exchange public market data

   MARKET
   ------
   BTC-USD

   TIMEFRAMES
   ----------
   M5  = Coinbase
   M15 = built from M5
   H1  = Coinbase
   H4  = built from H1
   D1  = Coinbase

   FEATURES
   --------
   - Live BTC price
   - Bid / Ask
   - Coinbase trades
   - Aggressive delta
   - CVD proxy
   - M5 / M15 / H1 / H4 structure
   - RSI
   - EMA 20 / 50 / 200
   - ATR
   - VWAP
   - PDH / PDL
   - PWH / PWL
   - Daily open
   - Weekly open
   - Asia range
   - London range
   - New York range
   - Swing liquidity
   - Equal highs / lows
   - Round numbers
   - Raid tracking
   - Sweep zones
   - Rejection
   - Structure break
   - BUY / SELL / WAIT
============================================================ */


const PRODUCT = "BTC-USD";

const BASE_URL =
  "https://api.exchange.coinbase.com";


const SETTINGS = {

  ATR_PERIOD: 14,

  RSI_PERIOD: 14,

  EMA_FAST: 20,

  EMA_MID: 50,

  EMA_SLOW: 200,

  SWING_STRENGTH: 2,

  EQUAL_TOLERANCE_ATR: 0.12,

  ROUND_STEP: 1000,

  MAJOR_ROUND_STEP: 5000,

  TRACKING_SCORE: 35,

  ARMED_SCORE: 55,

  SIGNAL_SCORE: 68,

  SIGNAL_GAP: 6,

  STOP_ATR: 0.55,

  TP1_R: 1.5,

  TP2_R: 2.5,

  SWEEP_MIN_ATR: 0.04,

  SWEEP_MAX_ATR: 0.45,

  VOLUME_LOOKBACK: 20

};


/* ============================================================
   HELPERS
============================================================ */

function num(v, fallback = 0) {

  const n = Number(v);

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


  const p = 10 ** digits;

  return Math.round(
    Number(v) * p
  ) / p;

}


function average(values) {

  if (!values.length) {
    return 0;
  }


  return values.reduce(
    (a, b) => a + b,
    0
  ) / values.length;

}


function clamp(v, min, max) {

  return Math.max(
    min,
    Math.min(max, v)
  );

}


function errorText(error) {

  if (!error) {
    return "Unknown error";
  }


  if (
    typeof error === "string"
  ) {

    return error;

  }


  if (
    error instanceof Error
  ) {

    return error.message;

  }


  if (
    typeof error.message === "string"
  ) {

    return error.message;

  }


  if (
    typeof error.error === "string"
  ) {

    return error.error;

  }


  try {

    return JSON.stringify(error);

  }

  catch {

    return "Unknown object error";

  }

}


/* ============================================================
   HTTP
============================================================ */

async function getJSON(
  url,
  timeout = 8000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );


  try {

    const response =
      await fetch(
        url,
        {

          method: "GET",

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "MKAYFX-BTC-V4"

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
        raw
          ? JSON.parse(raw)
          : null;

    }

    catch {

      throw new Error(
        `Invalid Coinbase response (${response.status})`
      );

    }


    if (!response.ok) {

      throw new Error(
        data?.message ||
        data?.error ||
        `Coinbase HTTP ${response.status}`
      );

    }


    return data;

  }

  catch (error) {

    if (
      error?.name === "AbortError"
    ) {

      throw new Error(
        "Coinbase request timed out"
      );

    }


    throw new Error(
      errorText(error)
    );

  }

  finally {

    clearTimeout(timer);

  }

}


async function optional(
  promise,
  fallback
) {

  try {

    return await promise;

  }

  catch (error) {

    console.error(
      "OPTIONAL DATA ERROR",
      errorText(error)
    );


    return fallback;

  }

}


/* ============================================================
   COINBASE
============================================================ */

function fetchTicker() {

  return getJSON(
    `${BASE_URL}/products/${PRODUCT}/ticker`
  );

}


function fetchTrades() {

  return getJSON(
    `${BASE_URL}/products/${PRODUCT}/trades`
  );

}


function fetchBook() {

  return getJSON(
    `${BASE_URL}/products/${PRODUCT}/book?level=1`
  );

}


/*
   For live data we don't need start/end.

   Coinbase returns recent candles.
*/

async function fetchCandles(
  granularity
) {

  const raw =
    await getJSON(

      `${BASE_URL}/products/${PRODUCT}/candles` +
      `?granularity=${granularity}`

    );


  if (!Array.isArray(raw)) {

    throw new Error(
      "Coinbase candle response was not an array"
    );

  }


  const unique =
    new Map();


  for (const row of raw) {

    if (
      !Array.isArray(row) ||
      row.length < 6
    ) {

      continue;

    }


    const timestamp =
      num(row[0]) * 1000;


    const candle = {

      timestamp,

      low:
        num(row[1]),

      high:
        num(row[2]),

      open:
        num(row[3]),

      close:
        num(row[4]),

      volume:
        num(row[5])

    };


    if (
      timestamp > 0 &&
      candle.open > 0 &&
      candle.high > 0 &&
      candle.low > 0 &&
      candle.close > 0
    ) {

      unique.set(
        timestamp,
        candle
      );

    }

  }


  return [
    ...unique.values()
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

  const ms =
    minutes *
    60000;


  const buckets =
    new Map();


  for (
    const candle of candles
  ) {

    const key =
      Math.floor(
        candle.timestamp / ms
      ) * ms;


    if (!buckets.has(key)) {

      buckets.set(
        key,
        {

          timestamp: key,

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
        buckets.get(key);


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
    2 / (period + 1);


  let value =
    values[0];


  const out = [];


  for (
    const x of values
  ) {

    value =
      x * k +
      value * (1 - k);


    out.push(value);

  }


  return out;

}


/* ============================================================
   RSI
============================================================ */

function rsi(
  closes,
  period = 14
) {

  if (
    closes.length <
    period + 1
  ) {

    return 50;

  }


  let gains = 0;

  let losses = 0;


  for (
    let i =
      closes.length - period;
    i < closes.length;
    i++
  ) {

    const change =
      closes[i] -
      closes[i - 1];


    if (change > 0) {

      gains += change;

    }

    else {

      losses +=
        Math.abs(change);

    }

  }


  if (losses === 0) {

    return 100;

  }


  const rs =
    gains / losses;


  return (
    100 -
    100 / (1 + rs)
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


  const values = [];


  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const current =
      candles[i];


    const previous =
      candles[i - 1];


    values.push(

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

      )

    );

  }


  return average(
    values.slice(-period)
  );

}


/* ============================================================
   STRUCTURE
============================================================ */

function structure(
  candles
) {

  if (
    !candles ||
    candles.length < 12
  ) {

    return {

      bias:
        "NEUTRAL",

      bull: 0,

      bear: 0,

      score: 0,

      rsi: 50

    };

  }


  const closes =
    candles.map(
      c => c.close
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

    const a =
      recent.slice(0, 5);


    const b =
      recent.slice(5);


    const highA =
      Math.max(
        ...a.map(
          x => x.high
        )
      );


    const highB =
      Math.max(
        ...b.map(
          x => x.high
        )
      );


    const lowA =
      Math.min(
        ...a.map(
          x => x.low
        )
      );


    const lowB =
      Math.min(
        ...b.map(
          x => x.low
        )
      );


    if (
      highB > highA &&
      lowB > lowA
    ) {

      bull += 2;

    }


    if (
      highB < highA &&
      lowB < lowA
    ) {

      bear += 2;

    }

  }


  let bias =
    "NEUTRAL";


  if (bull > bear) {

    bias =
      "BULLISH";

  }


  if (bear > bull) {

    bias =
      "BEARISH";

  }


  return {

    bias,

    bull,

    bear,

    score:
      Math.abs(
        bull -
        bear
      ),

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
        rsi(
          closes,
          14
        ),
        1
      )

  };

}


/* ============================================================
   VWAP
============================================================ */

function vwap(
  candles
) {

  let pv = 0;

  let vol = 0;


  for (
    const c of candles
  ) {

    const typical =
      (
        c.high +
        c.low +
        c.close
      ) / 3;


    pv +=
      typical *
      c.volume;


    vol +=
      c.volume;

  }


  if (!vol) {

    return null;

  }


  return pv / vol;

}


/* ============================================================
   DAILY
============================================================ */

function dailyLevels(
  d1
) {

  if (
    d1.length < 2
  ) {

    return {};

  }


  const current =
    d1.at(-1);


  const previous =
    d1.at(-2);


  return {

    previousDayHigh:
      previous.high,

    previousDayLow:
      previous.low,

    previousDayClose:
      previous.close,

    dailyOpen:
      current.open

  };

}


/* ============================================================
   WEEK
============================================================ */

function weekStart(
  timestamp
) {

  const date =
    new Date(timestamp);


  const day =
    date.getUTCDay();


  const offset =
    day === 0
      ? 6
      : day - 1;


  return Date.UTC(

    date.getUTCFullYear(),

    date.getUTCMonth(),

    date.getUTCDate() -
      offset

  );

}


function weeklyLevels(
  daily
) {

  const weeks =
    new Map();


  for (
    const candle of daily
  ) {

    const key =
      weekStart(
        candle.timestamp
      );


    if (!weeks.has(key)) {

      weeks.set(
        key,
        []
      );

    }


    weeks
      .get(key)
      .push(candle);

  }


  const keys =
    [...weeks.keys()]
      .sort(
        (a, b) =>
          a - b
      );


  if (keys.length < 2) {

    return {};

  }


  const current =
    weeks.get(
      keys.at(-1)
    );


  const previous =
    weeks.get(
      keys.at(-2)
    );


  return {

    previousWeekHigh:
      Math.max(
        ...previous.map(
          x => x.high
        )
      ),

    previousWeekLow:
      Math.min(
        ...previous.map(
          x => x.low
        )
      ),

    weeklyOpen:
      current[0]?.open

  };

}


/* ============================================================
   TODAY
============================================================ */

function todayCandles(
  candles
) {

  const d =
    new Date();


  const start =
    Date.UTC(

      d.getUTCFullYear(),

      d.getUTCMonth(),

      d.getUTCDate()

    );


  return candles.filter(
    x =>
      x.timestamp >= start
  );

}


/* ============================================================
   SESSION
============================================================ */

function sessions(
  candles
) {

  const now =
    new Date();


  const startDay =
    Date.UTC(

      now.getUTCFullYear(),

      now.getUTCMonth(),

      now.getUTCDate()

    );


  function range(
    startHour,
    endHour
  ) {

    const start =
      startDay +
      startHour *
      3600000;


    const end =
      startDay +
      endHour *
      3600000;


    const bars =
      candles.filter(
        x =>
          x.timestamp >= start &&
          x.timestamp < end
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
      range(0, 8),

    london:
      range(7, 16),

    newYork:
      range(13, 22)

  };

}


function activeSession() {

  const d =
    new Date();


  const hour =
    d.getUTCHours();


  const day =
    d.getUTCDay();


  const active = [];


  if (
    hour >= 0 &&
    hour < 8
  ) {

    active.push(
      "ASIA"
    );

  }


  if (
    hour >= 7 &&
    hour < 16
  ) {

    active.push(
      "LONDON"
    );

  }


  if (
    hour >= 13 &&
    hour < 22
  ) {

    active.push(
      "NEW YORK"
    );

  }


  if (!active.length) {

    active.push(
      "CRYPTO 24/7"
    );

  }


  return {

    active,

    weekend:
      day === 0 ||
      day === 6,

    utcHour:
      hour

  };

}


/* ============================================================
   SWINGS
============================================================ */

function swings(
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


    if (high) {

      highs.push({

        price:
          candles[i].high,

        timestamp:
          candles[i].timestamp

      });

    }


    if (low) {

      lows.push({

        price:
          candles[i].low,

        timestamp:
          candles[i].timestamp

      });

    }

  }


  return {
    highs,
    lows
  };

}


/* ============================================================
   EQUAL LIQUIDITY
============================================================ */

function equalLiquidity(
  swingData,
  atrValue
) {

  const tolerance =
    atrValue *
    SETTINGS
      .EQUAL_TOLERANCE_ATR;


  const equalHighs = [];

  const equalLows = [];


  function scan(
    input,
    output
  ) {

    const data =
      input.slice(-20);


    for (
      let i = 0;
      i < data.length;
      i++
    ) {

      for (
        let j = i + 1;
        j < data.length;
        j++
      ) {

        if (
          Math.abs(
            data[i].price -
            data[j].price
          ) <= tolerance
        ) {

          output.push({

            price:
              (
                data[i].price +
                data[j].price
              ) / 2

          });

        }

      }

    }

  }


  scan(
    swingData.highs,
    equalHighs
  );


  scan(
    swingData.lows,
    equalLows
  );


  return {

    equalHighs:
      equalHighs.slice(-5),

    equalLows:
      equalLows.slice(-5)

  };

}


/* ============================================================
   TRADE FLOW
============================================================ */

function tradeFlow(
  trades
) {

  if (!Array.isArray(trades)) {

    return {

      available: false,

      trades: 0,

      deltaBTC: 0,

      deltaPercent: 0,

      cvd: 0,

      pressure:
        "UNAVAILABLE"

    };

  }


  let buys = 0;

  let sells = 0;

  let cvd = 0;


  for (
    const trade of trades
  ) {

    const size =
      num(
        trade.size
      );


    /*
       Coinbase side is maker side.

       maker SELL =
       aggressive BUY
    */

    if (
      trade.side === "sell"
    ) {

      buys += size;

      cvd += size;

    }


    /*
       maker BUY =
       aggressive SELL
    */

    if (
      trade.side === "buy"
    ) {

      sells += size;

      cvd -= size;

    }

  }


  const total =
    buys + sells;


  const delta =
    buys - sells;


  const percent =
    total
      ? delta /
        total *
        100
      : 0;


  let pressure =
    "BALANCED";


  if (percent > 8) {

    pressure =
      "AGGRESSIVE BUYING";

  }


  if (percent < -8) {

    pressure =
      "AGGRESSIVE SELLING";

  }


  return {

    available: true,

    trades:
      trades.length,

    aggressiveBuyBTC:
      round(
        buys,
        5
      ),

    aggressiveSellBTC:
      round(
        sells,
        5
      ),

    deltaBTC:
      round(
        delta,
        5
      ),

    deltaPercent:
      round(
        percent,
        2
      ),

    cvd:
      round(
        cvd,
        5
      ),

    pressure

  };

}


/* ============================================================
   VOLUME
============================================================ */

function volumeState(
  candles
) {

  const recent =
    candles.slice(
      -SETTINGS
        .VOLUME_LOOKBACK
    );


  const avg =
    average(
      recent.map(
        x => x.volume
      )
    );


  const current =
    candles.at(-1)
      ?.volume || 0;


  const ratio =
    avg
      ? current / avg
      : 1;


  let state =
    "NORMAL";


  if (ratio > 1.4) {

    state =
      "HIGH";

  }


  if (ratio < 0.65) {

    state =
      "LOW";

  }


  return {

    current:
      round(
        current,
        5
      ),

    average:
      round(
        avg,
        5
      ),

    ratio:
      round(
        ratio,
        2
      ),

    state

  };

}


/* ============================================================
   ROUND NUMBERS
============================================================ */

function roundNumbers(
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
   LIQUIDITY MAP
============================================================ */

function liquidityPools({

  price,

  atrValue,

  daily,

  weekly,

  sessionData,

  swingData,

  equalData,

  rounds

}) {

  const pools = [];


  function add(
    name,
    level,
    side,
    baseWeight,
    type
  ) {

    if (
      !Number.isFinite(
        Number(level)
      )
    ) {

      return;

    }


    const value =
      Number(level);


    const distance =
      Math.abs(
        price -
        value
      );


    const distanceATR =
      atrValue
        ? distance /
          atrValue
        : 999;


    if (distanceATR > 12) {

      return;

    }


    let proximity = 0;


    if (
      distanceATR <= 0.25
    ) {

      proximity = 30;

    }

    else if (
      distanceATR <= 0.5
    ) {

      proximity = 25;

    }

    else if (
      distanceATR <= 1
    ) {

      proximity = 18;

    }

    else if (
      distanceATR <= 1.5
    ) {

      proximity = 10;

    }

    else if (
      distanceATR <= 3
    ) {

      proximity = 5;

    }


    pools.push({

      name,

      level:
        value,

      side,

      type,

      baseWeight,

      distance,

      distanceATR,

      score:
        clamp(
          baseWeight +
          proximity,
          0,
          65
        )

    });

  }


  add(
    "Previous Day High",
    daily.previousDayHigh,
    "BUY_SIDE",
    24,
    "PDH"
  );


  add(
    "Previous Day Low",
    daily.previousDayLow,
    "SELL_SIDE",
    24,
    "PDL"
  );


  add(
    "Previous Week High",
    weekly.previousWeekHigh,
    "BUY_SIDE",
    27,
    "PWH"
  );


  add(
    "Previous Week Low",
    weekly.previousWeekLow,
    "SELL_SIDE",
    27,
    "PWL"
  );


  if (sessionData.asia) {

    add(
      "Asia High",
      sessionData.asia.high,
      "BUY_SIDE",
      14,
      "ASIA"
    );


    add(
      "Asia Low",
      sessionData.asia.low,
      "SELL_SIDE",
      14,
      "ASIA"
    );

  }


  if (sessionData.london) {

    add(
      "London High",
      sessionData.london.high,
      "BUY_SIDE",
      15,
      "LONDON"
    );


    add(
      "London Low",
      sessionData.london.low,
      "SELL_SIDE",
      15,
      "LONDON"
    );

  }


  if (sessionData.newYork) {

    add(
      "New York High",
      sessionData.newYork.high,
      "BUY_SIDE",
      15,
      "NY"
    );


    add(
      "New York Low",
      sessionData.newYork.low,
      "SELL_SIDE",
      15,
      "NY"
    );

  }


  for (
    const x of
    equalData.equalHighs
  ) {

    add(
      "Equal Highs",
      x.price,
      "BUY_SIDE",
      20,
      "EQH"
    );

  }


  for (
    const x of
    equalData.equalLows
  ) {

    add(
      "Equal Lows",
      x.price,
      "SELL_SIDE",
      20,
      "EQL"
    );

  }


  for (
    const x of
    swingData.highs.slice(-4)
  ) {

    add(
      "M15 Swing High",
      x.price,
      "BUY_SIDE",
      15,
      "SWING"
    );

  }


  for (
    const x of
    swingData.lows.slice(-4)
  ) {

    add(
      "M15 Swing Low",
      x.price,
      "SELL_SIDE",
      15,
      "SWING"
    );

  }


  add(
    "Round Number Above",
    rounds.upper,
    "BUY_SIDE",
    10,
    "ROUND"
  );


  add(
    "Round Number Below",
    rounds.lower,
    "SELL_SIDE",
    10,
    "ROUND"
  );


  if (
    rounds.majorUpper !==
    rounds.upper
  ) {

    add(
      "Major Round Above",
      rounds.majorUpper,
      "BUY_SIDE",
      17,
      "MAJOR_ROUND"
    );

  }


  if (
    rounds.majorLower !==
    rounds.lower
  ) {

    add(
      "Major Round Below",
      rounds.majorLower,
      "SELL_SIDE",
      17,
      "MAJOR_ROUND"
    );

  }


  return pools.sort(
    (a, b) =>
      b.score -
      a.score ||
      a.distance -
      b.distance
  );

}


/* ============================================================
   PRIMARY TARGET
============================================================ */

function primaryPool(
  pools
) {

  if (!pools.length) {

    return null;

  }


  return [
    ...pools
  ].sort(
    (a, b) => {

      const aRank =
        a.score -
        Math.min(
          a.distanceATR * 4,
          25
        );


      const bRank =
        b.score -
        Math.min(
          b.distanceATR * 4,
          25
        );


      return bRank - aRank;

    }
  )[0];

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


  const upperPct =
    upper /
    range *
    100;


  const lowerPct =
    lower /
    range *
    100;


  return {

    bullish:

      lowerPct >= 38 &&
      candle.close >
      candle.open,


    bearish:

      upperPct >= 38 &&
      candle.close <
      candle.open,


    upperWickPercent:
      round(
        upperPct,
        1
      ),


    lowerWickPercent:
      round(
        lowerPct,
        1
      )

  };

}


/* ============================================================
   STRUCTURE BREAK
============================================================ */

function breakTrigger(
  candles
) {

  if (
    candles.length < 10
  ) {

    return {

      bullish: false,

      bearish: false

    };

  }


  const prior =
    candles.slice(
      -8,
      -1
    );


  const current =
    candles.at(-1);


  const high =
    Math.max(
      ...prior.map(
        x => x.high
      )
    );


  const low =
    Math.min(
      ...prior.map(
        x => x.low
      )
    );


  return {

    bullish:
      current.close > high,

    bearish:
      current.close < low,

    previousHigh:
      round(high),

    previousLow:
      round(low)

  };

}


/* ============================================================
   RAID
============================================================ */

function raidAnalysis({

  pool,

  price,

  atrValue,

  candle,

  m15,

  h1,

  h4,

  flow,

  volume

}) {

  if (!pool) {

    return null;

  }


  const distance =
    Math.abs(
      price -
      pool.level
    );


  const distanceATR =
    atrValue
      ? distance /
        atrValue
      : 999;


  let score =
    pool.baseWeight;


  const reasons = [];


  if (
    distanceATR <= 1.5
  ) {

    score += 10;

    reasons.push(
      "Price is approaching this liquidity pool"
    );

  }


  if (
    distanceATR <= 0.75
  ) {

    score += 8;

    reasons.push(
      "Target is inside 0.75 ATR"
    );

  }


  if (
    distanceATR <= 0.3
  ) {

    score += 8;

    reasons.push(
      "Price is extremely close to liquidity"
    );

  }


  let swept = false;

  let rejected = false;


  if (
    pool.side ===
    "BUY_SIDE"
  ) {

    if (
      candle.high >
      pool.level
    ) {

      swept = true;

      score += 12;

      reasons.push(
        "Buy-side liquidity was swept"
      );

    }


    if (
      swept &&
      candle.close <
      pool.level
    ) {

      rejected = true;

      score += 14;

      reasons.push(
        "Sweep rejected back below liquidity"
      );

    }


    if (
      flow.deltaPercent < -5
    ) {

      score += 8;

      reasons.push(
        "Aggressive BTC flow is bearish"
      );

    }


    if (
      m15.bias ===
      "BEARISH"
    ) {

      score += 7;

    }


    if (
      h1.bias ===
      "BEARISH"
    ) {

      score += 5;

    }


    if (
      h4.bias ===
      "BULLISH"
    ) {

      score -= 5;

    }

  }


  if (
    pool.side ===
    "SELL_SIDE"
  ) {

    if (
      candle.low <
      pool.level
    ) {

      swept = true;

      score += 12;

      reasons.push(
        "Sell-side liquidity was swept"
      );

    }


    if (
      swept &&
      candle.close >
      pool.level
    ) {

      rejected = true;

      score += 14;

      reasons.push(
        "Sweep rejected back above liquidity"
      );

    }


    if (
      flow.deltaPercent > 5
    ) {

      score += 8;

      reasons.push(
        "Aggressive BTC flow is bullish"
      );

    }


    if (
      m15.bias ===
      "BULLISH"
    ) {

      score += 7;

    }


    if (
      h1.bias ===
      "BULLISH"
    ) {

      score += 5;

    }


    if (
      h4.bias ===
      "BEARISH"
    ) {

      score -= 5;

    }

  }


  if (
    volume.state === "HIGH"
  ) {

    score += 5;

    reasons.push(
      "M5 volume is elevated"
    );

  }


  score =
    clamp(
      score,
      0,
      95
    );


  let stage =
    "MONITORING";


  if (
    score >=
    SETTINGS.TRACKING_SCORE
  ) {

    stage =
      "TRACKING";

  }


  if (
    score >=
    SETTINGS.ARMED_SCORE
  ) {

    stage =
      "ARMED";

  }


  if (swept) {

    stage =
      "SWEPT";

  }


  if (
    swept &&
    rejected
  ) {

    stage =
      "REVERSAL WATCH";

  }


  const minimum =
    atrValue *
    SETTINGS
      .SWEEP_MIN_ATR;


  let maximum =
    atrValue *
    SETTINGS
      .SWEEP_MAX_ATR;


  if (
    volume.state === "HIGH"
  ) {

    maximum *= 1.2;

  }


  const zone =
    pool.side ===
    "BUY_SIDE"

      ? {

        low:
          pool.level +
          minimum,

        high:
          pool.level +
          maximum

      }

      : {

        low:
          pool.level -
          maximum,

        high:
          pool.level -
          minimum

      };


  return {

    target:
      pool.name,

    type:
      pool.type,

    side:
      pool.side,

    level:
      round(
        pool.level
      ),

    livePrice:
      round(price),

    distance:
      round(distance),

    distanceATR:
      round(
        distanceATR,
        2
      ),

    score,

    maxScore: 95,

    stage,

    swept,

    rejected,

    projectedSweepZone: {

      low:
        round(zone.low),

      high:
        round(zone.high)

    },

    reasons

  };

}


/* ============================================================
   SIGNAL
============================================================ */

function signalEngine({

  price,

  atrValue,

  currentVWAP,

  raid,

  m5,

  m15,

  h1,

  h4,

  flow,

  rejectionData,

  trigger

}) {

  let buy = 0;

  let sell = 0;


  const buyReasons = [];

  const sellReasons = [];


  if (
    m5.bias === "BULLISH"
  ) {

    buy += 7;

    buyReasons.push(
      "M5 bullish"
    );

  }


  if (
    m5.bias === "BEARISH"
  ) {

    sell += 7;

    sellReasons.push(
      "M5 bearish"
    );

  }


  if (
    m15.bias === "BULLISH"
  ) {

    buy += 13;

    buyReasons.push(
      "M15 bullish"
    );

  }


  if (
    m15.bias === "BEARISH"
  ) {

    sell += 13;

    sellReasons.push(
      "M15 bearish"
    );

  }


  if (
    h1.bias === "BULLISH"
  ) {

    buy += 12;

    buyReasons.push(
      "H1 bullish"
    );

  }


  if (
    h1.bias === "BEARISH"
  ) {

    sell += 12;

    sellReasons.push(
      "H1 bearish"
    );

  }


  if (
    h4.bias === "BULLISH"
  ) {

    buy += 8;

    buyReasons.push(
      "H4 bullish"
    );

  }


  if (
    h4.bias === "BEARISH"
  ) {

    sell += 8;

    sellReasons.push(
      "H4 bearish"
    );

  }


  if (
    Number.isFinite(
      currentVWAP
    )
  ) {

    if (
      price >
      currentVWAP
    ) {

      buy += 5;

      buyReasons.push(
        "Above VWAP"
      );

    }

    else {

      sell += 5;

      sellReasons.push(
        "Below VWAP"
      );

    }

  }


  if (
    flow.available
  ) {

    if (
      flow.deltaPercent > 5
    ) {

      buy += 10;

      buyReasons.push(
        "Positive Coinbase delta"
      );

    }


    if (
      flow.deltaPercent < -5
    ) {

      sell += 10;

      sellReasons.push(
        "Negative Coinbase delta"
      );

    }

  }


  if (
    rejectionData.bullish
  ) {

    buy += 7;

    buyReasons.push(
      "Bullish rejection"
    );

  }


  if (
    rejectionData.bearish
  ) {

    sell += 7;

    sellReasons.push(
      "Bearish rejection"
    );

  }


  if (
    trigger.bullish
  ) {

    buy += 10;

    buyReasons.push(
      "Bullish structure break"
    );

  }


  if (
    trigger.bearish
  ) {

    sell += 10;

    sellReasons.push(
      "Bearish structure break"
    );

  }


  if (
    raid?.swept &&
    raid?.rejected
  ) {

    if (
      raid.side ===
      "SELL_SIDE"
    ) {

      buy += 23;

      buyReasons.push(
        "Sell-side raid rejected"
      );

    }


    if (
      raid.side ===
      "BUY_SIDE"
    ) {

      sell += 23;

      sellReasons.push(
        "Buy-side raid rejected"
      );

    }

  }


  buy =
    clamp(
      buy,
      0,
      100
    );


  sell =
    clamp(
      sell,
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
    buy >=
      SETTINGS.SIGNAL_SCORE &&
    buy > sell &&
    gap >=
      SETTINGS.SIGNAL_GAP
  ) {

    signal = "BUY";

  }


  if (
    sell >=
      SETTINGS.SIGNAL_SCORE &&
    sell > buy &&
    gap >=
      SETTINGS.SIGNAL_GAP
  ) {

    signal = "SELL";

  }


  let entry = null;

  let stopLoss = null;

  let tp1 = null;

  let tp2 = null;


  if (
    signal === "BUY"
  ) {

    entry = price;


    stopLoss =
      price -
      atrValue *
      SETTINGS.STOP_ATR;


    if (
      raid?.side ===
      "SELL_SIDE"
    ) {

      stopLoss =
        Math.min(

          stopLoss,

          raid
            .projectedSweepZone
            .low -
          atrValue * 0.1

        );

    }


    const risk =
      entry -
      stopLoss;


    tp1 =
      entry +
      risk *
      SETTINGS.TP1_R;


    tp2 =
      entry +
      risk *
      SETTINGS.TP2_R;

  }


  if (
    signal === "SELL"
  ) {

    entry = price;


    stopLoss =
      price +
      atrValue *
      SETTINGS.STOP_ATR;


    if (
      raid?.side ===
      "BUY_SIDE"
    ) {

      stopLoss =
        Math.max(

          stopLoss,

          raid
            .projectedSweepZone
            .high +
          atrValue * 0.1

        );

    }


    const risk =
      stopLoss -
      entry;


    tp1 =
      entry -
      risk *
      SETTINGS.TP1_R;


    tp2 =
      entry -
      risk *
      SETTINGS.TP2_R;

  }


  return {

    signal,

    buyScore:
      round(
        buy,
        1
      ),

    sellScore:
      round(
        sell,
        1
      ),

    confidence:
      round(
        Math.max(
          buy,
          sell
        ),
        1
      ),

    scoreGap:
      round(
        gap,
        1
      ),

    entry:
      round(entry),

    stopLoss:
      round(stopLoss),

    takeProfit1:
      round(tp1),

    takeProfit2:
      round(tp2),

    buyReasons,

    sellReasons

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
    "no-store, no-cache, must-revalidate"
  );


  try {

    const [

      ticker,

      m5,

      h1,

      d1

    ] =
      await Promise.all([

        fetchTicker(),

        fetchCandles(300),

        fetchCandles(3600),

        fetchCandles(86400)

      ]);


    const [

      trades,

      book

    ] =
      await Promise.all([

        optional(
          fetchTrades(),
          []
        ),

        optional(
          fetchBook(),
          null
        )

      ]);


    if (
      m5.length < 40
    ) {

      throw new Error(
        `Only ${m5.length} M5 candles returned`
      );

    }


    if (
      h1.length < 40
    ) {

      throw new Error(
        `Only ${h1.length} H1 candles returned`
      );

    }


    const price =
      num(
        ticker?.price,
        m5.at(-1)?.close
      );


    const m15 =
      resample(
        m5,
        15
      );


    const h4 =
      resample(
        h1,
        240
      );


    const atrValue =
      atr(
        m5,
        14
      );


    const M5 =
      structure(m5);


    const M15 =
      structure(m15);


    const H1 =
      structure(h1);


    const H4 =
      structure(h4);


    const daily =
      dailyLevels(d1);


    const weekly =
      weeklyLevels(d1);


    const sessionData =
      sessions(m5);


    const currentSession =
      activeSession();


    const currentVWAP =
      vwap(
        todayCandles(m5)
      );


    const swingData =
      swings(
        m15,
        2
      );


    const equalData =
      equalLiquidity(
        swingData,
        atrValue
      );


    const rounds =
      roundNumbers(price);


    const flow =
      tradeFlow(trades);


    const volume =
      volumeState(m5);


    const pools =
      liquidityPools({

        price,

        atrValue,

        daily,

        weekly,

        sessionData,

        swingData,

        equalData,

        rounds

      });


    const target =
      primaryPool(
        pools
      );


    const raid =
      raidAnalysis({

        pool:
          target,

        price,

        atrValue,

        candle:
          m5.at(-1),

        m15:
          M15,

        h1:
          H1,

        h4:
          H4,

        flow,

        volume

      });


    const rejectionData =
      rejection(
        m5.at(-1)
      );


    const trigger =
      breakTrigger(
        m5
      );


    const signal =
      signalEngine({

        price,

        atrValue,

        currentVWAP,

        raid,

        m5:
          M5,

        m15:
          M15,

        h1:
          H1,

        h4:
          H4,

        flow,

        rejectionData,

        trigger

      });


    const bullish =
      [
        M15,
        H1,
        H4
      ].filter(
        x =>
          x.bias ===
          "BULLISH"
      ).length;


    const bearish =
      [
        M15,
        H1,
        H4
      ].filter(
        x =>
          x.bias ===
          "BEARISH"
      ).length;


    let macroBias =
      "MIXED";


    if (bullish >= 2) {

      macroBias =
        "BULLISH";

    }


    if (bearish >= 2) {

      macroBias =
        "BEARISH";

    }


    const bestBid =
      num(
        book?.bids?.[0]?.[0],
        num(
          ticker?.bid,
          null
        )
      );


    const bestAsk =
      num(
        book?.asks?.[0]?.[0],
        num(
          ticker?.ask,
          null
        )
      );


    return res
      .status(200)
      .json({

        ok: true,

        engine:
          "MKAYFX BTC LIQUIDITY INTELLIGENCE V4",

        source:
          "Coinbase Exchange",

        product:
          PRODUCT,

        timestamp:
          new Date()
            .toISOString(),

        latencyMs:
          Date.now() -
          started,


        market: {

          price:
            round(price),

          bid:
            round(bestBid),

          ask:
            round(bestAsk),

          spread:

            bestBid &&
            bestAsk

              ? round(
                bestAsk -
                bestBid,
                2
              )

              : null

        },


        macroBias,


        timeframes: {

          M5,

          M15,

          H1,

          H4

        },


        volatility: {

          atr5m:
            round(
              atrValue
            ),

          atrPercent:
            round(
              atrValue /
              price *
              100,
              4
            )

        },


        vwap: {

          daily:
            round(
              currentVWAP
            ),

          position:

            price >
            currentVWAP

              ? "ABOVE"

              : "BELOW"

        },


        levels: {

          ...daily,

          ...weekly,

          roundNumberAbove:
            rounds.upper,

          roundNumberBelow:
            rounds.lower,

          majorRoundAbove:
            rounds.majorUpper,

          majorRoundBelow:
            rounds.majorLower

        },


        session:
          currentSession,


        sessionLevels:
          sessionData,


        flow,


        volume,


        raid,


        signal,


        liquidityPools:

          pools
            .slice(0, 15)
            .map(
              x => ({

                name:
                  x.name,

                level:
                  round(
                    x.level
                  ),

                side:
                  x.side,

                type:
                  x.type,

                distance:
                  round(
                    x.distance
                  ),

                distanceATR:
                  round(
                    x.distanceATR,
                    2
                  ),

                score:
                  round(
                    x.score
                  )

              })
            ),


        candles: {

          M5:
            m5.length,

          M15:
            m15.length,

          H1:
            h1.length,

          H4:
            h4.length,

          D1:
            d1.length

        }

      });

  }

  catch (error) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          errorText(error),

        timestamp:
          new Date()
            .toISOString(),

        latencyMs:
          Date.now() -
          started

      });

  }

};