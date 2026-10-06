/* ================================================================
   MKAYFX GOLD INTELLIGENCE V9.1
   REST-ONLY LIQUIDITY ENGINE
   /api/xau.js

   API 1
   TWELVE_DATA_API_KEY
   XAU M1 + M5

   API 2
   TWELVE_DATA_API_KEY_2
   XAU M15 + H1 + H4

   API 3
   TWELVE_DATA_API_KEY_3
   Historical XAU M5

   API 4
   TWELVE_DATA_API_KEY_4
   Secondary XAU + intermarket

   FRED
   FRED_API_KEY

   IMPORTANT
   ---------------------------------------------------------------
   /api/price.js handles lightweight fast REST price polling.

   /api/xau.js handles deeper calculations.
================================================================ */


const TD_BASE =
  "https://api.twelvedata.com";


const FRED_BASE =
  "https://api.stlouisfed.org/fred";


const KEY_1 =
  process.env.TWELVE_DATA_API_KEY ||
  "";


const KEY_2 =
  process.env.TWELVE_DATA_API_KEY_2 ||
  KEY_1;


const KEY_3 =
  process.env.TWELVE_DATA_API_KEY_3 ||
  KEY_1;


const KEY_4 =
  process.env.TWELVE_DATA_API_KEY_4 ||
  KEY_1;


const FRED_KEY =
  process.env.FRED_API_KEY ||
  "";


const SYMBOL =
  "XAU/USD";


const DEEP_CACHE_MS =
  30000;


const HISTORY_CACHE_MS =
  15 *
  60 *
  1000;


const INTERMARKET_CACHE_MS =
  3 *
  60 *
  1000;


const MACRO_CACHE_MS =
  20 *
  60 *
  1000;


let deepCache = {
  time:0,
  value:null
};


let historyCache = {
  time:0,
  value:null
};


let intermarketCache = {
  time:0,
  value:null
};


let macroCache = {
  time:0,
  value:null
};


/* ================================================================
   HELPERS
================================================================ */

function finite(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;

  }


  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )
    ? n
    : null;

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
      Number(
        value
      ) ||
      0
    )
  );

}


function round(
  value,
  decimals = 2
) {

  const n =
    finite(
      value
    );


  if (
    n === null
  ) {

    return null;

  }


  const p =
    10 **
    decimals;


  return Math.round(
    n *
    p
  ) /
  p;

}


function mean(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );


  if (
    !clean.length
  ) {

    return 0;

  }


  return clean.reduce(
    (
      sum,
      value
    ) =>
      sum +
      value,
    0
  ) /
  clean.length;

}


function median(
  values
) {

  if (
    !values.length
  ) {

    return 0;

  }


  const sorted =
    [
      ...values
    ].sort(
      (
        a,
        b
      ) =>
        a -
        b
    );


  const middle =
    Math.floor(
      sorted.length /
      2
    );


  return sorted.length %
    2
      ? sorted[
          middle
        ]
      : (
          sorted[
            middle -
            1
          ] +
          sorted[
            middle
          ]
        ) /
        2;

}


function last(
  array
) {

  return array?.length
    ? array[
        array.length -
        1
      ]
    : null;

}


function unique(
  values
) {

  return [
    ...new Set(
      values
    )
  ];

}


function isoDay(
  timestamp
) {

  return new Date(
    timestamp
  )
  .toISOString()
  .slice(
    0,
    10
  );

}


function utcHour(
  timestamp
) {

  return new Date(
    timestamp
  )
  .getUTCHours();

}


/* ================================================================
   SESSION
================================================================ */

function currentSession() {

  const hour =
    new Date()
      .getUTCHours();


  if (
    hour >= 12 &&
    hour < 16
  ) {

    return "LONDON / NEW YORK";

  }


  if (
    hour >= 7 &&
    hour < 12
  ) {

    return "LONDON";

  }


  if (
    hour >= 16 &&
    hour < 21
  ) {

    return "NEW YORK";

  }


  if (
    hour < 7
  ) {

    return "ASIA";

  }


  return "TRANSITION";

}


/* ================================================================
   TWELVE DATA
================================================================ */

function parseTimestamp(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;

  }


  let text =
    String(
      value
    );


  if (
    !text.includes(
      "T"
    ) &&
    text.includes(
      " "
    )
  ) {

    text =
      text.replace(
        " ",
        "T"
      );

  }


  if (
    !/[zZ]|[+-]\d\d:\d\d$/.test(
      text
    )
  ) {

    text +=
      "Z";

  }


  const parsed =
    Date.parse(
      text
    );


  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;

}


function parseValues(
  json
) {

  if (
    !Array.isArray(
      json?.values
    )
  ) {

    throw new Error(
      json?.message ||
      "No Twelve Data candles returned."
    );

  }


  return json.values

    .map(
      row => {

        const time =
          parseTimestamp(
            row.datetime
          );


        const open =
          finite(
            row.open
          );


        const high =
          finite(
            row.high
          );


        const low =
          finite(
            row.low
          );


        const close =
          finite(
            row.close
          );


        if (
          time === null ||
          open === null ||
          high === null ||
          low === null ||
          close === null ||
          open <= 0 ||
          high <= 0 ||
          low <= 0 ||
          close <= 0
        ) {

          return null;

        }


        return {

          time,

          open,

          high,

          low,

          close,

          volume:
            finite(
              row.volume
            ) ??
            0

        };

      }
    )

    .filter(
      Boolean
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


async function tdSeries({
  symbol,
  interval,
  outputsize,
  key
}) {

  if (
    !key
  ) {

    throw new Error(
      "Missing Twelve Data API key."
    );

  }


  const url =

    `${TD_BASE}/time_series` +

    `?symbol=${encodeURIComponent(
      symbol
    )}` +

    `&interval=${interval}` +

    `&outputsize=${outputsize}` +

    `&order=asc` +

    `&timezone=UTC` +

    `&apikey=${encodeURIComponent(
      key
    )}`;


  const response =
    await fetch(
      url
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Twelve Data ${interval} HTTP ${response.status}`
    );

  }


  const json =
    await response.json();


  if (
    json.status ===
    "error"
  ) {

    throw new Error(
      json.message ||
      "Twelve Data error."
    );

  }


  return parseValues(
    json
  );

}


async function tdQuote(
  symbol,
  key
) {

  if (
    !key
  ) {

    return null;

  }


  const url =

    `${TD_BASE}/quote` +

    `?symbol=${encodeURIComponent(
      symbol
    )}` +

    `&apikey=${encodeURIComponent(
      key
    )}`;


  const response =
    await fetch(
      url
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Quote HTTP ${response.status}`
    );

  }


  const json =
    await response.json();


  if (
    json.status ===
    "error"
  ) {

    throw new Error(
      json.message ||
      "Quote error."
    );

  }


  return {

    price:
      finite(
        json.close ??
        json.price
      ),

    previousClose:
      finite(
        json.previous_close
      ),

    change:
      finite(
        json.change
      ),

    percentChange:
      finite(
        json.percent_change
      )

  };

}


/* ================================================================
   INDICATORS
================================================================ */

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


  let current =
    values[
      0
    ];


  return values.map(
    (
      value,
      index
    ) => {

      if (
        index === 0
      ) {

        current =
          value;

      } else {

        current =
          value *
          multiplier +
          current *
          (
            1 -
            multiplier
          );

      }


      return current;

    }
  );

}


function atrSeries(
  candles,
  period = 14
) {

  if (
    candles.length <
    2
  ) {

    return [];

  }


  const ranges = [
    candles[
      0
    ].high -
    candles[
      0
    ].low
  ];


  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const current =
      candles[
        i
      ];


    const previous =
      candles[
        i -
        1
      ];


    ranges.push(

      Math.max(

        current.high -
        current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )

      )

    );

  }


  return ema(
    ranges,
    period
  );

}


function atr(
  candles,
  period = 14
) {

  return last(
    atrSeries(
      candles,
      period
    )
  ) || 0;

}


function rsi(
  candles,
  period = 14
) {

  if (
    candles.length <
    period +
    2
  ) {

    return 50;

  }


  let gains =
    0;


  let losses =
    0;


  for (
    let i =
      candles.length -
      period;

    i < candles.length;

    i++
  ) {

    const change =
      candles[
        i
      ].close -
      candles[
        i -
        1
      ].close;


    if (
      change > 0
    ) {

      gains +=
        change;

    } else {

      losses +=
        Math.abs(
          change
        );

    }

  }


  const avgGain =
    gains /
    period;


  const avgLoss =
    losses /
    period;


  if (
    avgLoss === 0
  ) {

    return 100;

  }


  const rs =
    avgGain /
    avgLoss;


  return (
    100 -
    100 /
    (
      1 +
      rs
    )
  );

}


function macd(
  candles
) {

  const closes =
    candles.map(
      candle =>
        candle.close
    );


  if (
    closes.length <
    35
  ) {

    return {

      line:0,
      signal:0,
      histogram:0

    };

  }


  const fast =
    ema(
      closes,
      12
    );


  const slow =
    ema(
      closes,
      26
    );


  const line =
    closes.map(
      (
        _,
        index
      ) =>
        fast[
          index
        ] -
        slow[
          index
        ]
    );


  const signal =
    ema(
      line,
      9
    );


  return {

    line:
      last(
        line
      ),

    signal:
      last(
        signal
      ),

    histogram:
      last(
        line
      ) -
      last(
        signal
      )

  };

}


function roc(
  candles,
  bars = 10
) {

  if (
    candles.length <=
    bars
  ) {

    return 0;

  }


  const current =
    last(
      candles
    ).close;


  const previous =
    candles[
      candles.length -
      bars -
      1
    ].close;


  return previous
    ? (
        current -
        previous
      ) /
      previous *
      100
    : 0;

}


function vwap(
  candles,
  lookback = 150
) {

  const data =
    candles.slice(
      -lookback
    );


  let weighted =
    0;


  let total =
    0;


  for (
    const candle
    of data
  ) {

    const typical =
      (
        candle.high +
        candle.low +
        candle.close
      ) /
      3;


    const activity =
      candle.volume > 0
        ? candle.volume
        : Math.max(
            candle.high -
            candle.low,
            .0001
          );


    weighted +=
      typical *
      activity;


    total +=
      activity;

  }


  return total > 0
    ? weighted /
      total
    : last(
        data
      )?.close || 0;

}


/* ================================================================
   PIVOTS / STRUCTURE
================================================================ */

function pivotHigh(
  candles,
  index,
  length = 3
) {

  if (
    index < length ||
    index + length >=
    candles.length
  ) {

    return false;

  }


  const level =
    candles[
      index
    ].high;


  for (
    let i =
      index -
      length;

    i <=
      index +
      length;

    i++
  ) {

    if (
      i !== index &&
      candles[
        i
      ].high >=
      level
    ) {

      return false;

    }

  }


  return true;

}


function pivotLow(
  candles,
  index,
  length = 3
) {

  if (
    index < length ||
    index + length >=
    candles.length
  ) {

    return false;

  }


  const level =
    candles[
      index
    ].low;


  for (
    let i =
      index -
      length;

    i <=
      index +
      length;

    i++
  ) {

    if (
      i !== index &&
      candles[
        i
      ].low <=
      level
    ) {

      return false;

    }

  }


  return true;

}


function swings(
  candles,
  lookback = 180
) {

  const data =
    candles.slice(
      -lookback
    );


  const highs =
    [];


  const lows =
    [];


  for (
    let i = 3;
    i <
      data.length -
      3;
    i++
  ) {

    if (
      pivotHigh(
        data,
        i
      )
    ) {

      highs.push({

        time:
          data[
            i
          ].time,

        price:
          data[
            i
          ].high

      });

    }


    if (
      pivotLow(
        data,
        i
      )
    ) {

      lows.push({

        time:
          data[
            i
          ].time,

        price:
          data[
            i
          ].low

      });

    }

  }


  return {
    highs,
    lows
  };

}


function structure(
  candles
) {

  if (
    candles.length <
    55
  ) {

    return {

      bias:
        "NEUTRAL",

      score:
        0

    };

  }


  const closes =
    candles.map(
      candle =>
        candle.close
    );


  const e20 =
    last(
      ema(
        closes,
        20
      )
    );


  const e50 =
    last(
      ema(
        closes,
        50
      )
    );


  const price =
    last(
      candles
    ).close;


  let score =
    0;


  score +=
    price > e20
      ? 1
      : -1;


  score +=
    e20 > e50
      ? 1
      : -1;


  const recent =
    candles.slice(
      -10
    );


  const older =
    candles.slice(
      -20,
      -10
    );


  const recentHigh =
    Math.max(
      ...recent.map(
        candle =>
          candle.high
      )
    );


  const recentLow =
    Math.min(
      ...recent.map(
        candle =>
          candle.low
      )
    );


  const oldHigh =
    Math.max(
      ...older.map(
        candle =>
          candle.high
      )
    );


  const oldLow =
    Math.min(
      ...older.map(
        candle =>
          candle.low
      )
    );


  if (
    recentHigh >
    oldHigh &&
    recentLow >
    oldLow
  ) {

    score +=
      2;

  }


  if (
    recentHigh <
    oldHigh &&
    recentLow <
    oldLow
  ) {

    score -=
      2;

  }


  return {

    bias:
      score >= 2
        ? "BULLISH"
        : score <= -2
          ? "BEARISH"
          : "NEUTRAL",

    score,

    ema20:
      round(
        e20,
        2
      ),

    ema50:
      round(
        e50,
        2
      )

  };

}


/* ================================================================
   LEVELS
================================================================ */

function previousDay(
  candles
) {

  const days =
    unique(
      candles.map(
        candle =>
          isoDay(
            candle.time
          )
      )
    );


  if (
    days.length < 2
  ) {

    return null;

  }


  const day =
    days[
      days.length -
      2
    ];


  const data =
    candles.filter(
      candle =>
        isoDay(
          candle.time
        ) ===
        day
    );


  return {

    date:
      day,

    high:
      round(
        Math.max(
          ...data.map(
            candle =>
              candle.high
          )
        ),
        2
      ),

    low:
      round(
        Math.min(
          ...data.map(
            candle =>
              candle.low
          )
        ),
        2
      )

  };

}


function previousWeek(
  h1
) {

  const days =
    unique(
      h1.map(
        candle =>
          isoDay(
            candle.time
          )
      )
    );


  if (
    days.length < 8
  ) {

    return null;

  }


  const currentDay =
    new Date(
      last(
        h1
      ).time
    );


  const currentWeekStart =
    new Date(
      Date.UTC(
        currentDay.getUTCFullYear(),
        currentDay.getUTCMonth(),
        currentDay.getUTCDate() -
        (
          (
            currentDay.getUTCDay() +
            6
          ) %
          7
        )
      )
    );


  const previousStart =
    currentWeekStart.getTime() -
    7 *
    86400000;


  const previousEnd =
    currentWeekStart.getTime();


  const data =
    h1.filter(
      candle =>
        candle.time >=
        previousStart &&
        candle.time <
        previousEnd
    );


  if (
    !data.length
  ) {

    return null;

  }


  return {

    high:
      round(
        Math.max(
          ...data.map(
            candle =>
              candle.high
          )
        ),
        2
      ),

    low:
      round(
        Math.min(
          ...data.map(
            candle =>
              candle.low
          )
        ),
        2
      )

  };

}


const SESSION_DEFS = {

  ASIA:{
    start:0,
    end:7
  },

  LONDON:{
    start:7,
    end:16
  },

  NEW_YORK:{
    start:12,
    end:21
  }

};


function sessionRange(
  candles,
  day,
  definition
) {

  const data =
    candles.filter(
      candle => {

        if (
          isoDay(
            candle.time
          ) !==
          day
        ) {

          return false;

        }


        const hour =
          utcHour(
            candle.time
          );


        return (
          hour >=
          definition.start &&
          hour <
          definition.end
        );

      }
    );


  if (
    !data.length
  ) {

    return null;

  }


  return {

    high:
      Math.max(
        ...data.map(
          candle =>
            candle.high
        )
      ),

    low:
      Math.min(
        ...data.map(
          candle =>
            candle.low
        )
      )

  };

}


function currentSessions(
  m5
) {

  const day =
    isoDay(
      last(
        m5
      ).time
    );


  const result =
    {};


  for (
    const [
      name,
      definition
    ]
    of Object.entries(
      SESSION_DEFS
    )
  ) {

    const range =
      sessionRange(
        m5,
        day,
        definition
      );


    result[
      name
    ] =
      range
        ? {

            high:
              round(
                range.high,
                2
              ),

            low:
              round(
                range.low,
                2
              )

          }
        : null;

  }


  return result;

}


function dealingRange(
  h1
) {

  const data =
    h1.slice(
      -48
    );


  const high =
    Math.max(
      ...data.map(
        candle =>
          candle.high
      )
    );


  const low =
    Math.min(
      ...data.map(
        candle =>
          candle.low
      )
    );


  return {

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

    midpoint:
      round(
        (
          high +
          low
        ) /
        2,
        2
      )

  };

}


/* ================================================================
   EQUAL LEVELS
================================================================ */

function equalLevels(
  candles,
  atrValue
) {

  const swingData =
    swings(
      candles,
      220
    );


  const tolerance =
    Math.max(
      atrValue *
      .12,
      .05
    );


  function pairs(
    values
  ) {

    const output =
      [];


    const recent =
      values.slice(
        -20
      );


    for (
      let i = 0;
      i < recent.length;
      i++
    ) {

      for (
        let j =
          i +
          1;

        j < recent.length;

        j++
      ) {

        if (
          Math.abs(
            recent[
              i
            ].price -
            recent[
              j
            ].price
          ) <=
          tolerance
        ) {

          output.push({

            level:
              round(
                (
                  recent[
                    i
                  ].price +
                  recent[
                    j
                  ].price
                ) /
                2,
                2
              )

          });

        }

      }

    }


    return output.slice(
      -8
    );

  }


  return {

    highs:
      pairs(
        swingData.highs
      ),

    lows:
      pairs(
        swingData.lows
      )

  };

}


/* ================================================================
   FVG
================================================================ */

function fairValueGaps(
  candles
) {

  const output =
    [];


  for (
    let i = 2;
    i < candles.length;
    i++
  ) {

    const first =
      candles[
        i -
        2
      ];


    const third =
      candles[
        i
      ];


    if (
      third.low >
      first.high
    ) {

      output.push({

        direction:
          "BULLISH",

        low:
          round(
            first.high,
            2
          ),

        high:
          round(
            third.low,
            2
          ),

        time:
          third.time

      });

    }


    if (
      third.high <
      first.low
    ) {

      output.push({

        direction:
          "BEARISH",

        low:
          round(
            third.high,
            2
          ),

        high:
          round(
            first.low,
            2
          ),

        time:
          third.time

      });

    }

  }


  return output.slice(
    -14
  );

}


/* ================================================================
   FLOW
================================================================ */

function flowEngine(
  m1
) {

  const data =
    m1.slice(
      -120
    );


  let cvd =
    0;


  let recentDelta =
    0;


  data.forEach(
    (
      candle,
      index
    ) => {

      const range =
        Math.max(
          candle.high -
          candle.low,
          .00001
        );


      const body =
        candle.close -
        candle.open;


      const activity =
        candle.volume > 0
          ? candle.volume
          : range;


      const delta =
        activity *
        clamp(
          body /
          range,
          -1,
          1
        );


      cvd +=
        delta;


      if (
        index >=
        data.length -
        12
      ) {

        recentDelta +=
          delta;

      }

    }
  );


  return {

    delta:
      round(
        recentDelta,
        2
      ),

    cvd:
      round(
        cvd,
        2
      ),

    bias:
      recentDelta > 0
        ? "BUYING PRESSURE"
        : recentDelta < 0
          ? "SELLING PRESSURE"
          : "BALANCED",

    note:
      "Candle/activity proxy."

  };

}


/* ================================================================
   LIQUIDITY
================================================================ */

function buildRawLevels({
  sessions,
  day,
  week,
  h1,
  equal
}) {

  const levels =
    [];


  function add(
    name,
    level,
    side,
    strength,
    type
  ) {

    const price =
      finite(
        level
      );


    if (
      price === null ||
      price <= 0
    ) {

      return;

    }


    levels.push({

      name,

      level:
        price,

      side,

      strength,

      type

    });

  }


  if (
    sessions.ASIA
  ) {

    add(
      "ASIA HIGH",
      sessions.ASIA.high,
      "BUY_SIDE",
      68,
      "SESSION"
    );


    add(
      "ASIA LOW",
      sessions.ASIA.low,
      "SELL_SIDE",
      68,
      "SESSION"
    );

  }


  if (
    sessions.LONDON
  ) {

    add(
      "LONDON HIGH",
      sessions.LONDON.high,
      "BUY_SIDE",
      80,
      "SESSION"
    );


    add(
      "LONDON LOW",
      sessions.LONDON.low,
      "SELL_SIDE",
      80,
      "SESSION"
    );

  }


  if (
    sessions.NEW_YORK
  ) {

    add(
      "NEW YORK HIGH",
      sessions.NEW_YORK.high,
      "BUY_SIDE",
      84,
      "SESSION"
    );


    add(
      "NEW YORK LOW",
      sessions.NEW_YORK.low,
      "SELL_SIDE",
      84,
      "SESSION"
    );

  }


  if (
    day
  ) {

    add(
      "PREVIOUS DAY HIGH",
      day.high,
      "BUY_SIDE",
      90,
      "DAILY"
    );


    add(
      "PREVIOUS DAY LOW",
      day.low,
      "SELL_SIDE",
      90,
      "DAILY"
    );

  }


  if (
    week
  ) {

    add(
      "PREVIOUS WEEK HIGH",
      week.high,
      "BUY_SIDE",
      96,
      "WEEKLY"
    );


    add(
      "PREVIOUS WEEK LOW",
      week.low,
      "SELL_SIDE",
      96,
      "WEEKLY"
    );

  }


  const h1Swings =
    swings(
      h1,
      200
    );


  h1Swings.highs
    .slice(
      -5
    )
    .forEach(
      item => {

        add(
          "H1 SWING HIGH",
          item.price,
          "BUY_SIDE",
          76,
          "H1_SWING"
        );

      }
    );


  h1Swings.lows
    .slice(
      -5
    )
    .forEach(
      item => {

        add(
          "H1 SWING LOW",
          item.price,
          "SELL_SIDE",
          76,
          "H1_SWING"
        );

      }
    );


  equal.highs
    .forEach(
      item => {

        add(
          "EQUAL HIGHS",
          item.level,
          "BUY_SIDE",
          88,
          "EQUAL_LEVEL"
        );

      }
    );


  equal.lows
    .forEach(
      item => {

        add(
          "EQUAL LOWS",
          item.level,
          "SELL_SIDE",
          88,
          "EQUAL_LEVEL"
        );

      }
    );


  return levels;

}


function approachScore(
  m5,
  side,
  atrValue
) {

  const data =
    m5.slice(
      -14
    );


  if (
    data.length < 8
  ) {

    return 0;

  }


  const move =
    last(
      data
    ).close -
    data[
      0
    ].close;


  const directional =
    side ===
    "BUY_SIDE"
      ? move
      : -move;


  return clamp(
    directional /
    Math.max(
      atrValue,
      .01
    ) *
    35 +
    40,
    0,
    100
  );

}


function clusterLiquidity({
  levels,
  price,
  atrValue,
  m5
}) {

  const mergeDistance =
    Math.max(
      atrValue *
      .22,
      .2
    );


  const groups =
    [];


  for (
    const side
    of [
      "BUY_SIDE",
      "SELL_SIDE"
    ]
  ) {

    const sorted =
      levels

        .filter(
          item =>
            item.side ===
            side
        )

        .sort(
          (
            a,
            b
          ) =>
            a.level -
            b.level
        );


    let current =
      [];


    for (
      const item
      of sorted
    ) {

      if (
        !current.length
      ) {

        current = [
          item
        ];

        continue;

      }


      const average =
        mean(
          current.map(
            item =>
              item.level
          )
        );


      if (
        Math.abs(
          item.level -
          average
        ) <=
        mergeDistance
      ) {

        current.push(
          item
        );

      } else {

        groups.push(
          current
        );


        current = [
          item
        ];

      }

    }


    if (
      current.length
    ) {

      groups.push(
        current
      );

    }

  }


  return groups

    .map(
      (
        group,
        index
      ) => {

        const side =
          group[
            0
          ].side;


        const prices =
          group.map(
            item =>
              item.level
          );


        const buffer =
          atrValue *
          .05;


        const low =
          Math.min(
            ...prices
          ) -
          buffer;


        const high =
          Math.max(
            ...prices
          ) +
          buffer;


        const center =
          (
            low +
            high
          ) /
          2;


        const distance =
          Math.abs(
            price -
            center
          );


        const distanceATR =
          distance /
          Math.max(
            atrValue,
            .01
          );


        const proximity =
          clamp(
            100 -
            distanceATR *
            23,
            0,
            100
          );


        const density =
          clamp(
            group.length *
            20,
            20,
            100
          );


        const strength =
          mean(
            group.map(
              item =>
                item.strength
            )
          );


        const approach =
          approachScore(
            m5,
            side,
            atrValue
          );


        let raidScore =
          clamp(
            strength *
            .36 +
            density *
            .18 +
            proximity *
            .28 +
            approach *
            .18,
            0,
            100
          );


        const current =
          last(
            m5
          );


        let stage =
          "TRACKING";


        const penetrated =
          side ===
          "BUY_SIDE"
            ? current.high >
              high
            : current.low <
              low;


        const rejected =
          side ===
          "BUY_SIDE"
            ? penetrated &&
              current.close <
              high
            : penetrated &&
              current.close >
              low;


        if (
          rejected
        ) {

          stage =
            "REJECTING";


          raidScore =
            Math.max(
              raidScore,
              92
            );

        } else if (
          penetrated
        ) {

          stage =
            "RAIDING";


          raidScore =
            Math.max(
              raidScore,
              88
            );

        } else if (
          distanceATR <=
          .25
        ) {

          stage =
            "ATTACKING";

        } else if (
          distanceATR <=
          .8
        ) {

          stage =
            "APPROACHING";

        }


        const name =
          group.length >=
          3
            ? (
                side ===
                "BUY_SIDE"
                  ? "MAJOR BUY-SIDE CLUSTER"
                  : "MAJOR SELL-SIDE CLUSTER"
              )
            : group.length ===
              2
              ? (
                  side ===
                  "BUY_SIDE"
                    ? "BUY-SIDE CLUSTER"
                    : "SELL-SIDE CLUSTER"
                )
              : group[
                  0
                ].name;


        return {

          id:
            `LQ-${side}-${index}`,

          name,

          side,

          price:
            round(
              center,
              2
            ),

          level:
            round(
              center,
              2
            ),

          center:
            round(
              center,
              2
            ),

          low:
            round(
              low,
              2
            ),

          high:
            round(
              high,
              2
            ),

          distance:
            round(
              distance,
              2
            ),

          distanceATR:
            round(
              distanceATR,
              2
            ),

          density:
            round(
              density,
              1
            ),

          structuralStrength:
            round(
              strength,
              1
            ),

          approachScore:
            round(
              approach,
              1
            ),

          raidLikelihood:
            round(
              raidScore,
              1
            ),

          raidScore:
            round(
              raidScore,
              1
            ),

          lifecycle:{

            stage,

            penetrated,

            rejected

          },

          components:
            group

        };

      }
    )

    .filter(
      zone =>
        zone.distanceATR <=
        8
    )

    .map(
      zone => ({

        ...zone,

        nextTargetScore:
          round(
            clamp(
              zone.raidScore *
              .55 +
              (
                100 -
                Math.min(
                  zone.distanceATR *
                  20,
                  100
                )
              ) *
              .45,
              0,
              100
            ),
            1
          )

      })
    )

    .sort(
      (
        a,
        b
      ) =>
        b.nextTargetScore -
        a.nextTargetScore
    );

}


/* ================================================================
   DISPLACEMENT
================================================================ */

function displacement(
  candles
) {

  const latest =
    last(
      candles
    );


  const averageRange =
    mean(
      candles
        .slice(
          -21,
          -1
        )
        .map(
          candle =>
            candle.high -
            candle.low
        )
    );


  const range =
    latest.high -
    latest.low;


  const body =
    Math.abs(
      latest.close -
      latest.open
    );


  const expansion =
    averageRange > 0
      ? range /
        averageRange
      : 0;


  return {

    active:
      expansion >=
      1.45 &&
      body /
      Math.max(
        range,
        .0001
      ) >=
      .62,

    direction:
      latest.close >=
      latest.open
        ? "BULLISH"
        : "BEARISH",

    expansion:
      round(
        expansion,
        2
      )

  };

}


/* ================================================================
   INTERMARKET
================================================================ */

async function loadIntermarket(
  force = false
) {

  if (
    !force &&
    intermarketCache.value &&
    Date.now() -
    intermarketCache.time <
    INTERMARKET_CACHE_MS
  ) {

    return intermarketCache.value;

  }


  const symbols = [
    "XAG/USD",
    "EUR/USD",
    "USD/JPY",
    "BTC/USD"
  ];


  const results =
    await Promise.all(

      symbols.map(
        symbol =>

          tdSeries({

            symbol,

            interval:
              "1h",

            outputsize:
              30,

            key:
              KEY_4

          })
          .catch(
            () => []
          )

      )

    );


  const markets =
    symbols.map(
      (
        symbol,
        index
      ) => {

        const candles =
          results[
            index
          ];


        if (
          candles.length < 2
        ) {

          return {

            symbol,

            available:
              false

          };

        }


        const current =
          last(
            candles
          ).close;


        const previous =
          candles[
            candles.length -
            2
          ].close;


        return {

          symbol,

          available:
            true,

          price:
            round(
              current,
              symbol ===
              "BTC/USD"
                ? 1
                : 5
            ),

          changePercent:
            round(
              (
                current -
                previous
              ) /
              previous *
              100,
              3
            )

        };

      }
    );


  const result = {

    markets,

    bias:
      "CONTEXT ONLY"

  };


  intermarketCache = {

    time:
      Date.now(),

    value:
      result

  };


  return result;

}


/* ================================================================
   FRED
================================================================ */

async function fredSeries(
  id
) {

  if (
    !FRED_KEY
  ) {

    return [];

  }


  const url =

    `${FRED_BASE}/series/observations` +

    `?series_id=${id}` +

    `&api_key=${FRED_KEY}` +

    `&file_type=json` +

    `&sort_order=desc` +

    `&limit=5`;


  const response =
    await fetch(
      url
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `FRED ${id} failed.`
    );

  }


  const json =
    await response.json();


  return (
    json.observations ||
    []
  )

    .filter(
      row =>
        row.value !==
        "."
    )

    .map(
      row => ({

        date:
          row.date,

        value:
          Number(
            row.value
          )

      }));

}


async function loadMacro(
  force = false
) {

  if (
    !force &&
    macroCache.value &&
    Date.now() -
    macroCache.time <
    MACRO_CACHE_MS
  ) {

    return macroCache.value;

  }


  if (
    !FRED_KEY
  ) {

    return {

      enabled:
        false

    };

  }


  try {

    const [
      dgs2,
      dgs10,
      fed
    ] =
      await Promise.all([

        fredSeries(
          "DGS2"
        ),

        fredSeries(
          "DGS10"
        ),

        fredSeries(
          "FEDFUNDS"
        )

      ]);


    const result = {

      enabled:
        true,

      twoYear:
        dgs2[
          0
        ] ||
        null,

      tenYear:
        dgs10[
          0
        ] ||
        null,

      fedFunds:
        fed[
          0
        ] ||
        null

    };


    macroCache = {

      time:
        Date.now(),

      value:
        result

    };


    return result;

  } catch (
    error
  ) {

    return {

      enabled:
        false,

      error:
        error.message

    };

  }

}


/* ================================================================
   HISTORY
================================================================ */

async function loadHistory(
  force = false
) {

  if (
    !force &&
    historyCache.value &&
    Date.now() -
    historyCache.time <
    HISTORY_CACHE_MS
  ) {

    return historyCache.value;

  }


  const candles =
    await tdSeries({

      symbol:
        SYMBOL,

      interval:
        "5min",

      outputsize:
        5000,

      key:
        KEY_3

    });


  const result = {

    candleCount:
      candles.length,

    firstTimestamp:
      candles[
        0
      ]?.time ||
      null,

    lastTimestamp:
      last(
        candles
      )?.time ||
      null

  };


  historyCache = {

    time:
      Date.now(),

    value:
      result

  };


  return result;

}


/* ================================================================
   REGIME
================================================================ */

function regime(
  m5
) {

  const structureData =
    structure(
      m5
    );


  const ranges =
    m5
      .slice(
        -40
      )
      .map(
        candle =>
          candle.high -
          candle.low
      );


  const recent =
    mean(
      ranges.slice(
        -10
      )
    );


  const older =
    mean(
      ranges.slice(
        -30,
        -10
      )
    );


  return {

    regime:
      structureData.bias ===
      "BULLISH"
        ? "TRENDING UP"
        : structureData.bias ===
          "BEARISH"
          ? "TRENDING DOWN"
          : "RANGING",

    volatility:
      recent >
      older *
      1.35
        ? "EXPANDING"
        : recent <
          older *
          .72
          ? "CONTRACTING"
          : "NORMAL"

  };

}


/* ================================================================
   MAIN
================================================================ */

async function build(
  force = false
) {

  if (
    !force &&
    deepCache.value &&
    Date.now() -
    deepCache.time <
    DEEP_CACHE_MS
  ) {

    return {

      ...deepCache.value,

      cached:
        true

    };

  }


  const [
    m1,
    m5,
    m15,
    h1,
    h4,
    quote,
    history,
    intermarket,
    macro,
    secondQuote
  ] =
    await Promise.all([

      tdSeries({

        symbol:
          SYMBOL,

        interval:
          "1min",

        outputsize:
          500,

        key:
          KEY_1

      }),


      tdSeries({

        symbol:
          SYMBOL,

        interval:
          "5min",

        outputsize:
          1200,

        key:
          KEY_1

      }),


      tdSeries({

        symbol:
          SYMBOL,

        interval:
          "15min",

        outputsize:
          700,

        key:
          KEY_2

      }),


      tdSeries({

        symbol:
          SYMBOL,

        interval:
          "1h",

        outputsize:
          700,

        key:
          KEY_2

      }),


      tdSeries({

        symbol:
          SYMBOL,

        interval:
          "4h",

        outputsize:
          400,

        key:
          KEY_2

      }),


      tdQuote(
        SYMBOL,
        KEY_1
      ),


      loadHistory(
        false
      )
      .catch(
        () => ({
          candleCount:0
        })
      ),


      loadIntermarket(
        false
      ),


      loadMacro(
        false
      ),


      tdQuote(
        SYMBOL,
        KEY_4
      )
      .catch(
        () => null
      )

    ]);


  const price =
    quote?.price ??
    last(
      m1
    )?.close;


  if (
    !price
  ) {

    throw new Error(
      "No valid XAU/USD price."
    );

  }


  const atrM1 =
    atr(
      m1
    );


  const atrM5 =
    atr(
      m5
    );


  const atrM15 =
    atr(
      m15
    );


  const sessions =
    currentSessions(
      m5
    );


  const day =
    previousDay(
      m5
    );


  const week =
    previousWeek(
      h1
    );


  const equal =
    equalLevels(
      m5,
      atrM5
    );


  const fvgs =
    fairValueGaps(
      m15
    );


  const levels =
    buildRawLevels({

      sessions,

      day,

      week,

      h1,

      equal

    });


  const zones =
    clusterLiquidity({

      levels,

      price,

      atrValue:
        atrM5,

      m5

    });


  const structures = {

    M1:
      structure(
        m1
      ),

    M5:
      structure(
        m5
      ),

    M15:
      structure(
        m15
      ),

    H1:
      structure(
        h1
      ),

    H4:
      structure(
        h4
      )

  };


  const flow =
    flowEngine(
      m1
    );


  const marketVwap =
    vwap(
      m5
    );


  const macdM5 =
    macd(
      m5
    );


  const result = {

    ok:
      true,

    engine:
      "MKAYFX GOLD INTELLIGENCE V9.1",

    architecture:
      "REST_ONLY",

    generatedAt:
      new Date()
        .toISOString(),

    cached:
      false,


    market:{

      price:
        round(
          price,
          2
        ),

      previousClose:
        round(
          quote
            ?.previousClose,
          2
        ),

      change:
        round(
          quote
            ?.change,
          2
        ),

      percentChange:
        round(
          quote
            ?.percentChange,
          3
        ),

      currentSession:
        currentSession(),

      atr:{

        M1:
          round(
            atrM1,
            2
          ),

        M5:
          round(
            atrM5,
            2
          ),

        M15:
          round(
            atrM15,
            2
          )

      },

      rsi:{

        M1:
          round(
            rsi(
              m1
            ),
            1
          ),

        M5:
          round(
            rsi(
              m5
            ),
            1
          ),

        M15:
          round(
            rsi(
              m15
            ),
            1
          )

      },

      macdM5:{

        line:
          round(
            macdM5.line,
            3
          ),

        signal:
          round(
            macdM5.signal,
            3
          ),

        histogram:
          round(
            macdM5.histogram,
            3
          )

      },

      rocM5:
        round(
          roc(
            m5
          ),
          3
        ),

      vwap:
        round(
          marketVwap,
          2
        ),

      regime:
        regime(
          m5
        )

    },


    sessions,


    previousDay:
      day,


    previousWeek:
      week,


    dealingRange:
      dealingRange(
        h1
      ),


    structure:
      structures,


    displacement:{

      M1:
        displacement(
          m1
        ),

      M5:
        displacement(
          m5
        )

    },


    flow,


    equalLevels:
      equal,


    fairValueGaps:
      fvgs,


    deepLiquidity:{

      rawLevelCount:
        levels.length,

      zoneCount:
        zones.length,

      dominantZone:
        zones[
          0
        ] ||
        null,

      zones

    },


    historicalLiquidity:
      history,


    intermarket,


    macro,


    dataQuality:{

      secondaryAvailable:
        Boolean(
          secondQuote
            ?.price
        ),

      primary:
        round(
          price,
          2
        ),

      secondary:
        round(
          secondQuote
            ?.price,
          2
        ),

      difference:
        secondQuote
          ?.price
          ? round(
              Math.abs(
                price -
                secondQuote.price
              ),
              2
            )
          : null

    },


    health:{

      api1:
        Boolean(
          KEY_1
        ),

      api2:
        Boolean(
          KEY_2
        ),

      api3:
        Boolean(
          KEY_3
        ),

      api4:
        Boolean(
          KEY_4
        ),

      fred:
        Boolean(
          FRED_KEY
        ),

      M1:
        m1.length,

      M5:
        m5.length,

      M15:
        m15.length,

      H1:
        h1.length,

      H4:
        h4.length,

      liquidityZones:
        zones.length

    },


    apiArchitecture:{

      price:
        "/api/price.js fast REST quote",

      api1:
        "XAU M1 + M5",

      api2:
        "XAU M15 + H1 + H4",

      api3:
        "Historical XAU M5",

      api4:
        "Fast price + secondary XAU + intermarket",

      fred:
        "Macro context"

    },


    modelNotes:{

      websocket:
        "Disabled.",

      fastPrice:
        "Lightweight REST quote endpoint handles frequent displayed-price updates.",

      deepEngine:
        "Liquidity and structure calculations refresh separately.",

      scores:
        "Heuristic model scores, not guaranteed probabilities."

    }

  };


  deepCache = {

    time:
      Date.now(),

    value:
      result

  };


  return result;

}


/* ================================================================
   HANDLER
================================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


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
          "Method not allowed."

      });

  }


  try {

    const force =
      String(
        req.query?.force ||
        ""
      ) ===
      "1";


    const result =
      await build(
        force
      );


    return res
      .status(200)
      .json(
        result
      );

  } catch (
    error
  ) {

    console.error(
      "XAU ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        engine:
          "MKAYFX GOLD INTELLIGENCE V9.1",

        error:
          error?.message ||
          "Unknown error."

      });

  }

}