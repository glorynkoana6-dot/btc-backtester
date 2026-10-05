/* ============================================================
   MKAYFX BTC VOLUME PROFILE BACKTESTER V3
   /api/backtest.js

   SOURCE
   ------
   Coinbase Exchange

   PRODUCT
   -------
   BTC-USD

   STRATEGY
   --------
   Session Volume Profile
   +
   POC / VAH / VAL
   +
   VWAP
   +
   H1 / H4 market context
   +
   M5 rejection trigger

   ENTRY
   -----
   Signal determined on completed M5 candle.
   Entry = NEXT M5 open.

   TP
   --
   1.5R

   SAME-BAR COLLISION
   ------------------
   SL first.

   IMPORTANT
   ---------
   Historical volume profile is an OHLCV approximation.
============================================================ */


const PRODUCT =
  "BTC-USD";


const BASE_URL =
  "https://api.exchange.coinbase.com";


const SETTINGS = {

  defaultDays:
    30,

  maxDays:
    60,

  warmupDays:
    12,

  chunkCandles:
    280,


  profileBins:
    36,

  valueAreaPercent:
    0.70,

  minimumProfileBars:
    8,


  atrPeriod:
    14,

  rsiPeriod:
    14,


  h1FastEMA:
    50,

  h1SlowEMA:
    200,

  h4FastEMA:
    20,

  h4SlowEMA:
    50,


  pullbackLookback:
    3,

  minimumBodyPercent:
    0.42,

  minimumRejectionWick:
    0.12,

  maxDistanceATR:
    1.10,


  buyRsiMin:
    48,

  buyRsiMax:
    72,

  sellRsiMin:
    28,

  sellRsiMax:
    52,


  minimumATRPercent:
    0.08,

  maximumATRPercent:
    3.50,


  stopATR:
    1.00,

  structureBufferATR:
    0.12,

  targetR:
    1.50,


  cooldownBars:
    3,

  maxHoldBars:
    72,


  modeScores: {

    RAW:
      48,

    BALANCED:
      60,

    SELECTIVE:
      72

  }

};


/* ============================================================
   HELPERS
============================================================ */

function number(
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


  const p =
    10 ** digits;


  return (
    Math.round(
      Number(
        value
      ) *
      p
    ) /
    p
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
  timeoutMs = 10000
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
              "MKAYFX-BTC-PROFILE-BACKTEST-V3"

          },

          signal:
            controller.signal

        }
      );


    const raw =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(
          raw
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

      `${BASE_URL}/products/${PRODUCT}/candles` +

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

        candle.open >
          0 &&

        candle.high >
          0 &&

        candle.low >
          0 &&

        candle.close >
          0

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
    let index = 0;
    index <
      windows.length;
    index += 4
  ) {

    const batch =
      windows.slice(
        index,
        index +
        4
      );


    const responses =
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
      responses
    ) {

      all.push(
        ...candles
      );

    }


    if (
      index +
      4 <
      windows.length
    ) {

      await sleep(
        120
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


  let avgGain =
    gains /
    period;


  let avgLoss =
    losses /
    period;


  output[period] =
    avgLoss ===
    0
      ? 100
      : 100 -
        100 /
        (
          1 +
          avgGain /
          avgLoss
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


    avgGain =
      (
        avgGain *
        (
          period -
          1
        ) +
        gain
      ) /
      period;


    avgLoss =
      (
        avgLoss *
        (
          period -
          1
        ) +
        loss
      ) /
      period;


    output[i] =
      avgLoss ===
      0
        ? 100
        : 100 -
          100 /
          (
            1 +
            avgGain /
            avgLoss
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
   M5 -> H1
============================================================ */

function resample(
  candles,
  minutes
) {

  const interval =
    minutes *
    60000;


  const map =
    new Map();


  for (
    const candle of
    candles
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

      const bar =
        map.get(
          key
        );


      bar.high =
        Math.max(
          bar.high,
          candle.high
        );


      bar.low =
        Math.min(
          bar.low,
          candle.low
        );


      bar.close =
        candle.close;


      bar.volume +=
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
   SESSION INFO
============================================================ */

function sessionInfo(
  timestamp
) {

  const date =
    new Date(
      timestamp
    );


  const midnight =
    Date.UTC(

      date.getUTCFullYear(),

      date.getUTCMonth(),

      date.getUTCDate()

    );


  const hour =
    date.getUTCHours();


  if (
    hour <
    8
  ) {

    return {

      name:
        "ASIA",

      start:
        midnight,

      end:
        midnight +
        8 *
        3600000

    };

  }


  if (
    hour <
    13
  ) {

    return {

      name:
        "LONDON",

      start:
        midnight +
        8 *
        3600000,

      end:
        midnight +
        13 *
        3600000

    };

  }


  if (
    hour <
    21
  ) {

    return {

      name:
        "NEW YORK",

      start:
        midnight +
        13 *
        3600000,

      end:
        midnight +
        21 *
        3600000

    };

  }


  return {

    name:
      "LATE",

    start:
      midnight +
      21 *
      3600000,

    end:
      midnight +
      24 *
      3600000

  };

}


/* ============================================================
   BUILD PROFILE
============================================================ */

function buildVolumeProfile(
  candles
) {

  if (
    candles.length <
    SETTINGS.minimumProfileBars
  ) {

    return null;

  }


  const low =
    Math.min(
      ...candles.map(
        candle =>
          candle.low
      )
    );


  const high =
    Math.max(
      ...candles.map(
        candle =>
          candle.high
      )
    );


  const range =
    high -
    low;


  if (
    range <=
    0
  ) {

    return null;

  }


  const binSize =

    range /
    SETTINGS.profileBins;


  const bins =
    Array.from(
      {
        length:
          SETTINGS.profileBins
      },
      (
        _,
        index
      ) => ({

        price:

          low +

          (
            index +
            0.5
          ) *
          binSize,

        low:

          low +
          index *
          binSize,

        high:

          low +

          (
            index +
            1
          ) *
          binSize,

        volume:
          0

      })
    );


  for (
    const candle of
    candles
  ) {

    let first =

      Math.floor(
        (
          candle.low -
          low
        ) /
        binSize
      );


    let last =

      Math.floor(
        (
          candle.high -
          low
        ) /
        binSize
      );


    first =
      clamp(
        first,
        0,
        bins.length -
        1
      );


    last =
      clamp(
        last,
        0,
        bins.length -
        1
      );


    const count =
      Math.max(
        1,
        last -
        first +
        1
      );


    const typical =
      (
        candle.high +
        candle.low +
        candle.close
      ) /
      3;


    let typicalIndex =

      Math.floor(
        (
          typical -
          low
        ) /
        binSize
      );


    typicalIndex =
      clamp(
        typicalIndex,
        0,
        bins.length -
        1
      );


    const distributed =
      candle.volume *
      0.70;


    const focused =
      candle.volume *
      0.30;


    for (
      let index =
        first;
      index <=
        last;
      index++
    ) {

      bins[
        index
      ].volume +=

        distributed /
        count;

    }


    bins[
      typicalIndex
    ].volume +=
      focused;

  }


  const totalVolume =
    bins.reduce(
      (
        total,
        bin
      ) =>
        total +
        bin.volume,
      0
    );


  let pocIndex =
    0;


  for (
    let index = 1;
    index <
      bins.length;
    index++
  ) {

    if (
      bins[
        index
      ].volume >
      bins[
        pocIndex
      ].volume
    ) {

      pocIndex =
        index;

    }

  }


  const target =

    totalVolume *
    SETTINGS.valueAreaPercent;


  let cumulative =
    bins[
      pocIndex
    ].volume;


  let lower =
    pocIndex;


  let upper =
    pocIndex;


  while (

    cumulative <
    target &&

    (
      lower >
        0 ||
      upper <
        bins.length -
        1
    )

  ) {

    const lowerVolume =

      lower >
      0

        ? bins[
          lower -
          1
        ].volume

        : -1;


    const upperVolume =

      upper <
      bins.length -
      1

        ? bins[
          upper +
          1
        ].volume

        : -1;


    if (
      upperVolume >=
      lowerVolume
    ) {

      if (
        upper <
        bins.length -
        1
      ) {

        upper++;

        cumulative +=
          bins[
            upper
          ].volume;

      }

      else {

        lower--;

        cumulative +=
          bins[
            lower
          ].volume;

      }

    }

    else {

      if (
        lower >
        0
      ) {

        lower--;

        cumulative +=
          bins[
            lower
          ].volume;

      }

      else {

        upper++;

        cumulative +=
          bins[
            upper
          ].volume;

      }

    }

  }


  return {

    poc:
      bins[
        pocIndex
      ].price,

    vah:
      bins[
        upper
      ].high,

    val:
      bins[
        lower
      ].low,

    high,

    low,

    totalVolume

  };

}


/* ============================================================
   VWAP
============================================================ */

function vwap(
  candles
) {

  let volume =
    0;


  let weighted =
    0;


  for (
    const candle of
    candles
  ) {

    const typical =
      (
        candle.high +
        candle.low +
        candle.close
      ) /
      3;


    weighted +=
      typical *
      candle.volume;


    volume +=
      candle.volume;

  }


  return volume >
    0

    ? weighted /
      volume

    : null;

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

      body:
        0,

      lowerWick:
        0,

      upperWick:
        0,

      closeLocation:
        0.5

    };

  }


  const bodyHigh =
    Math.max(
      candle.open,
      candle.close
    );


  const bodyLow =
    Math.min(
      candle.open,
      candle.close
    );


  return {

    body:

      Math.abs(
        candle.close -
        candle.open
      ) /
      range,


    lowerWick:

      (
        bodyLow -
        candle.low
      ) /
      range,


    upperWick:

      (
        candle.high -
        bodyHigh
      ) /
      range,


    closeLocation:

      (
        candle.close -
        candle.low
      ) /
      range

  };

}


/* ============================================================
   LEVEL TOUCH
============================================================ */

function levelTouched(

  candles,

  level,

  lookback,

  tolerance

) {

  const recent =
    candles.slice(
      -lookback
    );


  return recent.some(
    candle =>

      candle.low <=
        level +
        tolerance &&

      candle.high >=
        level -
        tolerance
  );

}


/* ============================================================
   PROFILE AT HISTORICAL TIME
============================================================ */

function profileContext(
  history,
  timestamp
) {

  const currentInfo =
    sessionInfo(
      timestamp
    );


  const currentBars =
    history.filter(
      candle =>

        candle.timestamp >=
          currentInfo.start &&

        candle.timestamp <=
          timestamp
    );


  const previousTimestamp =

    currentInfo.start -
    1;


  const previousInfo =
    sessionInfo(
      previousTimestamp
    );


  const previousBars =
    history.filter(
      candle =>

        candle.timestamp >=
          previousInfo.start &&

        candle.timestamp <
          previousInfo.end
    );


  return {

    session:
      currentInfo,

    developing:
      buildVolumeProfile(
        currentBars
      ),

    previous:
      buildVolumeProfile(
        previousBars
      ),

    currentBars,

    sessionVWAP:
      vwap(
        currentBars
      )

  };

}


/* ============================================================
   RUN BACKTEST
============================================================ */

function runBacktest(
  m5,
  mode
) {

  const minimumScore =
    SETTINGS.modeScores[
      mode
    ];


  const h1 =
    resample(
      m5,
      60
    );


  const h4 =
    resample(
      m5,
      240
    );


  const m5Close =
    m5.map(
      candle =>
        candle.close
    );


  const m5ATR =
    atr(
      m5,
      SETTINGS.atrPeriod
    );


  const m5RSI =
    rsi(
      m5Close,
      SETTINGS.rsiPeriod
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


  const h1EMA50 =
    ema(
      h1Close,
      SETTINGS.h1FastEMA
    );


  const h1EMA200 =
    ema(
      h1Close,
      SETTINGS.h1SlowEMA
    );


  const h4EMA20 =
    ema(
      h4Close,
      SETTINGS.h4FastEMA
    );


  const h4EMA50 =
    ema(
      h4Close,
      SETTINGS.h4SlowEMA
    );


  const trades =
    [];


  let active =
    null;


  let cooldownUntil =
    -1;


  let h1Index =
    0;


  let h4Index =
    0;


  function completedIndex(
    bars,
    timestamp,
    current
  ) {

    let index =
      current;


    while (

      index +
        1 <
        bars.length &&

      bars[
        index +
        1
      ].closeTime <=
        timestamp

    ) {

      index++;

    }


    if (

      bars[index] &&
      bars[index].closeTime <=
        timestamp

    ) {

      return index;

    }


    return -1;

  }


  for (
    let i = 250;
    i <
      m5.length -
      1;
    i++
  ) {

    const candle =
      m5[i];


    /* ======================================================
       MANAGE POSITION
    ====================================================== */

    if (
      active
    ) {

      let exit =
        null;


      let resultR =
        null;


      let exitReason =
        null;


      if (
        active.side ===
        "BUY"
      ) {

        if (
          candle.low <=
          active.stop
        ) {

          exit =
            active.stop;

          resultR =
            -1;

          exitReason =
            "SL";

        }

        else if (
          candle.high >=
          active.target
        ) {

          exit =
            active.target;

          resultR =
            SETTINGS.targetR;

          exitReason =
            "TP";

        }

      }

      else {

        if (
          candle.high >=
          active.stop
        ) {

          exit =
            active.stop;

          resultR =
            -1;

          exitReason =
            "SL";

        }

        else if (
          candle.low <=
          active.target
        ) {

          exit =
            active.target;

          resultR =
            SETTINGS.targetR;

          exitReason =
            "TP";

        }

      }


      if (

        exit ===
          null &&

        i -
        active.entryIndex >=
          SETTINGS.maxHoldBars

      ) {

        exit =
          candle.close;


        resultR =

          active.side ===
          "BUY"

            ? (
              exit -
              active.entry
            ) /
              active.risk

            : (
              active.entry -
              exit
            ) /
              active.risk;


        exitReason =
          "TIME";

      }


      if (
        exit !==
        null
      ) {

        trades.push({

          side:
            active.side,

          setup:
            active.setup,

          entryTime:
            active.entryTime,

          exitTime:
            candle.datetime,

          entry:
            round(
              active.entry
            ),

          stop:
            round(
              active.stop
            ),

          target:
            round(
              active.target
            ),

          exit:
            round(
              exit
            ),

          score:
            active.score,

          resultR:
            round(
              resultR,
              3
            ),

          exitReason

        });


        active =
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


    if (

      m5ATR[i] ===
        null ||

      m5RSI[i] ===
        null

    ) {

      continue;

    }


    /* ======================================================
       COMPLETED HTF BARS
    ====================================================== */

    h1Index =
      completedIndex(
        h1,
        candle.timestamp +
          300000,
        h1Index
      );


    h4Index =
      completedIndex(
        h4,
        candle.timestamp +
          300000,
        h4Index
      );


    if (
      h1Index <
      199 ||
      h4Index <
      49
    ) {

      continue;

    }


    /* ======================================================
       HTF TREND
    ====================================================== */

    const h1Bullish =

      h1[
        h1Index
      ].close >
      h1EMA200[
        h1Index
      ] &&

      h1EMA50[
        h1Index
      ] >
      h1EMA200[
        h1Index
      ];


    const h1Bearish =

      h1[
        h1Index
      ].close <
      h1EMA200[
        h1Index
      ] &&

      h1EMA50[
        h1Index
      ] <
      h1EMA200[
        h1Index
      ];


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


    /* ======================================================
       PROFILE CONTEXT

       Important:
       history ends at CURRENT candle.

       Nothing after current candle is included.
    ====================================================== */

    const history =
      m5.slice(
        0,
        i +
        1
      );


    const profile =
      profileContext(
        history,
        candle.timestamp
      );


    if (
      !profile.developing
    ) {

      continue;

    }


    const dp =
      profile.developing;


    const previous =
      profile.previous;


    const sessionVWAP =
      profile.sessionVWAP;


    /* ======================================================
       STATE SCORES
    ====================================================== */

    let buyScore =
      0;


    let sellScore =
      0;


    if (
      h4Bullish
    ) {

      buyScore +=
        18;

    }


    if (
      h4Bearish
    ) {

      sellScore +=
        18;

    }


    if (
      h1Bullish
    ) {

      buyScore +=
        18;

    }


    if (
      h1Bearish
    ) {

      sellScore +=
        18;

    }


    if (
      candle.close >
      dp.poc
    ) {

      buyScore +=
        12;

    }

    else {

      sellScore +=
        12;

    }


    if (
      candle.close >
      sessionVWAP
    ) {

      buyScore +=
        12;

    }

    else {

      sellScore +=
        12;

    }


    if (
      candle.close >
      dp.vah
    ) {

      buyScore +=
        8;

    }


    if (
      candle.close <
      dp.val
    ) {

      sellScore +=
        8;

    }


    if (
      previous
    ) {

      if (
        candle.close >
        previous.poc
      ) {

        buyScore +=
          8;

      }

      else {

        sellScore +=
          8;

      }

    }


    /* ======================================================
       M5 TRIGGER
    ====================================================== */

    const metrics =
      candleMetrics(
        candle
      );


    const atrValue =
      m5ATR[i];


    const tolerance =
      atrValue *
      0.15;


    const recent =
      m5.slice(
        Math.max(
          0,
          i -
          SETTINGS.pullbackLookback +
          1
        ),
        i +
        1
      );


    const touchedPOC =
      levelTouched(

        recent,

        dp.poc,

        SETTINGS.pullbackLookback,

        tolerance

      );


    const touchedVWAP =
      levelTouched(

        recent,

        sessionVWAP,

        SETTINGS.pullbackLookback,

        tolerance

      );


    const touchedVAL =
      levelTouched(

        recent,

        dp.val,

        SETTINGS.pullbackLookback,

        tolerance

      );


    const touchedVAH =
      levelTouched(

        recent,

        dp.vah,

        SETTINGS.pullbackLookback,

        tolerance

      );


    const bullishRejection =

      candle.close >
      candle.open &&

      metrics.body >=
      SETTINGS.minimumBodyPercent &&

      metrics.lowerWick >=
      SETTINGS.minimumRejectionWick &&

      metrics.closeLocation >=
      0.65;


    const bearishRejection =

      candle.close <
      candle.open &&

      metrics.body >=
      SETTINGS.minimumBodyPercent &&

      metrics.upperWick >=
      SETTINGS.minimumRejectionWick &&

      metrics.closeLocation <=
      0.35;


    if (
      touchedPOC &&
      candle.close >
      dp.poc
    ) {

      buyScore +=
        12;

    }


    if (
      touchedPOC &&
      candle.close <
      dp.poc
    ) {

      sellScore +=
        12;

    }


    if (
      touchedVWAP &&
      candle.close >
      sessionVWAP
    ) {

      buyScore +=
        10;

    }


    if (
      touchedVWAP &&
      candle.close <
      sessionVWAP
    ) {

      sellScore +=
        10;

    }


    if (
      touchedVAL &&
      candle.close >
      dp.val
    ) {

      buyScore +=
        10;

    }


    if (
      touchedVAH &&
      candle.close <
      dp.vah
    ) {

      sellScore +=
        10;

    }


    if (
      bullishRejection
    ) {

      buyScore +=
        10;

    }


    if (
      bearishRejection
    ) {

      sellScore +=
        10;

    }


    const buyRSIOK =

      m5RSI[i] >=
      SETTINGS.buyRsiMin &&

      m5RSI[i] <=
      SETTINGS.buyRsiMax;


    const sellRSIOK =

      m5RSI[i] >=
      SETTINGS.sellRsiMin &&

      m5RSI[i] <=
      SETTINGS.sellRsiMax;


    if (
      buyRSIOK
    ) {

      buyScore +=
        5;

    }


    if (
      sellRSIOK
    ) {

      sellScore +=
        5;

    }


    buyScore =
      clamp(
        buyScore,
        0,
        100
      );


    sellScore =
      clamp(
        sellScore,
        0,
        100
      );


    /* ======================================================
       FILTERS
    ====================================================== */

    const atrPercent =

      atrValue /
      candle.close *
      100;


    const volatilityOK =

      atrPercent >=
      SETTINGS.minimumATRPercent &&

      atrPercent <=
      SETTINGS.maximumATRPercent;


    if (
      !volatilityOK
    ) {

      continue;

    }


    const profileDistance =

      Math.min(

        Math.abs(
          candle.close -
          dp.poc
        ),

        Math.abs(
          candle.close -
          sessionVWAP
        )

      ) /
      atrValue;


    if (
      profileDistance >
      SETTINGS.maxDistanceATR
    ) {

      continue;

    }


    /* ======================================================
       SIGNAL
    ====================================================== */

    const buy =

      buyScore >=
        minimumScore &&

      buyScore >
        sellScore +
        8 &&

      bullishRejection &&

      buyRSIOK &&

      (
        touchedPOC ||
        touchedVWAP ||
        touchedVAL
      );


    const sell =

      sellScore >=
        minimumScore &&

      sellScore >
        buyScore +
        8 &&

      bearishRejection &&

      sellRSIOK &&

      (
        touchedPOC ||
        touchedVWAP ||
        touchedVAH
      );


    if (
      !buy &&
      !sell
    ) {

      continue;

    }


    /* ======================================================
       NEXT-CANDLE ENTRY
    ====================================================== */

    const next =
      m5[
        i +
        1
      ];


    const entry =
      next.open;


    const recentStructure =
      m5.slice(
        Math.max(
          0,
          i -
          4
        ),
        i +
        1
      );


    let stop;


    let target;


    let risk;


    let setup;


    if (
      buy
    ) {

      const structuralLow =
        Math.min(
          ...recentStructure.map(
            bar =>
              bar.low
          )
        );


      const atrStop =

        entry -

        atrValue *
        SETTINGS.stopATR;


      const structureStop =

        structuralLow -

        atrValue *
        SETTINGS.structureBufferATR;


      stop =
        Math.min(
          atrStop,
          structureStop
        );


      risk =
        entry -
        stop;


      target =

        entry +

        risk *
        SETTINGS.targetR;


      setup =

        touchedVAL
          ? "VAL REJECTION"
          : touchedPOC
            ? "POC RECLAIM"
            : "VWAP RECLAIM";


      active = {

        side:
          "BUY",

        setup,

        score:
          buyScore,

        entryIndex:
          i +
          1,

        entryTime:
          next.datetime,

        entry,

        stop,

        target,

        risk

      };

    }


    else {

      const structuralHigh =
        Math.max(
          ...recentStructure.map(
            bar =>
              bar.high
          )
        );


      const atrStop =

        entry +

        atrValue *
        SETTINGS.stopATR;


      const structureStop =

        structuralHigh +

        atrValue *
        SETTINGS.structureBufferATR;


      stop =
        Math.max(
          atrStop,
          structureStop
        );


      risk =
        stop -
        entry;


      target =

        entry -

        risk *
        SETTINGS.targetR;


      setup =

        touchedVAH
          ? "VAH REJECTION"
          : touchedPOC
            ? "POC REJECTION"
            : "VWAP REJECTION";


      active = {

        side:
          "SELL",

        setup,

        score:
          sellScore,

        entryIndex:
          i +
          1,

        entryTime:
          next.datetime,

        entry,

        stop,

        target,

        risk

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


  const total =
    trades.length;


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
    wins.reduce(
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

      losses.reduce(
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

    total

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


  const expectancy =

    total

      ? netR /
        total

      : 0;


  let equity =
    0;


  let peak =
    0;


  let maxDrawdown =
    0;


  let currentLosses =
    0;


  let maximumLosses =
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


    maxDrawdown =
      Math.max(

        maxDrawdown,

        peak -
        equity

      );


    if (
      trade.resultR <
      0
    ) {

      currentLosses++;


      maximumLosses =
        Math.max(
          maximumLosses,
          currentLosses
        );

    }

    else {

      currentLosses =
        0;

    }

  }


  const buyTrades =
    trades.filter(
      trade =>
        trade.side ===
        "BUY"
    );


  const sellTrades =
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

    profitFactor:
      round(
        profitFactor,
        2
      ),

    netR:
      round(
        netR,
        2
      ),

    averageR:
      round(
        expectancy,
        3
      ),

    expectancyR:
      round(
        expectancy,
        3
      ),

    maxDrawdownR:
      round(
        maxDrawdown,
        2
      ),

    maxLossStreak:
      maximumLosses,

    buyTrades:
      buyTrades.length,

    buyNetR:
      round(

        buyTrades.reduce(
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
      sellTrades.length,

    sellNetR:
      round(

        sellTrades.reduce(
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
      number(
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


    const requestedMode =
      String(
        req.query?.mode ||
        "BALANCED"
      )
      .toUpperCase();


    const mode =

      SETTINGS.modeScores[
        requestedMode
      ]

        ? requestedMode

        : "BALANCED";


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


    const candles =
      await fetchHistory(

        300,

        startSeconds,

        nowSeconds

      );


    if (
      candles.length <
      2500
    ) {

      throw new Error(
        `Only ${candles.length} M5 candles downloaded`
      );

    }


    const allTrades =
      runBacktest(
        candles,
        mode
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

        engine:
          "MKAYFX BTC VOLUME PROFILE BACKTEST V3",

        source:
          "Coinbase Exchange",

        product:
          PRODUCT,

        strategy:
          "Session Volume Profile + POC/VAH/VAL + VWAP",

        days,

        mode,


        period: {

          from,

          to,

          m5Candles:
            candles.length

        },


        data: {

          from,

          to,

          m5Candles:
            candles.length

        },


        settings: {

          volumeProfile:
            "M5 OHLCV approximation",

          valueArea:
            "70%",

          profileBins:
            SETTINGS.profileBins,

          modes:
            SETTINGS.modeScores,

          mode,

          minimumScore:
            SETTINGS.modeScores[
              mode
            ],

          targetR:
            SETTINGS.targetR,

          stopATR:
            SETTINGS.stopATR,

          maxHoldBars:
            SETTINGS.maxHoldBars,

          cooldownBars:
            SETTINGS.cooldownBars

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
      "BTC PROFILE BACKTEST ERROR:",
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