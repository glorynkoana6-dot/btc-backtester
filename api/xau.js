/* =========================================================
   MKAYFX XAU LIQUIDITY INTELLIGENCE
   ALLTICK EDITION V1
   /api/xau.js

   SYMBOL
   ------
   XAUUSD

   DATA SOURCE
   -----------
   AllTick

   PURPOSE
   -------
   XAU/USD intelligence — NOT forced BUY / SELL signals.

   CORE FEATURES
   -------------
   ✓ Current XAU/USD price
   ✓ Asia / London / New York sessions
   ✓ Session open / close countdown
   ✓ Session highs / lows
   ✓ Previous day high / low
   ✓ Previous week high / low
   ✓ Equal highs / equal lows
   ✓ M15 / H1 swing liquidity
   ✓ M5 / M15 / H1 / H4 structure
   ✓ BOS / CHOCH
   ✓ ATR
   ✓ RSI
   ✓ EMA structure
   ✓ VWAP / activity VWAP
   ✓ Volume / footprint-style proxy
   ✓ Estimated Delta
   ✓ CVD
   ✓ Absorption
   ✓ Delta divergence
   ✓ Liquidity magnet ranking
   ✓ Asia sweep history
   ✓ Estimated sweep probability
   ✓ Sweep overshoot estimation
   ✓ Reversal-watch zone
   ✓ Trap / sweep windows
   ✓ Volume profile POC / HVN / LVN
   ✓ Optional FRED macro context

   IMPORTANT
   ---------
   AllTick spot-metal candle volume does NOT necessarily
   represent centralized exchange volume.

   Therefore "footprint" remains a proxy unless true
   bid/ask aggressor transaction data is available.

   ENVIRONMENT VARIABLES
   ---------------------
   ALLTICK_API_TOKEN

   ALLTICK_REQUEST_GAP_MS
      Free plan: 10500
      Basic+:    1100

   FRED_API_KEY
      optional
========================================================= */


const ALLTICK_TOKEN =
  process.env.ALLTICK_API_TOKEN;


const FRED_KEY =
  process.env.FRED_API_KEY || "";


const REQUEST_GAP =
  Number(
    process.env.ALLTICK_REQUEST_GAP_MS ||
    1100
  );


const SYMBOL =
  "XAUUSD";


const ALLTICK_BASE =
  "https://quote.alltick.co/quote-b-api";


const FRED_BASE =
  "https://api.stlouisfed.org/fred/series/observations";


/* =========================================================
   CACHE
========================================================= */


let CACHE = {

  timestamp: 0,

  payload: null

};


const CACHE_MS =
  55 * 1000;


/* =========================================================
   K-LINE TYPES

   AllTick:

   1  = 1 minute
   2  = 5 minute
   3  = 15 minute
   4  = 30 minute
   5  = 1 hour
   6  = 2 hour
   7  = 4 hour
   8  = daily
========================================================= */


const KLINE = {

  M1: 1,

  M5: 2,

  M15: 3,

  M30: 4,

  H1: 5,

  H2: 6,

  H4: 7,

  D1: 8

};


/* =========================================================
   SESSION DEFINITIONS
========================================================= */


const SESSION_DEFS = [

  {

    id:
      "tokyo",

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
   API
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
    !ALLTICK_TOKEN
  ) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Missing ALLTICK_API_TOKEN in Vercel environment variables."

      });

  }


  try {


    /* =====================================================
       CACHE
    ===================================================== */


    if (

      CACHE.payload &&

      Date.now() -
      CACHE.timestamp <
      CACHE_MS

    ) {

      return res
        .status(200)
        .json({

          ...CACHE.payload,

          cached:
            true,

          servedAt:
            new Date()
              .toISOString()

        });

    }


    /* =====================================================
       DATA REQUESTS

       AllTick single-product K-line maximum = 500 candles.

       M1:
       Microstructure / footprint / live context

       M5:
       Session structure and liquidity

       H1:
       Longer-range swing + weekly context
    ===================================================== */


    const m1 =
      await fetchAllTickKline(

        KLINE.M1,

        500

      );


    await requestGap();


    const m5 =
      await fetchAllTickKline(

        KLINE.M5,

        500

      );


    await requestGap();


    const h1 =
      await fetchAllTickKline(

        KLINE.H1,

        500

      );


    if (
      m1.length < 100
    ) {

      throw new Error(
        `Only ${m1.length} M1 bars received from AllTick.`
      );

    }


    if (
      m5.length < 100
    ) {

      throw new Error(
        `Only ${m5.length} M5 bars received from AllTick.`
      );

    }


    if (
      h1.length < 50
    ) {

      throw new Error(
        `Only ${h1.length} H1 bars received from AllTick.`
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


    const last =
      m1[
        m1.length - 1
      ];


    const price =
      last.close;


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
       TIMEFRAME STRUCTURE
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
       SESSIONS
    ===================================================== */


    const sessions =
      buildSessions(
        m5
      );


    /* =====================================================
       PREVIOUS DAY / WEEK
    ===================================================== */


    const dayLevels =
      buildReferenceLevels(
        h1,
        price
      );


    /* =====================================================
       SWING LIQUIDITY
    ===================================================== */


    const swingLevels =
      detectSwingLevels(

        h1,

        3,

        140

      );


    const equalLevels =
      detectEqualLevels(

        m15,

        atr15 ||
        atr5

      );


    /* =====================================================
       FAIR VALUE GAPS
    ===================================================== */


    const fvgs =
      detectFvgs(

        m15,

        price,

        100

      );


    /* =====================================================
       FOOTPRINT STYLE ANALYSIS
    ===================================================== */


    const footprint =
      buildFootprint(

        m1,

        atr1 ||
        (
          atr5 /
          4
        )

      );


    /* =====================================================
       VWAP
    ===================================================== */


    const vwap =
      calculateVwap(
        m1
      );


    /* =====================================================
       VOLUME PROFILE
    ===================================================== */


    const volumeProfile =
      buildVolumeProfile(

        m1.slice(
          -360
        ),

        30

      );


    /* =====================================================
       HISTORICAL ASIA SWEEPS
    ===================================================== */


    const sweepHistory =
      studyAsiaSweeps(
        m5
      );


    /* =====================================================
       LIQUIDITY POOLS
    ===================================================== */


    const rawPools =
      createLiquidityPools({

        price,

        sessions,

        dayLevels,

        equalLevels,

        swingLevels,

        atrH1:
          atrH1 ||
          atr15

      });


    /* =====================================================
       LIQUIDITY RANKING + SWEEP PROJECTION
    ===================================================== */


    const pools =
      rawPools

        .map(

          pool =>

            enrichLiquidityPool({

              pool,

              price,

              atr5,

              atr15,

              structure,

              sessions,

              footprint,

              sweepHistory,

              volumeProfile,

              m1

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


    const trapWindows =
      buildTrapWindows({

        sessions,

        pools,

        price,

        atr15,

        footprint

      });


    /* =====================================================
       MARKET REGIME
    ===================================================== */


    const regime =
      buildRegime({

        structure,

        m5,

        atr5,

        footprint

      });


    /* =====================================================
       MACRO
    ===================================================== */


    const macro =
      await fetchMacro()
        .catch(

          error => ({

            enabled:
              false,

            bias:
              "UNAVAILABLE",

            score:
              0,

            note:
              error.message,

            series:
              []

          })

        );


    /* =====================================================
       RESPONSE
    ===================================================== */


    const payload = {

      ok:
        true,


      symbol:
        "XAU/USD",


      providerSymbol:
        SYMBOL,


      generatedAt:
        new Date()
          .toISOString(),


      latestBarTime:
        last.time
          .toISOString(),


      dataAgeSeconds:
        Math.max(

          0,

          Math.floor(

            (
              Date.now() -
              last.time.getTime()
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
          "AllTick",

        endpoint:
          "quote-b-api/kline",

        symbol:
          SYMBOL,

        m1Bars:
          m1.length,

        m5Bars:
          m5.length,

        h1Bars:
          h1.length,

        footprint:
          footprint.mode,

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

      dayLevels,

      equalLevels,

      swingLevels,

      fvgs,

      footprint,

      volumeProfile,

      sweepHistory,

      liquidityPools:
        pools,

      trapWindows,

      macro,


      warnings: [

        "Liquidity likelihood is a ranking model, not a guaranteed probability.",

        "Projected sweep-end zones are estimated from historical overshoot behaviour, ATR and current pressure.",

        "AllTick spot XAUUSD volume may not represent centralized exchange volume.",

        "Footprint / Delta / CVD values are therefore proxies unless true aggressor bid/ask volume is available."

      ]

    };


    CACHE = {

      timestamp:
        Date.now(),

      payload

    };


    return res
      .status(200)
      .json(
        payload
      );


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

        provider:
          "AllTick",

        error:
          error?.message ||
          "Unknown XAU engine error"

      });

  }

}


/* =========================================================
   ALLTICK KLINE
========================================================= */


async function fetchAllTickKline(
  type,
  number
) {

  const query = {

    trace:
      makeTrace(),

    data: {

      code:
        SYMBOL,

      kline_type:
        type,

      kline_timestamp_end:
        0,

      query_kline_num:
        Math.min(
          500,
          number
        ),

      adjust_type:
        0

    }

  };


  const url =
    new URL(

      `${ALLTICK_BASE}/kline`

    );


  url.searchParams.set(
    "token",
    ALLTICK_TOKEN
  );


  url.searchParams.set(

    "query",

    JSON.stringify(
      query
    )

  );


  const response =
    await fetch(

      url.toString(),

      {

        method:
          "GET",

        headers: {

          Accept:
            "application/json"

        },

        cache:
          "no-store"

      }

    );


  if (
    !response.ok
  ) {

    throw new Error(

      `AllTick HTTP ${response.status}`

    );

  }


  const json =
    await response.json();


  if (
    Number(
      json.ret
    ) !==
    200
  ) {

    throw new Error(

      `AllTick: ${
        json.msg ||
        "request failed"
      }`

    );

  }


  const list =
    json?.data?.kline_list;


  if (
    !Array.isArray(
      list
    )
  ) {

    throw new Error(

      "AllTick response did not contain kline_list."

    );

  }


  return list

    .map(

      candle => ({

        time:
          new Date(

            Number(
              candle.timestamp
            )

            *

            1000

          ),

        open:
          Number(
            candle.open_price
          ),

        high:
          Number(
            candle.high_price
          ),

        low:
          Number(
            candle.low_price
          ),

        close:
          Number(
            candle.close_price
          ),

        volume:
          Number(
            candle.volume
          )
          ||
          0,

        turnover:
          Number(
            candle.turnover
          )
          ||
          0

      })

    )

    .filter(

      candle =>

        Number.isFinite(
          candle.time.getTime()
        )

        &&

        Number.isFinite(
          candle.open
        )

        &&

        Number.isFinite(
          candle.high
        )

        &&

        Number.isFinite(
          candle.low
        )

        &&

        Number.isFinite(
          candle.close
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


/* =========================================================
   REQUEST GAP

   Needed because AllTick rate limits depend on plan.
========================================================= */


async function requestGap() {

  if (
    REQUEST_GAP <= 0
  ) {

    return;

  }


  await new Promise(

    resolve =>
      setTimeout(
        resolve,
        REQUEST_GAP
      )

  );

}


/* =========================================================
   TRACE
========================================================= */


function makeTrace() {

  return (

    "mkayfx-" +

    Date.now() +

    "-" +

    Math.random()
      .toString(36)
      .slice(
        2,
        10
      )

  );

}


/* =========================================================
   RESAMPLE
========================================================= */


function resample(
  bars,
  minutes
) {

  const ms =
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
        ms

      )

      *

      ms;


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
            bar.volume,

          turnover:
            bar.turnover

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


      current.turnover +=
        bar.turnover;

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
   TIMEFRAME STATE
========================================================= */


function timeframeState(
  bars
) {

  const closes =
    bars.map(
      b =>
        b.close
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


  const rs =
    rsiValue(
      closes,
      14
    );


  const atr =
    lastFinite(
      atrSeries(
        bars,
        14
      )
    );


  const structure =
    detectStructure(
      bars
    );


  const last =
    closes[
      closes.length - 1
    ];


  let score =
    0;


  if (
    last >
    lastFinite(
      e20
    )
  ) {

    score +=
      20;

  } else {

    score -=
      20;

  }


  if (

    lastFinite(
      e20
    )

    >

    lastFinite(
      e50
    )

  ) {

    score +=
      22;

  } else {

    score -=
      22;

  }


  if (

    lastFinite(
      e50
    )

    >

    lastFinite(
      e200
    )

  ) {

    score +=
      18;

  } else {

    score -=
      18;

  }


  if (
    rs >
    55
  ) {

    score +=
      12;

  }


  if (
    rs <
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
      20;

  }


  if (
    structure.bias ===
    "BEARISH"
  ) {

    score -=
      20;

  }


  score =
    clamp(
      score,
      -100,
      100
    );


  return {

    bias:

      score >= 25

        ?

        "BULLISH"

        :

        score <= -25

          ?

          "BEARISH"

          :

          "NEUTRAL",


    score:
      round(
        score,
        1
      ),


    close:
      round(
        last,
        3
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


    rsi14:
      round(
        rs,
        1
      ),


    atr14:
      round(
        atr,
        3
      ),


    structure

  };

}


/* =========================================================
   STRUCTURE
========================================================= */


function detectStructure(
  bars
) {

  const highs =
    [];


  const lows =
    [];


  const start =
    Math.max(

      3,

      bars.length -
      220

    );


  for (

    let i =
      start;

    i <
    bars.length -
    3;

    i++

  ) {

    let highPivot =
      true;


    let lowPivot =
      true;


    for (
      let j = 1;
      j <= 3;
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


  const h1 =
    highs.at(-1);


  const h2 =
    highs.at(-2);


  const l1 =
    lows.at(-1);


  const l2 =
    lows.at(-2);


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
   SESSION ENGINE
========================================================= */


function buildSessions(
  bars
) {

  const now =
    new Date();


  return SESSION_DEFS.map(

    def => {

      const active =
        isSessionOpen(
          now,
          def
        );


      const next =
        nextSessionEvent(
          now,
          def
        );


      const range =
        currentSessionRange(
          bars,
          def
        );


      return {

        id:
          def.id,

        name:
          def.name,

        short:
          def.short,

        zone:
          def.zone,

        active,


        phase:
          sessionPhase(
            now,
            def
          ),


        localTime:
          timeInZone(
            now,
            def.zone
          ),


        openLocal:
          minuteLabel(
            def.open
          ),


        closeLocal:
          minuteLabel(
            def.close
          ),


        nextEvent:
          next.type,


        nextEventAt:
          next.time
            .toISOString(),


        nextEventInSeconds:
          Math.max(

            0,

            Math.floor(

              (
                next.time.getTime() -
                now.getTime()
              )

              /

              1000

            )

          ),


        range

      };

    }

  );

}


/* =========================================================
   SESSION RANGE
========================================================= */


function currentSessionRange(
  bars,
  def
) {

  const groups =
    new Map();


  for (
    const bar of bars
  ) {

    const p =
      zoneParts(

        bar.time,

        def.zone

      );


    const minute =
      p.hour *
      60 +
      p.minute;


    if (

      minute <
      def.open

      ||

      minute >=
      def.close

    ) {

      continue;

    }


    const key =
      `${p.year}-${pad(p.month)}-${pad(p.day)}`;


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


  const keys = [

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
        ) /
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
   SESSION OPEN
========================================================= */


function isSessionOpen(
  date,
  def
) {

  const p =
    zoneParts(
      date,
      def.zone
    );


  const minute =
    p.hour *
    60 +
    p.minute;


  return (

    p.weekday >= 1

    &&

    p.weekday <= 5

    &&

    minute >=
    def.open

    &&

    minute <
    def.close

  );

}


/* =========================================================
   SESSION PHASE
========================================================= */


function sessionPhase(
  date,
  def
) {

  const p =
    zoneParts(
      date,
      def.zone
    );


  const minute =
    p.hour *
    60 +
    p.minute;


  if (
    isSessionOpen(
      date,
      def
    )
  ) {

    const elapsed =
      minute -
      def.open;


    if (
      elapsed <=
      90
    ) {

      return "OPENING LIQUIDITY WINDOW";

    }


    if (
      def.close -
      minute <=
      60
    ) {

      return "CLOSING WINDOW";

    }


    return "MID SESSION";

  }


  if (

    minute <
    def.open

    &&

    def.open -
    minute <=
    75

  ) {

    return "PRE-OPEN LIQUIDITY WINDOW";

  }


  return "CLOSED";

}


/* =========================================================
   NEXT SESSION EVENT
========================================================= */


function nextSessionEvent(
  now,
  def
) {

  let previous =
    isSessionOpen(
      now,
      def
    );


  for (
    let m = 1;
    m <= 10080;
    m++
  ) {

    const next =
      new Date(

        now.getTime() +

        m *
        60_000

      );


    const state =
      isSessionOpen(
        next,
        def
      );


    if (
      state !==
      previous
    ) {

      return {

        type:
          state
            ?
              "OPEN"
            :
              "CLOSE",

        time:
          next

      };

    }


    previous =
      state;

  }


  return {

    type:
      "UNKNOWN",

    time:
      new Date(

        now.getTime() +
        86400000

      )

  };

}


/* =========================================================
   PREVIOUS DAY + WEEK
========================================================= */


function buildReferenceLevels(
  h1,
  price
) {

  const days =
    groupBarsUtcDay(
      h1
    );


  const keys = [

    ...days.keys()

  ]
    .sort();


  const currentDay =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );


  const completed =
    keys.filter(
      x =>
        x <
        currentDay
    );


  const previousKey =
    completed.at(-1);


  let previousDay =
    null;


  if (
    previousKey
  ) {

    const rows =
      days.get(
        previousKey
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
        ),

      positionPct:
        round(

          (
            (
              price -
              low
            )

            /

            Math.max(
              high -
              low,
              0.000001
            )

          )

          *

          100,

          1

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


  const weekKeys = [

    ...weeks.keys()

  ]
    .sort();


  const currentWeek =
    weekKey(
      new Date()
    );


  const completedWeeks =
    weekKeys.filter(
      x =>
        x <
        currentWeek
    );


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
          ) /
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
   SWINGS
========================================================= */


function detectSwingLevels(
  bars,
  pivot,
  lookback
) {

  const highs =
    [];


  const lows =
    [];


  const start =
    Math.max(

      pivot,

      bars.length -
      lookback

    );


  for (

    let i =
      start;

    i <
    bars.length -
    pivot;

    i++

  ) {

    let hi =
      true;


    let lo =
      true;


    for (

      let j =
        i -
        pivot;

      j <=
      i +
      pivot;

      j++

    ) {

      if (
        j === i
      ) {

        continue;

      }


      if (
        bars[j].high >=
        bars[i].high
      ) {

        hi =
          false;

      }


      if (
        bars[j].low <=
        bars[i].low
      ) {

        lo =
          false;

      }

    }


    if (
      hi
    ) {

      highs.push({

        price:
          bars[i].high,

        time:
          bars[i].time

      });

    }


    if (
      lo
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

    highs:
      highs
        .slice(
          -7
        )
        .reverse()
        .map(

          x => ({

            price:
              round(
                x.price,
                3
              ),

            time:
              x.time
                .toISOString()

          })

        ),


    lows:
      lows
        .slice(
          -7
        )
        .reverse()
        .map(

          x => ({

            price:
              round(
                x.price,
                3
              ),

            time:
              x.time
                .toISOString()

          })

        )

  };

}


/* =========================================================
   EQUAL HIGH / LOW
========================================================= */


function detectEqualLevels(
  bars,
  atrValue
) {

  const swings =
    detectSwingLevels(

      bars,

      2,

      150

    );


  const tolerance =
    Math.max(

      (
        atrValue ||
        1
      )

      *

      0.12,

      0.15

    );


  return {

    highs:
      clusterEqualLevels(

        swings.highs,

        tolerance,

        "EQH"

      ),


    lows:
      clusterEqualLevels(

        swings.lows,

        tolerance,

        "EQL"

      )

  };

}


/* =========================================================
   CLUSTER LEVELS
========================================================= */


function clusterEqualLevels(
  levels,
  tolerance,
  type
) {

  const result =
    [];


  const used =
    new Set();


  for (
    let i = 0;
    i < levels.length;
    i++
  ) {

    if (
      used.has(
        i
      )
    ) {

      continue;

    }


    const cluster = [
      levels[i]
    ];


    used.add(
      i
    );


    for (
      let j =
        i + 1;
      j <
        levels.length;
      j++
    ) {

      if (
        used.has(
          j
        )
      ) {

        continue;

      }


      if (

        Math.abs(

          levels[j].price -
          levels[i].price

        )

        <=
        tolerance

      ) {

        cluster.push(
          levels[j]
        );


        used.add(
          j
        );

      }

    }


    if (
      cluster.length >=
      2
    ) {

      result.push({

        type,

        price:
          round(

            mean(

              cluster.map(
                x =>
                  x.price
              )

            ),

            3

          ),

        touches:
          cluster.length

      });

    }

  }


  return result;

}


/* =========================================================
   FVG
========================================================= */


function detectFvgs(
  bars,
  price,
  lookback
) {

  const result =
    [];


  const start =
    Math.max(

      2,

      bars.length -
      lookback

    );


  for (
    let i = start;
    i < bars.length;
    i++
  ) {

    const first =
      bars[
        i - 2
      ];


    const third =
      bars[i];


    if (
      third.low >
      first.high
    ) {

      result.push(
        makeFvg(

          "BULLISH FVG",

          first.high,

          third.low,

          price,

          third.time

        )
      );

    }


    if (
      third.high <
      first.low
    ) {

      result.push(
        makeFvg(

          "BEARISH FVG",

          third.high,

          first.low,

          price,

          third.time

        )
      );

    }

  }


  return result

    .sort(
      (
        a,
        b
      ) =>
        a.distance -
        b.distance
    )

    .slice(
      0,
      8
    );

}


/* =========================================================
   FVG OBJECT
========================================================= */


function makeFvg(
  type,
  low,
  high,
  price,
  time
) {

  const midpoint =
    (
      low +
      high
    )

    /

    2;


  return {

    type,

    low:
      round(
        low,
        3
      ),

    high:
      round(
        high,
        3
      ),

    midpoint:
      round(
        midpoint,
        3
      ),

    distance:
      round(
        Math.abs(
          price -
          midpoint
        ),
        3
      ),

    time:
      time.toISOString()

  };

}


/* =========================================================
   FOOTPRINT PROXY
========================================================= */


function buildFootprint(
  bars,
  atrValue
) {

  const recent =
    bars.slice(
      -180
    );


  const validVolume =
    recent.filter(

      x =>
        x.volume >
        0

    );


  const useVolume =

    validVolume.length >=
    recent.length *
    0.50;


  const ranges =
    recent.map(

      x =>
        Math.max(

          x.high -
          x.low,

          0.000001

        )

    );


  const medianRange =
    median(
      ranges
    )
    ||
    atrValue
    ||
    1;


  const rows =
    recent.map(

      candle => {

        const range =
          Math.max(

            candle.high -
            candle.low,

            0.000001

          );


        const body =

          (
            candle.close -
            candle.open
          )

          /

          range;


        const closeLocation =

          (

            (
              candle.close -
              candle.low
            )

            -

            (
              candle.high -
              candle.close
            )

          )

          /

          range;


        const activity =

          useVolume

            ?

            Math.max(
              candle.volume,
              1
            )

            :

            (

              clamp(

                range /
                medianRange,

                0.2,

                5

              )

              *

              100

            );


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

          time:
            candle.time,

          price:
            candle.close,

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

      useVolume

        ?

        "AllTick OHLCV Delta Proxy"

        :

        "AllTick Price-Action Activity Proxy",


    hasProviderVolume:
      useVolume,


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
      detectFlowDivergence(
        rows
      ),


    absorption:
      detectAbsorption(
        recent,
        rows
      )

  };

}


/* =========================================================
   FLOW AGGREGATION
========================================================= */


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


  const buy =
    sum(
      rows.map(
        x =>
          x.buy
      )
    );


  const sell =
    sum(
      rows.map(
        x =>
          x.sell
      )
    );


  const delta =
    buy -
    sell;


  return {

    activity:
      round(
        activity,
        1
      ),

    buy:
      round(
        buy,
        1
      ),

    sell:
      round(
        sell,
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


/* =========================================================
   DIVERGENCE
========================================================= */


function detectFlowDivergence(
  rows
) {

  if (
    rows.length <
    40
  ) {

    return "NONE";

  }


  const first =
    rows.slice(
      -40,
      -20
    );


  const second =
    rows.slice(
      -20
    );


  const priceMove =

    second.at(-1).price -
    first.at(-1).price;


  const delta =
    sum(

      second.map(
        x =>
          x.delta
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
   ABSORPTION
========================================================= */


function detectAbsorption(
  bars,
  flow
) {

  const recentBars =
    bars.slice(
      -30
    );


  const recentFlow =
    flow.slice(
      -30
    );


  const activityMedian =
    median(

      recentFlow.map(
        x =>
          x.activity
      )

    );


  let buyAbsorption =
    0;


  let sellAbsorption =
    0;


  for (
    let i = 0;
    i <
      recentBars.length;
    i++
  ) {

    const bar =
      recentBars[i];


    const row =
      recentFlow[i];


    const range =
      Math.max(

        bar.high -
        bar.low,

        0.000001

      );


    const upperWick =

      bar.high -
      Math.max(
        bar.open,
        bar.close
      );


    const lowerWick =

      Math.min(
        bar.open,
        bar.close
      ) -
      bar.low;


    if (

      row.activity >
      activityMedian *
      1.3

      &&

      row.delta >
      0

      &&

      upperWick /
      range >
      0.45

    ) {

      buyAbsorption++;

    }


    if (

      row.activity >
      activityMedian *
      1.3

      &&

      row.delta <
      0

      &&

      lowerWick /
      range >
      0.45

    ) {

      sellAbsorption++;

    }

  }


  if (
    buyAbsorption >=
    2
  ) {

    return "BUYING ABSORBED / BULL-TRAP RISK";

  }


  if (
    sellAbsorption >=
    2
  ) {

    return "SELLING ABSORBED / BEAR-TRAP RISK";

  }


  return "NONE";

}


/* =========================================================
   VWAP
========================================================= */


function calculateVwap(
  bars
) {

  const today =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );


  let rows =
    bars.filter(

      x =>
        x.time
          .toISOString()
          .slice(
            0,
            10
          )

        ===
        today

    );


  if (
    rows.length <
    20
  ) {

    rows =
      bars.slice(
        -300
      );

  }


  const useVolume =
    rows.filter(
      x =>
        x.volume >
        0
    ).length >=
    rows.length *
    0.5;


  const ranges =
    rows.map(
      x =>
        x.high -
        x.low
    );


  const med =
    median(
      ranges
    )
    ||
    1;


  let numerator =
    0;


  let denominator =
    0;


  for (
    const row of rows
  ) {

    const typical =

      (
        row.high +
        row.low +
        row.close
      )

      /

      3;


    const weight =

      useVolume

        ?

        Math.max(
          row.volume,
          1
        )

        :

        Math.max(

          0.2,

          (
            row.high -
            row.low
          )

          /

          med

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

        rows.at(-1).close,


    mode:

      useVolume

        ?

        "AllTick volume-weighted"

        :

        "activity-weighted proxy"

  };

}


/* =========================================================
   VOLUME PROFILE
========================================================= */


function buildVolumeProfile(
  bars,
  bins
) {

  if (
    !bars.length
  ) {

    return {

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


  const useVolume =
    bars.filter(
      x =>
        x.volume >
        0
    ).length >=
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

        volume:
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


    let index =
      Math.floor(

        (
          typical -
          low
        )

        /

        step

      );


    index =
      clamp(
        index,
        0,
        bins - 1
      );


    profile[
      index
    ].volume +=

      useVolume

        ?

        Math.max(
          bar.volume,
          1
        )

        :

        1;

  }


  const descending = [

    ...profile

  ]
    .sort(

      (
        a,
        b
      ) =>
        b.volume -
        a.volume

    );


  const ascending = [

    ...profile

  ]
    .filter(
      x =>
        x.volume >
        0
    )
    .sort(

      (
        a,
        b
      ) =>
        a.volume -
        b.volume

    );


  return {

    mode:

      useVolume

        ?

        "AllTick Volume Profile Proxy"

        :

        "Price Activity Profile",


    poc:
      round(
        descending[0]?.price,
        3
      ),


    hvn:
      descending

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
      ascending

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


/* =========================================================
   ASIA SWEEP HISTORY
========================================================= */


function studyAsiaSweeps(
  m5
) {

  const sessions =
    groupAsiaSessions(
      m5
    );


  const highEvents =
    [];


  const lowEvents =
    [];


  let eligible =
    0;


  for (
    const session of sessions
  ) {

    if (
      session.asia.length <
      60
    ) {

      continue;

    }


    if (
      session.after.length <
      10
    ) {

      continue;

    }


    eligible++;


    const high =
      Math.max(

        ...session.asia.map(
          x =>
            x.high
        )

      );


    const low =
      Math.min(

        ...session.asia.map(
          x =>
            x.low
        )

      );


    const sessionAtr =
      lastFinite(

        atrSeries(
          session.asia,
          14
        )

      )

      ||

      mean(

        session.asia.map(
          x =>
            x.high -
            x.low
        )

      );


    const highSweep =
      analyseSweep(

        session.after,

        high,

        "HIGH",

        sessionAtr

      );


    const lowSweep =
      analyseSweep(

        session.after,

        low,

        "LOW",

        sessionAtr

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
      summarizeSweeps(

        highEvents,

        eligible

      ),


    asiaLow:
      summarizeSweeps(

        lowEvents,

        eligible

      )

  };

}


/* =========================================================
   GROUP ASIA
========================================================= */


function groupAsiaSessions(
  bars
) {

  const groups =
    new Map();


  for (
    const bar of bars
  ) {

    const p =
      zoneParts(

        bar.time,

        "Asia/Tokyo"

      );


    const key =
      `${p.year}-${pad(p.month)}-${pad(p.day)}`;


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


  const result =
    [];


  for (
    const [
      date,
      rows
    ] of groups
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
        9 *
        60

        &&

        minute <
        18 *
        60

      ) {

        asia.push(
          bar
        );

      }


      if (

        minute >=
        18 *
        60

      ) {

        after.push(
          bar
        );

      }

    }


    result.push({

      date,

      asia,

      after

    });

  }


  return result;

}


/* =========================================================
   SWEEP ANALYSIS
========================================================= */


function analyseSweep(
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


  let extreme =
    side ===
    "HIGH"

      ?

      sample[0].high

      :

      sample[0].low;


  let reversed =
    false;


  let reentryBars =
    null;


  for (
    let i = 0;
    i <
      sample.length;
    i++
  ) {

    const bar =
      sample[i];


    extreme =

      side ===
      "HIGH"

        ?

        Math.max(
          extreme,
          bar.high
        )

        :

        Math.min(
          extreme,
          bar.low
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

        reversed =
          true;


        reentryBars =
          i;


        break;

      }

    }

  }


  const overshoot =

    side ===
    "HIGH"

      ?

      extreme -
      level

      :

      level -
      extreme;


  return {

    overshoot,

    overshootAtr:

      overshoot

      /

      Math.max(
        atrValue,
        0.000001
      ),

    reversed,

    reentryBars

  };

}


/* =========================================================
   SWEEP SUMMARY
========================================================= */


function summarizeSweeps(
  events,
  eligible
) {

  const overshoot =

    events.map(
      x =>
        x.overshootAtr
    )
      .filter(
        Number.isFinite
      );


  const reversed =
    events.filter(
      x =>
        x.reversed
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

          reversed.length /
          events.length *
          100

          :

          0,

        1

      ),


    p25OvershootAtr:
      round(

        percentile(
          overshoot,
          0.25
        )
        ||
        0.08,

        3

      ),


    medianOvershootAtr:
      round(

        percentile(
          overshoot,
          0.5
        )
        ||
        0.18,

        3

      ),


    p75OvershootAtr:
      round(

        percentile(
          overshoot,
          0.75
        )
        ||
        0.35,

        3

      )

  };

}


/* =========================================================
   BUILD LIQUIDITY POOLS
========================================================= */


function createLiquidityPools({

  price,

  sessions,

  dayLevels,

  equalLevels,

  swingLevels,

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

      importance,

      aliases:
        []

    });

  };


  const asia =
    sessions.find(
      x =>
        x.id ===
        "tokyo"
    );


  const london =
    sessions.find(
      x =>
        x.id ===
        "london"
    );


  const ny =
    sessions.find(
      x =>
        x.id ===
        "newyork"
    );


  if (
    asia?.range
  ) {

    add(

      "Asia High",

      asia.range.high,

      "HIGH",

      "ASIA_HIGH",

      1.35

    );


    add(

      "Asia Low",

      asia.range.low,

      "LOW",

      "ASIA_LOW",

      1.35

    );

  }


  if (
    london?.range
  ) {

    add(

      "London High",

      london.range.high,

      "HIGH",

      "LONDON_HIGH",

      1.10

    );


    add(

      "London Low",

      london.range.low,

      "LOW",

      "LONDON_LOW",

      1.10

    );

  }


  if (
    ny?.range
  ) {

    add(

      "New York High",

      ny.range.high,

      "HIGH",

      "NY_HIGH",

      1.05

    );


    add(

      "New York Low",

      ny.range.low,

      "LOW",

      "NY_LOW",

      1.05

    );

  }


  if (
    dayLevels.previousDay
  ) {

    add(

      "Previous Day High",

      dayLevels.previousDay.high,

      "HIGH",

      "PDH",

      1.4

    );


    add(

      "Previous Day Low",

      dayLevels.previousDay.low,

      "LOW",

      "PDL",

      1.4

    );

  }


  if (
    dayLevels.previousWeek
  ) {

    add(

      "Previous Week High",

      dayLevels.previousWeek.high,

      "HIGH",

      "PWH",

      1.5

    );


    add(

      "Previous Week Low",

      dayLevels.previousWeek.low,

      "LOW",

      "PWL",

      1.5

    );

  }


  for (
    const x of
    equalLevels.highs
  ) {

    add(

      `Equal Highs (${x.touches}x)`,

      x.price,

      "HIGH",

      "EQH",

      1.25

    );

  }


  for (
    const x of
    equalLevels.lows
  ) {

    add(

      `Equal Lows (${x.touches}x)`,

      x.price,

      "LOW",

      "EQL",

      1.25

    );

  }


  for (
    const x of
    swingLevels.highs.slice(
      0,
      3
    )
  ) {

    add(

      "H1 Swing High",

      x.price,

      "HIGH",

      "H1_SWING_HIGH",

      0.95

    );

  }


  for (
    const x of
    swingLevels.lows.slice(
      0,
      3
    )
  ) {

    add(

      "H1 Swing Low",

      x.price,

      "LOW",

      "H1_SWING_LOW",

      0.95

    );

  }


  return mergePools(

    pools,

    Math.max(

      (
        atrH1 ||
        1
      )

      *

      0.05,

      0.20

    )

  )

    .filter(

      x =>

        Math.abs(
          x.level -
          price
        )

        <

        (
          atrH1 ||
          20
        )

        *

        5

    );

}


/* =========================================================
   MERGE LIQUIDITY
========================================================= */


function mergePools(
  pools,
  tolerance
) {

  const sorted = [

    ...pools

  ]
    .sort(
      (
        a,
        b
      ) =>
        a.level -
        b.level
    );


  const result =
    [];


  for (
    const pool of sorted
  ) {

    const existing =
      result.find(

        x =>

          x.side ===
          pool.side

          &&

          Math.abs(
            x.level -
            pool.level
          )

          <=
          tolerance

      );


    if (
      !existing
    ) {

      result.push(
        pool
      );

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

  }


  return result;

}


/* =========================================================
   ENRICH POOL
========================================================= */


function enrichLiquidityPool({

  pool,

  price,

  atr5,

  atr15,

  structure,

  sessions,

  footprint,

  sweepHistory,

  volumeProfile,

  m1

}) {

  const distance =
    Math.abs(
      pool.level -
      price
    );


  const dAtr =

    distance

    /

    Math.max(
      atr15,
      0.000001
    );


  const direction =

    pool.side ===
    "HIGH"

      ?

      1

      :

      -1;


  const trendScore =

    structure.m5.score *
    0.25

    +

    structure.m15.score *
    0.35

    +

    structure.h1.score *
    0.30

    +

    structure.h4.score *
    0.10;


  const directionalTrend =

    direction

    *

    trendScore;


  const distanceScore =

    36

    *

    Math.exp(

      -dAtr /
      1.3

    );


  const importanceScore =

    18

    *

    pool.importance;


  const trendComponent =
    clamp(

      directionalTrend /
      6,

      -14,

      14

    );


  let sessionScore =
    0;


  for (
    const session of sessions
  ) {

    if (
      session.phase ===
      "OPENING LIQUIDITY WINDOW"
    ) {

      sessionScore =
        Math.max(

          sessionScore,

          session.id ===
          "tokyo"

            ?

            6

            :

            12

        );

    }

  }


  const flowDelta =
    footprint.last15.deltaPct
    ||
    0;


  const flowScore =
    direction

    *

    clamp(

      flowDelta /
      3,

      -10,

      10

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


  const sidePenalty =
    correctSide
      ?
        0
      :
        -24;


  const likelihoodScore =
    clamp(

      16

      +

      distanceScore

      +

      importanceScore

      +

      trendComponent

      +

      sessionScore

      +

      flowScore

      +

      sidePenalty,

      5,

      95

    );


  /* =====================================================
     SWEEP DEPTH MODEL
  ===================================================== */


  let historical =
    null;


  if (
    pool.type ===
    "ASIA_HIGH"
  ) {

    historical =
      sweepHistory.asiaHigh;

  }


  if (
    pool.type ===
    "ASIA_LOW"
  ) {

    historical =
      sweepHistory.asiaLow;

  }


  let p25 =

    historical
      ?.p25OvershootAtr

    ||

    0.08;


  let median =

    historical
      ?.medianOvershootAtr

    ||

    0.18;


  let p75 =

    historical
      ?.p75OvershootAtr

    ||

    0.35;


  if (

    direction *
    flowDelta >
    18

  ) {

    median *=
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

    median *=
      0.72;


    p75 *=
      0.80;

  }


  if (

    pool.side ===
    "LOW"

    &&

    footprint.absorption.includes(
      "SELLING"
    )

  ) {

    median *=
      0.72;


    p75 *=
      0.80;

  }


  const sign =
    direction;


  const zone1 =

    pool.level

    +

    sign *
    p25 *
    atr5;


  const likelyEnd =

    pool.level

    +

    sign *
    median *
    atr5;


  const zone2 =

    pool.level

    +

    sign *
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


  const confluence =
    [];


  const nodes = [

    volumeProfile.poc,

    ...(
      volumeProfile.hvn ||
      []
    ),

    ...(
      volumeProfile.lvn ||
      []
    )

  ];


  for (
    const node of nodes
  ) {

    if (

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

    ) {

      confluence.push(

        `Volume node ${node}`

      );

    }

  }


  let raidStyle =
    "SHALLOW RAID";


  if (
    median <
    0.10
  ) {

    raidStyle =
      "LEVEL TAG / VERY SHALLOW";

  }


  if (
    median >
    0.30
  ) {

    raidStyle =
      "DEEPER SWEEP POSSIBLE";

  }


  const reasons = [

    `${round(dAtr,2)}× M15 ATR from price`,

    `Liquidity importance ${round(pool.importance,2)}×`,

    `15m Delta proxy ${round(flowDelta,1)}%`

  ];


  if (
    sessionScore >=
    10
  ) {

    reasons.push(

      "Major session opening liquidity window active"

    );

  }


  if (
    confluence.length
  ) {

    reasons.push(
      ...confluence
    );

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
        dAtr,
        2
      ),


    likelihoodScore:
      round(
        likelihoodScore,
        1
      ),


    likelihood:

      likelihoodScore >=
      75

        ?

        "HIGH"

        :

        likelihoodScore >=
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
          median,
          3
        ),


      historicalBasis:

        historical

          ?

          `${historical.sweeps} observed Asia sweeps`

          :

          "ATR + order-flow model"

    },


    reasons

  };

}


/* =========================================================
   TRAP WINDOWS
========================================================= */


function buildTrapWindows({

  sessions,

  pools,

  price,

  atr15,

  footprint

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
      "PRE-OPEN LIQUIDITY WINDOW"
    ) {

      score +=

        session.id ===
        "tokyo"

          ?

          45

          :

          70;


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
        "tokyo"

          ?

          55

          :

          80;


      reasons.push(

        `${session.name} opening window`

      );

    }


    if (
      session.phase ===
      "CLOSING WINDOW"
    ) {

      score +=
        38;


      reasons.push(

        `${session.name} approaching close`

      );

    }


    const closePools =
      pools.filter(

        x =>
          x.distance <=
          atr15 *
          0.8

      );


    if (
      closePools.length
    ) {

      score +=
        Math.min(

          20,

          closePools.length *
          5

        );


      reasons.push(

        `${closePools.length} liquidity pools close to price`

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

        `Price ${round(price,3)}`,

        `Liquidity ${pools[0].level}`,

        `Projected sweep end ${pools[0].projectedSweep.likelyEnd}`

      ]

    });

  }


  return result.sort(

    (
      a,
      b
    ) =>
      b.score -
      a.score

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
      x =>
        x ===
        "BULLISH"
    ).length;


  const bears =
    biases.filter(
      x =>
        x ===
        "BEARISH"
    ).length;


  const trend =

    bulls >= 3

      ?

      "BULLISH"

      :

      bears >= 3

        ?

        "BEARISH"

        :

        "MIXED";


  const atrValues =
    atrSeries(
      m5,
      14
    )
      .filter(
        Number.isFinite
      );


  const medianAtr =
    median(
      atrValues
    )
    ||
    atr5;


  const ratio =

    atr5

    /

    Math.max(
      medianAtr,
      0.000001
    );


  const volatility =

    ratio >
    1.30

      ?

      "EXPANDING"

      :

      ratio <
      0.75

        ?

        "COMPRESSED"

        :

        "NORMAL";


  const flow =

    footprint.last15.deltaPct >
    18

      ?

      "BUY DOMINANT"

      :

      footprint.last15.deltaPct <
      -18

        ?

        "SELL DOMINANT"

        :

        "BALANCED";


  return {

    trend,

    volatility,

    orderFlow:
      flow,

    atrExpansion:
      round(
        ratio,
        2
      ),

    label:
      `${trend} / ${volatility} / ${flow}`

  };

}


/* =========================================================
   FRED
========================================================= */


async function fetchMacro() {

  if (
    !FRED_KEY
  ) {

    return {

      enabled:
        false,

      bias:
        "DISABLED",

      score:
        0,

      note:
        "Add FRED_API_KEY to enable macro context.",

      series:
        []

    };

  }


  const definitions = [

    {

      id:
        "DGS2",

      label:
        "US 2Y Yield",

      sign:
        -1

    },


    {

      id:
        "DGS10",

      label:
        "US 10Y Yield",

      sign:
        -1

    },


    {

      id:
        "DFII10",

      label:
        "US 10Y Real Yield",

      sign:
        -1

    },


    {

      id:
        "DTWEXBGS",

      label:
        "Broad USD Index",

      sign:
        -1

    }

  ];


  const series =
    [];


  let score =
    0;


  for (
    const definition of definitions
  ) {

    const url =
      new URL(
        FRED_BASE
      );


    url.searchParams.set(
      "series_id",
      definition.id
    );


    url.searchParams.set(
      "api_key",
      FRED_KEY
    );


    url.searchParams.set(
      "file_type",
      "json"
    );


    url.searchParams.set(
      "sort_order",
      "desc"
    );


    url.searchParams.set(
      "limit",
      "10"
    );


    const response =
      await fetch(
        url
      );


    const json =
      await response.json();


    const valid =

      (
        json.observations ||
        []
      )
        .filter(

          x =>
            x.value !== "."

            &&

            Number.isFinite(
              Number(
                x.value
              )
            )

        )
        .slice(
          0,
          2
        );


    if (
      valid.length <
      2
    ) {

      continue;

    }


    const current =
      Number(
        valid[0].value
      );


    const previous =
      Number(
        valid[1].value
      );


    const change =
      current -
      previous;


    const component =
      clamp(

        change *
        definition.sign *
        20,

        -25,

        25

      );


    score +=
      component;


    series.push({

      id:
        definition.id,

      label:
        definition.label,

      value:
        current,

      previous,

      change:
        round(
          change,
          4
        ),

      date:
        valid[0].date,

      goldPressure:
        round(
          component,
          1
        )

    });

  }


  score =
    clamp(
      score,
      -100,
      100
    );


  return {

    enabled:
      true,

    score:
      round(
        score,
        1
      ),

    bias:

      score >
      15

        ?

        "GOLD SUPPORTIVE"

        :

        score <
        -15

          ?

          "GOLD HEADWIND"

          :

          "MIXED / NEUTRAL",

    note:
      "Macro data is slower-moving context, not an execution feed.",

    series

  };

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
  period
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

    const delta =
      values[i] -
      values[
        i - 1
      ];


    gains +=
      Math.max(
        delta,
        0
      );


    losses +=
      Math.max(
        -delta,
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

    const delta =
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
          delta,
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
          -delta,
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
  period
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
    i < bars.length;
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
   DATE HELPERS
========================================================= */


function zoneParts(
  date,
  zone
) {

  const parts =
    new Intl.DateTimeFormat(

      "en-CA",

      {

        timeZone:
          zone,

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


/* =========================================================
   TIME IN ZONE
========================================================= */


function timeInZone(
  date,
  zone
) {

  return new Intl.DateTimeFormat(

    "en-ZA",

    {

      timeZone:
        zone,

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


/* =========================================================
   GROUP UTC DAYS
========================================================= */


function groupBarsUtcDay(
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


/* =========================================================
   ISO WEEK
========================================================= */


function weekKey(
  date
) {

  const d =
    new Date(

      Date.UTC(

        date.getUTCFullYear(),

        date.getUTCMonth(),

        date.getUTCDate()

      )

    );


  const day =
    d.getUTCDay() ||
    7;


  d.setUTCDate(

    d.getUTCDate()

    +

    4

    -

    day

  );


  const yearStart =
    new Date(

      Date.UTC(

        d.getUTCFullYear(),

        0,

        1

      )

    );


  const week =
    Math.ceil(

      (

        (
          (
            d -
            yearStart
          )

          /

          86400000
        )

        +

        1

      )

      /

      7

    );


  return (

    `${d.getUTCFullYear()}-W${pad(week)}`

  );

}


/* =========================================================
   HELPERS
========================================================= */


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


  const p =
    10 **
    decimals;


  return (

    Math.round(
      value *
      p
    )

    /

    p

  );

}


function clamp(
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


function mean(
  values
) {

  if (
    !values.length
  ) {

    return 0;

  }


  return (

    values.reduce(

      (
        total,
        value
      ) =>
        total +
        value,

      0

    )

    /

    values.length

  );

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
    ]

    *

    (
      1 -
      weight
    )

    +

    sorted[
      upper
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
    0.5
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