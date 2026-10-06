/* =========================================================
   MKAYFX XAU/USD LIQUIDITY INTELLIGENCE
   TWELVE DATA EDITION V1
   /api/xau.js

   SYMBOL
   ------
   XAU/USD

   DATA SOURCE
   -----------
   Twelve Data

   FEATURES
   --------
   - Live XAU/USD price
   - Asia / London / New York sessions
   - Session open / close countdown
   - Asia High / Low
   - London High / Low
   - New York High / Low
   - Previous Day High / Low
   - Previous Week High / Low
   - Equal Highs / Equal Lows
   - H1 swing liquidity
   - M1 / M5 / M15 / H1 / H4 structure
   - EMA 20 / 50 / 200
   - RSI
   - ATR
   - BOS / CHOCH
   - Footprint-style activity proxy
   - Delta proxy
   - CVD proxy
   - Absorption
   - Delta divergence
   - Volume / activity profile
   - Historical Asia sweep behavior
   - Estimated sweep depth
   - Liquidity ranking
   - Trap-window radar

   ENVIRONMENT
   -----------
   TWELVE_DATA_API_KEY
========================================================= */


const API_KEY =
  String(
    process.env.TWELVE_DATA_API_KEY ||
    ""
  ).trim();


const BASE =
  "https://api.twelvedata.com/time_series";


const SYMBOL =
  "XAU/USD";


/* =========================================================
   CACHE
========================================================= */


let CACHE = {

  timestamp: 0,

  data: null

};


const CACHE_MS =
  60_000;


let IN_FLIGHT =
  null;


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
      18 * 60,

    importance:
      1.15

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
      1.40

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
      1.45

  }

];


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
    !API_KEY
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


    /* =====================================================
       CACHE
    ===================================================== */


    if (

      CACHE.data

      &&

      Date.now() -
      CACHE.timestamp <
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

      const result =
        await IN_FLIGHT;


      return res
        .status(200)
        .json({

          ...result,

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


    CACHE = {

      timestamp:
        Date.now(),

      data:
        output

    };


    IN_FLIGHT =
      null;


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
      "XAU API ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        provider:
          "Twelve Data",

        symbol:
          SYMBOL,

        error:
          error?.message ||
          "Unknown XAU/USD engine error"

      });

  }

}


/* =========================================================
   BUILD ANALYSIS
========================================================= */


async function buildAnalysis() {


  /*
     Three requests.

     M1:
     microstructure + current price

     M5:
     sessions + sweep history

     H1:
     longer-term liquidity
  */


  const [
    m1,
    m5,
    h1
  ] =
    await Promise.all([

      fetchSeries(
        "1min",
        1000
      ),

      fetchSeries(
        "5min",
        3000
      ),

      fetchSeries(
        "1h",
        1000
      )

    ]);


  if (
    m1.length <
    100
  ) {

    throw new Error(

      `Not enough M1 data: ${m1.length}`

    );

  }


  if (
    m5.length <
    150
  ) {

    throw new Error(

      `Not enough M5 data: ${m5.length}`

    );

  }


  if (
    h1.length <
    80
  ) {

    throw new Error(

      `Not enough H1 data: ${h1.length}`

    );

  }


  /* =====================================================
     DERIVED TIMEFRAMES
  ===================================================== */


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


  const now =
    new Date();


  const latest =
    m1.at(-1);


  const price =
    latest.close;


  /* =====================================================
     ATR
  ===================================================== */


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


  /* =====================================================
     MTF STRUCTURE
  ===================================================== */


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


  /* =====================================================
     SESSION ENGINE
  ===================================================== */


  const sessions =
    buildSessions(
      m5,
      now
    );


  /* =====================================================
     DAY / WEEK LEVELS
  ===================================================== */


  const reference =
    referenceLevels(
      h1
    );


  /* =====================================================
     EQUAL H/L
  ===================================================== */


  const equalLevels =
    detectEqualLevels(

      m15,

      atr15

    );


  /* =====================================================
     H1 SWINGS
  ===================================================== */


  const h1Swings =
    pivots(

      h1,

      3,

      180

    );


  /* =====================================================
     FLOW
  ===================================================== */


  const footprint =
    buildFootprint(

      m1,

      atr1 ||
      atr5 / 5

    );


  /* =====================================================
     VWAP
  ===================================================== */


  const vwap =
    buildVwap(
      m1
    );


  /* =====================================================
     PROFILE
  ===================================================== */


  const profile =
    buildVolumeProfile(

      m1.slice(
        -500
      ),

      34

    );


  /* =====================================================
     HISTORICAL ASIA SWEEPS
  ===================================================== */


  const asiaHistory =
    buildAsiaHistory(
      m5
    );


  /* =====================================================
     LIQUIDITY POOLS
  ===================================================== */


  const rawPools =
    buildPools({

      price,

      sessions,

      reference,

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

            asiaHistory,

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


  /* =====================================================
     TRAP WINDOWS
  ===================================================== */


  const traps =
    buildTrapWindows({

      sessions,

      pools,

      footprint,

      atr15

    });


  /* =====================================================
     REGIME
  ===================================================== */


  const regime =
    buildRegime({

      structure,

      m5,

      atr5,

      footprint

    });


  /* =====================================================
     RESPONSE
  ===================================================== */


  return {

    ok:
      true,


    symbol:
      "XAU/USD",


    providerSymbol:
      SYMBOL,


    generatedAt:
      now.toISOString(),


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

      timezone:
        "UTC",

      m1Bars:
        m1.length,

      m5Bars:
        m5.length,

      m15Bars:
        m15.length,

      h1Bars:
        h1.length,

      h4Bars:
        h4.length,

      trueBidAskFootprint:
        false

    },


    sessions,


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


    referenceLevels:
      reference,


    equalLevels,


    footprint,


    volumeProfile:
      profile,


    historicalSweeps:
      asiaHistory,


    liquidityPools:
      pools,


    trapWindows:
      traps,


    warnings: [

      "Liquidity scores are heuristic rankings, not guaranteed probabilities.",

      "Projected sweep-end zones are estimates based on ATR, historical behavior and current structure.",

      "Spot XAU/USD does not provide a centralized exchange footprint through ordinary OHLC data.",

      "Delta, CVD and footprint values shown here are activity/order-flow proxies."

    ]

  };

}


/* =========================================================
   TWELVE DATA FETCH
========================================================= */


async function fetchSeries(
  interval,
  outputsize
) {

  const url =

    `${BASE}` +

    `?symbol=${encodeURIComponent(
      SYMBOL
    )}` +

    `&interval=${encodeURIComponent(
      interval
    )}` +

    `&outputsize=${outputsize}` +

    `&timezone=UTC` +

    `&format=JSON` +

    `&apikey=${encodeURIComponent(
      API_KEY
    )}`;


  const response =
    await fetch(

      url,

      {

        headers: {

          Accept:
            "application/json"

        },

        cache:
          "no-store"

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

      `Twelve Data returned invalid JSON: ${raw.slice(0,200)}`

    );

  }


  if (
    !response.ok
  ) {

    throw new Error(

      `Twelve Data HTTP ${response.status}: ` +

      `${raw.slice(0,200)}`

    );

  }


  if (

    json.status ===
    "error"

    ||

    !Array.isArray(
      json.values
    )

  ) {

    throw new Error(

      `Twelve Data: ${

        json.message ||
        "time_series request failed"

      }`

    );

  }


  const bars =
    json.values

      .map(
        row => ({

          time:
            parseTdTime(
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


  return bars;

}


/* =========================================================
   PARSE TWELVE DATA UTC
========================================================= */


function parseTdTime(
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
      value.endsWith("Z")
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


  const groups =
    new Map();


  for (
    const bar of bars
  ) {

    const key =

      Math.floor(

        bar.time.getTime()

        /

        milliseconds

      )

      *

      milliseconds;


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
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
        groups.get(
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

    ...groups.values()

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


  const output = [
    values[0]
  ];


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    output.push(

      values[i] *
      alpha

      +

      output[
        i - 1
      ]

      *

      (
        1 -
        alpha
      )

    );

  }


  return output;

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

      values[i]

      -

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


  let averageGain =
    gains /
    period;


  let averageLoss =
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

      values[i]

      -

      values[
        i - 1
      ];


    averageGain =

      (
        averageGain *
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


    averageLoss =

      (
        averageLoss *
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
    averageLoss ===
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
      averageGain /
      averageLoss
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


  const tr =
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


  const latestHigh =
    swing.highs.at(-1);


  const previousHigh =
    swing.highs.at(-2);


  const latestLow =
    swing.lows.at(-1);


  const previousLow =
    swing.lows.at(-2);


  let bias =
    "NEUTRAL";


  if (

    latestHigh &&
    previousHigh &&
    latestLow &&
    previousLow

  ) {

    if (

      latestHigh.price >
      previousHigh.price

      &&

      latestLow.price >
      previousLow.price

    ) {

      bias =
        "BULLISH";

    }


    if (

      latestHigh.price <
      previousHigh.price

      &&

      latestLow.price <
      previousLow.price

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

    latestHigh

    &&

    close >
    latestHigh.price

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

    latestLow

    &&

    close <
    latestLow.price

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

      latestHigh

        ?

        round(
          latestHigh.price,
          3
        )

        :

        null,


    swingLow:

      latestLow

        ?

        round(
          latestLow.price,
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


  const ema20 =
    emaSeries(
      closes,
      20
    );


  const ema50 =
    emaSeries(
      closes,
      50
    );


  const ema200 =
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


  const structure =
    marketStructure(
      bars
    );


  const rsi =
    rsiValue(
      closes,
      14
    );


  let score =
    0;


  score +=

    closes.at(-1) >
    lastFinite(
      ema20
    )

      ?

      18

      :

      -18;


  score +=

    lastFinite(
      ema20
    )

    >

    lastFinite(
      ema50
    )

      ?

      22

      :

      -22;


  score +=

    lastFinite(
      ema50
    )

    >

    lastFinite(
      ema200
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
          ema20
        ),
        3
      ),


    ema50:
      round(
        lastFinite(
          ema50
        ),
        3
      ),


    ema200:
      round(
        lastFinite(
          ema200
        ),
        3
      ),


    atr14:
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


/* =========================================================
   TIMEZONE PARTS
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


function timeInZone(
  date,
  timezone
) {

  return new Intl.DateTimeFormat(

    "en-ZA",

    {

      timeZone:
        timezone,

      hour:
        "2-digit",

      minute:
        "2-digit",

      second:
        "2-digit",

      hourCycle:
        "h23"

    }

  )
    .format(
      date
    );

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


/* =========================================================
   SESSION RANGE
========================================================= */


function sessionRange(
  bars,
  definition
) {

  const groups =
    new Map();


  for (
    const bar of bars
  ) {

    const parts =
      zoneParts(

        bar.time,

        definition.zone

      );


    const minute =

      parts.hour *
      60

      +

      parts.minute;


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
      dateKey(
        parts
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


  const keys =
    [
      ...groups.keys()
    ]
      .sort();


  const key =
    keys.at(-1);


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


/* =========================================================
   SESSION STATE
========================================================= */


function sessionOpen(
  date,
  definition
) {

  const parts =
    zoneParts(

      date,

      definition.zone

    );


  const minute =

    parts.hour *
    60

    +

    parts.minute;


  return (

    parts.weekday >=
    1

    &&

    parts.weekday <=
    5

    &&

    minute >=
    definition.open

    &&

    minute <
    definition.close

  );

}


/* =========================================================
   SESSION PHASE
========================================================= */


function sessionPhase(
  date,
  definition
) {

  const parts =
    zoneParts(

      date,

      definition.zone

    );


  const minute =

    parts.hour *
    60

    +

    parts.minute;


  if (
    sessionOpen(
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

      return "CLOSING WINDOW";

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

    return "PRE-OPEN WINDOW";

  }


  return "CLOSED";

}


/* =========================================================
   NEXT SESSION TRANSITION
========================================================= */


function nextSessionTransition(
  now,
  definition
) {

  let previous =
    sessionOpen(
      now,
      definition
    );


  for (
    let offset = 1;
    offset <= 10080;
    offset++
  ) {

    const future =
      new Date(

        now.getTime()

        +

        offset *
        60_000

      );


    const current =
      sessionOpen(

        future,

        definition

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


/* =========================================================
   BUILD SESSIONS
========================================================= */


function buildSessions(
  m5,
  now
) {

  return SESSION_DEFS.map(
    definition => {

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

        active:
          sessionOpen(

            now,

            definition

          ),

        phase:
          sessionPhase(

            now,

            definition

          ),

        localTime:
          timeInZone(

            now,

            definition.zone

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

        range:
          sessionRange(

            m5,

            definition

          )

      };

    }
  );

}


/* =========================================================
   REFERENCE LEVELS
========================================================= */


function referenceLevels(
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


    previousWeek = {

      week:
        previousWeekKey,

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


  return {

    previousDay,

    previousWeek

  };

}


/* =========================================================
   EQUAL HIGHS / LOWS
========================================================= */


function detectEqualLevels(
  bars,
  atrValue
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
        atrValue ||
        1
      )

      *

      0.12,

      0.10

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
  values,
  tolerance
) {

  const groups =
    [];


  for (
    const value of values
  ) {

    const existing =
      groups.find(

        group =>

          Math.abs(

            group.price -
            value

          )

          <=

          tolerance

      );


    if (
      !existing
    ) {

      groups.push({

        price:
          value,

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

        value

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
    )

    .map(
      group => ({

        price:
          round(
            group.price,
            3
          ),

        touches:
          group.touches

      })
    );

}


/* =========================================================
   FOOTPRINT-STYLE FLOW
========================================================= */


function buildFootprint(
  bars,
  atrValue
) {

  const recent =
    bars.slice(
      -180
    );


  const usableVolume =

    recent.filter(

      bar =>
        bar.volume >
        0

    ).length

    >=

    recent.length *
    0.5;


  const medianRange =
    median(

      recent.map(

        bar =>
          Math.max(

            bar.high -
            bar.low,

            0.000001

          )

      )

    )

    ||

    atrValue

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

          usableVolume

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
            0.30

            +

            body *
            0.20,

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

      usableVolume

        ?

        "Twelve Data OHLCV Delta Proxy"

        :

        "Price-Action Activity Proxy",

    hasProviderVolume:
      usableVolume,

    trueBidAskFootprint:
      false,

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
      detectAbsorption(
        recent,
        rows
      )

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

    newer.at(-1).price

    -

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
    0

    &&

    delta <
    0

  ) {

    return "PRICE UP / DELTA DOWN";

  }


  if (

    priceMove <
    0

    &&

    delta >
    0

  ) {

    return "PRICE DOWN / DELTA UP";

  }


  return "NONE";

}


function detectAbsorption(
  bars,
  rows
) {

  const recentBars =
    bars.slice(
      -30
    );


  const recentRows =
    rows.slice(
      -30
    );


  const activityMedian =
    median(

      recentRows.map(
        row =>
          row.activity
      )

    )

    ||

    1;


  let upper =
    0;


  let lower =
    0;


  for (
    let i = 0;
    i <
      recentBars.length;
    i++
  ) {

    const bar =
      recentBars[i];


    const flow =
      recentRows[i];


    const range =
      Math.max(

        bar.high -
        bar.low,

        0.000001

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

      flow.activity >
      activityMedian *
      1.35

      &&

      flow.delta >
      0

      &&

      upperWick /
      range >
      0.45

    ) {

      upper++;

    }


    if (

      flow.activity >
      activityMedian *
      1.35

      &&

      flow.delta <
      0

      &&

      lowerWick /
      range >
      0.45

    ) {

      lower++;

    }

  }


  if (
    upper >=
    2
  ) {

    return "BUYING ABSORBED / BULL-TRAP RISK";

  }


  if (
    lower >=
    2
  ) {

    return "SELLING ABSORBED / BEAR-TRAP RISK";

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


  const hasVolume =

    recent.filter(
      bar =>
        bar.volume >
        0
    ).length

    >=

    recent.length *
    0.5;


  let numerator =
    0;


  let denominator =
    0;


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

    1;


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

      hasVolume

        ?

        "Volume weighted"

        :

        "Activity weighted"

  };

}


/* =========================================================
   PROFILE
========================================================= */


function buildVolumeProfile(
  bars,
  bins
) {

  if (
    !bars.length
  ) {

    return {

      mode:
        "Unavailable",

      poc:
        null,

      hvn:
        [],

      lvn:
        []

    };

  }


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
    )

    /

    bins

    ||

    1;


  const hasVolume =

    bars.filter(
      bar =>
        bar.volume >
        0
    ).length

    >=

    bars.length *
    0.5;


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

          low

          +

          (
            index +
            0.5
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


    profile[
      index
    ].activity +=

      hasVolume

        ?

        Math.max(
          bar.volume,
          1
        )

        :

        1;

  }


  const highest =
    [
      ...profile
    ]
      .sort(
        (
          a,
          b
        ) =>
          b.activity -
          a.activity
      );


  const lowest =
    [
      ...profile
    ]
      .filter(
        row =>
          row.activity >
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

    mode:

      hasVolume

        ?

        "Volume Profile Proxy"

        :

        "Price Activity Profile",

    poc:
      round(
        highest[0]
          ?.price,
        3
      ),

    hvn:
      highest

        .slice(
          0,
          3
        )

        .map(
          row =>
            round(
              row.price,
              3
            )
        ),

    lvn:
      lowest

        .slice(
          0,
          3
        )

        .map(
          row =>
            round(
              row.price,
              3
            )
        )

  };

}


/* =========================================================
   ASIA SWEEP HISTORY
========================================================= */


function buildAsiaHistory(
  m5
) {

  const grouped =
    new Map();


  for (
    const bar of m5
  ) {

    const parts =
      zoneParts(

        bar.time,

        "Asia/Tokyo"

      );


    const key =
      dateKey(
        parts
      );


    if (
      !grouped.has(
        key
      )
    ) {

      grouped.set(
        key,
        []
      );

    }


    grouped
      .get(
        key
      )
      .push(
        bar
      );

  }


  const highs =
    [];


  const lows =
    [];


  let eligible =
    0;


  for (
    const [
      key,
      bars
    ] of grouped
  ) {

    const asia =
      [];


    const after =
      [];


    for (
      const bar of bars
    ) {

      const parts =
        zoneParts(

          bar.time,

          "Asia/Tokyo"

        );


      const minute =

        parts.hour *
        60

        +

        parts.minute;


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
      40

      ||

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


    const localAtr =

      lastFinite(
        atrSeries(
          asia,
          14
        )
      )

      ||

      mean(

        asia.map(
          bar =>
            bar.high -
            bar.low
        )

      );


    const highSweep =
      analyzeSweep(

        after,

        high,

        "HIGH",

        localAtr

      );


    const lowSweep =
      analyzeSweep(

        after,

        low,

        "LOW",

        localAtr

      );


    if (
      highSweep
    ) {

      highs.push(
        highSweep
      );

    }


    if (
      lowSweep
    ) {

      lows.push(
        lowSweep
      );

    }

  }


  return {

    lookbackDays:
      eligible,

    asiaHigh:
      summarizeSweepData(

        highs,

        eligible

      ),

    asiaLow:
      summarizeSweepData(

        lows,

        eligible

      )

  };

}


function analyzeSweep(
  bars,
  level,
  side,
  atrValue
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


  let maximumExtension =
    0;


  let reversed =
    false;


  let reversalBars =
    null;


  for (
    let i = 0;
    i <
      sample.length;
    i++
  ) {

    const extension =

      side ===
      "HIGH"

        ?

        sample[i].high -
        level

        :

        level -
        sample[i].low;


    maximumExtension =
      Math.max(

        maximumExtension,

        extension

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


        reversalBars =
          i;


        break;

      }

    }

  }


  return {

    overshoot:
      maximumExtension,

    overshootAtr:

      maximumExtension

      /

      Math.max(
        atrValue,
        0.000001
      ),

    reversed,

    reversalBars

  };

}


function summarizeSweepData(
  events,
  eligible
) {

  const overshoots =
    events

      .map(
        event =>
          event.overshootAtr
      )

      .filter(
        Number.isFinite
      );


  const reversals =
    events.filter(
      event =>
        event.reversed
    ).length;


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

          reversals /
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
          0.25
        )

        ??

        0.08,

        3

      ),

    medianOvershootAtr:
      round(

        percentile(
          overshoots,
          0.50
        )

        ??

        0.18,

        3

      ),

    p75OvershootAtr:
      round(

        percentile(
          overshoots,
          0.75
        )

        ??

        0.35,

        3

      )

  };

}


/* =========================================================
   BUILD LIQUIDITY POOLS
========================================================= */


function buildPools({

  price,

  sessions,

  reference,

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
      !Number.isFinite(
        level
      )
    ) {

      return;

    }


    pools.push({

      name,

      level,

      side,

      type,

      importance

    });

  };


  for (
    const session of sessions
  ) {

    if (
      !session.range
    ) {

      continue;

    }


    const importance =

      session.id ===
      "asia"

        ?

        1.35

        :

        session.id ===
        "london"

          ?

          1.25

          :

          1.20;


    add(

      `${session.short} High`,

      session.range.high,

      "HIGH",

      `${session.id.toUpperCase()}_HIGH`,

      importance

    );


    add(

      `${session.short} Low`,

      session.range.low,

      "LOW",

      `${session.id.toUpperCase()}_LOW`,

      importance

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

      1.45

    );


    add(

      "Previous Day Low",

      reference.previousDay.low,

      "LOW",

      "PDL",

      1.45

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

      1.55

    );


    add(

      "Previous Week Low",

      reference.previousWeek.low,

      "LOW",

      "PWL",

      1.55

    );

  }


  for (
    const level of
    equalLevels.highs
  ) {

    add(

      `Equal Highs (${level.touches}x)`,

      level.price,

      "HIGH",

      "EQH",

      1.30

    );

  }


  for (
    const level of
    equalLevels.lows
  ) {

    add(

      `Equal Lows (${level.touches}x)`,

      level.price,

      "LOW",

      "EQL",

      1.30

    );

  }


  for (
    const swing of
    h1Swings.highs
      .slice(-3)
  ) {

    add(

      "H1 Swing High",

      swing.price,

      "HIGH",

      "H1_HIGH",

      1

    );

  }


  for (
    const swing of
    h1Swings.lows
      .slice(-3)
  ) {

    add(

      "H1 Swing Low",

      swing.price,

      "LOW",

      "H1_LOW",

      1

    );

  }


  const maxDistance =

    (
      atrH1 ||
      10
    )

    *

    6;


  return mergePools(

    pools.filter(

      pool =>
        Math.abs(
          pool.level -
          price
        )

        <=
        maxDistance

    ),

    Math.max(

      (
        atrH1 ||
        1
      )

      *

      0.05,

      0.10

    )

  );

}


/* =========================================================
   MERGE NEARBY POOLS
========================================================= */


function mergePools(
  pools,
  tolerance
) {

  const output =
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
      output.find(

        candidate =>

          candidate.side ===
          pool.side

          &&

          Math.abs(

            candidate.level -
            pool.level

          )

          <=
          tolerance

      );


    if (
      !existing
    ) {

      output.push({

        ...pool,

        aliases:
          []

      });


      continue;

    }


    existing.aliases.push(
      pool.name
    );


    if (
      pool.importance >
      existing.importance
    ) {

      existing.name =
        pool.name;


      existing.type =
        pool.type;


      existing.importance =
        pool.importance;

    }


    existing.level =

      (
        existing.level +
        pool.level
      )

      /

      2;

  }


  return output;

}


/* =========================================================
   ENRICH LIQUIDITY POOL
========================================================= */


function enrichPool({

  pool,

  price,

  atr5,

  atr15,

  structure,

  sessions,

  footprint,

  asiaHistory,

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


  const openingSession =
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
    openingSession
  ) {

    score +=

      openingSession.id ===
      "asia"

        ?

        6

        :

        12;

  }


  const validDirection =

    pool.side ===
    "HIGH"

      ?

      pool.level >=
      price

      :

      pool.level <=
      price;


  if (
    !validDirection
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


  /* =====================================================
     SWEEP DEPTH
  ===================================================== */


  let history =
    null;


  if (
    pool.type ===
    "ASIA_HIGH"
  ) {

    history =
      asiaHistory.asiaHigh;

  }


  if (
    pool.type ===
    "ASIA_LOW"
  ) {

    history =
      asiaHistory.asiaLow;

  }


  let p25 =

    history
      ?.p25OvershootAtr

    ??

    0.08;


  let medianOvershoot =

    history
      ?.medianOvershootAtr

    ??

    0.18;


  let p75 =

    history
      ?.p75OvershootAtr

    ??

    0.35;


  if (

    direction *
    delta >
    18

  ) {

    medianOvershoot *=
      1.20;


    p75 *=
      1.30;

  }


  if (

    pool.side ===
    "HIGH"

    &&

    footprint.absorption.includes(
      "BUYING"
    )

  ) {

    medianOvershoot *=
      0.72;


    p75 *=
      0.82;

  }


  if (

    pool.side ===
    "LOW"

    &&

    footprint.absorption.includes(
      "SELLING"
    )

  ) {

    medianOvershoot *=
      0.72;


    p75 *=
      0.82;

  }


  const firstZone =

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


  const lastZone =

    pool.level

    +

    direction *
    p75 *
    atr5;


  const zoneLow =
    Math.min(

      firstZone,

      lastZone

    );


  const zoneHigh =
    Math.max(

      firstZone,

      lastZone

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


  const nodes = [

    profile.poc,

    ...(
      profile.hvn ||
      []
    ),

    ...(
      profile.lvn ||
      []
    )

  ];


  const confluence =
    nodes

      .filter(

        node =>

          Number.isFinite(
            node
          )

          &&

          node >=
          zoneLow -
          atr5 *
          0.10

          &&

          node <=
          zoneHigh +
          atr5 *
          0.10

      )

      .map(

        node =>
          `Profile node ${round(
            node,
            2
          )}`

      );


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

      `Liquidity importance ${round(
        pool.importance,
        2
      )}×`,

      `15m Delta proxy ${round(
        delta,
        1
      )}%`,

      openingSession

        ?

        `${openingSession.name} opening window active`

        :

        null,

      ...confluence

    ]
      .filter(
        Boolean
      )

  };

}


/* =========================================================
   TRAP WINDOWS
========================================================= */


function buildTrapWindows({

  sessions,

  pools,

  footprint,

  atr15

}) {

  const result =
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

        `${session.name} approaching open`

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


    if (
      session.phase ===
      "CLOSING WINDOW"
    ) {

      score +=
        35;


      reasons.push(

        `${session.name} closing window`

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

        `${nearby.length} liquidity pools near price`

      );

    }


    if (
      footprint.absorption !==
      "NONE"
    ) {

      score +=
        8;


      reasons.push(
        footprint.absorption
      );

    }


    if (
      score >
      0
    ) {

      result.push({

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

    result.push({

      session:
        "Primary liquidity magnet",

      phase:
        pools[0].name,

      score:
        pools[0].likelihoodScore,

      risk:
        pools[0].likelihood,

      reasons: [

        `Projected sweep end ${pools[0].projectedSweep.likelyEnd}`,

        `Target level ${pools[0].level}`

      ]

    });

  }


  return result

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


  const bullish =
    biases.filter(
      value =>
        value ===
        "BULLISH"
    ).length;


  const bearish =
    biases.filter(
      value =>
        value ===
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


  const atrValues =
    atrSeries(
      m5,
      14
    );


  const baseline =
    median(
      atrValues
    )

    ||

    atr5;


  const expansion =

    atr5

    /

    Math.max(
      baseline,
      0.000001
    );


  const volatility =

    expansion >
    1.30

      ?

      "EXPANDING"

      :

      expansion <
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
        expansion,
        2
      ),

    label:

      `${trend} / ` +

      `${volatility} / ` +

      `${orderFlow}`

  };

}


/* =========================================================
   WEEK KEY
========================================================= */


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


/* =========================================================
   HELPERS
========================================================= */


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
    0.50
  );

}


function lastFinite(
  values
) {

  for (
    let i =
      values.length - 1;
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