/* ============================================================
   MKAYFX XAU/USD INTELLIGENCE ENGINE V4
   /api/xau.js

   THREE TWELVE DATA ENGINES
   -------------------------
   API 1 = LIVE ENGINE
   API 2 = STRUCTURE ENGINE
   API 3 = HISTORICAL ENGINE

   FRED = MACRO ENGINE

   ENVIRONMENT VARIABLES
   ---------------------
   TWELVE_DATA_API_KEY
   TWELVE_DATA_API_KEY_2
   TWELVE_DATA_API_KEY_3
   FRED_API_KEY

   IMPORTANT
   ---------
   Liquidity / raid / historical-match / combined-quality
   values are heuristic model scores, not guaranteed
   probabilities.
============================================================ */


/* ============================================================
   CONFIG
============================================================ */

const SYMBOL =
  "XAU/USD";

const TD_BASE =
  "https://api.twelvedata.com/time_series";

const FRED_BASE =
  "https://api.stlouisfed.org/fred/series/observations";


const TD_KEYS = [

  String(
    process.env.TWELVE_DATA_API_KEY ||
    ""
  ).trim(),

  String(
    process.env.TWELVE_DATA_API_KEY_2 ||
    ""
  ).trim(),

  String(
    process.env.TWELVE_DATA_API_KEY_3 ||
    ""
  ).trim()

];


const FRED_KEY =
  String(
    process.env.FRED_API_KEY ||
    ""
  ).trim();


const CACHE_MS =
  60_000;

const MACRO_CACHE_MS =
  15 * 60_000;


let CACHE = {

  time: 0,

  data: null

};


let MACRO_CACHE = {

  time: 0,

  data: null

};


let IN_FLIGHT =
  null;


/* ============================================================
   SESSION DEFINITIONS
============================================================ */

const SESSION_DEFS = [

  {

    id:
      "asia",

    name:
      "Asia / Tokyo",

    short:
      "ASIA",

    zone:
      "Asia/Tokyo",

    open:
      9 * 60,

    close:
      18 * 60,

    importance:
      1.35

  },

  {

    id:
      "london",

    name:
      "London",

    short:
      "LONDON",

    zone:
      "Europe/London",

    open:
      8 * 60,

    close:
      17 * 60,

    importance:
      1.32

  },

  {

    id:
      "newyork",

    name:
      "New York",

    short:
      "NEW YORK",

    zone:
      "America/New_York",

    open:
      8 * 60,

    close:
      17 * 60,

    importance:
      1.38

  }

];


/* ============================================================
   API HANDLER
============================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({

        ok:
          false,

        error:
          "GET only"

      });

  }


  if (
    TD_KEYS.filter(Boolean).length <
    3
  ) {

    return res
      .status(500)
      .json({

        ok:
          false,

        error:
          "Add TWELVE_DATA_API_KEY, TWELVE_DATA_API_KEY_2 and TWELVE_DATA_API_KEY_3 in Vercel."

      });

  }


  try {


    if (

      CACHE.data

      &&

      Date.now() -
      CACHE.time <
      CACHE_MS

    ) {

      return res
        .status(200)
        .json({

          ...CACHE.data,

          cached:
            true

        });

    }


    if (
      IN_FLIGHT
    ) {

      const shared =
        await IN_FLIGHT;

      return res
        .status(200)
        .json({

          ...shared,

          cached:
            true,

          sharedRequest:
            true

        });

    }


    IN_FLIGHT =
      buildIntelligence();


    const output =
      await IN_FLIGHT;


    IN_FLIGHT =
      null;


    CACHE = {

      time:
        Date.now(),

      data:
        output

    };


    return res
      .status(200)
      .json(
        output
      );


  } catch (
    error
  ) {

    IN_FLIGHT =
      null;


    console.error(
      "XAU ENGINE ERROR",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        symbol:
          SYMBOL,

        error:
          error?.message ||
          "Unknown XAU engine error"

      });

  }

}


/* ============================================================
   MASTER INTELLIGENCE ENGINE
============================================================ */

async function buildIntelligence() {


  /*
     Engines run in parallel because each has its own
     primary Twelve Data API key.
  */

  const [

    live,

    structureEngine,

    historical,

    macro

  ] =
    await Promise.all([

      buildLiveEngine(),

      buildStructureEngine(),

      buildHistoricalEngine(),

      getMacroEngine()

    ]);


  const m1 =
    live.m1;

  const m5 =
    live.m5;

  const m15 =
    structureEngine.m15;

  const h1 =
    structureEngine.h1;

  const h4 =
    resample(
      h1,
      240
    );


  const latest =
    m1.at(-1);


  if (
    !latest
  ) {

    throw new Error(
      "No current XAU/USD data."
    );

  }


  const price =
    latest.close;


  const atr1 =
    lastFinite(
      atrSeries(
        m1,
        14
      )
    );


  const atr5 =
    lastFinite(
      atrSeries(
        m5,
        14
      )
    );


  const atr15 =
    lastFinite(
      atrSeries(
        m15,
        14
      )
    );


  const atrH1 =
    lastFinite(
      atrSeries(
        h1,
        14
      )
    );


  /* ========================================================
     MULTI-TIMEFRAME STRUCTURE
  ======================================================== */

  const structure = {

    m1:
      timeframeState(
        m1
      ),

    m5:
      timeframeState(
        m5
      ),

    m15:
      timeframeState(
        m15
      ),

    h1:
      timeframeState(
        h1
      ),

    h4:
      timeframeState(
        h4
      )

  };


  /* ========================================================
     SESSIONS
  ======================================================== */

  const sessions =
    buildSessions(
      historical.m5
    );


  /* ========================================================
     REFERENCE LEVELS
  ======================================================== */

  const reference =
    buildReferenceLevels(
      h1
    );


  /* ========================================================
     EQUAL LIQUIDITY
  ======================================================== */

  const equalLevels =
    detectEqualLiquidity(

      m15,

      atr15

    );


  /* ========================================================
     SWINGS
  ======================================================== */

  const h1Swings =
    pivots(

      h1,

      3,

      220

    );


  /* ========================================================
     FLOW
  ======================================================== */

  const flow =
    buildFlowEngine(
      m1
    );


  /* ========================================================
     VWAP
  ======================================================== */

  const vwap =
    buildVWAP(
      m1
    );


  /* ========================================================
     PROFILE
  ======================================================== */

  const profile =
    buildActivityProfile(

      m5.slice(
        -500
      ),

      40

    );


  /* ========================================================
     MARKET REGIME
  ======================================================== */

  const regime =
    buildMarketRegime({

      structure,

      m5,

      atr5,

      flow

    });


  /* ========================================================
     LIQUIDITY POOLS
  ======================================================== */

  const pools =
    buildLiquidityPools({

      price,

      sessions,

      reference,

      equalLevels,

      h1Swings,

      atrH1

    });


  /* ========================================================
     ENRICH ALL POOLS
  ======================================================== */

  const rankedPools =
    pools

      .map(
        pool =>
          scoreLiquidityPool({

            pool,

            price,

            atr5,

            atr15,

            structure,

            sessions,

            flow,

            regime,

            historical:

              historical.stats,

            macro,

            profile

          })
      )

      .sort(
        (
          a,
          b
        ) =>

          b.combinedQuality -
          a.combinedQuality
      )

      .slice(
        0,
        16
      );


  /* ========================================================
     PRIMARY DRAW
  ======================================================== */

  const primary =
    rankedPools[0] ||
    null;


  /* ========================================================
     TRAP RADAR
  ======================================================== */

  const trapRadar =
    buildTrapRadar({

      pools:
        rankedPools,

      sessions,

      flow,

      regime,

      atr15

    });


  /* ========================================================
     CHART PAYLOAD
  ======================================================== */

  const chart =
    buildChartPayload({

      m1,

      m5,

      m15,

      h1,

      pools:
        rankedPools,

      sessions,

      reference,

      equalLevels,

      profile,

      vwap,

      price

    });


  return {

    ok:
      true,


    symbol:
      SYMBOL,


    generatedAt:
      new Date()
        .toISOString(),


    latestBarTime:
      latest.time
        .toISOString(),


    dataAgeSeconds:
      Math.max(

        0,

        Math.floor(

          (
            Date.now()

            -

            latest.time.getTime()
          )

          /

          1000

        )

      ),


    price:
      round(
        price,
        3
      ),


    engines: {

      live: {

        role:
          "LIVE",

        primaryApi:
          1,

        apiUsed:
          live.apiUsed,

        m1Bars:
          m1.length,

        m5Bars:
          m5.length

      },


      structure: {

        role:
          "STRUCTURE",

        primaryApi:
          2,

        apiUsed:
          structureEngine.apiUsed,

        m15Bars:
          m15.length,

        h1Bars:
          h1.length,

        h4Bars:
          h4.length

      },


      historical: {

        role:
          "HISTORICAL",

        primaryApi:
          3,

        apiUsed:
          historical.apiUsed,

        bars:
          historical.m5.length,

        sessionsStudied:
          historical.stats
            ?.samples ||
          0

      },


      macro: {

        provider:
          "FRED",

        enabled:
          macro.enabled

      }

    },


    market: {

      atr1:
        round(
          atr1,
          3
        ),

      atr5:
        round(
          atr5,
          3
        ),

      atr15:
        round(
          atr15,
          3
        ),

      atrH1:
        round(
          atrH1,
          3
        ),

      vwap:
        round(
          vwap.value,
          3
        ),

      vwapDistance:
        round(
          price -
          vwap.value,
          3
        ),

      vwapMode:
        vwap.mode,

      regime

    },


    structure,


    sessions,


    referenceLevels:
      reference,


    equalLevels,


    flow,


    volumeProfile:
      profile,


    historical:
      historical.stats,


    macro,


    liquidityPools:
      rankedPools,


    primaryLiquidity:
      primary,


    trapRadar,


    chart,


    warnings: [

      "Liquidity Strength is a heuristic level-importance score.",

      "Raid Strength estimates current pressure toward a liquidity pool; it is not a calibrated probability.",

      "Historical Match measures similarity to historical sweep conditions.",

      "Combined Quality combines structure, liquidity, raid pressure, historical behavior and macro context.",

      "Spot XAU/USD OHLC data does not provide centralized exchange bid/ask footprint data.",

      "Delta, CVD and absorption are therefore proxies."

    ]

  };

}


/* ============================================================
   ENGINE 1 — LIVE
============================================================ */

async function buildLiveEngine() {


  const m1Result =
    await fetchRoleSeries({

      primaryKey:
        0,

      interval:
        "1min",

      outputsize:
        900

    });


  const m5Result =
    await fetchRoleSeries({

      primaryKey:
        0,

      interval:
        "5min",

      outputsize:
        1200

    });


  if (
    m1Result.bars.length <
    100
  ) {

    throw new Error(
      "Live Engine: insufficient M1 candles."
    );

  }


  if (
    m5Result.bars.length <
    100
  ) {

    throw new Error(
      "Live Engine: insufficient M5 candles."
    );

  }


  return {

    m1:
      m1Result.bars,

    m5:
      m5Result.bars,

    apiUsed:

      [
        ...new Set([

          m1Result.keyNumber,

          m5Result.keyNumber

        ])

      ]

  };

}


/* ============================================================
   ENGINE 2 — STRUCTURE
============================================================ */

async function buildStructureEngine() {


  const m15Result =
    await fetchRoleSeries({

      primaryKey:
        1,

      interval:
        "15min",

      outputsize:
        1600

    });


  const h1Result =
    await fetchRoleSeries({

      primaryKey:
        1,

      interval:
        "1h",

      outputsize:
        1000

    });


  if (
    m15Result.bars.length <
    100
  ) {

    throw new Error(
      "Structure Engine: insufficient M15 candles."
    );

  }


  if (
    h1Result.bars.length <
    80
  ) {

    throw new Error(
      "Structure Engine: insufficient H1 candles."
    );

  }


  return {

    m15:
      m15Result.bars,

    h1:
      h1Result.bars,

    apiUsed:

      [
        ...new Set([

          m15Result.keyNumber,

          h1Result.keyNumber

        ])

      ]

  };

}


/* ============================================================
   ENGINE 3 — HISTORICAL
============================================================ */

async function buildHistoricalEngine() {


  const result =
    await fetchRoleSeries({

      primaryKey:
        2,

      interval:
        "5min",

      outputsize:
        5000

    });


  if (
    result.bars.length <
    500
  ) {

    throw new Error(
      "Historical Engine: insufficient M5 history."
    );

  }


  const stats =
    buildHistoricalStatistics(
      result.bars
    );


  return {

    m5:
      result.bars,

    stats,

    apiUsed: [
      result.keyNumber
    ]

  };

}


/* ============================================================
   ROLE-AWARE TWELVE DATA FETCH
============================================================ */

async function fetchRoleSeries({

  primaryKey,

  interval,

  outputsize

}) {


  const order = [

    primaryKey,

    (
      primaryKey +
      1
    ) %
    3,

    (
      primaryKey +
      2
    ) %
    3

  ];


  let lastError =
    null;


  for (
    const keyIndex of order
  ) {


    const key =
      TD_KEYS[
        keyIndex
      ];


    if (
      !key
    ) {

      continue;

    }


    try {


      const bars =
        await requestTD({

          key,

          interval,

          outputsize

        });


      return {

        bars,

        keyNumber:
          keyIndex +
          1

      };


    } catch (
      error
    ) {


      lastError =
        error;


      /*
         Only rotate keys when the problem is quota/rate
         related. A malformed symbol or request should not
         blindly consume the other keys.
      */

      if (
        !isRateLimitError(
          error
        )
      ) {

        throw error;

      }

    }

  }


  throw new Error(

    `All Twelve Data keys unavailable for ${interval}. ` +

    `${lastError?.message || ""}`

  );

}


/* ============================================================
   TWELVE DATA REQUEST
============================================================ */

async function requestTD({

  key,

  interval,

  outputsize

}) {


  const url =

    `${TD_BASE}` +

    `?symbol=${encodeURIComponent(
      SYMBOL
    )}` +

    `&interval=${encodeURIComponent(
      interval
    )}` +

    `&outputsize=${encodeURIComponent(
      outputsize
    )}` +

    `&timezone=UTC` +

    `&format=JSON` +

    `&apikey=${encodeURIComponent(
      key
    )}`;


  const response =
    await fetch(

      url,

      {

        cache:
          "no-store",

        headers: {

          Accept:
            "application/json"

        }

      }

    );


  const text =
    await response.text();


  let json;


  try {

    json =
      JSON.parse(
        text
      );

  } catch {

    throw new Error(
      `Twelve Data returned invalid JSON for ${interval}.`
    );

  }


  if (
    response.status ===
    429
  ) {

    const error =
      new Error(
        json.message ||
        "Twelve Data rate limit reached."
      );

    error.rateLimited =
      true;

    throw error;

  }


  if (
    !response.ok
  ) {

    throw new Error(

      `Twelve Data HTTP ${response.status}: ` +

      `${json.message || text.slice(0,150)}`

    );

  }


  if (
    json.status ===
    "error"
  ) {

    const error =
      new Error(

        json.message ||
        "Twelve Data request failed."

      );


    if (
      looksRateLimited(
        json.message
      )
    ) {

      error.rateLimited =
        true;

    }


    throw error;

  }


  if (
    !Array.isArray(
      json.values
    )
  ) {

    throw new Error(

      `Twelve Data returned no ${interval} values.`

    );

  }


  return json.values

    .map(
      row => ({

        time:
          parseTDTime(
            row.datetime
          ),

        open:
          Number(
            row.open
          ),

        high:
          Number(
            row.high
          ),

        low:
          Number(
            row.low
          ),

        close:
          Number(
            row.close
          ),

        volume:
          Number(
            row.volume
          ) ||
          0

      })
    )

    .filter(
      bar =>

        Number.isFinite(
          bar.time.getTime()
        )

        &&

        Number.isFinite(
          bar.open
        )

        &&

        Number.isFinite(
          bar.high
        )

        &&

        Number.isFinite(
          bar.low
        )

        &&

        Number.isFinite(
          bar.close
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
   RATE LIMIT DETECTION
============================================================ */

function isRateLimitError(
  error
) {

  return (

    error?.rateLimited ===
    true

    ||

    looksRateLimited(
      error?.message
    )

  );

}


function looksRateLimited(
  value
) {

  const text =
    String(
      value ||
      ""
    )
      .toLowerCase();


  return (

    text.includes(
      "rate limit"
    )

    ||

    text.includes(
      "credits"
    )

    ||

    text.includes(
      "quota"
    )

    ||

    text.includes(
      "too many requests"
    )

  );

}


/* ============================================================
   TIME PARSER
============================================================ */

function parseTDTime(
  value
) {

  if (
    !value
  ) {

    return new Date(
      NaN
    );

  }


  if (
    value.includes(
      "T"
    )
  ) {

    return new Date(

      value.endsWith(
        "Z"
      )

        ?

        value

        :

        `${value}Z`

    );

  }


  return new Date(

    `${value.replace(
      " ",
      "T"
    )}Z`

  );

}


/* ============================================================
   RESAMPLE
============================================================ */

function resample(
  bars,
  minutes
) {


  const period =
    minutes *
    60_000;


  const map =
    new Map();


  for (
    const bar of bars
  ) {


    const bucket =

      Math.floor(

        bar.time.getTime()

        /

        period

      )

      *

      period;


    if (
      !map.has(
        bucket
      )
    ) {

      map.set(
        bucket,
        {

          time:
            new Date(
              bucket
            ),

          open:
            bar.open,

          high:
            bar.high,

          low:
            bar.low,

          close:
            bar.close,

          volume:
            bar.volume

        }
      );

    } else {


      const current =
        map.get(
          bucket
        );


      current.high =
        Math.max(

          current.high,

          bar.high

        );


      current.low =
        Math.min(

          current.low,

          bar.low

        );


      current.close =
        bar.close;


      current.volume +=
        bar.volume;

    }

  }


  return [

    ...map.values()

  ].sort(
    (
      a,
      b
    ) =>
      a.time -
      b.time
  );

}


/* ============================================================
   EMA
============================================================ */

function emaSeries(
  values,
  period
) {


  if (
    !values.length
  ) {

    return [];

  }


  const alpha =
    2 /
    (
      period +
      1
    );


  const out = [
    values[0]
  ];


  for (
    let i = 1;
    i <
      values.length;
    i++
  ) {


    out.push(

      values[i] *
      alpha

      +

      out[
        i - 1
      ] *
      (
        1 -
        alpha
      )

    );

  }


  return out;

}


/* ============================================================
   RSI
============================================================ */

function rsiValue(
  values,
  period = 14
) {


  if (
    values.length <=
    period
  ) {

    return 50;

  }


  let gain =
    0;

  let loss =
    0;


  for (
    let i = 1;
    i <= period;
    i++
  ) {


    const change =
      values[i] -
      values[
        i - 1
      ];


    gain +=
      Math.max(
        change,
        0
      );


    loss +=
      Math.max(
        -change,
        0
      );

  }


  let avgGain =
    gain /
    period;


  let avgLoss =
    loss /
    period;


  for (
    let i =
      period + 1;

    i <
      values.length;

    i++
  ) {


    const change =
      values[i] -
      values[
        i - 1
      ];


    avgGain =

      (
        avgGain *
        (
          period -
          1
        )

        +

        Math.max(
          change,
          0
        )

      )

      /

      period;


    avgLoss =

      (
        avgLoss *
        (
          period -
          1
        )

        +

        Math.max(
          -change,
          0
        )

      )

      /

      period;

  }


  if (
    avgLoss ===
    0
  ) {

    return 100;

  }


  const rs =
    avgGain /
    avgLoss;


  return (

    100

    -

    100 /
    (
      1 +
      rs
    )

  );

}


/* ============================================================
   ATR
============================================================ */

function atrSeries(
  bars,
  period = 14
) {


  const tr =
    [];


  for (
    let i = 0;
    i <
      bars.length;
    i++
  ) {


    if (
      i ===
      0
    ) {

      tr.push(

        bars[i].high -
        bars[i].low

      );

      continue;

    }


    tr.push(

      Math.max(

        bars[i].high -
        bars[i].low,

        Math.abs(

          bars[i].high -
          bars[
            i - 1
          ].close

        ),

        Math.abs(

          bars[i].low -
          bars[
            i - 1
          ].close

        )

      )

    );

  }


  return emaSeries(
    tr,
    period
  );

}


/* ============================================================
   PIVOTS
============================================================ */

function pivots(
  bars,
  radius = 3,
  lookback = 200
) {


  const highs =
    [];

  const lows =
    [];


  const start =
    Math.max(

      radius,

      bars.length -
      lookback

    );


  for (
    let i =
      start;

    i <
      bars.length -
      radius;

    i++
  ) {


    let highPivot =
      true;

    let lowPivot =
      true;


    for (
      let j = 1;
      j <= radius;
      j++
    ) {


      if (

        bars[i].high <=
        bars[
          i - j
        ].high

        ||

        bars[i].high <
        bars[
          i + j
        ].high

      ) {

        highPivot =
          false;

      }


      if (

        bars[i].low >=
        bars[
          i - j
        ].low

        ||

        bars[i].low >
        bars[
          i + j
        ].low

      ) {

        lowPivot =
          false;

      }

    }


    if (
      highPivot
    ) {

      highs.push({

        price:
          bars[i].high,

        time:
          bars[i].time

      });

    }


    if (
      lowPivot
    ) {

      lows.push({

        price:
          bars[i].low,

        time:
          bars[i].time

      });

    }

  }


  return {

    highs,

    lows

  };

}


/* ============================================================
   STRUCTURE
============================================================ */

function marketStructure(
  bars
) {


  const swings =
    pivots(
      bars
    );


  const h1 =
    swings.highs.at(-1);

  const h2 =
    swings.highs.at(-2);

  const l1 =
    swings.lows.at(-1);

  const l2 =
    swings.lows.at(-2);


  let bias =
    "NEUTRAL";


  if (
    h1 &&
    h2 &&
    l1 &&
    l2
  ) {


    if (

      h1.price >
      h2.price

      &&

      l1.price >
      l2.price

    ) {

      bias =
        "BULLISH";

    }


    else if (

      h1.price <
      h2.price

      &&

      l1.price <
      l2.price

    ) {

      bias =
        "BEARISH";

    }

  }


  const close =
    bars.at(-1)
      ?.close;


  let event =
    "NONE";


  if (

    h1

    &&

    close >
    h1.price

  ) {

    event =

      bias ===
      "BEARISH"

        ?

        "CHOCH_UP"

        :

        "BOS_UP";

  }


  if (

    l1

    &&

    close <
    l1.price

  ) {

    event =

      bias ===
      "BULLISH"

        ?

        "CHOCH_DOWN"

        :

        "BOS_DOWN";

  }


  return {

    bias,

    event,

    swingHigh:
      h1
        ?
        round(
          h1.price,
          3
        )
        :
        null,

    swingLow:
      l1
        ?
        round(
          l1.price,
          3
        )
        :
        null

  };

}


/* ============================================================
   TIMEFRAME STATE
============================================================ */

function timeframeState(
  bars
) {


  const closes =
    bars.map(
      bar =>
        bar.close
    );


  const e20 =
    emaSeries(
      closes,
      20
    );


  const e50 =
    emaSeries(
      closes,
      50
    );


  const e200 =
    emaSeries(

      closes,

      Math.min(
        200,
        Math.max(
          20,
          closes.length - 1
        )
      )

    );


  const rsi =
    rsiValue(
      closes,
      14
    );


  const structure =
    marketStructure(
      bars
    );


  let score =
    0;


  score +=

    closes.at(-1) >
    lastFinite(
      e20
    )

      ?

      15

      :

      -15;


  score +=

    lastFinite(
      e20
    ) >
    lastFinite(
      e50
    )

      ?

      20

      :

      -20;


  score +=

    lastFinite(
      e50
    ) >
    lastFinite(
      e200
    )

      ?

      20

      :

      -20;


  if (
    rsi >
    55
  ) {

    score +=
      12;

  }


  if (
    rsi <
    45
  ) {

    score -=
      12;

  }


  if (
    structure.bias ===
    "BULLISH"
  ) {

    score +=
      25;

  }


  if (
    structure.bias ===
    "BEARISH"
  ) {

    score -=
      25;

  }


  score =
    clamp(
      score,
      -100,
      100
    );


  return {

    bias:

      score >=
      25

        ?

        "BULLISH"

        :

        score <=
        -25

          ?

          "BEARISH"

          :

          "NEUTRAL",

    score:
      round(
        score,
        1
      ),

    rsi:
      round(
        rsi,
        1
      ),

    ema20:
      round(
        lastFinite(
          e20
        ),
        3
      ),

    ema50:
      round(
        lastFinite(
          e50
        ),
        3
      ),

    ema200:
      round(
        lastFinite(
          e200
        ),
        3
      ),

    atr:
      round(

        lastFinite(
          atrSeries(
            bars,
            14
          )
        ),

        3

      ),

    structure

  };

}


/* ============================================================
   TIMEZONE
============================================================ */

function zoneParts(
  date,
  timezone
) {


  const parts =
    new Intl.DateTimeFormat(

      "en-CA",

      {

        timeZone:
          timezone,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        weekday:
          "short",

        hourCycle:
          "h23"

      }

    )
      .formatToParts(
        date
      );


  const object =
    {};


  for (
    const part of parts
  ) {

    if (
      part.type !==
      "literal"
    ) {

      object[
        part.type
      ] =
        part.value;

    }

  }


  const weekdays = {

    Sun: 0,

    Mon: 1,

    Tue: 2,

    Wed: 3,

    Thu: 4,

    Fri: 5,

    Sat: 6

  };


  return {

    year:
      Number(
        object.year
      ),

    month:
      Number(
        object.month
      ),

    day:
      Number(
        object.day
      ),

    hour:
      Number(
        object.hour
      ),

    minute:
      Number(
        object.minute
      ),

    weekday:
      weekdays[
        object.weekday
      ]

  };

}


function dateKeyFromParts(
  p
) {

  return (

    `${p.year}-` +

    `${pad(p.month)}-` +

    `${pad(p.day)}`

  );

}


/* ============================================================
   SESSIONS
============================================================ */

function buildSessions(
  bars
) {


  const now =
    new Date();


  return SESSION_DEFS.map(
    definition => {


      const range =
        latestSessionRange(

          bars,

          definition

        );


      const active =
        isSessionOpen(

          now,

          definition

        );


      const transition =
        nextSessionTransition(

          now,

          definition

        );


      return {

        id:
          definition.id,

        name:
          definition.name,

        short:
          definition.short,

        zone:
          definition.zone,

        active,

        phase:
          getSessionPhase(

            now,

            definition

          ),

        openLocal:
          minuteLabel(
            definition.open
          ),

        closeLocal:
          minuteLabel(
            definition.close
          ),

        nextEvent:
          transition.type,

        nextEventAt:
          transition.time
            .toISOString(),

        range

      };

    }
  );

}


function isSessionOpen(
  date,
  definition
) {


  const p =
    zoneParts(

      date,

      definition.zone

    );


  const minute =

    p.hour *
    60

    +

    p.minute;


  return (

    p.weekday >=
    1

    &&

    p.weekday <=
    5

    &&

    minute >=
    definition.open

    &&

    minute <
    definition.close

  );

}


function getSessionPhase(
  date,
  definition
) {


  const p =
    zoneParts(

      date,

      definition.zone

    );


  const minute =

    p.hour *
    60

    +

    p.minute;


  if (
    isSessionOpen(
      date,
      definition
    )
  ) {


    const elapsed =
      minute -
      definition.open;


    if (
      elapsed <=
      90
    ) {

      return "OPENING LIQUIDITY WINDOW";

    }


    if (
      definition.close -
      minute <=
      60
    ) {

      return "CLOSING LIQUIDITY WINDOW";

    }


    return "MID SESSION";

  }


  if (

    minute <
    definition.open

    &&

    definition.open -
    minute <=
    60

  ) {

    return "PRE-OPEN";

  }


  return "CLOSED";

}


function nextSessionTransition(
  now,
  definition
) {


  let oldState =
    isSessionOpen(

      now,

      definition

    );


  for (
    let i = 1;
    i <= 10080;
    i++
  ) {


    const future =
      new Date(

        now.getTime()

        +

        i *
        60_000

      );


    const state =
      isSessionOpen(

        future,

        definition

      );


    if (
      state !==
      oldState
    ) {

      return {

        type:
          state
            ?
            "OPEN"
            :
            "CLOSE",

        time:
          future

      };

    }


    oldState =
      state;

  }


  return {

    type:
      "UNKNOWN",

    time:
      new Date(

        now.getTime()

        +

        86_400_000

      )

  };

}


function latestSessionRange(
  bars,
  definition
) {


  const groups =
    new Map();


  for (
    const bar of bars
  ) {


    const p =
      zoneParts(

        bar.time,

        definition.zone

      );


    const minute =

      p.hour *
      60

      +

      p.minute;


    if (

      minute <
      definition.open

      ||

      minute >=
      definition.close

    ) {

      continue;

    }


    const key =
      dateKeyFromParts(
        p
      );


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
        key,
        []
      );

    }


    groups
      .get(
        key
      )
      .push(
        bar
      );

  }


  const key =

    [
      ...groups.keys()
    ]
      .sort()
      .at(-1);


  if (
    !key
  ) {

    return null;

  }


  const rows =
    groups.get(
      key
    );


  const high =
    Math.max(

      ...rows.map(
        row =>
          row.high
      )

    );


  const low =
    Math.min(

      ...rows.map(
        row =>
          row.low
      )

    );


  return {

    date:
      key,

    high:
      round(
        high,
        3
      ),

    low:
      round(
        low,
        3
      ),

    midpoint:
      round(

        (
          high +
          low
        )
        /
        2,

        3

      ),

    range:
      round(
        high -
        low,
        3
      )

  };

}


/* ============================================================
   PREVIOUS DAY / WEEK
============================================================ */

function buildReferenceLevels(
  h1
) {


  const days =
    new Map();


  for (
    const bar of h1
  ) {


    const key =
      bar.time
        .toISOString()
        .slice(
          0,
          10
        );


    if (
      !days.has(
        key
      )
    ) {

      days.set(
        key,
        []
      );

    }


    days
      .get(
        key
      )
      .push(
        bar
      );

  }


  const today =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );


  const completedDays =

    [
      ...days.keys()
    ]

      .filter(
        key =>
          key <
          today
      )

      .sort();


  const previousDayKey =
    completedDays.at(-1);


  let previousDay =
    null;


  if (
    previousDayKey
  ) {


    const rows =
      days.get(
        previousDayKey
      );


    const high =
      Math.max(

        ...rows.map(
          x =>
            x.high
        )

      );


    const low =
      Math.min(

        ...rows.map(
          x =>
            x.low
        )

      );


    previousDay = {

      date:
        previousDayKey,

      high:
        round(
          high,
          3
        ),

      low:
        round(
          low,
          3
        ),

      midpoint:
        round(

          (
            high +
            low
          )
          /
          2,

          3

        )

    };

  }


  const weeks =
    new Map();


  for (
    const bar of h1
  ) {


    const key =
      weekKey(
        bar.time
      );


    if (
      !weeks.has(
        key
      )
    ) {

      weeks.set(
        key,
        []
      );

    }


    weeks
      .get(
        key
      )
      .push(
        bar
      );

  }


  const currentWeek =
    weekKey(
      new Date()
    );


  const completedWeeks =

    [
      ...weeks.keys()
    ]

      .filter(
        key =>
          key <
          currentWeek
      )

      .sort();


  const previousWeekKey =
    completedWeeks.at(-1);


  let previousWeek =
    null;


  if (
    previousWeekKey
  ) {


    const rows =
      weeks.get(
        previousWeekKey
      );


    previousWeek = {

      week:
        previousWeekKey,

      high:
        round(

          Math.max(

            ...rows.map(
              x =>
                x.high
            )

          ),

          3

        ),

      low:
        round(

          Math.min(

            ...rows.map(
              x =>
                x.low
            )

          ),

          3

        )

    };

  }


  return {

    previousDay,

    previousWeek

  };

}


/* ============================================================
   EQUAL LIQUIDITY
============================================================ */

function detectEqualLiquidity(
  bars,
  atr
) {


  const swings =
    pivots(

      bars,

      2,

      240

    );


  const tolerance =
    Math.max(

      (
        atr ||
        1
      ) *
      .12,

      .10

    );


  return {

    highs:
      clusterLiquidity(

        swings.highs,

        tolerance

      ),

    lows:
      clusterLiquidity(

        swings.lows,

        tolerance

      )

  };

}


function clusterLiquidity(
  swings,
  tolerance
) {


  const groups =
    [];


  for (
    const swing of swings
  ) {


    const found =
      groups.find(

        group =>

          Math.abs(

            group.price -
            swing.price

          )

          <=
          tolerance

      );


    if (
      !found
    ) {

      groups.push({

        price:
          swing.price,

        touches:
          1

      });

      continue;

    }


    found.price =

      (
        found.price *
        found.touches

        +

        swing.price

      )

      /

      (
        found.touches +
        1
      );


    found.touches++;

  }


  return groups

    .filter(
      x =>
        x.touches >=
        2
    )

    .sort(
      (
        a,
        b
      ) =>
        b.touches -
        a.touches
    )

    .slice(
      0,
      6
    )

    .map(
      x => ({

        price:
          round(
            x.price,
            3
          ),

        touches:
          x.touches

      })
    );

}


/* ============================================================
   FLOW ENGINE
============================================================ */

function buildFlowEngine(
  bars
) {


  const recent =
    bars.slice(
      -240
    );


  const ranges =
    recent.map(

      bar =>
        Math.max(

          bar.high -
          bar.low,

          .000001

        )

    );


  const medianRange =
    median(
      ranges
    ) ||
    1;


  const hasVolume =

    recent.filter(
      bar =>
        bar.volume >
        0
    ).length

    >=

    recent.length *
    .5;


  const rows =
    recent.map(
      bar => {


        const range =
          Math.max(

            bar.high -
            bar.low,

            .000001

          );


        const body =

          (
            bar.close -
            bar.open
          )

          /

          range;


        const closeLocation =

          (

            (
              bar.close -
              bar.low
            )

            -

            (
              bar.high -
              bar.close
            )

          )

          /

          range;


        const activity =

          hasVolume

            ?

            Math.max(
              bar.volume,
              1
            )

            :

            clamp(

              range /
              medianRange,

              .25,

              5

            )

            *
            100;


        const buyShare =
          clamp(

            .5

            +

            closeLocation *
            .30

            +

            body *
            .20,

            .05,

            .95

          );


        const buy =
          activity *
          buyShare;


        const sell =
          activity -
          buy;


        return {

          time:
            bar.time,

          close:
            bar.close,

          activity,

          buy,

          sell,

          delta:
            buy -
            sell

        };

      }
    );


  let cvd =
    0;


  for (
    const row of rows
  ) {

    cvd +=
      row.delta;

    row.cvd =
      cvd;

  }


  const activityMedian =
    median(

      rows.map(
        x =>
          x.activity
      )

    ) ||
    1;


  let upperAbsorption =
    0;

  let lowerAbsorption =
    0;


  const recentBars =
    recent.slice(
      -30
    );


  const recentRows =
    rows.slice(
      -30
    );


  for (
    let i = 0;
    i <
      recentBars.length;
    i++
  ) {


    const bar =
      recentBars[i];


    const row =
      recentRows[i];


    const range =
      Math.max(

        bar.high -
        bar.low,

        .000001

      );


    const upperWick =

      bar.high

      -

      Math.max(
        bar.open,
        bar.close
      );


    const lowerWick =

      Math.min(
        bar.open,
        bar.close
      )

      -

      bar.low;


    if (

      row.activity >
      activityMedian *
      1.35

      &&

      row.delta >
      0

      &&

      upperWick /
      range >
      .4

    ) {

      upperAbsorption++;

    }


    if (

      row.activity >
      activityMedian *
      1.35

      &&

      row.delta <
      0

      &&

      lowerWick /
      range >
      .4

    ) {

      lowerAbsorption++;

    }

  }


  let absorption =
    "NONE";


  if (
    upperAbsorption >=
    2
  ) {

    absorption =
      "BUYING ABSORBED";

  }


  else if (
    lowerAbsorption >=
    2
  ) {

    absorption =
      "SELLING ABSORBED";

  }


  return {

    mode:

      hasVolume

        ?

        "OHLCV directional-volume proxy"

        :

        "Price-activity proxy",

    hasProviderVolume:
      hasVolume,

    m5:
      aggregateFlow(
        rows.slice(-5)
      ),

    m15:
      aggregateFlow(
        rows.slice(-15)
      ),

    m30:
      aggregateFlow(
        rows.slice(-30)
      ),

    h1:
      aggregateFlow(
        rows.slice(-60)
      ),

    cvd:
      round(
        cvd,
        2
      ),

    divergence:
      detectFlowDivergence(
        rows
      ),

    absorption

  };

}


function aggregateFlow(
  rows
) {


  const activity =
    sum(

      rows.map(
        x =>
          x.activity
      )

    );


  const delta =
    sum(

      rows.map(
        x =>
          x.delta
      )

    );


  return {

    activity:
      round(
        activity,
        2
      ),

    delta:
      round(
        delta,
        2
      ),

    deltaPct:
      round(

        activity

          ?

          delta /
          activity *
          100

          :

          0,

        1

      )

  };

}


function detectFlowDivergence(
  rows
) {


  if (
    rows.length <
    50
  ) {

    return "NONE";

  }


  const older =
    rows.slice(
      -50,
      -25
    );


  const newer =
    rows.slice(
      -25
    );


  const priceChange =

    newer.at(-1).close

    -

    older.at(-1).close;


  const delta =
    sum(

      newer.map(
        x =>
          x.delta
      )

    );


  if (

    priceChange >
    0

    &&

    delta <
    0

  ) {

    return "BEARISH DELTA DIVERGENCE";

  }


  if (

    priceChange <
    0

    &&

    delta >
    0

  ) {

    return "BULLISH DELTA DIVERGENCE";

  }


  return "NONE";

}


/* ============================================================
   VWAP
============================================================ */

function buildVWAP(
  bars
) {


  const recent =
    bars.slice(
      -500
    );


  const hasVolume =

    recent.filter(
      x =>
        x.volume >
        0
    ).length

    >=

    recent.length *
    .5;


  const medRange =
    median(

      recent.map(
        x =>
          x.high -
          x.low
      )

    ) ||
    1;


  let numerator =
    0;

  let denominator =
    0;


  for (
    const bar of recent
  ) {


    const typical =

      (
        bar.high +
        bar.low +
        bar.close
      )

      /
      3;


    const weight =

      hasVolume

        ?

        Math.max(
          bar.volume,
          1
        )

        :

        Math.max(

          .2,

          (
            bar.high -
            bar.low
          )

          /
          medRange

        );


    numerator +=
      typical *
      weight;


    denominator +=
      weight;

  }


  return {

    value:

      denominator

        ?

        numerator /
        denominator

        :

        recent.at(-1)
          ?.close,

    mode:

      hasVolume

        ?

        "VOLUME WEIGHTED"

        :

        "ACTIVITY WEIGHTED"

  };

}


/* ============================================================
   PROFILE
============================================================ */

function buildActivityProfile(
  bars,
  bins = 40
) {


  const low =
    Math.min(

      ...bars.map(
        x =>
          x.low
      )

    );


  const high =
    Math.max(

      ...bars.map(
        x =>
          x.high
      )

    );


  const step =

    (
      high -
      low
    )

    /
    bins

    ||
    1;


  const data =
    Array.from(

      {
        length:
          bins
      },

      (
        _,
        index
      ) => ({

        price:

          low

          +

          (
            index +
            .5
          )

          *
          step,

        activity:
          0

      })

    );


  for (
    const bar of bars
  ) {


    const typical =

      (
        bar.high +
        bar.low +
        bar.close
      )

      /
      3;


    const index =
      clamp(

        Math.floor(

          (
            typical -
            low
          )

          /
          step

        ),

        0,

        bins -
        1

      );


    data[
      index
    ].activity +=

      bar.volume >
      0

        ?

        bar.volume

        :

        1;

  }


  const highNodes =

    [
      ...data
    ]
      .sort(
        (
          a,
          b
        ) =>
          b.activity -
          a.activity
      );


  const lowNodes =

    [
      ...data
    ]

      .filter(
        x =>
          x.activity >
          0
      )

      .sort(
        (
          a,
          b
        ) =>
          a.activity -
          b.activity
      );


  return {

    poc:
      round(
        highNodes[0]
          ?.price,
        3
      ),

    hvn:
      highNodes

        .slice(
          0,
          3
        )

        .map(
          x =>
            round(
              x.price,
              3
            )
        ),

    lvn:
      lowNodes

        .slice(
          0,
          3
        )

        .map(
          x =>
            round(
              x.price,
              3
            )
        )

  };

}


/* ============================================================
   MARKET REGIME
============================================================ */

function buildMarketRegime({

  structure,

  m5,

  atr5,

  flow

}) {


  const biasList = [

    structure.m5.bias,

    structure.m15.bias,

    structure.h1.bias,

    structure.h4.bias

  ];


  const bullish =
    biasList.filter(
      x =>
        x ===
        "BULLISH"
    ).length;


  const bearish =
    biasList.filter(
      x =>
        x ===
        "BEARISH"
    ).length;


  const trend =

    bullish >=
    3

      ?

      "BULLISH"

      :

      bearish >=
      3

        ?

        "BEARISH"

        :

        "MIXED";


  const atrHistory =
    atrSeries(
      m5,
      14
    );


  const baseline =
    median(
      atrHistory
    ) ||
    atr5;


  const expansion =

    atr5

    /

    Math.max(
      baseline,
      .000001
    );


  const volatility =

    expansion >=
    1.30

      ?

      "EXPANDING"

      :

      expansion <=
      .75

        ?

        "COMPRESSED"

        :

        "NORMAL";


  const delta =
    flow.m15
      ?.deltaPct ||
    0;


  const orderFlow =

    delta >=
    18

      ?

      "BUY DOMINANT"

      :

      delta <=
      -18

        ?

        "SELL DOMINANT"

        :

        "BALANCED";


  return {

    trend,

    volatility,

    orderFlow,

    atrExpansion:
      round(
        expansion,
        2
      ),

    label:

      `${trend} · ` +

      `${volatility} · ` +

      `${orderFlow}`

  };

}


/* ============================================================
   HISTORICAL STATISTICS
============================================================ */

function buildHistoricalStatistics(
  bars
) {


  const stats = {

    samples:
      0,

    asiaHigh:
      [],

    asiaLow:
      [],

    londonHigh:
      [],

    londonLow:
      [],

    nyHigh:
      [],

    nyLow:
      []

  };


  const days =
    splitDaysUTC(
      bars
    );


  for (
    const dayBars of
    days.values()
  ) {


    if (
      dayBars.length <
      100
    ) {

      continue;

    }


    stats.samples++;


    studySessionSweep({

      bars:
        dayBars,

      definition:
        SESSION_DEFS[0],

      highOutput:
        stats.asiaHigh,

      lowOutput:
        stats.asiaLow

    });


    studySessionSweep({

      bars:
        dayBars,

      definition:
        SESSION_DEFS[1],

      highOutput:
        stats.londonHigh,

      lowOutput:
        stats.londonLow

    });


    studySessionSweep({

      bars:
        dayBars,

      definition:
        SESSION_DEFS[2],

      highOutput:
        stats.nyHigh,

      lowOutput:
        stats.nyLow

    });

  }


  return {

    samples:
      stats.samples,

    asiaHigh:
      summarizeSweepEvents(

        stats.asiaHigh,

        stats.samples

      ),

    asiaLow:
      summarizeSweepEvents(

        stats.asiaLow,

        stats.samples

      ),

    londonHigh:
      summarizeSweepEvents(

        stats.londonHigh,

        stats.samples

      ),

    londonLow:
      summarizeSweepEvents(

        stats.londonLow,

        stats.samples

      ),

    nyHigh:
      summarizeSweepEvents(

        stats.nyHigh,

        stats.samples

      ),

    nyLow:
      summarizeSweepEvents(

        stats.nyLow,

        stats.samples

      )

  };

}


function splitDaysUTC(
  bars
) {


  const map =
    new Map();


  for (
    const bar of bars
  ) {


    const key =
      bar.time
        .toISOString()
        .slice(
          0,
          10
        );


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        []
      );

    }


    map
      .get(
        key
      )
      .push(
        bar
      );

  }


  return map;

}


function studySessionSweep({

  bars,

  definition,

  highOutput,

  lowOutput

}) {


  const sessionBars =
    [];

  const afterBars =
    [];


  for (
    const bar of bars
  ) {


    const p =
      zoneParts(

        bar.time,

        definition.zone

      );


    const minute =

      p.hour *
      60

      +

      p.minute;


    if (

      minute >=
      definition.open

      &&

      minute <
      definition.close

    ) {

      sessionBars.push(
        bar
      );

    }


    if (

      minute >=
      definition.close

      &&

      minute <
      Math.min(
        1440,
        definition.close +
        6 * 60
      )

    ) {

      afterBars.push(
        bar
      );

    }

  }


  if (

    sessionBars.length <
    20

    ||

    afterBars.length <
    5

  ) {

    return;

  }


  const sessionHigh =
    Math.max(

      ...sessionBars.map(
        x =>
          x.high
      )

    );


  const sessionLow =
    Math.min(

      ...sessionBars.map(
        x =>
          x.low
      )

    );


  const atr =
    lastFinite(

      atrSeries(
        sessionBars,
        14
      )

    ) ||
    1;


  const highSweep =
    measureSweep({

      bars:
        afterBars,

      level:
        sessionHigh,

      side:
        "HIGH",

      atr

    });


  const lowSweep =
    measureSweep({

      bars:
        afterBars,

      level:
        sessionLow,

      side:
        "LOW",

      atr

    });


  if (
    highSweep
  ) {

    highOutput.push(
      highSweep
    );

  }


  if (
    lowSweep
  ) {

    lowOutput.push(
      lowSweep
    );

  }

}


function measureSweep({

  bars,

  level,

  side,

  atr

}) {


  const first =
    bars.findIndex(

      bar =>

        side ===
        "HIGH"

          ?

          bar.high >
          level

          :

          bar.low <
          level

    );


  if (
    first ===
    -1
  ) {

    return null;

  }


  const sample =
    bars.slice(

      first,

      first +
      24

    );


  let extension =
    0;

  let returned =
    false;

  let returnBars =
    null;


  for (
    let i = 0;
    i <
      sample.length;
    i++
  ) {


    const bar =
      sample[i];


    const overshoot =

      side ===
      "HIGH"

        ?

        bar.high -
        level

        :

        level -
        bar.low;


    extension =
      Math.max(

        extension,

        overshoot

      );


    if (
      i >
      0
    ) {


      const inside =

        side ===
        "HIGH"

          ?

          bar.close <
          level

          :

          bar.close >
          level;


      if (
        inside
      ) {

        returned =
          true;

        returnBars =
          i;

        break;

      }

    }

  }


  return {

    overshootAtr:

      extension

      /

      Math.max(
        atr,
        .000001
      ),

    returned,

    returnBars

  };

}


function summarizeSweepEvents(
  events,
  samples
) {


  const overshoots =
    events

      .map(
        x =>
          x.overshootAtr
      )

      .filter(
        Number.isFinite
      );


  const returns =
    events.filter(
      x =>
        x.returned
    );


  const returnBars =
    returns

      .map(
        x =>
          x.returnBars
      )

      .filter(
        Number.isFinite
      );


  return {

    sweeps:
      events.length,

    sweepRatePct:
      round(

        samples

          ?

          events.length /
          samples *
          100

          :

          0,

        1

      ),

    returnRatePct:
      round(

        events.length

          ?

          returns.length /
          events.length *
          100

          :

          0,

        1

      ),

    p25OvershootAtr:
      round(

        percentile(
          overshoots,
          .25
        ) ??
        .08,

        3

      ),

    medianOvershootAtr:
      round(

        percentile(
          overshoots,
          .50
        ) ??
        .18,

        3

      ),

    p75OvershootAtr:
      round(

        percentile(
          overshoots,
          .75
        ) ??
        .35,

        3

      ),

    p90OvershootAtr:
      round(

        percentile(
          overshoots,
          .90
        ) ??
        .55,

        3

      ),

    medianReturnBars:
      round(

        median(
          returnBars
        ) ??
        0,

        1

      )

  };

}


/* ============================================================
   LIQUIDITY POOLS
============================================================ */

function buildLiquidityPools({

  price,

  sessions,

  reference,

  equalLevels,

  h1Swings,

  atrH1

}) {


  const pools =
    [];


  function add(

    name,

    level,

    side,

    type,

    importance

  ) {


    if (
      !Number.isFinite(
        Number(
          level
        )
      )
    ) {

      return;

    }


    pools.push({

      name,

      level:
        Number(
          level
        ),

      side,

      type,

      importance,

      aliases:
        []

    });

  }


  for (
    const session of sessions
  ) {


    if (
      !session.range
    ) {

      continue;

    }


    add(

      `${session.short} High`,

      session.range.high,

      "HIGH",

      `${session.id.toUpperCase()}_HIGH`,

      session.id ===
      "asia"
        ?
        1.40
        :
        1.28

    );


    add(

      `${session.short} Low`,

      session.range.low,

      "LOW",

      `${session.id.toUpperCase()}_LOW`,

      session.id ===
      "asia"
        ?
        1.40
        :
        1.28

    );

  }


  if (
    reference.previousDay
  ) {


    add(

      "Previous Day High",

      reference.previousDay.high,

      "HIGH",

      "PDH",

      1.55

    );


    add(

      "Previous Day Low",

      reference.previousDay.low,

      "LOW",

      "PDL",

      1.55

    );

  }


  if (
    reference.previousWeek
  ) {


    add(

      "Previous Week High",

      reference.previousWeek.high,

      "HIGH",

      "PWH",

      1.65

    );


    add(

      "Previous Week Low",

      reference.previousWeek.low,

      "LOW",

      "PWL",

      1.65

    );

  }


  for (
    const eq of
    equalLevels.highs
  ) {


    add(

      `Equal Highs ${eq.touches}x`,

      eq.price,

      "HIGH",

      "EQH",

      1.45

    );

  }


  for (
    const eq of
    equalLevels.lows
  ) {


    add(

      `Equal Lows ${eq.touches}x`,

      eq.price,

      "LOW",

      "EQL",

      1.45

    );

  }


  for (
    const swing of
    h1Swings.highs
      .slice(-4)
  ) {


    add(

      "H1 Swing High",

      swing.price,

      "HIGH",

      "H1_HIGH",

      1.10

    );

  }


  for (
    const swing of
    h1Swings.lows
      .slice(-4)
  ) {


    add(

      "H1 Swing Low",

      swing.price,

      "LOW",

      "H1_LOW",

      1.10

    );

  }


  const maxDistance =

    (
      atrH1 ||
      10
    )

    *
    7;


  const filtered =
    pools.filter(

      pool =>

        Math.abs(

          pool.level -
          price

        )

        <=
        maxDistance

    );


  return mergeNearbyPools(

    filtered,

    Math.max(

      (
        atrH1 ||
        1
      )

      *
      .035,

      .08

    )

  );

}


function mergeNearbyPools(
  pools,
  tolerance
) {


  const result =
    [];


  for (
    const pool of

    [
      ...pools
    ]
      .sort(
        (
          a,
          b
        ) =>
          a.level -
          b.level
      )
  ) {


    const existing =
      result.find(

        item =>

          item.side ===
          pool.side

          &&

          Math.abs(

            item.level -
            pool.level

          )

          <=
          tolerance

      );


    if (
      !existing
    ) {

      result.push({

        ...pool

      });

      continue;

    }


    existing.aliases.push(
      pool.name
    );


    existing.level =

      (
        existing.level +
        pool.level
      )

      /
      2;


    existing.importance =
      Math.max(

        existing.importance,

        pool.importance

      );


    if (
      pool.importance >
      existing.importance
    ) {

      existing.name =
        pool.name;

      existing.type =
        pool.type;

    }

  }


  return result;

}


/* ============================================================
   HISTORICAL MATCH FOR POOL
============================================================ */

function historyForPool(
  pool,
  historical
) {


  const map = {

    ASIA_HIGH:
      historical.asiaHigh,

    ASIA_LOW:
      historical.asiaLow,

    LONDON_HIGH:
      historical.londonHigh,

    LONDON_LOW:
      historical.londonLow,

    NEWYORK_HIGH:
      historical.nyHigh,

    NEWYORK_LOW:
      historical.nyLow

  };


  return (
    map[
      pool.type
    ] ||
    null
  );

}


/* ============================================================
   SCORE LIQUIDITY POOL
============================================================ */

function scoreLiquidityPool({

  pool,

  price,

  atr5,

  atr15,

  structure,

  sessions,

  flow,

  regime,

  historical,

  macro,

  profile

}) {


  const direction =

    pool.side ===
    "HIGH"

      ?

      1

      :

      -1;


  const distance =
    Math.abs(

      pool.level -
      price

    );


  const distanceAtr =

    distance

    /

    Math.max(
      atr15,
      .000001
    );


  const correctSide =

    pool.side ===
    "HIGH"

      ?

      pool.level >=
      price

      :

      pool.level <=
      price;


  /* ========================================================
     LIQUIDITY STRENGTH
  ======================================================== */

  let liquidityStrength =

    30

    +

    pool.importance *
    30;


  if (
    pool.type ===
    "PDH" ||
    pool.type ===
    "PDL"
  ) {

    liquidityStrength +=
      8;

  }


  if (
    pool.type ===
    "PWH" ||
    pool.type ===
    "PWL"
  ) {

    liquidityStrength +=
      12;

  }


  if (
    pool.type ===
    "EQH" ||
    pool.type ===
    "EQL"
  ) {

    liquidityStrength +=
      10;

  }


  if (
    pool.aliases.length
  ) {

    liquidityStrength +=
      Math.min(

        12,

        pool.aliases.length *
        4

      );

  }


  const profileNodes = [

    profile.poc,

    ...profile.hvn

  ].filter(
    Number.isFinite
  );


  if (
    profileNodes.some(

      node =>

        Math.abs(
          node -
          pool.level
        )

        <=
        atr5 *
        .25

    )
  ) {

    liquidityStrength +=
      8;

  }


  liquidityStrength =
    clamp(

      liquidityStrength,

      0,

      100

    );


  /* ========================================================
     RAID STRENGTH
  ======================================================== */

  const mtfPressure =

    structure.m1.score *
    .10

    +

    structure.m5.score *
    .25

    +

    structure.m15.score *
    .35

    +

    structure.h1.score *
    .20

    +

    structure.h4.score *
    .10;


  const directionalTrend =
    direction *
    mtfPressure;


  const delta =
    flow.m15
      ?.deltaPct ||
    0;


  let raidStrength =

    50 *
    Math.exp(

      -distanceAtr /
      1.25

    )

    +

    20;


  raidStrength +=
    clamp(

      directionalTrend /
      6,

      -15,

      15

    );


  raidStrength +=
    clamp(

      direction *
      delta /
      2.8,

      -12,

      12

    );


  if (
    regime.volatility ===
    "EXPANDING"
  ) {

    raidStrength +=
      8;

  }


  const activeOpening =
    sessions.find(

      session =>

        session.phase ===
        "OPENING LIQUIDITY WINDOW"

    );


  if (
    activeOpening
  ) {

    raidStrength +=

      activeOpening.id ===
      "asia"

        ?

        5

        :

        10;

  }


  if (
    !correctSide
  ) {

    raidStrength -=
      35;

  }


  raidStrength =
    clamp(

      raidStrength,

      0,

      100

    );


  /* ========================================================
     HISTORICAL MATCH
  ======================================================== */

  const history =
    historyForPool(

      pool,

      historical

    );


  let historicalMatch =
    50;


  if (
    history
  ) {


    historicalMatch =

      history.sweepRatePct *
      .50

      +

      history.returnRatePct *
      .30

      +

      Math.min(

        20,

        history.sweeps *
        .7

      );

  }


  if (
    pool.type ===
    "PDH" ||
    pool.type ===
    "PDL" ||
    pool.type ===
    "PWH" ||
    pool.type ===
    "PWL"
  ) {

    historicalMatch +=
      5;

  }


  historicalMatch =
    clamp(

      historicalMatch,

      0,

      100

    );


  /* ========================================================
     MACRO ALIGNMENT
  ======================================================== */

  const macroScore =
    Number(
      macro.score
    ) ||
    0;


  const macroAlignment =

    clamp(

      50

      +

      direction *
      macroScore *
      .35,

      0,

      100

    );


  /* ========================================================
     COMBINED QUALITY
  ======================================================== */

  const combinedQuality =

    liquidityStrength *
    .32

    +

    raidStrength *
    .36

    +

    historicalMatch *
    .22

    +

    macroAlignment *
    .10;


  /* ========================================================
     SWEEP DEPTH
  ======================================================== */

  const p25 =
    history
      ?.p25OvershootAtr ??
    .08;


  let medianOvershoot =
    history
      ?.medianOvershootAtr ??
    .20;


  let p75 =
    history
      ?.p75OvershootAtr ??
    .40;


  let p90 =
    history
      ?.p90OvershootAtr ??
    .60;


  if (
    raidStrength >=
    80
  ) {

    medianOvershoot *=
      1.15;

    p75 *=
      1.15;

    p90 *=
      1.10;

  }


  if (
    regime.volatility ===
    "EXPANDING"
  ) {

    medianOvershoot *=
      1.12;

    p75 *=
      1.15;

  }


  const likelyEnd =

    pool.level

    +

    direction *
    medianOvershoot *
    atr5;


  const zoneA =

    pool.level

    +

    direction *
    p25 *
    atr5;


  const zoneB =

    pool.level

    +

    direction *
    p75 *
    atr5;


  const acceptance =

    pool.level

    +

    direction *
    p90 *
    atr5;


  const zoneLow =
    Math.min(
      zoneA,
      zoneB
    );


  const zoneHigh =
    Math.max(
      zoneA,
      zoneB
    );


  /* ========================================================
     RAID STAGE
  ======================================================== */

  const stage =
    determineRaidStage({

      pool,

      price,

      distanceAtr,

      likelyEnd,

      zoneLow,

      zoneHigh,

      raidStrength

    });


  return {

    ...pool,


    level:
      round(
        pool.level,
        3
      ),


    distance:
      round(
        distance,
        3
      ),


    distanceAtr:
      round(
        distanceAtr,
        2
      ),


    liquidityStrength:
      round(
        liquidityStrength,
        0
      ),


    raidStrength:
      round(
        raidStrength,
        0
      ),


    historicalMatch:
      round(
        historicalMatch,
        0
      ),


    macroAlignment:
      round(
        macroAlignment,
        0
      ),


    combinedQuality:
      round(
        combinedQuality,
        0
      ),


    stage,


    projectedSweep: {

      likelyEnd:
        round(
          likelyEnd,
          3
        ),

      zoneLow:
        round(
          zoneLow,
          3
        ),

      zoneHigh:
        round(
          zoneHigh,
          3
        ),

      acceptanceThreshold:
        round(
          acceptance,
          3
        ),

      medianOvershootAtr:
        round(
          medianOvershoot,
          3
        ),

      p75OvershootAtr:
        round(
          p75,
          3
        ),

      p90OvershootAtr:
        round(
          p90,
          3
        )

    },


    historicalStats:
      history,


    reasons: [

      `${round(
        distanceAtr,
        2
      )}× M15 ATR from current price`,

      `Liquidity importance ${round(
        pool.importance,
        2
      )}`,

      `M15 directional flow ${round(
        delta,
        1
      )}%`,

      `MTF directional pressure ${round(
        directionalTrend,
        1
      )}`,

      regime.volatility ===
      "EXPANDING"
        ?
        "Volatility is expanding"
        :
        `Volatility ${regime.volatility.toLowerCase()}`,

      activeOpening
        ?
        `${activeOpening.name} opening window active`
        :
        null,

      history
        ?
        `${history.sweepRatePct}% historical sweep rate`
        :
        null,

      history
        ?
        `${history.returnRatePct}% historical return rate after sweep`
        :
        null,

      pool.aliases.length
        ?
        `Confluence: ${pool.aliases.join(", ")}`
        :
        null

    ].filter(Boolean)

  };

}


/* ============================================================
   RAID STAGE
============================================================ */

function determineRaidStage({

  pool,

  price,

  distanceAtr,

  zoneLow,

  zoneHigh,

  raidStrength

}) {


  const swept =

    pool.side ===
    "HIGH"

      ?

      price >=
      pool.level

      :

      price <=
      pool.level;


  const beyondZone =

    pool.side ===
    "HIGH"

      ?

      price >
      zoneHigh

      :

      price <
      zoneLow;


  if (
    beyondZone
  ) {

    return "ACCEPTANCE BEYOND LIQUIDITY";

  }


  if (
    swept
  ) {

    return "RAID IN PROGRESS";

  }


  if (

    distanceAtr <=
    .20

    &&

    raidStrength >=
    75

  ) {

    return "RAID IMMINENT";

  }


  if (
    distanceAtr <=
    .50
  ) {

    return "APPROACHING";

  }


  if (
    distanceAtr <=
    1.25
  ) {

    return "TRACKING";

  }


  return "DORMANT";

}


/* ============================================================
   TRAP RADAR
============================================================ */

function buildTrapRadar({

  pools,

  sessions,

  flow,

  regime,

  atr15

}) {


  const rows =
    [];


  const primary =
    pools[0];


  if (
    primary
  ) {


    let score =
      primary.raidStrength;


    if (
      primary.distanceAtr <=
      .50
    ) {

      score +=
        8;

    }


    if (
      regime.volatility ===
      "EXPANDING"
    ) {

      score +=
        6;

    }


    if (
      flow.absorption !==
      "NONE"
    ) {

      score +=
        6;

    }


    score =
      clamp(
        score,
        0,
        100
      );


    rows.push({

      name:
        primary.name,

      stage:
        primary.stage,

      score:
        round(
          score,
          0
        ),

      risk:

        score >=
        80

          ?

          "EXTREME"

          :

          score >=
          65

            ?

            "ELEVATED"

            :

            "WATCH"

    });

  }


  for (
    const session of sessions
  ) {


    let score =
      0;


    if (
      session.phase ===
      "PRE-OPEN"
    ) {

      score +=
        45;

    }


    if (
      session.phase ===
      "OPENING LIQUIDITY WINDOW"
    ) {

      score +=
        75;

    }


    if (
      session.phase ===
      "CLOSING LIQUIDITY WINDOW"
    ) {

      score +=
        45;

    }


    if (
      score >
      0
    ) {

      rows.push({

        name:
          session.name,

        stage:
          session.phase,

        score,

        risk:

          score >=
          70

            ?

            "ELEVATED"

            :

            "WATCH"

      });

    }

  }


  return rows

    .sort(
      (
        a,
        b
      ) =>
        b.score -
        a.score
    )

    .slice(
      0,
      6
    );

}


/* ============================================================
   FRED MACRO
============================================================ */

const FRED_SERIES = [

  {

    id:
      "DGS2",

    name:
      "US 2Y Yield",

    direction:
      -1,

    weight:
      1.2

  },

  {

    id:
      "DGS10",

    name:
      "US 10Y Yield",

    direction:
      -1,

    weight:
      1.0

  },

  {

    id:
      "DFII10",

    name:
      "US 10Y Real Yield",

    direction:
      -1,

    weight:
      1.4

  },

  {

    id:
      "DTWEXBGS",

    name:
      "Broad USD Index",

    direction:
      -1,

    weight:
      1.4

  },

  {

    id:
      "FEDFUNDS",

    name:
      "Fed Funds Rate",

    direction:
      -1,

    weight:
      .7

  },

  {

    id:
      "CPIAUCSL",

    name:
      "US CPI",

    direction:
      1,

    weight:
      .7

  },

  {

    id:
      "PCEPILFE",

    name:
      "Core PCE",

    direction:
      1,

    weight:
      .8

  },

  {

    id:
      "UNRATE",

    name:
      "Unemployment",

    direction:
      1,

    weight:
      .6

  },

  {

    id:
      "PAYEMS",

    name:
      "Nonfarm Payrolls",

    direction:
      -1,

    weight:
      .7

  }

];


async function getMacroEngine() {


  if (
    !FRED_KEY
  ) {

    return {

      enabled:
        false,

      score:
        0,

      bias:
        "FRED DISABLED",

      drivers:
        []

    };

  }


  if (

    MACRO_CACHE.data

    &&

    Date.now() -
    MACRO_CACHE.time <
    MACRO_CACHE_MS

  ) {

    return MACRO_CACHE.data;

  }


  const results =
    await Promise.allSettled(

      FRED_SERIES.map(
        getFredSeries
      )

    );


  const drivers =
    results

      .filter(
        x =>
          x.status ===
          "fulfilled"
      )

      .map(
        x =>
          x.value
      );


  if (
    !drivers.length
  ) {

    return {

      enabled:
        false,

      score:
        0,

      bias:
        "FRED UNAVAILABLE",

      drivers:
        []

    };

  }


  let weighted =
    0;

  let totalWeight =
    0;


  for (
    const driver of drivers
  ) {

    weighted +=

      driver.goldPressure

      *
      driver.weight;


    totalWeight +=
      driver.weight;

  }


  const score =
    clamp(

      weighted /
      Math.max(
        totalWeight,
        .000001
      ),

      -100,

      100

    );


  const bias =

    score >=
    35

      ?

      "STRONGLY GOLD SUPPORTIVE"

      :

      score >=
      15

        ?

        "GOLD SUPPORTIVE"

        :

        score <=
        -35

          ?

          "STRONG GOLD HEADWIND"

          :

          score <=
          -15

            ?

            "GOLD HEADWIND"

            :

            "MIXED / NEUTRAL";


  const output = {

    enabled:
      true,

    score:
      round(
        score,
        1
      ),

    bias,

    coverage:
      round(

        drivers.length /
        FRED_SERIES.length *
        100,

        0

      ),

    drivers

  };


  MACRO_CACHE = {

    time:
      Date.now(),

    data:
      output

  };


  return output;

}


async function getFredSeries(
  config
) {


  const url =

    `${FRED_BASE}` +

    `?series_id=${config.id}` +

    `&api_key=${encodeURIComponent(
      FRED_KEY
    )}` +

    `&file_type=json` +

    `&sort_order=desc` +

    `&limit=8`;


  const response =
    await fetch(

      url,

      {
        cache:
          "no-store"
      }

    );


  if (
    !response.ok
  ) {

    throw new Error(
      `FRED ${config.id} unavailable`
    );

  }


  const json =
    await response.json();


  const observations =

    (
      json.observations ||
      []
    )

      .filter(
        x =>

          x.value !==
          "."

          &&

          Number.isFinite(
            Number(
              x.value
            )
          )
      );


  if (
    observations.length <
    2
  ) {

    throw new Error(
      `Not enough ${config.id} observations`
    );

  }


  const latest =
    observations[0];


  const previous =
    observations[1];


  const current =
    Number(
      latest.value
    );


  const old =
    Number(
      previous.value
    );


  const change =
    current -
    old;


  const pct =

    old

      ?

      change /
      Math.abs(
        old
      ) *
      100

      :

      0;


  const normalized =
    normalizeMacroChange(

      config.id,

      change,

      pct

    );


  const pressure =
    clamp(

      normalized *
      config.direction,

      -100,

      100

    );


  return {

    id:
      config.id,

    name:
      config.name,

    date:
      latest.date,

    value:
      current,

    change:
      round(
        change,
        4
      ),

    goldPressure:
      round(
        pressure,
        1
      ),

    weight:
      config.weight

  };

}


function normalizeMacroChange(
  id,
  raw,
  pct
) {


  switch (
    id
  ) {


    case "DGS2":
    case "DGS10":

      return clamp(

        raw /
        .05 *
        30,

        -100,

        100

      );


    case "DFII10":

      return clamp(

        raw /
        .04 *
        35,

        -100,

        100

      );


    case "DTWEXBGS":

      return clamp(

        pct /
        .25 *
        30,

        -100,

        100

      );


    case "FEDFUNDS":

      return clamp(

        raw /
        .25 *
        30,

        -100,

        100

      );


    default:

      return clamp(

        pct *
        25,

        -100,

        100

      );

  }

}


/* ============================================================
   CHART PAYLOAD
============================================================ */

function buildChartPayload({

  m1,

  m5,

  m15,

  h1,

  pools,

  sessions,

  reference,

  equalLevels,

  profile,

  vwap,

  price

}) {


  const formatBars =
    bars =>
      bars.map(
        bar => ({

          time:
            Math.floor(

              bar.time.getTime()

              /
              1000

            ),

          open:
            round(
              bar.open,
              3
            ),

          high:
            round(
              bar.high,
              3
            ),

          low:
            round(
              bar.low,
              3
            ),

          close:
            round(
              bar.close,
              3
            )

        })
      );


  const levels =
    pools.map(
      pool => ({

        name:
          pool.name,

        type:
          pool.type,

        side:
          pool.side,

        price:
          pool.level,

        liquidityStrength:
          pool.liquidityStrength,

        raidStrength:
          pool.raidStrength,

        combinedQuality:
          pool.combinedQuality,

        stage:
          pool.stage,

        likelyEnd:
          pool.projectedSweep
            ?.likelyEnd,

        zoneLow:
          pool.projectedSweep
            ?.zoneLow,

        zoneHigh:
          pool.projectedSweep
            ?.zoneHigh,

        acceptanceThreshold:
          pool.projectedSweep
            ?.acceptanceThreshold

      })
    );


  return {

    currentPrice:
      round(
        price,
        3
      ),

    candles: {

      m1:
        formatBars(
          m1.slice(-180)
        ),

      m5:
        formatBars(
          m5.slice(-240)
        ),

      m15:
        formatBars(
          m15.slice(-240)
        ),

      h1:
        formatBars(
          h1.slice(-200)
        )

    },

    levels,

    vwap:
      round(
        vwap.value,
        3
      ),

    poc:
      profile.poc,

    hvn:
      profile.hvn,

    lvn:
      profile.lvn,

    reference,

    equalLevels,

    sessions

  };

}


/* ============================================================
   WEEK KEY
============================================================ */

function weekKey(
  date
) {


  const copy =
    new Date(

      Date.UTC(

        date.getUTCFullYear(),

        date.getUTCMonth(),

        date.getUTCDate()

      )

    );


  const day =
    copy.getUTCDay() ||
    7;


  copy.setUTCDate(

    copy.getUTCDate()

    +
    4

    -
    day

  );


  const yearStart =
    new Date(

      Date.UTC(

        copy.getUTCFullYear(),

        0,

        1

      )

    );


  const week =
    Math.ceil(

      (

        (
          copy -
          yearStart
        )

        /
        86_400_000

        +
        1

      )

      /
      7

    );


  return (

    `${copy.getUTCFullYear()}-W` +

    `${pad(week)}`

  );

}


/* ============================================================
   HELPERS
============================================================ */

function sum(
  values
) {

  return values.reduce(

    (
      total,
      value
    ) =>

      total

      +

      (
        Number.isFinite(
          value
        )
          ?
          value
          :
          0
      ),

    0

  );

}


function percentile(
  values,
  q
) {


  const sorted =
    values

      .filter(
        Number.isFinite
      )

      .slice()

      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );


  if (
    !sorted.length
  ) {

    return null;

  }


  const position =

    (
      sorted.length -
      1
    )

    *
    q;


  const low =
    Math.floor(
      position
    );


  const high =
    Math.ceil(
      position
    );


  if (
    low ===
    high
  ) {

    return sorted[
      low
    ];

  }


  const weight =
    position -
    low;


  return (

    sorted[
      low
    ]

    *
    (
      1 -
      weight
    )

    +

    sorted[
      high
    ]

    *
    weight

  );

}


function median(
  values
) {

  return percentile(
    values,
    .5
  );

}


function lastFinite(
  values
) {


  for (
    let i =
      values.length -
      1;

    i >=
      0;

    i--
  ) {


    if (
      Number.isFinite(
        values[i]
      )
    ) {

      return values[i];

    }

  }


  return null;

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


function round(
  value,
  decimals = 2
) {


  if (
    !Number.isFinite(
      Number(
        value
      )
    )
  ) {

    return null;

  }


  const multiplier =
    10 **
    decimals;


  return (

    Math.round(

      Number(
        value
      )

      *
      multiplier

    )

    /
    multiplier

  );

}


function pad(
  value
) {

  return String(
    value
  )
    .padStart(
      2,
      "0"
    );

}


function minuteLabel(
  minute
) {

  return (

    `${pad(
      Math.floor(
        minute /
        60
      )
    )}:`

    +

    `${pad(
      minute %
      60
    )}`

  );

}