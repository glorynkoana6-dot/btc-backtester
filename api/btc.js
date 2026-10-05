/* ============================================================
   MKAYFX BTC VOLUME PROFILE INTELLIGENCE V3.1
   /api/btc.js

   V3.1 REJECTION QUALITY UPDATE
   -----------------------------
   - Stronger VAH / VAL rejection validation
   - Stricter POC reclaim / rejection
   - Current trigger candle must interact with level
   - Displacement confirmation
   - Relative-volume confirmation
   - RSI momentum confirmation
   - HTF disagreement penalty
   - Setup-specific qualification

   SOURCE
   ------
   Coinbase Exchange public API

   PRODUCT
   -------
   BTC-USD

   NO API KEY REQUIRED
============================================================ */

const PRODUCT = "BTC-USD";
const BASE_URL = "https://api.exchange.coinbase.com";

const SETTINGS = {
  profileBins: 42,
  valueAreaPercent: 0.70,
  minimumProfileBars: 8,

  atrPeriod: 14,
  rsiPeriod: 14,

  h1FastEMA: 50,
  h1SlowEMA: 200,

  h4FastEMA: 20,
  h4SlowEMA: 50,

  minimumBodyPercent: 0.42,
  minimumRejectionWick: 0.12,

  valueRejectionBody: 0.44,
  valueRejectionWick: 0.16,
  valueCloseLocation: 0.68,

  pocBody: 0.46,
  pocWick: 0.12,
  pocCloseLocation: 0.66,

  displacementATR: 0.08,

  volumeLookback: 20,
  minimumRelativeVolume: 0.82,
  pocRelativeVolume: 0.95,

  rsiMomentumBars: 2,

  maxDistanceATR: 1.10,

  buyRsiMin: 48,
  buyRsiMax: 72,

  sellRsiMin: 28,
  sellRsiMax: 52,

  minimumATRPercent: 0.08,
  maximumATRPercent: 3.50,

  stopATR: 1.00,
  structureBufferATR: 0.12,
  targetR: 1.50,

  htfConflictPenalty: 8,

  modeScores: {
    RAW: 48,
    BALANCED: 60,
    SELECTIVE: 72
  },

  setupExtraScore: {
    RAW: {
      VALUE: 0,
      POC: 0,
      VWAP: 0
    },

    BALANCED: {
      VALUE: 0,
      POC: 3,
      VWAP: 0
    },

    SELECTIVE: {
      VALUE: 2,
      POC: 5,
      VWAP: 2
    }
  }
};


/* ============================================================
   HELPERS
============================================================ */

function number(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return null;
  }

  const p =
    10 ** digits;

  return (
    Math.round(
      Number(value) *
      p
    ) /
    p
  );
}

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.max(
    minimum,
    Math.min(
      maximum,
      value
    )
  );
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (total, value) =>
        total +
        value,
      0
    ) /
    values.length
  );
}

function errorText(error) {
  if (error instanceof Error) {
    return (
      error.message ||
      error.name ||
      "Unknown error"
    );
  }

  if (
    typeof error === "string"
  ) {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}


/* ============================================================
   HTTP
============================================================ */

async function getJSON(
  url,
  timeoutMs = 8000
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
          method: "GET",
          cache: "no-store",

          headers: {
            Accept:
              "application/json",

            "User-Agent":
              "MKAYFX-BTC-VOLUME-PROFILE-V3.1"
          },

          signal:
            controller.signal
        }
      );

    const raw =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(raw);
    } catch {
      throw new Error(
        `Coinbase returned invalid JSON (${response.status})`
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
        `Coinbase HTTP ${response.status}`
      );
    }

    return data;

  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "Coinbase request timed out"
      );
    }

    throw new Error(
      errorText(error)
    );

  } finally {
    clearTimeout(timer);
  }
}


/* ============================================================
   COINBASE CANDLES
============================================================ */

async function fetchCandles(
  granularity
) {
  const data =
    await getJSON(
      `${BASE_URL}/products/${PRODUCT}/candles` +
      `?granularity=${granularity}`
    );

  if (!Array.isArray(data)) {
    throw new Error(
      "Coinbase candle response was not an array"
    );
  }

  const candles =
    data
      .map(row => ({
        timestamp:
          Number(row[0]) *
          1000,

        datetime:
          new Date(
            Number(row[0]) *
            1000
          ).toISOString(),

        low:
          Number(row[1]),

        high:
          Number(row[2]),

        open:
          Number(row[3]),

        close:
          Number(row[4]),

        volume:
          Number(row[5])
      }))
      .filter(candle =>
        candle.timestamp > 0 &&
        candle.open > 0 &&
        candle.high > 0 &&
        candle.low > 0 &&
        candle.close > 0
      )
      .sort(
        (a, b) =>
          a.timestamp -
          b.timestamp
      );

  if (candles.length > 2) {
    candles.pop();
  }

  return candles;
}


/* ============================================================
   TICKER
============================================================ */

async function fetchTicker() {
  return getJSON(
    `${BASE_URL}/products/${PRODUCT}/ticker`
  );
}


/* ============================================================
   EMA
============================================================ */

function ema(values, period) {
  const output =
    new Array(values.length)
      .fill(null);

  if (
    values.length <
    period
  ) {
    return output;
  }

  let total = 0;

  for (
    let i = 0;
    i < period;
    i++
  ) {
    total += values[i];
  }

  let current =
    total /
    period;

  output[period - 1] =
    current;

  const multiplier =
    2 /
    (period + 1);

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    current =
      (
        values[i] -
        current
      ) *
      multiplier +
      current;

    output[i] =
      current;
  }

  return output;
}


/* ============================================================
   RSI
============================================================ */

function rsi(values, period) {
  const output =
    new Array(values.length)
      .fill(null);

  if (
    values.length <=
    period
  ) {
    return output;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    const change =
      values[i] -
      values[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses +=
        Math.abs(change);
    }
  }

  let avgGain =
    gains /
    period;

  let avgLoss =
    losses /
    period;

  output[period] =
    avgLoss === 0
      ? 100
      : 100 -
        100 /
        (
          1 +
          avgGain /
          avgLoss
        );

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {
    const change =
      values[i] -
      values[i - 1];

    const gain =
      Math.max(
        change,
        0
      );

    const loss =
      Math.max(
        -change,
        0
      );

    avgGain =
      (
        avgGain *
        (period - 1) +
        gain
      ) /
      period;

    avgLoss =
      (
        avgLoss *
        (period - 1) +
        loss
      ) /
      period;

    output[i] =
      avgLoss === 0
        ? 100
        : 100 -
          100 /
          (
            1 +
            avgGain /
            avgLoss
          );
  }

  return output;
}


/* ============================================================
   ATR
============================================================ */

function atr(candles, period) {
  const output =
    new Array(candles.length)
      .fill(null);

  if (
    candles.length <=
    period
  ) {
    return output;
  }

  const ranges =
    new Array(candles.length)
      .fill(null);

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    ranges[i] =
      Math.max(
        candles[i].high -
          candles[i].low,

        Math.abs(
          candles[i].high -
          candles[i - 1].close
        ),

        Math.abs(
          candles[i].low -
          candles[i - 1].close
        )
      );
  }

  let total = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    total += ranges[i];
  }

  let current =
    total /
    period;

  output[period] =
    current;

  for (
    let i = period + 1;
    i < candles.length;
    i++
  ) {
    current =
      (
        current *
        (period - 1) +
        ranges[i]
      ) /
      period;

    output[i] =
      current;
  }

  return output;
}


/* ============================================================
   H1 -> H4
============================================================ */

function buildH4(h1) {
  const interval =
    4 *
    60 *
    60 *
    1000;

  const map =
    new Map();

  for (const candle of h1) {
    const key =
      Math.floor(
        candle.timestamp /
        interval
      ) *
      interval;

    if (!map.has(key)) {
      map.set(
        key,
        {
          timestamp:
            key,

          closeTime:
            key +
            interval,

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close,

          volume:
            candle.volume
        }
      );

    } else {
      const bar =
        map.get(key);

      bar.high =
        Math.max(
          bar.high,
          candle.high
        );

      bar.low =
        Math.min(
          bar.low,
          candle.low
        );

      bar.close =
        candle.close;

      bar.volume +=
        candle.volume;
    }
  }

  return [...map.values()]
    .sort(
      (a, b) =>
        a.timestamp -
        b.timestamp
    )
    .filter(
      bar =>
        bar.closeTime <=
        Date.now()
    );
}


/* ============================================================
   SESSION INFO
============================================================ */

function sessionInfo(timestamp) {
  const date =
    new Date(timestamp);

  const midnight =
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate()
    );

  const hour =
    date.getUTCHours();

  if (hour < 8) {
    return {
      name: "ASIA",
      start: midnight,
      end:
        midnight +
        8 * 3600000
    };
  }

  if (hour < 13) {
    return {
      name: "LONDON",
      start:
        midnight +
        8 * 3600000,

      end:
        midnight +
        13 * 3600000
    };
  }

  if (hour < 21) {
    return {
      name: "NEW YORK",
      start:
        midnight +
        13 * 3600000,

      end:
        midnight +
        21 * 3600000
    };
  }

  return {
    name: "LATE",

    start:
      midnight +
      21 * 3600000,

    end:
      midnight +
      24 * 3600000
  };
}


/* ============================================================
   GROUP SESSIONS
============================================================ */

function groupSessions(candles) {
  const groups = [];
  let current = null;

  for (const candle of candles) {
    const session =
      sessionInfo(
        candle.timestamp
      );

    const key =
      `${session.start}:${session.name}`;

    if (
      !current ||
      current.key !== key
    ) {
      current = {
        key,

        name:
          session.name,

        start:
          session.start,

        end:
          session.end,

        candles: []
      };

      groups.push(current);
    }

    current.candles.push(
      candle
    );
  }

  return groups;
}


/* ============================================================
   VOLUME PROFILE
============================================================ */

function buildVolumeProfile(
  candles,
  binsCount =
    SETTINGS.profileBins
) {
  if (
    !candles ||
    candles.length <
    SETTINGS.minimumProfileBars
  ) {
    return null;
  }

  const low =
    Math.min(
      ...candles.map(
        candle =>
          candle.low
      )
    );

  const high =
    Math.max(
      ...candles.map(
        candle =>
          candle.high
      )
    );

  const range =
    high -
    low;

  if (range <= 0) {
    return null;
  }

  const binSize =
    range /
    binsCount;

  const bins =
    Array.from(
      {
        length:
          binsCount
      },
      (_, index) => ({
        index,

        low:
          low +
          index *
          binSize,

        high:
          low +
          (
            index +
            1
          ) *
          binSize,

        price:
          low +
          (
            index +
            0.5
          ) *
          binSize,

        volume: 0
      })
    );

  for (const candle of candles) {
    const first =
      clamp(
        Math.floor(
          (
            candle.low -
            low
          ) /
          binSize
        ),
        0,
        binsCount - 1
      );

    const last =
      clamp(
        Math.floor(
          (
            candle.high -
            low
          ) /
          binSize
        ),
        0,
        binsCount - 1
      );

    const touched =
      Math.max(
        1,
        last -
        first +
        1
      );

    const typicalPrice =
      (
        candle.high +
        candle.low +
        candle.close
      ) /
      3;

    let typicalIndex =
      Math.floor(
        (
          typicalPrice -
          low
        ) /
        binSize
      );

    typicalIndex =
      clamp(
        typicalIndex,
        0,
        binsCount - 1
      );

    const spreadVolume =
      candle.volume *
      0.70;

    const concentratedVolume =
      candle.volume *
      0.30;

    const perBin =
      spreadVolume /
      touched;

    for (
      let index = first;
      index <= last;
      index++
    ) {
      bins[index].volume +=
        perBin;
    }

    bins[
      typicalIndex
    ].volume +=
      concentratedVolume;
  }

  const totalVolume =
    bins.reduce(
      (total, bin) =>
        total +
        bin.volume,
      0
    );

  if (totalVolume <= 0) {
    return null;
  }

  let pocIndex = 0;

  for (
    let i = 1;
    i < bins.length;
    i++
  ) {
    if (
      bins[i].volume >
      bins[pocIndex].volume
    ) {
      pocIndex = i;
    }
  }

  const targetVolume =
    totalVolume *
    SETTINGS.valueAreaPercent;

  let includedVolume =
    bins[pocIndex].volume;

  let lowIndex =
    pocIndex;

  let highIndex =
    pocIndex;

  while (
    includedVolume <
      targetVolume &&
    (
      lowIndex > 0 ||
      highIndex <
        bins.length - 1
    )
  ) {
    const lowerVolume =
      lowIndex > 0
        ? bins[
            lowIndex - 1
          ].volume
        : -1;

    const upperVolume =
      highIndex <
      bins.length - 1
        ? bins[
            highIndex + 1
          ].volume
        : -1;

    if (
      upperVolume >=
      lowerVolume
    ) {
      if (
        highIndex <
        bins.length - 1
      ) {
        highIndex++;

        includedVolume +=
          bins[
            highIndex
          ].volume;

      } else {
        lowIndex--;

        includedVolume +=
          bins[
            lowIndex
          ].volume;
      }

    } else {
      if (lowIndex > 0) {
        lowIndex--;

        includedVolume +=
          bins[
            lowIndex
          ].volume;

      } else {
        highIndex++;

        includedVolume +=
          bins[
            highIndex
          ].volume;
      }
    }
  }

  return {
    low,
    high,
    binSize,
    totalVolume,

    poc:
      bins[pocIndex].price,

    val:
      bins[lowIndex].low,

    vah:
      bins[highIndex].high,

    bins
  };
}


/* ============================================================
   VWAP
============================================================ */

function calculateVWAP(candles) {
  let totalVolume = 0;
  let priceVolume = 0;

  for (const candle of candles) {
    const typical =
      (
        candle.high +
        candle.low +
        candle.close
      ) /
      3;

    priceVolume +=
      typical *
      candle.volume;

    totalVolume +=
      candle.volume;
  }

  if (totalVolume <= 0) {
    return null;
  }

  return (
    priceVolume /
    totalVolume
  );
}


/* ============================================================
   NAKED POC
============================================================ */

function findNakedPOCs(
  sessions,
  currentPrice
) {
  const naked = [];

  for (
    let i = 0;
    i < sessions.length - 1;
    i++
  ) {
    const session =
      sessions[i];

    const profile =
      buildVolumeProfile(
        session.candles
      );

    if (!profile) {
      continue;
    }

    const poc =
      profile.poc;

    let tested = false;

    for (
      let j = i + 1;
      j < sessions.length;
      j++
    ) {
      for (
        const candle of
        sessions[j].candles
      ) {
        if (
          candle.low <= poc &&
          candle.high >= poc
        ) {
          tested = true;
          break;
        }
      }

      if (tested) {
        break;
      }
    }

    if (!tested) {
      naked.push({
        session:
          session.name,

        timestamp:
          session.start,

        poc,

        distance:
          Math.abs(
            currentPrice -
            poc
          )
      });
    }
  }

  return naked
    .sort(
      (a, b) =>
        a.distance -
        b.distance
    )
    .slice(0, 8);
}


/* ============================================================
   CANDLE METRICS
============================================================ */

function candleMetrics(candle) {
  const range =
    candle.high -
    candle.low;

  if (range <= 0) {
    return {
      body: 0,
      lowerWick: 0,
      upperWick: 0,
      closeLocation: 0.5
    };
  }

  const bodyHigh =
    Math.max(
      candle.open,
      candle.close
    );

  const bodyLow =
    Math.min(
      candle.open,
      candle.close
    );

  return {
    body:
      Math.abs(
        candle.close -
        candle.open
      ) /
      range,

    lowerWick:
      (
        bodyLow -
        candle.low
      ) /
      range,

    upperWick:
      (
        candle.high -
        bodyHigh
      ) /
      range,

    closeLocation:
      (
        candle.close -
        candle.low
      ) /
      range
  };
}


/* ============================================================
   RELATIVE VOLUME
============================================================ */

function relativeVolume(
  candles,
  index,
  lookback
) {
  const start =
    Math.max(
      0,
      index -
      lookback
    );

  const prior =
    candles
      .slice(
        start,
        index
      )
      .map(
        candle =>
          candle.volume
      )
      .filter(
        value =>
          Number.isFinite(value)
      );

  if (!prior.length) {
    return 1;
  }

  const baseline =
    average(prior);

  if (baseline <= 0) {
    return 1;
  }

  return (
    candles[index].volume /
    baseline
  );
}


/* ============================================================
   LEVEL INTERACTION
============================================================ */

function interacts(
  candle,
  level,
  tolerance
) {
  return (
    candle.low <=
      level +
      tolerance &&
    candle.high >=
      level -
      tolerance
  );
}


/* ============================================================
   MARKET STATE
============================================================ */

function buildMarketState({
  price,
  previousProfile,
  developingProfile,
  sessionVWAP,
  h1Bullish,
  h1Bearish,
  h4Bullish,
  h4Bearish,
  nearestNakedPOC,
  atrValue
}) {
  let bullish = 0;
  let bearish = 0;

  const bullishReasons = [];
  const bearishReasons = [];

  if (h4Bullish) {
    bullish += 18;
    bullishReasons.push(
      "H4 bullish"
    );
  }

  if (h4Bearish) {
    bearish += 18;
    bearishReasons.push(
      "H4 bearish"
    );
  }

  if (h1Bullish) {
    bullish += 18;
    bullishReasons.push(
      "H1 bullish"
    );
  }

  if (h1Bearish) {
    bearish += 18;
    bearishReasons.push(
      "H1 bearish"
    );
  }

  if (developingProfile) {
    if (
      price >
      developingProfile.poc
    ) {
      bullish += 12;

      bullishReasons.push(
        "Price above developing POC"
      );

    } else {
      bearish += 12;

      bearishReasons.push(
        "Price below developing POC"
      );
    }

    if (
      price >
      developingProfile.vah
    ) {
      bullish += 8;

      bullishReasons.push(
        "Price above developing value"
      );
    }

    if (
      price <
      developingProfile.val
    ) {
      bearish += 8;

      bearishReasons.push(
        "Price below developing value"
      );
    }
  }

  if (previousProfile) {
    if (
      price >
      previousProfile.poc
    ) {
      bullish += 8;
    } else {
      bearish += 8;
    }
  }

  if (
    Number.isFinite(
      sessionVWAP
    )
  ) {
    if (
      price >
      sessionVWAP
    ) {
      bullish += 12;

      bullishReasons.push(
        "Price above session VWAP"
      );

    } else {
      bearish += 12;

      bearishReasons.push(
        "Price below session VWAP"
      );
    }
  }

  if (
    nearestNakedPOC &&
    atrValue > 0
  ) {
    const distanceATR =
      nearestNakedPOC.distance /
      atrValue;

    if (distanceATR <= 2) {
      if (
        nearestNakedPOC.poc >
        price
      ) {
        bullish += 5;

        bullishReasons.push(
          "Untested POC above may act as magnet"
        );

      } else {
        bearish += 5;

        bearishReasons.push(
          "Untested POC below may act as magnet"
        );
      }
    }
  }

  let bias = "NEUTRAL";

  const gap =
    Math.abs(
      bullish -
      bearish
    );

  if (
    bullish > bearish &&
    gap >= 12
  ) {
    bias = "BULLISH";
  }

  if (
    bearish > bullish &&
    gap >= 12
  ) {
    bias = "BEARISH";
  }

  let strength = "WEAK";

  const best =
    Math.max(
      bullish,
      bearish
    );

  if (best >= 55) {
    strength = "STRONG";
  } else if (
    best >= 38
  ) {
    strength = "MODERATE";
  }

  return {
    bias,
    strength,

    bullishScore:
      bullish,

    bearishScore:
      bearish,

    gap,
    bullishReasons,
    bearishReasons
  };
}


/* ============================================================
   MAIN
============================================================ */

module.exports =
async function handler(
  req,
  res
) {
  const started =
    Date.now();

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  try {
    const requestedMode =
      String(
        req.query?.mode ||
        "BALANCED"
      ).toUpperCase();

    const mode =
      SETTINGS.modeScores[
        requestedMode
      ]
        ? requestedMode
        : "BALANCED";

    const minimumScore =
      SETTINGS.modeScores[
        mode
      ];

    const [
      m5,
      h1,
      ticker
    ] =
      await Promise.all([
        fetchCandles(300),
        fetchCandles(3600),
        fetchTicker()
      ]);

    if (m5.length < 80) {
      throw new Error(
        `Only ${m5.length} M5 candles available`
      );
    }

    if (h1.length < 210) {
      throw new Error(
        `Only ${h1.length} H1 candles available`
      );
    }

    const h4 =
      buildH4(h1);

    if (h4.length < 50) {
      throw new Error(
        "Not enough completed H4 history"
      );
    }

    const price =
      number(
        ticker?.price,
        m5.at(-1).close
      );

    /* ======================================================
       M5
    ====================================================== */

    const m5Close =
      m5.map(
        candle =>
          candle.close
      );

    const m5RSI =
      rsi(
        m5Close,
        SETTINGS.rsiPeriod
      );

    const m5ATR =
      atr(
        m5,
        SETTINGS.atrPeriod
      );

    const mi =
      m5.length - 1;

    const rsiNow =
      m5RSI[mi];

    const atrNow =
      m5ATR[mi];

    if (
      !Number.isFinite(atrNow) ||
      atrNow <= 0 ||
      !Number.isFinite(rsiNow)
    ) {
      throw new Error(
        "M5 indicators are not ready"
      );
    }

    /* ======================================================
       H1
    ====================================================== */

    const h1Close =
      h1.map(
        candle =>
          candle.close
      );

    const h1EMA50 =
      ema(
        h1Close,
        SETTINGS.h1FastEMA
      );

    const h1EMA200 =
      ema(
        h1Close,
        SETTINGS.h1SlowEMA
      );

    const hi =
      h1.length - 1;

    const h1Bullish =
      h1[hi].close >
        h1EMA200[hi] &&
      h1EMA50[hi] >
        h1EMA200[hi];

    const h1Bearish =
      h1[hi].close <
        h1EMA200[hi] &&
      h1EMA50[hi] <
        h1EMA200[hi];

    /* ======================================================
       H4
    ====================================================== */

    const h4Close =
      h4.map(
        candle =>
          candle.close
      );

    const h4EMA20 =
      ema(
        h4Close,
        SETTINGS.h4FastEMA
      );

    const h4EMA50 =
      ema(
        h4Close,
        SETTINGS.h4SlowEMA
      );

    const h4i =
      h4.length - 1;

    const h4Bullish =
      h4EMA20[h4i] >
        h4EMA50[h4i] &&
      h4[h4i].close >
        h4EMA20[h4i];

    const h4Bearish =
      h4EMA20[h4i] <
        h4EMA50[h4i] &&
      h4[h4i].close <
        h4EMA20[h4i];

    /* ======================================================
       SESSION
    ====================================================== */

    const sessions =
      groupSessions(m5);

    if (sessions.length < 2) {
      throw new Error(
        "Not enough session history"
      );
    }

    const currentSession =
      sessions.at(-1);

    const previousSession =
      sessions.at(-2);

    const developingProfile =
      buildVolumeProfile(
        currentSession.candles
      );

    const previousProfile =
      buildVolumeProfile(
        previousSession.candles
      );

    if (!developingProfile) {
      throw new Error(
        "Developing profile is not ready"
      );
    }

    const sessionVWAP =
      calculateVWAP(
        currentSession.candles
      );

    const nakedPOCs =
      findNakedPOCs(
        sessions,
        price
      );

    const nearestNakedPOC =
      nakedPOCs[0] ||
      null;

    /* ======================================================
       STATE
    ====================================================== */

    const state =
      buildMarketState({
        price:
          m5.at(-1).close,

        previousProfile,
        developingProfile,
        sessionVWAP,

        h1Bullish,
        h1Bearish,
        h4Bullish,
        h4Bearish,

        nearestNakedPOC,

        atrValue:
          atrNow
      });

    /* ======================================================
       TRIGGER
    ====================================================== */

    const candle =
      m5.at(-1);

    const metrics =
      candleMetrics(candle);

    const tolerance =
      atrNow *
      0.15;

    const relativeVol =
      relativeVolume(
        m5,
        mi,
        SETTINGS.volumeLookback
      );

    const volumeOK =
      relativeVol >=
      SETTINGS.minimumRelativeVolume;

    const pocVolumeOK =
      relativeVol >=
      SETTINGS.pocRelativeVolume;

    const momentumIndex =
      mi -
      SETTINGS.rsiMomentumBars;

    const bullishRSIMomentum =
      momentumIndex >= 0 &&
      Number.isFinite(
        m5RSI[momentumIndex]
      ) &&
      rsiNow >
        m5RSI[momentumIndex];

    const bearishRSIMomentum =
      momentumIndex >= 0 &&
      Number.isFinite(
        m5RSI[momentumIndex]
      ) &&
      rsiNow <
        m5RSI[momentumIndex];

    const buyRSIOK =
      rsiNow >=
        SETTINGS.buyRsiMin &&
      rsiNow <=
        SETTINGS.buyRsiMax;

    const sellRSIOK =
      rsiNow >=
        SETTINGS.sellRsiMin &&
      rsiNow <=
        SETTINGS.sellRsiMax;

    const bullishRejection =
      candle.close >
        candle.open &&
      metrics.body >=
        SETTINGS.minimumBodyPercent &&
      metrics.lowerWick >=
        SETTINGS.minimumRejectionWick &&
      metrics.closeLocation >=
        0.65;

    const bearishRejection =
      candle.close <
        candle.open &&
      metrics.body >=
        SETTINGS.minimumBodyPercent &&
      metrics.upperWick >=
        SETTINGS.minimumRejectionWick &&
      metrics.closeLocation <=
        0.35;

    /* ======================================================
       VALUE AREA
    ====================================================== */

    const currentTouchesVAL =
      interacts(
        candle,
        developingProfile.val,
        tolerance
      );

    const currentTouchesVAH =
      interacts(
        candle,
        developingProfile.vah,
        tolerance
      );

    const currentTouchesPOC =
      interacts(
        candle,
        developingProfile.poc,
        tolerance
      );

    const currentTouchesVWAP =
      interacts(
        candle,
        sessionVWAP,
        tolerance
      );

    const valDisplacement =
      (
        candle.close -
        developingProfile.val
      ) /
      atrNow;

    const vahDisplacement =
      (
        developingProfile.vah -
        candle.close
      ) /
      atrNow;

    const validVALRejection =
      currentTouchesVAL &&
      candle.close >
        developingProfile.val &&
      candle.close >
        candle.open &&
      metrics.body >=
        SETTINGS.valueRejectionBody &&
      metrics.lowerWick >=
        SETTINGS.valueRejectionWick &&
      metrics.closeLocation >=
        SETTINGS.valueCloseLocation &&
      valDisplacement >=
        SETTINGS.displacementATR &&
      volumeOK &&
      bullishRSIMomentum;

    const validVAHRejection =
      currentTouchesVAH &&
      candle.close <
        developingProfile.vah &&
      candle.close <
        candle.open &&
      metrics.body >=
        SETTINGS.valueRejectionBody &&
      metrics.upperWick >=
        SETTINGS.valueRejectionWick &&
      metrics.closeLocation <=
        (
          1 -
          SETTINGS.valueCloseLocation
        ) &&
      vahDisplacement >=
        SETTINGS.displacementATR &&
      volumeOK &&
      bearishRSIMomentum;

    /* ======================================================
       POC
    ====================================================== */

    const pocBuyDisplacement =
      (
        candle.close -
        developingProfile.poc
      ) /
      atrNow;

    const pocSellDisplacement =
      (
        developingProfile.poc -
        candle.close
      ) /
      atrNow;

    const validPOCReclaim =
      currentTouchesPOC &&
      candle.close >
        developingProfile.poc &&
      candle.close >
        candle.open &&
      metrics.body >=
        SETTINGS.pocBody &&
      metrics.lowerWick >=
        SETTINGS.pocWick &&
      metrics.closeLocation >=
        SETTINGS.pocCloseLocation &&
      pocBuyDisplacement >=
        SETTINGS.displacementATR &&
      pocVolumeOK &&
      bullishRSIMomentum;

    const validPOCRejection =
      currentTouchesPOC &&
      candle.close <
        developingProfile.poc &&
      candle.close <
        candle.open &&
      metrics.body >=
        SETTINGS.pocBody &&
      metrics.upperWick >=
        SETTINGS.pocWick &&
      metrics.closeLocation <=
        (
          1 -
          SETTINGS.pocCloseLocation
        ) &&
      pocSellDisplacement >=
        SETTINGS.displacementATR &&
      pocVolumeOK &&
      bearishRSIMomentum;

    /* ======================================================
       VWAP
    ====================================================== */

    const validVWAPReclaim =
      currentTouchesVWAP &&
      candle.close >
        sessionVWAP &&
      bullishRejection &&
      volumeOK;

    const validVWAPRejection =
      currentTouchesVWAP &&
      candle.close <
        sessionVWAP &&
      bearishRejection &&
      volumeOK;

    /* ======================================================
       SCORE + SETUP
    ====================================================== */

    let buyScore =
      state.bullishScore;

    let sellScore =
      state.bearishScore;

    const buyReasons =
      [...state.bullishReasons];

    const sellReasons =
      [...state.bearishReasons];

    let buySetup = null;
    let sellSetup = null;

    if (validVALRejection) {
      buySetup =
        "VAL REJECTION";

      buyScore += 14;

      buyReasons.push(
        "Qualified VAL rejection"
      );

    } else if (
      validPOCReclaim
    ) {
      buySetup =
        "POC RECLAIM";

      buyScore += 12;

      buyReasons.push(
        "Qualified POC reclaim"
      );

    } else if (
      validVWAPReclaim
    ) {
      buySetup =
        "VWAP RECLAIM";

      buyScore += 10;

      buyReasons.push(
        "Qualified VWAP reclaim"
      );
    }

    if (validVAHRejection) {
      sellSetup =
        "VAH REJECTION";

      sellScore += 14;

      sellReasons.push(
        "Qualified VAH rejection"
      );

    } else if (
      validPOCRejection
    ) {
      sellSetup =
        "POC REJECTION";

      sellScore += 12;

      sellReasons.push(
        "Qualified POC rejection"
      );

    } else if (
      validVWAPRejection
    ) {
      sellSetup =
        "VWAP REJECTION";

      sellScore += 10;

      sellReasons.push(
        "Qualified VWAP rejection"
      );
    }

    if (buyRSIOK) {
      buyScore += 5;
    }

    if (sellRSIOK) {
      sellScore += 5;
    }

    if (
      relativeVol >= 1.15
    ) {
      if (buySetup) {
        buyScore += 4;

        buyReasons.push(
          "Strong relative M5 volume"
        );
      }

      if (sellSetup) {
        sellScore += 4;

        sellReasons.push(
          "Strong relative M5 volume"
        );
      }

    } else if (
      relativeVol >= 1
    ) {
      if (buySetup) {
        buyScore += 2;
      }

      if (sellSetup) {
        sellScore += 2;
      }
    }

    const buyHTFConflict =
      h1Bearish ||
      h4Bearish;

    const sellHTFConflict =
      h1Bullish ||
      h4Bullish;

    if (buyHTFConflict) {
      buyScore -=
        SETTINGS.htfConflictPenalty;

      buyReasons.push(
        "HTF conflict penalty"
      );
    }

    if (sellHTFConflict) {
      sellScore -=
        SETTINGS.htfConflictPenalty;

      sellReasons.push(
        "HTF conflict penalty"
      );
    }

    buyScore =
      clamp(
        buyScore,
        0,
        100
      );

    sellScore =
      clamp(
        sellScore,
        0,
        100
      );

    /* ======================================================
       FILTERS
    ====================================================== */

    const atrPercent =
      atrNow /
      candle.close *
      100;

    const volatilityOK =
      atrPercent >=
        SETTINGS.minimumATRPercent &&
      atrPercent <=
        SETTINGS.maximumATRPercent;

    function setupLevel(setup) {
      if (
        setup ===
        "VAL REJECTION"
      ) {
        return developingProfile.val;
      }

      if (
        setup ===
        "VAH REJECTION"
      ) {
        return developingProfile.vah;
      }

      if (
        setup ===
        "POC RECLAIM" ||
        setup ===
        "POC REJECTION"
      ) {
        return developingProfile.poc;
      }

      if (
        setup ===
        "VWAP RECLAIM" ||
        setup ===
        "VWAP REJECTION"
      ) {
        return sessionVWAP;
      }

      return null;
    }

    function extraThreshold(setup) {
      if (
        setup ===
        "POC RECLAIM" ||
        setup ===
        "POC REJECTION"
      ) {
        return (
          SETTINGS
            .setupExtraScore[
              mode
            ]
            .POC
        );
      }

      if (
        setup ===
        "VAL REJECTION" ||
        setup ===
        "VAH REJECTION"
      ) {
        return (
          SETTINGS
            .setupExtraScore[
              mode
            ]
            .VALUE
        );
      }

      return (
        SETTINGS
          .setupExtraScore[
            mode
          ]
          .VWAP
      );
    }

    const buyReference =
      setupLevel(
        buySetup
      );

    const sellReference =
      setupLevel(
        sellSetup
      );

    const buyDistanceATR =
      Number.isFinite(
        buyReference
      )
        ? Math.abs(
            candle.close -
            buyReference
          ) /
          atrNow
        : 999;

    const sellDistanceATR =
      Number.isFinite(
        sellReference
      )
        ? Math.abs(
            candle.close -
            sellReference
          ) /
          atrNow
        : 999;

    const buyThreshold =
      minimumScore +
      extraThreshold(
        buySetup
      );

    const sellThreshold =
      minimumScore +
      extraThreshold(
        sellSetup
      );

    /* ======================================================
       SIGNAL
    ====================================================== */

    let signal = "WAIT";
    let setup = null;

    if (
      buySetup &&
      buyScore >=
        buyThreshold &&
      buyScore >
        sellScore + 8 &&
      state.bias !==
        "BEARISH" &&
      buyRSIOK &&
      volatilityOK &&
      buyDistanceATR <=
        SETTINGS.maxDistanceATR
    ) {
      signal = "BUY";
      setup = buySetup;
    }

    if (
      sellSetup &&
      sellScore >=
        sellThreshold &&
      sellScore >
        buyScore + 8 &&
      state.bias !==
        "BULLISH" &&
      sellRSIOK &&
      volatilityOK &&
      sellDistanceATR <=
        SETTINGS.maxDistanceATR
    ) {
      signal = "SELL";
      setup = sellSetup;
    }

    /* ======================================================
       TRADE LEVELS
    ====================================================== */

    let entry = null;
    let stopLoss = null;
    let target = null;
    let riskDistance = null;

    if (
      signal !== "WAIT"
    ) {
      entry =
        candle.close;

      const recent =
        m5.slice(-5);

      if (
        signal === "BUY"
      ) {
        const recentLow =
          Math.min(
            ...recent.map(
              bar =>
                bar.low
            )
          );

        const atrStop =
          entry -
          atrNow *
          SETTINGS.stopATR;

        const structuralStop =
          recentLow -
          atrNow *
          SETTINGS.structureBufferATR;

        stopLoss =
          Math.min(
            atrStop,
            structuralStop
          );

        riskDistance =
          entry -
          stopLoss;

        target =
          entry +
          riskDistance *
          SETTINGS.targetR;

      } else {
        const recentHigh =
          Math.max(
            ...recent.map(
              bar =>
                bar.high
            )
          );

        const atrStop =
          entry +
          atrNow *
          SETTINGS.stopATR;

        const structuralStop =
          recentHigh +
          atrNow *
          SETTINGS.structureBufferATR;

        stopLoss =
          Math.max(
            atrStop,
            structuralStop
          );

        riskDistance =
          stopLoss -
          entry;

        target =
          entry -
          riskDistance *
          SETTINGS.targetR;
      }
    }

    /* ======================================================
       DISPLAY STATE
    ====================================================== */

    let valueState =
      "UNKNOWN";

    if (
      price >
      developingProfile.vah
    ) {
      valueState =
        "ABOVE VALUE";

    } else if (
      price <
      developingProfile.val
    ) {
      valueState =
        "BELOW VALUE";

    } else {
      valueState =
        "INSIDE VALUE";
    }

    const pocState =
      price >
      developingProfile.poc
        ? "PRICE ABOVE POC"
        : "PRICE BELOW POC";

    const vwapState =
      price >
      sessionVWAP
        ? "ABOVE VWAP"
        : "BELOW VWAP";

    const conflict =
      Math.abs(
        buyScore -
        sellScore
      ) < 12
        ? "HIGH"

        : Math.abs(
            buyScore -
            sellScore
          ) < 25
          ? "MEDIUM"
          : "LOW";

    const guidance =
      signal !== "WAIT"
        ? `${signal} ${setup}`

        : conflict === "HIGH"
          ? "NO TRADE"

          : state.bias ===
            "NEUTRAL"
            ? "WAIT"

            : `WAIT FOR ${state.bias} QUALIFIED PROFILE REJECTION`;

    /* ======================================================
       RESPONSE
    ====================================================== */

    return res
      .status(200)
      .json({
        ok: true,

        engine:
          "MKAYFX BTC VOLUME PROFILE V3.1",

        source:
          "Coinbase Exchange",

        product:
          PRODUCT,

        mode,
        minimumScore,

        signal,
        setup,

        timestamp:
          new Date()
            .toISOString(),

        latencyMs:
          Date.now() -
          started,

        price:
          round(price),

        entry:
          round(entry),

        stopLoss:
          round(stopLoss),

        takeProfit1:
          round(target),

        takeProfit2:
          round(target),

        riskDistance:
          round(riskDistance),

        rr: {
          tp1:
            SETTINGS.targetR,

          tp2:
            SETTINGS.targetR
        },

        decisionPanel: {
          bias:
            state.bias,

          strength:
            state.strength,

          session:
            currentSession.name,

          value:
            valueState,

          poc:
            pocState,

          vwap:
            vwapState,

          nakedPOC:
            nearestNakedPOC
              ? "ACTIVE"
              : "NONE",

          conflict,
          guidance,
          signal,
          setup,
          mode,

          score:
            signal === "BUY"
              ? buyScore

              : signal === "SELL"
                ? sellScore

                : Math.max(
                    buyScore,
                    sellScore
                  )
        },

        scores: {
          buy:
            round(
              buyScore,
              1
            ),

          sell:
            round(
              sellScore,
              1
            )
        },

        triggerQuality: {
          relativeVolume:
            round(
              relativeVol,
              2
            ),

          volumeOK,
          pocVolumeOK,

          bullishRSIMomentum,
          bearishRSIMomentum,

          validVALRejection,
          validVAHRejection,
          validPOCReclaim,
          validPOCRejection,
          validVWAPReclaim,
          validVWAPRejection,

          buyHTFConflict,
          sellHTFConflict
        },

        trend: {
          h1:
            h1Bullish
              ? "BULLISH"
              : h1Bearish
                ? "BEARISH"
                : "NEUTRAL",

          h4:
            h4Bullish
              ? "BULLISH"
              : h4Bearish
                ? "BEARISH"
                : "NEUTRAL"
        },

        m15: {
          rsi:
            round(
              rsiNow,
              2
            ),

          atr:
            round(
              atrNow,
              2
            ),

          atrPercent:
            round(
              atrPercent,
              3
            ),

          candleStrength:
            round(
              metrics.body *
              100,
              1
            ),

          lowerWick:
            round(
              metrics.lowerWick *
              100,
              1
            ),

          upperWick:
            round(
              metrics.upperWick *
              100,
              1
            ),

          relativeVolume:
            round(
              relativeVol,
              2
            )
        },

        currentProfile: {
          session:
            currentSession.name,

          developing:
            true,

          poc:
            round(
              developingProfile.poc
            ),

          vah:
            round(
              developingProfile.vah
            ),

          val:
            round(
              developingProfile.val
            ),

          vwap:
            round(
              sessionVWAP
            ),

          high:
            round(
              developingProfile.high
            ),

          low:
            round(
              developingProfile.low
            ),

          volume:
            round(
              developingProfile.totalVolume,
              4
            )
        },

        previousProfile:
          previousProfile
            ? {
                session:
                  previousSession.name,

                poc:
                  round(
                    previousProfile.poc
                  ),

                vah:
                  round(
                    previousProfile.vah
                  ),

                val:
                  round(
                    previousProfile.val
                  ),

                high:
                  round(
                    previousProfile.high
                  ),

                low:
                  round(
                    previousProfile.low
                  )
              }
            : null,

        nakedPOCs:
          nakedPOCs.map(
            item => ({
              session:
                item.session,

              poc:
                round(
                  item.poc
                ),

              distance:
                round(
                  item.distance
                )
            })
          ),

        reasons:
          signal === "BUY"
            ? buyReasons

            : signal === "SELL"
              ? sellReasons

              : [
                  `Market bias: ${state.bias}`,
                  `Strength: ${state.strength}`,
                  `Current session: ${currentSession.name}`,
                  `Value: ${valueState}`,
                  `POC state: ${pocState}`,
                  `VWAP state: ${vwapState}`,

                  `Buy score: ${round(
                    buyScore,
                    1
                  )}`,

                  `Sell score: ${round(
                    sellScore,
                    1
                  )}`,

                  `Relative volume: ${round(
                    relativeVol,
                    2
                  )}x`,

                  buySetup
                    ? `BUY candidate: ${buySetup}`
                    : "No qualified BUY trigger",

                  sellSetup
                    ? `SELL candidate: ${sellSetup}`
                    : "No qualified SELL trigger",

                  volatilityOK
                    ? "ATR volatility acceptable"
                    : "ATR volatility blocked"
                ]
      });

  } catch (error) {
    console.error(
      "BTC PROFILE ENGINE ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        ok: false,

        source:
          "Coinbase Exchange",

        product:
          PRODUCT,

        error:
          errorText(error),

        latencyMs:
          Date.now() -
          started
      });
  }
};