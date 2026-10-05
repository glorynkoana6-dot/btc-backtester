/* ============================================================
   MKAYFX BTC PRECISION PULLBACK BACKTEST V2
   /api/backtest.js

   SOURCE
   ------
   Coinbase Exchange

   PRODUCT
   -------
   BTC-USD

   STRATEGY
   --------
   H4 + H1 aligned trend
   M15 EMA20/EMA50 rejection entry

   ENTRY
   -----
   Signal is confirmed at M15 close.
   Trade enters NEXT M15 candle OPEN.

   RISK
   ----
   Structural / ATR stop
   Target = 1.5R
   No automatic breakeven

   SAME-CANDLE TP + SL
   -------------------
   Count STOP first.
   Conservative assumption.

   NO API KEY.
============================================================ */


const PRODUCT =
  "BTC-USD";


const COINBASE =
  "https://api.exchange.coinbase.com";


const SETTINGS = {

  defaultDays:
    30,

  maxDays:
    90,


  warmupDays:
    12,


  chunkCandles:
    280,


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


  buyRsiMin:
    52,

  buyRsiMax:
    68,

  sellRsiMin:
    32,

  sellRsiMax:
    48,


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


  minAtrPercent:
    0.10,

  maxAtrPercent:
    2.50,


  stopAtr:
    1.10,

  structureBufferAtr:
    0.10,

  targetR:
    1.50,


  cooldownBars:
    2,

  maxHoldBars:
    48

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


function clamp(
  value,
  minimum,
  maximum
) {

  return Math.max(
    minimum,
    Math.min(
      maximum,
      value
    )
  );

}


function sleep(
  milliseconds
) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
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
  timeoutMs = 9000
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
              "MKAYFX-BTC-BACKTEST-V2"

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
        `Invalid Coinbase JSON (${response.status})`
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
   FETCH CHUNK
============================================================ */

async function fetchChunk(

  granularity,

  startSeconds,

  endSeconds

) {

  const raw =
    await getJSON(

      `${COINBASE}/products/${PRODUCT}/candles` +

      `?granularity=${granularity}` +

      `&start=${startSeconds}` +

      `&end=${endSeconds}`

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


  return raw
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

}


/* ============================================================
   FETCH HISTORY
============================================================ */

async function fetchHistory(

  granularity,

  startSeconds,

  endSeconds

) {

  const duration =

    granularity *
    SETTINGS.chunkCandles;


  const windows =
    [];


  let cursor =
    startSeconds;


  while (
    cursor <
    endSeconds
  ) {

    const next =
      Math.min(

        cursor +
        duration,

        endSeconds

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


  const all =
    [];


  for (
    let i = 0;
    i <
      windows.length;
    i += 4
  ) {

    const batch =
      windows.slice(
        i,
        i +
        4
      );


    const results =
      await Promise.all(

        batch.map(
          window =>

            fetchChunk(

              granularity,

              window.start,

              window.end

            )

        )

      );


    for (
      const result of
      results
    ) {

      all.push(
        ...result
      );

    }


    if (
      i +
      4 <
      windows.length
    ) {

      await sleep(
        100
      );

    }

  }


  const unique =
    new Map();


  for (
    const candle of
    all
  ) {

    unique.set(
      candle.timestamp,
      candle
    );

  }


  return [
    ...unique.values()
  ].sort(
    (
      a,
      b
    ) =>
      a.timestamp -
      b.timestamp
  );

}


/* ============================================================
   H1 -> H4
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

          closeTime:
            key +
            interval,

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


  return [
    ...map.values()
  ].sort(
    (
      a,
      b
    ) =>
      a.timestamp -
      b.timestamp
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

      Math.abs(
        candle.close -
        candle.open
      ) /
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
   PULLBACK
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


    const high =
      Math.max(
        ema20[i],
        ema50[i]
      );


    const low =
      Math.min(
        ema20[i],
        ema50[i]
      );


    if (

      candles[i].low <=
        high &&

      candles[i].high >=
        low

    ) {

      return true;

    }

  }


  return false;

}


/* ============================================================
   COMPLETED H1 INDEX
============================================================ */

function completedH1Index(

  h1,

  signalTimestamp,

  startingIndex

) {

  const cutoff =

    signalTimestamp -

    60 *
    60 *
    1000;


  let index =
    Math.max(
      0,
      startingIndex
    );


  while (

    index +
      1 <
      h1.length &&

    h1[
      index +
      1
    ].timestamp <=
      cutoff

  ) {

    index++;

  }


  if (

    h1[index] &&

    h1[index].timestamp <=
    cutoff

  ) {

    return index;

  }


  return -1;

}


/* ============================================================
   COMPLETED H4 INDEX
============================================================ */

function completedH4Index(

  h4,

  signalTimestamp,

  startingIndex

) {

  let index =
    Math.max(
      0,
      startingIndex
    );


  while (

    index +
      1 <
      h4.length &&

    h4[
      index +
      1
    ].closeTime <=
      signalTimestamp

  ) {

    index++;

  }


  if (

    h4[index] &&

    h4[index].closeTime <=
    signalTimestamp

  ) {

    return index;

  }


  return -1;

}


/* ============================================================
   RUN BACKTEST
============================================================ */

function runBacktest(
  m15,
  h1
) {

  const h4 =
    resampleH4(
      h1
    );


  const m15Close =
    m15.map(
      candle =>
        candle.close
    );


  const h1Close =
    h1.map(
      candle =>
        candle.close
    );


  const h4Close =
    h4.map(
      candle =>
        candle.close
    );


  const mEMA20 =
    ema(
      m15Close,
      SETTINGS.m15EmaFast
    );


  const mEMA50 =
    ema(
      m15Close,
      SETTINGS.m15EmaSlow
    );


  const mRSI =
    rsi(
      m15Close,
      SETTINGS.rsiPeriod
    );


  const mATR =
    atr(
      m15,
      SETTINGS.atrPeriod
    );


  const h1EMA50 =
    ema(
      h1Close,
      SETTINGS.h1EmaFast
    );


  const h1EMA200 =
    ema(
      h1Close,
      SETTINGS.h1EmaSlow
    );


  const h4EMA20 =
    ema(
      h4Close,
      SETTINGS.h4EmaFast
    );


  const h4EMA50 =
    ema(
      h4Close,
      SETTINGS.h4EmaSlow
    );


  const trades =
    [];


  let activeTrade =
    null;


  let cooldownUntil =
    -1;


  let h1Index =
    0;


  let h4Index =
    0;


  for (
    let i = 60;
    i <
      m15.length -
      1;
    i++
  ) {

    const candle =
      m15[i];


    /* ======================================================
       MANAGE TRADE
    ====================================================== */

    if (
      activeTrade
    ) {

      let exit =
        null;


      let resultR =
        null;


      let exitReason =
        null;


      /* ====================================================
         BUY
      ==================================================== */

      if (
        activeTrade.side ===
        "BUY"
      ) {

        const stopHit =

          candle.low <=
          activeTrade.stop;


        const targetHit =

          candle.high >=
          activeTrade.target;


        /*
           If both occur:
           conservative = stop.
        */

        if (
          stopHit
        ) {

          exit =
            activeTrade.stop;


          resultR =
            -1;


          exitReason =
            "SL";

        }

        else if (
          targetHit
        ) {

          exit =
            activeTrade.target;


          resultR =
            SETTINGS.targetR;


          exitReason =
            "TP";

        }

      }


      /* ====================================================
         SELL
      ==================================================== */

      else {

        const stopHit =

          candle.high >=
          activeTrade.stop;


        const targetHit =

          candle.low <=
          activeTrade.target;


        if (
          stopHit
        ) {

          exit =
            activeTrade.stop;


          resultR =
            -1;


          exitReason =
            "SL";

        }

        else if (
          targetHit
        ) {

          exit =
            activeTrade.target;


          resultR =
            SETTINGS.targetR;


          exitReason =
            "TP";

        }

      }


      /* ====================================================
         TIME EXIT
      ==================================================== */

      const heldBars =

        i -
        activeTrade.entryIndex;


      if (

        exit ===
          null &&

        heldBars >=
          SETTINGS.maxHoldBars

      ) {

        exit =
          candle.close;


        resultR =

          activeTrade.side ===
          "BUY"

            ? (
              exit -
              activeTrade.entry
            ) /
              activeTrade.risk

            : (
              activeTrade.entry -
              exit
            ) /
              activeTrade.risk;


        exitReason =
          "TIME";

      }


      /* ====================================================
         RECORD
      ==================================================== */

      if (
        exit !==
        null
      ) {

        trades.push({

          side:
            activeTrade.side,

          entryTime:
            activeTrade.entryTime,

          exitTime:
            candle.datetime,

          entry:
            round(
              activeTrade.entry
            ),

          stop:
            round(
              activeTrade.stop
            ),

          target:
            round(
              activeTrade.target
            ),

          exit:
            round(
              exit
            ),

          resultR:
            round(
              resultR,
              3
            ),

          exitReason,

          h4Trend:
            activeTrade.h4Trend,

          h1Trend:
            activeTrade.h1Trend,

          rsi:
            activeTrade.rsi

        });


        activeTrade =
          null;


        cooldownUntil =

          i +
          SETTINGS.cooldownBars;

      }


      continue;

    }


    /* ======================================================
       COOLDOWN
    ====================================================== */

    if (
      i <=
      cooldownUntil
    ) {

      continue;

    }


    /* ======================================================
       M15 READY
    ====================================================== */

    if (

      mEMA20[i] ===
        null ||

      mEMA50[i] ===
        null ||

      mRSI[i] ===
        null ||

      mATR[i] ===
        null

    ) {

      continue;

    }


    /* ======================================================
       COMPLETED H1
    ====================================================== */

    h1Index =
      completedH1Index(

        h1,

        candle.timestamp,

        h1Index

      );


    if (
      h1Index <
      199
    ) {

      continue;

    }


    /* ======================================================
       COMPLETED H4
    ====================================================== */

    h4Index =
      completedH4Index(

        h4,

        candle.timestamp,

        h4Index

      );


    if (
      h4Index <
      49
    ) {

      continue;

    }


    if (

      h1EMA50[
        h1Index
      ] ===
        null ||

      h1EMA200[
        h1Index
      ] ===
        null ||

      h4EMA20[
        h4Index
      ] ===
        null ||

      h4EMA50[
        h4Index
      ] ===
        null

    ) {

      continue;

    }


    /* ======================================================
       TREND
    ====================================================== */

    const h4Bullish =

      h4EMA20[
        h4Index
      ] >
      h4EMA50[
        h4Index
      ] &&

      h4[
        h4Index
      ].close >
      h4EMA20[
        h4Index
      ];


    const h4Bearish =

      h4EMA20[
        h4Index
      ] <
      h4EMA50[
        h4Index
      ] &&

      h4[
        h4Index
      ].close <
      h4EMA20[
        h4Index
      ];


    const h1Bullish =

      h1EMA50[
        h1Index
      ] >
      h1EMA200[
        h1Index
      ] &&

      h1[
        h1Index
      ].close >
      h1EMA200[
        h1Index
      ];


    const h1Bearish =

      h1EMA50[
        h1Index
      ] <
      h1EMA200[
        h1Index
      ] &&

      h1[
        h1Index
      ].close <
      h1EMA200[
        h1Index
      ];


    const bullishAlignment =

      h4Bullish &&
      h1Bullish;


    const bearishAlignment =

      h4Bearish &&
      h1Bearish;


    if (
      !bullishAlignment &&
      !bearishAlignment
    ) {

      continue;

    }


    /* ======================================================
       VOLATILITY
    ====================================================== */

    const atrPercent =

      mATR[i] /
      candle.close *
      100;


    if (

      atrPercent <
        SETTINGS.minAtrPercent ||

      atrPercent >
        SETTINGS.maxAtrPercent

    ) {

      continue;

    }


    /* ======================================================
       EMA INTERACTION
    ====================================================== */

    const pullback =
      recentZoneInteraction(

        m15,

        mEMA20,

        mEMA50,

        i,

        SETTINGS.pullbackLookback

      );


    if (
      !pullback
    ) {

      continue;

    }


    /* ======================================================
       CANDLE QUALITY
    ====================================================== */

    const metrics =
      candleMetrics(
        candle
      );


    if (
      metrics.bodyPercent <
      SETTINGS.minBodyPercent
    ) {

      continue;

    }


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
      mEMA20[i] &&

      candle.close >
      mEMA50[i];


    const sellRejection =

      bearishCandle &&

      metrics.upperWickPercent >=
      SETTINGS.minRejectionWickPercent &&

      metrics.closeLocation <=
      SETTINGS.sellCloseLocation &&

      candle.close <
      mEMA20[i] &&

      candle.close <
      mEMA50[i];


    /* ======================================================
       RSI
    ====================================================== */

    const buyRsiOk =

      mRSI[i] >=
      SETTINGS.buyRsiMin &&

      mRSI[i] <=
      SETTINGS.buyRsiMax;


    const sellRsiOk =

      mRSI[i] >=
      SETTINGS.sellRsiMin &&

      mRSI[i] <=
      SETTINGS.sellRsiMax;


    /* ======================================================
       STRETCH
    ====================================================== */

    const distanceATR =

      Math.abs(
        candle.close -
        mEMA20[i]
      ) /
      mATR[i];


    if (
      distanceATR >
      SETTINGS.maxDistanceFromEma20Atr
    ) {

      continue;

    }


    /* ======================================================
       ENTRY SIGNAL
    ====================================================== */

    const buy =

      bullishAlignment &&

      buyRejection &&

      buyRsiOk;


    const sell =

      bearishAlignment &&

      sellRejection &&

      sellRsiOk;


    if (
      !buy &&
      !sell
    ) {

      continue;

    }


    /* ======================================================
       ENTER NEXT BAR
    ====================================================== */

    const next =
      m15[
        i +
        1
      ];


    const entry =
      next.open;


    const recent =
      m15.slice(
        Math.max(
          0,
          i -
          3
        ),
        i +
        1
      );


    let stop;


    let risk;


    let target;


    if (
      buy
    ) {

      const atrStop =

        entry -
        mATR[i] *
        SETTINGS.stopAtr;


      const swingLow =

        Math.min(
          ...recent.map(
            bar =>
              bar.low
          )
        );


      const structuralStop =

        swingLow -

        mATR[i] *
        SETTINGS.structureBufferAtr;


      stop =
        Math.min(
          atrStop,
          structuralStop
        );


      risk =
        entry -
        stop;


      if (
        risk <=
        0
      ) {

        continue;

      }


      target =

        entry +

        risk *
        SETTINGS.targetR;


      activeTrade = {

        side:
          "BUY",

        entryIndex:
          i +
          1,

        entryTime:
          next.datetime,

        entry,

        stop,

        target,

        risk,

        h4Trend:
          "BULLISH",

        h1Trend:
          "BULLISH",

        rsi:
          round(
            mRSI[i],
            1
          )

      };

    }


    else {

      const atrStop =

        entry +
        mATR[i] *
        SETTINGS.stopAtr;


      const swingHigh =

        Math.max(
          ...recent.map(
            bar =>
              bar.high
          )
        );


      const structuralStop =

        swingHigh +

        mATR[i] *
        SETTINGS.structureBufferAtr;


      stop =
        Math.max(
          atrStop,
          structuralStop
        );


      risk =
        stop -
        entry;


      if (
        risk <=
        0
      ) {

        continue;

      }


      target =

        entry -

        risk *
        SETTINGS.targetR;


      activeTrade = {

        side:
          "SELL",

        entryIndex:
          i +
          1,

        entryTime:
          next.datetime,

        entry,

        stop,

        target,

        risk,

        h4Trend:
          "BEARISH",

        h1Trend:
          "BEARISH",

        rsi:
          round(
            mRSI[i],
            1
          )

      };

    }

  }


  return trades;

}


/* ============================================================
   STATISTICS
============================================================ */

function statistics(
  trades
) {

  const total =
    trades.length;


  const winners =
    trades.filter(
      trade =>
        trade.resultR >
        0
    );


  const losers =
    trades.filter(
      trade =>
        trade.resultR <
        0
    );


  const breakevens =
    trades.filter(
      trade =>
        trade.resultR ===
        0
    );


  const netR =
    trades.reduce(
      (
        total,
        trade
      ) =>
        total +
        trade.resultR,
      0
    );


  const grossProfit =
    winners.reduce(
      (
        total,
        trade
      ) =>
        total +
        trade.resultR,
      0
    );


  const grossLoss =
    Math.abs(

      losers.reduce(
        (
          total,
          trade
        ) =>
          total +
          trade.resultR,
        0
      )

    );


  const winRate =

    total >
    0

      ? winners.length /
        total *
        100

      : 0;


  const profitFactor =

    grossLoss >
    0

      ? grossProfit /
        grossLoss

      : grossProfit >
        0
        ? 999
        : 0;


  const averageR =

    total >
    0

      ? netR /
        total

      : 0;


  /* ========================================================
     DRAWDOWN
  ======================================================== */

  let equity =
    0;


  let peak =
    0;


  let maxDrawdownR =
    0;


  let currentLossStreak =
    0;


  let maxLossStreak =
    0;


  for (
    const trade of
    trades
  ) {

    equity +=
      trade.resultR;


    peak =
      Math.max(
        peak,
        equity
      );


    maxDrawdownR =
      Math.max(

        maxDrawdownR,

        peak -
        equity

      );


    if (
      trade.resultR <
      0
    ) {

      currentLossStreak++;


      maxLossStreak =
        Math.max(

          maxLossStreak,

          currentLossStreak

        );

    }

    else {

      currentLossStreak =
        0;

    }

  }


  const buys =
    trades.filter(
      trade =>
        trade.side ===
        "BUY"
    );


  const sells =
    trades.filter(
      trade =>
        trade.side ===
        "SELL"
    );


  return {

    trades:
      total,

    wins:
      winners.length,

    losses:
      losers.length,

    breakevens:
      breakevens.length,

    winRate:
      round(
        winRate,
        2
      ),

    netR:
      round(
        netR,
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

    maxDrawdownR:
      round(
        maxDrawdownR,
        2
      ),

    maxLossStreak,


    buyTrades:
      buys.length,


    buyNetR:
      round(

        buys.reduce(
          (
            total,
            trade
          ) =>
            total +
            trade.resultR,
          0
        ),

        2

      ),


    sellTrades:
      sells.length,


    sellNetR:
      round(

        sells.reduce(
          (
            total,
            trade
          ) =>
            total +
            trade.resultR,
          0
        ),

        2

      )

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

    let days =
      num(
        req.query?.days,
        SETTINGS.defaultDays
      );


    days =
      Math.round(

        clamp(

          days,

          7,

          SETTINGS.maxDays

        )

      );


    const nowSeconds =
      Math.floor(
        Date.now() /
        1000
      );


    const startSeconds =

      nowSeconds -

      (
        days +
        SETTINGS.warmupDays
      ) *
      86400;


    const [

      m15,

      h1

    ] =
      await Promise.all([

        fetchHistory(

          900,

          startSeconds,

          nowSeconds

        ),

        fetchHistory(

          3600,

          startSeconds,

          nowSeconds

        )

      ]);


    if (
      m15.length <
      500
    ) {

      throw new Error(
        `Only ${m15.length} M15 candles downloaded`
      );

    }


    if (
      h1.length <
      300
    ) {

      throw new Error(
        `Only ${h1.length} H1 candles downloaded`
      );

    }


    const allTrades =
      runBacktest(
        m15,
        h1
      );


    const testStart =

      (
        nowSeconds -
        days *
        86400
      ) *
      1000;


    const trades =
      allTrades.filter(
        trade =>

          new Date(
            trade.entryTime
          ).getTime() >=
          testStart
      );


    const results =
      statistics(
        trades
      );


    const from =
      new Date(
        testStart
      ).toISOString();


    const to =
      new Date()
        .toISOString();


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

        days,


        period: {

          from,

          to,

          m15Candles:
            m15.length,

          h1Candles:
            h1.length

        },


        data: {

          from,

          to,

          m15Candles:
            m15.length,

          h1Candles:
            h1.length

        },


        settings: {

          h4Trend:
            "EMA20 / EMA50",

          h1Trend:
            "EMA50 / EMA200",

          m15Pullback:
            "EMA20 / EMA50",

          buyRsi:
            "52 - 68",

          sellRsi:
            "32 - 48",

          minimumBody:
            "55%",

          buyCloseLocation:
            "Top 25%",

          sellCloseLocation:
            "Bottom 25%",

          maxEMA20DistanceATR:
            SETTINGS.maxDistanceFromEma20Atr,

          stopATR:
            SETTINGS.stopAtr,

          targetR:
            SETTINGS.targetR,

          cooldownBars:
            SETTINGS.cooldownBars,

          maxHoldBars:
            SETTINGS.maxHoldBars

        },


        results,


        lastTrades:

          trades
            .slice(
              -50
            )
            .reverse(),


        latencyMs:
          Date.now() -
          started

      });

  }

  catch (
    error
  ) {

    console.error(
      "BTC BACKTEST V2 ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        source:
          "Coinbase Exchange",

        product:
          PRODUCT,

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