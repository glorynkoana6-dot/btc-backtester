'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const handler = require('./api/candles.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

const ASSETS = {
  '/': [
    'index.html',
    'text/html; charset=utf-8'
  ],
  '/index.html': [
    'index.html',
    'text/html; charset=utf-8'
  ],
  '/styles.css': [
    'styles.css',
    'text/css; charset=utf-8'
  ],
  '/app.js': [
    'app.js',
    'application/javascript; charset=utf-8'
  ],
  '/scientist.worker.js': [
    'scientist.worker.js',
    'application/javascript; charset=utf-8'
  ]
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );

    if (url.pathname === '/api/candles') {
      req.query = Object.fromEntries(
        url.searchParams.entries()
      );

      await handler(req, res);
      return;
    }

    const asset = ASSETS[url.pathname];

    if (!asset) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const filename = path.join(
      ROOT,
      asset[0]
    );

    res.setHeader(
      'Content-Type',
      asset[1]
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    fs.createReadStream(filename)
      .on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500);
        }

        res.end(
          'Unable to read asset'
        );
      })
      .pipe(res);

  } catch {
    res.writeHead(500);
    res.end('Server error');
  }

}).listen(PORT, () => {
  console.log(
    `MKAYFX Scientist ready: http://localhost:${PORT}`
  );
});