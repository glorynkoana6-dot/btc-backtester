/* ================================================================
   MKAYFX CHART ENGINE V5
   /api/chart.js

   M1 + M5
   TWELVE_DATA_API_KEY

   M15 + H1
   TWELVE_DATA_API_KEY_2
================================================================ */


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


const CACHE =
  new Map();


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


function parseTime(
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


function config(
  timeframe
){

  switch(
    String(
      timeframe ??
      "m5"
    )
    .toLowerCase()
  ){

    case "m1":
      return {
        tf:"m1",
        interval:"1min",
        key:KEY_1
      };

    case "m5":
      return {
        tf:"m5",
        interval:"5min",
        key:KEY_1
      };

    case "m15":
      return {
        tf:"m15",
        interval:"15min",
        key:KEY_2
      };

    case "h1":
      return {
        tf:"h1",
        interval:"1h",
        key:KEY_2
      };

    default:
      throw new Error(
        "Unsupported timeframe."
      );
  }
}


async function candles(
  configuration,
  limit
){

  if(
    !configuration.key
  ){

    throw new Error(
      "Missing Twelve Data API key."
    );
  }

  const url =
    `${TD_BASE}/time_series` +
    `?symbol=${encodeURIComponent(SYMBOL)}` +
    `&interval=${encodeURIComponent(configuration.interval)}` +
    `&outputsize=${limit}` +
    `&order=asc` +
    `&timezone=UTC` +
    `&apikey=${encodeURIComponent(configuration.key)}`;

  const response =
    await fetch(
      url
    );

  if(
    !response.ok
  ){

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
      "Twelve Data chart error."
    );
  }

  if(
    !Array.isArray(
      json.values
    )
  ){

    throw new Error(
      "No chart candles returned."
    );
  }

  return json.values
    .map(
      item => {

        const time =
          parseTime(
            item.datetime
          );

        const open =
          finite(
            item.open
          );

        const high =
          finite(
            item.high
          );

        const low =
          finite(
            item.low
          );

        const close =
          finite(
            item.close
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

        return {
          time,
          timestamp:
            time,
          open,
          high,
          low,
          close,
          volume:
            finite(
              item.volume
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

    const configuration =
      config(
        req.query
          ?.tf
      );

    const limit =
      Math.max(
        50,
        Math.min(
          500,
          Number(
            req.query
              ?.limit
          ) ||
          300
        )
      );

    const cacheKey =
      `${configuration.tf}-${limit}`;

    const cached =
      CACHE.get(
        cacheKey
      );

    if(
      cached &&
      Date.now() -
      cached.time <
      CACHE_MS
    ){

      return res
        .status(
          200
        )
        .json({
          ...cached.value,
          cached:true
        });
    }

    const data =
      await candles(
        configuration,
        limit
      );

    const result = {
      ok:true,

      engine:
        "MKAYFX CHART V5",

      symbol:
        SYMBOL,

      timeframe:
        configuration.tf,

      interval:
        configuration.interval,

      generatedAt:
        new Date()
          .toISOString(),

      count:
        data.length,

      candles:
        data,

      cached:false
    };

    CACHE.set(
      cacheKey,
      {
        time:
          Date.now(),
        value:
          result
      }
    );

    return res
      .status(
        200
      )
      .json(
        result
      );

  }catch(error){

    return res
      .status(
        500
      )
      .json({
        ok:false,

        engine:
          "MKAYFX CHART V5",

        error:
          error
            ?.message ||
          "Chart error."
      });
  }
}