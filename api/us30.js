/* =========================================================
   MKAYFX US30 LIQUIDITY INTELLIGENCE
   ALLTICK EDITION V1.1
   /api/us30.js

   FIXES IN THIS VERSION
   ---------------------
   - Uses AllTick index gateway:
     quote-stock-b-api/kline

   - Does NOT use new URL() for the AllTick request
   - Uses encodeURIComponent()
   - Uses TOKEN.trim()
   - Reads raw response before JSON parsing
   - Better HTTP / AllTick error messages
   - Supports nested kline_data responses
========================================================= */


/* =========================================================
   CONFIG
========================================================= */


const TOKEN =
  String(
    process.env.ALLTICK_API_TOKEN ||
    ""
  ).trim();


const GAP =
  Math.max(
    0,
    Number(
      process.env.ALLTICK_REQUEST_GAP_MS ||
      1100
    )
  );


const SYMBOL =
  "US30";


const BASE =
  "https://quote.alltick.co/quote-stock-b-api/kline";


const K = {

  M1: 1,

  M5: 2,

  M15: 3,

  H1: 5,

  H4: 7,

  D1: 8

};


/* =========================================================
   CACHE
========================================================= */


let CACHE = {

  at: 0,

  data: null

};


const CACHE_MS =
  55_000;


/* =========================================================
   MAIN API
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
    !TOKEN
  ) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Missing ALLTICK_API_TOKEN"

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


    /* =====================================================
       ALLTICK DATA
    ===================================================== */


    const m1 =
      await fetchK(
        K.M1,
        500
      );


    await sleep(
      GAP
    );


    const m5 =
      await fetchK(
        K.M5,
        500
      );


    await sleep(
      GAP
    );


    const m15 =
      await fetchK(
        K.M15,
        500
      );


    await sleep(
      GAP
    );


    const h1 =
      await fetchK(
        K.H1,
        500
      );


    /* =====================================================
       DATA VALIDATION
    ===================================================== */


    if (

      m1.length <
      80

      ||

      m5.length <
      80

      ||

      m15.length <
      80

      ||

      h1.length <
      40

    ) {

      throw new Error(

        `Not enough AllTick data: ` +

        `M1=${m1.length}, ` +

        `M5=${m5.length}, ` +

        `M15=${m15.length}, ` +

        `H1=${h1.length}`

      );

    }


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
      last(
        atrSeries(
          m1,
          14
        )
      );


    const atr5 =
      last(
        atrSeries(
          m5,
          14
        )
      );


    const atr15 =
      last(
        atrSeries(
          m15,
          14
        )
      );


    const atrH1 =
      last(
        atrSeries(
          h1,
          14
        )
      );


    /* =====================================================
       MULTI-TIMEFRAME STRUCTURE
    ===================================================== */


    const frames = {

      m1:
        frame(
          m1
        ),

      m5:
        frame(
          m5
        ),

      m15:
        frame(
          m15
        ),

      h1:
        frame(
          h1
        ),

      h4:
        frame(
          resample(
            h1,
            240
          )
        )

    };


    /* =====================================================
       US SESSION INTELLIGENCE
    ===================================================== */


    const sessions =
      buildSessions(
        m1,
        m5,
        now
      );


    /* =====================================================
       REFERENCE LIQUIDITY
    ===================================================== */


    const refs =
      referenceLevels(

        h1,

        m15,

        price,

        atr15

      );


    /* =====================================================
       FOOTPRINT / DELTA PROXY
    ===================================================== */


    const flow =
      footprintProxy(

        m1,

        atr1 ||
        atr5 / 4

      );


    /* =====================================================
       VOLUME PROFILE
    ===================================================== */


    const profile =
      volumeProfile(

        m1.slice(
          -420
        ),

        36

      );


    /* =====================================================
       HISTORICAL NY SWEEP MODEL
    ===================================================== */


    const history =
      historicalNySweeps(
        m15
      );


    /* =====================================================
       LIQUIDITY RANKING
    ===================================================== */


    const pools =
      rankPools({

        price,

        atr5,

        atr15,

        atrH1,

        frames,

        sessions,

        refs,

        flow,

        profile,

        history,

        m1

      });


    /* =====================================================
       TRAP WINDOWS
    ===================================================== */


    const traps =
      trapWindows({

        sessions,

        pools,

        flow,

        price,

        atr15,

        now

      });


    /* =====================================================
       MARKET REGIME
    ===================================================== */


    const regime =
      marketRegime(

        frames,

        m5,

        atr5,

        flow

      );


    /* =====================================================
       RESPONSE
    ===================================================== */


    const output = {

      ok: true,


      symbol:
        "US30",


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
          2
        ),


      source: {

        provider:
          "AllTick",

        endpoint:
          "quote-stock-b-api/kline",

        symbol:
          SYMBOL,

        m1Bars:
          m1.length,

        m5Bars:
          m5.length,

        m15Bars:
          m15.length,

        h1Bars:
          h1.length,

        trueBidAskFootprint:
          false

      },


      sessions,


      market: {

        atr1:
          round(
            atr1,
            2
          ),

        atr5:
          round(
            atr5,
            2
          ),

        atr15:
          round(
            atr15,
            2
          ),

        atrH1:
          round(
            atrH1,
            2
          ),

        regime

      },


      structure:
        frames,


      referenceLevels:
        refs,


      footprint:
        flow,


      volumeProfile:
        profile,


      historicalSweeps:
        history,


      liquidityPools:
        pools,


      trapWindows:
        traps,


      warnings: [

        "Sweep scores are heuristic rankings, not guaranteed probabilities.",

        "Projected reversal zones are estimates.",

        "Acceptance beyond a projected zone can mean continuation instead of reversal.",

        "AllTick US30 volume is treated as a footprint-style proxy, not true centralized bid/ask aggressor volume."

      ]

    };


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

    console.error(
      "US30 API ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok: false,

        provider:
          "AllTick",

        symbol:
          SYMBOL,

        error:
          error?.message ||
          "Unknown US30 engine error"

      });

  }

}


/* =========================================================
   ALLTICK KLINE
========================================================= */


async function fetchK(
  type,
  count
) {

  const query = {

    trace:
      `mkayfx-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2,9)}`,

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
          count
        ),

      adjust_type:
        0

    }

  };


  /* =====================================================
     IMPORTANT FIX

     We build the URL manually instead of using new URL().
  ===================================================== */


  const requestUrl =

    `${BASE}` +

    `?token=${encodeURIComponent(
      TOKEN
    )}` +

    `&query=${encodeURIComponent(
      JSON.stringify(query)
    )}`;


  let response;


  try {

    response =
      await fetch(

        requestUrl,

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


  } catch (
    error
  ) {

    throw new Error(

      `AllTick network request failed: ${error.message}`

    );

  }


  const raw =
    await response.text();


  /* =====================================================
     HTTP ERROR
  ===================================================== */


  if (
    !response.ok
  ) {

    throw new Error(

      `AllTick HTTP ${response.status}: ` +

      raw.slice(
        0,
        250
      )

    );

  }


  /* =====================================================
     JSON PARSE
  ===================================================== */


  let json;


  try {

    json =
      JSON.parse(
        raw
      );


  } catch {

    throw new Error(

      `AllTick returned non-JSON data: ` +

      raw.slice(
        0,
        250
      )

    );

  }


  /* =====================================================
     ALLTICK ERROR
  ===================================================== */


  if (
    Number(
      json.ret
    ) !==
    200
  ) {

    throw new Error(

      `AllTick: ${

        json.msg ||
        json.message ||
        "request failed"

      } (ret ${

        json.ret ??
        "unknown"

      })`

    );

  }


  /* =====================================================
     KLINE LIST
  ===================================================== */


  let list =
    json?.data?.kline_list;


  /* Some AllTick responses can contain nested kline_data. */


  if (

    Array.isArray(
      list
    )

    &&

    list.length

    &&

    Array.isArray(
      list[0]?.kline_data
    )

  ) {

    list =
      list.flatMap(

        item =>
          item.kline_data ||
          []

      );

  }


  if (
    !Array.isArray(
      list
    )
  ) {

    throw new Error(

      `AllTick response missing kline_list. Response: ` +

      raw.slice(
        0,
        250
      )

    );

  }


  const candles =
    list

      .map(
        item => {

          const timestamp =
            Number(
              item.timestamp
            );


          const open =
            Number(
              item.open_price
            );


          const high =
            Number(
              item.high_price
            );


          const low =
            Number(
              item.low_price
            );


          const close =
            Number(
              item.close_price
            );


          const volume =
            Number(
              item.volume
            );


          const turnover =
            Number(
              item.turnover
            );


          return {

            time:
              new Date(
                timestamp *
                1000
              ),

            open,

            high,

            low,

            close,

            volume:
              Number.isFinite(
                volume
              )
                ?
                  volume
                :
                  0,

            turnover:
              Number.isFinite(
                turnover
              )
                ?
                  turnover
                :
                  0

          };

        }
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


  if (
    candles.length ===
    0
  ) {

    throw new Error(

      `AllTick returned zero valid candles for ${SYMBOL}, kline_type=${type}`

    );

  }


  return candles;

}


/* =========================================================
   DELAY
========================================================= */


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


/* =========================================================
   RESAMPLING
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

        bar.time
          .getTime()

        /

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
   EMA
========================================================= */


function ema(
  values,
  period
) {

  if (
    !values.length
  ) {

    return [];

  }


  const multiplier =
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
    i <
      values.length;
    i++
  ) {

    output.push(

      values[i] *
      multiplier

      +

      output[
        i - 1
      ]

      *

      (
        1 -
        multiplier
      )

    );

  }


  return output;

}


/* =========================================================
   RSI
========================================================= */


function rsi(
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


  gain /=
    period;


  loss /=
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


    gain =

      (
        gain *
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


    loss =

      (
        loss *
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
    loss ===
    0
  ) {

    return 100;

  }


  const relativeStrength =
    gain /
    loss;


  return (

    100

    -

    100 /
    (
      1 +
      relativeStrength
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


  const trueRanges =
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

      trueRanges.push(

        bars[i].high -
        bars[i].low

      );


      continue;

    }


    const previousClose =
      bars[
        i - 1
      ].close;


    trueRanges.push(

      Math.max(

        bars[i].high -
        bars[i].low,

        Math.abs(

          bars[i].high -
          previousClose

        ),

        Math.abs(

          bars[i].low -
          previousClose

        )

      )

    );

  }


  return ema(
    trueRanges,
    period
  );

}


/* =========================================================
   PIVOTS
========================================================= */


function pivots(
  bars,
  pivot = 3,
  lookback = 180
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

    let isHigh =
      true;


    let isLow =
      true;


    for (
      let offset = 1;
      offset <= pivot;
      offset++
    ) {

      if (

        bars[i].high <=
        bars[
          i - offset
        ].high

        ||

        bars[i].high <
        bars[
          i + offset
        ].high

      ) {

        isHigh =
          false;

      }


      if (

        bars[i].low >=
        bars[
          i - offset
        ].low

        ||

        bars[i].low >
        bars[
          i + offset
        ].low

      ) {

        isLow =
          false;

      }

    }


    if (
      isHigh
    ) {

      highs.push({

        price:
          bars[i].high,

        time:
          bars[i].time

      });

    }


    if (
      isLow
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
   MARKET STRUCTURE
========================================================= */


function structure(
  bars
) {

  const pivotData =
    pivots(
      bars
    );


  const high1 =
    pivotData.highs.at(-1);


  const high2 =
    pivotData.highs.at(-2);


  const low1 =
    pivotData.lows.at(-1);


  const low2 =
    pivotData.lows.at(-2);


  let bias =
    "NEUTRAL";


  if (
    high1 &&
    high2 &&
    low1 &&
    low2
  ) {

    if (

      high1.price >
      high2.price

      &&

      low1.price >
      low2.price

    ) {

      bias =
        "BULLISH";

    }


    if (

      high1.price <
      high2.price

      &&

      low1.price <
      low2.price

    ) {

      bias =
        "BEARISH";

    }

  }


  const close =
    bars.at(-1)
      .close;


  let event =
    "NONE";


  if (

    high1

    &&

    close >
    high1.price

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

    low1

    &&

    close <
    low1.price

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

      high1

        ?

        round(
          high1.price,
          2
        )

        :

        null,


    swingLow:

      low1

        ?

        round(
          low1.price,
          2
        )

        :

        null

  };

}


/* =========================================================
   TIMEFRAME ANALYSIS
========================================================= */


function frame(
  bars
) {

  const closes =
    bars.map(
      bar =>
        bar.close
    );


  const ema20 =
    ema(
      closes,
      20
    );


  const ema50 =
    ema(
      closes,
      50
    );


  const ema200 =
    ema(

      closes,

      Math.min(

        200,

        Math.max(
          20,
          closes.length - 1
        )

      )

    );


  const structureData =
    structure(
      bars
    );


  const rsi14 =
    rsi(
      closes,
      14
    );


  let score =
    0;


  score +=

    closes.at(-1) >
    last(
      ema20
    )

      ?

      18

      :

      -18;


  score +=

    last(
      ema20
    )

    >

    last(
      ema50
    )

      ?

      22

      :

      -22;


  score +=

    last(
      ema50
    )

    >

    last(
      ema200
    )

      ?

      16

      :

      -16;


  if (
    rsi14 >
    55
  ) {

    score +=
      12;

  }


  if (
    rsi14 <
    45
  ) {

    score -=
      12;

  }


  if (
    structureData.bias ===
    "BULLISH"
  ) {

    score +=
      22;

  }


  if (
    structureData.bias ===
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
        rsi14,
        1
      ),


    ema20:
      round(
        last(
          ema20
        ),
        2
      ),


    ema50:
      round(
        last(
          ema50
        ),
        2
      ),


    ema200:
      round(
        last(
          ema200
        ),
        2
      ),


    atr14:
      round(

        last(
          atrSeries(
            bars,
            14
          )
        ),

        2

      ),


    structure:
      structureData

  };

}


/* =========================================================
   TIMEZONE
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


function nyParts(
  date
) {

  return zoneParts(

    date,

    "America/New_York"

  );

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


function windowRange(
  bars,
  timezone,
  startMinute,
  endMinute,
  mode = "latest"
) {

  const groups =
    new Map();


  for (
    const bar of bars
  ) {

    const parts =
      zoneParts(

        bar.time,

        timezone

      );


    const minute =
      parts.hour *
      60 +
      parts.minute;


    if (

      minute <
      startMinute

      ||

      minute >=
      endMinute

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


  const keys = [

    ...groups.keys()

  ]
    .sort();


  const key =

    mode ===
    "previous"

      ?

      keys.at(-2)

      :

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


  if (
    !rows.length
  ) {

    return null;

  }


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
        2
      ),


    low:
      round(
        low,
        2
      ),


    open:
      round(
        rows[0].open,
        2
      ),


    close:
      round(
        rows.at(-1).close,
        2
      ),


    range:
      round(
        high -
        low,
        2
      ),


    bars:
      rows.length

  };

}


/* =========================================================
   SESSION TRANSITION
========================================================= */


function nextTransition(
  now,
  startMinute,
  endMinute,
  timezone
) {

  const state =
    date => {

      const parts =
        zoneParts(

          date,

          timezone

        );


      const minute =
        parts.hour *
        60 +
        parts.minute;


      return (

        parts.weekday >=
        1

        &&

        parts.weekday <=
        5

        &&

        minute >=
        startMinute

        &&

        minute <
        endMinute

      );

    };


  let previousState =
    state(
      now
    );


  for (
    let minuteOffset = 1;
    minuteOffset <= 10080;
    minuteOffset++
  ) {

    const nextDate =
      new Date(

        now.getTime()

        +

        minuteOffset *
        60_000

      );


    const nextState =
      state(
        nextDate
      );


    if (
      nextState !==
      previousState
    ) {

      return {

        type:
          nextState
            ?
              "OPEN"
            :
              "CLOSE",

        time:
          nextDate

      };

    }


    previousState =
      nextState;

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
   SESSIONS
========================================================= */


function buildSessions(
  m1,
  m5,
  now
) {

  const definitions = [

    {

      id:
        "premarket",

      name:
        "US Premarket",

      timezone:
        "America/New_York",

      start:
        4 * 60,

      end:
        9 * 60 +
        30

    },


    {

      id:
        "cash",

      name:
        "New York Cash",

      timezone:
        "America/New_York",

      start:
        9 * 60 +
        30,

      end:
        16 * 60

    },


    {

      id:
        "powerhour",

      name:
        "Power Hour",

      timezone:
        "America/New_York",

      start:
        15 * 60,

      end:
        16 * 60

    },


    {

      id:
        "london",

      name:
        "London",

      timezone:
        "Europe/London",

      start:
        8 * 60,

      end:
        17 * 60

    }

  ];


  return definitions.map(
    definition => {

      const transition =
        nextTransition(

          now,

          definition.start,

          definition.end,

          definition.timezone

        );


      const local =
        zoneParts(

          now,

          definition.timezone

        );


      const minute =
        local.hour *
        60 +
        local.minute;


      const active =

        local.weekday >=
        1

        &&

        local.weekday <=
        5

        &&

        minute >=
        definition.start

        &&

        minute <
        definition.end;


      let phase =
        active
          ?
            "ACTIVE"
          :
            "CLOSED";


      if (

        definition.id ===
        "cash"

        &&

        active

        &&

        minute <
        10 * 60 +
        30

      ) {

        phase =
          "CASH OPEN LIQUIDITY WINDOW";

      }


      if (

        definition.id ===
        "premarket"

        &&

        !active

        &&

        minute >=
        9 * 60

        &&

        minute <
        9 * 60 +
        30

      ) {

        phase =
          "PRE-CASH-OPEN WINDOW";

      }


      if (

        definition.id ===
        "powerhour"

        &&

        active

      ) {

        phase =
          "CLOSING LIQUIDITY WINDOW";

      }


      return {

        id:
          definition.id,

        name:
          definition.name,

        zone:
          definition.timezone,

        active,

        phase,

        localTime:
          timeInZone(

            now,

            definition.timezone

          ),

        openLocal:
          minuteLabel(
            definition.start
          ),

        closeLocal:
          minuteLabel(
            definition.end
          ),

        nextEvent:
          transition.type,

        nextEventAt:
          transition.time
            .toISOString(),

        range:
          windowRange(

            definition.id ===
            "premarket"

              ?

              m1

              :

              m5,

            definition.timezone,

            definition.start,

            definition.end

          )

      };

    }
  );

}


/* =========================================================
   REFERENCE LIQUIDITY
========================================================= */


function referenceLevels(
  h1,
  m15,
  price,
  atr15
) {

  const previousDay =
    windowRange(

      h1,

      "America/New_York",

      0,

      24 * 60,

      "previous"

    );


  const previousCash =
    windowRange(

      m15,

      "America/New_York",

      9 * 60 +
      30,

      16 * 60,

      "previous"

    );


  const premarket =
    windowRange(

      m15,

      "America/New_York",

      4 * 60,

      9 * 60 +
      30

    );


  const overnight =
    windowRange(

      m15,

      "America/New_York",

      0,

      4 * 60

    );


  const openingRange30 =
    windowRange(

      m15,

      "America/New_York",

      9 * 60 +
      30,

      10 * 60

    );


  const equals =
    equalClusters(

      m15,

      atr15

    );


  const swingData =
    pivots(

      h1,

      3,

      160

    );


  const roundStep =
    100;


  const roundBase =
    Math.round(

      price /
      roundStep

    )

    *

    roundStep;


  return {

    previousDay,

    previousCash,

    premarket,

    overnight,

    openingRange30,


    equalHighs:
      equals.highs,


    equalLows:
      equals.lows,


    h1Highs:
      swingData.highs

        .slice(
          -5
        )

        .reverse()

        .map(
          item =>
            round(
              item.price,
              2
            )
        ),


    h1Lows:
      swingData.lows

        .slice(
          -5
        )

        .reverse()

        .map(
          item =>
            round(
              item.price,
              2
            )
        ),


    roundNumbers: [

      roundBase -
      200,

      roundBase -
      100,

      roundBase,

      roundBase +
      100,

      roundBase +
      200

    ]

  };

}


/* =========================================================
   EQUAL LEVELS
========================================================= */


function equalClusters(
  bars,
  atrValue
) {

  const pivotData =
    pivots(

      bars,

      2,

      180

    );


  const tolerance =
    Math.max(

      6,

      (
        atrValue ||
        50
      )

      *

      0.10

    );


  return {

    highs:
      clusterPrices(

        pivotData.highs.map(
          item =>
            item.price
        ),

        tolerance

      ),


    lows:
      clusterPrices(

        pivotData.lows.map(
          item =>
            item.price
        ),

        tolerance

      )

  };

}


function clusterPrices(
  prices,
  tolerance
) {

  const clusters =
    [];


  for (
    const price of prices
  ) {

    let cluster =
      clusters.find(

        item =>

          Math.abs(

            item.price -
            price

          )

          <=
          tolerance

      );


    if (
      !cluster
    ) {

      clusters.push({

        price,

        touches:
          1

      });


      continue;

    }


    cluster.price =

      (
        cluster.price *
        cluster.touches

        +

        price

      )

      /

      (
        cluster.touches +
        1
      );


    cluster.touches++;

  }


  return clusters

    .filter(
      item =>
        item.touches >=
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
      4
    )

    .map(
      item => ({

        price:
          round(
            item.price,
            2
          ),

        touches:
          item.touches

      })
    );

}


/* =========================================================
   FOOTPRINT PROXY
========================================================= */


function footprintProxy(
  bars,
  atr1
) {

  const recent =
    bars.slice(
      -180
    );


  const volumeBars =
    recent.filter(

      bar =>
        bar.volume >
        0

    );


  const useVolume =

    volumeBars.length

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

            0.01

          )

      )

    )

    ||

    atr1

    ||

    1;


  const rows =
    recent.map(
      bar => {

        const range =
          Math.max(

            bar.high -
            bar.low,

            0.01

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

          useVolume

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
            sell,

          high:
            bar.high,

          low:
            bar.low,

          open:
            bar.open,

          close:
            bar.close

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

        "AllTick Price-Activity Proxy",


    hasProviderVolume:
      useVolume,


    trueBidAskFootprint:
      false,


    last5:
      aggregateFlow(

        rows.slice(
          -5
        )

      ),


    last15:
      aggregateFlow(

        rows.slice(
          -15
        )

      ),


    last30:
      aggregateFlow(

        rows.slice(
          -30
        )

      ),


    last60:
      aggregateFlow(

        rows.slice(
          -60
        )

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


  const buy =
    sum(

      rows.map(
        row =>
          row.buy
      )

    );


  const sell =
    sum(

      rows.map(
        row =>
          row.sell
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


  let upperAbsorption =
    0;


  let lowerAbsorption =
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
      recentRows[i];


    const range =
      Math.max(

        bar.high -
        bar.low,

        0.01

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
      0.45

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
      0.45

    ) {

      lowerAbsorption++;

    }

  }


  if (
    upperAbsorption >=
    2
  ) {

    return "BUYING ABSORBED / BULL-TRAP RISK";

  }


  if (
    lowerAbsorption >=
    2
  ) {

    return "SELLING ABSORBED / BEAR-TRAP RISK";

  }


  return "NONE";

}


/* =========================================================
   VOLUME PROFILE
========================================================= */


function volumeProfile(
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


  const useVolume =

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

        volume:
          0

      })

    );


  for (
    const bar of bars
  ) {

    const typicalPrice =

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
          typicalPrice -
          low
        )

        /

        step

      );


    index =
      clamp(

        index,

        0,

        bins -
        1

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


  const descending =
    [
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


  const ascending =
    [
      ...profile
    ]
      .filter(
        item =>
          item.volume >
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

        descending[0]
          ?.price,

        2

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
              2
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
              2
            )
        )

  };

}


/* =========================================================
   HISTORICAL NY SWEEPS
========================================================= */


function historicalNySweeps(
  m15
) {

  const groups =
    new Map();


  for (
    const bar of m15
  ) {

    const parts =
      nyParts(
        bar.time
      );


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


  const highEvents =
    [];


  const lowEvents =
    [];


  let eligible =
    0;


  const dates = [

    ...groups.keys()

  ]
    .sort();


  for (
    const key of dates
  ) {

    const rows =
      groups
        .get(
          key
        )
        .sort(
          (
            a,
            b
          ) =>
            a.time -
            b.time
        );


    const premarket =
      rows.filter(
        bar => {

          const parts =
            nyParts(
              bar.time
            );


          const minute =
            parts.hour *
            60 +
            parts.minute;


          return (

            minute >=
            4 * 60

            &&

            minute <
            9 * 60 +
            30

          );

        }
      );


    const afterOpen =
      rows.filter(
        bar => {

          const parts =
            nyParts(
              bar.time
            );


          const minute =
            parts.hour *
            60 +
            parts.minute;


          return (

            minute >=
            9 * 60 +
            30

            &&

            minute <
            12 * 60

          );

        }
      );


    if (

      premarket.length <
      12

      ||

      afterOpen.length <
      4

    ) {

      continue;

    }


    eligible++;


    const premarketHigh =
      Math.max(

        ...premarket.map(
          bar =>
            bar.high
        )

      );


    const premarketLow =
      Math.min(

        ...premarket.map(
          bar =>
            bar.low
        )

      );


    const localAtr =

      last(
        atrSeries(
          premarket,
          14
        )
      )

      ||

      mean(

        premarket.map(
          bar =>
            bar.high -
            bar.low
        )

      );


    const highSweep =
      sweepEvent(

        afterOpen,

        premarketHigh,

        "HIGH",

        localAtr

      );


    const lowSweep =
      sweepEvent(

        afterOpen,

        premarketLow,

        "LOW",

        localAtr

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


    premarketHigh:
      summarizeSweeps(

        highEvents,

        eligible

      ),


    premarketLow:
      summarizeSweeps(

        lowEvents,

        eligible

      )

  };

}


function sweepEvent(
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
      12

    );


  let extension =
    0;


  let reversed =
    false;


  let barsBack =
    null;


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

      const returnedInside =

        side ===
        "HIGH"

          ?

          sample[i].close <
          level

          :

          sample[i].close >
          level;


      if (
        returnedInside
      ) {

        reversed =
          true;


        barsBack =
          i;


        break;

      }

    }

  }


  return {

    overshoot:
      extension,


    overshootAtr:

      extension

      /

      Math.max(
        atrValue,
        0.01
      ),


    reversed,

    barsBack

  };

}


function summarizeSweeps(
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

        ||

        0.08,

        3

      ),


    medianOvershootAtr:
      round(

        percentile(
          overshoots,
          0.50
        )

        ||

        0.18,

        3

      ),


    p75OvershootAtr:
      round(

        percentile(
          overshoots,
          0.75
        )

        ||

        0.40,

        3

      )

  };

}


/* =========================================================
   LIQUIDITY RANKING
========================================================= */


function rankPools(
  context
) {

  const {

    price,

    atr15,

    atrH1,

    refs

  } =
    context;


  const pools =
    [];


  const addPool = (

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


    if (

      Math.abs(
        level -
        price
      )

      >

      Math.max(

        atrH1 ||
        atr15 ||
        200,

        100

      )

      *

      6

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


  addPool(

    "Premarket High",

    refs.premarket
      ?.high,

    "HIGH",

    "PREMARKET_HIGH",

    1.55

  );


  addPool(

    "Premarket Low",

    refs.premarket
      ?.low,

    "LOW",

    "PREMARKET_LOW",

    1.55

  );


  addPool(

    "Opening Range High",

    refs.openingRange30
      ?.high,

    "HIGH",

    "OR_HIGH",

    1.45

  );


  addPool(

    "Opening Range Low",

    refs.openingRange30
      ?.low,

    "LOW",

    "OR_LOW",

    1.45

  );


  addPool(

    "Previous Cash High",

    refs.previousCash
      ?.high,

    "HIGH",

    "PREV_CASH_HIGH",

    1.35

  );


  addPool(

    "Previous Cash Low",

    refs.previousCash
      ?.low,

    "LOW",

    "PREV_CASH_LOW",

    1.35

  );


  addPool(

    "Previous Day High",

    refs.previousDay
      ?.high,

    "HIGH",

    "PDH",

    1.50

  );


  addPool(

    "Previous Day Low",

    refs.previousDay
      ?.low,

    "LOW",

    "PDL",

    1.50

  );


  for (
    const item of
    refs.equalHighs
  ) {

    addPool(

      `Equal Highs (${item.touches}x)`,

      item.price,

      "HIGH",

      "EQH",

      1.30

    );

  }


  for (
    const item of
    refs.equalLows
  ) {

    addPool(

      `Equal Lows (${item.touches}x)`,

      item.price,

      "LOW",

      "EQL",

      1.30

    );

  }


  for (
    const priceLevel of
    refs.h1Highs.slice(
      0,
      3
    )
  ) {

    addPool(

      "H1 Swing High",

      priceLevel,

      "HIGH",

      "H1_HIGH",

      1

    );

  }


  for (
    const priceLevel of
    refs.h1Lows.slice(
      0,
      3
    )
  ) {

    addPool(

      "H1 Swing Low",

      priceLevel,

      "LOW",

      "H1_LOW",

      1

    );

  }


  for (
    const priceLevel of
    refs.roundNumbers
  ) {

    addPool(

      `Round ${Math.round(
        priceLevel
      )}`,

      priceLevel,

      priceLevel >=
      price

        ?

        "HIGH"

        :

        "LOW",

      "ROUND",

      0.85

    );

  }


  const merged =
    mergePools(

      pools,

      Math.max(

        10,

        (
          atr15 ||
          100
        )

        *

        0.08

      )

    );


  return merged

    .map(
      pool =>
        enrichPool(

          pool,

          context

        )
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

}


function mergePools(
  pools,
  tolerance
) {

  const output =
    [];


  const sorted =
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
      );


  for (
    const pool of sorted
  ) {

    const existing =
      output.find(

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

      output.push({

        ...pool,

        aliases:
          []

      });


      continue;

    }


    existing.aliases
      .push(
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


function enrichPool(
  pool,
  context
) {

  const {

    price,

    atr5,

    atr15,

    frames,

    sessions,

    flow,

    profile,

    history

  } =
    context;


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
      0.01
    );


  const trendScore =

    frames.m5.score *
    0.18

    +

    frames.m15.score *
    0.34

    +

    frames.h1.score *
    0.33

    +

    frames.h4.score *
    0.15;


  const delta15 =
    flow.last15
      ?.deltaPct

    ||

    0;


  const cash =
    sessions.find(

      session =>
        session.id ===
        "cash"

    );


  const premarket =
    sessions.find(

      session =>
        session.id ===
        "premarket"

    );


  let likelihoodScore =

    16

    +

    36 *
    Math.exp(

      -distanceAtr /
      1.35

    )

    +

    18 *
    pool.importance

    +

    clamp(

      direction *
      trendScore /
      6,

      -14,

      14

    )

    +

    clamp(

      direction *
      delta15 /
      3,

      -10,

      10

    );


  if (

    cash?.phase ===
    "CASH OPEN LIQUIDITY WINDOW"

  ) {

    likelihoodScore +=
      14;

  }


  if (

    premarket?.phase ===
    "PRE-CASH-OPEN WINDOW"

  ) {

    likelihoodScore +=
      9;

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

    likelihoodScore -=
      24;

  }


  likelihoodScore =
    clamp(

      likelihoodScore,

      5,

      95

    );


  /* =====================================================
     HISTORICAL OVERSHOOT MODEL
  ===================================================== */


  let historical =
    null;


  if (
    pool.type ===
    "PREMARKET_HIGH"
  ) {

    historical =
      history.premarketHigh;

  }


  if (
    pool.type ===
    "PREMARKET_LOW"
  ) {

    historical =
      history.premarketLow;

  }


  let q25 =

    historical
      ?.p25OvershootAtr

    ||

    0.10;


  let medianOvershoot =

    historical
      ?.medianOvershootAtr

    ||

    0.22;


  let q75 =

    historical
      ?.p75OvershootAtr

    ||

    0.45;


  /* Strong flow into liquidity can deepen sweep. */


  if (

    direction *
    delta15 >
    18

  ) {

    medianOvershoot *=
      1.22;


    q75 *=
      1.32;

  }


  /* Absorption can reduce expected extension. */


  if (

    pool.side ===
    "HIGH"

    &&

    flow.absorption
      .includes(
        "BUYING"
      )

  ) {

    medianOvershoot *=
      0.72;


    q75 *=
      0.82;

  }


  if (

    pool.side ===
    "LOW"

    &&

    flow.absorption
      .includes(
        "SELLING"
      )

  ) {

    medianOvershoot *=
      0.72;


    q75 *=
      0.82;

  }


  const zonePoint1 =

    pool.level

    +

    direction *
    q25 *
    atr5;


  const likelyEnd =

    pool.level

    +

    direction *
    medianOvershoot *
    atr5;


  const zonePoint2 =

    pool.level

    +

    direction *
    q75 *
    atr5;


  const zoneLow =
    Math.min(

      zonePoint1,

      zonePoint2

    );


  const zoneHigh =
    Math.max(

      zonePoint1,

      zonePoint2

    );


  const profileNodes = [

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


  const confluences =
    profileNodes

      .filter(

        node =>

          Number.isFinite(
            node
          )

          &&

          node >=
          zoneLow -
          atr5 *
          0.15

          &&

          node <=
          zoneHigh +
          atr5 *
          0.15

      )

      .map(

        node =>
          `Volume node ${round(
            node,
            0
          )}`

      );


  let raidStyle =
    "SHALLOW RAID";


  if (
    medianOvershoot <
    0.12
  ) {

    raidStyle =
      "LEVEL TAG / VERY SHALLOW";

  }


  if (
    medianOvershoot >
    0.35
  ) {

    raidStyle =
      "DEEPER SWEEP POSSIBLE";

  }


  return {

    ...pool,


    level:
      round(
        pool.level,
        2
      ),


    distance:
      round(
        distance,
        2
      ),


    distanceAtr:
      round(
        distanceAtr,
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
          2
        ),


      likelyEnd:
        round(
          likelyEnd,
          2
        ),


      zoneLow:
        round(
          zoneLow,
          2
        ),


      zoneHigh:
        round(
          zoneHigh,
          2
        ),


      overshoot:
        round(

          Math.abs(

            likelyEnd -
            pool.level

          ),

          2

        ),


      overshootAtr:
        round(
          medianOvershoot,
          3
        ),


      historicalBasis:

        historical

          ?

          `${historical.sweeps} observed NY premarket sweeps`

          :

          "ATR + structure + order-flow model"

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

      `15m delta proxy ${round(
        delta15,
        1
      )}%`,

      cash?.phase ===
      "CASH OPEN LIQUIDITY WINDOW"

        ?

        "US cash-open liquidity window active"

        :

        null,

      ...confluences

    ]
      .filter(
        Boolean
      )

  };

}


/* =========================================================
   TRAP WINDOWS
========================================================= */


function trapWindows({

  sessions,

  pools,

  flow,

  price,

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
      "PRE-CASH-OPEN WINDOW"
    ) {

      score +=
        72;


      reasons.push(
        "US cash open approaching"
      );

    }


    if (
      session.phase ===
      "CASH OPEN LIQUIDITY WINDOW"
    ) {

      score +=
        84;


      reasons.push(
        "First hour after 09:30 ET cash open"
      );

    }


    if (
      session.phase ===
      "CLOSING LIQUIDITY WINDOW"
    ) {

      score +=
        58;


      reasons.push(
        "US power hour / closing liquidity"
      );

    }


    const nearby =
      pools.filter(

        pool =>
          pool.distance <=
          atr15 *
          0.7

      );


    if (
      nearby.length
    ) {

      score +=
        Math.min(

          18,

          nearby.length *
          5

        );


      reasons.push(

        `${nearby.length} mapped pools within 0.7× M15 ATR`

      );

    }


    if (
      flow.absorption !==
      "NONE"
    ) {

      score +=
        7;


      reasons.push(
        flow.absorption
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

        `Current ${round(
          price,
          2
        )} → ${pools[0].level}`,

        `Projected raid end ${pools[0].projectedSweep.likelyEnd}`

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
      6
    );

}


/* =========================================================
   MARKET REGIME
========================================================= */


function marketRegime(
  frames,
  m5,
  atr5,
  flow
) {

  const biases = [

    frames.m5.bias,

    frames.m15.bias,

    frames.h1.bias,

    frames.h4.bias

  ];


  const bullishCount =
    biases.filter(

      bias =>
        bias ===
        "BULLISH"

    ).length;


  const bearishCount =
    biases.filter(

      bias =>
        bias ===
        "BEARISH"

    ).length;


  const trend =

    bullishCount >=
    3

      ?

      "BULLISH"

      :

      bearishCount >=
      3

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


  const atrMedian =
    median(
      atrValues
    )

    ||

    atr5;


  const expansionRatio =

    atr5

    /

    Math.max(
      atrMedian,
      0.01
    );


  const volatility =

    expansionRatio >
    1.30

      ?

      "EXPANDING"

      :

      expansionRatio <
      0.75

        ?

        "COMPRESSED"

        :

        "NORMAL";


  const delta15 =
    flow.last15
      ?.deltaPct

    ||

    0;


  const orderFlow =

    delta15 >
    18

      ?

      "BUY DOMINANT"

      :

      delta15 <
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
        expansionRatio,
        2
      ),


    label:

      `${trend} / ` +

      `${volatility} / ` +

      `${orderFlow}`

  };

}


/* =========================================================
   HELPERS
========================================================= */


function last(
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

  if (
    !values.length
  ) {

    return 0;

  }


  return (

    sum(
      values
    )

    /

    values.length

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