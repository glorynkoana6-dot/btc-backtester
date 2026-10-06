/* ============================================================
   MKAYFX XAU/USD CHART FEED V1
   /api/chart.js

   PURPOSE
   -------
   Dedicated lightweight chart feed for the MKAYFX UI.

   PRIMARY API
   -----------
   TWELVE_DATA_API_KEY_4

   FALLBACK
   --------
   TWELVE_DATA_API_KEY

   SUPPORTED TIMEFRAMES
   --------------------
   M1
   M5
   M15
   H1
============================================================ */


const API_KEY =
  process.env.TWELVE_DATA_API_KEY_4 ||
  process.env.TWELVE_DATA_API_KEY;


const BASE =
  "https://api.twelvedata.com/time_series";


const SYMBOL =
  "XAU/USD";


const TF_MAP = {

  m1: "1min",

  m5: "5min",

  m15: "15min",

  h1: "1h"

};


/* ============================================================
   HELPERS
============================================================ */

function number(
  value
) {

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
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );

}


function parseTime(
  value
) {

  if (!value) {
    return NaN;
  }


  const text =
    String(value)
      .trim()
      .replace(
        " ",
        "T"
      );


  const zoned =
    /Z$|[+-]\d\d:\d\d$/.test(text)
      ? text
      : `${text}Z`;


  return new Date(
    zoned
  ).getTime();

}


async function fetchJSON(
  url,
  timeout = 16000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeout
    );


  try {

    const response =
      await fetch(
        url,
        {

          cache: "no-store",

          headers: {
            Accept: "application/json"
          },

          signal:
            controller.signal

        }
      );


    const raw =
      await response.text();


    let data = {};


    try {

      data =
        raw
          ? JSON.parse(raw)
          : {};

    }
    catch {

      throw new Error(
        `Twelve Data returned invalid JSON (${response.status}).`
      );

    }


    if (
      !response.ok ||
      data.status === "error"
    ) {

      throw new Error(

        data.message ||

        data.code ||

        `Twelve Data HTTP ${response.status}`

      );

    }


    return data;

  }
  finally {

    clearTimeout(
      timer
    );

  }

}


/* ============================================================
   HANDLER
============================================================ */

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
    "s-maxage=20, stale-while-revalidate=40"
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
        error: "GET only."
      });

  }


  try {

    if (!API_KEY) {

      throw new Error(
        "Missing TWELVE_DATA_API_KEY_4 or TWELVE_DATA_API_KEY."
      );

    }


    const tfRaw =
      String(
        req.query?.tf ||
        "m5"
      )
      .toLowerCase();


    const tf =
      TF_MAP[tfRaw]
        ? tfRaw
        : "m5";


    const interval =
      TF_MAP[tf];


    const requestedLimit =
      Number(
        req.query?.limit ||
        240
      );


    const limit =
      clamp(
        Number.isFinite(requestedLimit)
          ? Math.round(requestedLimit)
          : 240,
        60,
        400
      );


    const query =
      new URLSearchParams({

        symbol:
          SYMBOL,

        interval,

        outputsize:
          String(limit),

        timezone:
          "UTC",

        format:
          "JSON",

        order:
          "ASC",

        apikey:
          API_KEY

      });


    const data =
      await fetchJSON(
        `${BASE}?${query.toString()}`
      );


    if (
      !Array.isArray(
        data.values
      )
    ) {

      throw new Error(
        `No ${interval} candle data returned.`
      );

    }


    const candles =
      data.values

        .map(
          item => {

            const candle = {

              time:
                item.datetime,

              timestamp:
                parseTime(
                  item.datetime
                ),

              open:
                number(
                  item.open
                ),

              high:
                number(
                  item.high
                ),

              low:
                number(
                  item.low
                ),

              close:
                number(
                  item.close
                ),

              volume:
                number(
                  item.volume
                ) || 0

            };


            return candle;

          }
        )

        .filter(
          candle =>

            Number.isFinite(
              candle.timestamp
            ) &&

            Number.isFinite(
              candle.open
            ) &&

            Number.isFinite(
              candle.high
            ) &&

            Number.isFinite(
              candle.low
            ) &&

            Number.isFinite(
              candle.close
            )

        )

        .sort(
          (
            a,
            b
          ) =>
            a.timestamp -
            b.timestamp
        );


    if (
      candles.length < 2
    ) {

      throw new Error(
        "Insufficient chart candles returned."
      );

    }


    const latest =
      candles[
        candles.length - 1
      ];


    return res
      .status(200)
      .json({

        ok: true,

        engine:
          "MKAYFX CHART FEED V1",

        symbol:
          SYMBOL,

        timeframe:
          tf,

        interval,

        generatedAt:
          new Date()
            .toISOString(),

        candleCount:
          candles.length,

        latestPrice:
          latest.close,

        candles

      });

  }
  catch (
    error
  ) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          error instanceof Error
            ? error.message
            : String(error)

      });

  }

}