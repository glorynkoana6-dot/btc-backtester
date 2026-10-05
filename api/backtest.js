/* ============================================================
   MKAYFX BTC BACKTESTER
   /api/backtest.js

   SOURCE
   ------
   Coinbase Exchange

   PRODUCT
   -------
   BTC-USD

   STRATEGY
   --------
   H1 trend
   +
   M15 EMA pullback

   IMPORTANT
   ---------
   Historical entries use NEXT M15 candle open.

   That prevents entering before the signal candle
   has actually closed.

   Same-bar TP + SL collision:
   STOP is assumed first.

   This is deliberately conservative.
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

  targetR:
    2.2,

  breakevenR:
    1.0,


  minAtrPercent:
    0.10,

  maxAtrPercent:
    3.5,


  minBodyPercent:
    0.50,


  pullbackLookback:
    3,


  cooldownBars:
    4,


  maxHoldBars:
    96,


  chunkCandles:
    280

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


function sleep(
  ms
) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );

}


function errorText(
  error
) {

  if (
    error instanceof Error
  ) {

    return error.message;

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
              "MKAYFX-BTC-BACKTEST"

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

  finally {

    clearTimeout(
      timer
    );

  }

}


/* ============================================================
   SINGLE COINBASE CHUNK
============================================================ */

async function fetchChunk(

  granularity,

  startSeconds,

  endSeconds

) {

  const url =

    `${COINBASE}/products/${PRODUCT}/candles` +

    `?granularity=${granularity}` +

    `&start=${startSeconds}` +

    `&end=${endSeconds}`;


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
   FETCH LARGE HISTORY

   Coinbase candle endpoint has a limited number of
   candles per request.

   We split history into chunks.
============================================================ */

async function fetchHistory(

  granularity,

  startSeconds,

  endSeconds

) {

  const chunkDuration =

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
        chunkDuration,

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


  /*
     Small batches.

     This is friendlier to Coinbase and Vercel
     than firing every request simultaneously.
  */

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


    const result =
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
      const candles of
      result
    ) {

      all.push(
        ...candles
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


  /*
     Remove duplicates at chunk boundaries.
  */

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


  const trueRange =
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


  for (
    let i = 1;
    i <
      candles.length;
    i++
  ) {

    trueRange[i] =
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
      trueRange[i];

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
        trueRange[i]
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
   PULLBACK
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
   FIND LAST COMPLETED H1 CANDLE

   M15 signal cannot use an H1 candle which had
   not closed yet.
============================================================ */

function findCompletedH1Index(

  h1,

  signalTimestamp,

  startIndex

) {

  /*
     H1 candle timestamp represents its opening time.

     It becomes usable only 1 hour later.
  */

  const cutoff =

    signalTimestamp -
    60 *
    60 *
    1000;


  let index =
    Math.max(
      0,
      startIndex
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
   BACKTEST
============================================================ */

function runBacktest(
  m15,
  h1
) {

  const mClose =
    m15.map(
      candle =>
        candle.close
    );


  const hClose =
    h1.map(
      candle =>
        candle.close
    );


  const mEMA20 =
    ema(
      mClose,
      SETTINGS.emaFast
    );


  const mEMA50 =
    ema(
      mClose,
      SETTINGS.emaPullback
    );


  const mRSI =
    rsi(
      mClose,
      SETTINGS.rsiPeriod
    );


  const mATR =
    atr(
      m15,
      SETTINGS.atrPeriod
    );


  const hEMA50 =
    ema(
      hClose,
      SETTINGS.h1Fast
    );


  const hEMA200 =
    ema(
      hClose,
      SETTINGS.h1Slow
    );


  const trades =
    [];


  let activeTrade =
    null;


  let cooldownUntil =
    -1;


  let hIndex =
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
       MANAGE ACTIVE POSITION
    ====================================================== */

    if (
      activeTrade
    ) {

      let currentStop =
        activeTrade.stop;


      /*
         BREAKEVEN AFTER +1R
      */

      if (
        !activeTrade.breakeven
      ) {

        if (

          activeTrade.side ===
            "BUY" &&

          candle.high >=

            activeTrade.entry +

            activeTrade.risk *
            SETTINGS.breakevenR

        ) {

          activeTrade.breakeven =
            true;


          activeTrade.stop =
            activeTrade.entry;


          currentStop =
            activeTrade.stop;

        }


        if (

          activeTrade.side ===
            "SELL" &&

          candle.low <=

            activeTrade.entry -

            activeTrade.risk *
            SETTINGS.breakevenR

        ) {

          activeTrade.breakeven =
            true;


          activeTrade.stop =
            activeTrade.entry;


          currentStop =
            activeTrade.stop;

        }

      }


      let resultR =
        null;


      let exit =
        null;


      let exitReason =
        null;


      /* ====================================================
         BUY EXIT
      ==================================================== */

      if (
        activeTrade.side ===
        "BUY"
      ) {

        const stopHit =

          candle.low <=
          currentStop;


        const targetHit =

          candle.high >=
          activeTrade.target;


        /*
           Conservative same-candle assumption:
           SL first.
        */

        if (
          stopHit
        ) {

          exit =
            currentStop;


          resultR =

            (
              exit -
              activeTrade.entry
            ) /
            activeTrade.risk;


          exitReason =

            activeTrade.breakeven
              ? "BE"
              : "SL";

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
         SELL EXIT
      ==================================================== */

      else {

        const stopHit =

          candle.high >=
          currentStop;


        const targetHit =

          candle.low <=
          activeTrade.target;


        if (
          stopHit
        ) {

          exit =
            currentStop;


          resultR =

            (
              activeTrade.entry -
              exit
            ) /
            activeTrade.risk;


          exitReason =

            activeTrade.breakeven
              ? "BE"
              : "SL";

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
         MAX HOLD
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

          originalStop:
            round(
              activeTrade.originalStop
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

          exitReason

        });


        activeTrade =
          null;


        cooldownUntil =

          i +
          SETTINGS.cooldownBars;

      }


      continue;

    }


    if (
      i <=
      cooldownUntil
    ) {

      continue;

    }


    /* ======================================================
       INDICATORS READY
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
       H1 CONTEXT
    ====================================================== */

    hIndex =
      findCompletedH1Index(

        h1,

        candle.timestamp,

        hIndex

      );


    if (
      hIndex <
      199
    ) {

      continue;

    }


    if (

      hEMA50[
        hIndex
      ] ===
        null ||

      hEMA200[
        hIndex
      ] ===
        null

    ) {

      continue;

    }


    const h1Bullish =

      h1[
        hIndex
      ].close >
      hEMA200[
        hIndex
      ] &&

      hEMA50[
        hIndex
      ] >
      hEMA200[
        hIndex
      ];


    const h1Bearish =

      h1[
        hIndex
      ].close <
      hEMA200[
        hIndex
      ] &&

      hEMA50[
        hIndex
      ] <
      hEMA200[
        hIndex
      ];


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
       CANDLE STRENGTH
    ====================================================== */

    const strength =
      candleStrength(
        candle
      );


    if (
      strength <
      SETTINGS.minBodyPercent
    ) {

      continue;

    }


    /* ======================================================
       PULLBACK
    ====================================================== */

    const pullback =
      hadPullback(

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
       SIGNAL
    ====================================================== */

    const buy =

      h1Bullish &&

      candle.close >
      candle.open &&

      candle.close >
      mEMA20[i] &&

      candle.close >
      mEMA50[i] &&

      mRSI[i] >
      SETTINGS.buyRsi;


    const sell =

      h1Bearish &&

      candle.close <
      candle.open &&

      candle.close <
      mEMA20[i] &&

      candle.close <
      mEMA50[i] &&

      mRSI[i] <
      SETTINGS.sellRsi;


    if (
      !buy &&
      !sell
    ) {

      continue;

    }


    /* ======================================================
       ENTRY AT NEXT M15 OPEN
    ====================================================== */

    const next =
      m15[
        i +
        1
      ];


    const entry =
      next.open;


    const risk =

      mATR[i] *
      SETTINGS.stopAtr;


    if (

      !Number.isFinite(
        risk
      ) ||

      risk <=
      0

    ) {

      continue;

    }


    if (
      buy
    ) {

      activeTrade = {

        side:
          "BUY",

        entryIndex:
          i +
          1,

        entryTime:
          next.datetime,

        entry,

        risk,

        stop:
          entry -
          risk,

        originalStop:
          entry -
          risk,

        target:
          entry +
          risk *
          SETTINGS.targetR,

        breakeven:
          false

      };

    }


    else {

      activeTrade = {

        side:
          "SELL",

        entryIndex:
          i +
          1,

        entryTime:
          next.datetime,

        entry,

        risk,

        stop:
          entry +
          risk,

        originalStop:
          entry +
          risk,

        target:
          entry -
          risk *
          SETTINGS.targetR,

        breakeven:
          false

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


  const wins =
    trades.filter(
      trade =>
        trade.resultR >
        0
    );


  const losses =
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


  const totalR =
    trades.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        trade.resultR,
      0
    );


  const grossProfit =
    wins.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        trade.resultR,
      0
    );


  const grossLoss =
    Math.abs(

      losses.reduce(
        (
          sum,
          trade
        ) =>
          sum +
          trade.resultR,
        0
      )

    );


  const winRate =

    total >

    0

      ? wins.length /
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

      ? totalR /
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
      wins.length,

    losses:
      losses.length,

    breakevens:
      breakevens.length,

    winRate:
      round(
        winRate,
        2
      ),

    netR:
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
            sum,
            trade
          ) =>
            sum +
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
            sum,
            trade
          ) =>
            sum +
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


    /*
       Add 10 days of warm-up history.

       H1 EMA200 needs a decent amount of historical data.
    */

    const warmupDays =
      10;


    const startSeconds =

      nowSeconds -

      (
        days +
        warmupDays
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
      220
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


    /*
       Only count trades occurring inside the
       actual requested test period.

       Warm-up trades are discarded.
    */

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

        days,

        settings: {

          h1Trend:
            "EMA50 vs EMA200",

          m15EMA:
            "20 / 50",

          buyRSI:
            SETTINGS.buyRsi,

          sellRSI:
            SETTINGS.sellRsi,

          stopATR:
            SETTINGS.stopAtr,

          targetR:
            SETTINGS.targetR,

          breakevenAtR:
            SETTINGS.breakevenR,

          minimumCandleBody:
            SETTINGS.minBodyPercent,

          pullbackLookback:
            SETTINGS.pullbackLookback

        },


        data: {

          m15Candles:
            m15.length,

          h1Candles:
            h1.length,

          from:
            new Date(
              testStart
            ).toISOString(),

          to:
            new Date()
              .toISOString()

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
      "BACKTEST ERROR:",
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