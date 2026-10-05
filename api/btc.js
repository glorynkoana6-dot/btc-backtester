/* ============================================================
   MKAYFX BTC LIQUIDITY SWEEP REVERSAL V1
   /api/btc.js

   MARKET
   ------
   Coinbase BTC-USD

   EXECUTION
   ---------
   15 minute

   CORE IDEA
   ---------
   1. Detect confirmed swing highs / lows
   2. Store them as liquidity levels
   3. Wait for price to sweep through level
   4. Require price to close back inside
   5. Require rejection wick
   6. Require volume expansion
   7. Wait one extra candle for confirmation
   8. Enter at next candle open
   9. Stop beyond sweep wick
   10. Target 1.5R
   11. Breakeven halfway to TP

   IMPORTANT
   ---------
   No future leakage.
   Coinbase public OHLCV.
   Fees + slippage included.
============================================================ */

const PRODUCT = "BTC-USD";

const COINBASE =
  "https://api.exchange.coinbase.com";

const GRANULARITY = 900;


/* ============================================================
   SETTINGS
============================================================ */

const CONFIG = {

  pivotLen: 5,

  maxLevelAge: 120,

  minLevelSpacingATR: 0.20,

  useVolumeFilter: true,

  volumeSmaPeriod: 20,

  volumeMultiplier: 1.15,

  useWickFilter: true,

  minimumWickBodyRatio: 1.20,

  requireConfirmation: true,

  useSession: true,

  sessionStartUTC: 10,

  sessionEndUTC: 18,

  atrPeriod: 14,

  stopAtrBeyondWick: 1.0,

  minimumRiskATR: 0.45,

  maximumRiskATR: 3.0,

  rewardRisk: 1.50,

  breakevenEnabled: true,

  breakevenPercentToTP: 50,

  riskPercent: 2.0,

  feePercentPerSide: 0.04,

  slippagePercentPerSide: 0.015,

  cooldownBars: 1,

  maximumBarsInTrade: 40
};


/* ============================================================
   BASIC HELPERS
============================================================ */

function round(
  value,
  decimals = 2
) {

  const factor =
    10 ** decimals;

  return (
    Math.round(
      value * factor
    ) / factor
  );
}


function number(
  value,
  fallback = 0
) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}


/* ============================================================
   SMA
============================================================ */

function sma(
  values,
  period
) {

  const result =
    new Array(
      values.length
    ).fill(null);

  let sum =
    0;

  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    sum +=
      values[i];

    if (
      i >= period
    ) {

      sum -=
        values[
          i - period
        ];
    }

    if (
      i >=
      period - 1
    ) {

      result[i] =
        sum / period;
    }
  }

  return result;
}


/* ============================================================
   ATR
============================================================ */

function atr(
  candles,
  period
) {

  const tr =
    new Array(
      candles.length
    ).fill(null);

  const output =
    new Array(
      candles.length
    ).fill(null);


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
    candles.length <=
    period
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
    let i =
      period + 1;
    i <
      candles.length;
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
   SESSION FILTER
============================================================ */

function isInSession(
  timestamp
) {

  if (
    !CONFIG.useSession
  ) {

    return true;
  }


  const date =
    new Date(
      timestamp
    );

  const hour =
    date.getUTCHours();


  return (
    hour >=
      CONFIG.sessionStartUTC &&
    hour <
      CONFIG.sessionEndUTC
  );
}


/* ============================================================
   COINBASE
============================================================ */

async function fetchChunk(
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
            "MKAYFX-LIQUIDITY-SWEEP"
        }
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Coinbase HTTP ${response.status}`
    );
  }


  const raw =
    await response.json();


  if (
    !Array.isArray(raw)
  ) {

    throw new Error(
      JSON.stringify(raw)
    );
  }


  return raw.map(
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
   HISTORY
============================================================ */

async function fetchHistory(
  days
) {

  const end =
    new Date();

  const start =
    new Date(
      end.getTime() -
      days *
      86400000
    );


  const result =
    [];


  const chunkMs =
    250 *
    GRANULARITY *
    1000;


  let cursor =
    start.getTime();


  while (
    cursor <
    end.getTime()
  ) {

    const chunkStart =
      new Date(
        cursor
      );


    const chunkEnd =
      new Date(

        Math.min(

          cursor +
          chunkMs,

          end.getTime()
        )
      );


    const batch =
      await fetchChunk(
        chunkStart,
        chunkEnd
      );


    result.push(
      ...batch
    );


    cursor =
      chunkEnd.getTime();


    await sleep(
      80
    );
  }


  const unique =
    new Map();


  for (
    const candle
    of result
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
      (a, b) =>
        a.time -
        b.time
    );
}


/* ============================================================
   PIVOT DETECTION
============================================================ */

function isPivotHigh(
  candles,
  pivotIndex,
  len
) {

  if (
    pivotIndex - len < 0 ||
    pivotIndex + len >=
      candles.length
  ) {

    return false;
  }


  const value =
    candles[
      pivotIndex
    ].high;


  for (
    let i =
      pivotIndex - len;
    i <=
      pivotIndex + len;
    i++
  ) {

    if (
      i ===
      pivotIndex
    ) {

      continue;
    }


    if (
      candles[i].high >=
      value
    ) {

      return false;
    }
  }


  return true;
}


function isPivotLow(
  candles,
  pivotIndex,
  len
) {

  if (
    pivotIndex - len < 0 ||
    pivotIndex + len >=
      candles.length
  ) {

    return false;
  }


  const value =
    candles[
      pivotIndex
    ].low;


  for (
    let i =
      pivotIndex - len;
    i <=
      pivotIndex + len;
    i++
  ) {

    if (
      i ===
      pivotIndex
    ) {

      continue;
    }


    if (
      candles[i].low <=
      value
    ) {

      return false;
    }
  }


  return true;
}


/* ============================================================
   LEVEL SPACING
============================================================ */

function tooClose(
  levels,
  price,
  currentAtr
) {

  for (
    const level
    of levels
  ) {

    if (
      Math.abs(
        level.price -
        price
      ) <
      currentAtr *
      CONFIG.minLevelSpacingATR
    ) {

      return true;
    }
  }


  return false;
}


/* ============================================================
   SWEEP DETECTION
============================================================ */

function detectHighSweep(
  candle,
  level,
  volumeSma
) {

  const wicked =
    candle.high >
      level.price &&
    candle.close <
      level.price;


  if (
    !wicked
  ) {

    return false;
  }


  const body =
    Math.abs(
      candle.close -
      candle.open
    );


  const wick =
    candle.high -
    Math.max(
      candle.close,
      candle.open
    );


  let wickOK =
    true;


  if (
    CONFIG.useWickFilter
  ) {

    wickOK =
      body > 0
        ? (
            wick /
            body
          ) >=
          CONFIG.minimumWickBodyRatio
        : wick > 0;
  }


  let volumeOK =
    true;


  if (
    CONFIG.useVolumeFilter
  ) {

    if (
      volumeSma === null ||
      !Number.isFinite(
        volumeSma
      )
    ) {

      volumeOK =
        false;

    } else {

      volumeOK =
        candle.volume >
        volumeSma *
        CONFIG.volumeMultiplier;
    }
  }


  return (
    wickOK &&
    volumeOK
  );
}


function detectLowSweep(
  candle,
  level,
  volumeSma
) {

  const wicked =
    candle.low <
      level.price &&
    candle.close >
      level.price;


  if (
    !wicked
  ) {

    return false;
  }


  const body =
    Math.abs(
      candle.close -
      candle.open
    );


  const wick =
    Math.min(
      candle.close,
      candle.open
    ) -
    candle.low;


  let wickOK =
    true;


  if (
    CONFIG.useWickFilter
  ) {

    wickOK =
      body > 0
        ? (
            wick /
            body
          ) >=
          CONFIG.minimumWickBodyRatio
        : wick > 0;
  }


  let volumeOK =
    true;


  if (
    CONFIG.useVolumeFilter
  ) {

    if (
      volumeSma === null ||
      !Number.isFinite(
        volumeSma
      )
    ) {

      volumeOK =
        false;

    } else {

      volumeOK =
        candle.volume >
        volumeSma *
        CONFIG.volumeMultiplier;
    }
  }


  return (
    wickOK &&
    volumeOK
  );
}


/* ============================================================
   CREATE TRADE
============================================================ */

function createTrade({

  side,

  wick,

  level,

  sweepTime,

  signalIndex,

  entryIndex,

  candles,

  atrValues

}) {

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


  const currentAtr =
    atrValues[
      signalIndex
    ];


  if (
    !currentAtr
  ) {

    return null;
  }


  const rawEntry =
    entryCandle.open;


  const slip =
    CONFIG.slippagePercentPerSide /
    100;


  const entry =
    side === "LONG"

      ? rawEntry *
        (
          1 + slip
        )

      : rawEntry *
        (
          1 - slip
        );


  let stop;


  if (
    side === "LONG"
  ) {

    stop =
      wick -
      currentAtr *
      CONFIG.stopAtrBeyondWick;

  } else {

    stop =
      wick +
      currentAtr *
      CONFIG.stopAtrBeyondWick;
  }


  let risk =
    Math.abs(
      entry -
      stop
    );


  const minimumRisk =
    currentAtr *
    CONFIG.minimumRiskATR;


  const maximumRisk =
    currentAtr *
    CONFIG.maximumRiskATR;


  if (
    risk >
    maximumRisk
  ) {

    return null;
  }


  if (
    risk <
    minimumRisk
  ) {

    if (
      side ===
      "LONG"
    ) {

      stop =
        entry -
        minimumRisk;

    } else {

      stop =
        entry +
        minimumRisk;
    }


    risk =
      minimumRisk;
  }


  const target =
    side === "LONG"

      ? entry +
        risk *
        CONFIG.rewardRisk

      : entry -
        risk *
        CONFIG.rewardRisk;


  return {

    side,

    level,

    sweepWick:
      wick,

    sweepTime,

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
      risk,

    breakeven:
      false,

    barsHeld:
      0

  };
}


/* ============================================================
   CLOSE TRADE
============================================================ */

function closeTrade(
  trade,
  rawExit,
  timestamp,
  reason
) {

  const slip =
    CONFIG.slippagePercentPerSide /
    100;


  const exit =
    trade.side === "LONG"

      ? rawExit *
        (
          1 - slip
        )

      : rawExit *
        (
          1 + slip
        );


  const grossR =
    trade.side === "LONG"

      ? (
          exit -
          trade.entry
        ) /
        trade.initialRisk

      : (
          trade.entry -
          exit
        ) /
        trade.initialRisk;


  const riskFraction =
    trade.initialRisk /
    trade.entry;


  const totalFeeFraction =
    (
      CONFIG.feePercentPerSide *
      2
    ) /
    100;


  const feeR =
    riskFraction > 0

      ? totalFeeFraction /
        riskFraction

      : 0;


  const netR =
    grossR -
    feeR;


  return {

    ...trade,

    exitTime:
      timestamp,

    exit,

    grossR,

    feeR,

    netR,

    exitReason:
      reason
  };
}


/* ============================================================
   BACKTEST ENGINE
============================================================ */

function runBacktest(
  candles,
  startingBalance
) {

  const atrValues =
    atr(
      candles,
      CONFIG.atrPeriod
    );


  const volumes =
    candles.map(
      candle =>
        candle.volume
    );


  const volumeSma =
    sma(
      volumes,
      CONFIG.volumeSmaPeriod
    );


  const highLevels =
    [];

  const lowLevels =
    [];


  const trades =
    [];


  let active =
    null;


  let pendingLong =
    null;

  let pendingShort =
    null;


  let cooldownUntil =
    -1;


  let balance =
    startingBalance;


  let peakBalance =
    startingBalance;


  let maximumDrawdown =
    0;


  const startIndex =
    Math.max(
      30,
      CONFIG.pivotLen *
      2 +
      CONFIG.atrPeriod
    );


  for (
    let i =
      startIndex;
    i <
      candles.length - 2;
    i++
  ) {

    const candle =
      candles[i];


    const currentAtr =
      atrValues[i];


    if (
      !currentAtr
    ) {

      continue;
    }


    /* ========================================================
       CONFIRM NEW PIVOT
    ======================================================== */

    const pivotIndex =
      i -
      CONFIG.pivotLen;


    if (
      isPivotHigh(
        candles,
        pivotIndex,
        CONFIG.pivotLen
      )
    ) {

      const price =
        candles[
          pivotIndex
        ].high;


      if (
        !tooClose(
          highLevels,
          price,
          currentAtr
        )
      ) {

        highLevels.push({

          price,

          createdIndex:
            pivotIndex,

          confirmedIndex:
            i

        });
      }
    }


    if (
      isPivotLow(
        candles,
        pivotIndex,
        CONFIG.pivotLen
      )
    ) {

      const price =
        candles[
          pivotIndex
        ].low;


      if (
        !tooClose(
          lowLevels,
          price,
          currentAtr
        )
      ) {

        lowLevels.push({

          price,

          createdIndex:
            pivotIndex,

          confirmedIndex:
            i

        });
      }
    }


    /* ========================================================
       REMOVE OLD LEVELS
    ======================================================== */

    for (
      let x =
        highLevels.length - 1;
      x >= 0;
      x--
    ) {

      if (
        i -
        highLevels[x]
          .createdIndex >
        CONFIG.maxLevelAge
      ) {

        highLevels.splice(
          x,
          1
        );
      }
    }


    for (
      let x =
        lowLevels.length - 1;
      x >= 0;
      x--
    ) {

      if (
        i -
        lowLevels[x]
          .createdIndex >
        CONFIG.maxLevelAge
      ) {

        lowLevels.splice(
          x,
          1
        );
      }
    }


    /* ========================================================
       ACTIVE TRADE MANAGEMENT
    ======================================================== */

    if (
      active
    ) {

      active.barsHeld++;


      let closed =
        null;


      if (
        active.side ===
        "LONG"
      ) {

        if (
          candle.low <=
          active.stop
        ) {

          closed =
            closeTrade(
              active,
              active.stop,
              candle.time,
              active.breakeven
                ? "BREAKEVEN_STOP"
                : "STOP_LOSS"
            );

        } else if (
          candle.high >=
          active.target
        ) {

          closed =
            closeTrade(
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
            closeTrade(
              active,
              active.stop,
              candle.time,
              active.breakeven
                ? "BREAKEVEN_STOP"
                : "STOP_LOSS"
            );

        } else if (
          candle.low <=
          active.target
        ) {

          closed =
            closeTrade(
              active,
              active.target,
              candle.time,
              "TAKE_PROFIT"
            );
        }
      }


      /* ======================================================
         BREAKEVEN
      ====================================================== */

      if (
        !closed &&
        CONFIG.breakevenEnabled &&
        !active.breakeven
      ) {

        const triggerPercent =
          CONFIG.breakevenPercentToTP /
          100;


        const trigger =
          active.side ===
          "LONG"

            ? active.entry +
              (
                active.target -
                active.entry
              ) *
              triggerPercent

            : active.entry -
              (
                active.entry -
                active.target
              ) *
              triggerPercent;


        const hit =
          active.side ===
          "LONG"

            ? candle.high >=
              trigger

            : candle.low <=
              trigger;


        if (
          hit
        ) {

          active.stop =
            active.entry;

          active.breakeven =
            true;
        }
      }


      if (
        !closed &&
        active.barsHeld >=
        CONFIG.maximumBarsInTrade
      ) {

        closed =
          closeTrade(
            active,
            candle.close,
            candle.time,
            "TIME_EXIT"
          );
      }


      if (
        closed
      ) {

        const riskMoney =
          balance *
          (
            CONFIG.riskPercent /
            100
          );


        const pnl =
          riskMoney *
          closed.netR;


        closed.riskMoney =
          riskMoney;

        closed.pnl =
          pnl;

        closed.balanceBefore =
          balance;


        balance +=
          pnl;


        closed.balanceAfter =
          balance;


        trades.push(
          closed
        );


        peakBalance =
          Math.max(
            peakBalance,
            balance
          );


        const dd =
          peakBalance > 0

            ? (
                (
                  peakBalance -
                  balance
                ) /
                peakBalance
              ) *
              100

            : 0;


        maximumDrawdown =
          Math.max(
            maximumDrawdown,
            dd
          );


        active =
          null;


        cooldownUntil =
          i +
          CONFIG.cooldownBars;
      }


      continue;
    }


    if (
      i <=
      cooldownUntil
    ) {

      continue;
    }


    /* ========================================================
       CONFIRM PREVIOUS SWEEP
    ======================================================== */

    if (
      CONFIG.requireConfirmation
    ) {

      if (
        pendingLong &&
        pendingLong.signalIndex ===
          i - 1
      ) {

        const confirmation =
          candle.close >
          pendingLong.midpoint;


        if (
          confirmation &&
          isInSession(
            candle.time
          )
        ) {

          active =
            createTrade({

              side:
                "LONG",

              wick:
                pendingLong.wick,

              level:
                pendingLong.level,

              sweepTime:
                pendingLong.sweepTime,

              signalIndex:
                i,

              entryIndex:
                i + 1,

              candles,

              atrValues

            });
        }


        pendingLong =
          null;
      }


      if (
        !active &&
        pendingShort &&
        pendingShort.signalIndex ===
          i - 1
      ) {

        const confirmation =
          candle.close <
          pendingShort.midpoint;


        if (
          confirmation &&
          isInSession(
            candle.time
          )
        ) {

          active =
            createTrade({

              side:
                "SHORT",

              wick:
                pendingShort.wick,

              level:
                pendingShort.level,

              sweepTime:
                pendingShort.sweepTime,

              signalIndex:
                i,

              entryIndex:
                i + 1,

              candles,

              atrValues

            });
        }


        pendingShort =
          null;
      }


      if (
        active
      ) {

        continue;
      }
    }


    /* ========================================================
       SEARCH HIGH SWEEP
    ======================================================== */

    let highSweep =
      null;


    for (
      let x =
        highLevels.length - 1;
      x >= 0;
      x--
    ) {

      const level =
        highLevels[x];


      if (
        i <=
        level.confirmedIndex
      ) {

        continue;
      }


      if (
        detectHighSweep(
          candle,
          level,
          volumeSma[i]
        )
      ) {

        if (
          !highSweep ||
          candle.high >
          highSweep.wick
        ) {

          highSweep = {

            wick:
              candle.high,

            level:
              level.price

          };
        }


        highLevels.splice(
          x,
          1
        );
      }
    }


    /* ========================================================
       SEARCH LOW SWEEP
    ======================================================== */

    let lowSweep =
      null;


    for (
      let x =
        lowLevels.length - 1;
      x >= 0;
      x--
    ) {

      const level =
        lowLevels[x];


      if (
        i <=
        level.confirmedIndex
      ) {

        continue;
      }


      if (
        detectLowSweep(
          candle,
          level,
          volumeSma[i]
        )
      ) {

        if (
          !lowSweep ||
          candle.low <
          lowSweep.wick
        ) {

          lowSweep = {

            wick:
              candle.low,

            level:
              level.price

          };
        }


        lowLevels.splice(
          x,
          1
        );
      }
    }


    /* ========================================================
       STORE OR EXECUTE SWEEP
    ======================================================== */

    if (
      CONFIG.requireConfirmation
    ) {

      if (
        lowSweep
      ) {

        pendingLong = {

          signalIndex:
            i,

          sweepTime:
            candle.time,

          wick:
            lowSweep.wick,

          midpoint:
            (
              lowSweep.wick +
              candle.close
            ) /
            2,

          level:
            lowSweep.level

        };
      }


      if (
        highSweep
      ) {

        pendingShort = {

          signalIndex:
            i,

          sweepTime:
            candle.time,

          wick:
            highSweep.wick,

          midpoint:
            (
              highSweep.wick +
              candle.close
            ) /
            2,

          level:
            highSweep.level

        };
      }

    } else {

      if (
        lowSweep &&
        isInSession(
          candle.time
        )
      ) {

        active =
          createTrade({

            side:
              "LONG",

            wick:
              lowSweep.wick,

            level:
              lowSweep.level,

            sweepTime:
              candle.time,

            signalIndex:
              i,

            entryIndex:
              i + 1,

            candles,

            atrValues

          });

      } else if (
        highSweep &&
        isInSession(
          candle.time
        )
      ) {

        active =
          createTrade({

            side:
              "SHORT",

            wick:
              highSweep.wick,

            level:
              highSweep.level,

            sweepTime:
              candle.time,

            signalIndex:
              i,

            entryIndex:
              i + 1,

            candles,

            atrValues

          });
      }
    }
  }


  if (
    active
  ) {

    const last =
      candles[
        candles.length - 1
      ];


    const closed =
      closeTrade(
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


    closed.riskMoney =
      riskMoney;

    closed.pnl =
      riskMoney *
      closed.netR;

    closed.balanceBefore =
      balance;


    balance +=
      closed.pnl;


    closed.balanceAfter =
      balance;


    trades.push(
      closed
    );
  }


  return statistics(
    trades,
    startingBalance,
    balance,
    maximumDrawdown
  );
}


/* ============================================================
   STATISTICS
============================================================ */

function statistics(
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


  const winRate =
    trades.length

      ? (
          wins.length /
          trades.length
        ) *
        100

      : 0;


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


  const grossProfit =
    wins.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        trade.netR,
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
          trade.netR,
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


  const averageR =
    trades.length

      ? totalR /
        trades.length

      : 0;


  const averageWin =
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


  const averageLoss =
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
      "MKAYFX BTC Liquidity Sweep Reversal V1",

    product:
      PRODUCT,

    timeframe:
      "15M",

    config:
      CONFIG,

    statistics: {

      trades:
        trades.length,

      wins:
        wins.length,

      losses:
        losses.length,

      winRate:
        round(
          winRate,
          2
        ),

      profitFactor:
        round(
          profitFactor,
          2
        ),

      totalR:
        round(
          totalR,
          2
        ),

      averageR:
        round(
          averageR,
          3
        ),

      averageWinR:
        round(
          averageWin,
          3
        ),

      averageLossR:
        round(
          averageLoss,
          3
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
        ),

      maximumDrawdownPercent:
        round(
          maximumDrawdown,
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

            sweepTime:
              new Date(
                trade.sweepTime
              ).toISOString(),

            entryTime:
              new Date(
                trade.entryTime
              ).toISOString(),

            exitTime:
              new Date(
                trade.exitTime
              ).toISOString(),

            liquidityLevel:
              round(
                trade.level,
                2
              ),

            sweepWick:
              round(
                trade.sweepWick,
                2
              ),

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
                trade.exit,
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

            result:
              trade.netR > 0
                ? "WIN"
                : "LOSS",

            reason:
              trade.exitReason,

            breakeven:
              trade.breakeven

          })
        )

  };
}


/* ============================================================
   API
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


    const days =
      Math.max(
        2,
        Math.min(
          number(
            req.query.days,
            30
          ),
          90
        )
      );


    const balance =
      Math.max(
        1,
        number(
          req.query.balance,
          200
        )
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
        `Only ${candles.length} Coinbase candles received`
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


  } catch (
    error
  ) {

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