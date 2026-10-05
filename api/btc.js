/* ============================================================
   MKAYFX BTC DYNAMIC STRUCTURE V1
   /api/btc.js

   MARKET
   ------
   Coinbase Exchange BTC-USD

   TIMEFRAMES
   ----------
   M1  = execution
   M5  = structure
   M15 = directional context
   H1  = optional context / scoring only

   CORE IDEAS
   ----------
   - Dynamic support / resistance
   - Swing structure
   - BOS / CHOCH approximation
   - Trend direction
   - VWAP
   - Relative volume
   - Volume spike
   - Money-flow / pressure approximation
   - Rejection candles
   - Breakout
   - Retest / reclaim
   - ATR volatility
   - Momentum
   - Multi-timeframe scoring

   IMPORTANT
   ---------
   Signals use COMPLETED candles only.

   The live endpoint analyses the latest completed M1 candle.

   The backtester imports the SAME strategy functions.
============================================================ */


export const PRODUCT = "BTC-USD";

export const COINBASE_BASE =
  "https://api.exchange.coinbase.com";


/* ============================================================
   SETTINGS
============================================================ */

export const SETTINGS = {

  RR: 1.5,

  ATR_PERIOD: 14,

  FAST_EMA: 9,

  MID_EMA: 21,

  SLOW_EMA: 50,

  RSI_PERIOD: 14,

  VOLUME_LOOKBACK: 20,

  SWING_LOOKBACK: 12,

  STRUCTURE_LOOKBACK: 30,

  VWAP_LOOKBACK: 60,

  ATR_STOP_MULT: 1.15,

  MIN_STOP_ATR: 0.75,

  MAX_STOP_ATR: 2.2,

  VOLUME_SPIKE_MULT: 1.35,

  MIN_BARS: 80,

  MODES: {

    SELECTIVE: {
      minScore: 72,
      minGap: 12
    },

    BALANCED: {
      minScore: 64,
      minGap: 8
    },

    AGGRESSIVE: {
      minScore: 56,
      minGap: 5
    }

  }

};


/* ============================================================
   GENERIC HELPERS
============================================================ */

export function clamp(
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


export function round(
  value,
  decimals = 2
) {

  if (!Number.isFinite(value)) {
    return null;
  }

  const factor =
    Math.pow(
      10,
      decimals
    );

  return (
    Math.round(
      value * factor
    ) / factor
  );

}


export function average(
  values
) {

  const valid =
    values.filter(
      Number.isFinite
    );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (a, b) => a + b,
      0
    ) /
    valid.length
  );

}


/* ============================================================
   EMA
============================================================ */

export function emaSeries(
  values,
  period
) {

  const result =
    new Array(
      values.length
    ).fill(null);

  if (
    !values.length ||
    values.length < period
  ) {
    return result;
  }

  let seed = 0;

  for (
    let i = 0;
    i < period;
    i++
  ) {
    seed += values[i];
  }

  seed /= period;

  result[
    period - 1
  ] = seed;

  const k =
    2 /
    (
      period + 1
    );

  for (
    let i = period;
    i < values.length;
    i++
  ) {

    result[i] =
      (
        values[i] *
        k
      ) +
      (
        result[i - 1] *
        (
          1 - k
        )
      );

  }

  return result;

}


/* ============================================================
   RSI
============================================================ */

export function rsiSeries(
  values,
  period = 14
) {

  const result =
    new Array(
      values.length
    ).fill(null);

  if (
    values.length <= period
  ) {
    return result;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];

    if (change >= 0) {
      gains += change;
    } else {
      losses +=
        Math.abs(
          change
        );
    }

  }

  let avgGain =
    gains / period;

  let avgLoss =
    losses / period;

  function calc(
    gain,
    loss
  ) {

    if (loss === 0) {
      return 100;
    }

    const rs =
      gain / loss;

    return (
      100 -
      (
        100 /
        (
          1 + rs
        )
      )
    );

  }

  result[period] =
    calc(
      avgGain,
      avgLoss
    );

  for (
    let i =
      period + 1;
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
        (
          avgGain *
          (
            period - 1
          )
        ) +
        gain
      ) /
      period;

    avgLoss =
      (
        (
          avgLoss *
          (
            period - 1
          )
        ) +
        loss
      ) /
      period;

    result[i] =
      calc(
        avgGain,
        avgLoss
      );

  }

  return result;

}


/* ============================================================
   ATR
============================================================ */

export function atrSeries(
  candles,
  period = 14
) {

  const tr =
    new Array(
      candles.length
    ).fill(null);

  for (
    let i = 0;
    i < candles.length;
    i++
  ) {

    if (i === 0) {

      tr[i] =
        candles[i].high -
        candles[i].low;

      continue;

    }

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

  return emaSeries(
    tr,
    period
  );

}


/* ============================================================
   RESAMPLE M1
============================================================ */

export function resample(
  candles,
  minutes
) {

  if (minutes === 1) {
    return candles.map(
      c => ({
        ...c
      })
    );
  }

  const bucketMs =
    minutes *
    60 *
    1000;

  const map =
    new Map();

  for (
    const candle
    of candles
  ) {

    const bucket =
      Math.floor(
        candle.time /
        bucketMs
      ) *
      bucketMs;

    let current =
      map.get(
        bucket
      );

    if (!current) {

      current = {

        time: bucket,

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

      };

      map.set(
        bucket,
        current
      );

    } else {

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
        candle.volume;

    }

  }

  return Array
    .from(
      map.values()
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
   COMPLETED HTF CANDLES AT TIME
============================================================ */

export function completedBefore(
  candles,
  time,
  timeframeMinutes
) {

  const tfMs =
    timeframeMinutes *
    60 *
    1000;

  return candles.filter(
    c =>
      (
        c.time +
        tfMs
      ) <= time
  );

}


/* ============================================================
   CANDLE FEATURES
============================================================ */

export function candleShape(
  candle
) {

  const range =
    Math.max(
      candle.high -
      candle.low,
      Number.EPSILON
    );

  const body =
    Math.abs(
      candle.close -
      candle.open
    );

  const upper =
    candle.high -
    Math.max(
      candle.open,
      candle.close
    );

  const lower =
    Math.min(
      candle.open,
      candle.close
    ) -
    candle.low;

  return {

    range,

    body,

    bodyRatio:
      body / range,

    upperWickRatio:
      upper / range,

    lowerWickRatio:
      lower / range,

    bullish:
      candle.close >
      candle.open,

    bearish:
      candle.close <
      candle.open

  };

}


/* ============================================================
   VWAP
============================================================ */

export function rollingVWAP(
  candles,
  lookback
) {

  const slice =
    candles.slice(
      -lookback
    );

  let pv = 0;
  let volume = 0;

  for (
    const c
    of slice
  ) {

    const typical =
      (
        c.high +
        c.low +
        c.close
      ) /
      3;

    pv +=
      typical *
      c.volume;

    volume +=
      c.volume;

  }

  if (
    volume <= 0
  ) {

    return (
      slice[
        slice.length - 1
      ]?.close ??
      null
    );

  }

  return (
    pv /
    volume
  );

}


/* ============================================================
   SWING / STRUCTURE
============================================================ */

export function structureState(
  candles,
  lookback =
    SETTINGS.STRUCTURE_LOOKBACK
) {

  if (
    candles.length <
    lookback + 3
  ) {
    return null;
  }

  const current =
    candles[
      candles.length - 1
    ];

  const previous =
    candles.slice(
      -lookback - 1,
      -1
    );

  const resistance =
    Math.max(
      ...previous.map(
        c => c.high
      )
    );

  const support =
    Math.min(
      ...previous.map(
        c => c.low
      )
    );

  const recent =
    candles.slice(
      -SETTINGS.SWING_LOOKBACK
    );

  const recentHigh =
    Math.max(
      ...recent.map(
        c => c.high
      )
    );

  const recentLow =
    Math.min(
      ...recent.map(
        c => c.low
      )
    );

  const midpoint =
    (
      resistance +
      support
    ) /
    2;

  const bullishBreak =
    current.close >
    resistance;

  const bearishBreak =
    current.close <
    support;

  return {

    resistance,

    support,

    recentHigh,

    recentLow,

    midpoint,

    bullishBreak,

    bearishBreak

  };

}


/* ============================================================
   TIMEFRAME ANALYSIS
============================================================ */

export function analyseTimeframe(
  candles,
  label
) {

  if (
    candles.length <
    SETTINGS.MIN_BARS
  ) {
    return null;
  }

  const closes =
    candles.map(
      c => c.close
    );

  const volumes =
    candles.map(
      c => c.volume
    );

  const fast =
    emaSeries(
      closes,
      SETTINGS.FAST_EMA
    );

  const mid =
    emaSeries(
      closes,
      SETTINGS.MID_EMA
    );

  const slow =
    emaSeries(
      closes,
      SETTINGS.SLOW_EMA
    );

  const rsi =
    rsiSeries(
      closes,
      SETTINGS.RSI_PERIOD
    );

  const atr =
    atrSeries(
      candles,
      SETTINGS.ATR_PERIOD
    );

  const i =
    candles.length - 1;

  const current =
    candles[i];

  const previous =
    candles[i - 1];

  const shape =
    candleShape(
      current
    );

  const structure =
    structureState(
      candles
    );

  const avgVolume =
    average(
      volumes.slice(
        -SETTINGS.VOLUME_LOOKBACK - 1,
        -1
      )
    ) ||
    current.volume;

  const relativeVolume =
    avgVolume > 0
      ?
        current.volume /
        avgVolume
      :
        1;

  const volumeSpike =
    relativeVolume >=
    SETTINGS.VOLUME_SPIKE_MULT;

  const vwap =
    rollingVWAP(
      candles,
      SETTINGS.VWAP_LOOKBACK
    );

  const atrNow =
    atr[i];

  const fastNow =
    fast[i];

  const midNow =
    mid[i];

  const slowNow =
    slow[i];

  const rsiNow =
    rsi[i];

  const fastPrevious =
    fast[i - 3] ??
    fast[i - 1];

  const emaSlope =
    fastNow &&
    fastPrevious
      ?
        fastNow -
        fastPrevious
      :
        0;

  let trend =
    "NEUTRAL";

  if (
    current.close >
      fastNow &&
    fastNow >
      midNow &&
    midNow >
      slowNow
  ) {
    trend =
      "BULLISH";
  }

  if (
    current.close <
      fastNow &&
    fastNow <
      midNow &&
    midNow <
      slowNow
  ) {
    trend =
      "BEARISH";
  }

  const bullishRejection =
    (
      shape.lowerWickRatio >=
        0.35 &&
      current.close >
        current.open
    );

  const bearishRejection =
    (
      shape.upperWickRatio >=
        0.35 &&
      current.close <
        current.open
    );

  const bullishMomentum =
    (
      shape.bullish &&
      shape.bodyRatio >=
        0.55
    );

  const bearishMomentum =
    (
      shape.bearish &&
      shape.bodyRatio >=
        0.55
    );

  const previousShape =
    candleShape(
      previous
    );

  const bullishEngulf =
    (
      shape.bullish &&
      previousShape.bearish &&
      current.open <=
        previous.close &&
      current.close >=
        previous.open
    );

  const bearishEngulf =
    (
      shape.bearish &&
      previousShape.bullish &&
      current.open >=
        previous.close &&
      current.close <=
        previous.open
    );

  const aboveVWAP =
    current.close >
    vwap;

  const belowVWAP =
    current.close <
    vwap;

  const vwapReclaim =
    (
      previous.close <=
        vwap &&
      current.close >
        vwap
    );

  const vwapReject =
    (
      previous.close >=
        vwap &&
      current.close <
        vwap
    );

  const pressure =
    (
      (
        current.close -
        current.open
      ) /
      Math.max(
        shape.range,
        Number.EPSILON
      )
    ) *
    relativeVolume;

  return {

    label,

    candle: current,

    previous,

    atr:
      atrNow,

    fastEMA:
      fastNow,

    midEMA:
      midNow,

    slowEMA:
      slowNow,

    emaSlope,

    rsi:
      rsiNow,

    vwap,

    trend,

    structure,

    relativeVolume,

    volumeSpike,

    pressure,

    bullishRejection,

    bearishRejection,

    bullishMomentum,

    bearishMomentum,

    bullishEngulf,

    bearishEngulf,

    aboveVWAP,

    belowVWAP,

    vwapReclaim,

    vwapReject

  };

}


/* ============================================================
   BUILD SIGNAL
============================================================ */

export function buildSignal(
  m1Candles,
  options = {}
) {

  const modeName =
    String(
      options.mode ||
      "BALANCED"
    ).toUpperCase();

  const mode =
    SETTINGS.MODES[
      modeName
    ] ||
    SETTINGS.MODES.BALANCED;

  if (
    m1Candles.length <
    300
  ) {

    return {
      signal: "WAIT",
      reason:
        "Not enough M1 data"
    };

  }


  /* ----------------------------------------------------------
     RESAMPLE
  ---------------------------------------------------------- */

  const m5All =
    resample(
      m1Candles,
      5
    );

  const m15All =
    resample(
      m1Candles,
      15
    );

  const h1All =
    resample(
      m1Candles,
      60
    );


  const lastM1 =
    m1Candles[
      m1Candles.length - 1
    ];

  const decisionTime =
    lastM1.time +
    60 * 1000;


  const m5 =
    completedBefore(
      m5All,
      decisionTime,
      5
    );

  const m15 =
    completedBefore(
      m15All,
      decisionTime,
      15
    );

  const h1 =
    completedBefore(
      h1All,
      decisionTime,
      60
    );


  const a1 =
    analyseTimeframe(
      m1Candles,
      "M1"
    );

  const a5 =
    analyseTimeframe(
      m5,
      "M5"
    );

  const a15 =
    analyseTimeframe(
      m15,
      "M15"
    );

  const a60 =
    h1.length >=
      SETTINGS.MIN_BARS
      ?
        analyseTimeframe(
          h1,
          "H1"
        )
      :
        null;


  if (
    !a1 ||
    !a5 ||
    !a15
  ) {

    return {
      signal: "WAIT",
      reason:
        "Insufficient completed timeframe data"
    };

  }


  /* ----------------------------------------------------------
     SCORE
  ---------------------------------------------------------- */

  let buy = 0;
  let sell = 0;

  const buyReasons = [];
  const sellReasons = [];


  function addBuy(
    points,
    reason
  ) {

    buy += points;

    buyReasons.push(
      `+${points} ${reason}`
    );

  }


  function addSell(
    points,
    reason
  ) {

    sell += points;

    sellReasons.push(
      `+${points} ${reason}`
    );

  }


  /* ==========================================================
     M15 DIRECTION
  ========================================================== */

  if (
    a15.trend ===
    "BULLISH"
  ) {

    addBuy(
      15,
      "M15 bullish trend"
    );

  }


  if (
    a15.trend ===
    "BEARISH"
  ) {

    addSell(
      15,
      "M15 bearish trend"
    );

  }


  if (
    a15.emaSlope > 0
  ) {

    addBuy(
      4,
      "M15 EMA slope rising"
    );

  }


  if (
    a15.emaSlope < 0
  ) {

    addSell(
      4,
      "M15 EMA slope falling"
    );

  }


  /* ==========================================================
     M5 STRUCTURE
  ========================================================== */

  if (
    a5.trend ===
    "BULLISH"
  ) {

    addBuy(
      14,
      "M5 bullish structure"
    );

  }


  if (
    a5.trend ===
    "BEARISH"
  ) {

    addSell(
      14,
      "M5 bearish structure"
    );

  }


  if (
    a5.structure
      ?.bullishBreak
  ) {

    addBuy(
      12,
      "M5 bullish breakout"
    );

  }


  if (
    a5.structure
      ?.bearishBreak
  ) {

    addSell(
      12,
      "M5 bearish breakout"
    );

  }


  if (
    a5.aboveVWAP
  ) {

    addBuy(
      6,
      "M5 above VWAP"
    );

  }


  if (
    a5.belowVWAP
  ) {

    addSell(
      6,
      "M5 below VWAP"
    );

  }


  if (
    a5.pressure >
    0.35
  ) {

    addBuy(
      7,
      "M5 bullish volume pressure"
    );

  }


  if (
    a5.pressure <
    -0.35
  ) {

    addSell(
      7,
      "M5 bearish volume pressure"
    );

  }


  /* ==========================================================
     M1 ENTRY
  ========================================================== */

  if (
    a1.trend ===
    "BULLISH"
  ) {

    addBuy(
      8,
      "M1 trend bullish"
    );

  }


  if (
    a1.trend ===
    "BEARISH"
  ) {

    addSell(
      8,
      "M1 trend bearish"
    );

  }


  if (
    a1.bullishRejection
  ) {

    addBuy(
      10,
      "M1 bullish rejection"
    );

  }


  if (
    a1.bearishRejection
  ) {

    addSell(
      10,
      "M1 bearish rejection"
    );

  }


  if (
    a1.bullishEngulf
  ) {

    addBuy(
      8,
      "M1 bullish engulfing"
    );

  }


  if (
    a1.bearishEngulf
  ) {

    addSell(
      8,
      "M1 bearish engulfing"
    );

  }


  if (
    a1.bullishMomentum
  ) {

    addBuy(
      7,
      "M1 bullish momentum"
    );

  }


  if (
    a1.bearishMomentum
  ) {

    addSell(
      7,
      "M1 bearish momentum"
    );

  }


  if (
    a1.vwapReclaim
  ) {

    addBuy(
      10,
      "M1 VWAP reclaim"
    );

  }


  if (
    a1.vwapReject
  ) {

    addSell(
      10,
      "M1 VWAP rejection"
    );

  }


  if (
    a1.aboveVWAP
  ) {

    addBuy(
      4,
      "M1 above VWAP"
    );

  }


  if (
    a1.belowVWAP
  ) {

    addSell(
      4,
      "M1 below VWAP"
    );

  }


  if (
    a1.rsi >= 52 &&
    a1.rsi <= 75
  ) {

    addBuy(
      5,
      "M1 RSI supports upside"
    );

  }


  if (
    a1.rsi <= 48 &&
    a1.rsi >= 25
  ) {

    addSell(
      5,
      "M1 RSI supports downside"
    );

  }


  if (
    a1.volumeSpike
  ) {

    if (
      a1.pressure > 0
    ) {

      addBuy(
        6,
        "M1 bullish volume spike"
      );

    }

    if (
      a1.pressure < 0
    ) {

      addSell(
        6,
        "M1 bearish volume spike"
      );

    }

  }


  /* ==========================================================
     H1 BONUS ONLY

     H1 DOES NOT BLOCK TRADES.
  ========================================================== */

  if (a60) {

    if (
      a60.trend ===
      "BULLISH"
    ) {

      addBuy(
        5,
        "H1 bullish context"
      );

    }


    if (
      a60.trend ===
      "BEARISH"
    ) {

      addSell(
        5,
        "H1 bearish context"
      );

    }

  }


  /* ==========================================================
     NORMALISE
  ========================================================== */

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
      mode.minScore &&
    buy > sell &&
    gap >=
      mode.minGap
  ) {

    signal =
      "BUY";

  }


  if (
    sell >=
      mode.minScore &&
    sell > buy &&
    gap >=
      mode.minGap
  ) {

    signal =
      "SELL";

  }


  /* ==========================================================
     TRADE LEVELS
  ========================================================== */

  const entry =
    a1.candle.close;

  let stop = null;
  let target = null;
  let risk = null;


  if (
    signal !==
    "WAIT"
  ) {

    const atr =
      a1.atr;


    if (
      signal ===
      "BUY"
    ) {

      const structuralStop =
        Math.min(
          ...m1Candles
            .slice(
              -8
            )
            .map(
              c => c.low
            )
        );


      const atrStop =
        entry -
        (
          atr *
          SETTINGS.ATR_STOP_MULT
        );


      stop =
        Math.min(
          structuralStop,
          atrStop
        );


      let distance =
        entry -
        stop;


      distance =
        clamp(
          distance,
          atr *
            SETTINGS.MIN_STOP_ATR,
          atr *
            SETTINGS.MAX_STOP_ATR
        );


      stop =
        entry -
        distance;


      risk =
        distance;


      target =
        entry +
        (
          risk *
          SETTINGS.RR
        );

    }


    if (
      signal ===
      "SELL"
    ) {

      const structuralStop =
        Math.max(
          ...m1Candles
            .slice(
              -8
            )
            .map(
              c => c.high
            )
        );


      const atrStop =
        entry +
        (
          atr *
          SETTINGS.ATR_STOP_MULT
        );


      stop =
        Math.max(
          structuralStop,
          atrStop
        );


      let distance =
        stop -
        entry;


      distance =
        clamp(
          distance,
          atr *
            SETTINGS.MIN_STOP_ATR,
          atr *
            SETTINGS.MAX_STOP_ATR
        );


      stop =
        entry +
        distance;


      risk =
        distance;


      target =
        entry -
        (
          risk *
          SETTINGS.RR
        );

    }

  }


  /* ==========================================================
     SETUP NAME
  ========================================================== */

  let setup =
    "NONE";


  if (
    signal ===
    "BUY"
  ) {

    if (
      a1.vwapReclaim
    ) {

      setup =
        "VWAP RECLAIM";

    } else if (
      a1.bullishRejection
    ) {

      setup =
        "SUPPORT REJECTION";

    } else if (
      a5.structure
        ?.bullishBreak
    ) {

      setup =
        "STRUCTURE BREAKOUT";

    } else {

      setup =
        "BULLISH PRESSURE";

    }

  }


  if (
    signal ===
    "SELL"
  ) {

    if (
      a1.vwapReject
    ) {

      setup =
        "VWAP REJECTION";

    } else if (
      a1.bearishRejection
    ) {

      setup =
        "RESISTANCE REJECTION";

    } else if (
      a5.structure
        ?.bearishBreak
    ) {

      setup =
        "STRUCTURE BREAKOUT";

    } else {

      setup =
        "BEARISH PRESSURE";

    }

  }


  return {

    signal,

    mode:
      modeName,

    setup,

    score:
      signal ===
      "BUY"
        ?
          buy
        :
      signal ===
      "SELL"
        ?
          sell
        :
          Math.max(
            buy,
            sell
          ),

    buyScore:
      buy,

    sellScore:
      sell,

    scoreGap:
      gap,

    entry:
      round(
        entry,
        2
      ),

    stop:
      round(
        stop,
        2
      ),

    target:
      round(
        target,
        2
      ),

    risk:
      round(
        risk,
        2
      ),

    rr:
      SETTINGS.RR,

    price:
      round(
        a1.candle.close,
        2
      ),

    relativeVolume:
      round(
        a1.relativeVolume,
        2
      ),

    pressure:
      round(
        a1.pressure,
        3
      ),

    timeframeBias: {

      M1:
        a1.trend,

      M5:
        a5.trend,

      M15:
        a15.trend,

      H1:
        a60
          ?
            a60.trend
          :
            "N/A"

    },

    vwap: {

      M1:
        round(
          a1.vwap,
          2
        ),

      M5:
        round(
          a5.vwap,
          2
        ),

      M15:
        round(
          a15.vwap,
          2
        )

    },

    structure: {

      M5Support:
        round(
          a5.structure
            ?.support,
          2
        ),

      M5Resistance:
        round(
          a5.structure
            ?.resistance,
          2
        ),

      bullishBreak:
        Boolean(
          a5.structure
            ?.bullishBreak
        ),

      bearishBreak:
        Boolean(
          a5.structure
            ?.bearishBreak
        )

    },

    reasons:
      signal ===
      "BUY"
        ?
          buyReasons
        :
      signal ===
      "SELL"
        ?
          sellReasons
        :
          [],

    generatedAt:
      new Date(
        decisionTime
      ).toISOString()

  };

}


/* ============================================================
   COINBASE FETCH
============================================================ */

export async function fetchCoinbaseCandles(
  {
    start,
    end,
    granularity = 60
  } = {}
) {

  const params =
    new URLSearchParams();

  params.set(
    "granularity",
    String(
      granularity
    )
  );


  if (start) {

    params.set(
      "start",
      new Date(
        start
      ).toISOString()
    );

  }


  if (end) {

    params.set(
      "end",
      new Date(
        end
      ).toISOString()
    );

  }


  const url =
    `${COINBASE_BASE}/products/${PRODUCT}/candles?${params.toString()}`;


  const response =
    await fetch(
      url,
      {
        headers: {

          Accept:
            "application/json",

          "User-Agent":
            "MKAYFX-BTC-DYNAMIC/1.0"

        }
      }
    );


  if (
    !response.ok
  ) {

    const body =
      await response.text();

    throw new Error(
      `Coinbase ${response.status}: ${body}`
    );

  }


  const raw =
    await response.json();


  if (
    !Array.isArray(
      raw
    )
  ) {

    throw new Error(
      "Invalid Coinbase candle response"
    );

  }


  return raw
    .map(
      row => ({

        time:
          Number(
            row[0]
          ) *
          1000,

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
      c =>
        Number.isFinite(
          c.time
        ) &&
        Number.isFinite(
          c.open
        ) &&
        Number.isFinite(
          c.high
        ) &&
        Number.isFinite(
          c.low
        ) &&
        Number.isFinite(
          c.close
        ) &&
        Number.isFinite(
          c.volume
        )
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
   FETCH RECENT M1 HISTORY IN CHUNKS
============================================================ */

export async function fetchRecentM1(
  minutes = 900
) {

  const now =
    Date.now();

  const start =
    now -
    (
      minutes *
      60 *
      1000
    );


  return fetchM1Range(
    start,
    now
  );

}


/* ============================================================
   FETCH ARBITRARY M1 RANGE

   Coinbase candle endpoint limits the number of candles per
   request, so we request smaller chunks.
============================================================ */

export async function fetchM1Range(
  startMs,
  endMs
) {

  const result =
    new Map();


  const chunkMinutes =
    290;


  const chunkMs =
    chunkMinutes *
    60 *
    1000;


  for (
    let cursor =
      startMs;
    cursor <
      endMs;
    cursor +=
      chunkMs
  ) {

    const chunkEnd =
      Math.min(
        cursor +
          chunkMs,
        endMs
      );


    const candles =
      await fetchCoinbaseCandles(
        {

          start:
            cursor,

          end:
            chunkEnd,

          granularity:
            60

        }
      );


    for (
      const candle
      of candles
    ) {

      result.set(
        candle.time,
        candle
      );

    }


    if (
      chunkEnd <
      endMs
    ) {

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            75
          )
      );

    }

  }


  return Array
    .from(
      result.values()
    )
    .filter(
      c =>
        c.time >=
          startMs &&
        c.time <=
          endMs
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
   LIVE API HANDLER
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


    const mode =
      String(
        req.query?.mode ||
        "BALANCED"
      ).toUpperCase();


    /*
      We need enough history for completed H1 context.

      H1 is optional, so the strategy still works if the
      available H1 history is insufficient.
    */

    const candles =
      await fetchRecentM1(
        1500
      );


    if (
      candles.length <
      300
    ) {

      return res
        .status(
          503
        )
        .json(
          {

            ok: false,

            error:
              "Not enough Coinbase M1 candles",

            candles:
              candles.length

          }
        );

    }


    /*
      Remove the current still-forming M1 candle.

      Coinbase may return it.
    */

    const currentMinute =
      Math.floor(
        Date.now() /
        60000
      ) *
      60000;


    const completed =
      candles.filter(
        c =>
          c.time <
          currentMinute
      );


    const analysis =
      buildSignal(
        completed,
        {
          mode
        }
      );


    return res
      .status(
        200
      )
      .json(
        {

          ok: true,

          product:
            PRODUCT,

          source:
            "Coinbase Exchange",

          strategy:
            "MKAYFX BTC Dynamic Structure V1",

          ...analysis

        }
      );

  } catch (
    error
  ) {

    console.error(
      error
    );


    return res
      .status(
        500
      )
      .json(
        {

          ok: false,

          error:
            error?.message ||
            "Unknown server error"

        }
      );

  }

}