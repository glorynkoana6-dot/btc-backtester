/* ============================================================
   MKAYFX BTC PRECISION PULLBACK V2
   /api/btc.js

   SOURCE
   ------
   Coinbase Exchange Public API

   PRODUCT
   -------
   BTC-USD

   NO API KEY REQUIRED

   STRATEGY
   --------
   H4 = macro trend
   H1 = intraday trend
   M15 = rejection + entry

   BUY
   ---
   H4 EMA20 > EMA50
   H4 close > EMA20

   H1 EMA50 > EMA200
   H1 close > EMA200

   M15 recently interacts with EMA20/EMA50 zone
   M15 rejects upward
   M15 closes above EMA20 + EMA50
   Close is in top 25% of candle
   RSI between 52 and 68
   Candle body >= 55%
   Price not stretched > 0.80 ATR from EMA20

   SELL
   ----
   Opposite rules

   RISK
   ----
   SL = structural / ATR stop
   TP = 1.5R
============================================================ */


const PRODUCT =
  "BTC-USD";


const COINBASE =
  "https://api.exchange.coinbase.com";


const SETTINGS = {

  /* ========================================================
     INDICATORS
  ======================================================== */

  atrPeriod:
    14,

  rsiPeriod:
    14,

  m15EmaFast:
    20,

  m15EmaSlow:
    50,

  h1EmaFast:
    50,

  h1EmaSlow:
    200,

  h4EmaFast:
    20,

  h4EmaSlow:
    50,


  /* ========================================================
     RSI
  ======================================================== */

  buyRsiMin:
    52,

  buyRsiMax:
    68,

  sellRsiMin:
    32,

  sellRsiMax:
    48,


  /* ========================================================
     ENTRY QUALITY
  ======================================================== */

  pullbackLookback:
    3,

  minBodyPercent:
    0.55,

  buyCloseLocation:
    0.75,

  sellCloseLocation:
    0.25,

  minRejectionWickPercent:
    0.12,

  maxDistanceFromEma20Atr:
    0.80,


  /* ========================================================
     VOLATILITY
  ======================================================== */

  minAtrPercent:
    0.10,

  maxAtrPercent:
    2.50,


  /* ========================================================
     RISK
  ======================================================== */

  stopAtr:
    1.10,

  structureBufferAtr:
    0.10,

  targetR:
    1.50

};


/* ============================================================
   HELPERS
============================================================ */

function num(
  value,
  fallback = null
) {

  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )
    ? n
    : fallback;

}


function round(
  value,
  digits = 2
) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(
        value
      )
    )
  ) {

    return null;

  }


  const power =
    10 **
    digits;


  return (
    Math.round(
      Number(
        value
      ) *
      power
    ) /
    power
  );

}


function errorText(
  error
) {

  if (
    error instanceof Error
  ) {

    return (
      error.message ||
      error.name ||
      "Unknown error"
    );

  }


  if (
    typeof error ===
    "string"
  ) {

    return error;

  }


  try {

    return JSON.stringify(
      error
    );

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
  timeoutMs = 8000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );


  try {

    const response =
      await fetch(
        url,
        {

          method:
            "GET",

          cache:
            "no-store",

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "MKAYFX-BTC-PRECISION-V2"

          },

          signal:
            controller.signal

        }
      );


    const text =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(
          text
        );

    }

    catch {

      throw new Error(
        `Coinbase returned invalid JSON (${response.status})`
      );

    }


    if (
      !response.ok
    ) {

      throw new Error(
        data?.message ||
        `Coinbase HTTP ${response.status}`
      );

    }


    return data;

  }

  catch (
    error
  ) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        "Coinbase request timed out"
      );

    }


    throw new Error(
      errorText(
        error
      )
    );

  }

  finally {

    clearTimeout(
      timer
    );

  }

}


/* ============================================================
   COINBASE CANDLES
============================================================ */

async function fetchCandles(
  granularity
) {

  const raw =
    await getJSON(

      `${COINBASE}/products/${PRODUCT}/candles` +
      `?granularity=${granularity}`

    );


  if (
    !Array.isArray(
      raw
    )
  ) {

    throw new Error(
      "Coinbase candles response was not an array"
    );

  }


  const candles =
    raw
      .map(
        row => ({

          timestamp:
            Number(
              row[0]
            ) *
            1000,

          datetime:
            new Date(
              Number(
                row[0]
              ) *
              1000
            ).toISOString(),

          low:
            Number(
              row[1]
            ),

          high:
            Number(
              row[2]
            ),

          open:
            Number(
              row[3]
            ),

          close:
            Number(
              row[4]
            ),

          volume:
            Number(
              row[5]
            )

        })
      )
      .filter(
        candle =>

          candle.timestamp >
            0 &&

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
        (
          a,
          b
        ) =>
          a.timestamp -
          b.timestamp
      );


  /*
     Remove potentially still-forming bar.
  */

  if (
    candles.length >
    2
  ) {

    candles.pop();

  }


  return candles;

}


/* ============================================================
   TICKER
============================================================ */

async function fetchTicker() {

  return getJSON(
    `${COINBASE}/products/${PRODUCT}/ticker`
  );

}


/* ============================================================
   H1 -> H4 RESAMPLE
============================================================ */

function resampleH4(
  h1
) {

  const interval =
    4 *
    60 *
    60 *
    1000;


  const map =
    new Map();


  for (
    const candle of
    h1
  ) {

    const key =
      Math.floor(
        candle.timestamp /
        interval
      ) *
      interval;


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        {

          timestamp:
            key,

          datetime:
            new Date(
              key
            ).toISOString(),

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

      const bucket =
        map.get(
          key
        );


      bucket.high =
        Math.max(
          bucket.high,
          candle.high
        );


      bucket.low =
        Math.min(
          bucket.low,
          candle.low
        );


      bucket.close =
        candle.close;


      bucket.volume +=
        candle.volume;

    }

  }


  const result =
    [
      ...map.values()
    ].sort(
      (
        a,
        b
      ) =>
        a.timestamp -
        b.timestamp
    );


  /*
     H1 data already contains completed H1 bars.
     But the final H4 bucket may not contain all four H1 bars.

     Remove it unless 4 hours have elapsed.
  */

  if (
    result.length
  ) {

    const latest =
      result.at(-1);


    const expectedEnd =
      latest.timestamp +
      interval;


    if (
      expectedEnd >
      Date.now()
    ) {

      result.pop();

    }

  }


  return result;

}


/* ============================================================
   EMA
============================================================ */

function ema(
  values,
  period
) {

  const output =
    new Array(
      values.length
    ).fill(
      null
    );


  if (
    values.length <
    period
  ) {

    return output;

  }


  let total =
    0;


  for (
    let i = 0;
    i <
      period;
    i++
  ) {

    total +=
      values[i];

  }


  let current =
    total /
    period;


  output[
    period -
    1
  ] =
    current;


  const multiplier =
    2 /
    (
      period +
      1
    );


  for (
    let i =
      period;
    i <
      values.length;
    i++
  ) {

    current =

      (
        values[i] -
        current
      ) *
      multiplier +

      current;


    output[i] =
      current;

  }


  return output;

}


/* ============================================================
   RSI
============================================================ */

function rsi(
  values,
  period
) {

  const output =
    new Array(
      values.length
    ).fill(
      null
    );


  if (
    values.length <=
    period
  ) {

    return output;

  }


  let gains =
    0;


  let losses =
    0;


  for (
    let i = 1;
    i <=
      period;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];


    if (
      change >
      0
    ) {

      gains +=
        change;

    }

    else {

      losses +=
        Math.abs(
          change
        );

    }

  }


  let averageGain =
    gains /
    period;


  let averageLoss =
    losses /
    period;


  output[period] =

    averageLoss ===
    0

      ? 100

      : 100 -
        100 /
        (
          1 +
          averageGain /
          averageLoss
        );


  for (
    let i =
      period +
      1;
    i <
      values.length;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];


    const gain =
      Math.max(
        change,
        0
      );


    const loss =
      Math.max(
        -change,
        0
      );


    averageGain =
      (
        averageGain *
        (
          period -
          1
        ) +
        gain
      ) /
      period;


    averageLoss =
      (
        averageLoss *
        (
          period -
          1
        ) +
        loss
      ) /
      period;


    output[i] =

      averageLoss ===
      0

        ? 100

        : 100 -
          100 /
          (
            1 +
            averageGain /
            averageLoss
          );

  }


  return output;

}


/* ============================================================
   ATR
============================================================ */

function atr(
  candles,
  period
) {

  const output =
    new Array(
      candles.length
    ).fill(
      null
    );


  if (
    candles.length <=
    period
  ) {

    return output;

  }


  const ranges =
    new Array(
      candles.length
    ).fill(
      null
    );


  for (
    let i = 1;
    i <
      candles.length;
    i++
  ) {

    ranges[i] =
      Math.max(

        candles[i].high -
        candles[i].low,

        Math.abs(
          candles[i].high -
          candles[i - 1].close
        ),

        Math.abs(
          candles[i].low -
          candles[i - 1].close
        )

      );

  }


  let total =
    0;


  for (
    let i = 1;
    i <=
      period;
    i++
  ) {

    total +=
      ranges[i];

  }


  let current =
    total /
    period;


  output[period] =
    current;


  for (
    let i =
      period +
      1;
    i <
      candles.length;
    i++
  ) {

    current =
      (
        current *
        (
          period -
          1
        ) +
        ranges[i]
      ) /
      period;


    output[i] =
      current;

  }


  return output;

}


/* ============================================================
   CANDLE METRICS
============================================================ */

function candleMetrics(
  candle
) {

  const range =
    candle.high -
    candle.low;


  if (
    range <=
    0
  ) {

    return {

      bodyPercent:
        0,

      closeLocation:
        0.5,

      upperWickPercent:
        0,

      lowerWickPercent:
        0

    };

  }


  const body =
    Math.abs(
      candle.close -
      candle.open
    );


  const upperBody =
    Math.max(
      candle.open,
      candle.close
    );


  const lowerBody =
    Math.min(
      candle.open,
      candle.close
    );


  return {

    bodyPercent:
      body /
      range,

    closeLocation:
      (
        candle.close -
        candle.low
      ) /
      range,

    upperWickPercent:
      (
        candle.high -
        upperBody
      ) /
      range,

    lowerWickPercent:
      (
        lowerBody -
        candle.low
      ) /
      range

  };

}


/* ============================================================
   EMA ZONE INTERACTION
============================================================ */

function recentZoneInteraction(

  candles,

  ema20,

  ema50,

  index,

  lookback

) {

  const start =
    Math.max(

      0,

      index -
      lookback +
      1

    );


  for (
    let i =
      start;
    i <=
      index;
    i++
  ) {

    if (
      ema20[i] ===
        null ||
      ema50[i] ===
        null
    ) {

      continue;

    }


    const zoneHigh =
      Math.max(
        ema20[i],
        ema50[i]
      );


    const zoneLow =
      Math.min(
        ema20[i],
        ema50[i]
      );


    if (

      candles[i].low <=
        zoneHigh &&

      candles[i].high >=
        zoneLow

    ) {

      return true;

    }

  }


  return false;

}


/* ============================================================
   STRUCTURAL STOP
============================================================ */

function recentSwingLow(
  candles,
  lookback = 4
) {

  const recent =
    candles.slice(
      -lookback
    );


  return Math.min(
    ...recent.map(
      candle =>
        candle.low
    )
  );

}


function recentSwingHigh(
  candles,
  lookback = 4
) {

  const recent =
    candles.slice(
      -lookback
    );


  return Math.max(
    ...recent.map(
      candle =>
        candle.high
    )
  );

}


/* ============================================================
   MAIN
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

      m15,

      h1,

      ticker

    ] =
      await Promise.all([

        fetchCandles(
          900
        ),

        fetchCandles(
          3600
        ),

        fetchTicker()

      ]);


    const h4 =
      resampleH4(
        h1
      );


    if (
      m15.length <
      100
    ) {

      throw new Error(
        `Only ${m15.length} M15 candles returned`
      );

    }


    if (
      h1.length <
      210
    ) {

      throw new Error(
        `Only ${h1.length} H1 candles returned`
      );

    }


    if (
      h4.length <
      50
    ) {

      throw new Error(
        `Only ${h4.length} completed H4 candles available`
      );

    }


    /* ======================================================
       M15 INDICATORS
    ====================================================== */

    const m15Closes =
      m15.map(
        candle =>
          candle.close
      );


    const m15EMA20 =
      ema(
        m15Closes,
        SETTINGS.m15EmaFast
      );


    const m15EMA50 =
      ema(
        m15Closes,
        SETTINGS.m15EmaSlow
      );


    const m15RSI =
      rsi(
        m15Closes,
        SETTINGS.rsiPeriod
      );


    const m15ATR =
      atr(
        m15,
        SETTINGS.atrPeriod
      );


    /* ======================================================
       H1
    ====================================================== */

    const h1Closes =
      h1.map(
        candle =>
          candle.close
      );


    const h1EMA50 =
      ema(
        h1Closes,
        SETTINGS.h1EmaFast
      );


    const h1EMA200 =
      ema(
        h1Closes,
        SETTINGS.h1EmaSlow
      );


    /* ======================================================
       H4
    ====================================================== */

    const h4Closes =
      h4.map(
        candle =>
          candle.close
      );


    const h4EMA20 =
      ema(
        h4Closes,
        SETTINGS.h4EmaFast
      );


    const h4EMA50 =
      ema(
        h4Closes,
        SETTINGS.h4EmaSlow
      );


    /* ======================================================
       CURRENT
    ====================================================== */

    const mi =
      m15.length -
      1;


    const hi =
      h1.length -
      1;


    const h4i =
      h4.length -
      1;


    const candle =
      m15[mi];


    const h1Candle =
      h1[hi];


    const h4Candle =
      h4[h4i];


    const livePrice =
      num(
        ticker?.price,
        candle.close
      );


    const ema20Now =
      m15EMA20[mi];


    const ema50Now =
      m15EMA50[mi];


    const rsiNow =
      m15RSI[mi];


    const atrNow =
      m15ATR[mi];


    const h1EMA50Now =
      h1EMA50[hi];


    const h1EMA200Now =
      h1EMA200[hi];


    const h4EMA20Now =
      h4EMA20[h4i];


    const h4EMA50Now =
      h4EMA50[h4i];


    if (

      ema20Now ===
        null ||

      ema50Now ===
        null ||

      rsiNow ===
        null ||

      atrNow ===
        null ||

      h1EMA50Now ===
        null ||

      h1EMA200Now ===
        null ||

      h4EMA20Now ===
        null ||

      h4EMA50Now ===
        null

    ) {

      throw new Error(
        "Indicators are not ready"
      );

    }


    /* ======================================================
       TREND
    ====================================================== */

    const h4Bullish =

      h4EMA20Now >
      h4EMA50Now &&

      h4Candle.close >
      h4EMA20Now;


    const h4Bearish =

      h4EMA20Now <
      h4EMA50Now &&

      h4Candle.close <
      h4EMA20Now;


    const h1Bullish =

      h1EMA50Now >
      h1EMA200Now &&

      h1Candle.close >
      h1EMA200Now;


    const h1Bearish =

      h1EMA50Now <
      h1EMA200Now &&

      h1Candle.close <
      h1EMA200Now;


    const bullishAlignment =

      h4Bullish &&
      h1Bullish;


    const bearishAlignment =

      h4Bearish &&
      h1Bearish;


    /* ======================================================
       M15 QUALITY
    ====================================================== */

    const metrics =
      candleMetrics(
        candle
      );


    const zoneInteraction =
      recentZoneInteraction(

        m15,

        m15EMA20,

        m15EMA50,

        mi,

        SETTINGS.pullbackLookback

      );


    const bullishCandle =

      candle.close >
      candle.open;


    const bearishCandle =

      candle.close <
      candle.open;


    const buyRejection =

      bullishCandle &&

      metrics.lowerWickPercent >=
      SETTINGS.minRejectionWickPercent &&

      metrics.closeLocation >=
      SETTINGS.buyCloseLocation &&

      candle.close >
      ema20Now &&

      candle.close >
      ema50Now;


    const sellRejection =

      bearishCandle &&

      metrics.upperWickPercent >=
      SETTINGS.minRejectionWickPercent &&

      metrics.closeLocation <=
      SETTINGS.sellCloseLocation &&

      candle.close <
      ema20Now &&

      candle.close <
      ema50Now;


    const bodyStrong =

      metrics.bodyPercent >=
      SETTINGS.minBodyPercent;


    /* ======================================================
       RSI WINDOW
    ====================================================== */

    const buyRsiOk =

      rsiNow >=
      SETTINGS.buyRsiMin &&

      rsiNow <=
      SETTINGS.buyRsiMax;


    const sellRsiOk =

      rsiNow >=
      SETTINGS.sellRsiMin &&

      rsiNow <=
      SETTINGS.sellRsiMax;


    /* ======================================================
       STRETCH
    ====================================================== */

    const distanceFromEMA20 =

      Math.abs(
        candle.close -
        ema20Now
      );


    const distanceFromEMA20ATR =

      atrNow >
      0

        ? distanceFromEMA20 /
          atrNow

        : 999;


    const notStretched =

      distanceFromEMA20ATR <=
      SETTINGS.maxDistanceFromEma20Atr;


    /* ======================================================
       VOLATILITY
    ====================================================== */

    const atrPercent =

      atrNow /
      candle.close *
      100;


    const volatilityOk =

      atrPercent >=
      SETTINGS.minAtrPercent &&

      atrPercent <=
      SETTINGS.maxAtrPercent;


    /* ======================================================
       SIGNAL
    ====================================================== */

    let signal =
      "WAIT";


    const reasons =
      [];


    if (

      bullishAlignment &&

      zoneInteraction &&

      buyRejection &&

      bodyStrong &&

      buyRsiOk &&

      notStretched &&

      volatilityOk

    ) {

      signal =
        "BUY";


      reasons.push(

        "H4 and H1 trends are bullish",

        "M15 pulled into EMA20/EMA50 zone",

        "M15 produced bullish rejection",

        "Candle closed in top 25% of its range",

        `RSI ${round(
          rsiNow,
          1
        )} is inside BUY momentum window`,

        "Confirmation candle body is strong",

        "Entry is not stretched from EMA20",

        "ATR volatility filter passed"

      );

    }


    else if (

      bearishAlignment &&

      zoneInteraction &&

      sellRejection &&

      bodyStrong &&

      sellRsiOk &&

      notStretched &&

      volatilityOk

    ) {

      signal =
        "SELL";


      reasons.push(

        "H4 and H1 trends are bearish",

        "M15 pulled into EMA20/EMA50 zone",

        "M15 produced bearish rejection",

        "Candle closed in bottom 25% of its range",

        `RSI ${round(
          rsiNow,
          1
        )} is inside SELL momentum window`,

        "Confirmation candle body is strong",

        "Entry is not stretched from EMA20",

        "ATR volatility filter passed"

      );

    }


    else {

      reasons.push(

        bullishAlignment
          ? "H4 + H1 bullish alignment"
          : bearishAlignment
            ? "H4 + H1 bearish alignment"
            : "H4 and H1 are not aligned"

      );


      reasons.push(

        zoneInteraction
          ? "Recent M15 EMA pullback exists"
          : "Waiting for M15 EMA pullback"

      );


      reasons.push(

        buyRejection
          ? "Bullish M15 rejection confirmed"
          : sellRejection
            ? "Bearish M15 rejection confirmed"
            : "Waiting for strong M15 rejection"

      );


      reasons.push(

        `M15 RSI ${round(
          rsiNow,
          1
        )}`

      );


      reasons.push(

        `Candle body ${round(
          metrics.bodyPercent *
          100,
          1
        )}%`

      );


      reasons.push(

        `EMA20 distance ${round(
          distanceFromEMA20ATR,
          2
        )} ATR`

      );


      reasons.push(

        volatilityOk
          ? "ATR volatility acceptable"
          : "ATR volatility blocked"

      );

    }


    /* ======================================================
       TRADE LEVELS
    ====================================================== */

    let entry =
      null;


    let stopLoss =
      null;


    let takeProfit1 =
      null;


    let takeProfit2 =
      null;


    let riskDistance =
      null;


    if (
      signal !==
      "WAIT"
    ) {

      entry =
        candle.close;


      const recentBars =
        m15.slice(
          -4
        );


      if (
        signal ===
        "BUY"
      ) {

        const atrStop =

          entry -
          atrNow *
          SETTINGS.stopAtr;


        const swingStop =

          recentSwingLow(
            recentBars,
            4
          ) -

          atrNow *
          SETTINGS.structureBufferAtr;


        stopLoss =
          Math.min(
            atrStop,
            swingStop
          );


        riskDistance =

          entry -
          stopLoss;


        takeProfit1 =

          entry +
          riskDistance *
          SETTINGS.targetR;


        takeProfit2 =
          takeProfit1;

      }


      else {

        const atrStop =

          entry +
          atrNow *
          SETTINGS.stopAtr;


        const swingStop =

          recentSwingHigh(
            recentBars,
            4
          ) +

          atrNow *
          SETTINGS.structureBufferAtr;


        stopLoss =
          Math.max(
            atrStop,
            swingStop
          );


        riskDistance =

          stopLoss -
          entry;


        takeProfit1 =

          entry -
          riskDistance *
          SETTINGS.targetR;


        takeProfit2 =
          takeProfit1;

      }

    }


    /* ======================================================
       RESPONSE
    ====================================================== */

    return res
      .status(200)
      .json({

        ok:
          true,

        source:
          "Coinbase Exchange",

        product:
          PRODUCT,

        strategy:
          "H4 + H1 Trend / M15 EMA Rejection",

        signal,

        timestamp:
          new Date()
            .toISOString(),

        candleTime:
          candle.datetime,

        latencyMs:
          Date.now() -
          started,


        price:
          round(
            livePrice
          ),


        entry:
          round(
            entry
          ),

        stopLoss:
          round(
            stopLoss
          ),

        takeProfit1:
          round(
            takeProfit1
          ),

        takeProfit2:
          round(
            takeProfit2
          ),

        riskDistance:
          round(
            riskDistance
          ),


        rr: {

          tp1:
            SETTINGS.targetR,

          tp2:
            SETTINGS.targetR

        },


        trend: {

          h4:

            h4Bullish
              ? "BULLISH"
              : h4Bearish
                ? "BEARISH"
                : "NEUTRAL",

          h1:

            h1Bullish
              ? "BULLISH"
              : h1Bearish
                ? "BEARISH"
                : "NEUTRAL",

          aligned:

            bullishAlignment
              ? "BULLISH"
              : bearishAlignment
                ? "BEARISH"
                : "NO"

        },


        h4: {

          close:
            round(
              h4Candle.close
            ),

          ema20:
            round(
              h4EMA20Now
            ),

          ema50:
            round(
              h4EMA50Now
            )

        },


        h1: {

          close:
            round(
              h1Candle.close
            ),

          ema50:
            round(
              h1EMA50Now
            ),

          ema200:
            round(
              h1EMA200Now
            )

        },


        m15: {

          close:
            round(
              candle.close
            ),

          ema20:
            round(
              ema20Now
            ),

          ema50:
            round(
              ema50Now
            ),

          rsi:
            round(
              rsiNow,
              2
            ),

          atr:
            round(
              atrNow,
              2
            ),

          atrPercent:
            round(
              atrPercent,
              3
            ),

          candleStrength:
            round(
              metrics.bodyPercent *
              100,
              1
            ),

          closeLocation:
            round(
              metrics.closeLocation *
              100,
              1
            ),

          lowerWickPercent:
            round(
              metrics.lowerWickPercent *
              100,
              1
            ),

          upperWickPercent:
            round(
              metrics.upperWickPercent *
              100,
              1
            ),

          distanceFromEMA20ATR:
            round(
              distanceFromEMA20ATR,
              2
            ),

          pullback:
            zoneInteraction

        },


        reasons

      });

  }

  catch (
    error
  ) {

    console.error(
      "BTC V2 ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        source:
          "Coinbase Exchange",

        error:
          errorText(
            error
          ),

        latencyMs:
          Date.now() -
          started

      });

  }

};