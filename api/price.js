/* ================================================================
   MKAYFX FAST XAU PRICE V2
   /api/price.js

   API
   TWELVE_DATA_API_KEY_4

   FALLBACK
   TWELVE_DATA_API_KEY
================================================================ */


const TD_BASE =
  "https://api.twelvedata.com";


const API_KEY =
  process.env.TWELVE_DATA_API_KEY_4 ||
  process.env.TWELVE_DATA_API_KEY ||
  "";


const SYMBOL =
  "XAU/USD";


const CACHE_MS =
  3500;


let cache = {
  time:0,
  value:null
};


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


async function getPrice(){

  if(
    !API_KEY
  ){

    throw new Error(
      "TWELVE_DATA_API_KEY_4 is missing."
    );
  }

  const url =
    `${TD_BASE}/quote` +
    `?symbol=${encodeURIComponent(SYMBOL)}` +
    `&apikey=${encodeURIComponent(API_KEY)}`;

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
      "Twelve Data quote error."
    );
  }

  const price =
    finite(
      json.close ??
      json.price
    );

  if(
    price === null ||
    price <= 0
  ){

    throw new Error(
      "Invalid XAU/USD quote."
    );
  }

  return {
    ok:true,

    engine:
      "MKAYFX FAST PRICE V2",

    symbol:
      SYMBOL,

    price,

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
      ),

    timestamp:
      Date.now(),

    generatedAt:
      new Date()
        .toISOString(),

    source:
      "TWELVE_DATA_REST"
  };
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

    if(
      cache.value &&
      Date.now() -
      cache.time <
      CACHE_MS
    ){

      return res
        .status(
          200
        )
        .json({
          ...cache.value,
          cached:true
        });
    }

    const result =
      await getPrice();

    cache = {
      time:
        Date.now(),
      value:
        result
    };

    return res
      .status(
        200
      )
      .json({
        ...result,
        cached:false
      });

  }catch(error){

    return res
      .status(
        500
      )
      .json({
        ok:false,
        engine:
          "MKAYFX FAST PRICE V2",
        error:
          error
            ?.message ||
          "Price error."
      });
  }
}