
const URL_BASE = "https://api.twelvedata.com/time_series";

const INTERVALS = {
  "5m": "5min",
  "15m": "15min"
};

const SECONDS = {
  "5m": 300,
  "15m": 900
};

function getKey(tf) {
  const names = tf === "5m"
    ? [
        "TWELVE_DATA_API_KEY_3",
        "TWELVE_DATA_API_KEY",
        "TWELVE_DATA_API_KEY_2",
        "TWELVE_DATA_API_KEY_4"
      ]
    : [
        "TWELVE_DATA_API_KEY_2",
        "TWELVE_DATA_API_KEY",
        "TWELVE_DATA_API_KEY_4",
        "TWELVE_DATA_API_KEY_3"
      ];

  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }

  throw new Error(
    "No Twelve Data API key configured in Vercel"
  );
}

export async function candles(tf = "5m", count = 1000) {
  if (!INTERVALS[tf]) {
    throw new Error("Unsupported timeframe");
  }

  const key = getKey(tf);
  const size = Math.max(
    150,
    Math.min(5000, Number(count) || 1000)
  );

  const params = new URLSearchParams({
    symbol: "XAU/USD",
    interval: INTERVALS[tf],
    outputsize: String(size),
    timezone: "UTC",
    apikey: key
  });

  const response = await fetch(
    `${URL_BASE}?${params}`,
    {
      signal: AbortSignal.timeout(20000),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(
      `Twelve Data HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (
    data.status === "error" ||
    !Array.isArray(data.values)
  ) {
    throw new Error(
      data.message || "Gold data unavailable"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const seconds = SECONDS[tf];

  const parsed = data.values.map(x => ({
    t: Math.floor(
      Date.parse(
        x.datetime.replace(" ", "T") + "Z"
      ) / 1000
    ),
    o: Number(x.open),
    h: Number(x.high),
    l: Number(x.low),
    c: Number(x.close),
    v: Number(x.volume || 0)
  }));

  return [
    ...new Map(
      parsed
        .filter(x =>
          [x.t, x.o, x.h, x.l, x.c]
            .every(Number.isFinite) &&
          x.l > 0 &&
          x.h >= x.l &&
          x.t + seconds <= now
        )
        .map(x => [x.t, x])
    ).values()
  ]
    .sort((a, b) => a.t - b.t)
    .slice(-size);
}
