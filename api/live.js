/* ================================================================
   MKAYFX LIVE XAU STREAM V1
   ---------------------------------------------------------------
   FILE:
   /api/live.js

   CLIENT
   ------
   Browser
       ↓ WebSocket
   Vercel /api/live
       ↓ WebSocket
   Twelve Data
       ↓
   XAU/USD live price

   ENV
   ---
   TWELVE_DATA_API_KEY_4

   Fallback:
   TWELVE_DATA_API_KEY
================================================================ */

import express from "express";

import {
  createServer
} from "node:http";

import WebSocket, {
  WebSocketServer
} from "ws";


const app =
  express();


const server =
  createServer(
    app
  );


const wss =
  new WebSocketServer({
    server
  });


const API_KEY =
  process.env.TWELVE_DATA_API_KEY_4 ||
  process.env.TWELVE_DATA_API_KEY ||
  "";


const SYMBOL =
  "XAU/USD";


const TD_WS =
  "wss://ws.twelvedata.com/v1/quotes/price";


/* ================================================================
   NORMALIZE TIMESTAMP
================================================================ */

function normalizeTimestamp(
  value
) {

  let timestamp =
    Number(
      value
    );


  if (
    !Number.isFinite(
      timestamp
    )
  ) {

    return Date.now();

  }


  if (
    timestamp <
    100000000000
  ) {

    timestamp *=
      1000;

  }


  return timestamp;
}


/* ================================================================
   SAFE SEND
================================================================ */

function send(
  socket,
  payload
) {

  if (
    socket.readyState ===
    WebSocket.OPEN
  ) {

    socket.send(
      JSON.stringify(
        payload
      )
    );

  }

}


/* ================================================================
   HTTP HEALTH
================================================================ */

app.get(
  "*",
  (
    req,
    res
  ) => {

    res
      .status(200)
      .json({

        ok:
          true,

        engine:
          "MKAYFX LIVE XAU STREAM V1",

        symbol:
          SYMBOL,

        websocket:
          true

      });

  }
);


/* ================================================================
   CLIENT CONNECTION
================================================================ */

wss.on(
  "connection",
  client => {

    if (
      !API_KEY
    ) {

      send(
        client,
        {

          type:
            "error",

          message:
            "TWELVE_DATA_API_KEY_4 is missing."

        }
      );


      client.close();

      return;

    }


    let upstream =
      null;


    let heartbeat =
      null;


    let reconnectTimer =
      null;


    let reconnectAttempt =
      0;


    let closed =
      false;


    function clearUpstream() {

      clearInterval(
        heartbeat
      );


      clearTimeout(
        reconnectTimer
      );


      heartbeat =
        null;


      if (
        upstream
      ) {

        try {

          upstream.removeAllListeners();

          upstream.close();

        } catch {}

      }


      upstream =
        null;

    }


    function scheduleReconnect() {

      if (
        closed
      ) {

        return;

      }


      const delay =
        Math.min(
          1000 *
          Math.max(
            reconnectAttempt,
            1
          ),
          10000
        );


      reconnectTimer =
        setTimeout(
          connectUpstream,
          delay
        );

    }


    function connectUpstream() {

      if (
        closed
      ) {

        return;

      }


      clearUpstream();


      const url =
        `${TD_WS}?apikey=${encodeURIComponent(
          API_KEY
        )}`;


      upstream =
        new WebSocket(
          url
        );


      upstream.on(
        "open",
        () => {

          reconnectAttempt =
            0;


          upstream.send(
            JSON.stringify({

              action:
                "subscribe",

              params: {

                symbols:
                  SYMBOL

              }

            })
          );


          send(
            client,
            {

              type:
                "status",

              status:
                "upstream-connected",

              symbol:
                SYMBOL

            }
          );


          /*
             Twelve Data recommends heartbeat events periodically.
          */

          heartbeat =
            setInterval(
              () => {

                if (
                  upstream &&
                  upstream.readyState ===
                  WebSocket.OPEN
                ) {

                  upstream.send(
                    JSON.stringify({

                      action:
                        "heartbeat"

                    })
                  );

                }

              },
              10000
            );

        }
      );


      upstream.on(
        "message",
        raw => {

          let message;


          try {

            message =
              JSON.parse(
                raw.toString()
              );

          } catch {

            return;

          }


          const event =
            String(
              message?.event ||
              message?.type ||
              ""
            )
            .toLowerCase();


          /*
             PRICE EVENT
          */

          if (
            event ===
            "price" ||
            message?.price !==
            undefined
          ) {

            const price =
              Number(
                message.price
              );


            if (
              Number.isFinite(
                price
              ) &&
              price >
              0
            ) {

              send(
                client,
                {

                  type:
                    "price",

                  symbol:
                    message.symbol ||
                    SYMBOL,

                  price,

                  timestamp:
                    normalizeTimestamp(
                      message.timestamp
                    ),

                  source:
                    "TWELVE_DATA_WEBSOCKET"

                }
              );

            }

          }


          /*
             SUBSCRIBE STATUS
          */

          if (
            event.includes(
              "subscribe"
            )
          ) {

            send(
              client,
              {

                type:
                  "status",

                status:
                  "subscribed",

                upstream:
                  message

              }
            );

          }

        }
      );


      upstream.on(
        "error",
        error => {

          send(
            client,
            {

              type:
                "error",

              message:
                `Twelve Data WebSocket: ${
                  error?.message ||
                  "unknown error"
                }`

            }
          );

        }
      );


      upstream.on(
        "close",
        (
          code,
          reason
        ) => {

          clearInterval(
            heartbeat
          );


          heartbeat =
            null;


          if (
            closed
          ) {

            return;

          }


          reconnectAttempt++;


          send(
            client,
            {

              type:
                "status",

              status:
                "upstream-reconnecting",

              code,

              reason:
                reason?.toString?.() ||
                ""

            }
          );


          scheduleReconnect();

        }
      );

    }


    /* ============================================================
       CLIENT PING
    ============================================================ */

    client.on(
      "message",
      raw => {

        let message;


        try {

          message =
            JSON.parse(
              raw.toString()
            );

        } catch {

          return;

        }


        if (
          message.type ===
          "ping"
        ) {

          send(
            client,
            {

              type:
                "pong",

              timestamp:
                Date.now()

            }
          );

        }

      }
    );


    /* ============================================================
       CLIENT CLOSED
    ============================================================ */

    client.on(
      "close",
      () => {

        closed =
          true;


        clearUpstream();

      }
    );


    client.on(
      "error",
      () => {

        closed =
          true;


        clearUpstream();

      }
    );


    send(
      client,
      {

        type:
          "status",

        status:
          "connecting-upstream",

        symbol:
          SYMBOL

      }
    );


    connectUpstream();

  }
);


export default server;