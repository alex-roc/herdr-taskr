// Caches shared by every copy of the mod.

// Shared by every copy of the mod (sidebar, detail, board): one look per agent, not three.
// Plain data on globalThis, so it also survives a hot reload; work in flight that a
// reload cancelled counts as done after a minute.
export function sharedCache(name) {
  const all = (globalThis.__taskr ??= {});
  return (all[name] ??= { info: {}, seen: {}, busy: {} });
}

const STUCK = 60000;
export const busy = (c, k, now = Date.now()) => c.busy[k] != null && now - c.busy[k] < STUCK;

// One key press reaches every copy that listens (two lists, a pane header): the first to claim it
// acts. Presses closer than `ms` count as one.
export function claim(key, ms = 250, now = Date.now()) {
  const c = sharedCache("claims").info;
  if (now - (c[key] ?? 0) < ms) return false;
  c[key] = now;
  return true;
}
