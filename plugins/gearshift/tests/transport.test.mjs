// The HTTPS transport against a local server: connection reuse, the one
// stale-socket resend, timings, and the keep-open request. No real network.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { ProviderError, buildVerifyRequest, createHttpsTransport, decide, warmConnection, warmUrl } from "../lib/decisions.mjs";
import { FAKE_KEY, SENTINEL, answer, fakeClock } from "./helpers.mjs";

/** A local server that records every request and which TCP connection carried it. */
async function server(t, handler = (request, response) => response.end(JSON.stringify(answer()))) {
  const seen = [];
  let connections = 0;
  const instance = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const record = { method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8"), connection: request.socket.connectionId };
      seen.push(record);
      handler(request, response, record, seen);
    });
  });
  instance.on("connection", (socket) => { connections += 1; socket.connectionId = connections; });
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  return { url: `http://127.0.0.1:${instance.address().port}/v1/decisions`, seen, connections: () => connections };
}

const post = (transport, url, extra = {}) => transport(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", timeoutMs: 2000, ...extra });

test("a one-shot transport closes its connection every time", async (t) => {
  const local = await server(t);
  const transport = createHttpsTransport();
  assert.equal(transport.keepAlive, false);
  const first = {}, second = {};
  assert.equal((await post(transport, local.url, { telemetry: first })).status, 200);
  await post(transport, local.url, { telemetry: second });
  assert.deepEqual([first.socket_reused, second.socket_reused], [false, false]);
  assert.equal(local.connections(), 2);
  assert.ok(local.seen.every((request) => request.headers.connection === "close"), "hooks must not leave a socket behind");
});

test("a keep-alive transport reuses the connection and reports timings without content", async (t) => {
  const local = await server(t);
  const transport = createHttpsTransport({ keepAlive: true });
  t.after(() => transport.destroy());
  const first = {}, second = {};
  await post(transport, local.url, { telemetry: first });
  await post(transport, local.url, { telemetry: second });
  assert.deepEqual([first.socket_reused, second.socket_reused], [false, true]);
  assert.equal(local.connections(), 1, "both requests travelled on one connection");
  assert.ok(local.seen.every((request) => request.headers.connection !== "close"));
  for (const telemetry of [first, second]) {
    assert.equal(typeof telemetry.ttfb_ms, "number");
    assert.equal(typeof telemetry.total_ms, "number");
    assert.ok(!JSON.stringify(telemetry).includes("sol_balanced"), "telemetry never carries response content");
  }
  assert.equal(typeof first.connect_ms, "number", "a new connection records its connect time");
  assert.equal(second.connect_ms, undefined, "a reused connection has no handshake to time");
});

test("a pool left idle too long is discarded instead of trusted", async (t) => {
  const local = await server(t);
  const now = fakeClock();
  const transport = createHttpsTransport({ keepAlive: true, maxIdleMs: 1000, now });
  t.after(() => transport.destroy());
  await post(transport, local.url);
  now.advance(500);
  const soon = {};
  await post(transport, local.url, { telemetry: soon });
  assert.equal(soon.socket_reused, true);
  now.advance(1001);
  const late = {};
  await post(transport, local.url, { telemetry: late });
  assert.equal(late.socket_reused, false);
  assert.equal(local.connections(), 2);
});

test("a reused socket that dies before any response is resent once on a fresh connection", async (t) => {
  let killed = 0;
  const local = await server(t, (request, response, record, seen) => {
    // The second request arrives on the pooled socket: drop it without a byte.
    if (seen.length === 2) { killed += 1; request.socket.destroy(); return; }
    response.end(JSON.stringify(answer()));
  });
  const transport = createHttpsTransport({ keepAlive: true });
  t.after(() => transport.destroy());
  await post(transport, local.url);
  const telemetry = {};
  const result = await post(transport, local.url, { telemetry });
  assert.equal(result.status, 200);
  assert.equal(telemetry.socket_retry, true);
  assert.equal(telemetry.socket_reused, false, "the resend used a new connection");
  assert.deepEqual([killed, local.seen.length], [1, 3], "exactly one resend");
  assert.equal(local.seen[2].headers.connection, "close");
});

test("a failure on a new connection is never resent", async (t) => {
  const local = await server(t, (request) => request.socket.destroy());
  for (const keepAlive of [false, true]) {
    const transport = createHttpsTransport({ keepAlive });
    t.after(() => transport.destroy());
    const before = local.seen.length;
    const telemetry = {};
    await assert.rejects(post(transport, local.url, { telemetry }), (error) => error instanceof ProviderError && error.reason === "api_unavailable");
    assert.equal(local.seen.length - before, 1, `keepAlive=${keepAlive}: one request, no resend`);
    assert.equal(telemetry.socket_retry, undefined);
  }
});

test("timeouts, oversized answers and bad addresses map to fixed reasons", async (t) => {
  const slow = await server(t, () => { /* never answers */ });
  const transport = createHttpsTransport({ keepAlive: true });
  t.after(() => transport.destroy());
  const started = Date.now();
  await assert.rejects(post(transport, slow.url, { timeoutMs: 120 }), (error) => error.reason === "timeout");
  assert.ok(Date.now() - started < 1000);
  const big = await server(t, (request, response) => response.end(SENTINEL.repeat(1000)));
  await assert.rejects(post(transport, big.url, { maxResponseBytes: 64 }), (error) => error.reason === "invalid_response" && !error.message.includes(SENTINEL));
  await assert.rejects(transport("not a url"), (error) => error.reason === "api_unavailable");
  await assert.rejects(post(transport, "http://127.0.0.1:1/v1/decisions"), (error) => error.reason === "api_unavailable");
});

test("decide fills telemetry and still makes exactly one request on an HTTP error", async (t) => {
  const local = await server(t);
  const transport = createHttpsTransport({ keepAlive: true });
  t.after(() => transport.destroy());
  const telemetry = {};
  const value = await decide({ body: buildVerifyRequest(), key: FAKE_KEY, transport, endpoint: local.url, deadlineMs: 2000, telemetry });
  assert.equal(value.answers[0].choice, "sol_balanced");
  assert.equal(typeof telemetry.decide_ms, "number");
  assert.equal(telemetry.socket_reused, false);
  assert.equal(local.seen[0].headers.authorization, `Bearer ${FAKE_KEY}`);

  const failing = await server(t, (request, response) => { response.statusCode = 500; response.end(SENTINEL); });
  const failed = {};
  await assert.rejects(decide({ body: {}, key: FAKE_KEY, transport, endpoint: failing.url, deadlineMs: 2000, telemetry: failed }), (error) => error.reason === "api_unavailable");
  assert.equal(failing.seen.length, 1, "an HTTP error is an answer, not a dead socket: zero retries");
  assert.equal(typeof failed.decide_ms, "number");
});

test("the keep-open request reads one model record and leaves the next call a warm connection", async (t) => {
  const local = await server(t, (request, response, record) => {
    if (record.method === "GET") { response.statusCode = 404; response.end("{}"); return; }
    response.end(JSON.stringify(answer()));
  });
  assert.equal(warmUrl(local.url), local.url.replace("/v1/decisions", "/v1/models/gpt-6-luna"));
  assert.equal(warmUrl(), "https://api.openai.com/v1/models/gpt-6-luna");
  const transport = createHttpsTransport({ keepAlive: true });
  t.after(() => transport.destroy());
  const warmTelemetry = {};
  const warmed = await warmConnection({ key: FAKE_KEY, transport, endpoint: local.url, telemetry: warmTelemetry });
  // Any HTTP answer opens the connection; a 404 for an unknown model is still warm.
  assert.deepEqual([warmed.ok, warmed.status_class, warmTelemetry.socket_reused], [true, 4, false]);
  assert.deepEqual([local.seen[0].method, local.seen[0].url, local.seen[0].body], ["GET", "/v1/models/gpt-6-luna", ""]);
  const telemetry = {};
  await decide({ body: buildVerifyRequest(), key: FAKE_KEY, transport, endpoint: local.url, deadlineMs: 2000, telemetry });
  assert.equal(telemetry.socket_reused, true, "the Decisions call skipped the handshake");
  assert.equal(local.connections(), 1);

  const dead = await warmConnection({ key: FAKE_KEY, transport, endpoint: "http://127.0.0.1:1/v1/decisions" });
  assert.deepEqual([dead.ok, dead.status_class, dead.reason], [false, null, "api_unavailable"]);
});
