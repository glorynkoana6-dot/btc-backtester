/* ================================================================
   MKAYFX XAU CHART V4
   /api/chart.js

   M1 / M5
   TWELVE_DATA_API_KEY

   M15 / H1
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


function parseTime(
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


function timeframeConfig(
  tf
) {

  switch (
    String(
      tf ||
      "m5"
    ).toLowerCase()
  ) {

    case "m1":

      return {

        name:
          "m1",

        interval:
          "1min",

        key:
          KEY_1

      };


    case "m5":

      return {

        name:
          "m5",

        interval:
          "5min",

        key:
          KEY_1

      };


    case "m15":

      return {

        name:
          "m15",

        interval:
          "15min",

        key:
          KEY_2

      };


    case "h1":

      return {

        name:
          "h1",

        interval:
          "1h",

        key:
          KEY_2

      };


    default:

      throw new Error(
        "Unsupported timeframe."
      );

  }

}


async function fetchCandles(
  config,
  limit
) {

  if (
    !config.key
  ) {

    throw new Error(
      "Missing Twelve Data API key."
    );

  }


  const url =

    `${TD_BASE}/time_series` +

    `?symbol=${encodeURIComponent(
      SYMBOL
    )}` +

    `&interval=${config.interval}` +

    `&outputsize=${limit}` +

    `&order=asc` +

    `&timezone=UTC` +

    `&apikey=${encodeURIComponent(
      config.key
    )}`;


  const response =
    await fetch(
      url
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Twelve Data HTTP ${response.status}`
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


  if (
    !Array.isArray(
      json.values
    )
  ) {

    throw new Error(
      "No candles returned."
    );

  }


  return json.values

    .map(
      row => {

        const time =
          parseTime(
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

          timestamp:
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

    const config =
      timeframeConfig(
        req.query?.tf
      );


    const limit =
      Math.max(
        50,
        Math.min(
          500,
          Number(
            req.query?.limit
          ) ||
          260
        )
      );


    const cacheKey =
      `${config.name}-${limit}`;


    const cached =
      CACHE.get(
        cacheKey
      );


    if (
      cached &&
      Date.now() -
      cached.time <
      CACHE_MS
    ) {

      return res
        .status(200)
        .json({

          ...cached.value,

          cached:
            true

        });

    }


    const candles =
      await fetchCandles(
        config,
        limit
      );


    const result = {

      ok:
        true,

      engine:
        "MKAYFX CHART V4",

      symbol:
        SYMBOL,

      timeframe:
        config.name,

      interval:
        config.interval,

      generatedAt:
        new Date()
          .toISOString(),

      count:
        candles.length,

      candles,

      cached:
        false

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
      .status(200)
      .json(
        result
      );

  } catch (
    error
  ) {

    console.error(
      "CHART ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        engine:
          "MKAYFX CHART V4",

        error:
          error?.message ||
          "Chart error."

      });

  }

}