/* ============================================================
   MKAYFX BTC 15M RANGE BREAKOUT — DANGEROUS V1
   /api/btc.js

   MARKET
   ------
   BTC-USD

   DATA
   ----
   Coinbase Exchange public candles

   STRATEGY
   --------
   15-minute consolidation breakout

   LONG
   ----
   - Previous range identified
   - Completed 15m candle CLOSES above resistance
   - RSI bullish momentum confirmation
   - EMA20 / EMA50 bullish confirmation
   - Strong breakout candle

   SHORT
   -----
   - Previous range identified
   - Completed 15m candle CLOSES below support
   - RSI bearish momentum confirmation
   - EMA20 / EMA50 bearish confirmation
   - Strong breakout candle

   ENTRY
   -----
   NEXT 15-minute candle open

   MANAGEMENT
   ----------
   Initial stop = ATR / structure based
   Target       = 2R
   Breakeven    = 0.8R
   Trail starts = 1R

   BACKTEST RULES
   --------------
   No future leakage
   SL-first same-bar collision
   Fees + slippage included
============================================================ */


/* ============================================================
   CONFIG
============================================================ */

const PRODUCT = "BTC-USD";

const COINBASE =
  "https://api.exchange.coinbase.com";

const GRANULARITY = 900; // 15 minutes


const CONFIG = {

  rangeBars: 12,

  minimumRangeAtr: 1.0,
  maximumRangeAtr: 6.0,

  breakoutAtrBuffer: 0.05,

  minimumBodyPercent: 0.50,

  rsiPeriod: 14,

  longRsiMinimum: 54,
  shortRsiMaximum: 46,

  emaFast: 20,
  emaSlow: 50,

  atrPeriod: 14,

  stopAtr: 1.15,

  minimumStopAtr: 0.55,
  maximumStopAtr: 2.0,

  targetR: 2.0,

  breakevenTriggerR: 0.80,
  breakevenLockR: 0.05,

  trailTriggerR: 1.0,
  trailAtr: 1.20,

  riskPercent: 2,

  feePercentPerSide: 0.06,

  slippagePercentPerSide: 0.015,

  cooldownBars: 1,

  maximumBarsInTrade: 32,

  requireEmaConfirmation: true,

  useMomentumOverride: true
};


/* ============================================================
   HELPERS
============================================================ */

function number(value, fallback = 0) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function average(values) {

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


function highest(
  candles,
  start,
  end,
  field = "high"
) {

  let value =
    -Infinity;

  for (
    let i = start;
    i <= end;
    i++
  ) {

    value =
      Math.max(
        value,
        candles[i][field]
      );
  }

  return value;
}


function lowest(
  candles,
  start,
  end,
  field = "low"
) {

  let value =
    Infinity;

  for (
    let i = start;
    i <= end;
    i++
  ) {

    value =
      Math.min(
        value,
        candles[i][field]
      );
  }

  return value;
}


/* ============================================================
   EMA
============================================================ */

function ema(
  values,
  period
) {

  const output =
    new Array(values.length)
      .fill(null);


  if (
    !values.length ||
    values.length < period
  ) {
    return output;
  }


  const multiplier =
    2 / (period + 1);


  let seed =
    0;


  for (
    let i = 0;
    i < period;
    i++
  ) {

    seed +=
      values[i];
  }


  let current =
    seed / period;


  output[
    period - 1
  ] =
    current;


  for (
    let i = period;
    i < values.length;
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
    new Array(values.length)
      .fill(null);


  if (
    values.length <= period
  ) {
    return output;
  }


  let gains =
    0;

  let losses =
    0;


  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];


    if (change >= 0) {

      gains +=
        change;

    } else {

      losses +=
        Math.abs(change);
    }
  }


  let avgGain =
    gains / period;

  let avgLoss =
    losses / period;


  output[period] =
    avgLoss === 0
      ? 100
      : 100 -
        (
          100 /
          (
            1 +
            avgGain /
            avgLoss
          )
        );


  for (
    let i = period + 1;
    i < values.length;
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


    avgGain =
      (
        avgGain *
          (
            period - 1
          ) +
        gain
      ) /
      period;


    avgLoss =
      (
        avgLoss *
          (
            period - 1
          ) +
        loss
      ) /
      period;


    output[i] =
      avgLoss === 0
        ? 100
        : 100 -
          (
            100 /
            (
              1 +
              avgGain /
              avgLoss
            )
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

  const tr =
    new Array(
      candles.length
    )
      .fill(null);


  const output =
    new Array(
      candles.length
    )
      .fill(null);


  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    tr[i] =
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


  if (
    candles.length <= period
  ) {
    return output;
  }


  let seed =
    0;


  for (
    let i = 1;
    i <= period;
    i++
  ) {

    seed +=
      tr[i];
  }


  let current =
    seed / period;


  output[period] =
    current;


  for (
    let i = period + 1;
    i < candles.length;
    i++
  ) {

    current =
      (
        current *
          (
            period - 1
          ) +
        tr[i]
      ) /
      period;


    output[i] =
      current;
  }


  return output;
}


/* ============================================================
   COINBASE
============================================================ */

async function fetchCoinbaseChunk(
  start,
  end
) {

  const url =
    `${COINBASE}/products/${PRODUCT}/candles` +
    `?granularity=${GRANULARITY}` +
    `&start=${encodeURIComponent(
      start.toISOString()
    )}` +
    `&end=${encodeURIComponent(
      end.toISOString()
    )}`;


  const response =
    await fetch(
      url,
      {
        headers: {
          Accept:
            "application/json",

          "User-Agent":
            "MKAYFX-BTC-Backtester"
        }
      }
    );


  if (!response.ok) {

    throw new Error(
      `Coinbase HTTP ${response.status}`
    );
  }


  const data =
    await response.json();


  if (
    !Array.isArray(data)
  ) {

    throw new Error(
      JSON.stringify(data)
    );
  }


  return data.map(
    row => ({

      time:
        Number(row[0]) *
        1000,

      low:
        Number(row[1]),

      high:
        Number(row[2]),

      open:
        Number(row[3]),

      close:
        Number(row[4]),

      volume:
        Number(row[5])

    })
  );
}


/* ============================================================
   FETCH HISTORY

   Coinbase normally limits candle responses,
   so history is downloaded in chunks.
============================================================ */

async function fetchHistory(
  days
) {

  const now =
    new Date();


  const start =
    new Date(
      now.getTime() -
      days *
      86400000
    );


  const candles =
    [];


  /*
    15m * 250 candles =
    62.5 hours per request
  */

  const chunkMs =
    GRANULARITY *
    1000 *
    250;


  let cursor =
    start.getTime();


  while (
    cursor <
    now.getTime()
  ) {

    const chunkStart =
      new Date(cursor);


    const chunkEnd =
      new Date(
        Math.min(
          cursor +
            chunkMs,

          now.getTime()
        )
      );


    const batch =
      await fetchCoinbaseChunk(
        chunkStart,
        chunkEnd
      );


    candles.push(
      ...batch
    );


    cursor =
      chunkEnd.getTime();


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          80
        )
    );
  }


  const unique =
    new Map();


  for (
    const candle
    of candles
  ) {

    unique.set(
      candle.time,
      candle
    );
  }


  return Array.from(
    unique.values()
  )
    .sort(
      (
        a,
        b
      ) =>
        a.time -
        b.time
    );
}


/* ============================================================
   INDICATORS
============================================================ */

function prepareIndicators(
  candles
) {

  const closes =
    candles.map(
      candle =>
        candle.close
    );


  return {

    ema20:
      ema(
        closes,
        CONFIG.emaFast
      ),

    ema50:
      ema(
        closes,
        CONFIG.emaSlow
      ),

    rsi:
      rsi(
        closes,
        CONFIG.rsiPeriod
      ),

    atr:
      atr(
        candles,
        CONFIG.atrPeriod
      )

  };
}


/* ============================================================
   BREAKOUT DETECTOR
============================================================ */

function detectSignal(
  candles,
  indicators,
  i
) {

  if (
    i <
    Math.max(
      CONFIG.rangeBars + 2,
      CONFIG.emaSlow + 2
    )
  ) {

    return null;
  }


  const candle =
    candles[i];


  const previous =
    candles[i - 1];


  const currentAtr =
    indicators.atr[i];


  const currentRsi =
    indicators.rsi[i];


  const fast =
    indicators.ema20[i];


  const slow =
    indicators.ema50[i];


  if (
    !currentAtr ||
    currentRsi === null ||
    fast === null ||
    slow === null
  ) {

    return null;
  }


  const rangeStart =
    i -
    CONFIG.rangeBars;


  const rangeEnd =
    i - 1;


  const resistance =
    highest(
      candles,
      rangeStart,
      rangeEnd,
      "high"
    );


  const support =
    lowest(
      candles,
      rangeStart,
      rangeEnd,
      "low"
    );


  const rangeSize =
    resistance -
    support;


  const rangeAtr =
    rangeSize /
    currentAtr;


  /*
    Reject ranges that are either microscopic
    or already huge/trending.
  */

  if (
    rangeAtr <
      CONFIG.minimumRangeAtr ||
    rangeAtr >
      CONFIG.maximumRangeAtr
  ) {

    return null;
  }


  const candleRange =
    candle.high -
    candle.low;


  if (
    candleRange <= 0
  ) {

    return null;
  }


  const candleBody =
    Math.abs(
      candle.close -
      candle.open
    );


  const bodyPercent =
    candleBody /
    candleRange;


  if (
    bodyPercent <
    CONFIG.minimumBodyPercent
  ) {

    return null;
  }


  const buffer =
    currentAtr *
    CONFIG.breakoutAtrBuffer;


  const longBreakout =
    candle.close >
      resistance +
      buffer;


  const shortBreakout =
    candle.close <
      support -
      buffer;


  const emaBull =
    fast > slow;


  const emaBear =
    fast < slow;


  const fastRising =
    indicators.ema20[i] >
    indicators.ema20[i - 1];


  const fastFalling =
    indicators.ema20[i] <
    indicators.ema20[i - 1];


  const rsiBull =
    currentRsi >=
    CONFIG.longRsiMinimum;


  const rsiBear =
    currentRsi <=
    CONFIG.shortRsiMaximum;


  /*
    Momentum override:
    exceptionally strong RSI can allow trade
    even when EMA20/EMA50 are not fully aligned.
  */

  const powerfulLong =
    currentRsi >= 62 &&
    fastRising;


  const powerfulShort =
    currentRsi <= 38 &&
    fastFalling;


  let longConfirmation =
    rsiBull;


  let shortConfirmation =
    rsiBear;


  if (
    CONFIG.requireEmaConfirmation
  ) {

    longConfirmation =
      rsiBull &&
      (
        emaBull ||
        (
          CONFIG.useMomentumOverride &&
          powerfulLong
        )
      );


    shortConfirmation =
      rsiBear &&
      (
        emaBear ||
        (
          CONFIG.useMomentumOverride &&
          powerfulShort
        )
      );
  }


  if (
    longBreakout &&
    longConfirmation &&
    candle.close >
      candle.open
  ) {

    return {

      side:
        "LONG",

      resistance,

      support,

      rangeSize,

      rangeAtr,

      rsi:
        currentRsi,

      ema20:
        fast,

      ema50:
        slow,

      atr:
        currentAtr,

      bodyPercent

    };
  }


  if (
    shortBreakout &&
    shortConfirmation &&
    candle.close <
      candle.open
  ) {

    return {

      side:
        "SHORT",

      resistance,

      support,

      rangeSize,

      rangeAtr,

      rsi:
        currentRsi,

      ema20:
        fast,

      ema50:
        slow,

      atr:
        currentAtr,

      bodyPercent

    };
  }


  return null;
}


/* ============================================================
   TRADE CREATION
============================================================ */

function createTrade(
  candles,
  indicators,
  signalIndex,
  signal
) {

  const entryIndex =
    signalIndex + 1;


  if (
    entryIndex >=
    candles.length
  ) {

    return null;
  }


  const entryCandle =
    candles[
      entryIndex
    ];


  const rawEntry =
    entryCandle.open;


  const slip =
    CONFIG.slippagePercentPerSide /
    100;


  const entry =
    signal.side ===
    "LONG"

      ? rawEntry *
        (
          1 + slip
        )

      : rawEntry *
        (
          1 - slip
        );


  const currentAtr =
    signal.atr;


  let stopDistance =
    currentAtr *
    CONFIG.stopAtr;


  const minimumStop =
    currentAtr *
    CONFIG.minimumStopAtr;


  const maximumStop =
    currentAtr *
    CONFIG.maximumStopAtr;


  stopDistance =
    Math.max(
      minimumStop,
      Math.min(
        stopDistance,
        maximumStop
      )
    );


  let stop;
  let target;


  if (
    signal.side ===
    "LONG"
  ) {

    /*
      Structure-informed stop:
      breakout level + ATR logic.
    */

    const structureStop =
      signal.resistance -
      currentAtr *
      0.35;


    const atrStop =
      entry -
      stopDistance;


    stop =
      Math.max(
        atrStop,
        structureStop
      );


    /*
      Never allow absurdly tiny stop.
    */

    if (
      entry - stop <
      minimumStop
    ) {

      stop =
        entry -
        minimumStop;
    }


    const risk =
      entry -
      stop;


    target =
      entry +
      risk *
      CONFIG.targetR;

  } else {

    const structureStop =
      signal.support +
      currentAtr *
      0.35;


    const atrStop =
      entry +
      stopDistance;


    stop =
      Math.min(
        atrStop,
        structureStop
      );


    if (
      stop - entry <
      minimumStop
    ) {

      stop =
        entry +
        minimumStop;
    }


    const risk =
      stop -
      entry;


    target =
      entry -
      risk *
      CONFIG.targetR;
  }


  const riskDistance =
    Math.abs(
      entry -
      stop
    );


  if (
    riskDistance <= 0
  ) {

    return null;
  }


  return {

    side:
      signal.side,

    signalIndex,

    entryIndex,

    entryTime:
      entryCandle.time,

    entry,

    initialStop:
      stop,

    stop,

    target,

    initialRisk:
      riskDistance,

    highest:
      entry,

    lowest:
      entry,

    barsHeld:
      0,

    trailing:
      false,

    breakeven:
      false,

    signal

  };
}


/* ============================================================
   EXIT TRADE
============================================================ */

function finishTrade(
  trade,
  exitPrice,
  exitTime,
  reason
) {

  const slip =
    CONFIG.slippagePercentPerSide /
    100;


  let effectiveExit;


  if (
    trade.side ===
    "LONG"
  ) {

    effectiveExit =
      exitPrice *
      (
        1 - slip
      );

  } else {

    effectiveExit =
      exitPrice *
      (
        1 + slip
      );
  }


  const grossR =
    trade.side ===
    "LONG"

      ? (
          effectiveExit -
          trade.entry
        ) /
        trade.initialRisk

      : (
          trade.entry -
          effectiveExit
        ) /
        trade.initialRisk;


  const notionalRiskFraction =
    trade.initialRisk /
    trade.entry;


  const feeFraction =
    (
      CONFIG.feePercentPerSide *
      2
    ) /
    100;


  const feeR =
    notionalRiskFraction > 0

      ? feeFraction /
        notionalRiskFraction

      : 0;


  const netR =
    grossR -
    feeR;


  return {

    ...trade,

    exitTime,

    exitPrice:
      effectiveExit,

    grossR,

    feesR:
      feeR,

    netR,

    result:
      netR > 0
        ? "WIN"
        : "LOSS",

    exitReason:
      reason

  };
}


/* ============================================================
   BACKTEST
============================================================ */

function runBacktest(
  candles,
  startingBalance
) {

  const indicators =
    prepareIndicators(
      candles
    );


  const trades =
    [];


  let active =
    null;


  let balance =
    startingBalance;


  let peak =
    startingBalance;


  let maximumDrawdown =
    0;


  let cooldownUntil =
    -1;


  const startIndex =
    Math.max(
      CONFIG.emaSlow + 5,
      CONFIG.rangeBars + 5
    );


  for (
    let i = startIndex;
    i < candles.length - 1;
    i++
  ) {

    const candle =
      candles[i];


    /*
    ==========================================================
      ACTIVE TRADE MANAGEMENT
    ==========================================================
    */

    if (active) {

      active.barsHeld++;


      active.highest =
        Math.max(
          active.highest,
          candle.high
        );


      active.lowest =
        Math.min(
          active.lowest,
          candle.low
        );


      const currentAtr =
        indicators.atr[i] ||
        active.signal.atr;


      const currentR =
        active.side ===
        "LONG"

          ? (
              candle.close -
              active.entry
            ) /
            active.initialRisk

          : (
              active.entry -
              candle.close
            ) /
            active.initialRisk;


      /*
        Move stop near breakeven.
      */

      if (
        !active.breakeven &&
        currentR >=
          CONFIG.breakevenTriggerR
      ) {

        active.breakeven =
          true;


        if (
          active.side ===
          "LONG"
        ) {

          active.stop =
            Math.max(
              active.stop,

              active.entry +
              active.initialRisk *
              CONFIG.breakevenLockR
            );

        } else {

          active.stop =
            Math.min(
              active.stop,

              active.entry -
              active.initialRisk *
              CONFIG.breakevenLockR
            );
        }
      }


      /*
        Activate trailing stop.
      */

      if (
        currentR >=
        CONFIG.trailTriggerR
      ) {

        active.trailing =
          true;
      }


      if (
        active.trailing
      ) {

        if (
          active.side ===
          "LONG"
        ) {

          const trailStop =
            candle.close -
            currentAtr *
            CONFIG.trailAtr;


          active.stop =
            Math.max(
              active.stop,
              trailStop
            );

        } else {

          const trailStop =
            candle.close +
            currentAtr *
            CONFIG.trailAtr;


          active.stop =
            Math.min(
              active.stop,
              trailStop
            );
        }
      }


      let closed =
        null;


      /*
        IMPORTANT:
        SL FIRST if both target and stop
        are touched in same candle.
      */

      if (
        active.side ===
        "LONG"
      ) {

        if (
          candle.low <=
          active.stop
        ) {

          closed =
            finishTrade(
              active,
              active.stop,
              candle.time,
              active.trailing
                ? "TRAILING_STOP"
                : active.breakeven
                ? "BREAKEVEN_STOP"
                : "STOP_LOSS"
            );

        } else if (
          candle.high >=
          active.target
        ) {

          closed =
            finishTrade(
              active,
              active.target,
              candle.time,
              "TAKE_PROFIT"
            );
        }

      } else {

        if (
          candle.high >=
          active.stop
        ) {

          closed =
            finishTrade(
              active,
              active.stop,
              candle.time,
              active.trailing
                ? "TRAILING_STOP"
                : active.breakeven
                ? "BREAKEVEN_STOP"
                : "STOP_LOSS"
            );

        } else if (
          candle.low <=
          active.target
        ) {

          closed =
            finishTrade(
              active,
              active.target,
              candle.time,
              "TAKE_PROFIT"
            );
        }
      }


      /*
        Time exit.
      */

      if (
        !closed &&
        active.barsHeld >=
          CONFIG.maximumBarsInTrade
      ) {

        closed =
          finishTrade(
            active,
            candle.close,
            candle.time,
            "TIME_EXIT"
          );
      }


      if (closed) {

        const riskMoney =
          balance *
          (
            CONFIG.riskPercent /
            100
          );


        const pnl =
          riskMoney *
          closed.netR;


        closed.balanceBefore =
          balance;


        closed.riskMoney =
          riskMoney;


        closed.pnl =
          pnl;


        balance +=
          pnl;


        closed.balanceAfter =
          balance;


        trades.push(
          closed
        );


        peak =
          Math.max(
            peak,
            balance
          );


        const drawdown =
          peak > 0
            ? (
                (
                  peak -
                  balance
                ) /
                peak
              ) *
              100
            : 0;


        maximumDrawdown =
          Math.max(
            maximumDrawdown,
            drawdown
          );


        active =
          null;


        cooldownUntil =
          i +
          CONFIG.cooldownBars;
      }


      continue;
    }


    /*
    ==========================================================
      SEARCH NEW ENTRY
    ==========================================================
    */

    if (
      i <=
      cooldownUntil
    ) {

      continue;
    }


    const signal =
      detectSignal(
        candles,
        indicators,
        i
      );


    if (!signal) {

      continue;
    }


    active =
      createTrade(
        candles,
        indicators,
        i,
        signal
      );
  }


  /*
    Close open trade at final candle.
  */

  if (active) {

    const last =
      candles[
        candles.length - 1
      ];


    const closed =
      finishTrade(
        active,
        last.close,
        last.time,
        "END_OF_BACKTEST"
      );


    const riskMoney =
      balance *
      (
        CONFIG.riskPercent /
        100
      );


    closed.balanceBefore =
      balance;

    closed.riskMoney =
      riskMoney;

    closed.pnl =
      riskMoney *
      closed.netR;


    balance +=
      closed.pnl;


    closed.balanceAfter =
      balance;


    trades.push(
      closed
    );
  }


  return buildStatistics(
    trades,
    startingBalance,
    balance,
    maximumDrawdown
  );
}


/* ============================================================
   STATISTICS
============================================================ */

function buildStatistics(
  trades,
  startingBalance,
  endingBalance,
  maximumDrawdown
) {

  const wins =
    trades.filter(
      trade =>
        trade.netR > 0
    );


  const losses =
    trades.filter(
      trade =>
        trade.netR <= 0
    );


  const grossProfitR =
    wins.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        trade.netR,
      0
    );


  const grossLossR =
    Math.abs(
      losses.reduce(
        (
          sum,
          trade
        ) =>
          sum +
          trade.netR,
        0
      )
    );


  const totalR =
    trades.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        trade.netR,
      0
    );


  const profitFactor =
    grossLossR > 0
      ? grossProfitR /
        grossLossR
      : grossProfitR > 0
      ? 999
      : 0;


  const winRate =
    trades.length
      ? (
          wins.length /
          trades.length
        ) *
        100
      : 0;


  const averageR =
    trades.length
      ? totalR /
        trades.length
      : 0;


  const averageWinR =
    wins.length
      ? wins.reduce(
          (
            sum,
            trade
          ) =>
            sum +
            trade.netR,
          0
        ) /
        wins.length
      : 0;


  const averageLossR =
    losses.length
      ? losses.reduce(
          (
            sum,
            trade
          ) =>
            sum +
            trade.netR,
          0
        ) /
        losses.length
      : 0;


  return {

    strategy:
      "MKAYFX BTC 15M RANGE BREAKOUT DANGEROUS V1",

    product:
      PRODUCT,

    timeframe:
      "15M",

    settings:
      CONFIG,

    statistics: {

      trades:
        trades.length,

      wins:
        wins.length,

      losses:
        losses.length,

      winRate:
        round(winRate, 2),

      profitFactor:
        round(profitFactor, 2),

      totalR:
        round(totalR, 2),

      averageR:
        round(averageR, 3),

      averageWinR:
        round(
          averageWinR,
          3
        ),

      averageLossR:
        round(
          averageLossR,
          3
        ),

      maximumDrawdownPercent:
        round(
          maximumDrawdown,
          2
        ),

      startingBalance:
        round(
          startingBalance,
          2
        ),

      endingBalance:
        round(
          endingBalance,
          2
        ),

      returnPercent:
        round(
          (
            (
              endingBalance -
              startingBalance
            ) /
            startingBalance
          ) *
          100,
          2
        )

    },

    trades:
      trades
        .slice()
        .reverse()
        .map(
          trade => ({

            side:
              trade.side,

            entryTime:
              new Date(
                trade.entryTime
              )
                .toISOString(),

            exitTime:
              new Date(
                trade.exitTime
              )
                .toISOString(),

            entry:
              round(
                trade.entry,
                2
              ),

            stop:
              round(
                trade.initialStop,
                2
              ),

            target:
              round(
                trade.target,
                2
              ),

            exit:
              round(
                trade.exitPrice,
                2
              ),

            r:
              round(
                trade.netR,
                3
              ),

            pnl:
              round(
                trade.pnl,
                2
              ),

            balance:
              round(
                trade.balanceAfter,
                2
              ),

            reason:
              trade.exitReason,

            rsi:
              round(
                trade.signal.rsi,
                1
              ),

            rangeAtr:
              round(
                trade.signal.rangeAtr,
                2
              )

          })
        )

  };
}


function round(
  value,
  decimals = 2
) {

  const factor =
    10 **
    decimals;


  return (
    Math.round(
      value *
      factor
    ) /
    factor
  );
}


/* ============================================================
   API HANDLER
============================================================ */

export default async function handler(
  req,
  res
) {

  try {

    res.setHeader(
      "Cache-Control",
      "no-store, max-age=0"
    );


    const requestedDays =
      number(
        req.query.days,
        30
      );


    const days =
      Math.max(
        2,
        Math.min(
          requestedDays,
          90
        )
      );


    const requestedBalance =
      number(
        req.query.balance,
        200
      );


    const balance =
      Math.max(
        1,
        requestedBalance
      );


    const candles =
      await fetchHistory(
        days
      );


    if (
      candles.length <
      100
    ) {

      throw new Error(
        `Not enough Coinbase candles: ${candles.length}`
      );
    }


    const result =
      runBacktest(
        candles,
        balance
      );


    return res
      .status(200)
      .json({

        ok:
          true,

        generatedAt:
          new Date()
            .toISOString(),

        requestedDays:
          days,

        candles:
          candles.length,

        ...result

      });

  } catch (error) {

    console.error(
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        error:
          error.message

      });
   }
}