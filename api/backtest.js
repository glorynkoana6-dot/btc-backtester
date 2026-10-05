/* ============================================================
   MKAYFX BTC BACKTESTER V2
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

   BUY
   ---
   H1 close > EMA200
   H1 EMA50 > EMA200
   M15 pulls into EMA20 / EMA50
   Bullish confirmation
   RSI > 52

   SELL
   ----
   H1 close < EMA200
   H1 EMA50 < EMA200
   M15 pulls into EMA20 / EMA50
   Bearish confirmation
   RSI < 48

   RISK
   ----
   SL = 1.2 ATR
   TP = 2.2R
   Breakeven at +1R

   IMPORTANT
   ---------
   Entry is at NEXT M15 candle open.

   Same-bar SL + TP collision:
   STOP is assumed first.

   NO API KEY REQUIRED.
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
    3.50,


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


  if (
    error &&
    typeof error.message ===
    "string"
  ) {

    return error.message;

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
   FETCH ONE COINBASE CANDLE CHUNK
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
   FETCH LARGE HISTORY
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
     Fetch only a few Coinbase requests simultaneously.
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
      const candles of
      results
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
     Remove overlapping chunk duplicates.
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


  const ranges =
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
   FIND COMPLETED H1 BAR

   Prevents future leakage.

   Example:
   An M15 bar at 12:30 cannot use the still-forming
   H1 bar that opened at 12:00.
============================================================ */

function findCompletedH1Index(

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
   RUN BACKTEST
============================================================ */

function runBacktest(
  m15,
  h1
) {

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


  const mEMA20 =
    ema(
      m15Close,
      SETTINGS.emaFast
    );


  const mEMA50 =
    ema(
      m15Close,
      SETTINGS.emaPullback
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


  const hEMA50 =
    ema(
      h1Close,
      SETTINGS.h1Fast
    );


  const hEMA200 =
    ema(
      h1Close,
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
       MANAGE ACTIVE TRADE
    ====================================================== */

    if (
      activeTrade
    ) {

      let currentStop =
        activeTrade.stop;


      /* ====================================================
         MOVE TO BREAKEVEN
      ==================================================== */

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


        else if (

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
          currentStop;


        const targetHit =

          candle.high >=
          activeTrade.target;


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
         SELL
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
         RECORD EXIT
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
              activeTrade.entry,
              2
            ),

          exit:
            round(
              exit,
              2
            ),

          stop:
            round(
              activeTrade.originalStop,
              2
            ),

          target:
            round(
              activeTrade.target,
              2
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
       M15 INDICATORS READY
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
       FIND COMPLETED H1
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


    /* ======================================================
       H1 TREND
    ====================================================== */

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
       ATR FILTER
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
       CANDLE BODY FILTER
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
       BUY
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


    /* ======================================================
       SELL
    ====================================================== */

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
       ENTRY = NEXT M15 OPEN
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


    /* ======================================================
       CREATE POSITION
    ====================================================== */

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
   API HANDLER
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
       We need extra data before the requested
       period for EMA200 warmup.
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


    /* ======================================================
       DOWNLOAD M15 + H1
    ====================================================== */

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


    /* ======================================================
       RUN
    ====================================================== */

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


    /*
       Remove warm-up trades from results.
    */

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


    /* ======================================================
       RESPONSE

       IMPORTANT FIX:

       We return BOTH:

       data.period.from
       AND
       data.data.from

       so either frontend version works.
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

        days,


        /* ===============================================
           YOUR CURRENT INDEX.HTML EXPECTS THIS
        =============================================== */

        period: {

          from,

          to,

          m15Candles:
            m15.length,

          h1Candles:
            h1.length

        },


        /* ===============================================
           ALSO KEEP THE NEW DATA FORMAT
        =============================================== */

        data: {

          from,

          to,

          m15Candles:
            m15.length,

          h1Candles:
            h1.length

        },


        settings: {

          trendTimeframe:
            "H1",

          entryTimeframe:
            "M15",

          h1Trend:
            "EMA50 / EMA200",

          m15Pullback:
            "EMA20 / EMA50",

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

          minimumATRPercent:
            SETTINGS.minAtrPercent,

          maximumATRPercent:
            SETTINGS.maxAtrPercent,

          minimumCandleBody:
            SETTINGS.minBodyPercent,

          pullbackLookback:
            SETTINGS.pullbackLookback,

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
      "BTC BACKTEST ERROR:",
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