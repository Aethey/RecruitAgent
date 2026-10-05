// Local scheduling only: coalesce edits and wait for the shared AI task slot.
export function createTeacherMonitor({ send, isBusy, onState = (_state) => {}, now = Date.now, schedule = setTimeout, cancel = clearTimeout, idleMs = 20000, intervalMs = 6000, automatic = true }) {
  let enabled = false, paused = false, snapshot = null, lastRequested = null;
  let changedAt = 0, lastStarted = -Infinity, pending = false, timer = null, forced = false;
  const same = (a, b) => a && b && a.problemId === b.problemId && a.code === b.code;
  function sync() {
    cancel(timer); timer = null;
    if (!enabled) return onState('off');
    if (paused) return onState('paused');
    if (!snapshot) return onState('away');
    if (!automatic && !forced) return onState('manual');
    if (pending || isBusy()) return onState('blocked');
    if (!forced && same(snapshot, lastRequested)) return onState('watching');
    const wait = Math.max(forced ? 0 : changedAt + idleMs - now(), lastStarted + intervalMs - now(), 0);
    if (wait) {
      onState(now() < changedAt + idleMs ? 'typing' : 'waiting');
      timer = schedule(sync, wait); return;
    }
    const current = { ...snapshot }; forced = false; pending = true; lastStarted = now();
    onState('checking');
    // A failed snapshot is not retried in a loop; another edit or explicit check can retry it.
    lastRequested = current;
    Promise.resolve().then(() => send(current)).catch(() => {}).finally(() => { pending = false; sync(); });
  }
  return {
    configure(value) {
      if (value.idleMs === idleMs && value.automatic === automatic) return;
      idleMs = value.idleMs; automatic = value.automatic; changedAt = now(); forced = false;
      sync();
    },
    observe(value) { if (!same(snapshot, value)) { snapshot = value ? { ...value } : null; changedAt = now(); forced = false; } sync(); },
    enable(value) { enabled = value; sync(); },
    pause(value) { paused = value; sync(); },
    seed(value) { lastRequested = value ? { ...value } : null; sync(); },
    check() { forced = true; sync(); },
    sync,
  };
}
