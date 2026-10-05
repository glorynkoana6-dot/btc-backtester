/* =========================================================
   BTC/USD SIMPLE TREND + PULLBACK ENGINE
   /api/btc.js

   TIMEFRAMES
   ----------
   H1  = trend filter
   M15 = entry

   BUY
   ---
   H1 close > EMA200
   H1 EMA50 > EMA200
   M15 pulls back into EMA20/EMA50 area
   M15 closes bullish back above EMA20
   RSI > 52
   Strong candle
   ATR volatility filter passes

   SELL
   ----
   H1 close < EMA200
   H1 EMA50 < EMA200
   M15 pulls back into EMA20/EMA50 area
   M15 closes bearish back below EMA20
   RSI < 48
   Strong candle
   ATR volatility filter passes

   RISK
   ----
   SL = 1.2 ATR
   TP1 = 1.5R
   TP2 = 2.2R

   ENV
   ---
   TWELVE_DATA_API_KEY
========================================================= */

const TD_KEY = process.env.TWELVE_DATA_API_KEY;

const SYMBOL = "BTC/USD";

const SETTINGS = {
  atrPeriod: 14,
  rsiPeriod: 14,

  emaFast: 20,
  emaPullback: 50,

  h1Fast: 50,
  h1Slow: 200,

  buyRsi: 52,
  sellRsi: 48,

  stopAtr: 1.2,
  tp1R: 1.5,
  tp2R: 2.2,

  minAtrPercent: 0.20,
  maxAtrPercent: 3.50,

  minBodyPercent: 0.55,

  pullbackLookback: 3
};


// =========================================================
// HELPERS
// =========================================================

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, d = 2) {
  if (!Number.isFinite(v)) return null;
  return Number(v.toFixed(d));
}


// =========================================================
// TWELVE DATA
// =========================================================

async function getSeries(interval, outputsize) {
  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${encodeURIComponent(SYMBOL)}` +
    `&interval=${interval}` +
    `&outputsize=${outputsize}` +
    `&apikey=${TD_KEY}` +
    `&format=JSON`;

  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Twelve Data HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.status === "error") {
    throw new Error(data.message || "Twelve Data error");
  }

  if (!Array.isArray(data.values)) {
    throw new Error("No candle data returned");
  }

  const candles = data.values
    .map(v => ({
      datetime: v.datetime,
      time: new Date(v.datetime.replace(" ", "T") + "Z").getTime(),

      open: num(v.open),
      high: num(v.high),
      low: num(v.low),
      close: num(v.close),
      volume: num(v.volume) || 0
    }))
    .filter(c =>
      c.open !== null &&
      c.high !== null &&
      c.low !== null &&
      c.close !== null
    )
    .reverse();

  /*
    Twelve Data can include the currently-forming candle.

    Removing the newest candle makes the live strategy work
    from completed candles only.
  */
  if (candles.length > 2) {
    candles.pop();
  }

  return candles;
}


// =========================================================
// EMA
// =========================================================

function ema(values, period) {
  const result = new Array(values.length).fill(null);

  if (values.length < period) return result;

  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += values[i];
  }

  let current = sum / period;

  result[period - 1] = current;

  const multiplier = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {
    current =
      (values[i] - current) * multiplier +
      current;

    result[i] = current;
  }

  return result;
}


// =========================================================
// RSI
// =========================================================

function rsi(values, period = 14) {
  const result = new Array(values.length).fill(null);

  if (values.length <= period) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  result[period] =
    avgLoss === 0
      ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    avgGain =
      ((avgGain * (period - 1)) + gain) /
      period;

    avgLoss =
      ((avgLoss * (period - 1)) + loss) /
      period;

    result[i] =
      avgLoss === 0
        ? 100
        : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}


// =========================================================
// ATR
// =========================================================

function atr(candles, period = 14) {
  const result =
    new Array(candles.length).fill(null);

  if (candles.length <= period) return result;

  const tr = new Array(candles.length).fill(null);

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    tr[i] = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
  }

  let sum = 0;

  for (let i = 1; i <= period; i++) {
    sum += tr[i];
  }

  let currentAtr = sum / period;

  result[period] = currentAtr;

  for (let i = period + 1; i < candles.length; i++) {
    currentAtr =
      ((currentAtr * (period - 1)) + tr[i]) /
      period;

    result[i] = currentAtr;
  }

  return result;
}


// =========================================================
// STRONG CANDLE
// =========================================================

function candleStrength(candle) {
  const range =
    candle.high - candle.low;

  if (range <= 0) return 0;

  return (
    Math.abs(candle.close - candle.open) /
    range
  );
}


// =========================================================
// PULLBACK CHECK
// =========================================================

function hadBuyPullback(
  candles,
  ema20,
  ema50,
  index,
  lookback
) {
  const start =
    Math.max(0, index - lookback + 1);

  for (let i = start; i <= index; i++) {
    if (
      ema20[i] === null ||
      ema50[i] === null
    ) {
      continue;
    }

    const upper =
      Math.max(ema20[i], ema50[i]);

    const lower =
      Math.min(ema20[i], ema50[i]);

    if (
      candles[i].low <= upper &&
      candles[i].high >= lower
    ) {
      return true;
    }
  }

  return false;
}

function hadSellPullback(
  candles,
  ema20,
  ema50,
  index,
  lookback
) {
  const start =
    Math.max(0, index - lookback + 1);

  for (let i = start; i <= index; i++) {
    if (
      ema20[i] === null ||
      ema50[i] === null
    ) {
      continue;
    }

    const upper =
      Math.max(ema20[i], ema50[i]);

    const lower =
      Math.min(ema20[i], ema50[i]);

    if (
      candles[i].high >= lower &&
      candles[i].low <= upper
    ) {
      return true;
    }
  }

  return false;
}


// =========================================================
// MAIN API
// =========================================================

module.exports = async function handler(req, res) {

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  try {

    if (!TD_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing TWELVE_DATA_API_KEY environment variable"
      });
    }

    const [m15, h1] = await Promise.all([
      getSeries("15min", 350),
      getSeries("1h", 350)
    ]);

    if (
      m15.length < 100 ||
      h1.length < 220
    ) {
      throw new Error(
        "Not enough candle history"
      );
    }


    // =====================================================
    // M15 INDICATORS
    // =====================================================

    const m15Close =
      m15.map(c => c.close);

    const m15Ema20 =
      ema(m15Close, SETTINGS.emaFast);

    const m15Ema50 =
      ema(m15Close, SETTINGS.emaPullback);

    const m15Rsi =
      rsi(m15Close, SETTINGS.rsiPeriod);

    const m15Atr =
      atr(m15, SETTINGS.atrPeriod);


    // =====================================================
    // H1 INDICATORS
    // =====================================================

    const h1Close =
      h1.map(c => c.close);

    const h1Ema50 =
      ema(h1Close, SETTINGS.h1Fast);

    const h1Ema200 =
      ema(h1Close, SETTINGS.h1Slow);


    // =====================================================
    // CURRENT BARS
    // =====================================================

    const mi = m15.length - 1;
    const hi = h1.length - 1;

    const candle = m15[mi];
    const trendCandle = h1[hi];

    const price = candle.close;

    const atrNow = m15Atr[mi];
    const rsiNow = m15Rsi[mi];

    const ema20Now = m15Ema20[mi];
    const ema50Now = m15Ema50[mi];

    const h1Ema50Now = h1Ema50[hi];
    const h1Ema200Now = h1Ema200[hi];


    if (
      atrNow === null ||
      rsiNow === null ||
      ema20Now === null ||
      ema50Now === null ||
      h1Ema50Now === null ||
      h1Ema200Now === null
    ) {
      throw new Error(
        "Indicators not ready"
      );
    }


    // =====================================================
    // TREND
    // =====================================================

    const h1Bullish =
      trendCandle.close > h1Ema200Now &&
      h1Ema50Now > h1Ema200Now;

    const h1Bearish =
      trendCandle.close < h1Ema200Now &&
      h1Ema50Now < h1Ema200Now;


    // =====================================================
    // VOLATILITY
    // =====================================================

    const atrPercent =
      (atrNow / price) * 100;

    const volatilityOk =
      atrPercent >= SETTINGS.minAtrPercent &&
      atrPercent <= SETTINGS.maxAtrPercent;


    // =====================================================
    // CANDLE STRENGTH
    // =====================================================

    const strength =
      candleStrength(candle);

    const strongEnough =
      strength >= SETTINGS.minBodyPercent;

    const bullishCandle =
      candle.close > candle.open;

    const bearishCandle =
      candle.close < candle.open;


    // =====================================================
    // PULLBACK
    // =====================================================

    const buyPullback =
      hadBuyPullback(
        m15,
        m15Ema20,
        m15Ema50,
        mi,
        SETTINGS.pullbackLookback
      );

    const sellPullback =
      hadSellPullback(
        m15,
        m15Ema20,
        m15Ema50,
        mi,
        SETTINGS.pullbackLookback
      );


    // =====================================================
    // ENTRY CONFIRMATION
    // =====================================================

    const buyConfirmation =
      bullishCandle &&
      candle.close > ema20Now &&
      candle.close > ema50Now;

    const sellConfirmation =
      bearishCandle &&
      candle.close < ema20Now &&
      candle.close < ema50Now;


    // =====================================================
    // SIGNAL
    // =====================================================

    let signal = "WAIT";

    const reasons = [];

    if (
      h1Bullish &&
      buyPullback &&
      buyConfirmation &&
      rsiNow > SETTINGS.buyRsi &&
      strongEnough &&
      volatilityOk
    ) {
      signal = "BUY";

      reasons.push(
        "H1 bullish trend",
        "M15 pullback into EMA zone",
        "Bullish M15 confirmation",
        `RSI ${round(rsiNow, 1)} > ${SETTINGS.buyRsi}`,
        "Strong bullish candle",
        "ATR volatility filter passed"
      );
    }

    else if (
      h1Bearish &&
      sellPullback &&
      sellConfirmation &&
      rsiNow < SETTINGS.sellRsi &&
      strongEnough &&
      volatilityOk
    ) {
      signal = "SELL";

      reasons.push(
        "H1 bearish trend",
        "M15 pullback into EMA zone",
        "Bearish M15 confirmation",
        `RSI ${round(rsiNow, 1)} < ${SETTINGS.sellRsi}`,
        "Strong bearish candle",
        "ATR volatility filter passed"
      );
    }

    else {

      if (h1Bullish)
        reasons.push("H1 trend bullish");

      else if (h1Bearish)
        reasons.push("H1 trend bearish");

      else
        reasons.push("H1 trend not aligned");

      if (!volatilityOk)
        reasons.push(
          `ATR volatility blocked: ${round(atrPercent, 3)}%`
        );

      if (!strongEnough)
        reasons.push(
          `Weak M15 candle: ${round(strength * 100, 1)}% body`
        );

      reasons.push(
        `M15 RSI: ${round(rsiNow, 1)}`
      );
    }


    // =====================================================
    // TRADE LEVELS
    // =====================================================

    let entry = null;
    let stopLoss = null;
    let takeProfit1 = null;
    let takeProfit2 = null;
    let risk = null;

    if (signal !== "WAIT") {

      entry = price;

      risk =
        atrNow * SETTINGS.stopAtr;

      if (signal === "BUY") {

        stopLoss =
          entry - risk;

        takeProfit1 =
          entry + risk * SETTINGS.tp1R;

        takeProfit2 =
          entry + risk * SETTINGS.tp2R;
      }

      else {

        stopLoss =
          entry + risk;

        takeProfit1 =
          entry - risk * SETTINGS.tp1R;

        takeProfit2 =
          entry - risk * SETTINGS.tp2R;
      }
    }


    // =====================================================
    // RESPONSE
    // =====================================================

    return res.status(200).json({

      ok: true,

      symbol: SYMBOL,

      strategy:
        "H1 Trend + M15 Pullback",

      signal,

      timeframe: {
        trend: "1h",
        entry: "15min"
      },

      candleTime:
        candle.datetime,

      price:
        round(price, 2),

      entry:
        round(entry, 2),

      stopLoss:
        round(stopLoss, 2),

      takeProfit1:
        round(takeProfit1, 2),

      takeProfit2:
        round(takeProfit2, 2),

      riskDistance:
        round(risk, 2),

      rr: {
        tp1: SETTINGS.tp1R,
        tp2: SETTINGS.tp2R
      },

      trend: {
        h1:
          h1Bullish
            ? "BULLISH"
            : h1Bearish
            ? "BEARISH"
            : "NEUTRAL",

        close:
          round(trendCandle.close, 2),

        ema50:
          round(h1Ema50Now, 2),

        ema200:
          round(h1Ema200Now, 2)
      },

      m15: {
        ema20:
          round(ema20Now, 2),

        ema50:
          round(ema50Now, 2),

        rsi:
          round(rsiNow, 2),

        atr:
          round(atrNow, 2),

        atrPercent:
          round(atrPercent, 3),

        candleStrength:
          round(strength * 100, 1),

        buyPullback,

        sellPullback
      },

      reasons
    });

  }

  catch (error) {

    console.error(error);

    return res.status(500).json({
      ok: false,
      error:
        error.message ||
        "BTC analysis failed"
    });
  }
};