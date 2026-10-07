/* ================================================================
   MKAYFX GOLD INTELLIGENCE V9
   LIQUIDITY WARFARE ENGINE

   FILE
   ---------------------------------------------------------------
   /api/xau.js

   DATA ARCHITECTURE
   ---------------------------------------------------------------
   API KEY 1
   TWELVE_DATA_API_KEY
   -> M1 / latest price

   API KEY 2
   TWELVE_DATA_API_KEY_2
   -> M15 / H1 / H4 structure

   API KEY 3
   TWELVE_DATA_API_KEY_3
   -> Deep M5 / historical memory

   API KEY 4
   TWELVE_DATA_API_KEY_4
   -> Optional fallback

   MACRO
   ---------------------------------------------------------------
   FRED_API_KEY
   -> real yields
   -> nominal yields
   -> Fed Funds
   -> CPI

   IMPORTANT
   ---------------------------------------------------------------
   Scores are heuristic model scores.

   Historical percentages are calculated from matched historical
   samples and are not guarantees or true future probabilities.
================================================================ */


/* ================================================================
   CONFIG
================================================================ */

const SYMBOL =
  "XAU/USD";


const TD_BASE =
  "https://api.twelvedata.com";


const FRED_BASE =
  "https://api.stlouisfed.org/fred/series/observations";


const CONFIG = {

  outputs: {

    m1: 360,

    m5: 3000,

    m15: 800,

    h1: 600,

    h4: 400

  },


  sessionsUTC: {

    asia: [
      0,
      7
    ],

    london: [
      7,
      12
    ],

    newYork: [
      12,
      17
    ]

  },


  pivots: {

    h1: 3,

    equal: 3

  },


  levels: {

    mergeAtr: 0.28,

    equalAtr: 0.18,

    touchAtr: 0.14,

    sweepMinAtr: 0.04,

    sweepMaxAtr: 1.8

  },


  historical: {

    forwardBars: 12,

    topK: 80,

    minSimilarity: 58,

    targetAtr: 1.5,

    stopAtr: 1.0

  }

};


/* ================================================================
   BASIC HELPERS
================================================================ */

const clamp = (
  value,
  min,
  max
) =>
  Math.max(
    min,
    Math.min(
      max,
      value
    )
  );


const round = (
  value,
  decimals = 2
) => {

  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {

    return null;

  }

  const multiplier =
    10 ** decimals;

  return (
    Math.round(
      number *
      multiplier
    ) /
    multiplier
  );

};


const mean =
  array => {

    if (
      !array.length
    ) {

      return 0;

    }

    return (
      array.reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ) /
      array.length
    );

  };


const median =
  array => {

    if (
      !array.length
    ) {

      return 0;

    }

    const sorted =
      [
        ...array
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

    if (
      sorted.length %
      2
    ) {

      return sorted[
        middle
      ];

    }

    return (
      sorted[
        middle -
        1
      ] +
      sorted[
        middle
      ]
    ) /
    2;

  };


const sum =
  array =>
    array.reduce(
      (
        total,
        value
      ) =>
        total +
        value,
      0
    );


const safeDiv = (
  a,
  b,
  fallback = 0
) => {

  if (
    Number.isFinite(
      a
    ) &&
    Number.isFinite(
      b
    ) &&
    b !== 0
  ) {

    return (
      a /
      b
    );

  }

  return fallback;

};


/* ================================================================
   JSON RESPONSE
================================================================ */

function json(
  data,
  status = 200,
  cache =
    "no-store"
) {

  return new Response(
    JSON.stringify(
      data
    ),
    {

      status,

      headers: {

        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          cache,

        "access-control-allow-origin":
          "*"

      }

    }
  );

}


/* ================================================================
   API KEY MANAGEMENT
================================================================ */

function apiKeys() {

  return [

    process.env
      .TWELVE_DATA_API_KEY,

    process.env
      .TWELVE_DATA_API_KEY_2,

    process.env
      .TWELVE_DATA_API_KEY_3,

    process.env
      .TWELVE_DATA_API_KEY_4

  ].filter(
    (
      value,
      index,
      array
    ) =>
      value &&
      array.indexOf(
        value
      ) ===
      index
  );

}


/* ================================================================
   FETCH JSON
================================================================ */

async function fetchJson(
  url,
  timeoutMs = 14000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );


  try {

    const response =
      await fetch(
        url,
        {

          signal:
            controller.signal,

          headers: {

            "user-agent":
              "MKAYFX-Gold-Intelligence-V9/9.0"

          }

        }
      );


    const text =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(
          text
        );

    }

    catch {

      throw new Error(
        `Non-JSON response (${response.status})`
      );

    }


    if (
      !response.ok
    ) {

      throw new Error(
        data?.message ||
        `HTTP ${response.status}`
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


/* ================================================================
   TWELVE DATA REQUEST WITH KEY FALLBACK
================================================================ */

async function tdRequest(
  endpoint,
  params,
  preferredKey = 0
) {

  const keys =
    apiKeys();


  if (
    !keys.length
  ) {

    throw new Error(
      "Missing TWELVE_DATA_API_KEY environment variable."
    );

  }


  const order =
    keys.map(
      (
        _,
        index
      ) =>
        (
          preferredKey +
          index
        ) %
        keys.length
    );


  let lastError =
    null;


  for (
    const index
    of order
  ) {

    try {

      const url =
        new URL(
          `${TD_BASE}/${endpoint}`
        );


      for (
        const [
          key,
          value
        ]
        of Object.entries(
          params
        )
      ) {

        if (
          value !==
            undefined &&
          value !==
            null
        ) {

          url.searchParams.set(
            key,
            String(
              value
            )
          );

        }

      }


      url.searchParams.set(
        "apikey",
        keys[
          index
        ]
      );


      const data =
        await fetchJson(
          url.toString()
        );


      if (
        data?.status ===
          "error" ||
        data?.code ||
        data?.message
          ?.toLowerCase?.()
          .includes(
            "credits"
          )
      ) {

        throw new Error(
          data?.message ||
          "Twelve Data returned an error."
        );

      }


      return {

        data,

        keySlot:
          index +
          1

      };

    }

    catch (
      error
    ) {

      lastError =
        error;

    }

  }


  throw (
    lastError ||
    new Error(
      "All Twelve Data keys failed."
    )
  );

}


/* ================================================================
   TIME PARSER
================================================================ */

function parseTdTime(
  value
) {

  if (
    !value
  ) {

    return 0;

  }


  if (
    /^\d{4}-\d{2}-\d{2}$/
      .test(
        value
      )
  ) {

    return Math.floor(
      Date.parse(
        `${value}T00:00:00Z`
      ) /
      1000
    );

  }


  const normalized =
    value.includes(
      "T"
    )
      ?
      value
      :
      value.replace(
        " ",
        "T"
      );


  return Math.floor(
    Date.parse(
      normalized.endsWith(
        "Z"
      )
        ?
        normalized
        :
        `${normalized}Z`
    ) /
    1000
  );

}


/* ================================================================
   CANDLE NORMALIZER
================================================================ */

function normalizeCandles(
  values = []
) {

  return values

    .map(
      value => ({

        time:
          parseTdTime(
            value.datetime
          ),

        open:
          Number(
            value.open
          ),

        high:
          Number(
            value.high
          ),

        low:
          Number(
            value.low
          ),

        close:
          Number(
            value.close
          ),

        volume:
          Number(
            value.volume ||
            0
          )

      })
    )

    .filter(
      candle =>
        candle.time &&
        [
          candle.open,
          candle.high,
          candle.low,
          candle.close
        ].every(
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


/* ================================================================
   FETCH TIME SERIES
================================================================ */

async function fetchSeries(
  interval,
  outputsize,
  preferredKey
) {

  const started =
    Date.now();


  const {
    data,
    keySlot
  } =
    await tdRequest(
      "time_series",
      {

        symbol:
          SYMBOL,

        interval,

        outputsize,

        timezone:
          "UTC",

        order:
          "desc",

        format:
          "JSON"

      },
      preferredKey
    );


  const candles =
    normalizeCandles(
      data?.values ||
      []
    );


  if (
    candles.length <
    20
  ) {

    throw new Error(
      `${interval}: insufficient candles (${candles.length})`
    );

  }


  return {

    candles,

    keySlot,

    ms:
      Date.now() -
      started

  };

}


/* ================================================================
   LATEST PRICE
================================================================ */

async function fetchLatestPrice() {

  const started =
    Date.now();


  const {
    data,
    keySlot
  } =
    await tdRequest(
      "price",
      {

        symbol:
          SYMBOL,

        dp:
          5

      },
      0
    );


  const price =
    Number(
      data?.price
    );


  if (
    !Number.isFinite(
      price
    )
  ) {

    throw new Error(
      "Invalid latest price response."
    );

  }


  return {

    price,

    keySlot,

    ms:
      Date.now() -
      started

  };

}


/* ================================================================
   TRUE RANGE
================================================================ */

function trueRange(
  candle,
  previous
) {

  if (
    !previous
  ) {

    return (
      candle.high -
      candle.low
    );

  }


  return Math.max(

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

  );

}


/* ================================================================
   ATR
================================================================ */

function atrArray(
  candles,
  period = 14
) {

  const tr =
    candles.map(
      (
        candle,
        index
      ) =>
        trueRange(
          candle,
          candles[
            index -
            1
          ]
        )
    );


  const result =
    Array(
      candles.length
    ).fill(
      null
    );


  if (
    candles.length <
    period
  ) {

    return result;

  }


  let current =
    mean(
      tr.slice(
        0,
        period
      )
    );


  result[
    period -
    1
  ] =
    current;


  for (
    let index =
      period;
    index <
      tr.length;
    index++
  ) {

    current =
      (
        current *
          (
            period -
            1
          ) +
        tr[
          index
        ]
      ) /
      period;


    result[
      index
    ] =
      current;

  }


  return result;

}


/* ================================================================
   EMA
================================================================ */

function emaArray(
  candles,
  period,
  field =
    "close"
) {

  const result =
    Array(
      candles.length
    ).fill(
      null
    );


  if (
    !candles.length
  ) {

    return result;

  }


  const multiplier =
    2 /
    (
      period +
      1
    );


  let current =
    candles[
      0
    ][
      field
    ];


  result[
    0
  ] =
    current;


  for (
    let index =
      1;
    index <
      candles.length;
    index++
  ) {

    current =
      candles[
        index
      ][
        field
      ] *
        multiplier +
      current *
        (
          1 -
          multiplier
        );


    result[
      index
    ] =
      current;

  }


  return result;

}


/* ================================================================
   RSI
================================================================ */

function rsiArray(
  candles,
  period = 14
) {

  const result =
    Array(
      candles.length
    ).fill(
      null
    );


  if (
    candles.length <=
    period
  ) {

    return result;

  }


  let gain =
    0;


  let loss =
    0;


  for (
    let index =
      1;
    index <=
      period;
    index++
  ) {

    const difference =
      candles[
        index
      ].close -
      candles[
        index -
        1
      ].close;


    gain +=
      Math.max(
        difference,
        0
      );


    loss +=
      Math.max(
        -difference,
        0
      );

  }


  let averageGain =
    gain /
    period;


  let averageLoss =
    loss /
    period;


  result[
    period
  ] =
    averageLoss ===
    0
      ?
      100
      :
      100 -
      100 /
      (
        1 +
        averageGain /
        averageLoss
      );


  for (
    let index =
      period +
      1;
    index <
      candles.length;
    index++
  ) {

    const difference =
      candles[
        index
      ].close -
      candles[
        index -
        1
      ].close;


    averageGain =
      (
        averageGain *
          (
            period -
            1
          ) +
        Math.max(
          difference,
          0
        )
      ) /
      period;


    averageLoss =
      (
        averageLoss *
          (
            period -
            1
          ) +
        Math.max(
          -difference,
          0
        )
      ) /
      period;


    result[
      index
    ] =
      averageLoss ===
      0
        ?
        100
        :
        100 -
        100 /
        (
          1 +
          averageGain /
          averageLoss
        );

  }


  return result;

}


/* ================================================================
   ROLLING MEAN
================================================================ */

function rollingMean(
  array,
  end,
  count
) {

  const start =
    Math.max(
      0,
      end -
        count +
        1
    );


  const values =
    array
      .slice(
        start,
        end +
          1
      )
      .filter(
        Number.isFinite
      );


  return mean(
    values
  );

}


/* ================================================================
   DATE HELPERS
================================================================ */

function utcDateKey(
  timestamp
) {

  return new Date(
    timestamp *
    1000
  )
    .toISOString()
    .slice(
      0,
      10
    );

}


function isoWeekKey(
  timestamp
) {

  const date =
    new Date(
      timestamp *
      1000
    );


  const copy =
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      )
    );


  const day =
    copy.getUTCDay() ||
    7;


  copy.setUTCDate(
    copy.getUTCDate() +
    4 -
    day
  );


  const yearStart =
    new Date(
      Date.UTC(
        copy.getUTCFullYear(),
        0,
        1
      )
    );


  const week =
    Math.ceil(
      (
        (
          copy -
          yearStart
        ) /
        86400000 +
        1
      ) /
      7
    );


  return (
    `${copy.getUTCFullYear()}-W${String(
      week
    ).padStart(
      2,
      "0"
    )}`
  );

}


/* ================================================================
   HIGH LOW GROUPING
================================================================ */

function groupHighLow(
  candles,
  keyFunction
) {

  const map =
    new Map();


  for (
    const candle
    of candles
  ) {

    const key =
      keyFunction(
        candle.time
      );


    const existing =
      map.get(
        key
      ) ||
      {

        key,

        high:
          -Infinity,

        low:
          Infinity,

        open:
          candle.open,

        close:
          candle.close,

        count:
          0

      };


    existing.high =
      Math.max(
        existing.high,
        candle.high
      );


    existing.low =
      Math.min(
        existing.low,
        candle.low
      );


    existing.close =
      candle.close;


    existing.count++;


    map.set(
      key,
      existing
    );

  }


  return [
    ...map.values()
  ];

}


/* ================================================================
   PREVIOUS COMPLETED GROUP
================================================================ */

function previousCompletedGroup(
  groups
) {

  if (
    groups.length <
    2
  ) {

    return null;

  }


  return groups[
    groups.length -
    2
  ];

}


/* ================================================================
   SESSION RANGE
================================================================ */

function sessionRange(
  candles,
  startHour,
  endHour,
  label
) {

  const byDate =
    new Map();


  for (
    const candle
    of candles
  ) {

    const date =
      new Date(
        candle.time *
        1000
      );


    const hour =
      date.getUTCHours();


    const inside =
      startHour <
      endHour
        ?
        (
          hour >=
            startHour &&
          hour <
            endHour
        )
        :
        (
          hour >=
            startHour ||
          hour <
            endHour
        );


    if (
      !inside
    ) {

      continue;

    }


    const key =
      utcDateKey(
        candle.time
      );


    const current =
      byDate.get(
        key
      ) ||
      {

        date:
          key,

        high:
          -Infinity,

        low:
          Infinity,

        open:
          candle.open,

        close:
          candle.close,

        count:
          0,

        start:
          candle.time,

        end:
          candle.time

      };


    current.high =
      Math.max(
        current.high,
        candle.high
      );


    current.low =
      Math.min(
        current.low,
        candle.low
      );


    current.close =
      candle.close;


    current.end =
      candle.time;


    current.count++;


    byDate.set(
      key,
      current
    );

  }


  const ranges =
    [
      ...byDate.values()
    ].filter(
      item =>
        item.count >=
        2
    );


  const latest =
    ranges[
      ranges.length -
      1
    ];


  return latest
    ?
    {

      ...latest,

      label

    }
    :
    null;

}


/* ================================================================
   PIVOT DETECTOR
================================================================ */

function pivots(
  candles,
  length = 3
) {

  const highs =
    [];


  const lows =
    [];


  for (
    let index =
      length;
    index <
      candles.length -
        length;
    index++
  ) {

    let pivotHigh =
      true;


    let pivotLow =
      true;


    for (
      let compare =
        index -
        length;
      compare <=
        index +
          length;
      compare++
    ) {

      if (
        compare ===
        index
      ) {

        continue;

      }


      if (
        candles[
          compare
        ].high >=
        candles[
          index
        ].high
      ) {

        pivotHigh =
          false;

      }


      if (
        candles[
          compare
        ].low <=
        candles[
          index
        ].low
      ) {

        pivotLow =
          false;

      }


      if (
        !pivotHigh &&
        !pivotLow
      ) {

        break;

      }

    }


    if (
      pivotHigh
    ) {

      highs.push(
        {

          index,

          time:
            candles[
              index
            ].time,

          price:
            candles[
              index
            ].high

        }
      );

    }


    if (
      pivotLow
    ) {

      lows.push(
        {

          index,

          time:
            candles[
              index
            ].time,

          price:
            candles[
              index
            ].low

        }
      );

    }

  }


  return {

    highs,

    lows

  };

}


/* ================================================================
   EQUAL HIGHS / LOWS
================================================================ */

function findEqualLevels(
  candles,
  tolerance,
  pivotLength = 3,
  lookback = 260
) {

  const start =
    Math.max(
      0,
      candles.length -
      lookback
    );


  const slice =
    candles.slice(
      start
    );


  const detected =
    pivots(
      slice,
      pivotLength
    );


  const output =
    [];


  for (
    const [
      kind,
      levels
    ]
    of [
      [
        "EQH",
        detected.highs
      ],
      [
        "EQL",
        detected.lows
      ]
    ]
  ) {

    for (
      let index =
        0;
      index <
        levels.length;
      index++
    ) {

      const matches =
        [
          levels[
            index
          ]
        ];


      for (
        let compare =
          index +
          1;
        compare <
          levels.length;
        compare++
      ) {

        if (
          Math.abs(
            levels[
              compare
            ].price -
            levels[
              index
            ].price
          ) <=
          tolerance
        ) {

          matches.push(
            levels[
              compare
            ]
          );

        }

      }


      if (
        matches.length >=
        2
      ) {

        output.push(
          {

            name:
              `${kind} ×${matches.length}`,

            kind,

            side:
              kind ===
              "EQH"
                ?
                "BSL"
                :
                "SSL",

            price:
              mean(
                matches.map(
                  item =>
                    item.price
                )
              ),

            touches:
              matches.length,

            time:
              matches[
                matches.length -
                1
              ].time,

            weight:
              88 +
              Math.min(
                8,
                (
                  matches.length -
                  2
                ) *
                3
              ),

            timeframe:
              "M15",

            source:
              "equal-liquidity"

          }
        );

      }

    }

  }


  const deduplicated =
    [];


  for (
    const item
    of output.sort(
      (
        a,
        b
      ) =>
        b.time -
        a.time
    )
  ) {

    const exists =
      deduplicated.some(
        existing =>
          existing.side ===
            item.side &&
          Math.abs(
            existing.price -
            item.price
          ) <=
          tolerance
      );


    if (
      !exists
    ) {

      deduplicated.push(
        item
      );

    }

  }


  return deduplicated.slice(
    0,
    6
  );

}


/* ================================================================
   M15 FAIR VALUE GAPS
================================================================ */

function findFvgs(
  candles,
  atrNow,
  lookback = 160
) {

  const output =
    [];


  const start =
    Math.max(
      2,
      candles.length -
      lookback
    );


  for (
    let index =
      start;
    index <
      candles.length;
    index++
  ) {

    const first =
      candles[
        index -
        2
      ];


    const third =
      candles[
        index
      ];


    if (
      third.low >
      first.high
    ) {

      const low =
        first.high;


      const high =
        third.low;


      if (
        high -
          low >=
        atrNow *
          0.08
      ) {

        const filled =
          candles
            .slice(
              index +
              1
            )
            .some(
              candle =>
                candle.low <=
                low
            );


        if (
          !filled
        ) {

          output.push(
            {

              type:
                "BULLISH_FVG",

              low,

              high,

              mid:
                (
                  low +
                  high
                ) /
                2,

              time:
                third.time,

              timeframe:
                "M15"

            }
          );

        }

      }

    }


    if (
      third.high <
      first.low
    ) {

      const low =
        third.high;


      const high =
        first.low;


      if (
        high -
          low >=
        atrNow *
          0.08
      ) {

        const filled =
          candles
            .slice(
              index +
              1
            )
            .some(
              candle =>
                candle.high >=
                high
            );


        if (
          !filled
        ) {

          output.push(
            {

              type:
                "BEARISH_FVG",

              low,

              high,

              mid:
                (
                  low +
                  high
                ) /
                2,

              time:
                third.time,

              timeframe:
                "M15"

            }
          );

        }

      }

    }

  }


  return output
    .slice(
      -8
    )
    .reverse();

}


/* ================================================================
   LEVEL TOUCH COUNTER
================================================================ */

function countTouches(
  candles,
  price,
  tolerance,
  lookback = 240
) {

  let touches =
    0;


  const start =
    Math.max(
      0,
      candles.length -
      lookback
    );


  let lastTouch =
    -10;


  for (
    let index =
      start;
    index <
      candles.length;
    index++
  ) {

    if (
      candles[
        index
      ].low -
        tolerance <=
        price &&
      candles[
        index
      ].high +
        tolerance >=
        price
    ) {

      if (
        index -
          lastTouch >
        2
      ) {

        touches++;

      }


      lastTouch =
        index;

    }

  }


  return touches;

}


/* ================================================================
   LIQUIDITY LEVEL ENGINE
================================================================ */

function buildLiquidityLevels(
  m5,
  m15,
  h1,
  atr5,
  atr15
) {

  const levels =
    [];


  const daily =
    groupHighLow(
      m15,
      timestamp =>
        utcDateKey(
          timestamp
        )
    );


  const weekly =
    groupHighLow(
      h1,
      timestamp =>
        isoWeekKey(
          timestamp
        )
    );


  const previousDay =
    previousCompletedGroup(
      daily
    );


  const previousWeek =
    previousCompletedGroup(
      weekly
    );


  function push(
    name,
    side,
    price,
    weight,
    timeframe,
    source,
    touches = 1,
    time = null
  ) {

    if (
      !Number.isFinite(
        price
      )
    ) {

      return;

    }


    levels.push(
      {

        name,

        side,

        price,

        weight,

        timeframe,

        source,

        touches,

        time

      }
    );

  }


  if (
    previousDay
  ) {

    push(
      "Previous Day High",
      "BSL",
      previousDay.high,
      96,
      "D1",
      "PDH"
    );


    push(
      "Previous Day Low",
      "SSL",
      previousDay.low,
      96,
      "D1",
      "PDL"
    );

  }


  if (
    previousWeek
  ) {

    push(
      "Previous Week High",
      "BSL",
      previousWeek.high,
      100,
      "W1",
      "PWH"
    );


    push(
      "Previous Week Low",
      "SSL",
      previousWeek.low,
      100,
      "W1",
      "PWL"
    );

  }


  const asia =
    sessionRange(
      m5,
      ...CONFIG
        .sessionsUTC
        .asia,
      "Asia"
    );


  const london =
    sessionRange(
      m5,
      ...CONFIG
        .sessionsUTC
        .london,
      "London"
    );


  const newYork =
    sessionRange(
      m5,
      ...CONFIG
        .sessionsUTC
        .newYork,
      "New York"
    );


  for (
    const session
    of [
      asia,
      london,
      newYork
    ].filter(
      Boolean
    )
  ) {

    const weight =
      session.label ===
      "London"
        ?
        84
        :
        session.label ===
        "Asia"
          ?
          80
          :
          78;


    push(
      `${session.label} High`,
      "BSL",
      session.high,
      weight,
      "M5",
      `${session.label.toUpperCase()}_HIGH`
    );


    push(
      `${session.label} Low`,
      "SSL",
      session.low,
      weight,
      "M5",
      `${session.label.toUpperCase()}_LOW`
    );

  }


  const h1Pivots =
    pivots(
      h1.slice(
        -220
      ),
      CONFIG
        .pivots
        .h1
    );


  h1Pivots
    .highs
    .slice(
      -4
    )
    .forEach(
      (
        level,
        index
      ) => {

        push(
          `H1 Swing High ${4 - index}`,
          "BSL",
          level.price,
          76,
          "H1",
          "H1_SWING_HIGH",
          1,
          level.time
        );

      }
    );


  h1Pivots
    .lows
    .slice(
      -4
    )
    .forEach(
      (
        level,
        index
      ) => {

        push(
          `H1 Swing Low ${4 - index}`,
          "SSL",
          level.price,
          76,
          "H1",
          "H1_SWING_LOW",
          1,
          level.time
        );

      }
    );


  levels.push(
    ...findEqualLevels(
      m15,
      atr15 *
        CONFIG
          .levels
          .equalAtr,
      CONFIG
        .pivots
        .equal
    )
  );


  for (
    const level
    of levels
  ) {

    level.touches =
      Math.max(

        level.touches ||
        1,

        countTouches(
          m5,
          level.price,
          atr5 *
            CONFIG
              .levels
              .touchAtr
        )

      );

  }


  const deduplicated =
    [];


  const tolerance =
    atr5 *
    0.08;


  for (
    const level
    of levels.sort(
      (
        a,
        b
      ) =>
        b.weight -
        a.weight
    )
  ) {

    const duplicate =
      deduplicated.some(
        existing =>
          existing.side ===
            level.side &&
          Math.abs(
            existing.price -
            level.price
          ) <=
            tolerance &&
          existing.source ===
            level.source
      );


    if (
      !duplicate
    ) {

      deduplicated.push(
        level
      );

    }

  }


  return {

    levels:
      deduplicated,

    sessions: {

      asia,

      london,

      newYork

    },

    previousDay,

    previousWeek

  };

}


/* ================================================================
   TREND DETECTOR
================================================================ */

function detectTrend(
  candles
) {

  const ema20 =
    emaArray(
      candles,
      20
    );


  const ema50 =
    emaArray(
      candles,
      50
    );


  const atr =
    atrArray(
      candles,
      14
    );


  const index =
    candles.length -
    1;


  const currentAtr =
    atr[
      index
    ] ||
    candles[
      index
    ].close *
    0.001;


  const spread =
    safeDiv(

      ema20[
        index
      ] -
      ema50[
        index
      ],

      currentAtr,

      0

    );


  const slope =
    index >
    6
      ?
      safeDiv(

        ema20[
          index
        ] -
        ema20[
          index -
          6
        ],

        currentAtr,

        0

      )
      :
      0;


  const score =
    spread *
      0.75 +
    slope *
      0.45;


  return {

    bias:
      score >
      0.35
        ?
        "BULLISH"
        :
        score <
          -0.35
          ?
          "BEARISH"
          :
          "NEUTRAL",

    score:
      round(
        score,
        2
      ),

    ema20:
      round(
        ema20[
          index
        ],
        3
      ),

    ema50:
      round(
        ema50[
          index
        ],
        3
      )

  };

}


/* ================================================================
   MARKET REGIME
================================================================ */

function detectRegime(
  m15,
  h1
) {

  const trend =
    detectTrend(
      h1
    );


  const atr15 =
    atrArray(
      m15,
      14
    );


  const ranges =
    m15.map(
      candle =>
        candle.high -
        candle.low
    );


  const index =
    m15.length -
    1;


  const recentRange =
    rollingMean(
      ranges,
      index,
      12
    );


  const baseRange =
    rollingMean(
      ranges,
      Math.max(
        0,
        index -
        12
      ),
      36
    ) ||
    recentRange;


  const expansion =
    safeDiv(
      recentRange,
      baseRange,
      1
    );


  const h1Atr =
    atrArray(
      h1,
      14
    );


  const h1Index =
    h1.length -
    1;


  const ema20 =
    emaArray(
      h1,
      20
    );


  const ema50 =
    emaArray(
      h1,
      50
    );


  const trendStrength =
    Math.abs(
      safeDiv(

        ema20[
          h1Index
        ] -
        ema50[
          h1Index
        ],

        h1Atr[
          h1Index
        ] ||
        1,

        0

      )
    );


  let label =
    "RANGE";


  if (
    expansion >=
    1.32
  ) {

    label =
      "VOLATILITY EXPANSION";

  }

  else if (
    expansion <=
    0.72
  ) {

    label =
      "COMPRESSION";

  }

  else if (
    trendStrength >=
    0.75
  ) {

    label =
      trend.bias ===
      "BULLISH"
        ?
        "BULLISH TREND"
        :
        "BEARISH TREND";

  }


  return {

    label,

    trend:
      trend.bias,

    trendStrength:
      round(
        clamp(
          trendStrength *
          55,
          0,
          100
        ),
        1
      ),

    volatilityRatio:
      round(
        expansion,
        2
      ),

    atrM15:
      round(
        atr15[
          index
        ],
        3
      )

  };

}


/* ================================================================
   LIQUIDITY CLUSTER ENGINE
================================================================ */

function clusterLiquidity(
  levels,
  currentPrice,
  atr5,
  trendBias =
    "NEUTRAL"
) {

  const mergeDistance =
    Math.max(

      atr5 *
        CONFIG
          .levels
          .mergeAtr,

      currentPrice *
        0.00008

    );


  const result =
    [];


  for (
    const side
    of [
      "BSL",
      "SSL"
    ]
  ) {

    const levelsForSide =
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


    let cluster =
      [];


    const flush =
      () => {

        if (
          !cluster.length
        ) {

          return;

        }


        const weights =
          cluster.map(
            level =>
              level.weight
          );


        const weightedCenter =
          safeDiv(

            sum(
              cluster.map(
                (
                  level,
                  index
                ) =>
                  level.price *
                  weights[
                    index
                  ]
              )
            ),

            sum(
              weights
            ),

            mean(
              cluster.map(
                level =>
                  level.price
              )
            )

          );


        const touches =
          Math.max(
            ...cluster.map(
              level =>
                level.touches ||
                1
            )
          );


        const timeframeBonus =
          cluster.some(
            level =>
              level.timeframe ===
              "W1"
          )
            ?
            12
            :
            cluster.some(
              level =>
                level.timeframe ===
                "D1"
            )
              ?
              9
              :
              cluster.some(
                level =>
                  level.timeframe ===
                  "H1"
              )
                ?
                5
                :
                2;


        const rawStrength =
          sum(
            weights.map(
              weight =>
                weight *
                0.38
            )
          ) +
          Math.min(
            12,
            touches *
              2.5
          ) +
          timeframeBonus;


        let strength =
          clamp(
            rawStrength,
            0,
            100
          );


        if (
          cluster.length >=
          2
        ) {

          strength =
            clamp(
              strength +
                8,
              0,
              100
            );

        }


        const padding =
          atr5 *
          0.08;


        const low =
          Math.min(
            ...cluster.map(
              level =>
                level.price
            )
          ) -
          padding;


        const high =
          Math.max(
            ...cluster.map(
              level =>
                level.price
            )
          ) +
          padding;


        const distance =
          Math.abs(
            weightedCenter -
            currentPrice
          );


        const distanceAtr =
          safeDiv(
            distance,
            atr5,
            99
          );


        const freshnessBonus =
          touches <=
          2
            ?
            8
            :
            touches <=
            4
              ?
              4
              :
              -3;


        const directionalBonus =
          trendBias ===
          "BULLISH"
            ?
            (
              side ===
              "BSL"
                ?
                7
                :
                -3
            )
            :
            trendBias ===
            "BEARISH"
              ?
              (
                side ===
                "SSL"
                  ?
                  7
                  :
                  -3
              )
              :
              0;


        const magnetScore =
          clamp(

            strength +
            freshnessBonus +
            directionalBonus -
            distanceAtr *
              5.5,

            0,

            100

          );


        result.push(
          {

            id:
              `${side}-${round(
                weightedCenter,
                2
              )}`,

            side,

            low:
              round(
                low,
                3
              ),

            high:
              round(
                high,
                3
              ),

            center:
              round(
                weightedCenter,
                3
              ),

            strength:
              round(
                strength,
                1
              ),

            magnetScore:
              round(
                magnetScore,
                1
              ),

            distance:
              round(
                distance,
                3
              ),

            distanceAtr:
              round(
                distanceAtr,
                2
              ),

            touches,

            sources:
              cluster.map(
                level => ({

                  name:
                    level.name,

                  timeframe:
                    level.timeframe,

                  price:
                    round(
                      level.price,
                      3
                    ),

                  weight:
                    level.weight

                })
              )

          }
        );


        cluster =
          [];

      };


    for (
      const level
      of levelsForSide
    ) {

      if (
        !cluster.length
      ) {

        cluster.push(
          level
        );

      }

      else {

        const center =
          mean(
            cluster.map(
              item =>
                item.price
            )
          );


        if (
          Math.abs(
            level.price -
            center
          ) <=
          mergeDistance
        ) {

          cluster.push(
            level
          );

        }

        else {

          flush();

          cluster.push(
            level
          );

        }

      }

    }


    flush();

  }


  return result.sort(
    (
      a,
      b
    ) =>
      b.magnetScore -
      a.magnetScore
  );

}


/* ================================================================
   RAID DETECTOR
================================================================ */

function detectRaidForCluster(
  cluster,
  m5,
  atr5
) {

  const start =
    Math.max(
      1,
      m5.length -
      90
    );


  const minimumPenetration =
    atr5 *
    CONFIG
      .levels
      .sweepMinAtr;


  const maximumPenetration =
    atr5 *
    CONFIG
      .levels
      .sweepMaxAtr;


  let best =
    null;


  for (
    let index =
      start;
    index <
      m5.length -
      1;
    index++
  ) {

    const candle =
      m5[
        index
      ];


    const range =
      Math.max(
        candle.high -
        candle.low,
        0.000000001
      );


    let swept =
      false;


    let penetration =
      0;


    let wickRatio =
      0;


    let rejection =
      0;


    if (
      cluster.side ===
      "BSL"
    ) {

      penetration =
        candle.high -
        cluster.high;


      swept =
        penetration >=
          minimumPenetration &&
        penetration <=
          maximumPenetration &&
        candle.close <
          cluster.high;


      wickRatio =
        safeDiv(

          candle.high -
          Math.max(
            candle.open,
            candle.close
          ),

          range,

          0

        );


      rejection =
        safeDiv(

          cluster.high -
          candle.close,

          atr5,

          0

        );

    }

    else {

      penetration =
        cluster.low -
        candle.low;


      swept =
        penetration >=
          minimumPenetration &&
        penetration <=
          maximumPenetration &&
        candle.close >
          cluster.low;


      wickRatio =
        safeDiv(

          Math.min(
            candle.open,
            candle.close
          ) -
          candle.low,

          range,

          0

        );


      rejection =
        safeDiv(

          candle.close -
          cluster.low,

          atr5,

          0

        );

    }


    if (
      !swept
    ) {

      continue;

    }


    const next =
      m5.slice(
        index +
          1,
        Math.min(
          m5.length,
          index +
            5
        )
      );


    let displacement =
      0;


    if (
      cluster.side ===
      "BSL"
    ) {

      displacement =
        safeDiv(

          candle.close -
          Math.min(
            ...next.map(
              item =>
                item.low
            )
          ),

          atr5,

          0

        );

    }

    else {

      displacement =
        safeDiv(

          Math.max(
            ...next.map(
              item =>
                item.high
            )
          ) -
          candle.close,

          atr5,

          0

        );

    }


    const penetrationQuality =
      clamp(

        1 -
        Math.abs(
          safeDiv(
            penetration,
            atr5,
            0
          ) -
          0.25
        ),

        0,

        1

      );


    const quality =
      clamp(

        35 +

        wickRatio *
          28 +

        clamp(
          rejection,
          0,
          1.5
        ) *
          13 +

        clamp(
          displacement,
          0,
          2.5
        ) *
          12 +

        penetrationQuality *
          10 +

        cluster.strength *
          0.12,

        0,

        100

      );


    const reversalEvidence =
      clamp(

        quality +

        clamp(
          displacement -
          0.5,
          0,
          2
        ) *
          8,

        0,

        100

      );


    const continuationEvidence =
      clamp(

        100 -
        reversalEvidence *
          0.82,

        0,

        100

      );


    const candidate =
      {

        status:
          "CONFIRMED",

        side:
          cluster.side,

        directionAfterRaid:
          cluster.side ===
          "SSL"
            ?
            "BULLISH"
            :
            "BEARISH",

        clusterId:
          cluster.id,

        level:
          cluster.center,

        time:
          candle.time,

        barsAgo:
          m5.length -
          1 -
          index,

        penetrationAtr:
          round(
            safeDiv(
              penetration,
              atr5,
              0
            ),
            2
          ),

        wickRatio:
          round(
            wickRatio,
            2
          ),

        displacementAtr:
          round(
            displacement,
            2
          ),

        quality:
          round(
            quality,
            1
          ),

        reversalEvidence:
          round(
            reversalEvidence,
            1
          ),

        continuationEvidence:
          round(
            continuationEvidence,
            1
          ),

        raidHigh:
          round(
            candle.high,
            3
          ),

        raidLow:
          round(
            candle.low,
            3
          )

      };


    if (
      !best ||
      candidate.time >
      best.time ||
      candidate.quality >
      best.quality
    ) {

      best =
        candidate;

    }

  }


  return best;

}


/* ================================================================
   LIQUIDITY APPROACH VELOCITY
================================================================ */

function approachVelocity(
  m1,
  target
) {

  const candles =
    m1.slice(
      -8
    );


  if (
    candles.length <
    3
  ) {

    return {

      perMinute:
        0,

      toward:
        false,

      etaMinutes:
        null

    };

  }


  const minutes =
    Math.max(

      1,

      (
        candles[
          candles.length -
          1
        ].time -
        candles[
          0
        ].time
      ) /
      60

    );


  const slope =
    (
      candles[
        candles.length -
        1
      ].close -
      candles[
        0
      ].close
    ) /
    minutes;


  const currentPrice =
    candles[
      candles.length -
      1
    ].close;


  const targetDirection =
    Math.sign(
      target -
      currentPrice
    );


  const movingToward =
    Math.sign(
      slope
    ) ===
      targetDirection &&
    Math.abs(
      slope
    ) >
      0;


  const eta =
    movingToward
      ?
      Math.abs(
        target -
        currentPrice
      ) /
      Math.abs(
        slope
      )
      :
      null;


  return {

    perMinute:
      round(
        slope,
        3
      ),

    toward:
      movingToward,

    etaMinutes:
      eta &&
      eta <
      999
        ?
        round(
          eta,
          1
        )
        :
        null

  };

}


/* ================================================================
   RAID STATE ENGINE
================================================================ */

function buildRaidState(
  clusters,
  m5,
  m1,
  atr5,
  currentPrice
) {

  const raids =
    clusters
      .map(
        cluster =>
          detectRaidForCluster(
            cluster,
            m5,
            atr5
          )
      )
      .filter(
        Boolean
      );


  const latest =
    raids
      .sort(
        (
          a,
          b
        ) =>
          b.time -
          a.time
      )[
        0
      ] ||
    null;


  const nearest =
    [
      ...clusters
    ].sort(
      (
        a,
        b
      ) =>
        a.distance -
        b.distance
    )[
      0
    ] ||
    null;


  let tracking =
    null;


  if (
    nearest
  ) {

    const velocity =
      approachVelocity(
        m1,
        nearest.center
      );


    const proximity =
      clamp(

        100 -
        nearest.distanceAtr *
          45,

        0,

        100

      );


    const pressure =
      clamp(

        proximity *
          0.55 +

        nearest.strength *
          0.30 +

        (
          velocity.toward
            ?
            15
            :
            0
        ),

        0,

        100

      );


    tracking =
      {

        clusterId:
          nearest.id,

        side:
          nearest.side,

        level:
          nearest.center,

        distance:
          round(
            Math.abs(
              nearest.center -
              currentPrice
            ),
            3
          ),

        distanceAtr:
          nearest.distanceAtr,

        pressure:
          round(
            pressure,
            1
          ),

        velocity,

        stage:
          nearest.distanceAtr <
          0.25
            ?
            "CONTACT"
            :
            nearest.distanceAtr <
            0.8
              ?
              "APPROACHING"
              :
              "TRACKING"

      };

  }


  return {

    latestConfirmed:
      latest,

    confirmed:
      raids.slice(
        0,
        6
      ),

    tracking

  };

}


/* ================================================================
   TRAP ENGINE
================================================================ */

function detectTrap(
  raid,
  m5,
  atr5
) {

  if (
    !raid ||
    raid.status !==
    "CONFIRMED"
  ) {

    return {

      active:
        false,

      type:
        "NONE",

      strength:
        0,

      reason:
        "No confirmed liquidity sweep."

    };

  }


  const index =
    m5.findIndex(
      candle =>
        candle.time ===
        raid.time
    );


  if (
    index <
    0
  ) {

    return {

      active:
        false,

      type:
        "NONE",

      strength:
        0,

      reason:
        "Raid candle not found."

    };

  }


  const after =
    m5.slice(

      index +
        1,

      Math.min(
        m5.length,
        index +
          6
      )

    );


  if (
    !after.length
  ) {

    return {

      active:
        false,

      type:
        "NONE",

      strength:
        0,

      reason:
        "Waiting for post-raid confirmation."

    };

  }


  const raidCandle =
    m5[
      index
    ];


  let followThrough =
    0;


  if (
    raid.side ===
    "BSL"
  ) {

    followThrough =
      safeDiv(

        raidCandle.close -
        Math.min(
          ...after.map(
            candle =>
              candle.low
          )
        ),

        atr5,

        0

      );

  }

  else {

    followThrough =
      safeDiv(

        Math.max(
          ...after.map(
            candle =>
              candle.high
          )
        ) -
        raidCandle.close,

        atr5,

        0

      );

  }


  const strength =
    clamp(

      raid.quality *
        0.62 +

      clamp(
        followThrough,
        0,
        2.5
      ) *
        16,

      0,

      100

    );


  return {

    active:
      strength >=
      62,

    type:
      raid.side ===
      "BSL"
        ?
        "BUYER TRAP"
        :
        "SELLER TRAP",

    strength:
      round(
        strength,
        1
      ),

    direction:
      raid.side ===
      "BSL"
        ?
        "BEARISH"
        :
        "BULLISH",

    reason:
      raid.side ===
      "BSL"
        ?
        "Buy-side liquidity was swept and price rejected back below the cluster."
        :
        "Sell-side liquidity was swept and price reclaimed back above the cluster."

  };

}


/* ================================================================
   MARKET PHASE STATE MACHINE
================================================================ */

function detectMarketPhase(
  m5,
  raid,
  regime
) {

  const atr =
    atrArray(
      m5,
      14
    );


  const index =
    m5.length -
    1;


  const currentAtr =
    atr[
      index
    ] ||
    1;


  const ranges =
    m5.map(
      candle =>
        candle.high -
        candle.low
    );


  const recentRange =
    rollingMean(
      ranges,
      index,
      8
    );


  const baselineRange =
    rollingMean(
      ranges,
      Math.max(
        0,
        index -
        8
      ),
      30
    ) ||
    recentRange;


  const compression =
    safeDiv(
      recentRange,
      baselineRange,
      1
    );


  const last =
    m5[
      index
    ];


  const body =
    Math.abs(
      last.close -
      last.open
    );


  const displacement =
    safeDiv(
      last.high -
      last.low,
      currentAtr,
      0
    ) >=
      1.45 &&
    safeDiv(
      body,
      last.high -
      last.low,
      0
    ) >=
      0.58;


  if (
    raid &&
    raid.barsAgo <=
    3
  ) {

    return {

      phase:
        "RAID",

      score:
        round(
          raid.quality,
          1
        ),

      detail:
        "A recent liquidity cluster has been swept and reclaimed."

    };

  }


  if (
    displacement
  ) {

    return {

      phase:
        "DISPLACEMENT",

      score:
        round(

          clamp(

            (
              last.high -
              last.low
            ) /
            currentAtr *
            45,

            0,

            100

          ),

          1

        ),

      detail:
        "A large directional candle is expanding away from recent balance."

    };

  }


  if (
    regime.label ===
    "VOLATILITY EXPANSION"
  ) {

    return {

      phase:
        "EXPANSION",

      score:
        round(

          clamp(
            regime.volatilityRatio *
            55,
            0,
            100
          ),

          1

        ),

      detail:
        "Short-term range is expanding relative to its recent baseline."

    };

  }


  if (
    compression <
    0.72
  ) {

    return {

      phase:
        "LIQUIDITY BUILDUP",

      score:
        round(

          clamp(
            (
              1 -
              compression
            ) *
            180,
            0,
            100
          ),

          1

        ),

      detail:
        "Price is compressing, increasing the chance of liquidity building around the range."

    };

  }


  const ema20 =
    emaArray(
      m5,
      20
    );


  const distance =
    Math.abs(
      last.close -
      ema20[
        index
      ]
    );


  if (
    regime.trend !==
      "NEUTRAL" &&
    distance <
      currentAtr *
      0.35
  ) {

    return {

      phase:
        "RETRACEMENT",

      score:
        66,

      detail:
        "Price is pulling back toward its short-term mean inside a directional regime."

    };

  }


  return {

    phase:
      "ACCUMULATION",

    score:
      55,

    detail:
      "No confirmed raid or displacement; price is rotating and building structure."

  };

}


/* ================================================================
   HISTORICAL FEATURE ENGINE
================================================================ */

function historicalFeatures(
  candles,
  index,
  ema20,
  ema50,
  atr14,
  atr50,
  rsi14
) {

  if (
    index <
      55 ||
    !atr14[
      index
    ] ||
    !atr50[
      index
    ] ||
    !rsi14[
      index
    ]
  ) {

    return null;

  }


  const candle =
    candles[
      index
    ];


  const start =
    Math.max(
      0,
      index -
      47
    );


  const window =
    candles.slice(
      start,
      index +
      1
    );


  const highest =
    Math.max(
      ...window.map(
        item =>
          item.high
      )
    );


  const lowest =
    Math.min(
      ...window.map(
        item =>
          item.low
      )
    );


  const priceRange =
    Math.max(
      highest -
      lowest,
      0.000000001
    );


  const body =
    Math.abs(
      candle.close -
      candle.open
    );


  const candleRange =
    Math.max(
      candle.high -
      candle.low,
      0.000000001
    );


  const return5 =
    safeDiv(

      candle.close -
      candles[
        index -
        5
      ].close,

      atr14[
        index
      ],

      0

    );


  return [

    safeDiv(

      ema20[
        index
      ] -
      ema50[
        index
      ],

      atr14[
        index
      ],

      0

    ),


    (
      rsi14[
        index
      ] -
      50
    ) /
    25,


    safeDiv(

      atr14[
        index
      ],

      atr50[
        index
      ],

      1

    ) -
    1,


    (
      (
        candle.close -
        lowest
      ) /
      priceRange -
      0.5
    ) *
    2,


    clamp(
      return5 /
      2,
      -2,
      2
    ),


    safeDiv(
      body,
      candleRange,
      0
    ) *
    Math.sign(
      candle.close -
      candle.open
    )

  ];

}


/* ================================================================
   HISTORICAL SIMILARITY
================================================================ */

function similarity(
  a,
  b
) {

  if (
    !a ||
    !b
  ) {

    return 0;

  }


  const weights =
    [
      1.2,
      0.9,
      0.8,
      1.0,
      0.9,
      0.7
    ];


  let distance =
    0;


  let weightTotal =
    0;


  for (
    let index =
      0;
    index <
      a.length;
    index++
  ) {

    distance +=
      Math.abs(
        a[
          index
        ] -
        b[
          index
        ]
      ) *
      weights[
        index
      ];


    weightTotal +=
      weights[
        index
      ];

  }


  const averageDistance =
    distance /
    weightTotal;


  return (
    100 /
    (
      1 +
      averageDistance *
      1.35
    )
  );

}


/* ================================================================
   HISTORICAL MEMORY ENGINE
================================================================ */

function historicalMemory(
  m5
) {

  const length =
    m5.length;


  const ema20 =
    emaArray(
      m5,
      20
    );


  const ema50 =
    emaArray(
      m5,
      50
    );


  const atr14 =
    atrArray(
      m5,
      14
    );


  const atr50 =
    atrArray(
      m5,
      50
    );


  const rsi14 =
    rsiArray(
      m5,
      14
    );


  const currentIndex =
    length -
    1;


  const current =
    historicalFeatures(

      m5,

      currentIndex,

      ema20,

      ema50,

      atr14,

      atr50,

      rsi14

    );


  if (
    !current
  ) {

    return {

      matches:
        0,

      message:
        "Not enough history."

    };

  }


  const candidates =
    [];


  const forward =
    CONFIG
      .historical
      .forwardBars;


  for (
    let index =
      70;
    index <
      length -
        forward -
        20;
    index +=
      2
  ) {

    const features =
      historicalFeatures(

        m5,

        index,

        ema20,

        ema50,

        atr14,

        atr50,

        rsi14

      );


    const match =
      similarity(
        current,
        features
      );


    if (
      match <
      CONFIG
        .historical
        .minSimilarity
    ) {

      continue;

    }


    const entry =
      m5[
        index
      ].close;


    const currentAtr =
      atr14[
        index
      ] ||
      1;


    let longResult =
      0;


    let shortResult =
      0;


    let longFinished =
      false;


    let shortFinished =
      false;


    let maxUp =
      0;


    let maxDown =
      0;


    for (
      let future =
        index +
        1;
      future <=
        index +
          forward;
      future++
    ) {

      const bar =
        m5[
          future
        ];


      maxUp =
        Math.max(

          maxUp,

          (
            bar.high -
            entry
          ) /
          currentAtr

        );


      maxDown =
        Math.max(

          maxDown,

          (
            entry -
            bar.low
          ) /
          currentAtr

        );


      if (
        !longFinished
      ) {

        const stopHit =
          bar.low <=
          entry -
          CONFIG
            .historical
            .stopAtr *
          currentAtr;


        const targetHit =
          bar.high >=
          entry +
          CONFIG
            .historical
            .targetAtr *
          currentAtr;


        if (
          stopHit ||
          targetHit
        ) {

          longResult =
            stopHit
              ?
              -CONFIG
                .historical
                .stopAtr
              :
              CONFIG
                .historical
                .targetAtr;


          longFinished =
            true;

        }

      }


      if (
        !shortFinished
      ) {

        const stopHit =
          bar.high >=
          entry +
          CONFIG
            .historical
            .stopAtr *
          currentAtr;


        const targetHit =
          bar.low <=
          entry -
          CONFIG
            .historical
            .targetAtr *
          currentAtr;


        if (
          stopHit ||
          targetHit
        ) {

          shortResult =
            stopHit
              ?
              -CONFIG
                .historical
                .stopAtr
              :
              CONFIG
                .historical
                .targetAtr;


          shortFinished =
            true;

        }

      }

    }


    if (
      !longFinished
    ) {

      longResult =
        (
          m5[
            index +
            forward
          ].close -
          entry
        ) /
        currentAtr;

    }


    if (
      !shortFinished
    ) {

      shortResult =
        (
          entry -
          m5[
            index +
            forward
          ].close
        ) /
        currentAtr;

    }


    candidates.push(
      {

        sim:
          match,

        time:
          m5[
            index
          ].time,

        longResult,

        shortResult,

        maxUp,

        maxDown

      }
    );

  }


  const top =
    candidates
      .sort(
        (
          a,
          b
        ) =>
          b.sim -
          a.sim
      )
      .slice(
        0,
        CONFIG
          .historical
          .topK
      );


  if (
    !top.length
  ) {

    return {

      matches:
        0,

      message:
        "No sufficiently similar historical samples."

    };

  }


  const longWins =
    top.filter(
      match =>
        match.longResult >=
        CONFIG
          .historical
          .targetAtr
    ).length;


  const shortWins =
    top.filter(
      match =>
        match.shortResult >=
        CONFIG
          .historical
          .targetAtr
    ).length;


  const averageLong =
    mean(
      top.map(
        match =>
          match.longResult
      )
    );


  const averageShort =
    mean(
      top.map(
        match =>
          match.shortResult
      )
    );


  const bias =
    averageLong -
      averageShort >
    0.2
      ?
      "BULLISH"
      :
      averageShort -
        averageLong >
      0.2
        ?
        "BEARISH"
        :
        "NEUTRAL";


  return {

    matches:
      top.length,

    averageSimilarity:
      round(
        mean(
          top.map(
            match =>
              match.sim
          )
        ),
        1
      ),

    medianSimilarity:
      round(
        median(
          top.map(
            match =>
              match.sim
          )
        ),
        1
      ),

    bullishTargetHitPct:
      round(
        longWins /
        top.length *
        100,
        1
      ),

    bearishTargetHitPct:
      round(
        shortWins /
        top.length *
        100,
        1
      ),

    averageLongR:
      round(
        averageLong,
        2
      ),

    averageShortR:
      round(
        averageShort,
        2
      ),

    medianMaxUpAtr:
      round(
        median(
          top.map(
            match =>
              match.maxUp
          )
        ),
        2
      ),

    medianMaxDownAtr:
      round(
        median(
          top.map(
            match =>
              match.maxDown
          )
        ),
        2
      ),

    bias,

    examples:
      top
        .slice(
          0,
          5
        )
        .map(
          match => ({

            time:
              match.time,

            similarity:
              round(
                match.sim,
                1
              ),

            longR:
              round(
                match.longResult,
                2
              ),

            shortR:
              round(
                match.shortResult,
                2
              )

          })
        )

  };

}


/* ================================================================
   FRED SERIES
================================================================ */

async function fredSeries(
  seriesId,
  limit = 16
) {

  const apiKey =
    process.env
      .FRED_API_KEY;


  if (
    !apiKey
  ) {

    return null;

  }


  const url =
    new URL(
      FRED_BASE
    );


  url.searchParams.set(
    "series_id",
    seriesId
  );


  url.searchParams.set(
    "api_key",
    apiKey
  );


  url.searchParams.set(
    "file_type",
    "json"
  );


  url.searchParams.set(
    "sort_order",
    "desc"
  );


  url.searchParams.set(
    "limit",
    String(
      limit
    )
  );


  const data =
    await fetchJson(
      url.toString(),
      10000
    );


  return (
    data?.observations ||
    []
  )
    .map(
      observation => ({

        date:
          observation.date,

        value:
          Number(
            observation.value
          )

      })
    )
    .filter(
      observation =>
        Number.isFinite(
          observation.value
        )
    );

}


/* ================================================================
   MACRO ENGINE
================================================================ */

async function macroContext() {

  if (
    !process.env
      .FRED_API_KEY
  ) {

    return {

      enabled:
        false,

      score:
        0,

      bias:
        "NEUTRAL",

      evidence:
        [
          "FRED_API_KEY not configured."
        ],

      data:
        {}

    };

  }


  try {

    const [
      real10,
      nominal10,
      fed,
      cpi
    ] =
      await Promise.all(
        [

          fredSeries(
            "DFII10",
            10
          ),

          fredSeries(
            "DGS10",
            10
          ),

          fredSeries(
            "DFF",
            10
          ),

          fredSeries(
            "CPIAUCSL",
            16
          )

        ]
      );


    const newest =
      array =>
        array?.[
          0
        ]?.value ??
        null;


    const older =
      (
        array,
        index = 4
      ) =>
        array?.[
          Math.min(
            index,
            (
              array?.length ||
              1
            ) -
            1
          )
        ]?.value ??
        null;


    const realChange =
      newest(
        real10
      ) != null &&
      older(
        real10
      ) != null
        ?
        newest(
          real10
        ) -
        older(
          real10
        )
        :
        0;


    const nominalChange =
      newest(
        nominal10
      ) != null &&
      older(
        nominal10
      ) != null
        ?
        newest(
          nominal10
        ) -
        older(
          nominal10
        )
        :
        0;


    const fedChange =
      newest(
        fed
      ) != null &&
      older(
        fed
      ) != null
        ?
        newest(
          fed
        ) -
        older(
          fed
        )
        :
        0;


    const cpiYoY =
      cpi?.length >=
      13
        ?
        (
          cpi[
            0
          ].value /
          cpi[
            12
          ].value -
          1
        ) *
        100
        :
        null;


    let score =
      0;


    score +=
      clamp(
        -realChange *
        45,
        -35,
        35
      );


    score +=
      clamp(
        -nominalChange *
        22,
        -20,
        20
      );


    score +=
      clamp(
        -fedChange *
        18,
        -15,
        15
      );


    if (
      Number.isFinite(
        cpiYoY
      )
    ) {

      score +=
        clamp(
          (
            cpiYoY -
            2
          ) *
          4,
          -8,
          12
        );

    }


    score =
      clamp(
        score,
        -100,
        100
      );


    const evidence =
      [];


    evidence.push(
      `10Y real yield change: ${round(
        realChange,
        3
      )} pts`
    );


    evidence.push(
      `10Y nominal yield change: ${round(
        nominalChange,
        3
      )} pts`
    );


    evidence.push(
      `Fed effective rate change: ${round(
        fedChange,
        3
      )} pts`
    );


    if (
      Number.isFinite(
        cpiYoY
      )
    ) {

      evidence.push(
        `Approx CPI YoY: ${round(
          cpiYoY,
          2
        )}%`
      );

    }


    return {

      enabled:
        true,

      score:
        round(
          score,
          1
        ),

      bias:
        score >=
        12
          ?
          "BULLISH_GOLD"
          :
          score <=
          -12
            ?
            "BEARISH_GOLD"
            :
            "NEUTRAL",

      evidence,

      data: {

        real10Y:
          newest(
            real10
          ),

        nominal10Y:
          newest(
            nominal10
          ),

        fedFunds:
          newest(
            fed
          ),

        cpiYoY:
          round(
            cpiYoY,
            2
          )

      }

    };

  }

  catch (
    error
  ) {

    return {

      enabled:
        false,

      score:
        0,

      bias:
        "NEUTRAL",

      evidence:
        [
          `FRED unavailable: ${error.message}`
        ],

      data:
        {}

    };

  }

}


/* ================================================================
   DIRECTIONAL ENGINE
================================================================ */

function directionalBias({
  h1Trend,
  regime,
  raid,
  history,
  macro,
  clusters,
  price
}) {

  let buy =
    50;


  let sell =
    50;


  const reasonsBuy =
    [];


  const reasonsSell =
    [];


  if (
    h1Trend.bias ===
    "BULLISH"
  ) {

    buy +=
      15;


    reasonsBuy.push(
      "H1 trend bullish"
    );

  }


  if (
    h1Trend.bias ===
    "BEARISH"
  ) {

    sell +=
      15;


    reasonsSell.push(
      "H1 trend bearish"
    );

  }


  if (
    regime.trend ===
    "BULLISH"
  ) {

    buy +=
      6;

  }


  if (
    regime.trend ===
    "BEARISH"
  ) {

    sell +=
      6;

  }


  if (
    raid?.latestConfirmed
  ) {

    const currentRaid =
      raid.latestConfirmed;


    const boost =
      12 +
      currentRaid.quality *
      0.18;


    if (
      currentRaid.directionAfterRaid ===
      "BULLISH"
    ) {

      buy +=
        boost;


      reasonsBuy.push(
        `Sell-side raid ${currentRaid.quality}/100`
      );

    }

    else {

      sell +=
        boost;


      reasonsSell.push(
        `Buy-side raid ${currentRaid.quality}/100`
      );

    }

  }


  if (
    history?.bias ===
    "BULLISH"
  ) {

    buy +=
      10;


    reasonsBuy.push(
      "Historical analogues favor upside"
    );

  }


  if (
    history?.bias ===
    "BEARISH"
  ) {

    sell +=
      10;


    reasonsSell.push(
      "Historical analogues favor downside"
    );

  }


  if (
    macro?.score >
    0
  ) {

    buy +=
      Math.min(
        12,
        macro.score *
        0.18
      );


    reasonsBuy.push(
      "Macro pressure supportive for gold"
    );

  }


  if (
    macro?.score <
    0
  ) {

    sell +=
      Math.min(
        12,
        -macro.score *
        0.18
      );


    reasonsSell.push(
      "Macro pressure restrictive for gold"
    );

  }


  const above =
    clusters
      .filter(
        cluster =>
          cluster.center >
          price
      )
      .sort(
        (
          a,
          b
        ) =>
          b.magnetScore -
          a.magnetScore
      )[
        0
      ];


  const below =
    clusters
      .filter(
        cluster =>
          cluster.center <
          price
      )
      .sort(
        (
          a,
          b
        ) =>
          b.magnetScore -
          a.magnetScore
      )[
        0
      ];


  if (
    above &&
    below
  ) {

    const difference =
      above.magnetScore -
      below.magnetScore;


    if (
      difference >
      8
    ) {

      buy +=
        Math.min(
          12,
          difference *
          0.25
        );


      reasonsBuy.push(
        "Stronger liquidity magnet above price"
      );

    }


    if (
      difference <
      -8
    ) {

      sell +=
        Math.min(
          12,
          -difference *
          0.25
        );


      reasonsSell.push(
        "Stronger liquidity magnet below price"
      );

    }

  }


  buy =
    clamp(
      buy,
      0,
      100
    );


  sell =
    clamp(
      sell,
      0,
      100
    );


  const difference =
    buy -
    sell;


  const direction =
    difference >=
    8
      ?
      "BULLISH"
      :
      difference <=
      -8
        ?
        "BEARISH"
        :
        "NEUTRAL";


  return {

    direction,

    buyScore:
      round(
        buy,
        1
      ),

    sellScore:
      round(
        sell,
        1
      ),

    gap:
      round(
        Math.abs(
          difference
        ),
        1
      ),

    reasonsBuy,

    reasonsSell

  };

}


/* ================================================================
   CONFLUENCE ENGINE
================================================================ */

function confluenceScore({
  direction,
  clusters,
  raid,
  trap,
  history,
  macro,
  regime
}) {

  const nearest =
    [
      ...clusters
    ].sort(
      (
        a,
        b
      ) =>
        a.distance -
        b.distance
    )[
      0
    ];


  const liquidity =
    nearest
      ?
      nearest.strength
      :
      45;


  const structure =
    direction.direction ===
    "NEUTRAL"
      ?
      48
      :
      clamp(
        55 +
        direction.gap *
        1.25,
        0,
        100
      );


  const displacement =
    raid.latestConfirmed
      ?
      raid
        .latestConfirmed
        .reversalEvidence
      :
      45;


  const historical =
    history.matches
      ?
      Math.max(
        history
          .bullishTargetHitPct ||
        0,
        history
          .bearishTargetHitPct ||
        0
      )
      :
      45;


  const sessionHour =
    new Date()
      .getUTCHours();


  const session =
    sessionHour >=
      7 &&
    sessionHour <
      17
      ?
      82
      :
      sessionHour <
      7
        ?
        66
        :
        55;


  const macroAligned =
    direction.direction ===
    "BULLISH"
      ?
      clamp(
        50 +
        macro.score *
        0.5,
        0,
        100
      )
      :
      direction.direction ===
      "BEARISH"
        ?
        clamp(
          50 -
          macro.score *
          0.5,
          0,
          100
        )
        :
        50;


  const regimeScore =
    regime.label.includes(
      "TREND"
    ) ||
    regime.label.includes(
      "EXPANSION"
    )
      ?
      78
      :
      regime.label ===
      "COMPRESSION"
        ?
        60
        :
        55;


  const trapScore =
    trap.active
      ?
      trap.strength
      :
      45;


  const components =
    {

      liquidity:
        round(
          liquidity,
          1
        ),

      structure:
        round(
          structure,
          1
        ),

      displacement:
        round(
          displacement,
          1
        ),

      session:
        round(
          session,
          1
        ),

      historical:
        round(
          historical,
          1
        ),

      macro:
        round(
          macroAligned,
          1
        ),

      regime:
        round(
          regimeScore,
          1
        ),

      trap:
        round(
          trapScore,
          1
        )

    };


  const weights =
    {

      liquidity:
        0.18,

      structure:
        0.18,

      displacement:
        0.16,

      session:
        0.08,

      historical:
        0.16,

      macro:
        0.08,

      regime:
        0.09,

      trap:
        0.07

    };


  const total =
    Object
      .keys(
        weights
      )
      .reduce(
        (
          result,
          key
        ) =>
          result +
          components[
            key
          ] *
          weights[
            key
          ],
        0
      );


  return {

    total:
      round(
        total,
        1
      ),

    components

  };

}


/* ================================================================
   TARGET SELECTOR
================================================================ */

function selectTargets(
  clusters,
  price,
  direction
) {

  if (
    direction ===
    "BULLISH"
  ) {

    return clusters
      .filter(
        cluster =>
          cluster.center >
            price &&
          cluster.side ===
            "BSL"
      )
      .sort(
        (
          a,
          b
        ) =>
          b.magnetScore -
          a.magnetScore
      );

  }


  if (
    direction ===
    "BEARISH"
  ) {

    return clusters
      .filter(
        cluster =>
          cluster.center <
            price &&
          cluster.side ===
            "SSL"
      )
      .sort(
        (
          a,
          b
        ) =>
          b.magnetScore -
          a.magnetScore
      );

  }


  return [];

}


/* ================================================================
   TRADE CONSTRUCTION
================================================================ */

function tradeIdea({
  price,
  atr5,
  direction,
  confluence,
  raid,
  clusters
}) {

  if (
    direction.direction ===
      "NEUTRAL" ||
    confluence.total <
      66
  ) {

    return {

      status:
        "NO_TRADE",

      direction:
        "NEUTRAL",

      reason:
        "Directional agreement or confluence is below the execution threshold."

    };

  }


  const directionalMultiplier =
    direction.direction ===
    "BULLISH"
      ?
      1
      :
      -1;


  const targets =
    selectTargets(
      clusters,
      price,
      direction.direction
    );


  const confirmed =
    raid.latestConfirmed &&
    raid
      .latestConfirmed
      .directionAfterRaid ===
      direction.direction &&
    raid
      .latestConfirmed
      .barsAgo <=
      12;


  const status =
    confirmed &&
    confluence.total >=
    72
      ?
      "READY"
      :
      "WATCH";


  const entryLow =
    price -
    atr5 *
    0.12;


  const entryHigh =
    price +
    atr5 *
    0.12;


  const entry =
    price;


  let stop;


  if (
    confirmed
  ) {

    stop =
      directionalMultiplier >
      0
        ?
        Math.min(

          raid
            .latestConfirmed
            .raidLow -
          atr5 *
            0.18,

          entry -
          atr5 *
            0.8

        )
        :
        Math.max(

          raid
            .latestConfirmed
            .raidHigh +
          atr5 *
            0.18,

          entry +
          atr5 *
            0.8

        );

  }

  else {

    stop =
      entry -
      directionalMultiplier *
      atr5 *
      1.05;

  }


  const risk =
    Math.max(

      Math.abs(
        entry -
        stop
      ),

      atr5 *
      0.65

    );


  const tp1 =
    entry +
    directionalMultiplier *
    risk *
    1.5;


  let tp2 =
    entry +
    directionalMultiplier *
    risk *
    2.5;


  const liquidityTarget =
    targets[
      0
    ]?.center ??
    null;


  if (
    liquidityTarget !=
    null
  ) {

    const targetR =
      Math.abs(
        liquidityTarget -
        entry
      ) /
      risk;


    const validDirection =
      directionalMultiplier >
      0
        ?
        liquidityTarget >
        entry
        :
        liquidityTarget <
        entry;


    if (
      validDirection &&
      targetR >=
      1.8
    ) {

      tp2 =
        liquidityTarget;

    }

  }


  return {

    status,

    direction:
      direction.direction,

    entryZone:
      [

        round(
          Math.min(
            entryLow,
            entryHigh
          ),
          3
        ),

        round(
          Math.max(
            entryLow,
            entryHigh
          ),
          3
        )

      ],

    referenceEntry:
      round(
        entry,
        3
      ),

    stop:
      round(
        stop,
        3
      ),

    tp1:
      round(
        tp1,
        3
      ),

    tp2:
      round(
        tp2,
        3
      ),

    liquidityTarget:
      liquidityTarget !=
      null
        ?
        round(
          liquidityTarget,
          3
        )
        :
        null,

    riskDistance:
      round(
        risk,
        3
      ),

    rrToTp1:
      1.5,

    rrToTp2:
      round(
        Math.abs(
          tp2 -
          entry
        ) /
        risk,
        2
      ),

    confidenceScore:
      confluence.total,

    reason:
      confirmed
        ?
        "Confirmed liquidity raid aligns with the directional engine."
        :
        "Strong confluence, but waiting for a cleaner raid/retest confirmation."

  };

}


/* ================================================================
   SCENARIO WEIGHT NORMALIZER
================================================================ */

function normalizeWeights(
  raw
) {

  const exponential =
    raw.map(
      value =>
        Math.exp(
          value /
          18
        )
    );


  const total =
    sum(
      exponential
    ) ||
    1;


  return exponential.map(
    value =>
      value /
      total *
      100
  );

}


/* ================================================================
   SCENARIO PROJECTION
================================================================ */

function scenarioProjection({
  price,
  atr5,
  direction,
  clusters,
  raid,
  confluence,
  lastTime
}) {

  const above =
    clusters
      .filter(
        cluster =>
          cluster.center >
          price
      )
      .sort(
        (
          a,
          b
        ) =>
          b.magnetScore -
          a.magnetScore
      )[
        0
      ];


  const below =
    clusters
      .filter(
        cluster =>
          cluster.center <
          price
      )
      .sort(
        (
          a,
          b
        ) =>
          b.magnetScore -
          a.magnetScore
      )[
        0
      ];


  const primaryDirection =
    direction.direction ===
    "BEARISH"
      ?
      -1
      :
      direction.direction ===
      "BULLISH"
        ?
        1
        :
        (
          (
            above?.magnetScore ||
            0
          ) >=
          (
            below?.magnetScore ||
            0
          )
            ?
            1
            :
            -1
        );


  const primaryTarget =
    primaryDirection >
    0
      ?
      (
        above?.center ??
        price +
        atr5 *
        2.4
      )
      :
      (
        below?.center ??
        price -
        atr5 *
        2.4
      );


  const oppositeTarget =
    primaryDirection >
    0
      ?
      (
        below?.center ??
        price -
        atr5 *
        1.5
      )
      :
      (
        above?.center ??
        price +
        atr5 *
        1.5
      );


  const primaryRaw =
    55 +
    confluence.total *
    0.35 +
    (
      raid.latestConfirmed
        ?
        8
        :
        0
    );


  const reversalRaw =
    45 +
    (
      raid.tracking
        ?.pressure ||
      0
    ) *
    0.25 +
    (
      primaryDirection >
      0
        ?
        (
          below?.strength ||
          40
        )
        :
        (
          above?.strength ||
          40
        )
    ) *
    0.18;


  const rangeRaw =
    55 +
    (
      direction.direction ===
      "NEUTRAL"
        ?
        18
        :
        0
    ) +
    (
      confluence.total <
      65
        ?
        10
        :
        0
    );


  const weights =
    normalizeWeights(
      [

        primaryRaw,

        reversalRaw,

        rangeRaw

      ]
    );


  const step =
    5 *
    60;


  const buildPath =
    values =>
      values.map(
        (
          value,
          index
        ) => ({

          time:
            lastTime +
            step *
            (
              index +
              1
            ),

          value:
            round(
              value,
              3
            )

        })
      );


  const primary =
    buildPath(
      [

        price -
        primaryDirection *
        atr5 *
        0.18,

        price +
        primaryDirection *
        atr5 *
        0.22,

        price +
        (
          primaryTarget -
          price
        ) *
        0.35,

        price +
        (
          primaryTarget -
          price
        ) *
        0.62,

        price +
        (
          primaryTarget -
          price
        ) *
        0.82,

        primaryTarget

      ]
    );


  const reversal =
    buildPath(
      [

        price +
        primaryDirection *
        atr5 *
        0.35,

        price +
        primaryDirection *
        atr5 *
        0.65,

        price,

        price +
        (
          oppositeTarget -
          price
        ) *
        0.35,

        price +
        (
          oppositeTarget -
          price
        ) *
        0.70,

        oppositeTarget

      ]
    );


  const rangeHigh =
    price +
    atr5 *
    0.75;


  const rangeLow =
    price -
    atr5 *
    0.75;


  const range =
    buildPath(
      [

        rangeHigh,

        price,

        rangeLow,

        price,

        rangeHigh *
          0.15 +
        price *
          0.85,

        price

      ]
    );


  return [

    {

      id:
        "A",

      name:
        primaryDirection >
        0
          ?
          "Primary bullish expansion"
          :
          "Primary bearish expansion",

      modelWeightPct:
        round(
          weights[
            0
          ],
          1
        ),

      target:
        round(
          primaryTarget,
          3
        ),

      description:
        "Directional confluence carries price toward the strongest aligned liquidity magnet.",

      points:
        primary

    },


    {

      id:
        "B",

      name:
        "Liquidity fakeout / reversal",

      modelWeightPct:
        round(
          weights[
            1
          ],
          1
        ),

      target:
        round(
          oppositeTarget,
          3
        ),

      description:
        "Price first runs the near-side liquidity, fails, then rotates toward the opposing pool.",

      points:
        reversal

    },


    {

      id:
        "C",

      name:
        "Range continuation",

      modelWeightPct:
        round(
          weights[
            2
          ],
          1
        ),

      target:
        round(
          price,
          3
        ),

      description:
        "No clean displacement develops and price continues rotating around current value.",

      points:
        range

    }

  ].sort(
    (
      a,
      b
    ) =>
      b.modelWeightPct -
      a.modelWeightPct
  );

}


/* ================================================================
   SESSION NARRATIVE
================================================================ */

function sessionNarrative({
  sessions,
  price,
  clusters,
  raid,
  direction
}) {

  const parts =
    [];


  const sessionList =
    [

      sessions.asia,

      sessions.london,

      sessions.newYork

    ].filter(
      Boolean
    );


  for (
    const session
    of sessionList
  ) {

    const above =
      price >
      session.high;


    const below =
      price <
      session.low;


    parts.push(

      `${session.label}: ${
        above
          ?
          "price is above its high"
          :
          below
            ?
            "price is below its low"
            :
            "price remains inside its range"
      }.`

    );

  }


  if (
    raid.latestConfirmed
  ) {

    parts.push(

      `${
        raid
          .latestConfirmed
          .side ===
        "BSL"
          ?
          "Buy-side"
          :
          "Sell-side"
      } liquidity was recently swept; reversal evidence is ${
        raid
          .latestConfirmed
          .reversalEvidence
      }/100.`

    );

  }


  const best =
    clusters[
      0
    ];


  if (
    best
  ) {

    parts.push(

      `Highest-ranked remaining magnet is ${best.side} near ${best.center} with a ${best.magnetScore}/100 magnet score.`

    );

  }


  parts.push(

    `Directional engine is ${direction.direction.toLowerCase()} (${direction.buyScore} buy / ${direction.sellScore} sell).`

  );


  return parts.join(
    " "
  );

}


/* ================================================================
   LIQUIDITY HIERARCHY
================================================================ */

function liquidityHierarchy(
  levels,
  currentPrice
) {

  const timeframeRank =
    {

      W1:
        5,

      D1:
        4,

      H4:
        3.5,

      H1:
        3,

      M15:
        2,

      M5:
        1

    };


  return [
    ...levels
  ]

    .map(
      level => ({

        ...level,

        hierarchyScore:
          round(

            clamp(

              level.weight *
                0.75 +

              (
                timeframeRank[
                  level.timeframe
                ] ||
                1
              ) *
                5 +

              Math.min(
                10,
                (
                  level.touches ||
                  1
                ) *
                2
              ),

              0,

              100

            ),

            1

          ),

        distance:
          round(

            Math.abs(
              level.price -
              currentPrice
            ),

            3

          )

      })
    )

    .sort(
      (
        a,
        b
      ) =>
        b.hierarchyScore -
        a.hierarchyScore
    )

    .slice(
      0,
      16
    );

}


/* ================================================================
   MAIN INTELLIGENCE BUILD
================================================================ */

async function buildFull() {

  const started =
    Date.now();


  const [
    m1Result,
    m5Result,
    m15Result,
    h1Result,
    h4Result,
    macro
  ] =
    await Promise.all(
      [

        fetchSeries(
          "1min",
          CONFIG
            .outputs
            .m1,
          0
        ),

        fetchSeries(
          "5min",
          CONFIG
            .outputs
            .m5,
          2
        ),

        fetchSeries(
          "15min",
          CONFIG
            .outputs
            .m15,
          1
        ),

        fetchSeries(
          "1h",
          CONFIG
            .outputs
            .h1,
          1
        ),

        fetchSeries(
          "4h",
          CONFIG
            .outputs
            .h4,
          1
        ),

        macroContext()

      ]
    );


  const m1 =
    m1Result.candles;


  const m5 =
    m5Result.candles;


  const m15 =
    m15Result.candles;


  const h1 =
    h1Result.candles;


  const h4 =
    h4Result.candles;


  const price =
    m1[
      m1.length -
      1
    ].close;


  const atr5Array =
    atrArray(
      m5,
      14
    );


  const atr15Array =
    atrArray(
      m15,
      14
    );


  const atr5 =
    atr5Array[
      atr5Array.length -
      1
    ] ||
    price *
    0.001;


  const atr15 =
    atr15Array[
      atr15Array.length -
      1
    ] ||
    atr5 *
    2;


  const h1Trend =
    detectTrend(
      h1
    );


  const h4Trend =
    detectTrend(
      h4
    );


  const regime =
    detectRegime(
      m15,
      h1
    );


  const liquidity =
    buildLiquidityLevels(

      m5,

      m15,

      h1,

      atr5,

      atr15

    );


  const combinedTrend =
    h1Trend.bias ===
    h4Trend.bias
      ?
      h1Trend.bias
      :
      h1Trend.bias;


  const clusters =
    clusterLiquidity(

      liquidity.levels,

      price,

      atr5,

      combinedTrend

    );


  const raid =
    buildRaidState(

      clusters,

      m5,

      m1,

      atr5,

      price

    );


  const trap =
    detectTrap(

      raid.latestConfirmed,

      m5,

      atr5

    );


  const phase =
    detectMarketPhase(

      m5,

      raid.latestConfirmed,

      regime

    );


  const history =
    historicalMemory(
      m5
    );


  const direction =
    directionalBias(
      {

        h1Trend,

        regime,

        raid,

        history,

        macro,

        clusters,

        price

      }
    );


  const confluence =
    confluenceScore(
      {

        direction,

        clusters,

        raid,

        trap,

        history,

        macro,

        regime

      }
    );


  const trade =
    tradeIdea(
      {

        price,

        atr5,

        direction,

        confluence,

        raid,

        clusters

      }
    );


  const scenarios =
    scenarioProjection(
      {

        price,

        atr5,

        direction,

        clusters,

        raid,

        confluence,

        lastTime:
          m5[
            m5.length -
            1
          ].time

      }
    );


  const fvgs =
    findFvgs(
      m15,
      atr15
    );


  const hierarchy =
    liquidityHierarchy(
      liquidity.levels,
      price
    );


  const rsi5 =
    rsiArray(
      m5,
      14
    );


  const rsi15 =
    rsiArray(
      m15,
      14
    );


  const freshnessSeconds =
    Math.max(

      0,

      Math.floor(
        Date.now() /
        1000
      ) -
      m1[
        m1.length -
        1
      ].time

    );


  return {

    ok:
      true,

    engine:
      "MKAYFX GOLD INTELLIGENCE V9",

    version:
      "9.0.0",

    symbol:
      SYMBOL,

    generatedAt:
      new Date()
        .toISOString(),

    computationMs:
      Date.now() -
      started,


    data: {

      price:
        round(
          price,
          3
        ),

      lastCandleTime:
        m1[
          m1.length -
          1
        ].time,

      freshnessSeconds,

      atrM5:
        round(
          atr5,
          3
        ),

      atrM15:
        round(
          atr15,
          3
        ),

      rsiM5:
        round(
          rsi5[
            rsi5.length -
            1
          ],
          1
        ),

      rsiM15:
        round(
          rsi15[
            rsi15.length -
            1
          ],
          1
        )

    },


    source: {

      provider:
        "Twelve Data",

      keySlots: {

        m1:
          m1Result.keySlot,

        m5:
          m5Result.keySlot,

        m15:
          m15Result.keySlot,

        h1:
          h1Result.keySlot,

        h4:
          h4Result.keySlot

      },

      fetchMs: {

        m1:
          m1Result.ms,

        m5:
          m5Result.ms,

        m15:
          m15Result.ms,

        h1:
          h1Result.ms,

        h4:
          h4Result.ms

      }

    },


    bias:
      direction,


    regime,


    phase,


    trend: {

      h1:
        h1Trend,

      h4:
        h4Trend

    },


    confluence,


    liquidity: {

      clusters:
        clusters.slice(
          0,
          12
        ),

      hierarchy,

      rawLevels:
        liquidity
          .levels
          .slice(
            0,
            24
          )
          .map(
            level => ({

              ...level,

              price:
                round(
                  level.price,
                  3
                )

            })
          ),

      sessions:
        liquidity.sessions,

      previousDay:
        liquidity.previousDay,

      previousWeek:
        liquidity.previousWeek,

      fvgs

    },


    raid,


    trap,


    historical:
      history,


    macro,


    trade,


    scenarios,


    narrative:
      sessionNarrative(
        {

          sessions:
            liquidity.sessions,

          price,

          clusters,

          raid,

          direction

        }
      ),


    chart: {

      candles:
        m5
          .slice(
            -520
          )
          .map(
            candle => ({

              time:
                candle.time,

              open:
                round(
                  candle.open,
                  3
                ),

              high:
                round(
                  candle.high,
                  3
                ),

              low:
                round(
                  candle.low,
                  3
                ),

              close:
                round(
                  candle.close,
                  3
                )

            })
          ),

      importantClusters:
        clusters.slice(
          0,
          6
        )

    },


    disclaimer:
      "Heuristic market intelligence for research. Scores are not guaranteed probabilities or financial advice."

  };

}


/* ================================================================
   VERCEL FUNCTION
================================================================ */

export default {

  async fetch(
    request
  ) {

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {

          status:
            204,

          headers: {

            "access-control-allow-origin":
              "*",

            "access-control-allow-methods":
              "GET, OPTIONS",

            "access-control-allow-headers":
              "content-type"

          }

        }
      );

    }


    try {

      const url =
        new URL(
          request.url
        );


      const mode =
        url
          .searchParams
          .get(
            "mode"
          ) ||
        "full";


      /* ==========================================================
         FAST PRICE MODE
      ========================================================== */

      if (
        mode ===
        "quote"
      ) {

        const quote =
          await fetchLatestPrice();


        return json(
          {

            ok:
              true,

            symbol:
              SYMBOL,

            price:
              round(
                quote.price,
                3
              ),

            generatedAt:
              new Date()
                .toISOString(),

            keySlot:
              quote.keySlot,

            fetchMs:
              quote.ms

          },
          200,
          "no-store"
        );

      }


      /* ==========================================================
         FULL INTELLIGENCE MODE
      ========================================================== */

      const result =
        await buildFull();


      return json(
        result,
        200,
        "public, s-maxage=45, stale-while-revalidate=20"
      );

    }

    catch (
      error
    ) {

      return json(
        {

          ok:
            false,

          error:
            error?.message ||
            "Unknown server error",

          generatedAt:
            new Date()
              .toISOString()

        },
        500,
        "no-store"
      );

    }

  }

};