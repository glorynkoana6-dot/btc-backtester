/* ================================================================
   MKAYFX GOLD INTELLIGENCE V8.2
   DEEP LIQUIDITY ZONE ENGINE

   FILE:
   /api/xau.js

   API #1
   TWELVE_DATA_API_KEY
   XAU/USD M1 + M5

   API #2
   TWELVE_DATA_API_KEY_2
   XAU/USD M15 + H1 + H4

   API #3
   TWELVE_DATA_API_KEY_3
   XAU/USD historical M5

   API #4
   TWELVE_DATA_API_KEY_4
   XAG/USD
   EUR/USD
   GBP/USD
   USD/JPY
   BTC/USD
   Secondary XAU/USD quote

   FRED
   FRED_API_KEY
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


const LIVE_CACHE_MS =
  45 * 1000;

const INTERMARKET_CACHE_MS =
  5 * 60 * 1000;

const HISTORY_CACHE_MS =
  15 * 60 * 1000;

const MACRO_CACHE_MS =
  20 * 60 * 1000;


const MAX_HISTORY =
  5000;


/* ================================================================
   CACHE
================================================================ */

let liveCache = {
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

function clamp(
  value,
  min,
  max
){

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


function safeNumber(
  value,
  fallback = 0
){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){
    return fallback;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function round(
  value,
  decimals = 2
){

  const n =
    Number(value);

  if(!Number.isFinite(n)){
    return null;
  }

  const power =
    10 ** decimals;

  return (
    Math.round(
      n *
      power
    ) /
    power
  );
}


function mean(values){

  if(!values.length){
    return 0;
  }

  return (
    values.reduce(
      (sum,value) =>
        sum +
        value,
      0
    ) /
    values.length
  );
}


function median(values){

  if(!values.length){
    return 0;
  }

  const sorted =
    [...values]
      .sort(
        (a,b) =>
          a -
          b
      );

  const middle =
    Math.floor(
      sorted.length /
      2
    );

  if(
    sorted.length %
    2
  ){
    return sorted[middle];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
}


function percentile(
  values,
  percentileValue
){

  if(!values.length){
    return 0;
  }

  const sorted =
    [...values]
      .sort(
        (a,b) =>
          a -
          b
      );

  const index =
    (
      sorted.length -
      1
    ) *
    percentileValue;

  const lower =
    Math.floor(index);

  const upper =
    Math.ceil(index);

  if(lower === upper){
    return sorted[lower];
  }

  return (
    sorted[lower] +
    (
      sorted[upper] -
      sorted[lower]
    ) *
    (
      index -
      lower
    )
  );
}


function last(array){

  if(!array?.length){
    return null;
  }

  return array[
    array.length -
    1
  ];
}


function unique(values){

  return [
    ...new Set(values)
  ];
}


function isoDay(timestamp){

  return new Date(timestamp)
    .toISOString()
    .slice(
      0,
      10
    );
}


function utcHour(timestamp){

  return new Date(timestamp)
    .getUTCHours();
}


function isoWeekKey(timestamp){

  const date =
    new Date(timestamp);

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

  const start =
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
          start
        ) /
        86400000 +
        1
      ) /
      7
    );

  return `${temp.getUTCFullYear()}-W${String(
    week
  ).padStart(
    2,
    "0"
  )}`;
}


/* ================================================================
   SESSION NAME
================================================================ */

function sessionNameNow(){

  const hour =
    new Date()
      .getUTCHours();

  if(
    hour >= 12 &&
    hour < 16
  ){
    return "LONDON / NEW YORK";
  }

  if(
    hour >= 7 &&
    hour < 12
  ){
    return "LONDON";
  }

  if(
    hour >= 16 &&
    hour < 21
  ){
    return "NEW YORK";
  }

  if(
    hour >= 0 &&
    hour < 7
  ){
    return "ASIA";
  }

  return "TRANSITION";
}


/* ================================================================
   TWELVE DATA PARSER
================================================================ */

function parseTDValues(json){

  if(
    !json ||
    !Array.isArray(
      json.values
    )
  ){

    throw new Error(
      json?.message ||
      "Twelve Data returned no candle values."
    );
  }


  return json.values
    .map(
      item => {

        const raw =
          String(
            item.datetime
          );

        const formatted =
          raw.includes("T")
            ? raw
            : raw.replace(
                " ",
                "T"
              );

        const timestamp =
          Date.parse(
            /[zZ]|[+-]\d\d:\d\d$/.test(
              formatted
            )
              ? formatted
              : `${formatted}Z`
          );


        const open =
          Number(item.open);

        const high =
          Number(item.high);

        const low =
          Number(item.low);

        const close =
          Number(item.close);


        if(
          !Number.isFinite(timestamp) ||
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close) ||
          open <= 0 ||
          high <= 0 ||
          low <= 0 ||
          close <= 0
        ){
          return null;
        }


        return {

          time:timestamp,

          open,
          high,
          low,
          close,

          volume:
            Number.isFinite(
              Number(
                item.volume
              )
            )
              ? Number(
                  item.volume
                )
              : 0
        };
      }
    )
    .filter(Boolean)
    .sort(
      (a,b) =>
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
  apiKey
}){

  if(!apiKey){

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

    `&apikey=${encodeURIComponent(apiKey)}`;


  const response =
    await fetch(
      url,
      {
        headers:{
          "User-Agent":
            "MKAYFX-GOLD-V8.2"
        }
      }
    );


  if(!response.ok){

    throw new Error(
      `Twelve Data HTTP ${response.status}`
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
      "Twelve Data error."
    );
  }


  return parseTDValues(
    json
  );
}


async function tdQuote({
  symbol,
  apiKey
}){

  if(!apiKey){
    return null;
  }


  const url =

    `${TD_BASE}/quote` +

    `?symbol=${encodeURIComponent(symbol)}` +

    `&apikey=${encodeURIComponent(apiKey)}`;


  const response =
    await fetch(url);


  if(!response.ok){

    throw new Error(
      `Twelve Data quote HTTP ${response.status}`
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
      "Twelve Data quote error."
    );
  }


  const price =
    safeNumber(
      json.close ??
      json.price,
      null
    );


  return {

    symbol,

    price,

    previousClose:
      safeNumber(
        json.previous_close,
        null
      ),

    change:
      safeNumber(
        json.change,
        null
      ),

    percentChange:
      safeNumber(
        json.percent_change,
        null
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

  if(!values.length){
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

  const output = [];

  for(
    let i = 0;
    i < values.length;
    i++
  ){

    if(i === 0){

      current =
        values[i];

    }else{

      current =
        values[i] *
        multiplier +
        current *
        (
          1 -
          multiplier
        );
    }

    output.push(current);
  }

  return output;
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

  const trueRanges = [
    candles[0].high -
    candles[0].low
  ];

  for(
    let i = 1;
    i < candles.length;
    i++
  ){

    const candle =
      candles[i];

    const previous =
      candles[i - 1];

    trueRanges.push(
      Math.max(
        candle.high -
        candle.low,

        Math.abs(
          candle.high -
          previous.close
        ),

        Math.abs(
          candle.low -
          previous.close
        )
      )
    );
  }

  return ema(
    trueRanges,
    period
  );
}


function atr(
  candles,
  period = 14
){

  const values =
    atrSeries(
      candles,
      period
    );

  return values.length
    ? last(values)
    : 0;
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
    period + 2
  ){
    return 50;
  }

  let gains = 0;
  let losses = 0;

  for(
    let i =
      candles.length -
      period;

    i <
      candles.length;

    i++
  ){

    const difference =
      candles[i].close -
      candles[i - 1].close;

    if(difference > 0){

      gains +=
        difference;

    }else{

      losses +=
        Math.abs(
          difference
        );
    }
  }

  const averageGain =
    gains /
    period;

  const averageLoss =
    losses /
    period;

  if(averageLoss === 0){
    return 100;
  }

  const rs =
    averageGain /
    averageLoss;

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

function macd(candles){

  if(
    candles.length <
    35
  ){

    return {
      macd:0,
      signal:0,
      histogram:0
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

  const macdLine =
    closes.map(
      (_,index) =>
        fast[index] -
        slow[index]
    );

  const signal =
    ema(
      macdLine,
      9
    );

  return {

    macd:
      last(macdLine),

    signal:
      last(signal),

    histogram:
      last(macdLine) -
      last(signal)
  };
}


/* ================================================================
   ROC
================================================================ */

function roc(
  candles,
  lookback = 10
){

  if(
    candles.length <=
    lookback
  ){
    return 0;
  }

  const current =
    last(candles).close;

  const previous =
    candles[
      candles.length -
      lookback -
      1
    ].close;

  if(!previous){
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

function vwapProxy(
  candles,
  lookback = 150
){

  const data =
    candles.slice(
      -lookback
    );

  if(!data.length){
    return 0;
  }

  let pv = 0;
  let volume = 0;

  for(const candle of data){

    const typical =
      (
        candle.high +
        candle.low +
        candle.close
      ) / 3;

    const activity =
      candle.volume > 0
        ? candle.volume
        : Math.max(
            candle.high -
            candle.low,
            .0001
          );

    pv +=
      typical *
      activity;

    volume +=
      activity;
  }

  return volume > 0
    ? pv /
      volume
    : last(data).close;
}


/* ================================================================
   PIVOTS
================================================================ */

function pivotHigh(
  candles,
  index,
  leftCount = 3,
  rightCount = 3
){

  if(
    index < leftCount ||
    index +
    rightCount >=
    candles.length
  ){
    return false;
  }

  const level =
    candles[index].high;

  for(
    let i =
      index -
      leftCount;

    i <=
      index +
      rightCount;

    i++
  ){

    if(i === index){
      continue;
    }

    if(
      candles[i].high >=
      level
    ){
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
){

  if(
    index < leftCount ||
    index +
    rightCount >=
    candles.length
  ){
    return false;
  }

  const level =
    candles[index].low;

  for(
    let i =
      index -
      leftCount;

    i <=
      index +
      rightCount;

    i++
  ){

    if(i === index){
      continue;
    }

    if(
      candles[i].low <=
      level
    ){
      return false;
    }
  }

  return true;
}


/* ================================================================
   SWINGS
================================================================ */

function swings(
  candles,
  lookback = 180
){

  const data =
    candles.slice(
      -lookback
    );

  const highs = [];
  const lows = [];

  for(
    let i = 3;
    i <
      data.length - 3;
    i++
  ){

    if(
      pivotHigh(
        data,
        i
      )
    ){

      highs.push({
        time:data[i].time,
        price:data[i].high
      });
    }

    if(
      pivotLow(
        data,
        i
      )
    ){

      lows.push({
        time:data[i].time,
        price:data[i].low
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

function structure(candles){

  if(
    candles.length <
    55
  ){

    return {
      bias:"NEUTRAL",
      score:0,
      ema20:null,
      ema50:null,
      bos:null,
      choch:null,
      lastSwingHigh:null,
      lastSwingLow:null
    };
  }

  const closes =
    candles.map(
      candle =>
        candle.close
    );

  const ema20 =
    last(
      ema(
        closes,
        20
      )
    );

  const ema50 =
    last(
      ema(
        closes,
        50
      )
    );

  const price =
    last(candles).close;

  const swingData =
    swings(
      candles,
      140
    );

  const swingHigh =
    swingData.highs.length
      ? last(
          swingData.highs
        )
      : null;

  const swingLow =
    swingData.lows.length
      ? last(
          swingData.lows
        )
      : null;

  let score = 0;

  if(price > ema20){
    score += 1;
  }else{
    score -= 1;
  }

  if(ema20 > ema50){
    score += 1;
  }else{
    score -= 1;
  }

  const recent =
    candles.slice(-10);

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

  const olderHigh =
    Math.max(
      ...previous.map(
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

  const olderLow =
    Math.min(
      ...previous.map(
        candle =>
          candle.low
      )
    );

  if(
    recentHigh >
    olderHigh &&
    recentLow >
    olderLow
  ){
    score += 2;
  }

  if(
    recentHigh <
    olderHigh &&
    recentLow <
    olderLow
  ){
    score -= 2;
  }

  let bos = null;
  let choch = null;

  if(
    swingHigh &&
    price >
    swingHigh.price
  ){
    bos =
      "BULLISH BOS";
  }

  if(
    swingLow &&
    price <
    swingLow.price
  ){
    bos =
      "BEARISH BOS";
  }

  if(
    score <= -1 &&
    swingHigh &&
    price >
    swingHigh.price
  ){
    choch =
      "BULLISH CHOCH";
  }

  if(
    score >= 1 &&
    swingLow &&
    price <
    swingLow.price
  ){
    choch =
      "BEARISH CHOCH";
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
        ema20,
        2
      ),

    ema50:
      round(
        ema50,
        2
      ),

    bos,
    choch,

    lastSwingHigh:
      swingHigh
        ? {
            price:
              round(
                swingHigh.price,
                2
              ),
            time:
              swingHigh.time
          }
        : null,

    lastSwingLow:
      swingLow
        ? {
            price:
              round(
                swingLow.price,
                2
              ),
            time:
              swingLow.time
          }
        : null
  };
}


/* ================================================================
   DISPLACEMENT
================================================================ */

function displacement(candles){

  if(
    candles.length <
    30
  ){

    return {
      active:false,
      direction:null,
      strength:0,
      expansion:0,
      bodyRatio:0
    };
  }

  const ranges =
    candles
      .slice(
        -25,
        -1
      )
      .map(
        candle =>
          candle.high -
          candle.low
      );

  const averageRange =
    mean(ranges);

  const candle =
    last(candles);

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

  const bodyRatio =
    body /
    range;

  const expansion =
    averageRange > 0
      ? range /
        averageRange
      : 0;

  const active =
    expansion >= 1.5 &&
    bodyRatio >= .65;

  return {

    active,

    direction:
      active
        ? (
            candle.close >
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
   SESSIONS
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
          ) !== day
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

  if(!data.length){
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
      data[0].open,

    close:
      last(data).close,

    startTime:
      data[0].time,

    endTime:
      last(data).time,

    bars:
      data.length
  };
}


function currentSessions(candles){

  if(!candles.length){
    return {};
  }

  const day =
    isoDay(
      last(candles).time
    );

  const result = {};

  for(
    const [name,definition]
    of Object.entries(
      SESSION_DEFS
    )
  ){

    const range =
      sessionRange(
        candles,
        day,
        definition
      );

    result[name] =
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
              ),

            open:
              round(
                range.open,
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
   PREVIOUS DAY
================================================================ */

function previousDayLevels(candles){

  const days =
    unique(
      candles.map(
        candle =>
          isoDay(
            candle.time
          )
      )
    );

  if(days.length < 2){
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
        ) === day
    );

  if(!data.length){
    return null;
  }

  return {

    date:day,

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

function previousWeekLevels(candles){

  const weeks =
    unique(
      candles.map(
        candle =>
          isoWeekKey(
            candle.time
          )
      )
    );

  if(weeks.length < 2){
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
        isoWeekKey(
          candle.time
        ) === week
    );

  if(!data.length){
    return null;
  }

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
   EQUAL LEVELS
================================================================ */

function detectEqualLevels(
  candles,
  atrValue
){

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

  const highs = [];
  const lows = [];

  for(
    let i = 0;
    i <
      swingData.highs.length;
    i++
  ){

    for(
      let j =
        i + 1;

      j <
        swingData.highs.length;

      j++
    ){

      const first =
        swingData.highs[i];

      const second =
        swingData.highs[j];

      if(
        Math.abs(
          first.price -
          second.price
        ) <=
        tolerance
      ){

        highs.push({

          level:
            (
              first.price +
              second.price
            ) / 2,

          firstTime:
            first.time,

          secondTime:
            second.time
        });
      }
    }
  }

  for(
    let i = 0;
    i <
      swingData.lows.length;
    i++
  ){

    for(
      let j =
        i + 1;

      j <
        swingData.lows.length;

      j++
    ){

      const first =
        swingData.lows[i];

      const second =
        swingData.lows[j];

      if(
        Math.abs(
          first.price -
          second.price
        ) <=
        tolerance
      ){

        lows.push({

          level:
            (
              first.price +
              second.price
            ) / 2,

          firstTime:
            first.time,

          secondTime:
            second.time
        });
      }
    }
  }

  return {

    highs:
      highs
        .slice(-8)
        .map(
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
      lows
        .slice(-8)
        .map(
          item => ({
            ...item,
            level:
              round(
                item.level,
                2
              )
          })
        )
  };
}


/* ================================================================
   FVG
================================================================ */

function fairValueGaps(
  candles,
  maxResults = 14
){

  const gaps = [];

  for(
    let i = 2;
    i <
      candles.length;
    i++
  ){

    const first =
      candles[
        i - 2
      ];

    const third =
      candles[i];

    if(
      third.low >
      first.high
    ){

      gaps.push({

        direction:
          "BULLISH",

        low:
          first.high,

        high:
          third.low,

        midpoint:
          (
            first.high +
            third.low
          ) / 2,

        time:
          third.time
      });
    }

    if(
      third.high <
      first.low
    ){

      gaps.push({

        direction:
          "BEARISH",

        low:
          third.high,

        high:
          first.low,

        midpoint:
          (
            third.high +
            first.low
          ) / 2,

        time:
          third.time
      });
    }
  }

  return gaps
    .slice(
      -maxResults
    )
    .map(
      gap => ({

        direction:
          gap.direction,

        low:
          round(
            gap.low,
            2
          ),

        high:
          round(
            gap.high,
            2
          ),

        midpoint:
          round(
            gap.midpoint,
            2
          ),

        time:
          gap.time
      })
    );
}


/* ================================================================
   DELTA ENGINE
================================================================ */

function deltaEngine(candles){

  if(!candles.length){

    return {
      delta:0,
      cvd:0,
      bias:"BALANCED",
      absorption:null,
      divergence:null
    };
  }

  const data =
    candles.slice(-120);

  let cvd = 0;

  const rows = [];

  for(const candle of data){

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
      candle.volume > 0
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

    cvd += delta;

    rows.push({

      time:
        candle.time,

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

  const recent =
    rows.slice(-12);

  const recentDelta =
    recent.reduce(
      (sum,row) =>
        sum +
        row.delta,
      0
    );

  const latest =
    last(rows);

  const averageRange =
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

  let absorption = null;

  if(
    latest &&
    averageRange > 0
  ){

    const expansion =
      latest.range /
      averageRange;

    if(
      expansion >= 1.25 &&
      latest.bodyRatio <= .35
    ){

      absorption =
        latest.delta > 0
          ? "BUYING ABSORBED"
          : latest.delta < 0
            ? "SELLING ABSORBED"
            : "TWO-WAY ABSORPTION";
    }
  }

  let divergence = null;

  if(rows.length >= 20){

    const older =
      rows[
        rows.length -
        15
      ];

    const newer =
      last(rows);

    const priceMove =
      newer.price -
      older.price;

    const cvdMove =
      newer.cvd -
      older.cvd;

    if(
      priceMove > 0 &&
      cvdMove < 0
    ){
      divergence =
        "BEARISH DELTA DIVERGENCE";
    }

    if(
      priceMove < 0 &&
      cvdMove > 0
    ){
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
      recentDelta > 0
        ? "BUYING PRESSURE"
        : recentDelta < 0
          ? "SELLING PRESSURE"
          : "BALANCED",

    absorption,
    divergence,

    note:
      "Candle/activity proxy, not centralized bid/ask order flow."
  };
}


/* ================================================================
   HISTORICAL SESSION STATS
================================================================ */

function historicalSessionStats(
  candles,
  sessionName
){

  const definition =
    SESSION_DEFS[
      sessionName
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

  let samples = 0;

  let highSweeps = 0;
  let highReturns = 0;

  let lowSweeps = 0;
  let lowReturns = 0;

  const highRaids = [];
  const lowRaids = [];

  for(const day of days){

    const session =
      sessionRange(
        candles,
        day,
        definition
      );

    if(!session){
      continue;
    }

    const future =
      candles.filter(
        candle =>
          candle.time >
          session.endTime &&
          candle.time <=
          session.endTime +
          16 *
          60 *
          60 *
          1000
      );

    if(future.length < 3){
      continue;
    }

    const past =
      candles.filter(
        candle =>
          candle.time <=
          session.endTime
      );

    const localATR =
      atr(
        past.slice(-100),
        14
      );

    if(
      !localATR ||
      localATR <= 0
    ){
      continue;
    }

    samples++;

    const futureHigh =
      Math.max(
        ...future.map(
          candle =>
            candle.high
        )
      );

    const futureLow =
      Math.min(
        ...future.map(
          candle =>
            candle.low
        )
      );

    if(
      futureHigh >
      session.high
    ){

      highSweeps++;

      highRaids.push(
        clamp(
          (
            futureHigh -
            session.high
          ) /
          localATR,
          0,
          8
        )
      );

      const firstSweep =
        future.findIndex(
          candle =>
            candle.high >
            session.high
        );

      if(firstSweep >= 0){

        const after =
          future.slice(
            firstSweep,
            firstSweep + 18
          );

        if(
          after.some(
            candle =>
              candle.close <
              session.high
          )
        ){
          highReturns++;
        }
      }
    }

    if(
      futureLow <
      session.low
    ){

      lowSweeps++;

      lowRaids.push(
        clamp(
          (
            session.low -
            futureLow
          ) /
          localATR,
          0,
          8
        )
      );

      const firstSweep =
        future.findIndex(
          candle =>
            candle.low <
            session.low
        );

      if(firstSweep >= 0){

        const after =
          future.slice(
            firstSweep,
            firstSweep + 18
          );

        if(
          after.some(
            candle =>
              candle.close >
              session.low
          )
        ){
          lowReturns++;
        }
      }
    }
  }


  function pack(
    swept,
    returned,
    raids
  ){

    const sweepRate =
      samples > 0
        ? swept /
          samples *
          100
        : 0;

    const returnRate =
      swept > 0
        ? returned /
          swept *
          100
        : 0;

    let confidence =
      "LOW";

    if(samples >= 40){

      confidence =
        "HIGH";

    }else if(samples >= 20){

      confidence =
        "MEDIUM";
    }

    return {

      samples,
      swept,
      returned,

      sweepRate:
        round(
          sweepRate,
          1
        ),

      returnRate:
        round(
          returnRate,
          1
        ),

      medianRaidATR:
        round(
          median(
            raids
          ),
          2
        ),

      p75RaidATR:
        round(
          percentile(
            raids,
            .75
          ),
          2
        ),

      p90RaidATR:
        round(
          percentile(
            raids,
            .90
          ),
          2
        ),

      confidence
    };
  }

  return {

    high:
      pack(
        highSweeps,
        highReturns,
        highRaids
      ),

    low:
      pack(
        lowSweeps,
        lowReturns,
        lowRaids
      )
  };
}


/* ================================================================
   HISTORY
================================================================ */

async function loadHistory(
  force = false
){

  if(
    !force &&
    historyCache.value &&
    Date.now() -
    historyCache.time <
    HISTORY_CACHE_MS
  ){
    return historyCache.value;
  }

  const candles =
    await tdSeries({

      symbol:SYMBOL,

      interval:
        "5min",

      outputsize:
        MAX_HISTORY,

      apiKey:
        KEY_3
    });

  const result = {

    candleCount:
      candles.length,

    firstTimestamp:
      candles.length
        ? candles[0].time
        : null,

    lastTimestamp:
      candles.length
        ? last(candles).time
        : null,

    statistics:{

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
    time:Date.now(),
    value:result
  };

  return result;
}


/* ================================================================
   RAW LIQUIDITY
================================================================ */

function buildRawLiquidityLevels({
  sessions,
  previousDay,
  previousWeek,
  h1,
  equalLevels,
  historicalStats
}){

  const levels = [];

  function add({
    name,
    level,
    side,
    type,
    strength,
    historical = null
  }){

    const n =
      Number(level);

    if(
      !Number.isFinite(n) ||
      n <= 0
    ){
      return;
    }

    levels.push({

      name,

      level:n,

      side,
      type,

      baseStrength:
        strength,

      historical
    });
  }


  if(sessions.ASIA){

    add({
      name:"ASIA HIGH",
      level:sessions.ASIA.high,
      side:"BUY_SIDE",
      type:"SESSION",
      strength:68,
      historical:
        historicalStats
          ?.ASIA
          ?.high
    });

    add({
      name:"ASIA LOW",
      level:sessions.ASIA.low,
      side:"SELL_SIDE",
      type:"SESSION",
      strength:68,
      historical:
        historicalStats
          ?.ASIA
          ?.low
    });
  }


  if(sessions.LONDON){

    add({
      name:"LONDON HIGH",
      level:sessions.LONDON.high,
      side:"BUY_SIDE",
      type:"SESSION",
      strength:80,
      historical:
        historicalStats
          ?.LONDON
          ?.high
    });

    add({
      name:"LONDON LOW",
      level:sessions.LONDON.low,
      side:"SELL_SIDE",
      type:"SESSION",
      strength:80,
      historical:
        historicalStats
          ?.LONDON
          ?.low
    });
  }


  if(sessions.NEW_YORK){

    add({
      name:"NEW YORK HIGH",
      level:sessions.NEW_YORK.high,
      side:"BUY_SIDE",
      type:"SESSION",
      strength:84,
      historical:
        historicalStats
          ?.NEW_YORK
          ?.high
    });

    add({
      name:"NEW YORK LOW",
      level:sessions.NEW_YORK.low,
      side:"SELL_SIDE",
      type:"SESSION",
      strength:84,
      historical:
        historicalStats
          ?.NEW_YORK
          ?.low
    });
  }


  if(previousDay){

    add({
      name:"PREVIOUS DAY HIGH",
      level:previousDay.high,
      side:"BUY_SIDE",
      type:"DAILY",
      strength:90
    });

    add({
      name:"PREVIOUS DAY LOW",
      level:previousDay.low,
      side:"SELL_SIDE",
      type:"DAILY",
      strength:90
    });
  }


  if(previousWeek){

    add({
      name:"PREVIOUS WEEK HIGH",
      level:previousWeek.high,
      side:"BUY_SIDE",
      type:"WEEKLY",
      strength:96
    });

    add({
      name:"PREVIOUS WEEK LOW",
      level:previousWeek.low,
      side:"SELL_SIDE",
      type:"WEEKLY",
      strength:96
    });
  }


  const h1Swings =
    swings(
      h1,
      200
    );


  for(
    const swing
    of h1Swings.highs.slice(-5)
  ){

    add({
      name:"H1 SWING HIGH",
      level:swing.price,
      side:"BUY_SIDE",
      type:"H1_SWING",
      strength:76
    });
  }


  for(
    const swing
    of h1Swings.lows.slice(-5)
  ){

    add({
      name:"H1 SWING LOW",
      level:swing.price,
      side:"SELL_SIDE",
      type:"H1_SWING",
      strength:76
    });
  }


  for(
    const item
    of equalLevels.highs
  ){

    add({
      name:"EQUAL HIGHS",
      level:item.level,
      side:"BUY_SIDE",
      type:"EQUAL_LEVEL",
      strength:88
    });
  }


  for(
    const item
    of equalLevels.lows
  ){

    add({
      name:"EQUAL LOWS",
      level:item.level,
      side:"SELL_SIDE",
      type:"EQUAL_LEVEL",
      strength:88
    });
  }

  return levels;
}


/* ================================================================
   DEALING RANGE
================================================================ */

function dealingRange(h1){

  const data =
    h1.slice(-48);

  if(!data.length){
    return null;
  }

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
        ) / 2,
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
   TOUCH HISTORY
================================================================ */

function zoneTouchHistory({
  candles,
  zoneLow,
  zoneHigh,
  side,
  atrValue
}){

  const data =
    candles.slice(-500);

  let approaches = 0;
  let touches = 0;
  let sweeps = 0;
  let rejections = 0;
  let acceptances = 0;

  let lastTouchIndex =
    null;

  const approachDistance =
    atrValue *
    .20;

  for(
    let i = 0;
    i <
      data.length;
    i++
  ){

    const candle =
      data[i];

    const approached =
      side === "BUY_SIDE"
        ? (
            candle.high >=
            zoneLow -
            approachDistance
          )
        : (
            candle.low <=
            zoneHigh +
            approachDistance
          );

    if(approached){
      approaches++;
    }

    const touched =
      candle.high >=
      zoneLow &&
      candle.low <=
      zoneHigh;

    if(touched){

      touches++;

      lastTouchIndex =
        i;
    }

    if(
      side ===
      "BUY_SIDE"
    ){

      if(
        candle.high >
        zoneHigh
      ){

        sweeps++;

        if(
          candle.close <
          zoneHigh
        ){
          rejections++;
        }else{
          acceptances++;
        }
      }

    }else{

      if(
        candle.low <
        zoneLow
      ){

        sweeps++;

        if(
          candle.close >
          zoneLow
        ){
          rejections++;
        }else{
          acceptances++;
        }
      }
    }
  }

  const barsSinceTouch =
    lastTouchIndex === null
      ? null
      : data.length -
        1 -
        lastTouchIndex;

  const freshnessScore =
    lastTouchIndex === null
      ? 100
      : clamp(
          100 -
          touches *
          13 +
          (
            barsSinceTouch ||
            0
          ) *
          .25,
          10,
          100
        );

  return {

    approaches,
    touches,
    sweeps,
    rejections,
    acceptances,
    barsSinceTouch,

    freshnessScore:
      round(
        freshnessScore,
        1
      ),

    state:
      touches === 0
        ? "FRESH"
        : touches <= 2
          ? "LIGHTLY TESTED"
          : touches <= 5
            ? "TESTED"
            : "HEAVILY TESTED"
  };
}


/* ================================================================
   APPROACH
================================================================ */

function analyzeApproach({
  candles,
  zone,
  atrValue
}){

  const data =
    candles.slice(-16);

  if(
    data.length <
    8
  ){

    return {
      label:"UNKNOWN",
      score:0,
      compression:0,
      directionality:0,
      structure:0
    };
  }

  const closes =
    data.map(
      candle =>
        candle.close
    );

  const first =
    closes[0];

  const current =
    last(closes);

  const netMove =
    current -
    first;

  const requiredDirection =
    zone.side ===
    "BUY_SIDE"
      ? 1
      : -1;

  const directionalMove =
    netMove *
    requiredDirection;

  const directionality =
    atrValue > 0
      ? clamp(
          directionalMove /
          atrValue *
          40,
          -100,
          100
        )
      : 0;

  const olderRange =
    mean(
      data
        .slice(0,8)
        .map(
          candle =>
            candle.high -
            candle.low
        )
    );

  const recentRange =
    mean(
      data
        .slice(-8)
        .map(
          candle =>
            candle.high -
            candle.low
        )
    );

  const compression =
    olderRange > 0
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

  let directionalStructure = 0;

  for(
    let i = 1;
    i <
      data.length;
    i++
  ){

    if(
      zone.side ===
      "BUY_SIDE"
    ){

      if(
        data[i].low >
        data[i - 1].low
      ){
        directionalStructure++;
      }

    }else{

      if(
        data[i].high <
        data[i - 1].high
      ){
        directionalStructure++;
      }
    }
  }

  const structureScore =
    directionalStructure /
    (
      data.length -
      1
    ) *
    100;

  const score =
    clamp(
      directionality *
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

  let label =
    "DRIFTING";

  if(
    score >= 70 &&
    compression > 10
  ){

    label =
      "COMPRESSING";

  }else if(
    score >= 55
  ){

    label =
      "ATTACKING";

  }else if(
    score >= 35
  ){

    label =
      "APPROACHING";

  }else if(
    directionality < 0
  ){

    label =
      "MOVING AWAY";
  }

  return {

    label,

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
        directionality,
        1
      ),

    structure:
      round(
        structureScore,
        1
      )
  };
}


/* ================================================================
   LIFECYCLE
================================================================ */

function liquidityLifecycle({
  zone,
  m5,
  price,
  atrValue,
  approach
}){

  const recent =
    m5.slice(-4);

  const current =
    last(m5);

  const distance =
    zone.side ===
    "BUY_SIDE"
      ? zone.low -
        price
      : price -
        zone.high;

  const distanceATR =
    atrValue > 0
      ? Math.max(
          distance,
          0
        ) /
        atrValue
      : 0;

  let beyondCount = 0;

  for(const candle of recent){

    if(
      zone.side ===
      "BUY_SIDE"
    ){

      if(
        candle.close >
        zone.high
      ){
        beyondCount++;
      }

    }else{

      if(
        candle.close <
        zone.low
      ){
        beyondCount++;
      }
    }
  }

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

  if(
    beyondCount >= 2
  ){

    return {
      stage:"ACCEPTING",
      distanceATR:
        round(
          distanceATR,
          2
        ),
      penetrated,
      rejected
    };
  }

  if(rejected){

    return {
      stage:"REJECTING",
      distanceATR:
        round(
          distanceATR,
          2
        ),
      penetrated,
      rejected
    };
  }

  if(penetrated){

    return {
      stage:"RAIDING",
      distanceATR:
        round(
          distanceATR,
          2
        ),
      penetrated,
      rejected
    };
  }

  if(
    distanceATR <=
    .20
  ){

    return {
      stage:"ATTACKING",
      distanceATR:
        round(
          distanceATR,
          2
        ),
      penetrated:false,
      rejected:false
    };
  }

  if(
    approach.label ===
    "COMPRESSING" &&
    distanceATR <=
    .75
  ){

    return {
      stage:"COMPRESSING",
      distanceATR:
        round(
          distanceATR,
          2
        ),
      penetrated:false,
      rejected:false
    };
  }

  if(
    distanceATR <=
    1.25
  ){

    return {
      stage:"APPROACHING",
      distanceATR:
        round(
          distanceATR,
          2
        ),
      penetrated:false,
      rejected:false
    };
  }

  return {
    stage:"TRACKING",
    distanceATR:
      round(
        distanceATR,
        2
      ),
    penetrated:false,
    rejected:false
  };
}


/* ================================================================
   CLUSTER LIQUIDITY
================================================================ */

function clusterLiquidityLevels({
  levels,
  price,
  atrValue,
  m5,
  h1,
  fvgs
}){

  if(!levels.length){
    return [];
  }

  const clusterDistance =
    Math.max(
      atrValue *
      .22,
      .25
    );

  const grouped = [];

  for(
    const side
    of [
      "BUY_SIDE",
      "SELL_SIDE"
    ]
  ){

    const sideLevels =
      levels
        .filter(
          level =>
            level.side ===
            side
        )
        .sort(
          (a,b) =>
            a.level -
            b.level
        );

    let currentCluster = [];

    for(const level of sideLevels){

      if(!currentCluster.length){

        currentCluster = [
          level
        ];

        continue;
      }

      const clusterAverage =
        mean(
          currentCluster.map(
            item =>
              item.level
          )
        );

      if(
        Math.abs(
          level.level -
          clusterAverage
        ) <=
        clusterDistance
      ){

        currentCluster.push(
          level
        );

      }else{

        grouped.push(
          currentCluster
        );

        currentCluster = [
          level
        ];
      }
    }

    if(currentCluster.length){

      grouped.push(
        currentCluster
      );
    }
  }

  const dealing =
    dealingRange(
      h1
    );

  const zones = [];

  for(
    let index = 0;
    index <
      grouped.length;
    index++
  ){

    const cluster =
      grouped[index];

    const side =
      cluster[0].side;

    const levelPrices =
      cluster.map(
        item =>
          item.level
      );

    const rawLow =
      Math.min(
        ...levelPrices
      );

    const rawHigh =
      Math.max(
        ...levelPrices
      );

    const buffer =
      atrValue *
      .05;

    const zoneLow =
      rawLow -
      buffer;

    const zoneHigh =
      rawHigh +
      buffer;

    const center =
      (
        zoneLow +
        zoneHigh
      ) / 2;

    const distance =
      side ===
      "BUY_SIDE"
        ? Math.max(
            center -
            price,
            0
          )
        : Math.max(
            price -
            center,
            0
          );

    const absoluteDistance =
      Math.abs(
        center -
        price
      );

    const distanceATR =
      atrValue > 0
        ? absoluteDistance /
          atrValue
        : 0;

    const proximity =
      clamp(
        100 -
        distanceATR *
        24,
        0,
        100
      );

    const componentCount =
      cluster.length;

    const density =
      clamp(
        componentCount *
        18 +
        (
          componentCount >= 3
            ? 15
            : 0
        ),
        0,
        100
      );

    const structuralStrength =
      mean(
        cluster.map(
          item =>
            item.baseStrength
        )
      );

    const historicalItems =
      cluster
        .map(
          item =>
            item.historical
        )
        .filter(Boolean);

    const historicalSweepRate =
      historicalItems.length
        ? mean(
            historicalItems.map(
              item =>
                item.sweepRate
            )
          )
        : null;

    const historicalReturnRate =
      historicalItems.length
        ? mean(
            historicalItems.map(
              item =>
                item.returnRate
            )
          )
        : null;

    const historicalMedianRaidATR =
      historicalItems.length
        ? mean(
            historicalItems.map(
              item =>
                item.medianRaidATR
            )
          )
        : .25;

    const historicalConfidence =
      historicalItems.some(
        item =>
          item.confidence ===
          "HIGH"
      )
        ? "HIGH"
        : historicalItems.some(
            item =>
              item.confidence ===
              "MEDIUM"
          )
          ? "MEDIUM"
          : historicalItems.length
            ? "LOW"
            : "MODEL";

    const touchHistory =
      zoneTouchHistory({
        candles:m5,
        zoneLow,
        zoneHigh,
        side,
        atrValue
      });

    const fvgOverlap =
      fvgs.filter(
        gap =>
          gap.high >=
          zoneLow -
          atrValue *
          .25 &&
          gap.low <=
          zoneHigh +
          atrValue *
          .25
      );

    const temporaryZone = {
      side,
      low:zoneLow,
      high:zoneHigh,
      center
    };

    const approach =
      analyzeApproach({
        candles:m5,
        zone:temporaryZone,
        atrValue
      });

    const lifecycle =
      liquidityLifecycle({
        zone:temporaryZone,
        m5,
        price,
        atrValue,
        approach
      });

    let liquidityClass =
      "INTERNAL";

    if(
      dealing &&
      dealing.range > 0
    ){

      const upperExternal =
        dealing.high -
        dealing.range *
        .15;

      const lowerExternal =
        dealing.low +
        dealing.range *
        .15;

      if(
        side ===
        "BUY_SIDE" &&
        center >=
        upperExternal
      ){
        liquidityClass =
          "EXTERNAL";
      }

      if(
        side ===
        "SELL_SIDE" &&
        center <=
        lowerExternal
      ){
        liquidityClass =
          "EXTERNAL";
      }
    }

    const sessionCount =
      cluster.filter(
        item =>
          item.type ===
          "SESSION"
      ).length;

    const majorCount =
      cluster.filter(
        item =>
          [
            "DAILY",
            "WEEKLY",
            "EQUAL_LEVEL"
          ].includes(
            item.type
          )
      ).length;

    const sessionRelevance =
      clamp(
        sessionCount *
        24 +
        majorCount *
        18,
        0,
        100
      );

    const historicalScore =
      historicalSweepRate === null
        ? 45
        : historicalSweepRate;

    const heat =
      clamp(
        structuralStrength *
        .25 +
        density *
        .20 +
        touchHistory.freshnessScore *
        .15 +
        historicalScore *
        .15 +
        proximity *
        .10 +
        sessionRelevance *
        .05 +
        approach.score *
        .10,
        0,
        100
      );

    let raidLikelihood =
      clamp(
        heat *
        .45 +
        proximity *
        .20 +
        approach.score *
        .20 +
        historicalScore *
        .15,
        0,
        100
      );

    if(
      lifecycle.stage ===
      "ATTACKING"
    ){
      raidLikelihood += 6;
    }

    if(
      lifecycle.stage ===
      "RAIDING"
    ){

      raidLikelihood =
        Math.max(
          raidLikelihood,
          92
        );
    }

    raidLikelihood =
      clamp(
        raidLikelihood,
        0,
        100
      );

    let reversalLikelihood =
      clamp(
        (
          historicalReturnRate ??
          50
        ) *
        .35 +
        touchHistory.freshnessScore *
        .18 +
        (
          fvgOverlap.length
            ? 80
            : 45
        ) *
        .12 +
        structuralStrength *
        .15 +
        (
          lifecycle.stage ===
          "REJECTING"
            ? 100
            : lifecycle.stage ===
              "RAIDING"
              ? 60
              : 45
        ) *
        .20,
        0,
        100
      );

    if(
      lifecycle.stage ===
      "ACCEPTING"
    ){

      reversalLikelihood *=
        .55;
    }

    const continuationLikelihood =
      clamp(
        100 -
        reversalLikelihood +
        (
          lifecycle.stage ===
          "ACCEPTING"
            ? 25
            : 0
        ),
        0,
        100
      );

    const stopExtensionATR =
      clamp(
        .10 +
        density /
        100 *
        .18,
        .10,
        .30
      );

    const estimatedStopPool =
      side ===
      "BUY_SIDE"
        ? {
            low:
              round(
                zoneHigh,
                2
              ),

            high:
              round(
                zoneHigh +
                atrValue *
                stopExtensionATR,
                2
              )
          }
        : {
            low:
              round(
                zoneLow -
                atrValue *
                stopExtensionATR,
                2
              ),

            high:
              round(
                zoneLow,
                2
              )
          };

    const raidDepthATR =
      clamp(
        historicalMedianRaidATR ||
        .25,
        .08,
        2
      );

    const projectedRaidZone =
      side ===
      "BUY_SIDE"
        ? {
            low:
              round(
                zoneHigh,
                2
              ),

            high:
              round(
                zoneHigh +
                atrValue *
                raidDepthATR,
                2
              )
          }
        : {
            low:
              round(
                zoneLow -
                atrValue *
                raidDepthATR,
                2
              ),

            high:
              round(
                zoneLow,
                2
              )
          };

    const names =
      unique(
        cluster.map(
          item =>
            item.name
        )
      );

    const types =
      unique(
        cluster.map(
          item =>
            item.type
        )
      );

    zones.push({

      id:
        `LZ-${side}-${index + 1}`,

      name:
        componentCount >= 3
          ? (
              side ===
              "BUY_SIDE"
                ? "MAJOR BUY-SIDE CLUSTER"
                : "MAJOR SELL-SIDE CLUSTER"
            )
          : componentCount === 2
            ? (
                side ===
                "BUY_SIDE"
                  ? "BUY-SIDE CLUSTER"
                  : "SELL-SIDE CLUSTER"
              )
            : names[0],

      side,

      liquidityClass,

      /*
         CANONICAL PRICE FIELDS.

         Frontend now has several safe ways to get the actual
         liquidity price and can never confuse a score for a price.
      */

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

      midpoint:
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
          zoneLow,
          2
        ),

      high:
        round(
          zoneHigh,
          2
        ),

      distance:
        round(
          absoluteDistance,
          2
        ),

      distanceATR:
        round(
          distanceATR,
          2
        ),

      componentCount,

      components:
        cluster.map(
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
              item.baseStrength
          })
        ),

      componentNames:
        names,

      componentTypes:
        types,

      density:
        round(
          density,
          1
        ),

      structuralStrength:
        round(
          structuralStrength,
          1
        ),

      freshness:
        touchHistory.freshnessScore,

      freshnessState:
        touchHistory.state,

      touchHistory,

      historical:{

        available:
          historicalItems.length >
          0,

        sweepRate:
          historicalSweepRate ===
          null
            ? null
            : round(
                historicalSweepRate,
                1
              ),

        returnRate:
          historicalReturnRate ===
          null
            ? null
            : round(
                historicalReturnRate,
                1
              ),

        medianRaidATR:
          round(
            historicalMedianRaidATR,
            2
          ),

        confidence:
          historicalConfidence
      },

      fvgOverlap:
        fvgOverlap.length >
        0,

      overlappingFVGs:
        fvgOverlap,

      sessionRelevance:
        round(
          sessionRelevance,
          1
        ),

      approach,

      lifecycle,

      heat:
        round(
          heat,
          1
        ),

      raidLikelihood:
        round(
          raidLikelihood,
          1
        ),

      raidScore:
        round(
          raidLikelihood,
          1
        ),

      score:
        round(
          raidLikelihood,
          1
        ),

      reversalLikelihood:
        round(
          reversalLikelihood,
          1
        ),

      continuationLikelihood:
        round(
          continuationLikelihood,
          1
        ),

      estimatedStopPool,

      projectedRaidZone,

      projectedRaidATR:
        round(
          raidDepthATR,
          2
        )
    });
  }

  return zones.filter(
    zone =>
      zone.distanceATR <= 8 ||
      zone.liquidityClass ===
      "EXTERNAL"
  );
}


/* ================================================================
   SWEEP QUALITY
================================================================ */

function evaluateSweepQuality({
  zone,
  m1,
  m5,
  delta,
  displacementM1
}){

  const checks = {

    zonePenetrated:false,

    closeBackInside:false,

    m1ReversalStructure:false,

    displacementAway:false,

    deltaDivergence:false,

    absorption:false
  };

  const latestM5 =
    last(m5);

  const m1Structure =
    structure(m1);

  if(
    zone.side ===
    "BUY_SIDE"
  ){

    checks.zonePenetrated =
      latestM5.high >
      zone.high;

    checks.closeBackInside =
      latestM5.close <
      zone.high;

    checks.m1ReversalStructure =
      m1Structure.bias ===
      "BEARISH" ||
      m1Structure.choch ===
      "BEARISH CHOCH";

    checks.displacementAway =
      displacementM1.active &&
      displacementM1.direction ===
      "BEARISH";

    checks.deltaDivergence =
      delta.divergence ===
      "BEARISH DELTA DIVERGENCE";

    checks.absorption =
      delta.absorption ===
      "BUYING ABSORBED";

  }else{

    checks.zonePenetrated =
      latestM5.low <
      zone.low;

    checks.closeBackInside =
      latestM5.close >
      zone.low;

    checks.m1ReversalStructure =
      m1Structure.bias ===
      "BULLISH" ||
      m1Structure.choch ===
      "BULLISH CHOCH";

    checks.displacementAway =
      displacementM1.active &&
      displacementM1.direction ===
      "BULLISH";

    checks.deltaDivergence =
      delta.divergence ===
      "BULLISH DELTA DIVERGENCE";

    checks.absorption =
      delta.absorption ===
      "SELLING ABSORBED";
  }

  const weights = {

    zonePenetrated:20,

    closeBackInside:20,

    m1ReversalStructure:20,

    displacementAway:20,

    deltaDivergence:10,

    absorption:10
  };

  let score = 0;

  for(
    const [name,passed]
    of Object.entries(
      checks
    )
  ){

    if(passed){
      score +=
        weights[name];
    }
  }

  return {

    score:
      round(
        score,
        1
      ),

    quality:
      score >= 80
        ? "ELITE"
        : score >= 65
          ? "STRONG"
          : score >= 45
            ? "MODERATE"
            : score > 0
              ? "WEAK"
              : "NONE",

    checks
  };
}


/* ================================================================
   LIQUIDITY PATH
================================================================ */

function buildLiquidityPath(zones){

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

        let stageBonus = 0;

        if(
          zone.lifecycle.stage ===
          "COMPRESSING"
        ){
          stageBonus = 8;
        }

        if(
          zone.lifecycle.stage ===
          "ATTACKING"
        ){
          stageBonus = 12;
        }

        if(
          zone.lifecycle.stage ===
          "RAIDING"
        ){
          stageBonus = 15;
        }

        const nextTargetScore =
          clamp(
            zone.raidLikelihood *
            .50 +
            zone.heat *
            .25 +
            proximity *
            .20 +
            stageBonus,
            0,
            100
          );

        return {

          ...zone,

          nextTargetScore:
            round(
              nextTargetScore,
              1
            ),

          /*
             Use raid likelihood as the chart/UI's actual RAID SCORE.
          */

          raidScore:
            zone.raidLikelihood,

          score:
            zone.raidLikelihood
        };
      }
    )
    .sort(
      (a,b) =>
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
){

  if(
    !candles ||
    candles.length <=
    bars
  ){
    return 0;
  }

  const current =
    last(candles).close;

  const previous =
    candles[
      candles.length -
      bars -
      1
    ].close;

  if(!previous){
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


async function loadIntermarket(
  force = false
){

  if(
    !force &&
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

  const results =
    await Promise.all(
      symbols.map(
        symbol =>
          tdSeries({
            symbol,
            interval:"1h",
            outputsize:80,
            apiKey:KEY_4
          })
          .catch(
            () => []
          )
      )
    );

  const data = {};

  symbols.forEach(
    (symbol,index) => {
      data[symbol] =
        results[index];
    }
  );

  const configs = {

    "XAG/USD":{
      label:"SILVER",
      weight:.36,
      direction:1
    },

    "EUR/USD":{
      label:"EUR/USD",
      weight:.20,
      direction:1
    },

    "GBP/USD":{
      label:"GBP/USD",
      weight:.12,
      direction:1
    },

    "USD/JPY":{
      label:"USD/JPY",
      weight:.22,
      direction:-1
    },

    "BTC/USD":{
      label:"BITCOIN",
      weight:.10,
      direction:1
    }
  };

  const markets = [];

  let weightedTotal = 0;
  let activeWeight = 0;

  for(
    const [symbol,config]
    of Object.entries(
      configs
    )
  ){

    const candles =
      data[symbol];

    if(
      !candles ||
      candles.length <
      15
    ){
      continue;
    }

    const move1 =
      percentageMove(
        candles,
        1
      );

    const move3 =
      percentageMove(
        candles,
        3
      );

    const move6 =
      percentageMove(
        candles,
        6
      );

    const move12 =
      percentageMove(
        candles,
        12
      );

    const combinedMove =
      move1 *
      .15 +
      move3 *
      .25 +
      move6 *
      .25 +
      move12 *
      .35;

    const normalized =
      clamp(
        combinedMove *
        80,
        -100,
        100
      );

    const contribution =
      normalized *
      config.direction;

    weightedTotal +=
      contribution *
      config.weight;

    activeWeight +=
      config.weight;

    markets.push({

      symbol,

      label:
        config.label,

      price:
        round(
          last(candles).close,
          symbol ===
          "BTC/USD"
            ? 1
            : 5
        ),

      move1h:
        round(
          move1,
          3
        ),

      move3h:
        round(
          move3,
          3
        ),

      move6h:
        round(
          move6,
          3
        ),

      move12h:
        round(
          move12,
          3
        ),

      goldContribution:
        round(
          contribution,
          1
        ),

      goldBias:
        contribution >= 15
          ? "BULLISH GOLD"
          : contribution <= -15
            ? "BEARISH GOLD"
            : "NEUTRAL"
    });
  }

  const score =
    activeWeight > 0
      ? weightedTotal /
        activeWeight
      : 0;

  const result = {

    score:
      round(
        score,
        1
      ),

    bias:
      score >= 15
        ? "BULLISH"
        : score <= -15
          ? "BEARISH"
          : "NEUTRAL",

    strength:
      Math.abs(score) >= 60
        ? "STRONG"
        : Math.abs(score) >= 30
          ? "MODERATE"
          : "WEAK",

    markets:
      markets.sort(
        (a,b) =>
          Math.abs(
            b.goldContribution
          ) -
          Math.abs(
            a.goldContribution
          )
      )
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
  seriesId
){

  if(!FRED_KEY){
    return [];
  }

  const url =

    `${FRED_BASE}/series/observations` +

    `?series_id=${encodeURIComponent(seriesId)}` +

    `&api_key=${encodeURIComponent(FRED_KEY)}` +

    `&file_type=json` +

    `&sort_order=desc` +

    `&limit=20`;


  const response =
    await fetch(url);


  if(!response.ok){

    throw new Error(
      `FRED ${seriesId} HTTP ${response.status}`
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
      row.value !== "." &&
      Number.isFinite(
        Number(
          row.value
        )
      )
  )
  .map(
    row => ({
      date:row.date,
      value:Number(row.value)
    })
  );
}


function fredChange(series){

  if(
    !series ||
    series.length <
    2
  ){
    return 0;
  }

  return (
    series[0].value -
    series[1].value
  );
}


async function loadMacro(
  force = false
){

  if(
    !force &&
    macroCache.value &&
    Date.now() -
    macroCache.time <
    MACRO_CACHE_MS
  ){
    return macroCache.value;
  }

  if(!FRED_KEY){

    return {
      enabled:false,
      score:0,
      bias:"NEUTRAL",
      reason:"FRED_API_KEY missing."
    };
  }

  try{

    const [
      twoYear,
      tenYear,
      fedFunds
    ] =
      await Promise.all([

        fredSeries("DGS2"),

        fredSeries("DGS10"),

        fredSeries("FEDFUNDS")

      ]);

    const change2 =
      fredChange(
        twoYear
      );

    const change10 =
      fredChange(
        tenYear
      );

    const score =
      clamp(
        (
          -change2 *
          320
        ) +
        (
          -change10 *
          260
        ),
        -100,
        100
      );

    const result = {

      enabled:true,

      score:
        round(
          score,
          1
        ),

      bias:
        score >= 15
          ? "BULLISH GOLD"
          : score <= -15
            ? "BEARISH GOLD"
            : "NEUTRAL",

      twoYear:
        twoYear.length
          ? {
              value:
                round(
                  twoYear[0].value,
                  3
                ),
              change:
                round(
                  change2,
                  3
                ),
              date:
                twoYear[0].date
            }
          : null,

      tenYear:
        tenYear.length
          ? {
              value:
                round(
                  tenYear[0].value,
                  3
                ),
              change:
                round(
                  change10,
                  3
                ),
              date:
                tenYear[0].date
            }
          : null,

      fedFunds:
        fedFunds.length
          ? {
              value:
                round(
                  fedFunds[0].value,
                  3
                ),
              date:
                fedFunds[0].date
            }
          : null
    };

    macroCache = {
      time:Date.now(),
      value:result
    };

    return result;

  }catch(error){

    return {
      enabled:false,
      score:0,
      bias:"UNAVAILABLE",
      error:error.message
    };
  }
}


/* ================================================================
   FEED VALIDATION
================================================================ */

function feedValidation(
  primary,
  secondary,
  atrValue
){

  if(
    !Number.isFinite(primary) ||
    !Number.isFinite(secondary) ||
    primary <= 0 ||
    secondary <= 0
  ){

    return {
      available:false,
      status:"SECONDARY UNAVAILABLE"
    };
  }

  const difference =
    Math.abs(
      primary -
      secondary
    );

  const differenceATR =
    atrValue > 0
      ? difference /
        atrValue
      : 0;

  let status =
    "GOOD";

  if(
    differenceATR >
    .25
  ){

    status =
      "DISAGREEMENT";

  }else if(
    differenceATR >
    .10
  ){

    status =
      "CAUTION";
  }

  return {

    available:true,
    status,

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
        differenceATR,
        3
      )
  };
}


/* ================================================================
   REGIME
================================================================ */

function marketRegime(candles){

  if(
    candles.length <
    50
  ){

    return {
      regime:"UNKNOWN",
      volatility:"UNKNOWN",
      trendStrength:0
    };
  }

  const ranges =
    candles
      .slice(-40)
      .map(
        candle =>
          candle.high -
          candle.low
      );

  const recent =
    mean(
      ranges.slice(-10)
    );

  const previous =
    mean(
      ranges.slice(
        -30,
        -10
      )
    );

  let volatility =
    "NORMAL";

  if(
    recent >
    previous *
    1.35
  ){

    volatility =
      "EXPANDING";

  }else if(
    recent <
    previous *
    .72
  ){

    volatility =
      "CONTRACTING";
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

  const localATR =
    atr(
      candles,
      14
    );

  const trendStrength =
    localATR > 0
      ? Math.abs(
          e20 -
          e50
        ) /
        localATR
      : 0;

  const bias =
    structure(
      candles
    ).bias;

  let regime =
    "RANGING";

  if(
    trendStrength >=
    .7
  ){

    regime =
      bias ===
      "BULLISH"
        ? "TRENDING UP"
        : bias ===
          "BEARISH"
          ? "TRENDING DOWN"
          : "TRANSITION";
  }

  return {

    regime,
    volatility,

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

function buildConsensus({
  m5,
  m15,
  h1,
  h4,
  liquidityPath,
  intermarket,
  macro,
  delta,
  dominantSweepQuality,
  feedQuality
}){

  const s5 =
    structure(m5);

  const s15 =
    structure(m15);

  const s1 =
    structure(h1);

  const s4 =
    structure(h4);

  let technicalScore =
    s5.score *
    9 +
    s15.score *
    14 +
    s1.score *
    18 +
    s4.score *
    21;

  technicalScore =
    clamp(
      technicalScore,
      -100,
      100
    );

  const dominant =
    liquidityPath[0] ||
    null;

  let liquidityDraw = 0;

  if(dominant){

    let direction =
      dominant.side ===
      "BUY_SIDE"
        ? 1
        : -1;

    if(
      dominant.lifecycle.stage ===
      "REJECTING"
    ){

      direction *= -1;
    }

    liquidityDraw =
      dominant.nextTargetScore *
      direction;
  }

  let flowScore = 0;

  if(
    delta.bias ===
    "BUYING PRESSURE"
  ){

    flowScore =
      clamp(
        Math.abs(
          delta.delta
        ) /
        8,
        0,
        100
      );

  }else if(
    delta.bias ===
    "SELLING PRESSURE"
  ){

    flowScore =
      -clamp(
        Math.abs(
          delta.delta
        ) /
        8,
        0,
        100
      );
  }

  let sweepReversalScore = 0;

  if(
    dominant &&
    dominant.lifecycle.stage ===
    "REJECTING"
  ){

    sweepReversalScore =
      dominant.side ===
      "BUY_SIDE"
        ? -dominantSweepQuality.score
        : dominantSweepQuality.score;
  }

  const score =
    clamp(
      technicalScore *
      .27 +
      liquidityDraw *
      .27 +
      intermarket.score *
      .19 +
      (
        macro.score ||
        0
      ) *
      .10 +
      flowScore *
      .07 +
      sweepReversalScore *
      .10,
      -100,
      100
    );

  let confidence =
    Math.abs(score);

  if(dominant){

    confidence =
      confidence *
      .70 +
      dominant.heat *
      .30;
  }

  if(
    feedQuality.status ===
    "DISAGREEMENT"
  ){
    confidence -= 20;
  }

  confidence =
    clamp(
      confidence,
      0,
      100
    );

  const direction =
    score >= 20
      ? "BULLISH"
      : score <= -20
        ? "BEARISH"
        : "NEUTRAL";

  const liquidityDrawDirection =
    !dominant
      ? "NONE"
      : dominant.lifecycle.stage ===
        "REJECTING"
        ? (
            dominant.side ===
            "BUY_SIDE"
              ? "DOWN AFTER BUY-SIDE RAID"
              : "UP AFTER SELL-SIDE RAID"
          )
        : (
            dominant.side ===
            "BUY_SIDE"
              ? "UP TOWARD BUY-SIDE LIQUIDITY"
              : "DOWN TOWARD SELL-SIDE LIQUIDITY"
          );

  const reasons = [

    `M5 structure: ${s5.bias}`,

    `M15 structure: ${s15.bias}`,

    `H1 structure: ${s1.bias}`,

    `H4 structure: ${s4.bias}`,

    `Intermarket: ${intermarket.bias} ${intermarket.score}`

  ];

  if(dominant){

    reasons.push(
      `Dominant liquidity: ${dominant.name}`
    );

    reasons.push(
      `Target price: ${dominant.price}`
    );

    reasons.push(
      `Zone heat: ${dominant.heat}/100`
    );

    reasons.push(
      `Raid likelihood: ${dominant.raidLikelihood}/100`
    );

    reasons.push(
      `Lifecycle: ${dominant.lifecycle.stage}`
    );

    reasons.push(
      `Approach: ${dominant.approach.label} ${dominant.approach.score}/100`
    );
  }

  if(macro.enabled){

    reasons.push(
      `Macro: ${macro.bias} ${macro.score}`
    );
  }

  if(delta.divergence){

    reasons.push(
      delta.divergence
    );
  }

  if(delta.absorption){

    reasons.push(
      delta.absorption
    );
  }

  if(
    dominantSweepQuality.score >
    0
  ){

    reasons.push(
      `Sweep quality: ${dominantSweepQuality.quality} ${dominantSweepQuality.score}/100`
    );
  }

  return {

    direction,

    score:
      round(
        score,
        1
      ),

    confidence:
      round(
        confidence,
        1
      ),

    liquidityDrawDirection,

    components:{

      technical:
        round(
          technicalScore,
          1
        ),

      liquidityDraw:
        round(
          liquidityDraw,
          1
        ),

      intermarket:
        round(
          intermarket.score,
          1
        ),

      macro:
        round(
          macro.score ||
          0,
          1
        ),

      flow:
        round(
          flowScore,
          1
        ),

      sweepReversal:
        round(
          sweepReversalScore,
          1
        )
    },

    reasons
  };
}


/* ================================================================
   MAIN ENGINE
================================================================ */

async function buildIntelligence(
  force = false
){

  if(
    !force &&
    liveCache.value &&
    Date.now() -
    liveCache.time <
    LIVE_CACHE_MS
  ){

    return {
      ...liveCache.value,
      cached:true
    };
  }

  if(!KEY_1){

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
        symbol:SYMBOL,
        interval:"1min",
        outputsize:500,
        apiKey:KEY_1
      }),

      tdSeries({
        symbol:SYMBOL,
        interval:"5min",
        outputsize:1200,
        apiKey:KEY_1
      }),

      tdSeries({
        symbol:SYMBOL,
        interval:"15min",
        outputsize:700,
        apiKey:KEY_2
      }),

      tdSeries({
        symbol:SYMBOL,
        interval:"1h",
        outputsize:700,
        apiKey:KEY_2
      }),

      tdSeries({
        symbol:SYMBOL,
        interval:"4h",
        outputsize:400,
        apiKey:KEY_2
      }),

      tdQuote({
        symbol:SYMBOL,
        apiKey:KEY_1
      })
      .catch(
        () => null
      ),

      loadHistory(force)
        .catch(
          error => ({
            candleCount:0,
            firstTimestamp:null,
            lastTimestamp:null,
            error:error.message,
            statistics:{
              ASIA:{
                high:null,
                low:null
              },
              LONDON:{
                high:null,
                low:null
              },
              NEW_YORK:{
                high:null,
                low:null
              }
            }
          })
        ),

      loadIntermarket(force)
        .catch(
          error => ({
            score:0,
            bias:"UNAVAILABLE",
            strength:"NONE",
            error:error.message,
            markets:[]
          })
        ),

      loadMacro(force),

      tdQuote({
        symbol:SYMBOL,
        apiKey:KEY_4
      })
      .catch(
        () => null
      )

    ]);

  if(
    !m1.length ||
    !m5.length ||
    !m15.length ||
    !h1.length ||
    !h4.length
  ){

    throw new Error(
      "One or more required XAU/USD timeframe feeds returned no candles."
    );
  }

  const fallbackPrice =
    last(m1)?.close ||
    last(m5)?.close ||
    0;

  const quotePrice =
    Number(
      primaryQuote?.price
    );

  const price =
    Number.isFinite(
      quotePrice
    ) &&
    quotePrice > 0
      ? quotePrice
      : fallbackPrice;

  if(
    !Number.isFinite(price) ||
    price <= 0
  ){

    throw new Error(
      "Could not determine a valid XAU/USD price."
    );
  }

  const atrM1 =
    atr(
      m1,
      14
    );

  const atrM5 =
    atr(
      m5,
      14
    );

  const atrM15 =
    atr(
      m15,
      14
    );

  const sessions =
    currentSessions(
      m5
    );

  const previousDay =
    previousDayLevels(
      m5
    );

  const previousWeek =
    previousWeekLevels(
      h1
    );

  const equalLevels =
    detectEqualLevels(
      m5,
      atrM5
    );

  const fvgs =
    fairValueGaps(
      m15,
      14
    );

  const rawLiquidityLevels =
    buildRawLiquidityLevels({

      sessions,

      previousDay,

      previousWeek,

      h1,

      equalLevels,

      historicalStats:
        history.statistics ||
        {}

    });

  const zones =
    clusterLiquidityLevels({

      levels:
        rawLiquidityLevels,

      price,

      atrValue:
        atrM5,

      m5,

      h1,

      fvgs

    });

  const liquidityPath =
    buildLiquidityPath(
      zones
    );

  const dominantZone =
    liquidityPath[0] ||
    null;

  const delta =
    deltaEngine(
      m1
    );

  const displacementM1 =
    displacement(
      m1
    );

  const displacementM5 =
    displacement(
      m5
    );

  const dominantSweepQuality =
    dominantZone
      ? evaluateSweepQuality({
          zone:dominantZone,
          m1,
          m5,
          delta,
          displacementM1
        })
      : {
          score:0,
          quality:"NONE",
          checks:{}
        };

  const secondaryPrice =
    Number(
      secondaryQuote?.price
    );

  const feedQuality =
    feedValidation(
      price,
      Number.isFinite(
        secondaryPrice
      )
        ? secondaryPrice
        : null,
      atrM5
    );

  const structures = {

    M1:
      structure(m1),

    M5:
      structure(m5),

    M15:
      structure(m15),

    H1:
      structure(h1),

    H4:
      structure(h4)
  };

  const marketRegimeData =
    marketRegime(
      m5
    );

  const vwap =
    vwapProxy(
      m5,
      150
    );

  const macdM5 =
    macd(m5);

  const macdM15 =
    macd(m15);

  const consensus =
    buildConsensus({

      m5,
      m15,
      h1,
      h4,

      liquidityPath,

      intermarket,

      macro,

      delta,

      dominantSweepQuality,

      feedQuality

    });

  const buyZones =
    liquidityPath
      .filter(
        zone =>
          zone.side ===
          "BUY_SIDE"
      )
      .sort(
        (a,b) =>
          a.distance -
          b.distance
      );

  const sellZones =
    liquidityPath
      .filter(
        zone =>
          zone.side ===
          "SELL_SIDE"
      )
      .sort(
        (a,b) =>
          a.distance -
          b.distance
      );

  const nearestBuyZone =
    buyZones[0] ||
    null;

  const nearestSellZone =
    sellZones[0] ||
    null;

  const result = {

    ok:true,

    engine:
      "MKAYFX GOLD INTELLIGENCE V8.2",

    symbol:
      SYMBOL,

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
        sessionNameNow(),

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
              m1,
              14
            ),
            1
          ),

        M5:
          round(
            rsi(
              m5,
              14
            ),
            1
          ),

        M15:
          round(
            rsi(
              m15,
              14
            ),
            1
          )
      },

      macd:{

        M5:{
          macd:
            round(
              macdM5.macd,
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

        M15:{
          macd:
            round(
              macdM15.macd,
              3
            ),
          signal:
            round(
              macdM15.signal,
              3
            ),
          histogram:
            round(
              macdM15.histogram,
              3
            )
        }
      },

      rocM5:
        round(
          roc(
            m5,
            10
          ),
          3
        ),

      vwap:
        round(
          vwap,
          2
        ),

      vwapPosition:
        price >
        vwap
          ? "ABOVE VWAP"
          : price <
            vwap
            ? "BELOW VWAP"
            : "AT VWAP",

      regime:
        marketRegimeData
    },


    currentSession:
      sessionNameNow(),


    sessions,


    previousDay,


    previousWeek,


    dealingRange:
      dealingRange(
        h1
      ),


    structure:
      structures,


    displacement:{

      M1:
        displacementM1,

      M5:
        displacementM5
    },


    flow:
      delta,


    equalLevels,


    fairValueGaps:
      fvgs,


    /*
       Explicit aliases make frontend extraction deterministic.
    */

    dominantLiquidity:
      dominantZone,


    liquidity:{

      dominantZone,

      zones:
        liquidityPath
    },


    deepLiquidity:{

      rawLevelCount:
        rawLiquidityLevels.length,

      zoneCount:
        zones.length,

      dominantZone,

      nearestBuyZone,

      nearestSellZone,

      zones:
        liquidityPath,

      path:
        liquidityPath
          .slice(0,8)
          .map(
            (zone,index) => ({

              rank:
                index +
                1,

              id:
                zone.id,

              name:
                zone.name,

              side:
                zone.side,

              price:
                zone.price,

              level:
                zone.level,

              range:{
                low:
                  zone.low,
                high:
                  zone.high
              },

              stage:
                zone.lifecycle.stage,

              heat:
                zone.heat,

              raidLikelihood:
                zone.raidLikelihood,

              raidScore:
                zone.raidLikelihood,

              nextTargetScore:
                zone.nextTargetScore,

              distance:
                zone.distance,

              distanceATR:
                zone.distanceATR
            })
          ),

      dominantSweepQuality
    },


    historicalLiquidity:{

      candleCount:
        history.candleCount,

      firstTimestamp:
        history.firstTimestamp,

      lastTimestamp:
        history.lastTimestamp,

      error:
        history.error ??
        null,

      sessions:
        history.statistics
    },


    intermarket,


    macro,


    dataQuality:
      feedQuality,


    consensus,


    health:{

      api1:
        Boolean(KEY_1),

      api2:
        Boolean(KEY_2),

      api3:
        Boolean(KEY_3),

      api4:
        Boolean(KEY_4),

      fred:
        Boolean(FRED_KEY),

      xauM1Bars:
        m1.length,

      xauM5Bars:
        m5.length,

      xauM15Bars:
        m15.length,

      xauH1Bars:
        h1.length,

      xauH4Bars:
        h4.length,

      liquidityZones:
        liquidityPath.length
    },


    apiArchitecture:{

      api1:
        "XAU M1 + M5 execution intelligence",

      api2:
        "XAU M15 + H1 + H4 structure",

      api3:
        "Historical XAU liquidity behaviour",

      api4:
        "XAG + EURUSD + GBPUSD + USDJPY + BTCUSD + XAU validation",

      fred:
        "US yield and macro pressure"
    },


    modelNotes:{

      liquidityLikelihood:
        "Raid/reversal/continuation scores are heuristic model likelihoods, not guaranteed probabilities.",

      orderFlow:
        "Delta/CVD/absorption are candle/activity proxies, not centralized exchange footprint data."
    }
  };

  liveCache = {
    time:Date.now(),
    value:result
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

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );


  if(
    req.method ===
    "OPTIONS"
  ){

    return res
      .status(204)
      .end();
  }


  if(
    req.method !==
    "GET"
  ){

    return res
      .status(405)
      .json({
        ok:false,
        error:"Method not allowed."
      });
  }


  try{

    const force =
      String(
        req.query?.force ||
        ""
      ) === "1";


    const result =
      await buildIntelligence(
        force
      );


    return res
      .status(200)
      .json(result);

  }catch(error){

    console.error(
      "MKAYFX V8.2 ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:false,

        engine:
          "MKAYFX GOLD INTELLIGENCE V8.2",

        error:
          error?.message ||
          "Unknown server error.",

        generatedAt:
          new Date()
            .toISOString()
      });
  }
}