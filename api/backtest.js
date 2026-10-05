/* =========================================================
   BTC/USD BACKTEST
   /api/backtest.js

   SAME CORE RULES AS /api/btc.js

   H1 TREND
   M15 ENTRY

   SL  = 1.2 ATR
   TP  = 2.2R

   TP1 is not used to close half the position in this
   first simple backtest.

   Instead:
   - Full result is measured against TP2.
   - Breakeven activates after +1R.

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

  targetR: 2.2,
  breakevenR: 1.0,

  minAtrPercent: 0.20,
  maxAtrPercent: 3.50,

  minBodyPercent: 0.55,

  pullbackLookback: 3,

  cooldownBars: 4
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
    throw new Error(
      `Twelve Data HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (data.status === "error") {
    throw new Error(
      data.message ||
      "Twelve Data error"
    );
  }

  if (!Array.isArray(data.values)) {
    throw new Error(
      "No historical candles returned"
    );
  }

  return data.values
    .map(v => ({
      datetime: v.datetime,

      time:
        new Date(
          v.datetime.replace(" ", "T") + "Z"
        ).getTime(),

      open: num(v.open),
      high: num(v.high),
      low: num(v.low),
      close: num(v.close),

      volume:
        num(v.volume) || 0
    }))
    .filter(c =>
      c.open !== null &&
      c.high !== null &&
      c.low !== null &&
      c.close !== null
    )
    .reverse();
}


// =========================================================
// EMA
// =========================================================

function ema(values, period) {

  const result =
    new Array(values.length).fill(null);

  if (values.length < period)
    return result;

  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += values[i];
  }

  let current =
    sum / period;

  result[period - 1] =
    current;

  const multiplier =
    2 / (period + 1);

  for (
    let i = period;
    i < values.length;
    i++
  ) {

    current =
      (values[i] - current) *
        multiplier +
      current;

    result[i] =
      current;
  }

  return result;
}


// =========================================================
// RSI
// =========================================================

function rsi(values, period = 14) {

  const result =
    new Array(values.length).fill(null);

  if (values.length <= period)
    return result;

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

    if (change > 0)
      gains += change;

    else
      losses +=
        Math.abs(change);
  }

  let avgGain =
    gains / period;

  let avgLoss =
    losses / period;

  result[period] =
    avgLoss === 0
      ? 100
      : 100 -
        100 /
        (1 + avgGain / avgLoss);

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];

    const gain =
      Math.max(change, 0);

    const loss =
      Math.max(-change, 0);

    avgGain =
      ((avgGain *
        (period - 1)) +
        gain) /
      period;

    avgLoss =
      ((avgLoss *
        (period - 1)) +
        loss) /
      period;

    result[i] =
      avgLoss === 0
        ? 100
        : 100 -
          100 /
          (1 +
            avgGain /
            avgLoss);
  }

  return result;
}


// =========================================================
// ATR
// =========================================================

function atr(candles, period = 14) {

  const result =
    new Array(candles.length)
      .fill(null);

  const tr =
    new Array(candles.length)
      .fill(null);

  if (candles.length <= period)
    return result;

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

  let sum = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    sum += tr[i];
  }

  let currentAtr =
    sum / period;

  result[period] =
    currentAtr;

  for (
    let i = period + 1;
    i < candles.length;
    i++
  ) {

    currentAtr =
      (
        currentAtr *
        (period - 1) +
        tr[i]
      ) /
      period;

    result[i] =
      currentAtr;
  }

  return result;
}


// =========================================================
// CANDLE STRENGTH
// =========================================================

function candleStrength(candle) {

  const range =
    candle.high -
    candle.low;

  if (range <= 0)
    return 0;

  return (
    Math.abs(
      candle.close -
      candle.open
    ) /
    range
  );
}


// =========================================================
// PULLBACK
// =========================================================

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
    let i = start;
    i <= index;
    i++
  ) {

    if (
      ema20[i] === null ||
      ema50[i] === null
    ) continue;

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
      candles[i].low <= upper &&
      candles[i].high >= lower
    ) {
      return true;
    }
  }

  return false;
}


// =========================================================
// FIND LAST COMPLETED H1 BAR
//
// M15 candle at 10:45 cannot use the 10:00 H1 candle
// because that H1 candle is still forming.
//
// So require:
// H1 timestamp <= M15 timestamp - 1 hour
// =========================================================

function findH1Index(
  h1,
  m15Time,
  startIndex = 0
) {

  const cutoff =
    m15Time -
    60 * 60 * 1000;

  let found =
    startIndex;

  while (
    found + 1 < h1.length &&
    h1[found + 1].time <= cutoff
  ) {
    found++;
  }

  if (
    h1[found] &&
    h1[found].time <= cutoff
  ) {
    return found;
  }

  return -1;
}


// =========================================================
// MAIN
// =========================================================

module.exports =
async function handler(req, res) {

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  try {

    if (!TD_KEY) {

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Missing TWELVE_DATA_API_KEY"
        });
    }


    const [m15, h1] =
      await Promise.all([

        getSeries(
          "15min",
          5000
        ),

        getSeries(
          "1h",
          1500
        )

      ]);


    if (
      m15.length < 300 ||
      h1.length < 220
    ) {

      throw new Error(
        "Not enough data for backtest"
      );
    }


    // =====================================================
    // INDICATORS
    // =====================================================

    const mClose =
      m15.map(c =>
        c.close
      );

    const hClose =
      h1.map(c =>
        c.close
      );


    const mEma20 =
      ema(
        mClose,
        SETTINGS.emaFast
      );

    const mEma50 =
      ema(
        mClose,
        SETTINGS.emaPullback
      );

    const mRsi =
      rsi(
        mClose,
        SETTINGS.rsiPeriod
      );

    const mAtr =
      atr(
        m15,
        SETTINGS.atrPeriod
      );


    const hEma50 =
      ema(
        hClose,
        SETTINGS.h1Fast
      );

    const hEma200 =
      ema(
        hClose,
        SETTINGS.h1Slow
      );


    // =====================================================
    // RESULTS
    // =====================================================

    const trades = [];

    let active = null;

    let cooldownUntil = -1;

    let hIndex = 0;


    // Start after enough M15 history exists
    for (
      let i = 60;
      i < m15.length;
      i++
    ) {

      const bar =
        m15[i];


      // ===================================================
      // MANAGE OPEN TRADE
      // ===================================================

      if (active) {

        const risk =
          active.risk;

        let stop =
          active.stop;

        const target =
          active.target;


        // ===============================================
        // BREAKEVEN CHECK
        // ===============================================

        if (
          !active.breakeven
        ) {

          if (
            active.side === "BUY" &&
            bar.high >=
              active.entry +
              risk *
              SETTINGS.breakevenR
          ) {

            active.breakeven =
              true;

            active.stop =
              active.entry;

            stop =
              active.stop;
          }

          else if (
            active.side === "SELL" &&
            bar.low <=
              active.entry -
              risk *
              SETTINGS.breakevenR
          ) {

            active.breakeven =
              true;

            active.stop =
              active.entry;

            stop =
              active.stop;
          }
        }


        // ===============================================
        // EXIT
        // ===============================================

        let exit = null;
        let resultR = null;
        let exitReason = null;


        if (
          active.side === "BUY"
        ) {

          /*
            Conservative assumption:

            If one candle touches both SL and TP,
            count the stop first.
          */

          if (
            bar.low <= stop
          ) {

            exit = stop;

            resultR =
              (exit -
                active.entry) /
              risk;

            exitReason =
              active.breakeven
                ? "BE"
                : "SL";
          }

          else if (
            bar.high >= target
          ) {

            exit =
              target;

            resultR =
              SETTINGS.targetR;

            exitReason =
              "TP";
          }
        }

        else {

          if (
            bar.high >= stop
          ) {

            exit =
              stop;

            resultR =
              (active.entry -
                exit) /
              risk;

            exitReason =
              active.breakeven
                ? "BE"
                : "SL";
          }

          else if (
            bar.low <= target
          ) {

            exit =
              target;

            resultR =
              SETTINGS.targetR;

            exitReason =
              "TP";
          }
        }


        if (
          exit !== null
        ) {

          trades.push({

            side:
              active.side,

            entryTime:
              active.entryTime,

            exitTime:
              bar.datetime,

            entry:
              round(
                active.entry,
                2
              ),

            exit:
              round(
                exit,
                2
              ),

            stop:
              round(
                active.originalStop,
                2
              ),

            target:
              round(
                active.target,
                2
              ),

            resultR:
              round(
                resultR,
                2
              ),

            exitReason
          });


          active = null;

          cooldownUntil =
            i +
            SETTINGS.cooldownBars;
        }


        /*
          Only one trade at a time.
        */
        continue;
      }


      // ===================================================
      // COOLDOWN
      // ===================================================

      if (
        i <= cooldownUntil
      ) {
        continue;
      }


      // ===================================================
      // INDICATORS READY?
      // ===================================================

      if (
        mEma20[i] === null ||
        mEma50[i] === null ||
        mRsi[i] === null ||
        mAtr[i] === null
      ) {
        continue;
      }


      // ===================================================
      // FIND COMPLETED H1 CANDLE
      // ===================================================

      hIndex =
        findH1Index(
          h1,
          bar.time,
          hIndex
        );


      if (
        hIndex < 200
      ) {
        continue;
      }


      if (
        hEma50[hIndex] === null ||
        hEma200[hIndex] === null
      ) {
        continue;
      }


      // ===================================================
      // H1 TREND
      // ===================================================

      const h1Bull =
        h1[hIndex].close >
          hEma200[hIndex] &&
        hEma50[hIndex] >
          hEma200[hIndex];


      const h1Bear =
        h1[hIndex].close <
          hEma200[hIndex] &&
        hEma50[hIndex] <
          hEma200[hIndex];


      // ===================================================
      // VOLATILITY
      // ===================================================

      const atrPercent =
        (
          mAtr[i] /
          bar.close
        ) * 100;


      const volatilityOk =
        atrPercent >=
          SETTINGS.minAtrPercent &&
        atrPercent <=
          SETTINGS.maxAtrPercent;


      if (!volatilityOk)
        continue;


      // ===================================================
      // STRONG CANDLE
      // ===================================================

      const strength =
        candleStrength(bar);


      if (
        strength <
        SETTINGS.minBodyPercent
      ) {
        continue;
      }


      // ===================================================
      // PULLBACK
      // ===================================================

      const pullback =
        hadPullback(
          m15,
          mEma20,
          mEma50,
          i,
          SETTINGS.pullbackLookback
        );


      if (!pullback)
        continue;


      // ===================================================
      // BUY CONDITIONS
      // ===================================================

      const buy =
        h1Bull &&

        bar.close >
          bar.open &&

        bar.close >
          mEma20[i] &&

        bar.close >
          mEma50[i] &&

        mRsi[i] >
          SETTINGS.buyRsi;


      // ===================================================
      // SELL CONDITIONS
      // ===================================================

      const sell =
        h1Bear &&

        bar.close <
          bar.open &&

        bar.close <
          mEma20[i] &&

        bar.close <
          mEma50[i] &&

        mRsi[i] <
          SETTINGS.sellRsi;


      if (
        !buy &&
        !sell
      ) {
        continue;
      }


      // ===================================================
      // ENTER AT NEXT BAR OPEN
      //
      // This avoids pretending we entered before
      // the confirmation candle closed.
      // ===================================================

      if (
        i + 1 >=
        m15.length
      ) {
        break;
      }


      const nextBar =
        m15[i + 1];

      const entry =
        nextBar.open;

      const risk =
        mAtr[i] *
        SETTINGS.stopAtr;


      if (
        !Number.isFinite(risk) ||
        risk <= 0
      ) {
        continue;
      }


      if (buy) {

        active = {

          side:
            "BUY",

          entryTime:
            nextBar.datetime,

          entry,

          risk,

          stop:
            entry - risk,

          originalStop:
            entry - risk,

          target:
            entry +
            risk *
            SETTINGS.targetR,

          breakeven:
            false
        };
      }

      else {

        active = {

          side:
            "SELL",

          entryTime:
            nextBar.datetime,

          entry,

          risk,

          stop:
            entry + risk,

          originalStop:
            entry + risk,

          target:
            entry -
            risk *
            SETTINGS.targetR,

          breakeven:
            false
        };
      }
    }


    // =====================================================
    // STATISTICS
    // =====================================================

    const total =
      trades.length;

    const winners =
      trades.filter(
        t =>
          t.resultR > 0
      );

    const losers =
      trades.filter(
        t =>
          t.resultR < 0
      );

    const breakevens =
      trades.filter(
        t =>
          t.resultR === 0
      );


    const wins =
      winners.length;

    const losses =
      losers.length;


    const winRate =
      total
        ? wins /
          total *
          100
        : 0;


    const grossProfit =
      winners.reduce(
        (sum, t) =>
          sum +
          t.resultR,
        0
      );


    const grossLoss =
      Math.abs(
        losers.reduce(
          (sum, t) =>
            sum +
            t.resultR,
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


    const netR =
      trades.reduce(
        (sum, t) =>
          sum +
          t.resultR,
        0
      );


    const averageR =
      total
        ? netR /
          total
        : 0;


    // =====================================================
    // MAX DRAWDOWN IN R
    // =====================================================

    let equity = 0;
    let peak = 0;
    let maxDrawdownR = 0;


    for (
      const trade of trades
    ) {

      equity +=
        trade.resultR;

      if (
        equity > peak
      ) {
        peak = equity;
      }

      const drawdown =
        peak - equity;

      if (
        drawdown >
        maxDrawdownR
      ) {
        maxDrawdownR =
          drawdown;
      }
    }


    // =====================================================
    // LONGEST LOSING STREAK
    // =====================================================

    let currentLossStreak = 0;
    let maxLossStreak = 0;


    for (
      const trade of trades
    ) {

      if (
        trade.resultR < 0
      ) {

        currentLossStreak++;

        maxLossStreak =
          Math.max(
            maxLossStreak,
            currentLossStreak
          );
      }

      else {

        currentLossStreak = 0;
      }
    }


    // =====================================================
    // BUY / SELL STATS
    // =====================================================

    const buyTrades =
      trades.filter(
        t =>
          t.side === "BUY"
      );

    const sellTrades =
      trades.filter(
        t =>
          t.side === "SELL"
      );


    const buyR =
      buyTrades.reduce(
        (s, t) =>
          s +
          t.resultR,
        0
      );


    const sellR =
      sellTrades.reduce(
        (s, t) =>
          s +
          t.resultR,
        0
      );


    // =====================================================
    // RESPONSE
    // =====================================================

    return res
      .status(200)
      .json({

        ok: true,

        symbol:
          SYMBOL,

        strategy:
          "H1 Trend + M15 Pullback",

        period: {

          from:
            m15[0]?.datetime,

          to:
            m15[
              m15.length - 1
            ]?.datetime,

          m15Candles:
            m15.length,

          h1Candles:
            h1.length
        },

        settings:
          SETTINGS,

        results: {

          trades:
            total,

          wins,

          losses,

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
            buyTrades.length,

          buyNetR:
            round(
              buyR,
              2
            ),

          sellTrades:
            sellTrades.length,

          sellNetR:
            round(
              sellR,
              2
            )
        },

        lastTrades:
          trades
            .slice(-30)
            .reverse()

      });

  }

  catch (error) {

    console.error(
      error
    );

    return res
      .status(500)
      .json({

        ok: false,

        error:
          error.message ||
          "Backtest failed"

      });
  }
};