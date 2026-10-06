/* =========================================================
   MKAYFX XAU/USD LIQUIDITY INTELLIGENCE
   TWELVE DATA DUAL-KEY + FRED MACRO V2
   /api/xau.js

   ENVIRONMENT VARIABLES
   ---------------------
   TWELVE_DATA_API_KEY
   TWELVE_DATA_API_KEY_2
   FRED_API_KEY

   FEATURES
   --------
   ✓ Twelve Data XAU/USD
   ✓ automatic API-key failover
   ✓ M1 / M5 / M15 / H1 / H4
   ✓ sessions
   ✓ liquidity pools
   ✓ sweep projections
   ✓ footprint-style flow
   ✓ CVD / delta / absorption
   ✓ Asia sweep history
   ✓ FRED gold macro pressure
   ✓ yields
   ✓ real yields
   ✓ dollar pressure
   ✓ inflation
   ✓ Fed Funds
   ✓ unemployment
   ✓ payrolls
========================================================= */


/* =========================================================
   CONFIG
========================================================= */


const TD_KEYS = [

  String(
    process.env.TWELVE_DATA_API_KEY ||
    ""
  ).trim(),

  String(
    process.env.TWELVE_DATA_API_KEY_2 ||
    ""
  ).trim()

]
  .filter(
    Boolean
  );


const FRED_KEY =
  String(
    process.env.FRED_API_KEY ||
    ""
  ).trim();


const TD_BASE =
  "https://api.twelvedata.com/time_series";


const FRED_BASE =
  "https://api.stlouisfed.org/fred/series/observations";


const SYMBOL =
  "XAU/USD";


let ACTIVE_TD_KEY =
  0;


let CACHE = {

  at: 0,

  data: null

};


const CACHE_MS =
  60_000;


let IN_FLIGHT =
  null;


/* =========================================================
   MAIN
========================================================= */


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
    req.method === "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  if (
    req.method !== "GET"
  ) {

    return res
      .status(405)
      .json({

        ok: false,

        error:
          "GET only"

      });

  }


  if (
    TD_KEYS.length === 0
  ) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Missing TWELVE_DATA_API_KEY"

      });

  }


  try {


    if (

      CACHE.data

      &&

      Date.now() -
      CACHE.at <
      CACHE_MS

    ) {

      return res
        .status(200)
        .json({

          ...CACHE.data,

          cached:
            true,

          servedAt:
            new Date()
              .toISOString()

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
      buildAnalysis();


    const output =
      await IN_FLIGHT;


    IN_FLIGHT =
      null;


    CACHE = {

      at:
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
      "XAU ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok: false,

        provider:
          "Twelve Data + FRED",

        symbol:
          SYMBOL,

        error:
          error?.message ||
          "Unknown error"

      });

  }

}


/* =========================================================
   BUILD ANALYSIS
========================================================= */


async function buildAnalysis() {

  /*
     Fetch market data.

     We intentionally do these sequentially because the
     free Twelve Data allowance is limited and this makes
     failover behavior easier to control.
  */


  const m1Result =
    await fetchSeries(

      "1min",

      800

    );


  const m5Result =
    await fetchSeries(

      "5min",

      2500

    );


  const h1Result =
    await fetchSeries(

      "1h",

      800

    );


  const m1 =
    m1Result.bars;


  const m5 =
    m5Result.bars;


  const h1 =
    h1Result.bars;


  if (
    m1.length <
    100
  ) {

    throw new Error(
      `Only ${m1.length} M1 bars received`
    );

  }


  if (
    m5.length <
    150
  ) {

    throw new Error(
      `Only ${m5.length} M5 bars received`
    );

  }


  if (
    h1.length <
    50
  ) {

    throw new Error(
      `Only ${h1.length} H1 bars received`
    );

  }


  const m15 =
    resample(
      m5,
      15
    );


  const h4 =
    resample(
      h1,
      240
    );


  const latest =
    m1.at(-1);


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


  const sessions =
    buildSessions(
      m5
    );


  const refs =
    referenceLevels(
      h1
    );


  const equalLevels =
    detectEqualLevels(

      m15,

      atr15

    );


  const h1Swings =
    pivots(

      h1,

      3,

      180

    );


  const footprint =
    buildFootprint(

      m1,

      atr1 ||
      atr5 / 5

    );


  const vwap =
    buildVwap(
      m1
    );


  const profile =
    buildVolumeProfile(

      m1.slice(
        -500
      ),

      34

    );


  const sweepHistory =
    buildAsiaHistory(
      m5
    );


  const rawPools =
    buildPools({

      price,

      sessions,

      refs,

      equalLevels,

      h1Swings,

      atrH1

    });


  const pools =
    rawPools

      .map(
        pool =>
          enrichPool({

            pool,

            price,

            atr5,

            atr15,

            structure,

            sessions,

            footprint,

            sweepHistory,

            profile

          })
      )

      .sort(
        (
          a,
          b
        ) =>
          b.likelihoodScore -
          a.likelihoodScore
      )

      .slice(
        0,
        14
      );


  const traps =
    buildTrapWindows({

      sessions,

      pools,

      footprint,

      atr15

    });


  const regime =
    buildRegime({

      structure,

      m5,

      atr5,

      footprint

    });


  /*
     FRED failure should NOT stop the trading dashboard.

     If FRED has a temporary issue, the market-data side
     continues running.
  */


  const macro =
    await buildGoldMacro()
      .catch(
        error => ({

          enabled:
            false,

          score:
            0,

          bias:
            "MACRO DATA UNAVAILABLE",

          confidence:
            0,

          error:
            error.message,

          series:
            []

        })
      );


  const usedKeys = [

    m1Result.keySlot,

    m5Result.keySlot,

    h1Result.keySlot

  ];


  const uniqueKeys =
    [
      ...new Set(
        usedKeys
      )
    ];


  return {

    ok: true,


    symbol:
      "XAU/USD",


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

            latest.time
              .getTime()
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


    source: {

      provider:
        "Twelve Data",

      symbol:
        SYMBOL,

      keysAvailable:
        TD_KEYS.length,

      apiKeysUsed:
        uniqueKeys,

      primaryKeyActive:
        ACTIVE_TD_KEY ===
        0,

      failoverActive:
        uniqueKeys.includes(
          2
        ),

      m1Bars:
        m1.length,

      m5Bars:
        m5.length,

      m15Bars:
        m15.length,

      h1Bars:
        h1.length,

      h4Bars:
        h4.length

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

      vwapMode:
        vwap.mode,

      vwapDistance:
        round(
          price -
          vwap.value,
          3
        ),

      regime

    },


    structure,

    sessions,

    referenceLevels:
      refs,

    equalLevels,

    footprint,

    volumeProfile:
      profile,

    historicalSweeps:
      sweepHistory,

    liquidityPools:
      pools,

    trapWindows:
      traps,


    macro,


    warnings: [

      "FRED supplies macroeconomic data, not real-time breaking-news headlines.",

      "Gold macro pressure is an analytical score, not a guaranteed directional forecast.",

      "Liquidity scores are heuristic rankings.",

      "Footprint, delta and CVD are proxies derived from OHLC/activity data."

    ]

  };

}


/* =========================================================
   TWELVE DATA FAILOVER
========================================================= */


async function fetchSeries(
  interval,
  outputsize
) {

  let lastError =
    null;


  /*
     Start with whichever key is currently preferred.

     If key 1 recently hit quota, ACTIVE_TD_KEY becomes 1,
     so key 2 is attempted first on later requests.
  */


  const order = [];


  for (
    let offset = 0;
    offset <
      TD_KEYS.length;
    offset++
  ) {

    order.push(

      (
        ACTIVE_TD_KEY +
        offset
      )

      %

      TD_KEYS.length

    );

  }


  for (
    const keyIndex of order
  ) {

    const apiKey =
      TD_KEYS[
        keyIndex
      ];


    try {


      const result =
        await requestTdSeries({

          interval,

          outputsize,

          apiKey

        });


      /*
         Whichever key works becomes the preferred key.
      */


      ACTIVE_TD_KEY =
        keyIndex;


      return {

        bars:
          result,

        keySlot:
          keyIndex +
          1

      };


    } catch (
      error
    ) {


      lastError =
        error;


      /*
         Only fail over for quota/rate-limit problems.

         For a bad symbol or malformed request, changing keys
         would not fix anything.
      */


      if (
        !isQuotaError(
          error
        )
      ) {

        throw error;

      }


      console.warn(

        `Twelve Data API ${

          keyIndex +
          1

        } quota/rate limit reached. Trying next key.`

      );

    }

  }


  throw new Error(

    `Both Twelve Data API keys are unavailable or rate limited. ` +

    `${lastError?.message || ""}`

  );

}


/* =========================================================
   SINGLE TWELVE DATA REQUEST
========================================================= */


async function requestTdSeries({

  interval,

  outputsize,

  apiKey

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
      apiKey
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


  const raw =
    await response.text();


  let json;


  try {

    json =
      JSON.parse(
        raw
      );


  } catch {

    throw new Error(

      `Twelve Data HTTP ${response.status}: invalid JSON`

    );

  }


  if (
    response.status ===
    429
  ) {

    const error =
      new Error(

        json.message ||
        "Twelve Data rate limit reached"

      );


    error.quota =
      true;


    throw error;

  }


  if (
    !response.ok
  ) {

    throw new Error(

      `Twelve Data HTTP ${response.status}: ${

        json.message ||
        raw.slice(
          0,
          180
        )

      }`

    );

  }


  if (
    json.status ===
    "error"
  ) {

    const error =
      new Error(

        json.message ||
        "Twelve Data request failed"

      );


    if (
      looksLikeQuotaMessage(
        json.message
      )
    ) {

      error.quota =
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

      "Twelve Data response did not contain values"

    );

  }


  return json.values

    .map(
      row => ({

        time:
          parseTdDate(
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

        [
          bar.open,
          bar.high,
          bar.low,
          bar.close
        ]
          .every(
            Number.isFinite
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


function isQuotaError(
  error
) {

  return (

    error?.quota ===
    true

    ||

    looksLikeQuotaMessage(
      error?.message
    )

  );

}


function looksLikeQuotaMessage(
  text
) {

  const value =
    String(
      text ||
      ""
    )
      .toLowerCase();


  return (

    value.includes(
      "rate limit"
    )

    ||

    value.includes(
      "api credits"
    )

    ||

    value.includes(
      "credits"
    )

    ||

    value.includes(
      "quota"
    )

    ||

    value.includes(
      "too many requests"
    )

  );

}


/* =========================================================
   FRED GOLD MACRO ENGINE
========================================================= */


const GOLD_MACRO_SERIES = [

  {

    id:
      "DGS2",

    name:
      "US 2Y Treasury Yield",

    category:
      "RATES",

    goldDirection:
      -1,

    weight:
      1.15

  },


  {

    id:
      "DGS10",

    name:
      "US 10Y Treasury Yield",

    category:
      "RATES",

    goldDirection:
      -1,

    weight:
      1.00

  },


  {

    id:
      "DFII10",

    name:
      "US 10Y Real Yield",

    category:
      "REAL YIELDS",

    goldDirection:
      -1,

    weight:
      1.40

  },


  {

    id:
      "DTWEXBGS",

    name:
      "Broad US Dollar Index",

    category:
      "USD",

    goldDirection:
      -1,

    weight:
      1.35

  },


  {

    id:
      "FEDFUNDS",

    name:
      "Federal Funds Rate",

    category:
      "FED",

    goldDirection:
      -1,

    weight:
      0.70

  },


  {

    id:
      "CPIAUCSL",

    name:
      "US CPI",

    category:
      "INFLATION",

    goldDirection:
      1,

    weight:
      0.75

  },


  {

    id:
      "PCEPILFE",

    name:
      "Core PCE",

    category:
      "INFLATION",

    goldDirection:
      1,

    weight:
      0.85

  },


  {

    id:
      "UNRATE",

    name:
      "US Unemployment Rate",

    category:
      "LABOR",

    goldDirection:
      1,

    weight:
      0.65

  },


  {

    id:
      "PAYEMS",

    name:
      "US Nonfarm Payrolls",

    category:
      "LABOR",

    goldDirection:
      -1,

    weight:
      0.70

  }

];


/* =========================================================
   BUILD FRED SCORE
========================================================= */


async function buildGoldMacro() {

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

      confidence:
        0,

      note:
        "Add FRED_API_KEY",

      series:
        []

    };

  }


  const results =
    await Promise.allSettled(

      GOLD_MACRO_SERIES.map(
        definition =>
          fetchFredSeries(
            definition
          )
      )

    );


  const series =
    results

      .filter(
        result =>
          result.status ===
          "fulfilled"
      )

      .map(
        result =>
          result.value
      );


  if (
    !series.length
  ) {

    throw new Error(
      "FRED returned no usable macro series"
    );

  }


  let weightedScore =
    0;


  let weightTotal =
    0;


  for (
    const item of series
  ) {

    weightedScore +=

      item.goldPressure

      *

      item.weight;


    weightTotal +=
      item.weight;

  }


  const score =
    clamp(

      weightTotal

        ?

        weightedScore /
        weightTotal

        :

        0,

      -100,

      100

    );


  let bias =
    "NEUTRAL / MIXED";


  if (
    score >=
    35
  ) {

    bias =
      "STRONGLY GOLD SUPPORTIVE";

  }


  else if (
    score >=
    15
  ) {

    bias =
      "GOLD SUPPORTIVE";

  }


  else if (
    score <=
    -35
  ) {

    bias =
      "STRONG GOLD HEADWIND";

  }


  else if (
    score <=
    -15
  ) {

    bias =
      "GOLD HEADWIND";

  }


  const confidence =
    clamp(

      series.length /
      GOLD_MACRO_SERIES.length *
      100,

      0,

      100

    );


  const strongestSupport =
    [
      ...series
    ]
      .sort(
        (
          a,
          b
        ) =>
          b.goldPressure -
          a.goldPressure
      )
      .at(0);


  const strongestHeadwind =
    [
      ...series
    ]
      .sort(
        (
          a,
          b
        ) =>
          a.goldPressure -
          b.goldPressure
      )
      .at(0);


  return {

    enabled:
      true,


    score:
      round(
        score,
        1
      ),


    bias,


    confidence:
      round(
        confidence,
        0
      ),


    strongestSupport:

      strongestSupport

        ?

        {

          name:
            strongestSupport.name,

          pressure:
            strongestSupport.goldPressure

        }

        :

        null,


    strongestHeadwind:

      strongestHeadwind

        ?

        {

          name:
            strongestHeadwind.name,

          pressure:
            strongestHeadwind.goldPressure

        }

        :

        null,


    interpretation:
      buildMacroInterpretation(
        series,
        score
      ),


    series,


    note:
      "FRED macro data is slower-moving context and should not be treated as a live headline feed."

  };

}


/* =========================================================
   FRED SERIES
========================================================= */


async function fetchFredSeries(
  definition
) {

  const url =

    `${FRED_BASE}` +

    `?series_id=${encodeURIComponent(
      definition.id
    )}` +

    `&api_key=${encodeURIComponent(
      FRED_KEY
    )}` +

    `&file_type=json` +

    `&sort_order=desc` +

    `&limit=12`;


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


  if (
    !response.ok
  ) {

    throw new Error(

      `FRED ${definition.id} HTTP ${response.status}`

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
        observation =>

          observation.value !==
          "."

          &&

          Number.isFinite(
            Number(
              observation.value
            )
          )
      );


  if (
    observations.length <
    2
  ) {

    throw new Error(

      `Not enough FRED data for ${definition.id}`

    );

  }


  const latest =
    observations[0];


  const previous =
    observations[1];


  const currentValue =
    Number(
      latest.value
    );


  const previousValue =
    Number(
      previous.value
    );


  const rawChange =
    currentValue -
    previousValue;


  const percentChange =

    previousValue !==
    0

      ?

      rawChange /
      Math.abs(
        previousValue
      ) *
      100

      :

      0;


  /*
     Different macro series have very different numerical
     scales, so normalize their latest move.
  */


  const normalizedMove =
    normalizeMacroMove(

      definition.id,

      rawChange,

      percentChange

    );


  const goldPressure =
    clamp(

      normalizedMove

      *

      definition.goldDirection,

      -100,

      100

    );


  return {

    id:
      definition.id,

    name:
      definition.name,

    category:
      definition.category,

    weight:
      definition.weight,

    value:
      currentValue,

    previous:
      previousValue,

    change:
      round(
        rawChange,
        4
      ),

    percentChange:
      round(
        percentChange,
        3
      ),

    date:
      latest.date,

    previousDate:
      previous.date,

    goldPressure:
      round(
        goldPressure,
        1
      ),

    signal:

      goldPressure >=
      20

        ?

        "GOLD SUPPORTIVE"

        :

        goldPressure <=
        -20

          ?

          "GOLD NEGATIVE"

          :

          "NEUTRAL"

  };

}


/* =========================================================
   NORMALIZE FRED MOVES
========================================================= */


function normalizeMacroMove(
  id,
  raw,
  pct
) {

  switch (
    id
  ) {


    case "DGS2":

      return clamp(

        raw /
        0.05 *
        30,

        -100,

        100

      );


    case "DGS10":

      return clamp(

        raw /
        0.05 *
        28,

        -100,

        100

      );


    case "DFII10":

      return clamp(

        raw /
        0.04 *
        35,

        -100,

        100

      );


    case "DTWEXBGS":

      return clamp(

        pct /
        0.25 *
        30,

        -100,

        100

      );


    case "FEDFUNDS":

      return clamp(

        raw /
        0.25 *
        35,

        -100,

        100

      );


    case "CPIAUCSL":

      return clamp(

        pct /
        0.30 *
        25,

        -100,

        100

      );


    case "PCEPILFE":

      return clamp(

        pct /
        0.25 *
        25,

        -100,

        100

      );


    case "UNRATE":

      return clamp(

        raw /
        0.10 *
        25,

        -100,

        100

      );


    case "PAYEMS":

      return clamp(

        pct /
        0.15 *
        25,

        -100,

        100

      );


    default:

      return clamp(

        pct *
        20,

        -100,

        100

      );

  }

}


/* =========================================================
   MACRO EXPLANATION
========================================================= */


function buildMacroInterpretation(
  series,
  score
) {

  const realYield =
    series.find(
      item =>
        item.id ===
        "DFII10"
    );


  const dollar =
    series.find(
      item =>
        item.id ===
        "DTWEXBGS"
    );


  const yield2 =
    series.find(
      item =>
        item.id ===
        "DGS2"
    );


  const reasons =
    [];


  if (
    realYield
  ) {

    if (
      realYield.change <
      0
    ) {

      reasons.push(
        "Real yields are falling, which is generally supportive for gold."
      );

    }


    if (
      realYield.change >
      0
    ) {

      reasons.push(
        "Real yields are rising, creating a macro headwind for gold."
      );

    }

  }


  if (
    dollar
  ) {

    if (
      dollar.change <
      0
    ) {

      reasons.push(
        "The broad US dollar measure weakened in its latest observation."
      );

    }


    if (
      dollar.change >
      0
    ) {

      reasons.push(
        "The broad US dollar measure strengthened in its latest observation."
      );

    }

  }


  if (
    yield2
  ) {

    if (
      yield2.change <
      0
    ) {

      reasons.push(
        "The US 2-year yield declined, reducing some short-rate pressure on gold."
      );

    }


    if (
      yield2.change >
      0
    ) {

      reasons.push(
        "The US 2-year yield increased, adding short-rate pressure against gold."
      );

    }

  }


  if (
    score >=
    15
  ) {

    reasons.push(
      "Combined FRED pressure currently leans supportive for XAU/USD."
    );

  }


  else if (
    score <=
    -15
  ) {

    reasons.push(
      "Combined FRED pressure currently leans against XAU/USD."
    );

  }


  else {

    reasons.push(
      "The macro inputs are currently mixed."
    );

  }


  return reasons;

}


/* =========================================================
   RESAMPLE
========================================================= */


function resample(
  bars,
  minutes
) {

  const milliseconds =
    minutes *
    60_000;


  const map =
    new Map();


  for (
    const bar of bars
  ) {

    const key =

      Math.floor(

        bar.time.getTime() /
        milliseconds

      )

      *

      milliseconds;


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        {

          time:
            new Date(
              key
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
          key
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

  ]
    .sort(
      (
        a,
        b
      ) =>
        a.time -
        b.time
    );

}


/* =========================================================
   EMA
========================================================= */


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


  const result = [
    values[0]
  ];


  for (
    let i = 1;
    i <
      values.length;
    i++
  ) {

    result.push(

      values[i] *
      alpha

      +

      result[
        i - 1
      ]

      *

      (
        1 -
        alpha
      )

    );

  }


  return result;

}


/* =========================================================
   RSI
========================================================= */


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
      values[
        i - 1
      ];


    gains +=
      Math.max(
        change,
        0
      );


    losses +=
      Math.max(
        -change,
        0
      );

  }


  let avgGain =
    gains /
    period;


  let avgLoss =
    losses /
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


  return (

    100

    -

    100 /
    (
      1 +
      avgGain /
      avgLoss
    )

  );

}


/* =========================================================
   ATR
========================================================= */


function atrSeries(
  bars,
  period = 14
) {

  if (
    !bars.length
  ) {

    return [];

  }


  const ranges =
    [];


  for (
    let i = 0;
    i <
      bars.length;
    i++
  ) {

    if (
      i === 0
    ) {

      ranges.push(

        bars[i].high -
        bars[i].low

      );


      continue;

    }


    ranges.push(

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
    ranges,
    period
  );

}


/* =========================================================
   PIVOTS
========================================================= */


function pivots(
  bars,
  radius = 3,
  lookback = 180
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

    let high =
      true;


    let low =
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

        high =
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

        low =
          false;

      }

    }


    if (
      high
    ) {

      highs.push({

        price:
          bars[i].high,

        time:
          bars[i].time

      });

    }


    if (
      low
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


/* =========================================================
   STRUCTURE
========================================================= */


function marketStructure(
  bars
) {

  const swing =
    pivots(
      bars
    );


  const h1 =
    swing.highs.at(-1);


  const h2 =
    swing.highs.at(-2);


  const l1 =
    swing.lows.at(-1);


  const l2 =
    swing.lows.at(-2);


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


    if (

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
    bars.at(-1).close;


  let event =
    "NONE";


  if (
    h1 &&
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
    l1 &&
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


/* =========================================================
   TIMEFRAME STATE
========================================================= */


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
          closes.length -
          1
        )
      )

    );


  const rsi =
    rsiValue(
      closes
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

      18

      :

      -18;


  score +=

    lastFinite(
      e20
    ) >
    lastFinite(
      e50
    )

      ?

      22

      :

      -22;


  score +=

    lastFinite(
      e50
    ) >
    lastFinite(
      e200
    )

      ?

      18

      :

      -18;


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
      22;

  }


  if (
    structure.bias ===
    "BEARISH"
  ) {

    score -=
      22;

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

    rsi14:
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

    atr14:
      round(

        lastFinite(
          atrSeries(
            bars
          )
        ),

        3

      ),

    structure

  };

}


/* =========================================================
   SESSION DEFINITIONS
========================================================= */


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
      18 * 60

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
      17 * 60

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
      17 * 60

  }

];


/* =========================================================
   SESSION HELPERS
========================================================= */


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


  const object = {};


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


function dateKey(
  parts
) {

  return (

    `${parts.year}-` +

    `${pad(parts.month)}-` +

    `${pad(parts.day)}`

  );

}


function sessionOpen(
  date,
  session
) {

  const p =
    zoneParts(

      date,

      session.zone

    );


  const minute =
    p.hour *
    60 +
    p.minute;


  return (

    p.weekday >=
    1

    &&

    p.weekday <=
    5

    &&

    minute >=
    session.open

    &&

    minute <
    session.close

  );

}


function sessionPhase(
  date,
  session
) {

  const p =
    zoneParts(

      date,

      session.zone

    );


  const minute =
    p.hour *
    60 +
    p.minute;


  if (
    sessionOpen(
      date,
      session
    )
  ) {

    const elapsed =
      minute -
      session.open;


    if (
      elapsed <=
      90
    ) {

      return "OPENING LIQUIDITY WINDOW";

    }


    if (
      session.close -
      minute <=
      60
    ) {

      return "CLOSING WINDOW";

    }


    return "MID SESSION";

  }


  if (

    minute <
    session.open

    &&

    session.open -
    minute <=
    60

  ) {

    return "PRE-OPEN WINDOW";

  }


  return "CLOSED";

}


function nextTransition(
  now,
  session
) {

  let previous =
    sessionOpen(
      now,
      session
    );


  for (
    let i = 1;
    i <= 10080;
    i++
  ) {

    const future =
      new Date(

        now.getTime() +
        i *
        60_000

      );


    const current =
      sessionOpen(

        future,

        session

      );


    if (
      current !==
      previous
    ) {

      return {

        type:
          current
            ?
            "OPEN"
            :
            "CLOSE",

        time:
          future

      };

    }


    previous =
      current;

  }


  return {

    type:
      "UNKNOWN",

    time:
      new Date(

        now.getTime() +
        86_400_000

      )

  };

}


function sessionRange(
  bars,
  session
) {

  const groups =
    new Map();


  for (
    const bar of bars
  ) {

    const p =
      zoneParts(

        bar.time,

        session.zone

      );


    const minute =
      p.hour *
      60 +
      p.minute;


    if (

      minute <
      session.open

      ||

      minute >=
      session.close

    ) {

      continue;

    }


    const key =
      dateKey(
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

    range:
      round(
        high -
        low,
        3
      ),

    midpoint:
      round(
        (
          high +
          low
        ) /
        2,
        3
      )

  };

}


function buildSessions(
  bars
) {

  const now =
    new Date();


  return SESSION_DEFS.map(
    session => {

      const transition =
        nextTransition(

          now,

          session

        );


      return {

        id:
          session.id,

        name:
          session.name,

        short:
          session.short,

        zone:
          session.zone,

        active:
          sessionOpen(

            now,

            session

          ),

        phase:
          sessionPhase(

            now,

            session

          ),

        openLocal:
          minuteLabel(
            session.open
          ),

        closeLocal:
          minuteLabel(
            session.close
          ),

        nextEvent:
          transition.type,

        nextEventAt:
          transition.time
            .toISOString(),

        range:
          sessionRange(

            bars,

            session

          )

      };

    }
  );

}


/* =========================================================
   REFERENCES
========================================================= */


function referenceLevels(
  h1
) {

  const groups =
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


  const today =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );


  const completed =
    [
      ...groups.keys()
    ]

      .filter(
        key =>
          key <
          today
      )

      .sort();


  const previousKey =
    completed.at(-1);


  let previousDay =
    null;


  if (
    previousKey
  ) {

    const rows =
      groups.get(
        previousKey
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


    previousDay = {

      date:
        previousKey,

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
          ) /
          2,
          3
        )

    };

  }


  return {

    previousDay

  };

}


/* =========================================================
   EQUAL LEVELS
========================================================= */


function detectEqualLevels(
  bars,
  atr
) {

  const swing =
    pivots(

      bars,

      2,

      180

    );


  const tolerance =
    Math.max(

      (
        atr ||
        1
      )

      *
      0.12,

      0.1

    );


  return {

    highs:
      clusterLevels(

        swing.highs.map(
          item =>
            item.price
        ),

        tolerance

      ),

    lows:
      clusterLevels(

        swing.lows.map(
          item =>
            item.price
        ),

        tolerance

      )

  };

}


function clusterLevels(
  prices,
  tolerance
) {

  const groups =
    [];


  for (
    const price of prices
  ) {

    const existing =
      groups.find(

        group =>

          Math.abs(

            group.price -
            price

          )

          <=
          tolerance

      );


    if (
      !existing
    ) {

      groups.push({

        price,

        touches:
          1

      });


      continue;

    }


    existing.price =

      (
        existing.price *
        existing.touches

        +

        price

      )

      /

      (
        existing.touches +
        1
      );


    existing.touches++;

  }


  return groups

    .filter(
      group =>
        group.touches >=
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
      5
    );

}


/* =========================================================
   FOOTPRINT PROXY
========================================================= */


function buildFootprint(
  bars,
  atr
) {

  const recent =
    bars.slice(
      -180
    );


  const realVolume =
    recent.filter(
      bar =>
        bar.volume >
        0
    ).length >=
    recent.length *
    0.5;


  const ranges =
    recent.map(
      bar =>
        Math.max(
          bar.high -
          bar.low,
          0.000001
        )
    );


  const medianRange =
    median(
      ranges
    )

    ||

    atr

    ||

    1;


  const rows =
    recent.map(
      bar => {

        const range =
          Math.max(
            bar.high -
            bar.low,
            0.000001
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

          realVolume

            ?

            Math.max(
              bar.volume,
              1
            )

            :

            clamp(

              range /
              medianRange,

              0.2,

              5

            )

            *
            100;


        const buyShare =
          clamp(

            0.5

            +

            closeLocation *
            0.3

            +

            body *
            0.2,

            0.05,

            0.95

          );


        const buy =
          activity *
          buyShare;


        const sell =
          activity -
          buy;


        return {

          price:
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


  return {

    mode:

      realVolume

        ?

        "Twelve Data OHLCV Delta Proxy"

        :

        "Price-Action Activity Proxy",

    hasProviderVolume:
      realVolume,

    last5:
      aggregateFlow(
        rows.slice(-5)
      ),

    last15:
      aggregateFlow(
        rows.slice(-15)
      ),

    last30:
      aggregateFlow(
        rows.slice(-30)
      ),

    last60:
      aggregateFlow(
        rows.slice(-60)
      ),

    cvd:
      round(
        cvd,
        1
      ),

    divergence:
      flowDivergence(
        rows
      ),

    absorption:
      "PROXY"

  };

}


function aggregateFlow(
  rows
) {

  const activity =
    sum(
      rows.map(
        row =>
          row.activity
      )
    );


  const delta =
    sum(
      rows.map(
        row =>
          row.delta
      )
    );


  return {

    activity:
      round(
        activity,
        1
      ),

    delta:
      round(
        delta,
        1
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


function flowDivergence(
  rows
) {

  if (
    rows.length <
    40
  ) {

    return "NONE";

  }


  const older =
    rows.slice(
      -40,
      -20
    );


  const newer =
    rows.slice(
      -20
    );


  const priceMove =

    newer.at(-1).price -
    older.at(-1).price;


  const delta =
    sum(
      newer.map(
        row =>
          row.delta
      )
    );


  if (
    priceMove >
    0 &&
    delta <
    0
  ) {

    return "PRICE UP / DELTA DOWN";

  }


  if (
    priceMove <
    0 &&
    delta >
    0
  ) {

    return "PRICE DOWN / DELTA UP";

  }


  return "NONE";

}


/* =========================================================
   VWAP
========================================================= */


function buildVwap(
  bars
) {

  const recent =
    bars.slice(
      -500
    );


  const useVolume =
    recent.filter(
      bar =>
        bar.volume >
        0
    ).length >=
    recent.length *
    0.5;


  const medianRange =
    median(

      recent.map(
        bar =>
          bar.high -
          bar.low
      )

    )

    ||

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

      useVolume

        ?

        Math.max(
          bar.volume,
          1
        )

        :

        Math.max(

          0.2,

          (
            bar.high -
            bar.low
          )

          /
          medianRange

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
        recent.at(-1).close,

    mode:
      useVolume
        ?
        "Volume weighted"
        :
        "Activity weighted"

  };

}


/* =========================================================
   VOLUME PROFILE
========================================================= */


function buildVolumeProfile(
  bars,
  bins
) {

  const low =
    Math.min(
      ...bars.map(
        bar =>
          bar.low
      )
    );


  const high =
    Math.max(
      ...bars.map(
        bar =>
          bar.high
      )
    );


  const step =
    (
      high -
      low
    ) /
    bins ||
    1;


  const profile =
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
          low +
          (
            index +
            0.5
          ) *
          step,

        value:
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
      ) /
      3;


    const index =
      clamp(

        Math.floor(
          (
            typical -
            low
          ) /
          step
        ),

        0,

        bins -
        1

      );


    profile[
      index
    ].value +=
      bar.volume >
      0
        ?
        bar.volume
        :
        1;

  }


  const descending =
    [
      ...profile
    ]
      .sort(
        (
          a,
          b
        ) =>
          b.value -
          a.value
      );


  const ascending =
    [
      ...profile
    ]
      .filter(
        item =>
          item.value >
          0
      )
      .sort(
        (
          a,
          b
        ) =>
          a.value -
          b.value
      );


  return {

    mode:
      "Twelve Data Activity Profile",

    poc:
      round(
        descending[0]
          ?.price,
        3
      ),

    hvn:
      descending
        .slice(
          0,
          3
        )
        .map(
          item =>
            round(
              item.price,
              3
            )
        ),

    lvn:
      ascending
        .slice(
          0,
          3
        )
        .map(
          item =>
            round(
              item.price,
              3
            )
        )

  };

}


/* =========================================================
   ASIA HISTORY
========================================================= */


function buildAsiaHistory(
  m5
) {

  const groups =
    new Map();


  for (
    const bar of m5
  ) {

    const p =
      zoneParts(

        bar.time,

        "Asia/Tokyo"

      );


    const key =
      dateKey(
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


  const highEvents =
    [];


  const lowEvents =
    [];


  let eligible =
    0;


  for (
    const rows of
    groups.values()
  ) {

    const asia =
      [];


    const after =
      [];


    for (
      const bar of rows
    ) {

      const p =
        zoneParts(

          bar.time,

          "Asia/Tokyo"

        );


      const minute =
        p.hour *
        60 +
        p.minute;


      if (
        minute >=
        9 * 60

        &&

        minute <
        18 * 60
      ) {

        asia.push(
          bar
        );

      }


      if (
        minute >=
        18 * 60
      ) {

        after.push(
          bar
        );

      }

    }


    if (
      asia.length <
      40 ||
      after.length <
      8
    ) {

      continue;

    }


    eligible++;


    const high =
      Math.max(
        ...asia.map(
          bar =>
            bar.high
        )
      );


    const low =
      Math.min(
        ...asia.map(
          bar =>
            bar.low
        )
      );


    const atr =
      lastFinite(
        atrSeries(
          asia
        )
      )

      ||

      1;


    const highSweep =
      analyzeSweep(

        after,

        high,

        "HIGH",

        atr

      );


    const lowSweep =
      analyzeSweep(

        after,

        low,

        "LOW",

        atr

      );


    if (
      highSweep
    ) {

      highEvents.push(
        highSweep
      );

    }


    if (
      lowSweep
    ) {

      lowEvents.push(
        lowSweep
      );

    }

  }


  return {

    lookbackDays:
      eligible,

    asiaHigh:
      summarizeSweepData(
        highEvents,
        eligible
      ),

    asiaLow:
      summarizeSweepData(
        lowEvents,
        eligible
      )

  };

}


function analyzeSweep(
  bars,
  level,
  side,
  atr
) {

  const index =
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
    index <
    0
  ) {

    return null;

  }


  const sample =
    bars.slice(
      index,
      index +
      20
    );


  let extension =
    0;


  let reversed =
    false;


  for (
    let i = 0;
    i <
      sample.length;
    i++
  ) {

    extension =
      Math.max(

        extension,

        side ===
        "HIGH"

          ?

          sample[i].high -
          level

          :

          level -
          sample[i].low

      );


    if (
      i >
      0
    ) {

      const inside =
        side ===
        "HIGH"

          ?

          sample[i].close <
          level

          :

          sample[i].close >
          level;


      if (
        inside
      ) {

        reversed =
          true;

        break;

      }

    }

  }


  return {

    overshoot:
      extension,

    overshootAtr:
      extension /
      Math.max(
        atr,
        0.000001
      ),

    reversed

  };

}


function summarizeSweepData(
  events,
  eligible
) {

  const values =
    events.map(
      event =>
        event.overshootAtr
    );


  return {

    sweeps:
      events.length,

    sweepRatePct:
      round(
        eligible
          ?
          events.length /
          eligible *
          100
          :
          0,
        1
      ),

    reversalRatePct:
      round(
        events.length
          ?
          events.filter(
            event =>
              event.reversed
          ).length /
          events.length *
          100
          :
          0,
        1
      ),

    p25OvershootAtr:
      round(
        percentile(
          values,
          0.25
        ) ?? 0.08,
        3
      ),

    medianOvershootAtr:
      round(
        percentile(
          values,
          0.5
        ) ?? 0.18,
        3
      ),

    p75OvershootAtr:
      round(
        percentile(
          values,
          0.75
        ) ?? 0.35,
        3
      )

  };

}


/* =========================================================
   LIQUIDITY POOLS
========================================================= */


function buildPools({

  price,

  sessions,

  refs,

  equalLevels,

  h1Swings,

  atrH1

}) {

  const pools =
    [];


  const add = (
    name,
    level,
    side,
    type,
    importance
  ) => {

    if (
      Number.isFinite(
        level
      )
    ) {

      pools.push({

        name,

        level,

        side,

        type,

        importance,

        aliases:
          []

      });

    }

  };


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

        1.35

        :

        1.20

    );


    add(

      `${session.short} Low`,

      session.range.low,

      "LOW",

      `${session.id.toUpperCase()}_LOW`,

      session.id ===
      "asia"

        ?

        1.35

        :

        1.20

    );

  }


  if (
    refs.previousDay
  ) {

    add(

      "Previous Day High",

      refs.previousDay.high,

      "HIGH",

      "PDH",

      1.45

    );


    add(

      "Previous Day Low",

      refs.previousDay.low,

      "LOW",

      "PDL",

      1.45

    );

  }


  for (
    const item of
    equalLevels.highs
  ) {

    add(

      `Equal Highs (${item.touches}x)`,

      item.price,

      "HIGH",

      "EQH",

      1.30

    );

  }


  for (
    const item of
    equalLevels.lows
  ) {

    add(

      `Equal Lows (${item.touches}x)`,

      item.price,

      "LOW",

      "EQL",

      1.30

    );

  }


  for (
    const item of
    h1Swings.highs
      .slice(
        -3
      )
  ) {

    add(

      "H1 Swing High",

      item.price,

      "HIGH",

      "H1_HIGH",

      1

    );

  }


  for (
    const item of
    h1Swings.lows
      .slice(
        -3
      )
  ) {

    add(

      "H1 Swing Low",

      item.price,

      "LOW",

      "H1_LOW",

      1

    );

  }


  const maximumDistance =
    (
      atrH1 ||
      10
    ) *
    6;


  return pools.filter(

    pool =>
      Math.abs(
        pool.level -
        price
      )
      <=
      maximumDistance

  );

}


/* =========================================================
   POOL RANKING
========================================================= */


function enrichPool({

  pool,

  price,

  atr5,

  atr15,

  structure,

  sessions,

  footprint,

  sweepHistory,

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
    distance /
    Math.max(
      atr15,
      0.000001
    );


  const trend =

    structure.m5.score *
    0.20

    +

    structure.m15.score *
    0.35

    +

    structure.h1.score *
    0.30

    +

    structure.h4.score *
    0.15;


  const delta =
    footprint.last15
      ?.deltaPct

    ||

    0;


  const opening =
    sessions.find(

      session =>
        session.phase ===
        "OPENING LIQUIDITY WINDOW"

    );


  let score =

    16

    +

    36 *
    Math.exp(
      -distanceAtr /
      1.3
    )

    +

    18 *
    pool.importance

    +

    clamp(
      direction *
      trend /
      6,
      -14,
      14
    )

    +

    clamp(
      direction *
      delta /
      3,
      -10,
      10
    );


  if (
    opening
  ) {

    score +=
      opening.id ===
      "asia"
        ?
        6
        :
        12;

  }


  const correctSide =
    pool.side ===
    "HIGH"

      ?

      pool.level >=
      price

      :

      pool.level <=
      price;


  if (
    !correctSide
  ) {

    score -=
      24;

  }


  score =
    clamp(
      score,
      5,
      95
    );


  let history =
    null;


  if (
    pool.type ===
    "ASIA_HIGH"
  ) {

    history =
      sweepHistory.asiaHigh;

  }


  if (
    pool.type ===
    "ASIA_LOW"
  ) {

    history =
      sweepHistory.asiaLow;

  }


  let p25 =
    history
      ?.p25OvershootAtr
    ?? 0.08;


  let medianOvershoot =
    history
      ?.medianOvershootAtr
    ?? 0.18;


  let p75 =
    history
      ?.p75OvershootAtr
    ?? 0.35;


  if (
    direction *
    delta >
    18
  ) {

    medianOvershoot *=
      1.2;


    p75 *=
      1.3;

  }


  const zone1 =
    pool.level

    +

    direction *
    p25 *
    atr5;


  const likelyEnd =
    pool.level

    +

    direction *
    medianOvershoot *
    atr5;


  const zone2 =
    pool.level

    +

    direction *
    p75 *
    atr5;


  const zoneLow =
    Math.min(
      zone1,
      zone2
    );


  const zoneHigh =
    Math.max(
      zone1,
      zone2
    );


  let raidStyle =
    "SHALLOW RAID";


  if (
    medianOvershoot <
    0.10
  ) {

    raidStyle =
      "LEVEL TAG / VERY SHALLOW";

  }


  if (
    medianOvershoot >
    0.30
  ) {

    raidStyle =
      "DEEP RAID POSSIBLE";

  }


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

    likelihoodScore:
      round(
        score,
        1
      ),

    likelihood:
      score >=
      75

        ?

        "HIGH"

        :

        score >=
        58

          ?

          "MEDIUM"

          :

          "LOW",

    raidStyle,

    projectedSweep: {

      target:
        round(
          pool.level,
          3
        ),

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

      overshoot:
        round(
          Math.abs(
            likelyEnd -
            pool.level
          ),
          3
        ),

      overshootAtr:
        round(
          medianOvershoot,
          3
        ),

      historicalBasis:
        history
          ?
          `${history.sweeps} observed Asia sweeps`
          :
          "ATR + structure + flow model"

    },

    reasons: [

      `${round(
        distanceAtr,
        2
      )}× M15 ATR from price`,

      `15m delta proxy ${round(
        delta,
        1
      )}%`,

      opening
        ?
        `${opening.name} opening window active`
        :
        null,

      profile.poc
        ?
        `POC ${profile.poc}`
        :
        null

    ]
      .filter(
        Boolean
      )

  };

}


/* =========================================================
   TRAPS
========================================================= */


function buildTrapWindows({

  sessions,

  pools,

  footprint,

  atr15

}) {

  const output =
    [];


  for (
    const session of sessions
  ) {

    let score =
      0;


    const reasons =
      [];


    if (
      session.phase ===
      "PRE-OPEN WINDOW"
    ) {

      score +=
        session.id ===
        "asia"
          ?
          40
          :
          62;


      reasons.push(
        `${session.name} opens soon`
      );

    }


    if (
      session.phase ===
      "OPENING LIQUIDITY WINDOW"
    ) {

      score +=
        session.id ===
        "asia"
          ?
          55
          :
          78;


      reasons.push(
        `${session.name} opening liquidity window`
      );

    }


    const nearby =
      pools.filter(

        pool =>
          pool.distance <=
          atr15 *
          0.75

      );


    if (
      nearby.length
    ) {

      score +=
        Math.min(
          20,
          nearby.length *
          5
        );


      reasons.push(
        `${nearby.length} nearby liquidity pools`
      );

    }


    if (
      score >
      0
    ) {

      output.push({

        session:
          session.name,

        phase:
          session.phase,

        score:
          round(
            clamp(
              score,
              0,
              95
            ),
            1
          ),

        risk:
          score >=
          75
            ?
            "ELEVATED"
            :
            score >=
            55
              ?
              "WATCH"
              :
              "NORMAL",

        reasons

      });

    }

  }


  if (
    pools[0]
  ) {

    output.push({

      session:
        "Primary liquidity magnet",

      phase:
        pools[0].name,

      score:
        pools[0].likelihoodScore,

      risk:
        pools[0].likelihood,

      reasons: [

        `Target ${pools[0].level}`,

        `Projected end ${pools[0].projectedSweep.likelyEnd}`

      ]

    });

  }


  return output

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
      7
    );

}


/* =========================================================
   REGIME
========================================================= */


function buildRegime({

  structure,

  m5,

  atr5,

  footprint

}) {

  const biases = [

    structure.m5.bias,

    structure.m15.bias,

    structure.h1.bias,

    structure.h4.bias

  ];


  const bulls =
    biases.filter(
      value =>
        value ===
        "BULLISH"
    ).length;


  const bears =
    biases.filter(
      value =>
        value ===
        "BEARISH"
    ).length;


  const trend =
    bulls >=
    3

      ?

      "BULLISH"

      :

      bears >=
      3

        ?

        "BEARISH"

        :

        "MIXED";


  const baseline =
    median(
      atrSeries(
        m5
      )
    )

    ||

    atr5;


  const ratio =
    atr5 /
    Math.max(
      baseline,
      0.000001
    );


  const volatility =
    ratio >
    1.3

      ?

      "EXPANDING"

      :

      ratio <
      0.75

        ?

        "COMPRESSED"

        :

        "NORMAL";


  const delta =
    footprint.last15
      ?.deltaPct
    ||
    0;


  const orderFlow =
    delta >
    18

      ?

      "BUY DOMINANT"

      :

      delta <
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
        ratio,
        2
      ),

    label:
      `${trend} / ${volatility} / ${orderFlow}`

  };

}


/* =========================================================
   DATE PARSER
========================================================= */


function parseTdDate(
  value
) {

  if (
    !value
  ) {

    return new Date(
      NaN
    );

  }


  return new Date(

    value.includes(
      "T"
    )

      ?

      (
        value.endsWith(
          "Z"
        )

          ?

          value

          :

          `${value}Z`
      )

      :

      `${value.replace(
        " ",
        "T"
      )}Z`

  );

}


/* =========================================================
   HELPERS
========================================================= */


function lastFinite(
  values
) {

  for (
    let i =
      values.length -
      1;

    i >= 0;

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


function mean(
  values
) {

  return values.length
    ?
    sum(
      values
    ) /
    values.length
    :
    0;

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
    ) *
    q;


  const lower =
    Math.floor(
      position
    );


  const upper =
    Math.ceil(
      position
    );


  if (
    lower ===
    upper
  ) {

    return sorted[
      lower
    ];

  }


  const weight =
    position -
    lower;


  return (

    sorted[
      lower
    ] *
    (
      1 -
      weight
    )

    +

    sorted[
      upper
    ] *
    weight

  );

}


function median(
  values
) {

  return percentile(
    values,
    0.5
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


function round(
  value,
  decimals = 2
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return null;

  }


  const multiplier =
    10 **
    decimals;


  return (

    Math.round(
      value *
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
  minutes
) {

  return (

    `${pad(
      Math.floor(
        minutes /
        60
      )
    )}:`

    +

    `${pad(
      minutes %
      60
    )}`

  );

}