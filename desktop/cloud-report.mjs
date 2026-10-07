// Sending the status report to the hosted service.
//
// The hosted service validates the report strictly and answers 400 to a
// version or a value it does not know. That matters more than it sounds: a
// paired helper does not route anything until a sync has succeeded, so a
// rejected report would quietly stop routing on that computer.
//
// So when the full report is rejected, the same call is repeated in the shape
// the previous release used, which an older service accepts. The full report
// is tried again later, so an updated service is picked up without a restart.
// Any other failure (offline, unauthorized) is passed on unchanged.

import { cloudStatus } from "../plugins/gearshift/lib/status.mjs";

export function createCloudReporter({ send, now = Date.now, retryFullAfterMs = 3_600_000 } = {}) {
  let legacyUntil = 0;
  return async function report(local) {
    if (now() >= legacyUntil) {
      try {
        return await send(cloudStatus(local));
      } catch (error) {
        if (error?.status !== 400) throw error;
      }
    }
    const reply = await send(cloudStatus(local, { legacy: true }));
    if (now() >= legacyUntil) legacyUntil = now() + retryFullAfterMs;
    return reply;
  };
}
