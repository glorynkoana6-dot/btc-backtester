'use strict';

const $ = id =>
  document.getElementById(id);

let worker = null;
let controller = null;
let currentReport = null;
let latestInput = null;

const integer = (id, fallback) =>
  Number.isFinite(
    Number($(id).value)
  )
    ? Number($(id).value)
    : fallback;

const fmt = (
  value,
  decimals = 2
) =>
  Number.isFinite(value)
    ? Number(value).toFixed(
        decimals
      )
    : '—';

const dateText = millis =>
  new Date(millis)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 16) +
  ' UTC';

function setStatus(message) {
  $('statusMessage').textContent =
    message;
}

function busy(value) {
  $('runButton').disabled =
    value;

  $('stopButton').disabled =
    !value;
}

function errorMessage(error) {
  setStatus(
    `ERROR: ${error?.message || String(error)}`
  );

  busy(false);
}

$('source').addEventListener(
  'change',
  () => {
    $('csvArea').classList.toggle(
      'hidden',
      $('source').value !== 'csv'
    );
  }
);

$('stopButton').addEventListener(
  'click',
  () => {
    controller?.abort();

    worker?.terminate();

    worker = null;
    controller = null;

    busy(false);

    setStatus(
      'Research stopped. No new result was saved.'
    );
  }
);

function parseCSVLine(
  line,
  separator
) {
  const cols = [];

  let value = '';
  let quoted = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    const ch = line[i];

    if (
      ch === '"' &&
      quoted &&
      line[i + 1] === '"'
    ) {
      value += '"';
      i++;
    }

    else if (
      ch === '"'
    ) {
      quoted = !quoted;
    }

    else if (
      ch === separator &&
      !quoted
    ) {
      cols.push(
        value.trim()
      );

      value = '';
    }

    else {
      value += ch;
    }
  }

  cols.push(
    value.trim()
  );

  return cols;
}

function parseTime(value) {
  const text = String(
    value || ''
  ).trim();

  if (
    /^\d{10,13}$/.test(text)
  ) {
    const numeric =
      Number(text);

    return text.length === 10
      ? numeric * 1000
      : numeric;
  }

  const normalized =
    text.replace(
      ' ',
      'T'
    );

  return Date.parse(
    /(Z|[+-]\d{2}:?\d{2})$/i.test(
      normalized
    )
      ? normalized
      : `${normalized}Z`
  );
}

async function readCSV(file) {
  if (!file) {
    throw new Error(
      'Choose a CSV file first.'
    );
  }

  if (
    file.size > 20_000_000
  ) {
    throw new Error(
      'CSV exceeds the 20 MB browser import limit.'
    );
  }

  const content =
    (await file.text())
      .replace(
        /^\uFEFF/,
        ''
      );

  const lines =
    content
      .split(/\r?\n/)
      .filter(
        x => x.trim()
      );

  if (
    lines.length < 601
  ) {
    throw new Error(
      'CSV requires at least 600 data rows.'
    );
  }

  const header =
    lines[0];

  const separator =
    ['\t', ';', ',']
      .sort(
        (a, b) =>
          header.split(b).length -
          header.split(a).length
      )[0];

  const names =
    parseCSVLine(
      header,
      separator
    ).map(
      v =>
        v.toLowerCase()
          .replace(
            /[^a-z]/g,
            ''
          )
    );

  const timeIndex =
    names.findIndex(
      x =>
        [
          'datetime',
          'date',
          'timestamp',
          'time'
        ].includes(x)
    );

  const column =
    name =>
      names.indexOf(name);

  const open =
    column('open');

  const high =
    column('high');

  const low =
    column('low');

  const close =
    column('close');

  if (
    [
      timeIndex,
      open,
      high,
      low,
      close
    ].some(
      x => x < 0
    )
  ) {
    throw new Error(
      'CSV header must have datetime (or date/time), open, high, low, close columns.'
    );
  }

  const bars = [];

  for (
    const line of
      lines.slice(1)
  ) {
    const cols =
      parseCSVLine(
        line,
        separator
      );

    bars.push({
      time:
        parseTime(
          cols[timeIndex]
        ),

      open:
        Number(
          cols[open]
        ),

      high:
        Number(
          cols[high]
        ),

      low:
        Number(
          cols[low]
        ),

      close:
        Number(
          cols[close]
        )
    });
  }

  if (
    bars.length < 600
  ) {
    throw new Error(
      'Not enough CSV candles.'
    );
  }

  return bars;
}

async function getBars() {
  if (
    $('source').value === 'csv'
  ) {
    return readCSV(
      $('csvFile').files[0]
    );
  }

  controller =
    new AbortController();

  const interval =
    encodeURIComponent(
      $('interval').value
    );

  const count =
    encodeURIComponent(
      $('count').value
    );

  const response =
    await fetch(
      `/api/candles?interval=${interval}&count=${count}`,
      {
        signal:
          controller.signal,

        cache:
          'no-store'
      }
    );

  const body =
    await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ||
      `Unable to obtain candles (${response.status}).`
    );
  }

  return body.bars;
}

function settings() {
  const s = {
    riskPct:
      integer(
        'riskPct',
        0.5
      ),

    costR:
      integer(
        'costR',
        0.12
      ),

    generations:
      integer(
        'generations',
        8
      ),

    population:
      integer(
        'population',
        32
      ),

    seed:
      integer(
        'seed',
        20261010
      )
  };

  if (
    s.riskPct < 0.1 ||
    s.riskPct > 2
  ) {
    throw new Error(
      'Risk must be between 0.1% and 2%.'
    );
  }

  if (
    s.costR < 0 ||
    s.costR > 1
  ) {
    throw new Error(
      'Cost R must be between 0 and 1.'
    );
  }

  if (
    !Number.isInteger(
      s.seed
    ) ||
    s.seed <= 0 ||
    s.seed > 2147483647
  ) {
    throw new Error(
      'Seed must be a positive integer.'
    );
  }

  return s;
}

$('runButton').addEventListener(
  'click',
  async () => {
    busy(true);

    currentReport = null;

    $('results').classList.add(
      'hidden'
    );

    $('progressFill').style.width =
      '0%';

    setStatus(
      'Loading completed historical XAU/USD candles…'
    );

    try {
      const config =
        settings();

      const bars =
        await getBars();

      if (
        bars.length < 600
      ) {
        throw new Error(
          `Only ${bars.length} bars received. At least 600 required.`
        );
      }

      latestInput = {
        source:
          $('source').value === 'api'
            ? 'Twelve Data'
            : 'Imported CSV',

        interval:
          $('interval').value,

        requested:
          integer(
            'count',
            5000
          )
      };

      setStatus(
        `Loaded ${bars.length} candles. Evolution running locally…`
      );

      worker = new Worker(
        '/scientist.worker.js'
      );

      worker.onmessage = ({
        data
      }) => {
        if (
          data.type === 'STATUS'
        ) {
          setStatus(
            data.message
          );
        }

        if (
          data.type === 'PROGRESS'
        ) {
          const percentage =
            Math.round(
              100 *
                data.generation /
                data.generations
            );

          $('progressFill').style.width =
            `${percentage}%`;

          setStatus(
            `Generation ${data.generation}/${data.generations} ` +
            `• best training fitness ${fmt(data.best.score)} ` +
            `• ${data.best.type} ` +
            `• ${data.best.trades} training trades`
          );
        }

        if (
          data.type === 'ERROR'
        ) {
          errorMessage(
            new Error(
              data.error
            )
          );

          worker?.terminate();
          worker = null;
        }

        if (
          data.type === 'DONE'
        ) {
          currentReport = {
            ...data.result,

            input:
              latestInput,

            createdAt:
              new Date().toISOString()
          };

          renderResult(
            currentReport
          );

          busy(false);

          setStatus(
            'Research complete. Examine holdout trades and warnings before using the result.'
          );

          worker?.terminate();
          worker = null;

          $('results').scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      };

      worker.onerror = err => {
        errorMessage(
          new Error(
            err.message ||
            'Worker failed.'
          )
        );

        worker?.terminate();
        worker = null;
      };

      worker.postMessage({
        type: 'RUN',
        bars,
        settings: config
      });

    } catch (err) {
      if (
        err.name !==
        'AbortError'
      ) {
        errorMessage(err);
      }

      else {
        busy(false);

        setStatus(
          'Data loading cancelled.'
        );
      }

    } finally {
      controller = null;
    }
  }
);

function lineChart(
  points,
  options = {}
) {
  if (
    points.length < 2
  ) {
    return (
      '<div class="chart-empty">' +
      'Not enough observations to draw a curve.' +
      '</div>'
    );
  }

  const data =
    points
      .map(Number)
      .filter(
        Number.isFinite
      );

  if (
    data.length < 2
  ) {
    return (
      '<div class="chart-empty">' +
      'No finite chart data.' +
      '</div>'
    );
  }

  const width = 700;
  const height = 280;
  const pad = 39;

  let low =
    Math.min(...data);

  let high =
    Math.max(...data);

  const range =
    Math.max(
      high - low,
      Math.max(
        1,
        Math.abs(high)
      ) * 0.003
    );

  low -= range * 0.12;
  high += range * 0.12;

  const x = i =>
    pad +
    i *
      (
        width - 2 * pad
      ) /
      (
        data.length - 1
      );

  const y = v =>
    height -
    pad -
    (
      v - low
    ) /
    (
      high - low
    ) *
    (
      height - 2 * pad
    );

  const polyline =
    data.map(
      (v, i) =>
        `${fmt(x(i), 1)},${fmt(y(v), 1)}`
    ).join(' ');

  const grid =
    Array.from(
      {
        length: 4
      },
      (_, i) => {
        const value =
          low +
          (
            high - low
          ) *
          i / 3;

        const yy =
          y(value);

        return `
          <line
            x1="${pad}"
            y1="${yy}"
            x2="${width - pad}"
            y2="${yy}"
            stroke="#28364b"
            stroke-width="1"
          />
          <text
            x="3"
            y="${yy + 4}"
            font-size="11"
            fill="#8696ad"
          >
            ${fmt(
              value,
              options.fitness
                ? 1
                : 0
            )}
          </text>
        `;
      }
    ).join('');

  return `
    <svg
      role="img"
      aria-label="${
        options.fitness
          ? 'Generation training fitness'
          : 'Holdout equity'
      } line chart"
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="none"
    >
      ${grid}

      <polyline
        points="${polyline}"
        stroke="${
          options.fitness
            ? '#edc47d'
            : '#5fe0b0'
        }"
        stroke-width="3.3"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
    </svg>
  `;
}

function table(
  headers,
  rows
) {
  return `
    <table>
      <thead>
        <tr>
          ${
            headers.map(
              h =>
                `<th>${h}</th>`
            ).join('')
          }
        </tr>
      </thead>

      <tbody>
        ${
          rows.map(
            cells => `
              <tr>
                ${
                  cells.map(
                    cell =>
                      `<td>${cell}</td>`
                  ).join('')
                }
              </tr>
            `
          ).join('')
        }
      </tbody>
    </table>
  `;
}

function renderResult(report) {
  const {
    train,
    validation,
    holdout,
    champion,
    progress,
    data,
    settings: config
  } = report;

  $('results').classList.remove(
    'hidden'
  );

  $('evaluations').textContent =
    (
      config.population *
      config.generations
    ).toLocaleString();

  $('expectancy').textContent =
    `${
      holdout.expectancy >= 0
        ? '+'
        : ''
    }${fmt(
      holdout.expectancy,
      3
    )}R`;

  $('profitFactor').textContent =
    holdout.profitFactor === 99
      ? '∞*'
      : fmt(
          holdout.profitFactor
        );

  $('winRate').textContent =
    `${fmt(
      holdout.winRate,
      1
    )}%`;

  $('decision').textContent =
    report.status;

  const ageHours =
    (
      Date.now() -
      data.end
    ) /
    3_600_000;

  const freshness =
    ageHours > 4
      ? ` • Latest data is ${fmt(ageHours, 1)} hours old (not live)`
      : '';

  $('dataMeta').textContent =
    `${data.count} candles • ` +
    `${dateText(data.start)} → ${dateText(data.end)} ` +
    `• 60/20/20 chronological split ` +
    `• ${report.input.source}` +
    freshness;

  $('warnings').replaceChildren();

  for (
    const message of
      report.warnings
  ) {
    const p =
      document.createElement(
        'p'
      );

    p.textContent =
      '⚠ ' + message;

    $('warnings').appendChild(p);
  }

  $('champion').textContent =
    JSON.stringify(
      {
        ...champion,

        riskPct:
          config.riskPct,

        costR:
          config.costR
      },
      null,
      2
    );

  $('generationChart').innerHTML =
    lineChart(
      progress.map(
        x => x.score
      ),
      {
        fitness: true
      }
    );

  $('equityChart').innerHTML =
    lineChart(
      holdout.curve.map(
        x => x.equity
      )
    );

  const metricRow = (
    name,
    m,
    count
  ) => [
    name,

    String(count),

    String(
      m.trades
    ),

    `${fmt(
      m.winRate,
      1
    )}%`,

    m.profitFactor === 99
      ? '∞*'
      : fmt(
          m.profitFactor
        ),

    `${
      m.expectancy >= 0
        ? '+'
        : ''
    }${fmt(
      m.expectancy,
      3
    )}R`,

    `${fmt(
      m.maxDD,
      2
    )}%`,

    `${fmt(
      m.returnPct,
      2
    )}%`
  ];

  $('splitTable').innerHTML =
    table(
      [
        'SAMPLE',
        'CANDLES',
        'TRADES',
        'WIN RATE',
        'PROFIT FACTOR',
        'EXPECTANCY',
        'MAX DD',
        'RETURN'
      ],
      [
        metricRow(
          'Training',
          train,
          data.splits.training
        ),

        metricRow(
          'Validation',
          validation,
          data.splits.validation
        ),

        metricRow(
          'Holdout',
          holdout,
          data.splits.holdout
        )
      ]
    );

  const recent = [
    ...holdout.tradeLog
  ]
    .slice(-20)
    .reverse();

  $('tradeTable').innerHTML =
    recent.length
      ? table(
          [
            'ENTRY (UTC)',
            'SIDE',
            'PRICE IN',
            'PRICE OUT',
            'NET R',
            'EXIT'
          ],

          recent.map(
            t => [
              dateText(
                t.entered
              ),

              t.side,

              fmt(
                t.entry
              ),

              fmt(
                t.exit
              ),

              `<span class="${
                t.netR >= 0
                  ? 'positive'
                  : 'negative'
              }">
                ${
                  t.netR >= 0
                    ? '+'
                    : ''
                }${fmt(
                  t.netR,
                  3
                )}R
              </span>`,

              t.reason
            ]
          )
        )
      : (
          '<p class="chart-caption">' +
          'No holdout trades. More history or different strategy configurations are needed.' +
          '</p>'
        );
}

$('exportButton').addEventListener(
  'click',
  () => {
    if (
      !currentReport
    ) {
      return;
    }

    const data =
      new Blob(
        [
          JSON.stringify(
            currentReport,
            null,
            2
          )
        ],
        {
          type:
            'application/json'
        }
      );

    const url =
      URL.createObjectURL(data);

    const link =
      document.createElement(
        'a'
      );

    link.href = url;

    link.download =
      `mkayfx-scientist-${new Date().toISOString().slice(0, 10)}.json`;

    link.click();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          url
        ),
      1500
    );
  }
);