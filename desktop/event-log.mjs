// A bounded, numbered list of what just happened in composer tasks, so the
// local panel can follow along live and catch up after a reconnect.
// Memory only: nothing here is written to disk.

export function createEventLog({ capacity = 2000 } = {}) {
  let seq = 0;
  const ring = [];
  const listeners = new Set();
  return {
    push(type, data = {}) {
      seq += 1;
      const event = { seq, type, data };
      ring.push(event);
      if (ring.length > capacity) ring.splice(0, ring.length - capacity);
      for (const listener of listeners) {
        try { listener(event); } catch { /* one bad listener must not stop the rest */ }
      }
      return seq;
    },
    /** The number of the most recent event. */
    seq: () => seq,
    /**
     * Events after `after`. `reset` is true when some of them are no longer
     * held, in which case the reader should take a fresh snapshot instead.
     */
    since(after = 0) {
      const from = Number.isSafeInteger(after) && after >= 0 ? after : 0;
      const oldest = ring.length ? ring[0].seq : seq + 1;
      if (from > seq || from < oldest - 1) return { reset: true, events: [] };
      return { reset: false, events: ring.filter((event) => event.seq > from) };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listeners: () => listeners.size,
  };
}
