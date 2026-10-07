// Keeps the helper's connection to the Decisions API open while Codex is in use.
//
// A routing call made on an open connection skips the TCP and TLS handshakes.
// The connection is only kept open for a bounded window after the last sign of
// Codex activity, so an idle computer makes no requests at all.
//
// settings() -> { enabled, intervalMs, windowMs }
// ping(reason) -> { ok, socket_reused } (never throws; may resolve { skipped: true })

export function createWarmer({ ping, settings, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let activeUntil = 0;
  let lastUse = 0;
  let timer = null;
  let inflight = null;
  const stats = { pings: 0, last_at: null, last_ms: null, last_reused: null, last_ok: null };

  function fire(reason) {
    if (inflight) return inflight;
    lastUse = now();
    const started = now();
    inflight = Promise.resolve()
      .then(() => ping(reason))
      .catch(() => null)
      .then((result) => {
        inflight = null;
        if (result && result.skipped !== true) {
          stats.pings += 1;
          stats.last_at = new Date(now()).toISOString();
          stats.last_ms = Math.max(0, now() - started);
          stats.last_reused = result.socket_reused ?? null;
          stats.last_ok = result.ok === true;
        }
        return result;
      });
    return inflight;
  }

  function arm() {
    if (timer) return;
    const { enabled, intervalMs } = settings();
    if (!enabled || now() >= activeUntil) return;
    timer = setTimer(() => {
      timer = null;
      const current = settings();
      if (!current.enabled || now() >= activeUntil) return;
      if (now() - lastUse >= current.intervalMs) void fire("keep_warm");
      arm();
    }, intervalMs);
    timer?.unref?.();
  }

  return {
    /** Codex just became active: open the window and warm now unless the connection was used recently. */
    touch(reason = "activity") {
      const { enabled, intervalMs, windowMs } = settings();
      if (!enabled) return null;
      activeUntil = now() + windowMs;
      const pending = now() - lastUse >= intervalMs ? fire(reason) : null;
      arm();
      return pending;
    },
    /** Activity that is about to use the connection itself: extend the window without a ping. */
    extend() {
      const { enabled, windowMs } = settings();
      if (!enabled) return;
      activeUntil = now() + windowMs;
      arm();
    },
    /** A real request just used the connection, so it is warm without a ping. */
    used() {
      lastUse = now();
    },
    stop() {
      clearTimer(timer);
      timer = null;
      activeUntil = 0;
    },
    state() {
      return { ...stats, active: now() < activeUntil };
    },
  };
}
