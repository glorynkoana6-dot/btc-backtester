/* ================================================================
   MKAYFX GOLD INTELLIGENCE V9
   HYBRID REAL-TIME LIQUIDITY ENGINE
   ---------------------------------------------------------------
   FILE:
   /api/xau.js

   API 1
   TWELVE_DATA_API_KEY
   XAU/USD M1 + M5 + primary quote

   API 2
   TWELVE_DATA_API_KEY_2
   XAU/USD M15 + H1 + H4

   API 3
   TWELVE_DATA_API_KEY_3
   Historical XAU/USD M5

   API 4
   TWELVE_DATA_API_KEY_4
   Intermarket + secondary XAU validation
   Also used by /api/live.js for WebSocket

   FRED
   FRED_API_KEY

   IMPORTANT
   ---------------------------------------------------------------
   Live tick price is handled separately by /api/live.js.

   This engine builds:
   - liquidity pools
   - clustering
   - raid scores
   - FVGs
   - sessions
   - previous day/week levels
   - equal highs/lows
   - H1 swings
   - MTF structure
   - ATR/RSI/MACD/ROC/VWAP
   - displacement
   - delta/CVD proxies
   - historical sweep behavior
   - intermarket
   - macro
================================================================ */


/* ================================================================
   CONFIG
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


/* ================================================================
   CACHE
================================================================ */

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


  return (
    Math.round(
      n *
      p
    ) /
    p
  );

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
      total,
      value
    ) =>
      total +
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


  const mid =
    Math.floor(
      sorted.length /
      2
    );


  return sorted.length %
    2
      ? sorted[
          mid
        ]
      : (
          sorted[
            mid -
            1
          ] +
          sorted[
            mid
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


function weekKey(
  timestamp
) {

  const date =
    new Date(
      timestamp
    );


  const temp =
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      )
    );


  const day =
    temp.getUTCDay() ||
    7;


  temp.setUTCDate(
    temp.getUTCDate() +
    4 -
    day
  );


  const yearStart =
    new Date(
      Date.UTC(
        temp.getUTCFullYear(),
        0,
        1
      )
    );


  const week =
    Math.ceil(
      (
        (
          temp -
          yearStart
        ) /
        86400000 +
        1
      ) /
      7
    );


  return (
    `${temp.getUTCFullYear()}-W${String(
      week
    ).padStart(
      2,
      "0"
    )}`
  );

}


/* ================================================================
   TIME
================================================================ */

function currentSession() {

  const hour =
    new Date()
      .getUTCHours();


  if (
    hour >=
    12 &&
    hour <
    16
  ) {

    return "LONDON / NEW YORK";

  }


  if (
    hour >=
    7 &&
    hour <
    12
  ) {

    return "LONDON";

  }


  if (
    hour >=
    16 &&
    hour <
    21
  ) {

    return "NEW YORK";

  }


  if (
    hour <
    7
  ) {

    return "ASIA";

  }


  return "TRANSITION";

}


/* ================================================================
   TWELVE DATA PARSER
================================================================ */

function parseTimestamp(
  value
) {

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


  const timestamp =
    Date.parse(
      text
    );


  return Number.isFinite(
    timestamp
  )
    ? timestamp
    : null;

}


function parseTD(
  json
) {

  if (
    !Array.isArray(
      json?.values
    )
  ) {

    throw new Error(
      json?.message ||
      "Twelve Data returned no candle values."
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


/* ================================================================
   TWELVE DATA REQUESTS
================================================================ */

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

    `&interval=${encodeURIComponent(
      interval
    )}` +

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


  return parseTD(
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
   EMA
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
    values[0];


  return values.map(
    (
      value,
      index
    ) => {

      if (
        index ===
        0
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


/* ================================================================
   ATR
================================================================ */

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
    candles[0].high -
    candles[0].low
  ];


  for (
    let i = 1;
    i <
      candles.length;
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

  const values =
    atrSeries(
      candles,
      period
    );


  return last(
    values
  ) ||
  0;

}


/* ================================================================
   RSI
================================================================ */

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

    i <
      candles.length;

    i++
  ) {

    const move =
      candles[
        i
      ].close -
      candles[
        i -
        1
      ].close;


    if (
      move >
      0
    ) {

      gains +=
        move;

    } else {

      losses +=
        Math.abs(
          move
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
    avgLoss ===
    0
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


/* ================================================================
   MACD
================================================================ */

function macd(
  candles
) {

  if (
    candles.length <
    35
  ) {

    return {

      macd:
        0,

      signal:
        0,

      histogram:
        0

    };

  }


  const closes =
    candles.map(
      candle =>
        candle.close
    );


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

    macd:
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


/* ================================================================
   ROC
================================================================ */

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


/* ================================================================
   VWAP PROXY
================================================================ */

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
      candle.volume >
      0
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


  return total >
    0
      ? weighted /
        total
      : last(
          data
        )?.close ||
        0;

}


/* ================================================================
   PIVOTS / SWINGS
================================================================ */

function pivotHigh(
  candles,
  index,
  leftCount = 3,
  rightCount = 3
) {

  if (
    index <
    leftCount ||
    index +
    rightCount >=
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
      leftCount;

    i <=
      index +
      rightCount;

    i++
  ) {

    if (
      i !==
      index &&
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
  leftCount = 3,
  rightCount = 3
) {

  if (
    index <
    leftCount ||
    index +
    rightCount >=
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
      leftCount;

    i <=
      index +
      rightCount;

    i++
  ) {

    if (
      i !==
      index &&
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


/* ================================================================
   STRUCTURE
================================================================ */

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
        0,

      ema20:
        null,

      ema50:
        null,

      bos:
        null,

      choch:
        null

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
    price >
    e20
      ? 1
      : -1;


  score +=
    e20 >
    e50
      ? 1
      : -1;


  const recent =
    candles.slice(
      -10
    );


  const previous =
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


  const previousHigh =
    Math.max(
      ...previous.map(
        candle =>
          candle.high
      )
    );


  const previousLow =
    Math.min(
      ...previous.map(
        candle =>
          candle.low
      )
    );


  if (
    recentHigh >
    previousHigh &&
    recentLow >
    previousLow
  ) {

    score +=
      2;

  }


  if (
    recentHigh <
    previousHigh &&
    recentLow <
    previousLow
  ) {

    score -=
      2;

  }


  const swingData =
    swings(
      candles,
      140
    );


  const lastHigh =
    last(
      swingData.highs
    );


  const lastLow =
    last(
      swingData.lows
    );


  let bos =
    null;


  let choch =
    null;


  if (
    lastHigh &&
    price >
    lastHigh.price
  ) {

    bos =
      "BULLISH BOS";

  }


  if (
    lastLow &&
    price <
    lastLow.price
  ) {

    bos =
      "BEARISH BOS";

  }


  if (
    score <=
    -1 &&
    lastHigh &&
    price >
    lastHigh.price
  ) {

    choch =
      "BULLISH CHOCH";

  }


  if (
    score >=
    1 &&
    lastLow &&
    price <
    lastLow.price
  ) {

    choch =
      "BEARISH CHOCH";

  }


  return {

    bias:
      score >=
      2
        ? "BULLISH"
        : score <=
          -2
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
      ),

    bos,

    choch,

    lastSwingHigh:
      lastHigh
        ? {

            price:
              round(
                lastHigh.price,
                2
              ),

            time:
              lastHigh.time

          }
        : null,

    lastSwingLow:
      lastLow
        ? {

            price:
              round(
                lastLow.price,
                2
              ),

            time:
              lastLow.time

          }
        : null

  };

}


/* ================================================================
   DISPLACEMENT
================================================================ */

function displacement(
  candles
) {

  if (
    candles.length <
    25
  ) {

    return {

      active:
        false,

      direction:
        null,

      expansion:
        0,

      bodyRatio:
        0,

      strength:
        0

    };

  }


  const previousRanges =
    candles
      .slice(
        -21,
        -1
      )
      .map(
        candle =>
          candle.high -
          candle.low
      );


  const averageRange =
    mean(
      previousRanges
    );


  const candle =
    last(
      candles
    );


  const range =
    Math.max(
      candle.high -
      candle.low,
      .00001
    );


  const body =
    Math.abs(
      candle.close -
      candle.open
    );


  const expansion =
    averageRange >
    0
      ? range /
        averageRange
      : 0;


  const bodyRatio =
    body /
    range;


  const active =
    expansion >=
    1.45 &&
    bodyRatio >=
    .62;


  return {

    active,

    direction:
      active
        ? (
            candle.close >=
            candle.open
              ? "BULLISH"
              : "BEARISH"
          )
        : null,

    expansion:
      round(
        expansion,
        2
      ),

    bodyRatio:
      round(
        bodyRatio,
        2
      ),

    strength:
      round(
        clamp(
          expansion *
          bodyRatio *
          50,
          0,
          100
        ),
        1
      )

  };

}


/* ================================================================
   SESSION LEVELS
================================================================ */

const SESSION_DEFS = {

  ASIA: {

    start:
      0,

    end:
      7

  },

  LONDON: {

    start:
      7,

    end:
      16

  },

  NEW_YORK: {

    start:
      12,

    end:
      21

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
      ),

    open:
      data[
        0
      ].open,

    close:
      last(
        data
      ).close,

    endTime:
      last(
        data
      ).time

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

    const value =
      sessionRange(
        m5,
        day,
        definition
      );


    result[
      name
    ] =
      value
        ? {

            high:
              round(
                value.high,
                2
              ),

            low:
              round(
                value.low,
                2
              ),

            open:
              round(
                value.open,
                2
              ),

            close:
              round(
                value.close,
                2
              ),

            range:
              round(
                value.high -
                value.low,
                2
              )

          }
        : null;

  }


  return result;

}


/* ================================================================
   PREVIOUS DAY
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
    days.length <
    2
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


/* ================================================================
   PREVIOUS WEEK
================================================================ */

function previousWeek(
  candles
) {

  const weeks =
    unique(
      candles.map(
        candle =>
          weekKey(
            candle.time
          )
      )
    );


  if (
    weeks.length <
    2
  ) {

    return null;

  }


  const week =
    weeks[
      weeks.length -
      2
    ];


  const data =
    candles.filter(
      candle =>
        weekKey(
          candle.time
        ) ===
        week
    );


  return {

    week,

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


/* ================================================================
   DEALING RANGE
================================================================ */

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
      ),

    range:
      round(
        high -
        low,
        2
      )

  };

}


/* ================================================================
   EQUAL HIGHS / LOWS
================================================================ */

function equalLevels(
  m5,
  atrValue
) {

  const swingData =
    swings(
      m5,
      220
    );


  const tolerance =
    Math.max(
      atrValue *
      .12,
      .05
    );


  function findPairs(
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
      i <
        recent.length;
      i++
    ) {

      for (
        let j =
          i +
          1;

        j <
          recent.length;

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
              ),

            firstTime:
              recent[
                i
              ].time,

            secondTime:
              recent[
                j
              ].time

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
      findPairs(
        swingData.highs
      ),

    lows:
      findPairs(
        swingData.lows
      )

  };

}


/* ================================================================
   FAIR VALUE GAPS
================================================================ */

function fairValueGaps(
  candles,
  max = 14
) {

  const output =
    [];


  for (
    let i = 2;
    i <
      candles.length;
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

        midpoint:
          round(
            (
              first.high +
              third.low
            ) /
            2,
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

        midpoint:
          round(
            (
              third.high +
              first.low
            ) /
            2,
            2
          ),

        time:
          third.time

      });

    }

  }


  return output.slice(
    -max
  );

}


/* ================================================================
   DELTA / CVD PROXY
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


  const rows =
    [];


  for (
    const candle
    of data
  ) {

    const range =
      Math.max(
        candle.high -
        candle.low,
        .00001
      );


    const body =
      candle.close -
      candle.open;


    const location =
      (
        (
          candle.close -
          candle.low
        ) /
        range
      ) *
      2 -
      1;


    const activity =
      candle.volume >
      0
        ? candle.volume
        : range;


    const delta =
      activity *
      clamp(
        (
          body /
          range
        ) *
        .65 +
        location *
        .35,
        -1,
        1
      );


    cvd +=
      delta;


    rows.push({

      price:
        candle.close,

      delta,

      cvd,

      range,

      bodyRatio:
        Math.abs(
          body
        ) /
        range

    });

  }


  const recentDelta =
    rows
      .slice(
        -12
      )
      .reduce(
        (
          total,
          row
        ) =>
          total +
          row.delta,
        0
      );


  let absorption =
    null;


  const latest =
    last(
      rows
    );


  const avgRange =
    mean(
      rows
        .slice(
          -20,
          -1
        )
        .map(
          row =>
            row.range
        )
    );


  if (
    latest &&
    avgRange >
    0 &&
    latest.range /
    avgRange >=
    1.25 &&
    latest.bodyRatio <=
    .35
  ) {

    absorption =
      latest.delta >
      0
        ? "BUYING ABSORBED"
        : latest.delta <
          0
          ? "SELLING ABSORBED"
          : "TWO-WAY ABSORPTION";

  }


  let divergence =
    null;


  if (
    rows.length >=
    20
  ) {

    const older =
      rows[
        rows.length -
        15
      ];


    const newer =
      last(
        rows
      );


    if (
      newer.price >
      older.price &&
      newer.cvd <
      older.cvd
    ) {

      divergence =
        "BEARISH DELTA DIVERGENCE";

    }


    if (
      newer.price <
      older.price &&
      newer.cvd >
      older.cvd
    ) {

      divergence =
        "BULLISH DELTA DIVERGENCE";

    }

  }


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
      recentDelta >
      0
        ? "BUYING PRESSURE"
        : recentDelta <
          0
          ? "SELLING PRESSURE"
          : "BALANCED",

    absorption,

    divergence,

    note:
      "Candle/activity proxy only."

  };

}


/* ================================================================
   HISTORICAL SESSION STATS
================================================================ */

function historicalSessionStats(
  candles,
  session
) {

  const definition =
    SESSION_DEFS[
      session
    ];


  const days =
    unique(
      candles.map(
        candle =>
          isoDay(
            candle.time
          )
      )
    );


  let samples =
    0;


  let highSweeps =
    0;


  let highReturns =
    0;


  let lowSweeps =
    0;


  let lowReturns =
    0;


  const highDepth =
    [];


  const lowDepth =
    [];


  for (
    const day
    of days
  ) {

    const range =
      sessionRange(
        candles,
        day,
        definition
      );


    if (
      !range
    ) {

      continue;

    }


    const future =
      candles.filter(
        candle =>
          candle.time >
          range.endTime &&
          candle.time <=
          range.endTime +
          12 *
          60 *
          60 *
          1000
      );


    if (
      future.length <
      3
    ) {

      continue;

    }


    const past =
      candles.filter(
        candle =>
          candle.time <=
          range.endTime
      );


    const localATR =
      atr(
        past.slice(
          -100
        ),
        14
      );


    if (
      localATR <=
      0
    ) {

      continue;

    }


    samples++;


    const high =
      Math.max(
        ...future.map(
          candle =>
            candle.high
        )
      );


    const low =
      Math.min(
        ...future.map(
          candle =>
            candle.low
        )
      );


    if (
      high >
      range.high
    ) {

      highSweeps++;


      highDepth.push(
        (
          high -
          range.high
        ) /
        localATR
      );


      if (
        future.some(
          candle =>
            candle.close <
            range.high
        )
      ) {

        highReturns++;

      }

    }


    if (
      low <
      range.low
    ) {

      lowSweeps++;


      lowDepth.push(
        (
          range.low -
          low
        ) /
        localATR
      );


      if (
        future.some(
          candle =>
            candle.close >
            range.low
        )
      ) {

        lowReturns++;

      }

    }

  }


  function pack(
    sweeps,
    returns,
    depths
  ) {

    return {

      samples,

      sweepRate:
        round(
          samples
            ? sweeps /
              samples *
              100
            : 0,
          1
        ),

      returnRate:
        round(
          sweeps
            ? returns /
              sweeps *
              100
            : 0,
          1
        ),

      medianRaidATR:
        round(
          median(
            depths
          ),
          2
        ),

      confidence:
        samples >=
        40
          ? "HIGH"
          : samples >=
            20
            ? "MEDIUM"
            : "LOW"

    };

  }


  return {

    high:
      pack(
        highSweeps,
        highReturns,
        highDepth
      ),

    low:
      pack(
        lowSweeps,
        lowReturns,
        lowDepth
      )

  };

}


async function loadHistory(
  force
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
      null,

    statistics: {

      ASIA:
        historicalSessionStats(
          candles,
          "ASIA"
        ),

      LONDON:
        historicalSessionStats(
          candles,
          "LONDON"
        ),

      NEW_YORK:
        historicalSessionStats(
          candles,
          "NEW_YORK"
        )

    }

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
   RAW LIQUIDITY
================================================================ */

function rawLiquidity({
  sessions,
  day,
  week,
  h1,
  equal,
  history
}) {

  const output =
    [];


  function add({
    name,
    price,
    side,
    type,
    strength,
    historical = null
  }) {

    const level =
      finite(
        price
      );


    if (
      level ===
      null ||
      level <=
      0
    ) {

      return;

    }


    output.push({

      name,

      level,

      side,

      type,

      strength,

      historical

    });

  }


  if (
    sessions.ASIA
  ) {

    add({

      name:
        "ASIA HIGH",

      price:
        sessions.ASIA.high,

      side:
        "BUY_SIDE",

      type:
        "SESSION",

      strength:
        68,

      historical:
        history
          ?.statistics
          ?.ASIA
          ?.high

    });


    add({

      name:
        "ASIA LOW",

      price:
        sessions.ASIA.low,

      side:
        "SELL_SIDE",

      type:
        "SESSION",

      strength:
        68,

      historical:
        history
          ?.statistics
          ?.ASIA
          ?.low

    });

  }


  if (
    sessions.LONDON
  ) {

    add({

      name:
        "LONDON HIGH",

      price:
        sessions.LONDON.high,

      side:
        "BUY_SIDE",

      type:
        "SESSION",

      strength:
        80,

      historical:
        history
          ?.statistics
          ?.LONDON
          ?.high

    });


    add({

      name:
        "LONDON LOW",

      price:
        sessions.LONDON.low,

      side:
        "SELL_SIDE",

      type:
        "SESSION",

      strength:
        80,

      historical:
        history
          ?.statistics
          ?.LONDON
          ?.low

    });

  }


  if (
    sessions.NEW_YORK
  ) {

    add({

      name:
        "NEW YORK HIGH",

      price:
        sessions.NEW_YORK.high,

      side:
        "BUY_SIDE",

      type:
        "SESSION",

      strength:
        84,

      historical:
        history
          ?.statistics
          ?.NEW_YORK
          ?.high

    });


    add({

      name:
        "NEW YORK LOW",

      price:
        sessions.NEW_YORK.low,

      side:
        "SELL_SIDE",

      type:
        "SESSION",

      strength:
        84,

      historical:
        history
          ?.statistics
          ?.NEW_YORK
          ?.low

    });

  }


  if (
    day
  ) {

    add({

      name:
        "PREVIOUS DAY HIGH",

      price:
        day.high,

      side:
        "BUY_SIDE",

      type:
        "DAILY",

      strength:
        90

    });


    add({

      name:
        "PREVIOUS DAY LOW",

      price:
        day.low,

      side:
        "SELL_SIDE",

      type:
        "DAILY",

      strength:
        90

    });

  }


  if (
    week
  ) {

    add({

      name:
        "PREVIOUS WEEK HIGH",

      price:
        week.high,

      side:
        "BUY_SIDE",

      type:
        "WEEKLY",

      strength:
        96

    });


    add({

      name:
        "PREVIOUS WEEK LOW",

      price:
        week.low,

      side:
        "SELL_SIDE",

      type:
        "WEEKLY",

      strength:
        96

    });

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
      swing =>

        add({

          name:
            "H1 SWING HIGH",

          price:
            swing.price,

          side:
            "BUY_SIDE",

          type:
            "H1_SWING",

          strength:
            76

        })

    );


  h1Swings.lows
    .slice(
      -5
    )
    .forEach(
      swing =>

        add({

          name:
            "H1 SWING LOW",

          price:
            swing.price,

          side:
            "SELL_SIDE",

          type:
            "H1_SWING",

          strength:
            76

        })

    );


  equal.highs
    .forEach(
      item =>

        add({

          name:
            "EQUAL HIGHS",

          price:
            item.level,

          side:
            "BUY_SIDE",

          type:
            "EQUAL_LEVEL",

          strength:
            88

        })

    );


  equal.lows
    .forEach(
      item =>

        add({

          name:
            "EQUAL LOWS",

          price:
            item.level,

          side:
            "SELL_SIDE",

          type:
            "EQUAL_LEVEL",

          strength:
            88

        })

    );


  return output;

}


/* ================================================================
   ZONE HISTORY
================================================================ */

function zoneHistory(
  m5,
  low,
  high,
  side
) {

  const data =
    m5.slice(
      -500
    );


  let touches =
    0;


  let sweeps =
    0;


  let rejections =
    0;


  let lastTouchIndex =
    null;


  data.forEach(
    (
      candle,
      index
    ) => {

      if (
        candle.high >=
        low &&
        candle.low <=
        high
      ) {

        touches++;

        lastTouchIndex =
          index;

      }


      if (
        side ===
        "BUY_SIDE" &&
        candle.high >
        high
      ) {

        sweeps++;


        if (
          candle.close <
          high
        ) {

          rejections++;

        }

      }


      if (
        side ===
        "SELL_SIDE" &&
        candle.low <
        low
      ) {

        sweeps++;


        if (
          candle.close >
          low
        ) {

          rejections++;

        }

      }

    }
  );


  const barsSinceTouch =
    lastTouchIndex ===
    null
      ? data.length
      : data.length -
        1 -
        lastTouchIndex;


  const freshness =
    clamp(
      100 -
      touches *
      13 +
      Math.min(
        barsSinceTouch,
        100
      ) *
      .22,
      10,
      100
    );


  return {

    touches,

    sweeps,

    rejections,

    barsSinceTouch,

    freshness:
      round(
        freshness,
        1
      )

  };

}


/* ================================================================
   APPROACH
================================================================ */

function approach(
  m5,
  side,
  atrValue
) {

  const data =
    m5.slice(
      -16
    );


  if (
    data.length <
    8
  ) {

    return {

      label:
        "UNKNOWN",

      score:
        0

    };

  }


  const first =
    data[
      0
    ].close;


  const current =
    last(
      data
    ).close;


  const direction =
    side ===
    "BUY_SIDE"
      ? 1
      : -1;


  const directional =
    atrValue >
    0
      ? clamp(
          (
            current -
            first
          ) *
          direction /
          atrValue *
          40,
          -100,
          100
        )
      : 0;


  const olderRange =
    mean(
      data
        .slice(
          0,
          8
        )
        .map(
          candle =>
            candle.high -
            candle.low
        )
    );


  const recentRange =
    mean(
      data
        .slice(
          -8
        )
        .map(
          candle =>
            candle.high -
            candle.low
        )
    );


  const compression =
    olderRange >
    0
      ? clamp(
          (
            1 -
            recentRange /
            olderRange
          ) *
          100,
          -100,
          100
        )
      : 0;


  let structureCount =
    0;


  for (
    let i = 1;
    i <
      data.length;
    i++
  ) {

    if (
      side ===
      "BUY_SIDE" &&
      data[
        i
      ].low >
      data[
        i -
        1
      ].low
    ) {

      structureCount++;

    }


    if (
      side ===
      "SELL_SIDE" &&
      data[
        i
      ].high <
      data[
        i -
        1
      ].high
    ) {

      structureCount++;

    }

  }


  const structureScore =
    structureCount /
    (
      data.length -
      1
    ) *
    100;


  const score =
    clamp(
      Math.max(
        directional,
        0
      ) *
      .45 +
      Math.max(
        compression,
        0
      ) *
      .25 +
      structureScore *
      .30,
      0,
      100
    );


  return {

    score:
      round(
        score,
        1
      ),

    compression:
      round(
        compression,
        1
      ),

    directionality:
      round(
        directional,
        1
      ),

    structure:
      round(
        structureScore,
        1
      ),

    label:
      score >=
      70 &&
      compression >
      10
        ? "COMPRESSING"
        : score >=
          55
          ? "ATTACKING"
          : score >=
            35
            ? "APPROACHING"
            : directional <
              0
              ? "MOVING AWAY"
              : "DRIFTING"

  };

}


/* ================================================================
   CANDLE-BASED LIFECYCLE
================================================================ */

function lifecycle(
  zone,
  m5,
  price,
  atrValue,
  approachData
) {

  const current =
    last(
      m5
    );


  const recent =
    m5.slice(
      -4
    );


  const distance =
    Math.abs(
      price -
      zone.center
    );


  const distanceATR =
    atrValue >
    0
      ? distance /
        atrValue
      : 99;


  const penetrated =
    zone.side ===
    "BUY_SIDE"
      ? current.high >
        zone.high
      : current.low <
        zone.low;


  const rejected =
    zone.side ===
    "BUY_SIDE"
      ? (
          penetrated &&
          current.close <
          zone.high
        )
      : (
          penetrated &&
          current.close >
          zone.low
        );


  const accepted =
    recent.filter(
      candle =>
        zone.side ===
        "BUY_SIDE"
          ? candle.close >
            zone.high
          : candle.close <
            zone.low
    ).length >=
    2;


  let stage =
    "TRACKING";


  if (
    accepted
  ) {

    stage =
      "ACCEPTING";

  } else if (
    rejected
  ) {

    stage =
      "REJECTING";

  } else if (
    penetrated
  ) {

    stage =
      "RAIDING";

  } else if (
    distanceATR <=
    .2
  ) {

    stage =
      "ATTACKING";

  } else if (
    approachData.label ===
    "COMPRESSING" &&
    distanceATR <=
    .8
  ) {

    stage =
      "COMPRESSING";

  } else if (
    distanceATR <=
    1.25
  ) {

    stage =
      "APPROACHING";

  }


  return {

    stage,

    distanceATR:
      round(
        distanceATR,
        2
      ),

    penetrated,

    rejected,

    accepted

  };

}


/* ================================================================
   CLUSTER LIQUIDITY
================================================================ */

function clusterLiquidity({
  levels,
  price,
  atrValue,
  m5,
  h1,
  fvgs
}) {

  const clusterDistance =
    Math.max(
      atrValue *
      .22,
      .25
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

    const list =
      levels
        .filter(
          level =>
            level.side ===
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


    let group =
      [];


    for (
      const item
      of list
    ) {

      if (
        !group.length
      ) {

        group = [
          item
        ];

        continue;

      }


      const average =
        mean(
          group.map(
            item =>
              item.level
          )
        );


      if (
        Math.abs(
          item.level -
          average
        ) <=
        clusterDistance
      ) {

        group.push(
          item
        );

      } else {

        groups.push(
          group
        );


        group = [
          item
        ];

      }

    }


    if (
      group.length
    ) {

      groups.push(
        group
      );

    }

  }


  const range =
    dealingRange(
      h1
    );


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
          atrValue >
          0
            ? distance /
              atrValue
            : 99;


        const proximity =
          clamp(
            100 -
            distanceATR *
            24,
            0,
            100
          );


        const density =
          clamp(
            group.length *
            18 +
            (
              group.length >=
              3
                ? 15
                : 0
            ),
            0,
            100
          );


        const strength =
          mean(
            group.map(
              item =>
                item.strength
            )
          );


        const historyItems =
          group
            .map(
              item =>
                item.historical
            )
            .filter(
              Boolean
            );


        const historicalSweep =
          historyItems.length
            ? mean(
                historyItems.map(
                  item =>
                    item.sweepRate
                )
              )
            : 45;


        const historicalReturn =
          historyItems.length
            ? mean(
                historyItems.map(
                  item =>
                    item.returnRate
                )
              )
            : 50;


        const historyData =
          zoneHistory(
            m5,
            low,
            high,
            side
          );


        const approachData =
          approach(
            m5,
            side,
            atrValue
          );


        const fvgOverlap =
          fvgs.some(
            gap =>
              gap.high >=
              low -
              atrValue *
              .25 &&
              gap.low <=
              high +
              atrValue *
              .25
          );


        const majorCount =
          group.filter(
            item =>
              [
                "DAILY",
                "WEEKLY",
                "EQUAL_LEVEL"
              ].includes(
                item.type
              )
          ).length;


        const sessionCount =
          group.filter(
            item =>
              item.type ===
              "SESSION"
          ).length;


        const confluence =
          clamp(
            majorCount *
            22 +
            sessionCount *
            15,
            0,
            100
          );


        const heat =
          clamp(
            strength *
            .27 +
            density *
            .18 +
            historyData.freshness *
            .15 +
            historicalSweep *
            .13 +
            proximity *
            .12 +
            approachData.score *
            .10 +
            confluence *
            .05,
            0,
            100
          );


        let raidScore =
          clamp(
            heat *
            .42 +
            proximity *
            .22 +
            approachData.score *
            .20 +
            historicalSweep *
            .16,
            0,
            100
          );


        let liquidityClass =
          "INTERNAL";


        if (
          side ===
          "BUY_SIDE" &&
          center >=
          range.high -
          range.range *
          .15
        ) {

          liquidityClass =
            "EXTERNAL";

        }


        if (
          side ===
          "SELL_SIDE" &&
          center <=
          range.low +
          range.range *
          .15
        ) {

          liquidityClass =
            "EXTERNAL";

        }


        const zone = {

          side,

          low,

          high,

          center

        };


        const life =
          lifecycle(
            zone,
            m5,
            price,
            atrValue,
            approachData
          );


        if (
          life.stage ===
          "ATTACKING"
        ) {

          raidScore +=
            6;

        }


        if (
          life.stage ===
          "RAIDING"
        ) {

          raidScore =
            Math.max(
              raidScore,
              92
            );

        }


        raidScore =
          clamp(
            raidScore,
            0,
            100
          );


        const reversalLikelihood =
          clamp(
            historicalReturn *
            .30 +
            historyData.freshness *
            .20 +
            strength *
            .18 +
            (
              fvgOverlap
                ? 80
                : 45
            ) *
            .12 +
            (
              life.stage ===
              "REJECTING"
                ? 100
                : 45
            ) *
            .20,
            0,
            100
          );


        const names =
          unique(
            group.map(
              item =>
                item.name
            )
          );


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
              : names[
                  0
                ];


        return {

          id:
            `LZ-${side}-${index + 1}`,

          name,

          side,

          liquidityClass,

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

          componentCount:
            group.length,

          components:
            group.map(
              item => ({

                name:
                  item.name,

                level:
                  round(
                    item.level,
                    2
                  ),

                type:
                  item.type,

                strength:
                  item.strength

              })
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

          freshness:
            historyData.freshness,

          touchHistory:
            historyData,

          historical: {

            sweepRate:
              round(
                historicalSweep,
                1
              ),

            returnRate:
              round(
                historicalReturn,
                1
              )

          },

          approach:
            approachData,

          lifecycle:
            life,

          fvgOverlap,

          heat:
            round(
              heat,
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

          reversalLikelihood:
            round(
              reversalLikelihood,
              1
            ),

          continuationLikelihood:
            round(
              100 -
              reversalLikelihood,
              1
            )

        };

      }
    )

    .filter(
      zone =>
        zone.distanceATR <=
        8 ||
        zone.liquidityClass ===
        "EXTERNAL"
    );

}


/* ================================================================
   PATH SCORE
================================================================ */

function liquidityPath(
  zones
) {

  return zones

    .map(
      zone => {

        const proximity =
          clamp(
            100 -
            zone.distanceATR *
            22,
            0,
            100
          );


        let bonus =
          0;


        if (
          zone.lifecycle.stage ===
          "COMPRESSING"
        ) {

          bonus =
            8;

        }


        if (
          zone.lifecycle.stage ===
          "ATTACKING"
        ) {

          bonus =
            12;

        }


        if (
          zone.lifecycle.stage ===
          "RAIDING"
        ) {

          bonus =
            15;

        }


        return {

          ...zone,

          nextTargetScore:
            round(
              clamp(
                zone.raidScore *
                .50 +
                zone.heat *
                .25 +
                proximity *
                .20 +
                bonus,
                0,
                100
              ),
              1
            )

        };

      }
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
   INTERMARKET
================================================================ */

function percentageMove(
  candles,
  bars
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


async function loadIntermarket(
  force
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


  const configurations = [

    [
      "XAG/USD",
      .36,
      1
    ],

    [
      "EUR/USD",
      .20,
      1
    ],

    [
      "GBP/USD",
      .12,
      1
    ],

    [
      "USD/JPY",
      .22,
      -1
    ],

    [
      "BTC/USD",
      .10,
      1
    ]

  ];


  const results =
    await Promise.all(

      configurations.map(
        (
          [
            symbol
          ]
        ) =>

          tdSeries({

            symbol,

            interval:
              "1h",

            outputsize:
              40,

            key:
              KEY_4

          })
          .catch(
            () => []
          )

      )

    );


  let total =
    0;


  let weightTotal =
    0;


  const markets =
    [];


  configurations.forEach(
    (
      [
        symbol,
        weight,
        direction
      ],
      index
    ) => {

      const candles =
        results[
          index
        ];


      if (
        candles.length <
        15
      ) {

        return;

      }


      const move =
        percentageMove(
          candles,
          1
        ) *
        .15 +
        percentageMove(
          candles,
          3
        ) *
        .25 +
        percentageMove(
          candles,
          6
        ) *
        .25 +
        percentageMove(
          candles,
          12
        ) *
        .35;


      const normalized =
        clamp(
          move *
          80,
          -100,
          100
        );


      const contribution =
        normalized *
        direction;


      total +=
        contribution *
        weight;


      weightTotal +=
        weight;


      markets.push({

        symbol,

        price:
          round(
            last(
              candles
            ).close,
            symbol ===
            "BTC/USD"
              ? 1
              : 5
          ),

        contribution:
          round(
            contribution,
            1
          )

      });

    }
  );


  const score =
    weightTotal
      ? total /
        weightTotal
      : 0;


  const result = {

    score:
      round(
        score,
        1
      ),

    bias:
      score >=
      15
        ? "BULLISH"
        : score <=
          -15
          ? "BEARISH"
          : "NEUTRAL",

    markets

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

    `?series_id=${encodeURIComponent(
      id
    )}` +

    `&api_key=${encodeURIComponent(
      FRED_KEY
    )}` +

    `&file_type=json` +

    `&sort_order=desc` +

    `&limit=10`;


  const response =
    await fetch(
      url
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `FRED ${id} HTTP ${response.status}`
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
        "." &&
        Number.isFinite(
          Number(
            row.value
          )
        )
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
  force
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
        false,

      score:
        0,

      bias:
        "NEUTRAL"

    };

  }


  try {

    const [
      twoYear,
      tenYear,
      fedFunds
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


    const change2 =
      twoYear.length >=
      2
        ? twoYear[
            0
          ].value -
          twoYear[
            1
          ].value
        : 0;


    const change10 =
      tenYear.length >=
      2
        ? tenYear[
            0
          ].value -
          tenYear[
            1
          ].value
        : 0;


    const score =
      clamp(
        -change2 *
        320 -
        change10 *
        260,
        -100,
        100
      );


    const result = {

      enabled:
        true,

      score:
        round(
          score,
          1
        ),

      bias:
        score >=
        15
          ? "BULLISH GOLD"
          : score <=
            -15
            ? "BEARISH GOLD"
            : "NEUTRAL",

      twoYear:
        twoYear[
          0
        ] ||
        null,

      tenYear:
        tenYear[
          0
        ] ||
        null,

      fedFunds:
        fedFunds[
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

      score:
        0,

      bias:
        "UNAVAILABLE",

      error:
        error.message

    };

  }

}


/* ================================================================
   FEED QUALITY
================================================================ */

function feedQuality(
  primary,
  secondary,
  atrValue
) {

  if (
    primary ===
    null ||
    secondary ===
    null
  ) {

    return {

      available:
        false,

      status:
        "SECONDARY UNAVAILABLE"

    };

  }


  const difference =
    Math.abs(
      primary -
      secondary
    );


  const atrDifference =
    atrValue >
    0
      ? difference /
        atrValue
      : 0;


  return {

    available:
      true,

    status:
      atrDifference >
      .25
        ? "DISAGREEMENT"
        : atrDifference >
          .10
          ? "CAUTION"
          : "GOOD",

    primary:
      round(
        primary,
        2
      ),

    secondary:
      round(
        secondary,
        2
      ),

    difference:
      round(
        difference,
        2
      ),

    differenceATR:
      round(
        atrDifference,
        3
      )

  };

}


/* ================================================================
   REGIME
================================================================ */

function regime(
  m5
) {

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


  const previous =
    mean(
      ranges.slice(
        -30,
        -10
      )
    );


  const closes =
    m5.map(
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


  const atrValue =
    atr(
      m5,
      14
    );


  const trendStrength =
    atrValue >
    0
      ? Math.abs(
          e20 -
          e50
        ) /
        atrValue
      : 0;


  const structureBias =
    structure(
      m5
    ).bias;


  return {

    regime:
      trendStrength >=
      .7
        ? (
            structureBias ===
            "BULLISH"
              ? "TRENDING UP"
              : structureBias ===
                "BEARISH"
                ? "TRENDING DOWN"
                : "TRANSITION"
          )
        : "RANGING",

    volatility:
      recent >
      previous *
      1.35
        ? "EXPANDING"
        : recent <
          previous *
          .72
          ? "CONTRACTING"
          : "NORMAL",

    trendStrength:
      round(
        trendStrength,
        2
      )

  };

}


/* ================================================================
   CONSENSUS
================================================================ */

function consensus({
  structures,
  zones,
  intermarket,
  macro,
  flow
}) {

  const technical =
    clamp(
      structures.M5.score *
      9 +
      structures.M15.score *
      14 +
      structures.H1.score *
      18 +
      structures.H4.score *
      21,
      -100,
      100
    );


  const dominant =
    zones[
      0
    ] ||
    null;


  let liquidity =
    0;


  if (
    dominant
  ) {

    liquidity =
      dominant.nextTargetScore *
      (
        dominant.side ===
        "BUY_SIDE"
          ? 1
          : -1
      );

  }


  const flowScore =
    flow.bias ===
    "BUYING PRESSURE"
      ? clamp(
          Math.abs(
            flow.delta
          ) /
          8,
          0,
          100
        )
      : flow.bias ===
        "SELLING PRESSURE"
        ? -clamp(
            Math.abs(
              flow.delta
            ) /
            8,
            0,
            100
          )
        : 0;


  const score =
    clamp(
      technical *
      .34 +
      liquidity *
      .30 +
      intermarket.score *
      .20 +
      (
        macro.score ||
        0
      ) *
      .10 +
      flowScore *
      .06,
      -100,
      100
    );


  return {

    score:
      round(
        score,
        1
      ),

    direction:
      score >=
      20
        ? "BULLISH"
        : score <=
          -20
          ? "BEARISH"
          : "NEUTRAL",

    confidence:
      round(
        clamp(
          Math.abs(
            score
          ) *
          .70 +
          (
            dominant
              ? dominant.heat *
                .30
              : 0
          ),
          0,
          100
        ),
        1
      )

  };

}


/* ================================================================
   MAIN
================================================================ */

async function buildIntelligence(
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


  if (
    !KEY_1
  ) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );

  }


  const [
    m1,
    m5,
    m15,
    h1,
    h4,
    primaryQuote,
    history,
    intermarket,
    macro,
    secondaryQuote
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
      )
      .catch(
        () => null
      ),


      loadHistory(
        force
      )
      .catch(
        () => ({

          candleCount:
            0,

          statistics:
            {}

        })
      ),


      loadIntermarket(
        force
      )
      .catch(
        () => ({

          score:
            0,

          bias:
            "UNAVAILABLE",

          markets:
            []

        })
      ),


      loadMacro(
        force
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
    primaryQuote
      ?.price ||
    last(
      m1
    )?.close ||
    last(
      m5
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


  const sessionData =
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
    rawLiquidity({

      sessions:
        sessionData,

      day,

      week,

      h1,

      equal,

      history

    });


  const clustered =
    clusterLiquidity({

      levels,

      price,

      atrValue:
        atrM5,

      m5,

      h1,

      fvgs

    });


  const path =
    liquidityPath(
      clustered
    );


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


  const macroConsensus =
    consensus({

      structures,

      zones:
        path,

      intermarket,

      macro,

      flow

    });


  const marketVwap =
    vwap(
      m5
    );


  const m5Macd =
    macd(
      m5
    );


  const m15Macd =
    macd(
      m15
    );


  const quality =
    feedQuality(
      price,
      secondaryQuote
        ?.price ??
      null,
      atrM5
    );


  const result = {

    ok:
      true,

    engine:
      "MKAYFX GOLD INTELLIGENCE V9",

    architecture:
      "HYBRID_WEBSOCKET_REST",

    symbol:
      SYMBOL,

    generatedAt:
      new Date()
        .toISOString(),

    cached:
      false,


    market: {

      price:
        round(
          price,
          2
        ),

      previousClose:
        round(
          primaryQuote
            ?.previousClose,
          2
        ),

      change:
        round(
          primaryQuote
            ?.change,
          2
        ),

      percentChange:
        round(
          primaryQuote
            ?.percentChange,
          3
        ),

      currentSession:
        currentSession(),

      atr: {

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

      rsi: {

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

      macd: {

        M5: {

          macd:
            round(
              m5Macd.macd,
              3
            ),

          signal:
            round(
              m5Macd.signal,
              3
            ),

          histogram:
            round(
              m5Macd.histogram,
              3
            )

        },

        M15: {

          macd:
            round(
              m15Macd.macd,
              3
            ),

          signal:
            round(
              m15Macd.signal,
              3
            ),

          histogram:
            round(
              m15Macd.histogram,
              3
            )

        }

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

      vwapPosition:
        price >
        marketVwap
          ? "ABOVE VWAP"
          : "BELOW VWAP",

      regime:
        regime(
          m5
        )

    },


    currentSession:
      currentSession(),


    sessions:
      sessionData,


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


    displacement: {

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


    deepLiquidity: {

      rawLevelCount:
        levels.length,

      zoneCount:
        path.length,

      dominantZone:
        path[
          0
        ] ||
        null,

      nearestBuyZone:
        path
          .filter(
            zone =>
              zone.side ===
              "BUY_SIDE"
          )
          .sort(
            (
              a,
              b
            ) =>
              a.distance -
              b.distance
          )[
            0
          ] ||
        null,

      nearestSellZone:
        path
          .filter(
            zone =>
              zone.side ===
              "SELL_SIDE"
          )
          .sort(
            (
              a,
              b
            ) =>
              a.distance -
              b.distance
          )[
            0
          ] ||
        null,

      zones:
        path

    },


    historicalLiquidity:
      history,


    intermarket,


    macro,


    dataQuality:
      quality,


    consensus:
      macroConsensus,


    health: {

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

      liveStreamKey:
        Boolean(
          KEY_4
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
        path.length

    },


    apiArchitecture: {

      live:
        "Twelve Data XAU/USD WebSocket via /api/live",

      api1:
        "XAU M1 + M5 + primary quote",

      api2:
        "XAU M15 + H1 + H4",

      api3:
        "Historical XAU liquidity behavior",

      api4:
        "Intermarket + secondary XAU validation + live WS key",

      fred:
        "US 2Y + 10Y + Fed Funds"

    },


    modelNotes: {

      livePrice:
        "WebSocket price drives live approach, attack, raid and rejection states.",

      candles:
        "REST candles drive structure, ATR, indicators, FVG and deeper liquidity modeling.",

      scores:
        "Raid and reversal values are heuristic model scores, not guaranteed probabilities.",

      flow:
        "Delta and CVD are candle/activity proxies."

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


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
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
      await buildIntelligence(
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
      "MKAYFX V9 ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        engine:
          "MKAYFX GOLD INTELLIGENCE V9",

        error:
          error?.message ||
          "Unknown server error.",

        generatedAt:
          new Date()
            .toISOString()

      });

  }

}