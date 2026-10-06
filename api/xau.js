/* ================================================================
   MKAYFX GOLD INTELLIGENCE V10
   COMPLETE LIQUIDITY MAP ENGINE
   ---------------------------------------------------------------
   FILE:
   /api/xau.js

   API #1
   TWELVE_DATA_API_KEY
   XAU/USD M1 + M5 + primary quote

   API #2
   TWELVE_DATA_API_KEY_2
   XAU/USD M15 + H1 + H4

   API #3
   TWELVE_DATA_API_KEY_3
   Historical XAU M5

   API #4
   TWELVE_DATA_API_KEY_4
   Secondary XAU + intermarket

   FRED
   FRED_API_KEY

   EXPLICIT LIQUIDITY REFERENCES
   ---------------------------------------------------------------
   Asia High
   Asia Low

   London High
   London Low

   New York High
   New York Low

   Previous Day High
   Previous Day Low

   Previous Week High
   Previous Week Low

   Daily Open
   Weekly Open
   Midnight Open

   Dealing Range High
   Dealing Range Low
   Dealing Range EQ

   H1 Swing Highs
   H1 Swing Lows

   H4 Swing Highs
   H4 Swing Lows

   Equal Highs
   Equal Lows

   M15 FVG High / Low / Midpoints

   VWAP Reference
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
){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){
    return null;
  }

  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function clamp(
  value,
  min,
  max
){

  const number =
    Number(
      value
    );

  return Math.max(
    min,
    Math.min(
      max,
      Number.isFinite(
        number
      )
        ? number
        : 0
    )
  );
}


function round(
  value,
  decimals = 2
){

  const number =
    finite(
      value
    );

  if(
    number === null
  ){
    return null;
  }

  const power =
    10 **
    decimals;

  return Math.round(
    number *
    power
  ) /
  power;
}


function mean(
  values
){

  const clean =
    values.filter(
      Number.isFinite
    );

  if(
    !clean.length
  ){
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
){

  if(
    !values.length
  ){
    return 0;
  }

  const sorted =
    [
      ...values
    ]
    .sort(
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
){

  return array?.length
    ? array[
        array.length -
        1
      ]
    : null;
}


function unique(
  values
){

  return [
    ...new Set(
      values
    )
  ];
}


function isoDay(
  timestamp
){

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
){

  return new Date(
    timestamp
  )
  .getUTCHours();
}


/* ================================================================
   CURRENT SESSION
================================================================ */

function currentSession(){

  const hour =
    new Date()
      .getUTCHours();

  if(
    hour < 7
  ){
    return "ASIA";
  }

  if(
    hour >= 7 &&
    hour < 12
  ){
    return "LONDON";
  }

  if(
    hour >= 12 &&
    hour < 16
  ){
    return "LONDON / NEW YORK";
  }

  if(
    hour >= 16 &&
    hour < 21
  ){
    return "NEW YORK";
  }

  return "TRANSITION";
}


/* ================================================================
   PARSER
================================================================ */

function parseTimestamp(
  value
){

  if(
    value === null ||
    value === undefined
  ){
    return null;
  }

  let text =
    String(
      value
    );

  if(
    !text.includes(
      "T"
    ) &&
    text.includes(
      " "
    )
  ){

    text =
      text.replace(
        " ",
        "T"
      );
  }

  if(
    !/[zZ]|[+-]\d\d:\d\d$/.test(
      text
    )
  ){

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
){

  if(
    !Array.isArray(
      json?.values
    )
  ){

    throw new Error(
      json?.message ||
      "Twelve Data returned no candles."
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

        if(
          time === null ||
          open === null ||
          high === null ||
          low === null ||
          close === null
        ){
          return null;
        }

        if(
          open <= 0 ||
          high <= 0 ||
          low <= 0 ||
          close <= 0
        ){
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
   TWELVE DATA
================================================================ */

async function tdSeries({
  symbol,
  interval,
  outputsize,
  key
}){

  if(
    !key
  ){

    throw new Error(
      "Missing Twelve Data API key."
    );
  }

  const url =
    `${TD_BASE}/time_series` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=${outputsize}` +
    `&order=asc` +
    `&timezone=UTC` +
    `&apikey=${encodeURIComponent(key)}`;

  const response =
    await fetch(
      url
    );

  if(
    !response.ok
  ){

    throw new Error(
      `Twelve Data ${interval} HTTP ${response.status}`
    );
  }

  const json =
    await response.json();

  if(
    json.status ===
    "error"
  ){

    throw new Error(
      json.message ||
      "Twelve Data request failed."
    );
  }

  return parseTD(
    json
  );
}


async function tdQuote(
  symbol,
  key
){

  if(
    !key
  ){
    return null;
  }

  const url =
    `${TD_BASE}/quote` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&apikey=${encodeURIComponent(key)}`;

  const response =
    await fetch(
      url
    );

  if(
    !response.ok
  ){
    throw new Error(
      `Quote HTTP ${response.status}`
    );
  }

  const json =
    await response.json();

  if(
    json.status ===
    "error"
  ){
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
){

  if(
    !values.length
  ){
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

      if(
        index ===
        0
      ){

        current =
          value;

      }else{

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
){

  if(
    candles.length <
    2
  ){
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

  for(
    let i = 1;
    i < candles.length;
    i++
  ){

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
){

  return last(
    atrSeries(
      candles,
      period
    )
  ) ||
  0;
}


/* ================================================================
   RSI
================================================================ */

function rsi(
  candles,
  period = 14
){

  if(
    candles.length <
    period +
    2
  ){
    return 50;
  }

  let gains =
    0;

  let losses =
    0;

  for(
    let i =
      candles.length -
      period;

    i < candles.length;

    i++
  ){

    const move =
      candles[
        i
      ].close -
      candles[
        i -
        1
      ].close;

    if(
      move > 0
    ){
      gains +=
        move;
    }else{
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

  if(
    avgLoss ===
    0
  ){
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
   ROC
================================================================ */

function roc(
  candles,
  bars = 10
){

  if(
    candles.length <=
    bars
  ){
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

  if(
    !previous
  ){
    return 0;
  }

  return (
    (
      current -
      previous
    ) /
    previous *
    100
  );
}


/* ================================================================
   VWAP
================================================================ */

function vwap(
  candles,
  lookback = 160
){

  const data =
    candles.slice(
      -lookback
    );

  let totalWeight =
    0;

  let total =
    0;

  for(
    const candle
    of data
  ){

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

    total +=
      typical *
      activity;

    totalWeight +=
      activity;
  }

  return totalWeight >
    0
      ? total /
        totalWeight
      : last(
          data
        )?.close ||
        0;
}


/* ================================================================
   PIVOTS
================================================================ */

function pivotHigh(
  candles,
  index,
  length = 3
){

  if(
    index <
    length ||
    index +
    length >=
    candles.length
  ){
    return false;
  }

  const value =
    candles[
      index
    ].high;

  for(
    let i =
      index -
      length;

    i <=
      index +
      length;

    i++
  ){

    if(
      i ===
      index
    ){
      continue;
    }

    if(
      candles[
        i
      ].high >=
      value
    ){
      return false;
    }
  }

  return true;
}


function pivotLow(
  candles,
  index,
  length = 3
){

  if(
    index <
    length ||
    index +
    length >=
    candles.length
  ){
    return false;
  }

  const value =
    candles[
      index
    ].low;

  for(
    let i =
      index -
      length;

    i <=
      index +
      length;

    i++
  ){

    if(
      i ===
      index
    ){
      continue;
    }

    if(
      candles[
        i
      ].low <=
      value
    ){
      return false;
    }
  }

  return true;
}


function swings(
  candles,
  lookback = 180,
  pivotLength = 3
){

  const data =
    candles.slice(
      -lookback
    );

  const highs =
    [];

  const lows =
    [];

  for(
    let i = pivotLength;
    i <
      data.length -
      pivotLength;
    i++
  ){

    if(
      pivotHigh(
        data,
        i,
        pivotLength
      )
    ){

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

    if(
      pivotLow(
        data,
        i,
        pivotLength
      )
    ){

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
){

  if(
    candles.length <
    55
  ){

    return {
      bias:"NEUTRAL",
      score:0,
      ema20:null,
      ema50:null
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

  if(
    recentHigh >
    previousHigh &&
    recentLow >
    previousLow
  ){
    score +=
      2;
  }

  if(
    recentHigh <
    previousHigh &&
    recentLow <
    previousLow
  ){
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
   SESSION DEFINITIONS
================================================================ */

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
){

  const data =
    candles.filter(
      candle => {

        if(
          isoDay(
            candle.time
          ) !==
          day
        ){
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

  if(
    !data.length
  ){
    return null;
  }

  return {
    open:
      data[
        0
      ].open,

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

    close:
      last(
        data
      ).close
  };
}


function currentSessions(
  m5
){

  const day =
    isoDay(
      last(
        m5
      ).time
    );

  const result =
    {};

  for(
    const [
      name,
      definition
    ]
    of Object.entries(
      SESSION_DEFS
    )
  ){

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
            open:
              round(
                range.open,
                2
              ),

            high:
              round(
                range.high,
                2
              ),

            low:
              round(
                range.low,
                2
              ),

            close:
              round(
                range.close,
                2
              ),

            range:
              round(
                range.high -
                range.low,
                2
              )
          }
        : null;
  }

  return result;
}


/* ================================================================
   DAILY REFERENCES
================================================================ */

function currentDayData(
  candles
){

  const day =
    isoDay(
      last(
        candles
      ).time
    );

  const data =
    candles.filter(
      candle =>
        isoDay(
          candle.time
        ) ===
        day
    );

  if(
    !data.length
  ){
    return null;
  }

  return {
    date:
      day,

    open:
      data[
        0
      ].open,

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


function previousDayData(
  candles
){

  const days =
    unique(
      candles.map(
        candle =>
          isoDay(
            candle.time
          )
      )
    );

  if(
    days.length <
    2
  ){
    return null;
  }

  const previousDay =
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
        previousDay
    );

  if(
    !data.length
  ){
    return null;
  }

  return {
    date:
      previousDay,

    open:
      data[
        0
      ].open,

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

    close:
      last(
        data
      ).close
  };
}


function midnightOpen(
  candles
){

  const day =
    isoDay(
      last(
        candles
      ).time
    );

  const today =
    candles.filter(
      candle =>
        isoDay(
          candle.time
        ) ===
        day
    );

  if(
    !today.length
  ){
    return null;
  }

  return today[
    0
  ].open;
}


/* ================================================================
   WEEKLY REFERENCES
================================================================ */

function mondayStart(
  timestamp
){

  const date =
    new Date(
      timestamp
    );

  const day =
    date.getUTCDay();

  const difference =
    (
      day +
      6
    ) %
    7;

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() -
    difference,
    0,
    0,
    0,
    0
  );
}


function currentWeekData(
  h1
){

  const current =
    last(
      h1
    );

  if(!current){
    return null;
  }

  const start =
    mondayStart(
      current.time
    );

  const data =
    h1.filter(
      candle =>
        candle.time >=
        start
    );

  if(
    !data.length
  ){
    return null;
  }

  return {
    open:
      data[
        0
      ].open,

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


function previousWeekData(
  h1
){

  const current =
    last(
      h1
    );

  if(!current){
    return null;
  }

  const currentStart =
    mondayStart(
      current.time
    );

  const previousStart =
    currentStart -
    7 *
    86400000;

  const data =
    h1.filter(
      candle =>
        candle.time >=
        previousStart &&
        candle.time <
        currentStart
    );

  if(
    !data.length
  ){
    return null;
  }

  return {
    open:
      data[
        0
      ].open,

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

    close:
      last(
        data
      ).close
  };
}


/* ================================================================
   DEALING RANGE
================================================================ */

function dealingRange(
  h1
){

  const data =
    h1.slice(
      -72
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
   EQUAL LEVELS
================================================================ */

function equalLevels(
  candles,
  atrValue
){

  const swingData =
    swings(
      candles,
      260,
      3
    );

  const tolerance =
    Math.max(
      atrValue *
      .14,
      .08
    );

  function findPairs(
    list
  ){

    const output =
      [];

    const recent =
      list.slice(
        -24
      );

    for(
      let i = 0;
      i < recent.length;
      i++
    ){

      for(
        let j =
          i +
          1;

        j < recent.length;

        j++
      ){

        if(
          Math.abs(
            recent[
              i
            ].price -
            recent[
              j
            ].price
          ) <=
          tolerance
        ){

          output.push({
            level:
              (
                recent[
                  i
                ].price +
                recent[
                  j
                ].price
              ) /
              2,

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
      -10
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
  limit = 20
){

  const output =
    [];

  for(
    let i = 2;
    i < candles.length;
    i++
  ){

    const first =
      candles[
        i -
        2
      ];

    const third =
      candles[
        i
      ];

    if(
      third.low >
      first.high
    ){

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

    if(
      third.high <
      first.low
    ){

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
    -limit
  );
}


/* ================================================================
   LIQUIDITY STATE
================================================================ */

function liquidityState({
  side,
  price,
  level,
  atrValue,
  latest
}){

  const distance =
    Math.abs(
      price -
      level
    );

  const distanceATR =
    atrValue >
    0
      ? distance /
        atrValue
      : 99;

  if(
    side ===
    "BUY_SIDE"
  ){

    if(
      latest.high >
      level &&
      latest.close <
      level
    ){
      return "REJECTING";
    }

    if(
      latest.high >
      level
    ){
      return "RAIDED";
    }
  }

  if(
    side ===
    "SELL_SIDE"
  ){

    if(
      latest.low <
      level &&
      latest.close >
      level
    ){
      return "REJECTING";
    }

    if(
      latest.low <
      level
    ){
      return "RAIDED";
    }
  }

  if(
    distanceATR <=
    .20
  ){
    return "ATTACKING";
  }

  if(
    distanceATR <=
    .80
  ){
    return "APPROACHING";
  }

  return "TRACKING";
}


/* ================================================================
   COMPLETE LIQUIDITY MAP
================================================================ */

function buildLiquidityLevels({
  price,
  atrValue,
  m5,
  h1,
  h4,
  sessions,
  previousDay,
  previousWeek,
  currentDay,
  currentWeek,
  equal,
  range,
  fvgs,
  vwapValue
}){

  const output =
    [];

  const latest =
    last(
      m5
    );

  function add({
    name,
    short,
    price:level,
    side,
    group,
    timeframe,
    strength = 50,
    source = null
  }){

    const number =
      finite(
        level
      );

    if(
      number === null ||
      number <= 0
    ){
      return;
    }

    const distance =
      Math.abs(
        price -
        number
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
        20,
        0,
        100
      );

    const score =
      clamp(
        strength *
        .65 +
        proximity *
        .35,
        0,
        100
      );

    output.push({
      id:
        `${group}-${short}-${round(number,2)}`,

      name,

      short,

      price:
        round(
          number,
          2
        ),

      side,

      group,

      timeframe,

      strength:
        round(
          strength,
          1
        ),

      score:
        round(
          score,
          1
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

      position:
        number >
        price
          ? "ABOVE"
          : number <
            price
            ? "BELOW"
            : "AT_PRICE",

      state:
        side ===
        "NEUTRAL"
          ? (
              distanceATR <=
              .2
                ? "AT LEVEL"
                : "REFERENCE"
            )
          : liquidityState({
              side,
              price,
              level:number,
              atrValue,
              latest
            }),

      source
    });
  }


  /* ============================================================
     SESSIONS
  ============================================================ */

  if(
    sessions.ASIA
  ){

    add({
      name:"Asia High",
      short:"ASH",
      price:sessions.ASIA.high,
      side:"BUY_SIDE",
      group:"SESSION",
      timeframe:"TODAY",
      strength:75
    });

    add({
      name:"Asia Low",
      short:"ASL",
      price:sessions.ASIA.low,
      side:"SELL_SIDE",
      group:"SESSION",
      timeframe:"TODAY",
      strength:75
    });

    add({
      name:"Asia Open",
      short:"ASO",
      price:sessions.ASIA.open,
      side:"NEUTRAL",
      group:"OPEN",
      timeframe:"TODAY",
      strength:46
    });
  }


  if(
    sessions.LONDON
  ){

    add({
      name:"London High",
      short:"LDH",
      price:sessions.LONDON.high,
      side:"BUY_SIDE",
      group:"SESSION",
      timeframe:"TODAY",
      strength:84
    });

    add({
      name:"London Low",
      short:"LDL",
      price:sessions.LONDON.low,
      side:"SELL_SIDE",
      group:"SESSION",
      timeframe:"TODAY",
      strength:84
    });

    add({
      name:"London Open",
      short:"LDO",
      price:sessions.LONDON.open,
      side:"NEUTRAL",
      group:"OPEN",
      timeframe:"TODAY",
      strength:54
    });
  }


  if(
    sessions.NEW_YORK
  ){

    add({
      name:"New York High",
      short:"NYH",
      price:sessions.NEW_YORK.high,
      side:"BUY_SIDE",
      group:"SESSION",
      timeframe:"TODAY",
      strength:88
    });

    add({
      name:"New York Low",
      short:"NYL",
      price:sessions.NEW_YORK.low,
      side:"SELL_SIDE",
      group:"SESSION",
      timeframe:"TODAY",
      strength:88
    });

    add({
      name:"New York Open",
      short:"NYO",
      price:sessions.NEW_YORK.open,
      side:"NEUTRAL",
      group:"OPEN",
      timeframe:"TODAY",
      strength:58
    });
  }


  /* ============================================================
     DAILY
  ============================================================ */

  if(
    previousDay
  ){

    add({
      name:"Previous Day High",
      short:"PDH",
      price:previousDay.high,
      side:"BUY_SIDE",
      group:"DAILY",
      timeframe:"D1",
      strength:94
    });

    add({
      name:"Previous Day Low",
      short:"PDL",
      price:previousDay.low,
      side:"SELL_SIDE",
      group:"DAILY",
      timeframe:"D1",
      strength:94
    });
  }


  if(
    currentDay
  ){

    add({
      name:"Daily Open",
      short:"DO",
      price:currentDay.open,
      side:"NEUTRAL",
      group:"OPEN",
      timeframe:"D1",
      strength:64
    });

    add({
      name:"Current Day High",
      short:"CDH",
      price:currentDay.high,
      side:"BUY_SIDE",
      group:"DAILY",
      timeframe:"D1",
      strength:72
    });

    add({
      name:"Current Day Low",
      short:"CDL",
      price:currentDay.low,
      side:"SELL_SIDE",
      group:"DAILY",
      timeframe:"D1",
      strength:72
    });
  }


  add({
    name:"Midnight Open",
    short:"MO",
    price:
      midnightOpen(
        m5
      ),
    side:"NEUTRAL",
    group:"OPEN",
    timeframe:"D1",
    strength:67
  });


  /* ============================================================
     WEEKLY
  ============================================================ */

  if(
    previousWeek
  ){

    add({
      name:"Previous Week High",
      short:"PWH",
      price:previousWeek.high,
      side:"BUY_SIDE",
      group:"WEEKLY",
      timeframe:"W1",
      strength:98
    });

    add({
      name:"Previous Week Low",
      short:"PWL",
      price:previousWeek.low,
      side:"SELL_SIDE",
      group:"WEEKLY",
      timeframe:"W1",
      strength:98
    });
  }


  if(
    currentWeek
  ){

    add({
      name:"Weekly Open",
      short:"WO",
      price:currentWeek.open,
      side:"NEUTRAL",
      group:"OPEN",
      timeframe:"W1",
      strength:72
    });

    add({
      name:"Current Week High",
      short:"CWH",
      price:currentWeek.high,
      side:"BUY_SIDE",
      group:"WEEKLY",
      timeframe:"W1",
      strength:82
    });

    add({
      name:"Current Week Low",
      short:"CWL",
      price:currentWeek.low,
      side:"SELL_SIDE",
      group:"WEEKLY",
      timeframe:"W1",
      strength:82
    });
  }


  /* ============================================================
     DEALING RANGE
  ============================================================ */

  add({
    name:"Dealing Range High",
    short:"DRH",
    price:range.high,
    side:"BUY_SIDE",
    group:"RANGE",
    timeframe:"H1",
    strength:87
  });

  add({
    name:"Dealing Range Low",
    short:"DRL",
    price:range.low,
    side:"SELL_SIDE",
    group:"RANGE",
    timeframe:"H1",
    strength:87
  });

  add({
    name:"Dealing Range Equilibrium",
    short:"EQ",
    price:range.midpoint,
    side:"NEUTRAL",
    group:"RANGE",
    timeframe:"H1",
    strength:63
  });


  /* ============================================================
     SWINGS
  ============================================================ */

  const h1Swings =
    swings(
      h1,
      240,
      3
    );

  h1Swings.highs
    .slice(
      -6
    )
    .forEach(
      (
        swing,
        index
      ) => {

        add({
          name:`H1 Swing High ${index + 1}`,
          short:`H1H${index + 1}`,
          price:swing.price,
          side:"BUY_SIDE",
          group:"SWING",
          timeframe:"H1",
          strength:80
        });
      }
    );

  h1Swings.lows
    .slice(
      -6
    )
    .forEach(
      (
        swing,
        index
      ) => {

        add({
          name:`H1 Swing Low ${index + 1}`,
          short:`H1L${index + 1}`,
          price:swing.price,
          side:"SELL_SIDE",
          group:"SWING",
          timeframe:"H1",
          strength:80
        });
      }
    );


  const h4Swings =
    swings(
      h4,
      180,
      2
    );

  h4Swings.highs
    .slice(
      -4
    )
    .forEach(
      (
        swing,
        index
      ) => {

        add({
          name:`H4 Swing High ${index + 1}`,
          short:`H4H${index + 1}`,
          price:swing.price,
          side:"BUY_SIDE",
          group:"SWING",
          timeframe:"H4",
          strength:90
        });
      }
    );

  h4Swings.lows
    .slice(
      -4
    )
    .forEach(
      (
        swing,
        index
      ) => {

        add({
          name:`H4 Swing Low ${index + 1}`,
          short:`H4L${index + 1}`,
          price:swing.price,
          side:"SELL_SIDE",
          group:"SWING",
          timeframe:"H4",
          strength:90
        });
      }
    );


  /* ============================================================
     EQUAL LEVELS
  ============================================================ */

  equal.highs
    .forEach(
      (
        item,
        index
      ) => {

        add({
          name:`Equal Highs ${index + 1}`,
          short:`EQH${index + 1}`,
          price:item.level,
          side:"BUY_SIDE",
          group:"EQUAL",
          timeframe:"M5",
          strength:91
        });
      }
    );

  equal.lows
    .forEach(
      (
        item,
        index
      ) => {

        add({
          name:`Equal Lows ${index + 1}`,
          short:`EQL${index + 1}`,
          price:item.level,
          side:"SELL_SIDE",
          group:"EQUAL",
          timeframe:"M5",
          strength:91
        });
      }
    );


  /* ============================================================
     FVG
  ============================================================ */

  fvgs
    .slice(
      -8
    )
    .forEach(
      (
        gap,
        index
      ) => {

        add({
          name:`${gap.direction} M15 FVG Mid ${index + 1}`,
          short:`FVG${index + 1}`,
          price:gap.midpoint,
          side:"NEUTRAL",
          group:"FVG",
          timeframe:"M15",
          strength:55,
          source:{
            low:gap.low,
            high:gap.high
          }
        });
      }
    );


  /* ============================================================
     VWAP
  ============================================================ */

  add({
    name:"M5 VWAP",
    short:"VWAP",
    price:vwapValue,
    side:"NEUTRAL",
    group:"RANGE",
    timeframe:"M5",
    strength:55
  });


  /* ============================================================
     REMOVE DUPLICATE NEAR-IDENTICAL REFERENCES
  ============================================================ */

  const deduped =
    [];

  for(
    const item
    of output
  ){

    const duplicate =
      deduped.some(
        existing =>
          existing.name ===
          item.name &&
          Math.abs(
            existing.price -
            item.price
          ) <
          .01
      );

    if(
      !duplicate
    ){
      deduped.push(
        item
      );
    }
  }

  return deduped
    .sort(
      (
        a,
        b
      ) => {

        if(
          b.score !==
          a.score
        ){
          return b.score -
            a.score;
        }

        return a.distance -
          b.distance;
      }
    );
}


/* ================================================================
   CLUSTER LIQUIDITY
================================================================ */

function clusterLiquidity(
  levels,
  price,
  atrValue
){

  const mergeDistance =
    Math.max(
      atrValue *
      .28,
      .25
    );

  const pools =
    [];

  for(
    const side
    of [
      "BUY_SIDE",
      "SELL_SIDE"
    ]
  ){

    const relevant =
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
            a.price -
            b.price
        );

    let current =
      [];

    for(
      const level
      of relevant
    ){

      if(
        !current.length
      ){

        current = [
          level
        ];

        continue;
      }

      const average =
        mean(
          current.map(
            item =>
              item.price
          )
        );

      if(
        Math.abs(
          level.price -
          average
        ) <=
        mergeDistance
      ){

        current.push(
          level
        );

      }else{

        pools.push(
          current
        );

        current = [
          level
        ];
      }
    }

    if(
      current.length
    ){
      pools.push(
        current
      );
    }
  }


  return pools
    .map(
      (
        pool,
        index
      ) => {

        const side =
          pool[
            0
          ].side;

        const center =
          mean(
            pool.map(
              item =>
                item.price
            )
          );

        const low =
          Math.min(
            ...pool.map(
              item =>
                item.price
            )
          ) -
          atrValue *
          .04;

        const high =
          Math.max(
            ...pool.map(
              item =>
                item.price
            )
          ) +
          atrValue *
          .04;

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

        const structural =
          mean(
            pool.map(
              item =>
                item.strength
            )
          );

        const density =
          clamp(
            pool.length *
            20,
            20,
            100
          );

        const proximity =
          clamp(
            100 -
            distanceATR *
            22,
            0,
            100
          );

        const score =
          clamp(
            structural *
            .44 +
            density *
            .24 +
            proximity *
            .32,
            0,
            100
          );

        let stage =
          "TRACKING";

        if(
          distanceATR <=
          .20
        ){
          stage =
            "ATTACKING";
        }else if(
          distanceATR <=
          .8
        ){
          stage =
            "APPROACHING";
        }

        const latest =
          last(
            levels
          );

        const name =
          pool.length >=
          3
            ? (
                side ===
                "BUY_SIDE"
                  ? "MAJOR BUY-SIDE CLUSTER"
                  : "MAJOR SELL-SIDE CLUSTER"
              )
            : pool.length ===
              2
              ? (
                  side ===
                  "BUY_SIDE"
                    ? "BUY-SIDE CLUSTER"
                    : "SELL-SIDE CLUSTER"
                )
              : pool[
                  0
                ].name;

        return {
          id:
            `CLUSTER-${side}-${index}`,

          name,

          side,

          price:
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
            pool.length,

          components:
            pool.map(
              item => ({
                name:item.name,
                short:item.short,
                price:item.price,
                group:item.group
              })
            ),

          structuralStrength:
            round(
              structural,
              1
            ),

          density:
            round(
              density,
              1
            ),

          heat:
            round(
              score,
              1
            ),

          raidScore:
            round(
              score,
              1
            ),

          raidLikelihood:
            round(
              score,
              1
            ),

          nextTargetScore:
            round(
              score,
              1
            ),

          lifecycle:{
            stage
          }
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
   FLOW
================================================================ */

function flowEngine(
  m1
){

  const data =
    m1.slice(
      -120
    );

  let cvd =
    0;

  let recent =
    0;

  const deltas =
    [];

  for(
    let index = 0;
    index < data.length;
    index++
  ){

    const candle =
      data[
        index
      ];

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
      candle.volume >
      0
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

    deltas.push(
      delta
    );

    if(
      index >=
      data.length -
      12
    ){
      recent +=
        delta;
    }
  }

  const typicalMagnitude =
    median(
      deltas.map(
        value =>
          Math.abs(
            value
          )
      )
    );

  const pressureScore =
    typicalMagnitude >
    0
      ? clamp(
          Math.abs(
            recent
          ) /
          (
            typicalMagnitude *
            12
          ) *
          100,
          0,
          100
        )
      : 0;

  return {
    delta:
      round(
        recent,
        2
      ),

    cvd:
      round(
        cvd,
        2
      ),

    pressureScore:
      round(
        pressureScore,
        1
      ),

    bias:
      recent > 0
        ? "BUYING PRESSURE"
        : recent < 0
          ? "SELLING PRESSURE"
          : "BALANCED",

    note:
      "Candle/activity proxy, not centralized order-flow data."
  };
}


/* ================================================================
   DISPLACEMENT
================================================================ */

function displacement(
  candles
){

  const latest =
    last(
      candles
    );

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

  const range =
    latest.high -
    latest.low;

  const body =
    Math.abs(
      latest.close -
      latest.open
    );

  const expansion =
    averageRange >
    0
      ? range /
        averageRange
      : 0;

  const bodyRatio =
    range >
    0
      ? body /
        range
      : 0;

  return {
    active:
      expansion >=
      1.45 &&
      bodyRatio >=
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
      ),

    bodyRatio:
      round(
        bodyRatio,
        2
      )
  };
}


/* ================================================================
   REGIME
================================================================ */

function regime(
  m5
){

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
   HISTORICAL
================================================================ */

async function loadHistory(){

  if(
    historyCache.value &&
    Date.now() -
    historyCache.time <
    HISTORY_CACHE_MS
  ){

    return historyCache.value;
  }

  try{

    const candles =
      await tdSeries({
        symbol:SYMBOL,
        interval:"5min",
        outputsize:5000,
        key:KEY_3
      });

    const result = {
      candleCount:
        candles.length,

      firstTimestamp:
        candles[
          0
        ]?.time ??
        null,

      lastTimestamp:
        last(
          candles
        )?.time ??
        null
    };

    historyCache = {
      time:Date.now(),
      value:result
    };

    return result;

  }catch(error){

    return {
      candleCount:0,
      error:error.message
    };
  }
}


/* ================================================================
   INTERMARKET
================================================================ */

async function loadIntermarket(){

  if(
    intermarketCache.value &&
    Date.now() -
    intermarketCache.time <
    INTERMARKET_CACHE_MS
  ){

    return intermarketCache.value;
  }

  const symbols = [
    "XAG/USD",
    "EUR/USD",
    "GBP/USD",
    "USD/JPY",
    "BTC/USD"
  ];

  const candles =
    await Promise.all(
      symbols.map(
        symbol =>
          tdSeries({
            symbol,
            interval:"1h",
            outputsize:30,
            key:KEY_4
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

        const data =
          candles[
            index
          ];

        if(
          data.length <
          2
        ){

          return {
            symbol,
            available:false
          };
        }

        const current =
          last(
            data
          ).close;

        const previous =
          data[
            data.length -
            2
          ].close;

        return {
          symbol,
          available:true,

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
    markets
  };

  intermarketCache = {
    time:Date.now(),
    value:result
  };

  return result;
}


/* ================================================================
   FRED
================================================================ */

async function fredSeries(
  id
){

  if(
    !FRED_KEY
  ){
    return [];
  }

  const url =
    `${FRED_BASE}/series/observations` +
    `?series_id=${encodeURIComponent(id)}` +
    `&api_key=${encodeURIComponent(FRED_KEY)}` +
    `&file_type=json` +
    `&sort_order=desc` +
    `&limit=5`;

  const response =
    await fetch(
      url
    );

  if(
    !response.ok
  ){
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
    item =>
      item.value !==
      "."
  )
  .map(
    item => ({
      date:item.date,
      value:Number(
        item.value
      )
    })
  );
}


async function loadMacro(){

  if(
    macroCache.value &&
    Date.now() -
    macroCache.time <
    MACRO_CACHE_MS
  ){

    return macroCache.value;
  }

  if(
    !FRED_KEY
  ){

    return {
      enabled:false
    };
  }

  try{

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

    const result = {
      enabled:true,
      twoYear:
        twoYear[
          0
        ] ??
        null,

      tenYear:
        tenYear[
          0
        ] ??
        null,

      fedFunds:
        fedFunds[
          0
        ] ??
        null
    };

    macroCache = {
      time:Date.now(),
      value:result
    };

    return result;

  }catch(error){

    return {
      enabled:false,
      error:error.message
    };
  }
}


/* ================================================================
   CONSENSUS
================================================================ */

function buildConsensus({
  structureData,
  clusters,
  flow
}){

  const technical =
    clamp(
      structureData.M5.score *
      9 +
      structureData.M15.score *
      14 +
      structureData.H1.score *
      20 +
      structureData.H4.score *
      22,
      -100,
      100
    );

  const dominant =
    clusters[
      0
    ];

  let liquidity =
    0;

  if(
    dominant
  ){

    liquidity =
      dominant.raidScore *
      (
        dominant.side ===
        "BUY_SIDE"
          ? 1
          : -1
      );
  }

  const flowDirection =
    flow.bias ===
    "BUYING PRESSURE"
      ? flow.pressureScore
      : flow.bias ===
        "SELLING PRESSURE"
        ? -flow.pressureScore
        : 0;

  const score =
    clamp(
      technical *
      .50 +
      liquidity *
      .35 +
      flowDirection *
      .15,
      -100,
      100
    );

  return {
    score:
      round(
        score,
        1
      ),

    technical:
      round(
        technical,
        1
      ),

    liquidity:
      round(
        liquidity,
        1
      ),

    flow:
      round(
        flowDirection,
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
          ),
          0,
          100
        ),
        1
      )
  };
}


/* ================================================================
   BUILD INTELLIGENCE
================================================================ */

async function buildIntelligence(
  force = false
){

  if(
    !force &&
    deepCache.value &&
    Date.now() -
    deepCache.time <
    DEEP_CACHE_MS
  ){

    return {
      ...deepCache.value,
      cached:true
    };
  }

  if(
    !KEY_1
  ){

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
    secondaryQuote,
    history,
    intermarket,
    macro
  ] =
    await Promise.all([

      tdSeries({
        symbol:SYMBOL,
        interval:"1min",
        outputsize:500,
        key:KEY_1
      }),

      tdSeries({
        symbol:SYMBOL,
        interval:"5min",
        outputsize:1200,
        key:KEY_1
      }),

      tdSeries({
        symbol:SYMBOL,
        interval:"15min",
        outputsize:700,
        key:KEY_2
      }),

      tdSeries({
        symbol:SYMBOL,
        interval:"1h",
        outputsize:700,
        key:KEY_2
      }),

      tdSeries({
        symbol:SYMBOL,
        interval:"4h",
        outputsize:400,
        key:KEY_2
      }),

      tdQuote(
        SYMBOL,
        KEY_1
      )
      .catch(
        () => null
      ),

      tdQuote(
        SYMBOL,
        KEY_4
      )
      .catch(
        () => null
      ),

      loadHistory(),

      loadIntermarket(),

      loadMacro()

    ]);


  const price =
    primaryQuote
      ?.price ??
    last(
      m1
    )
      ?.close ??
    last(
      m5
    )
      ?.close;

  if(
    !price
  ){

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

  const currentDay =
    currentDayData(
      m5
    );

  const previousDay =
    previousDayData(
      m5
    );

  const currentWeek =
    currentWeekData(
      h1
    );

  const previousWeek =
    previousWeekData(
      h1
    );

  const range =
    dealingRange(
      h1
    );

  const equal =
    equalLevels(
      m5,
      atrM5
    );

  const fvgs =
    fairValueGaps(
      m15,
      20
    );

  const vwapValue =
    vwap(
      m5
    );


  const liquidityLevels =
    buildLiquidityLevels({
      price,
      atrValue:atrM5,
      m5,
      h1,
      h4,
      sessions,
      previousDay,
      previousWeek,
      currentDay,
      currentWeek,
      equal,
      range,
      fvgs,
      vwapValue
    });


  const clusters =
    clusterLiquidity(
      liquidityLevels,
      price,
      atrM5
    );


  const structureData = {
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


  const consensus =
    buildConsensus({
      structureData,
      clusters,
      flow
    });


  const result = {
    ok:true,

    engine:
      "MKAYFX GOLD INTELLIGENCE V10",

    architecture:
      "REST_MULTI_ENGINE",

    generatedAt:
      new Date()
        .toISOString(),

    cached:false,


    market:{
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

      vwap:
        round(
          vwapValue,
          2
        ),

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

      rocM5:
        round(
          roc(
            m5
          ),
          3
        ),

      regime:
        regime(
          m5
        )
    },


    sessions,


    dailyReferences:{
      dailyOpen:
        round(
          currentDay
            ?.open,
          2
        ),

      midnightOpen:
        round(
          midnightOpen(
            m5
          ),
          2
        ),

      currentDayHigh:
        round(
          currentDay
            ?.high,
          2
        ),

      currentDayLow:
        round(
          currentDay
            ?.low,
          2
        ),

      previousDayHigh:
        round(
          previousDay
            ?.high,
          2
        ),

      previousDayLow:
        round(
          previousDay
            ?.low,
          2
        )
    },


    weeklyReferences:{
      weeklyOpen:
        round(
          currentWeek
            ?.open,
          2
        ),

      currentWeekHigh:
        round(
          currentWeek
            ?.high,
          2
        ),

      currentWeekLow:
        round(
          currentWeek
            ?.low,
          2
        ),

      previousWeekHigh:
        round(
          previousWeek
            ?.high,
          2
        ),

      previousWeekLow:
        round(
          previousWeek
            ?.low,
          2
        )
    },


    previousDay:
      previousDay
        ? {
            high:
              round(
                previousDay.high,
                2
              ),

            low:
              round(
                previousDay.low,
                2
              )
          }
        : null,


    previousWeek:
      previousWeek
        ? {
            high:
              round(
                previousWeek.high,
                2
              ),

            low:
              round(
                previousWeek.low,
                2
              )
          }
        : null,


    dealingRange:
      range,


    structure:
      structureData,


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


    equalLevels:{
      highs:
        equal.highs.map(
          item => ({
            ...item,
            level:
              round(
                item.level,
                2
              )
          })
        ),

      lows:
        equal.lows.map(
          item => ({
            ...item,
            level:
              round(
                item.level,
                2
              )
          })
        )
    },


    fairValueGaps:
      fvgs,


    liquidityLevels,


    deepLiquidity:{
      levelCount:
        liquidityLevels.length,

      zoneCount:
        clusters.length,

      dominantZone:
        clusters[
          0
        ] ??
        null,

      nearestBuyZone:
        clusters
          .filter(
            item =>
              item.side ===
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
          ] ??
        null,

      nearestSellZone:
        clusters
          .filter(
            item =>
              item.side ===
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
          ] ??
        null,

      zones:
        clusters
    },


    historicalLiquidity:
      history,


    intermarket,


    macro,


    consensus,


    dataQuality:{
      primary:
        round(
          price,
          2
        ),

      secondary:
        round(
          secondaryQuote
            ?.price,
          2
        ),

      difference:
        secondaryQuote
          ?.price
          ? round(
              Math.abs(
                price -
                secondaryQuote.price
              ),
              2
            )
          : null,

      secondaryAvailable:
        Boolean(
          secondaryQuote
            ?.price
        )
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

      liquidityLevels:
        liquidityLevels.length,

      liquidityClusters:
        clusters.length
    },


    apiArchitecture:{
      fastPrice:
        "/api/price.js",

      api1:
        "XAU M1 + M5 + primary quote",

      api2:
        "XAU M15 + H1 + H4",

      api3:
        "Historical XAU M5",

      api4:
        "Secondary XAU + intermarket",

      fred:
        "US macro context",

      frontend:
        "V10 AI Command Center"
    },


    modelNotes:{
      scores:
        "Liquidity and raid scores are heuristic model scores, not guaranteed probabilities.",

      flow:
        "Delta/CVD are activity proxies, not centralized order-book footprint data.",

      aiUI:
        "AI Command Center is a deterministic intelligence interface, not a trained neural trading model."
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
){

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  if(
    req.method !==
    "GET"
  ){

    return res
      .status(
        405
      )
      .json({
        ok:false,
        error:"Method not allowed."
      });
  }

  try{

    const force =
      String(
        req.query
          ?.force ??
        ""
      ) ===
      "1";

    const result =
      await buildIntelligence(
        force
      );

    return res
      .status(
        200
      )
      .json(
        result
      );

  }catch(error){

    console.error(
      "MKAYFX V10:",
      error
    );

    return res
      .status(
        500
      )
      .json({
        ok:false,
        engine:
          "MKAYFX GOLD INTELLIGENCE V10",
        error:
          error
            ?.message ||
          "Unknown server error.",
        generatedAt:
          new Date()
            .toISOString()
      });
  }
}