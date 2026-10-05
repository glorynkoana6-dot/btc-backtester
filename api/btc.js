/* ============================================================
   MKAYFX BTC TREND + PULLBACK ENGINE
   /api/btc.js

   DATA SOURCE
   -----------
   Coinbase Exchange Public API

   PRODUCT
   -------
   BTC-USD

   NO API KEY REQUIRED

   STRATEGY
   --------
   H1 = main trend
   M15 = pullback + entry

   BUY
   ---
   H1 close > EMA200
   H1 EMA50 > EMA200

   M15 recently touches EMA20 / EMA50 zone
   M15 closes bullish above EMA20 + EMA50
   RSI > 52
   Strong candle
   ATR filter passes

   SELL
   ----
   H1 close < EMA200
   H1 EMA50 < EMA200

   M15 recently touches EMA20 / EMA50 zone
   M15 closes bearish below EMA20 + EMA50
   RSI < 48
   Strong candle
   ATR filter passes

   RISK
   ----
   SL  = 1.2 ATR
   TP1 = 1.5R
   TP2 = 2.2R
============================================================ */


const PRODUCT =
  "BTC-USD";


const COINBASE =
  "https://api.exchange.coinbase.com";


const SETTINGS = {

  rsiPeriod:
    14,

  atrPeriod:
    14,


  emaFast:
    20,

  emaPullback:
    50,


  h1Fast:
    50,

  h1Slow:
    200,


  buyRsi:
    52,

  sellRsi:
    48,


  stopAtr:
    1.2,

  tp1R:
    1.5,

  tp2R:
    2.2,


  minAtrPercent:
    0.10,

  maxAtrPercent:
    3.5,


  minBodyPercent:
    0.50,


  pullbackLookback:
    3

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
    10 ** digits;


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
      error.name
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
              "MKAYFX-BTC"

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

   Coinbase row:
   [
     time,
     low,
     high,
     open,
     close,
     volume
   ]
============================================================ */

async function fetchCandles(
  granularity
) {

  const url =
    `${COINBASE}/products/${PRODUCT}/candles` +
    `?granularity=${granularity}`;


  const raw =
    await getJSON(
      url
    );


  if (
    !Array.isArray(
      raw
    )
  ) {

    throw new Error(
      "Coinbase candle response was not an array"
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
     Remove the newest potentially-forming candle.

     Live strategy decisions should be based on
     completed candles.
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


  let sum =
    0;


  for (
    let i = 0;
    i <
      period;
    i++
  ) {

    sum +=
      values[i];

  }


  let current =
    sum /
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
  period = 14
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
  period = 14
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


  let sum =
    0;


  for (
    let i = 1;
    i <=
      period;
    i++
  ) {

    sum +=
      ranges[i];

  }


  let current =
    sum /
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
   CANDLE STRENGTH
============================================================ */

function candleStrength(
  candle
) {

  const range =
    candle.high -
    candle.low;


  if (
    range <=
    0
  ) {

    return 0;

  }


  return (

    Math.abs(
      candle.close -
      candle.open
    ) /

    range

  );

}


/* ============================================================
   PULLBACK CHECK
============================================================ */

function hadPullback(

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


    const upper =
      Math.max(
        ema20[i],
        ema50[i]
      );


    const lower =
      Math.min(
        ema20[i],
        ema50[i]
      );


    /*
       Candle overlaps the EMA20/EMA50 zone.
    */

    if (

      candles[i].low <=
        upper &&

      candles[i].high >=
        lower

    ) {

      return true;

    }

  }


  return false;

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

    /*
       Coinbase granularity:

       M15 = 900
       H1  = 3600
    */

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
      200
    ) {

      throw new Error(
        `Only ${h1.length} H1 candles returned`
      );

    }


    /* ======================================================
       M15
    ====================================================== */

    const m15Close =
      m15.map(
        candle =>
          candle.close
      );


    const m15EMA20 =
      ema(
        m15Close,
        SETTINGS.emaFast
      );


    const m15EMA50 =
      ema(
        m15Close,
        SETTINGS.emaPullback
      );


    const m15RSI =
      rsi(
        m15Close,
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

    const h1Close =
      h1.map(
        candle =>
          candle.close
      );


    const h1EMA50 =
      ema(
        h1Close,
        SETTINGS.h1Fast
      );


    const h1EMA200 =
      ema(
        h1Close,
        SETTINGS.h1Slow
      );


    /* ======================================================
       CURRENT COMPLETED CANDLES
    ====================================================== */

    const mi =
      m15.length -
      1;


    const hi =
      h1.length -
      1;


    const candle =
      m15[mi];


    const h1Candle =
      h1[hi];


    const livePrice =
      num(
        ticker?.price,
        candle.close
      );


    const atrNow =
      m15ATR[mi];


    const rsiNow =
      m15RSI[mi];


    const ema20Now =
      m15EMA20[mi];


    const ema50Now =
      m15EMA50[mi];


    const h1EMA50Now =
      h1EMA50[hi];


    const h1EMA200Now =
      h1EMA200[hi];


    if (

      atrNow === null ||

      rsiNow === null ||

      ema20Now === null ||

      ema50Now === null ||

      h1EMA50Now === null ||

      h1EMA200Now === null

    ) {

      throw new Error(
        "Indicator calculation incomplete"
      );

    }


    /* ======================================================
       H1 TREND
    ====================================================== */

    const h1Bullish =

      h1Candle.close >
      h1EMA200Now &&

      h1EMA50Now >
      h1EMA200Now;


    const h1Bearish =

      h1Candle.close <
      h1EMA200Now &&

      h1EMA50Now <
      h1EMA200Now;


    /* ======================================================
       ATR FILTER
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
       M15 CANDLE
    ====================================================== */

    const strength =
      candleStrength(
        candle
      );


    const strongEnough =

      strength >=
      SETTINGS.minBodyPercent;


    const bullishCandle =

      candle.close >
      candle.open;


    const bearishCandle =

      candle.close <
      candle.open;


    /* ======================================================
       PULLBACK
    ====================================================== */

    const pullback =
      hadPullback(

        m15,

        m15EMA20,

        m15EMA50,

        mi,

        SETTINGS.pullbackLookback

      );


    /* ======================================================
       CONFIRMATION
    ====================================================== */

    const buyConfirmation =

      bullishCandle &&

      candle.close >
      ema20Now &&

      candle.close >
      ema50Now;


    const sellConfirmation =

      bearishCandle &&

      candle.close <
      ema20Now &&

      candle.close <
      ema50Now;


    /* ======================================================
       SIGNAL
    ====================================================== */

    let signal =
      "WAIT";


    const reasons =
      [];


    if (

      h1Bullish &&

      pullback &&

      buyConfirmation &&

      rsiNow >
      SETTINGS.buyRsi &&

      strongEnough &&

      volatilityOk

    ) {

      signal =
        "BUY";


      reasons.push(

        "H1 price above EMA200",

        "H1 EMA50 above EMA200",

        "M15 pullback touched EMA zone",

        "M15 bullish close above EMA20 and EMA50",

        `RSI ${round(
          rsiNow,
          1
        )} > ${SETTINGS.buyRsi}`,

        "Strong M15 confirmation candle",

        "BTC volatility filter passed"

      );

    }


    else if (

      h1Bearish &&

      pullback &&

      sellConfirmation &&

      rsiNow <
      SETTINGS.sellRsi &&

      strongEnough &&

      volatilityOk

    ) {

      signal =
        "SELL";


      reasons.push(

        "H1 price below EMA200",

        "H1 EMA50 below EMA200",

        "M15 pullback touched EMA zone",

        "M15 bearish close below EMA20 and EMA50",

        `RSI ${round(
          rsiNow,
          1
        )} < ${SETTINGS.sellRsi}`,

        "Strong M15 confirmation candle",

        "BTC volatility filter passed"

      );

    }


    else {

      reasons.push(

        h1Bullish
          ? "H1 trend is bullish"
          : h1Bearish
            ? "H1 trend is bearish"
            : "H1 trend is mixed"

      );


      reasons.push(

        pullback
          ? "Recent M15 EMA pullback detected"
          : "Waiting for M15 pullback"

      );


      reasons.push(

        `M15 RSI ${round(
          rsiNow,
          1
        )}`

      );


      reasons.push(

        `M15 candle strength ${round(
          strength *
          100,
          1
        )}%`

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

      /*
         Use completed M15 close as strategy entry
         reference.

         In real execution the fill can differ slightly.
      */

      entry =
        candle.close;


      riskDistance =

        atrNow *
        SETTINGS.stopAtr;


      if (
        signal ===
        "BUY"
      ) {

        stopLoss =

          entry -
          riskDistance;


        takeProfit1 =

          entry +
          riskDistance *
          SETTINGS.tp1R;


        takeProfit2 =

          entry +
          riskDistance *
          SETTINGS.tp2R;

      }

      else {

        stopLoss =

          entry +
          riskDistance;


        takeProfit1 =

          entry -
          riskDistance *
          SETTINGS.tp1R;


        takeProfit2 =

          entry -
          riskDistance *
          SETTINGS.tp2R;

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
          "H1 Trend + M15 Pullback",

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
            livePrice,
            2
          ),


        entry:
          round(
            entry,
            2
          ),

        stopLoss:
          round(
            stopLoss,
            2
          ),

        takeProfit1:
          round(
            takeProfit1,
            2
          ),

        takeProfit2:
          round(
            takeProfit2,
            2
          ),

        riskDistance:
          round(
            riskDistance,
            2
          ),


        rr: {

          tp1:
            SETTINGS.tp1R,

          tp2:
            SETTINGS.tp2R

        },


        trend: {

          h1:

            h1Bullish
              ? "BULLISH"
              : h1Bearish
                ? "BEARISH"
                : "NEUTRAL",

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
              strength *
              100,
              1
            ),

          pullback

        },


        reasons

      });

  }

  catch (
    error
  ) {

    console.error(
      "BTC ENGINE ERROR:",
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