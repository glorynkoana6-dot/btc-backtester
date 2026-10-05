const TOKEN =
  process.env.ALLTICK_API_TOKEN;


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
  "https://quote.alltick.co/quote-b-api/kline";


const K = {

  M1: 1,

  M5: 2,

  M15: 3,

  H1: 5,

  H4: 7,

  D1: 8

};


let CACHE = {

  at: 0,

  data: null

};


const CACHE_MS =
  55_000;


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

       M1:
       live microstructure

       M5:
       current execution structure

       M15:
       NY sweep history

       H1:
       larger liquidity / structure
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

        `M1=${m1.length} ` +

        `M5=${m5.length} ` +

        `M15=${m15.length} ` +

        `H1=${h1.length}`

      );

    }


    const now =
      new Date();


    const price =
      m1.at(-1).close;


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
       MULTI TIMEFRAME
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
       SESSIONS
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
       ORDER FLOW
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
       HISTORICAL NY SWEEPS
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
       REGIME
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


    const out = {

      ok: true,


      symbol:
        "US30",


      providerSymbol:
        SYMBOL,


      generatedAt:
        now.toISOString(),


      latestBarTime:
        m1.at(-1)
          .time
          .toISOString(),


      dataAgeSeconds:
        Math.max(

          0,

          Math.floor(

            (
              Date.now()

              -

              m1.at(-1)
                .time
                .getTime()
            )

            /

            1000

          )

        ),


      price:
        r(
          price,
          2
        ),


      source: {

        provider:
          "AllTick",

        endpoint:
          "quote-b-api/kline",

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
          r(
            atr1,
            2
          ),

        atr5:
          r(
            atr5,
            2
          ),

        atr15:
          r(
            atr15,
            2
          ),

        atrH1:
          r(
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

        "Projected reversal zones are estimates. Acceptance beyond a level can invalidate the reversal idea.",

        "AllTick US30 candle volume is not treated as true centralized aggressor bid/ask footprint volume."

      ]

    };


    CACHE = {

      at:
        Date.now(),

      data:
        out

    };


    return res
      .status(200)
      .json(
        out
      );


  } catch (
    e
  ) {

    console.error(
      e
    );


    return res
      .status(500)
      .json({

        ok: false,

        provider:
          "AllTick",

        error:
          e?.message ||
          "Unknown error"

      });

  }

}


/* =========================================================
   ALLTICK
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


  const u =
    new URL(
      BASE
    );


  u.searchParams.set(
    "token",
    TOKEN
  );


  u.searchParams.set(
    "query",
    JSON.stringify(
      query
    )
  );


  const resp =
    await fetch(

      u,

      {

        headers: {

          Accept:
            "application/json"

        },

        cache:
          "no-store"

      }

    );


  if (
    !resp.ok
  ) {

    throw new Error(
      `AllTick HTTP ${resp.status}`
    );

  }


  const j =
    await resp.json();


  if (
    Number(
      j.ret
    ) !==
    200
  ) {

    throw new Error(

      `AllTick: ${
        j.msg ||
        "request failed"
      }`

    );

  }


  let list =
    j?.data?.kline_list;


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

        x =>
          x.kline_data ||
          []

      );

  }


  if (
    !Array.isArray(
      list
    )
  ) {

    throw new Error(

      "AllTick response missing kline_list"

    );

  }


  return list

    .map(
      x => ({

        time:
          new Date(
            Number(
              x.timestamp
            ) *
            1000
          ),

        open:
          +x.open_price,

        high:
          +x.high_price,

        low:
          +x.low_price,

        close:
          +x.close_price,

        volume:
          +x.volume ||
          0,

        turnover:
          +x.turnover ||
          0

      })
    )

    .filter(
      x =>

        Number.isFinite(
          x.time.getTime()
        )

        &&

        [
          x.open,
          x.high,
          x.low,
          x.close
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


const sleep =
  ms =>
    new Promise(
      ok =>
        setTimeout(
          ok,
          ms
        )
    );


/* =========================================================
   RESAMPLING
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
    const b of bars
  ) {

    const key =

      Math.floor(

        b.time.getTime() /
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
            b.open,

          high:
            b.high,

          low:
            b.low,

          close:
            b.close,

          volume:
            b.volume

        }
      );


    } else {

      const x =
        map.get(
          key
        );


      x.high =
        Math.max(
          x.high,
          b.high
        );


      x.low =
        Math.min(
          x.low,
          b.low
        );


      x.close =
        b.close;


      x.volume +=
        b.volume;

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


  const k =
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
      k

      +

      out[
        i - 1
      ]

      *

      (
        1 -
        k
      )

    );

  }


  return out;

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

    const d =
      values[i] -
      values[i - 1];


    gain +=
      Math.max(
        d,
        0
      );


    loss +=
      Math.max(
        -d,
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

    const d =
      values[i] -
      values[i - 1];


    gain =

      (
        gain *
        (
          period -
          1
        )

        +

        Math.max(
          d,
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
          -d,
          0
        )

      )

      /

      period;

  }


  if (
    loss === 0
  ) {

    return 100;

  }


  return (

    100

    -

    100 /
    (
      1 +
      gain /
      loss
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

  const tr =
    bars.map(
      (
        x,
        i
      ) =>

        i

          ?

          Math.max(

            x.high -
            x.low,

            Math.abs(

              x.high -
              bars[
                i - 1
              ].close

            ),

            Math.abs(

              x.low -
              bars[
                i - 1
              ].close

            )

          )

          :

          x.high -
          x.low

    );


  return ema(
    tr,
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


  for (

    let i =
      Math.max(
        pivot,
        bars.length -
        lookback
      );

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
      let j = 1;
      j <= pivot;
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

        hi =
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

    highs,

    lows

  };

}


/* =========================================================
   STRUCTURE
========================================================= */


function structure(
  bars
) {

  const p =
    pivots(
      bars
    );


  const h1 =
    p.highs.at(-1);


  const h2 =
    p.highs.at(-2);


  const l1 =
    p.lows.at(-1);


  const l2 =
    p.lows.at(-2);


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

        r(
          h1.price,
          2
        )

        :

        null,

    swingLow:

      l1

        ?

        r(
          l1.price,
          2
        )

        :

        null

  };

}


/* =========================================================
   TIMEFRAME FRAME
========================================================= */


function frame(
  bars
) {

  const closes =
    bars.map(
      x =>
        x.close
    );


  const e20 =
    ema(
      closes,
      20
    );


  const e50 =
    ema(
      closes,
      50
    );


  const e200 =
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


  const s =
    structure(
      bars
    );


  const rv =
    rsi(
      closes,
      14
    );


  let score =
    0;


  score +=

    closes.at(-1) >
    last(
      e20
    )

      ?

      18

      :

      -18;


  score +=

    last(
      e20
    )

    >

    last(
      e50
    )

      ?

      22

      :

      -22;


  score +=

    last(
      e50
    )

    >

    last(
      e200
    )

      ?

      16

      :

      -16;


  score +=

    rv >
    55

      ?

      12

      :

      rv <
      45

        ?

        -12

        :

        0;


  score +=

    s.bias ===
    "BULLISH"

      ?

      22

      :

      s.bias ===
      "BEARISH"

        ?

        -22

        :

        0;


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
      r(
        score,
        1
      ),


    rsi14:
      r(
        rv,
        1
      ),


    ema20:
      r(
        last(
          e20
        ),
        2
      ),


    ema50:
      r(
        last(
          e50
        ),
        2
      ),


    ema200:
      r(
        last(
          e200
        ),
        2
      ),


    atr14:
      r(
        last(
          atrSeries(
            bars,
            14
          )
        ),
        2
      ),


    structure:
      s

  };

}


/* =========================================================
   TIMEZONE HELPERS
========================================================= */


function nyParts(
  date
) {

  return zoneParts(
    date,
    "America/New_York"
  );

}


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


  const obj = {};


  for (
    const p of parts
  ) {

    if (
      p.type !==
      "literal"
    ) {

      obj[p.type] =
        p.value;

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
      +obj.year,

    month:
      +obj.month,

    day:
      +obj.day,

    hour:
      +obj.hour,

    minute:
      +obj.minute,

    weekday:
      weekdays[
        obj.weekday
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
  p
) {

  return (

    `${p.year}-` +

    `${pad(p.month)}-` +

    `${pad(p.day)}`

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
  keyMode = "latest"
) {

  const groups =
    new Map();


  for (
    const b of bars
  ) {

    const p =
      zoneParts(
        b.time,
        timezone
      );


    const minute =
      p.hour *
      60 +
      p.minute;


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
        b
      );

  }


  const keys = [

    ...groups.keys()

  ]
    .sort();


  const key =

    keyMode ===
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


  const arr =
    groups.get(
      key
    );


  const high =
    Math.max(
      ...arr.map(
        x =>
          x.high
      )
    );


  const low =
    Math.min(
      ...arr.map(
        x =>
          x.low
      )
    );


  return {

    date:
      key,

    high:
      r(
        high,
        2
      ),

    low:
      r(
        low,
        2
      ),

    open:
      r(
        arr[0].open,
        2
      ),

    close:
      r(
        arr.at(-1).close,
        2
      ),

    range:
      r(
        high -
        low,
        2
      ),

    bars:
      arr.length

  };

}


/* =========================================================
   NEXT SESSION EVENT
========================================================= */


function nextTransition(
  now,
  startMinute,
  endMinute,
  timezone
) {

  const state =
    date => {

      const p =
        zoneParts(
          date,
          timezone
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
        startMinute

        &&

        minute <
        endMinute

      );

    };


  let previous =
    state(
      now
    );


  for (
    let i = 1;
    i <= 10080;
    i++
  ) {

    const d =
      new Date(

        now.getTime()

        +

        i *
        60000

      );


    const s =
      state(
        d
      );


    if (
      s !==
      previous
    ) {

      return {

        type:
          s
            ?
            "OPEN"
            :
            "CLOSE",

        time:
          d

      };

    }


    previous =
      s;

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
   SESSIONS
========================================================= */


function buildSessions(
  m1,
  m5,
  now
) {

  const defs = [

    {

      id:
        "premarket",

      name:
        "US Premarket",

      tz:
        "America/New_York",

      start:
        240,

      end:
        570

    },


    {

      id:
        "cash",

      name:
        "New York Cash",

      tz:
        "America/New_York",

      start:
        570,

      end:
        960

    },


    {

      id:
        "powerhour",

      name:
        "Power Hour",

      tz:
        "America/New_York",

      start:
        900,

      end:
        960

    },


    {

      id:
        "london",

      name:
        "London",

      tz:
        "Europe/London",

      start:
        480,

      end:
        1020

    }

  ];


  return defs.map(
    d => {

      const transition =
        nextTransition(

          now,

          d.start,

          d.end,

          d.tz

        );


      const p =
        zoneParts(
          now,
          d.tz
        );


      const minute =
        p.hour *
        60 +
        p.minute;


      const active =

        p.weekday >=
        1

        &&

        p.weekday <=
        5

        &&

        minute >=
        d.start

        &&

        minute <
        d.end;


      let phase =

        active

          ?

          "ACTIVE"

          :

          "CLOSED";


      if (

        d.id ===
        "cash"

        &&

        active

        &&

        minute <
        630

      ) {

        phase =
          "CASH OPEN LIQUIDITY WINDOW";

      }


      else if (

        d.id ===
        "premarket"

        &&

        !active

        &&

        minute >=
        540

        &&

        minute <
        570

      ) {

        phase =
          "PRE-CASH-OPEN WINDOW";

      }


      else if (

        d.id ===
        "powerhour"

        &&

        active

      ) {

        phase =
          "CLOSING LIQUIDITY WINDOW";

      }


      return {

        id:
          d.id,

        name:
          d.name,

        zone:
          d.tz,

        active,

        phase,

        localTime:
          timeInZone(
            now,
            d.tz
          ),

        openLocal:
          minLabel(
            d.start
          ),

        closeLocal:
          minLabel(
            d.end
          ),

        nextEvent:
          transition.type,

        nextEventAt:
          transition.time
            .toISOString(),

        range:
          windowRange(

            d.id ===
            "premarket"

              ?

              m1

              :

              m5,

            d.tz,

            d.start,

            d.end

          )

      };

    }
  );

}


/* =========================================================
   REFERENCE LEVELS
========================================================= */


function referenceLevels(
  h1,
  m15,
  price,
  atr15
) {

  const day =
    windowRange(

      h1,

      "America/New_York",

      0,

      1440,

      "previous"

    );


  const previousCash =
    windowRange(

      m15,

      "America/New_York",

      570,

      960,

      "previous"

    );


  const premarket =
    windowRange(

      m15,

      "America/New_York",

      240,

      570

    );


  const overnight =
    windowRange(

      m15,

      "America/New_York",

      0,

      240

    );


  const openingRange30 =
    windowRange(

      m15,

      "America/New_York",

      570,

      600

    );


  const eq =
    equalClusters(
      m15,
      atr15
    );


  const swings =
    pivots(
      h1,
      3,
      160
    );


  const roundStep =
    100;


  const base =
    Math.round(
      price /
      roundStep
    ) *
    roundStep;


  return {

    previousDay:
      day,

    previousCash,

    premarket,

    overnight,

    openingRange30,


    equalHighs:
      eq.highs,


    equalLows:
      eq.lows,


    h1Highs:
      swings.highs
        .slice(-5)
        .reverse()
        .map(
          x =>
            r(
              x.price,
              2
            )
        ),


    h1Lows:
      swings.lows
        .slice(-5)
        .reverse()
        .map(
          x =>
            r(
              x.price,
              2
            )
        ),


    roundNumbers: [

      base -
      200,

      base -
      100,

      base,

      base +
      100,

      base +
      200

    ]

  };

}


/* =========================================================
   EQUAL HIGH / LOW
========================================================= */


function equalClusters(
  bars,
  atr15
) {

  const p =
    pivots(
      bars,
      2,
      180
    );


  const tolerance =
    Math.max(

      6,

      (
        atr15 ||
        50
      )

      *

      0.10

    );


  return {

    highs:
      cluster(

        p.highs.map(
          x =>
            x.price
        ),

        tolerance

      ),


    lows:
      cluster(

        p.lows.map(
          x =>
            x.price
        ),

        tolerance

      )

  };

}


function cluster(
  values,
  tolerance
) {

  const clusters =
    [];


  for (
    const price of values
  ) {

    let group =
      clusters.find(

        x =>
          Math.abs(
            x.price -
            price
          )

          <=

          tolerance

      );


    if (
      !group
    ) {

      clusters.push({

        price,

        touches:
          1

      });


    } else {


      group.price =

        (
          group.price *
          group.touches

          +

          price
        )

        /

        (
          group.touches +
          1
        );


      group.touches++;

    }

  }


  return clusters

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
      4
    )

    .map(
      x => ({

        price:
          r(
            x.price,
            2
          ),

        touches:
          x.touches

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


  const useVolume =

    recent.filter(
      x =>
        x.volume >
        0
    ).length

    >=

    recent.length *
    0.5;


  const medianRange =
    median(

      recent.map(
        x =>
          Math.max(
            x.high -
            x.low,
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
      x => {

        const range =
          Math.max(
            x.high -
            x.low,
            0.01
          );


        const body =

          (
            x.close -
            x.open
          )

          /

          range;


        const clv =

          (

            (
              x.close -
              x.low
            )

            -

            (
              x.high -
              x.close
            )

          )

          /

          range;


        const activity =

          useVolume

            ?

            Math.max(
              x.volume,
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

            0.30 *
            clv

            +

            0.20 *
            body,

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
            x.close,

          activity,

          buy,

          sell,

          delta:
            buy -
            sell,

          high:
            x.high,

          low:
            x.low,

          open:
            x.open,

          close:
            x.close

        };

      }
    );


  let cvd =
    0;


  rows.forEach(
    x => {

      cvd +=
        x.delta;


      x.cvd =
        cvd;

    }
  );


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
      r(
        cvd,
        1
      ),


    divergence:
      flowDivergence(
        rows
      ),


    absorption:
      absorption(
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
      r(
        activity,
        1
      ),

    delta:
      r(
        delta,
        1
      ),

    deltaPct:
      r(

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
        x =>
          x.delta
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


function absorption(
  bars,
  rows
) {

  const bs =
    bars.slice(
      -30
    );


  const rs =
    rows.slice(
      -30
    );


  const med =
    median(

      rs.map(
        x =>
          x.activity
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
      bs.length;
    i++
  ) {

    const b =
      bs[i];


    const f =
      rs[i];


    const range =
      Math.max(
        b.high -
        b.low,
        0.01
      );


    const upperWick =

      b.high -
      Math.max(
        b.open,
        b.close
      );


    const lowerWick =

      Math.min(
        b.open,
        b.close
      )

      -

      b.low;


    if (

      f.activity >
      med *
      1.35

      &&

      f.delta >
      0

      &&

      upperWick /
      range >
      0.45

    ) {

      upper++;

    }


    if (

      f.activity >
      med *
      1.35

      &&

      f.delta <
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
    ).length

    >=

    bars.length *
    0.5;


  const arr =
    Array.from(

      {
        length:
          bins
      },

      (
        _,
        i
      ) => ({

        price:
          low +
          (
            i +
            0.5
          ) *
          step,

        volume:
          0

      })

    );


  for (
    const b of bars
  ) {

    const typical =

      (
        b.high +
        b.low +
        b.close
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


    arr[
      index
    ].volume +=

      useVolume

        ?

        Math.max(
          b.volume,
          1
        )

        :

        1;

  }


  const descending =
    [
      ...arr
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
      ...arr
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

        "Activity Profile",


    poc:
      r(
        descending[0].price,
        2
      ),


    hvn:
      descending
        .slice(
          0,
          3
        )
        .map(
          x =>
            r(
              x.price,
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
          x =>
            r(
              x.price,
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
    const b of m15
  ) {

    const p =
      nyParts(
        b.time
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
        b
      );

  }


  const highEvents =
    [];


  const lowEvents =
    [];


  let eligible =
    0;


  const dates =
    [
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
        b => {

          const p =
            nyParts(
              b.time
            );


          const minute =
            p.hour *
            60 +
            p.minute;


          return (

            minute >=
            240

            &&

            minute <
            570

          );

        }
      );


    const postOpen =
      rows.filter(
        b => {

          const p =
            nyParts(
              b.time
            );


          const minute =
            p.hour *
            60 +
            p.minute;


          return (

            minute >=
            570

            &&

            minute <
            720

          );

        }
      );


    if (

      premarket.length <
      12

      ||

      postOpen.length <
      4

    ) {

      continue;

    }


    eligible++;


    const high =
      Math.max(
        ...premarket.map(
          x =>
            x.high
        )
      );


    const low =
      Math.min(
        ...premarket.map(
          x =>
            x.low
        )
      );


    const atrValue =

      last(
        atrSeries(
          premarket,
          14
        )
      )

      ||

      mean(

        premarket.map(
          x =>
            x.high -
            x.low
        )

      );


    const highEvent =
      sweepEvent(

        postOpen,

        high,

        "HIGH",

        atrValue

      );


    const lowEvent =
      sweepEvent(

        postOpen,

        low,

        "LOW",

        atrValue

      );


    if (
      highEvent
    ) {

      highEvents.push(
        highEvent
      );

    }


    if (
      lowEvent
    ) {

      lowEvents.push(
        lowEvent
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

      b =>

        side ===
        "HIGH"

          ?

          b.high >
          level

          :

          b.low <
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
      index + 12
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

      &&

      (

        (
          side ===
          "HIGH"

          &&

          sample[i].close <
          level
        )

        ||

        (
          side ===
          "LOW"

          &&

          sample[i].close >
          level
        )

      )

    ) {

      reversed =
        true;


      barsBack =
        i;


      break;

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
        x =>
          x.overshootAtr
      )

      .filter(
        Number.isFinite
      );


  const reversals =
    events.filter(
      x =>
        x.reversed
    ).length;


  return {

    sweeps:
      events.length,


    sweepRatePct:
      r(

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
      r(

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
      r(

        percentile(
          overshoots,
          0.25
        )

        ||

        0.08,

        3

      ),


    medianOvershootAtr:
      r(

        percentile(
          overshoots,
          0.5
        )

        ||

        0.18,

        3

      ),


    p75OvershootAtr:
      r(

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
   LIQUIDITY POOLS
========================================================= */


function rankPools(
  ctx
) {

  const {

    price,

    atr15,

    atrH1,

    refs

  } =
    ctx;


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


  add(
    "Premarket High",
    refs.premarket?.high,
    "HIGH",
    "PREMARKET_HIGH",
    1.55
  );


  add(
    "Premarket Low",
    refs.premarket?.low,
    "LOW",
    "PREMARKET_LOW",
    1.55
  );


  add(
    "Opening Range High",
    refs.openingRange30?.high,
    "HIGH",
    "OR_HIGH",
    1.45
  );


  add(
    "Opening Range Low",
    refs.openingRange30?.low,
    "LOW",
    "OR_LOW",
    1.45
  );


  add(
    "Previous Cash High",
    refs.previousCash?.high,
    "HIGH",
    "PREV_CASH_HIGH",
    1.35
  );


  add(
    "Previous Cash Low",
    refs.previousCash?.low,
    "LOW",
    "PREV_CASH_LOW",
    1.35
  );


  add(
    "Previous Day High",
    refs.previousDay?.high,
    "HIGH",
    "PDH",
    1.50
  );


  add(
    "Previous Day Low",
    refs.previousDay?.low,
    "LOW",
    "PDL",
    1.50
  );


  refs.equalHighs
    .forEach(
      x =>
        add(

          `Equal Highs (${x.touches}x)`,

          x.price,

          "HIGH",

          "EQH",

          1.30

        )
    );


  refs.equalLows
    .forEach(
      x =>
        add(

          `Equal Lows (${x.touches}x)`,

          x.price,

          "LOW",

          "EQL",

          1.30

        )
    );


  refs.h1Highs
    .slice(
      0,
      3
    )
    .forEach(
      x =>
        add(

          "H1 Swing High",

          x,

          "HIGH",

          "H1_HIGH",

          1

        )
    );


  refs.h1Lows
    .slice(
      0,
      3
    )
    .forEach(
      x =>
        add(

          "H1 Swing Low",

          x,

          "LOW",

          "H1_LOW",

          1

        )
    );


  refs.roundNumbers
    .forEach(
      x =>
        add(

          `Round ${Math.round(x)}`,

          x,

          x >= price
            ?
            "HIGH"
            :
            "LOW",

          "ROUND",

          0.85

        )
    );


  const merged =
    mergePool(

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
          ctx
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


function mergePool(
  pools,
  tolerance
) {

  const out =
    [];


  for (
    const x of
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
      out.find(

        y =>

          y.side ===
          x.side

          &&

          Math.abs(
            y.level -
            x.level
          )

          <=

          tolerance

      );


    if (
      !existing
    ) {

      out.push({

        ...x,

        aliases:
          []

      });


    } else {


      existing.aliases
        .push(
          x.name
        );


      if (

        x.importance >
        existing.importance

      ) {

        existing.name =
          x.name;


        existing.type =
          x.type;


        existing.importance =
          x.importance;

      }


      existing.level =

        (
          existing.level +
          x.level
        )

        /

        2;

    }

  }


  return out;

}


/* =========================================================
   POOL SCORE + SWEEP END
========================================================= */


function enrichPool(
  pool,
  ctx
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
    ctx;


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


  const trend =

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


  const flowDelta =
    flow.last15.deltaPct ||
    0;


  const cash =
    sessions.find(
      x =>
        x.id ===
        "cash"
    );


  const premarket =
    sessions.find(
      x =>
        x.id ===
        "premarket"
    );


  let score =

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
      trend /
      6,

      -14,

      14

    )

    +

    clamp(

      direction *
      flowDelta /
      3,

      -10,

      10

    );


  if (

    cash?.phase ===
    "CASH OPEN LIQUIDITY WINDOW"

  ) {

    score +=
      14;

  }


  if (

    premarket?.phase ===
    "PRE-CASH-OPEN WINDOW"

  ) {

    score +=
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
     HISTORICAL SWEEP DEPTH
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


  let median =

    historical
      ?.medianOvershootAtr

    ||

    0.22;


  let q75 =

    historical
      ?.p75OvershootAtr

    ||

    0.45;


  /* Strong directional flow can push the stop-run deeper. */

  if (

    direction *
    flowDelta >
    18

  ) {

    median *=
      1.22;


    q75 *=
      1.32;

  }


  /* Absorption can shorten expected extension. */

  if (

    pool.side ===
    "HIGH"

    &&

    flow.absorption
      .includes(
        "BUYING"
      )

  ) {

    median *=
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

    median *=
      0.72;


    q75 *=
      0.82;

  }


  const zone1 =

    pool.level

    +

    direction *
    q25 *
    atr5;


  const likelyEnd =

    pool.level

    +

    direction *
    median *
    atr5;


  const zone2 =

    pool.level

    +

    direction *
    q75 *
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


  const profileConfluence =
    [

      profile.poc,

      ...profile.hvn,

      ...profile.lvn

    ]
      .filter(

        x =>

          Number.isFinite(
            x
          )

          &&

          x >=
          zoneLow -
          atr5 *
          0.15

          &&

          x <=
          zoneHigh +
          atr5 *
          0.15

      )

      .map(
        x =>
          `Volume node ${r(x,0)}`
      );


  let raidStyle =
    "SHALLOW RAID";


  if (
    median <
    0.12
  ) {

    raidStyle =
      "LEVEL TAG / VERY SHALLOW";

  }


  else if (
    median >
    0.35
  ) {

    raidStyle =
      "DEEPER SWEEP POSSIBLE";

  }


  return {

    ...pool,


    level:
      r(
        pool.level,
        2
      ),


    distance:
      r(
        distance,
        2
      ),


    distanceAtr:
      r(
        distanceAtr,
        2
      ),


    likelihoodScore:
      r(
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
        r(
          pool.level,
          2
        ),


      likelyEnd:
        r(
          likelyEnd,
          2
        ),


      zoneLow:
        r(
          zoneLow,
          2
        ),


      zoneHigh:
        r(
          zoneHigh,
          2
        ),


      overshoot:
        r(

          Math.abs(
            likelyEnd -
            pool.level
          ),

          2

        ),


      overshootAtr:
        r(
          median,
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

      `${r(distanceAtr,2)}× M15 ATR from price`,

      `Liquidity importance ${r(pool.importance,2)}×`,

      `15m delta proxy ${r(flowDelta,1)}%`,

      cash?.phase ===
      "CASH OPEN LIQUIDITY WINDOW"

        ?

        "US cash-open liquidity window active"

        :

        null,

      ...profileConfluence

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

  const out =
    [];


  for (
    const s of sessions
  ) {

    let score =
      0;


    const reasons =
      [];


    if (
      s.phase ===
      "PRE-CASH-OPEN WINDOW"
    ) {

      score +=
        72;


      reasons.push(
        "US cash open approaching"
      );

    }


    if (
      s.phase ===
      "CASH OPEN LIQUIDITY WINDOW"
    ) {

      score +=
        84;


      reasons.push(
        "First hour after 09:30 ET cash open"
      );

    }


    if (
      s.phase ===
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

        x =>
          x.distance <=
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
      score
    ) {

      out.push({

        session:
          s.name,

        phase:
          s.phase,

        score:
          r(
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

    out.push({

      session:
        "Primary liquidity magnet",

      phase:
        pools[0].name,

      score:
        pools[0].likelihoodScore,

      risk:
        pools[0].likelihood,

      reasons: [

        `Current ${r(price,2)} → ${pools[0].level}`,

        `Projected raid end ${pools[0].projectedSweep.likelyEnd}`

      ]

    });

  }


  return out

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
   REGIME
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


  const atrValues =
    atrSeries(
      m5,
      14
    )
      .filter(
        Number.isFinite
      );


  const ratio =

    atr5

    /

    Math.max(

      median(
        atrValues
      )

      ||

      atr5,

      0.01

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


  const orderFlow =

    flow.last15.deltaPct >
    18

      ?

      "BUY DOMINANT"

      :

      flow.last15.deltaPct <
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
      r(
        ratio,
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


  const lower =
    Math.floor(
      position
    );


  const upper =
    Math.ceil(
      position
    );


  const weight =
    position -
    lower;


  return (

    sorted[lower] *
    (
      1 -
      weight
    )

    +

    sorted[upper] *
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


function r(
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


  const power =
    10 **
    decimals;


  return (

    Math.round(
      value *
      power
    )

    /

    power

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


function minLabel(
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