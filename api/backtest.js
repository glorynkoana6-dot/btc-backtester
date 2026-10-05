/* ============================================================
   MKAYFX BTC DYNAMIC STRUCTURE V1
   /api/backtest.js

   SOURCE
   ------
   Coinbase Exchange

   PRODUCT
   -------
   BTC-USD

   EXECUTION
   ---------
   Signal:
   Completed M1 candle.

   Entry:
   NEXT M1 candle OPEN.

   Context:
   M5 + M15 + optional H1.

   TARGET
   ------
   1.5R

   SAME-BAR COLLISION
   ------------------
   SL FIRST.

   MODES
   -----
   SELECTIVE
   BALANCED
   AGGRESSIVE
============================================================ */


import {

  PRODUCT,

  SETTINGS,

  buildSignal,

  fetchM1Range,

  round

} from "./btc.js";


/* ============================================================
   LIMITS
============================================================ */

const MIN_DAYS = 1;

const MAX_DAYS = 30;


/* ============================================================
   QUERY HELPERS
============================================================ */

function parseDays(
  value
) {

  const parsed =
    Number(
      value
    );


  if (
    !Number.isFinite(
      parsed
    )
  ) {

    return 10;

  }


  return Math.max(
    MIN_DAYS,
    Math.min(
      MAX_DAYS,
      Math.round(
        parsed
      )
    )
  );

}


function parseMode(
  value
) {

  const mode =
    String(
      value ||
      "BALANCED"
    ).toUpperCase();


  if (
    !SETTINGS.MODES[
      mode
    ]
  ) {

    return "BALANCED";

  }


  return mode;

}


/* ============================================================
   TRADE SIMULATOR
============================================================ */

function simulateTrade(
  candles,
  entryIndex,
  signal
) {

  const entryCandle =
    candles[
      entryIndex
    ];


  if (
    !entryCandle
  ) {

    return null;

  }


  /*
    IMPORTANT:

    Signal was produced on previous completed M1 candle.

    Actual backtest entry is this candle's OPEN.
  */

  const entry =
    entryCandle.open;


  const originalRisk =
    signal.risk;


  if (
    !Number.isFinite(
      originalRisk
    ) ||
    originalRisk <= 0
  ) {

    return null;

  }


  let stop;
  let target;


  if (
    signal.signal ===
    "BUY"
  ) {

    stop =
      entry -
      originalRisk;


    target =
      entry +
      (
        originalRisk *
        SETTINGS.RR
      );

  } else {

    stop =
      entry +
      originalRisk;


    target =
      entry -
      (
        originalRisk *
        SETTINGS.RR
      );

  }


  let maxFavourable =
    0;

  let maxAdverse =
    0;


  /*
    Do not hold a 1-minute scalp indefinitely.

    Maximum holding period:
    180 M1 candles = 3 hours.
  */

  const maxBars =
    180;


  const finalIndex =
    Math.min(
      candles.length - 1,
      entryIndex +
        maxBars
    );


  for (
    let i =
      entryIndex;
    i <=
      finalIndex;
    i++
  ) {

    const candle =
      candles[i];


    if (
      signal.signal ===
      "BUY"
    ) {

      const favourable =
        candle.high -
        entry;


      const adverse =
        entry -
        candle.low;


      maxFavourable =
        Math.max(
          maxFavourable,
          favourable
        );


      maxAdverse =
        Math.max(
          maxAdverse,
          adverse
        );


      const hitStop =
        candle.low <=
        stop;


      const hitTarget =
        candle.high >=
        target;


      /*
        Conservative collision assumption.
      */

      if (
        hitStop &&
        hitTarget
      ) {

        return {

          exitIndex:
            i,

          result:
            "LOSS",

          r:
            -1,

          exit:
            stop,

          entry,

          stop,

          target,

          barsHeld:
            i -
            entryIndex +
            1,

          mfeR:
            maxFavourable /
            originalRisk,

          maeR:
            maxAdverse /
            originalRisk

        };

      }


      if (
        hitStop
      ) {

        return {

          exitIndex:
            i,

          result:
            "LOSS",

          r:
            -1,

          exit:
            stop,

          entry,

          stop,

          target,

          barsHeld:
            i -
            entryIndex +
            1,

          mfeR:
            maxFavourable /
            originalRisk,

          maeR:
            maxAdverse /
            originalRisk

        };

      }


      if (
        hitTarget
      ) {

        return {

          exitIndex:
            i,

          result:
            "WIN",

          r:
            SETTINGS.RR,

          exit:
            target,

          entry,

          stop,

          target,

          barsHeld:
            i -
            entryIndex +
            1,

          mfeR:
            maxFavourable /
            originalRisk,

          maeR:
            maxAdverse /
            originalRisk

        };

      }

    } else {

      const favourable =
        entry -
        candle.low;


      const adverse =
        candle.high -
        entry;


      maxFavourable =
        Math.max(
          maxFavourable,
          favourable
        );


      maxAdverse =
        Math.max(
          maxAdverse,
          adverse
        );


      const hitStop =
        candle.high >=
        stop;


      const hitTarget =
        candle.low <=
        target;


      if (
        hitStop &&
        hitTarget
      ) {

        return {

          exitIndex:
            i,

          result:
            "LOSS",

          r:
            -1,

          exit:
            stop,

          entry,

          stop,

          target,

          barsHeld:
            i -
            entryIndex +
            1,

          mfeR:
            maxFavourable /
            originalRisk,

          maeR:
            maxAdverse /
            originalRisk

        };

      }


      if (
        hitStop
      ) {

        return {

          exitIndex:
            i,

          result:
            "LOSS",

          r:
            -1,

          exit:
            stop,

          entry,

          stop,

          target,

          barsHeld:
            i -
            entryIndex +
            1,

          mfeR:
            maxFavourable /
            originalRisk,

          maeR:
            maxAdverse /
            originalRisk

        };

      }


      if (
        hitTarget
      ) {

        return {

          exitIndex:
            i,

          result:
            "WIN",

          r:
            SETTINGS.RR,

          exit:
            target,

          entry,

          stop,

          target,

          barsHeld:
            i -
            entryIndex +
            1,

          mfeR:
            maxFavourable /
            originalRisk,

          maeR:
            maxAdverse /
            originalRisk

        };

      }

    }

  }


  /*
    TIME EXIT

    Convert open P/L to R.
  */

  const finalCandle =
    candles[
      finalIndex
    ];


  const exit =
    finalCandle.close;


  let r;


  if (
    signal.signal ===
    "BUY"
  ) {

    r =
      (
        exit -
        entry
      ) /
      originalRisk;

  } else {

    r =
      (
        entry -
        exit
      ) /
      originalRisk;

  }


  /*
    Keep time-exit result bounded.
  */

  r =
    Math.max(
      -1,
      Math.min(
        SETTINGS.RR,
        r
      )
    );


  return {

    exitIndex:
      finalIndex,

    result:
      r > 0
        ?
          "WIN"
        :
      r < 0
        ?
          "LOSS"
        :
          "FLAT",

    r,

    exit,

    entry,

    stop,

    target,

    barsHeld:
      finalIndex -
      entryIndex +
      1,

    mfeR:
      maxFavourable /
      originalRisk,

    maeR:
      maxAdverse /
      originalRisk,

    timeExit:
      true

  };

}


/* ============================================================
   PROFIT FACTOR
============================================================ */

function profitFactor(
  trades
) {

  let grossProfit = 0;

  let grossLoss = 0;


  for (
    const trade
    of trades
  ) {

    if (
      trade.r > 0
    ) {

      grossProfit +=
        trade.r;

    }


    if (
      trade.r < 0
    ) {

      grossLoss +=
        Math.abs(
          trade.r
        );

    }

  }


  if (
    grossLoss === 0
  ) {

    return grossProfit > 0
      ?
        999
      :
        0;

  }


  return (
    grossProfit /
    grossLoss
  );

}


/* ============================================================
   DRAWDOWN
============================================================ */

function maxDrawdown(
  trades
) {

  let equity = 0;

  let peak = 0;

  let maxDD = 0;


  for (
    const trade
    of trades
  ) {

    equity +=
      trade.r;


    peak =
      Math.max(
        peak,
        equity
      );


    maxDD =
      Math.max(
        maxDD,
        peak -
        equity
      );

  }


  return maxDD;

}


/* ============================================================
   STREAK
============================================================ */

function longestLossStreak(
  trades
) {

  let current = 0;

  let longest = 0;


  for (
    const trade
    of trades
  ) {

    if (
      trade.r < 0
    ) {

      current++;

      longest =
        Math.max(
          longest,
          current
        );

    } else {

      current = 0;

    }

  }


  return longest;

}


/* ============================================================
   GROUP STATS
============================================================ */

function groupStats(
  trades,
  keyFunction
) {

  const groups = {};


  for (
    const trade
    of trades
  ) {

    const key =
      keyFunction(
        trade
      ) ||
      "UNKNOWN";


    if (
      !groups[
        key
      ]
    ) {

      groups[
        key
      ] = [];

    }


    groups[
      key
    ].push(
      trade
    );

  }


  const result = {};


  for (
    const [
      key,
      list
    ]
    of Object.entries(
      groups
    )
  ) {

    const wins =
      list.filter(
        t => t.r > 0
      ).length;


    const netR =
      list.reduce(
        (
          total,
          trade
        ) =>
          total +
          trade.r,
        0
      );


    result[
      key
    ] = {

      trades:
        list.length,

      wins,

      losses:
        list.filter(
          t => t.r < 0
        ).length,

      winRate:
        round(
          (
            wins /
            list.length
          ) *
          100,
          2
        ),

      netR:
        round(
          netR,
          2
        ),

      expectancy:
        round(
          netR /
          list.length,
          3
        ),

      profitFactor:
        round(
          profitFactor(
            list
          ),
          2
        )

    };

  }


  return result;

}


/* ============================================================
   SESSION
============================================================ */

function utcSession(
  timestamp
) {

  const hour =
    new Date(
      timestamp
    ).getUTCHours();


  if (
    hour >= 0 &&
    hour < 7
  ) {

    return "ASIA";

  }


  if (
    hour >= 7 &&
    hour < 13
  ) {

    return "LONDON";

  }


  if (
    hour >= 13 &&
    hour < 17
  ) {

    return "LONDON_NY";

  }


  if (
    hour >= 17 &&
    hour < 22
  ) {

    return "NEW_YORK";

  }


  return "LATE_US";

}


/* ============================================================
   BACKTEST
============================================================ */

function runBacktest(
  candles,
  mode,
  requestedStart
) {

  const trades = [];


  /*
    Need warmup history for M15/H1.

    1,200 M1 candles = 20 hours.

    H1 is optional, so this is sufficient for the core strategy.
  */

  const warmup =
    1200;


  let i =
    warmup;


  while (
    i <
    candles.length - 2
  ) {

    const signalCandle =
      candles[i];


    /*
      Do not count warmup-period signals.
    */

    if (
      signalCandle.time <
      requestedStart
    ) {

      i++;

      continue;

    }


    const history =
      candles.slice(
        0,
        i + 1
      );


    const signal =
      buildSignal(
        history,
        {
          mode
        }
      );


    if (
      signal.signal ===
      "WAIT"
    ) {

      i++;

      continue;

    }


    /*
      Next candle open.
    */

    const entryIndex =
      i + 1;


    const simulation =
      simulateTrade(
        candles,
        entryIndex,
        signal
      );


    if (
      !simulation
    ) {

      i++;

      continue;

    }


    const trade = {

      id:
        trades.length + 1,

      side:
        signal.signal,

      setup:
        signal.setup,

      score:
        signal.score,

      buyScore:
        signal.buyScore,

      sellScore:
        signal.sellScore,

      scoreGap:
        signal.scoreGap,

      signalTime:
        new Date(
          signalCandle.time
        ).toISOString(),

      entryTime:
        new Date(
          candles[
            entryIndex
          ].time
        ).toISOString(),

      exitTime:
        new Date(
          candles[
            simulation.exitIndex
          ].time
        ).toISOString(),

      session:
        utcSession(
          candles[
            entryIndex
          ].time
        ),

      entry:
        round(
          simulation.entry,
          2
        ),

      stop:
        round(
          simulation.stop,
          2
        ),

      target:
        round(
          simulation.target,
          2
        ),

      exit:
        round(
          simulation.exit,
          2
        ),

      result:
        simulation.result,

      r:
        round(
          simulation.r,
          3
        ),

      mfeR:
        round(
          simulation.mfeR,
          2
        ),

      maeR:
        round(
          simulation.maeR,
          2
        ),

      barsHeld:
        simulation.barsHeld,

      timeExit:
        Boolean(
          simulation.timeExit
        ),

      relativeVolume:
        signal.relativeVolume,

      pressure:
        signal.pressure,

      timeframeBias:
        signal.timeframeBias,

      reasons:
        signal.reasons

    };


    trades.push(
      trade
    );


    /*
      One position at a time.

      Continue scanning AFTER this trade exits.
    */

    i =
      simulation.exitIndex +
      1;

  }


  return trades;

}


/* ============================================================
   HANDLER
============================================================ */

export default async function handler(
  req,
  res
) {

  const started =
    Date.now();


  try {

    res.setHeader(
      "Cache-Control",
      "no-store, max-age=0"
    );


    const days =
      parseDays(
        req.query?.days
      );


    const mode =
      parseMode(
        req.query?.mode
      );


    const now =
      Date.now();


    const requestedStart =
      now -
      (
        days *
        24 *
        60 *
        60 *
        1000
      );


    /*
      Additional warmup history.

      24 hours before requested test.
    */

    const fetchStart =
      requestedStart -
      (
        24 *
        60 *
        60 *
        1000
      );


    const candles =
      await fetchM1Range(
        fetchStart,
        now
      );


    if (
      candles.length <
      1500
    ) {

      return res
        .status(
          503
        )
        .json(
          {

            ok: false,

            error:
              "Insufficient Coinbase historical data",

            candles:
              candles.length

          }
        );

    }


    /*
      Drop currently-forming M1 candle.
    */

    const currentMinute =
      Math.floor(
        now /
        60000
      ) *
      60000;


    const completed =
      candles.filter(
        c =>
          c.time <
          currentMinute
      );


    const trades =
      runBacktest(
        completed,
        mode,
        requestedStart
      );


    const wins =
      trades.filter(
        t => t.r > 0
      ).length;


    const losses =
      trades.filter(
        t => t.r < 0
      ).length;


    const flats =
      trades.filter(
        t => t.r === 0
      ).length;


    const netR =
      trades.reduce(
        (
          total,
          trade
        ) =>
          total +
          trade.r,
        0
      );


    const expectancy =
      trades.length
        ?
          netR /
          trades.length
        :
          0;


    const avgMFE =
      trades.length
        ?
          trades.reduce(
            (
              total,
              trade
            ) =>
              total +
              trade.mfeR,
            0
          ) /
          trades.length
        :
          0;


    const avgMAE =
      trades.length
        ?
          trades.reduce(
            (
              total,
              trade
            ) =>
              total +
              trade.maeR,
            0
          ) /
          trades.length
        :
          0;


    return res
      .status(
        200
      )
      .json(
        {

          ok: true,

          strategy:
            "MKAYFX BTC Dynamic Structure V1",

          source:
            "Coinbase Exchange",

          product:
            PRODUCT,

          execution:
            "M1",

          structure:
            "M5",

          directionalContext:
            "M15",

          optionalContext:
            "H1",

          mode,

          days,

          rr:
            SETTINGS.RR,

          entryRule:
            "NEXT_M1_OPEN",

          collisionRule:
            "SL_FIRST",

          onePositionAtATime:
            true,

          performance: {

            trades:
              trades.length,

            wins,

            losses,

            flats,

            winRate:
              trades.length
                ?
                  round(
                    (
                      wins /
                      trades.length
                    ) *
                    100,
                    2
                  )
                :
                  0,

            profitFactor:
              round(
                profitFactor(
                  trades
                ),
                2
              ),

            netR:
              round(
                netR,
                2
              ),

            expectancyR:
              round(
                expectancy,
                3
              ),

            maxDrawdownR:
              round(
                maxDrawdown(
                  trades
                ),
                2
              ),

            longestLossStreak:
              longestLossStreak(
                trades
              ),

            averageMFE_R:
              round(
                avgMFE,
                2
              ),

            averageMAE_R:
              round(
                avgMAE,
                2
              )

          },

          breakdown: {

            bySetup:
              groupStats(
                trades,
                trade =>
                  trade.setup
              ),

            bySide:
              groupStats(
                trades,
                trade =>
                  trade.side
              ),

            bySession:
              groupStats(
                trades,
                trade =>
                  trade.session
              )

          },

          trades,

          data: {

            candles:
              completed.length,

            first:
              completed.length
                ?
                  new Date(
                    completed[0].time
                  ).toISOString()
                :
                  null,

            last:
              completed.length
                ?
                  new Date(
                    completed[
                      completed.length - 1
                    ].time
                  ).toISOString()
                :
                  null

          },

          runtimeMs:
            Date.now() -
            started

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
            "Backtest failed",

          runtimeMs:
            Date.now() -
            started

        }
      );

  }

}