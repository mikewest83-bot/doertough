// Lightweight Realtime readiness state shared by health and voice initialization.
let realtimeState = { configured: false, ready: false, error: null, checkedAt: null };

export function setRealtimeState(patch = {}) {
  realtimeState = { ...realtimeState, ...patch, checkedAt: new Date().toISOString() };
}

export function getRealtimeState() {
  return { ...realtimeState };
}
