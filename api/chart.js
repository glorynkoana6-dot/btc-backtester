/* ============================================================
   MKAYFX XAU/USD CHART FEED V2
   /api/chart.js

   PURPOSE
   ------------------------------------------------------------
   Dedicated chart endpoint.

   M1  -> TWELVE_DATA_API_KEY
   M5  -> TWELVE_DATA_API_KEY
   M15 -> TWELVE_DATA_API_KEY_2
   H1  -> TWELVE_DATA_API_KEY_2

   This endpoint returns ONLY validated OHLC candles.
============================================================ */


const TD_BASE =
  "https://api.twelvedata.com";


const KEY_1 =
  process.env.TWELVE_DATA_API_KEY ||
  "";


const KEY_2 =
  process.env.TWELVE_DATA_API_KEY_2 ||
  KEY_1;


const SYMBOL =
  "XAU/USD";


const CACHE_MS =
  15000;


const cache =
  new Map();


/* ============================================================
   HELPERS
============================================================ */

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

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function clamp(
  value,
  min,
  max
){

  return Math.max(
    min,
    Math.min(
      max,
      Number(value) || 0
    )
  );
}


/* ============================================================
   TIMEFRAME CONFIG
============================================================ */

function timeframeConfig(tf){

  const value =
    String(
      tf || "m5"
    )
    .toLowerCase();

  if(value === "m1"){

    return {
      tf:"m1",
      interval:"1min",
      apiKey:KEY_1
    };
  }

  if(value === "m5"){

    return {
      tf:"m5",
      interval:"5min",
      apiKey:KEY_1
    };
  }

  if(value === "m15"){

    return {
      tf:"m15",
      interval:"15min",
      apiKey:KEY_2
    };
  }

  if(value === "h1"){

    return {
      tf:"h1",
      interval:"1h",
      apiKey:KEY_2
    };
  }

  throw new Error(
    `Unsupported timeframe: ${value}`
  );
}


/* ============================================================
   PARSE DATETIME
============================================================ */

function parseTimestamp(
  value
){

  if(
    value === null ||
    value === undefined
  ){
    return null;
  }

  if(
    typeof value === "number"
  ){

    return value < 100000000000
      ? value * 1000
      : value;
  }

  let text =
    String(value);

  if(
    !text.includes("T") &&
    text.includes(" ")
  ){

    text =
      text.replace(
        " ",
        "T"
      );
  }

  if(
    !/[zZ]|[+-]\d\d:\d\d$/.test(text)
  ){

    text += "Z";
  }

  const timestamp =
    Date.parse(text);

  return Number.isFinite(timestamp)
    ? timestamp
    : null;
}


/* ============================================================
   PARSE CANDLES
============================================================ */

function parseCandles(
  json
){

  if(
    !json ||
    !Array.isArray(
      json.values
    )
  ){

    throw new Error(
      json?.message ||
      "Twelve Data returned no chart candle values."
    );
  }

  const parsed =
    json.values
      .map(
        row => {

          const time =
            parseTimestamp(
              row.datetime
            );

          const open =
            finite(row.open);

          const high =
            finite(row.high);

          const low =
            finite(row.low);

          const close =
            finite(row.close);

          const volume =
            finite(row.volume) ??
            0;

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

          if(
            high <
            Math.max(
              open,
              close,
              low
            )
          ){
            return null;
          }

          if(
            low >
            Math.min(
              open,
              close,
              high
            )
          ){
            return null;
          }

          return {
            timestamp:time,
            time,
            open,
            high,
            low,
            close,
            volume
          };
        }
      )
      .filter(Boolean)
      .sort(
        (a,b) =>
          a.time -
          b.time
      );

  /*
    Remove duplicate timestamps.
  */

  const unique =
    [];

  const seen =
    new Set();

  for(const candle of parsed){

    if(
      seen.has(
        candle.time
      )
    ){
      continue;
    }

    seen.add(
      candle.time
    );

    unique.push(
      candle
    );
  }

  return unique;
}


/* ============================================================
   FETCH SERIES
============================================================ */

async function fetchSeries({
  interval,
  apiKey,
  outputsize
}){

  if(!apiKey){

    throw new Error(
      "Missing Twelve Data API key."
    );
  }

  const url =

    `${TD_BASE}/time_series` +

    `?symbol=${encodeURIComponent(SYMBOL)}` +

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
            "MKAYFX-CHART-V2"
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
    json.status === "error"
  ){

    throw new Error(
      json.message ||
      "Twelve Data chart error."
    );
  }


  return parseCandles(
    json
  );
}


/* ============================================================
   HANDLER
============================================================ */

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

    const config =
      timeframeConfig(
        req.query?.tf
      );


    const requestedLimit =
      clamp(
        req.query?.limit,
        50,
        500
      ) || 260;


    const outputsize =
      Math.max(
        requestedLimit,
        260
      );


    const force =
      String(
        req.query?.force ||
        ""
      ) === "1";


    const cacheKey =
      `${config.tf}:${outputsize}`;


    const cached =
      cache.get(
        cacheKey
      );


    if(
      !force &&
      cached &&
      Date.now() -
      cached.time <
      CACHE_MS
    ){

      return res
        .status(200)
        .json({
          ...cached.value,
          cached:true
        });
    }


    const candles =
      await fetchSeries({
        interval:
          config.interval,
        apiKey:
          config.apiKey,
        outputsize
      });


    if(
      candles.length < 3
    ){

      throw new Error(
        `Only ${candles.length} valid candles were returned.`
      );
    }


    const trimmed =
      candles.slice(
        -requestedLimit
      );


    const result = {

      ok:true,

      engine:
        "MKAYFX CHART FEED V2",

      symbol:
        SYMBOL,

      timeframe:
        config.tf,

      interval:
        config.interval,

      generatedAt:
        new Date()
          .toISOString(),

      count:
        trimmed.length,

      firstTimestamp:
        trimmed[0]?.time ??
        null,

      lastTimestamp:
        trimmed.at(-1)?.time ??
        null,

      candles:
        trimmed,

      cached:false
    };


    cache.set(
      cacheKey,
      {
        time:Date.now(),
        value:result
      }
    );


    return res
      .status(200)
      .json(result);

  }catch(error){

    console.error(
      "MKAYFX CHART ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:false,

        engine:
          "MKAYFX CHART FEED V2",

        error:
          error?.message ||
          "Unknown chart error.",

        generatedAt:
          new Date()
            .toISOString()

      });
  }
}