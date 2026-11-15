// Statistics over a period: what got done and how much the agents worked. Every task counts
// alike, planned or not (an agent started on its own is a task too).
//
// Each task keeps its agents' work per day: `work: { "YYYY-MM-DD": [ms, turns] }`, the last
// WORK_DAYS days. A turn is an agent going from working to finished or idle. Tasks done come
// from `done_at`, so they count backwards too; agent work only from when taskr began keeping it.

import { localDay, isDropped } from "./util.js";

export const WORK_DAYS = 120;
// The periods Stats offers: today, and the last 7, 30 and 90 days (today included).
export const PERIODS = [["today", 1], ["7d", 7], ["30d", 30], ["90d", 90]];

// A stretch of agent work, split at midnights: [[day, ms], ...].
export function byDay(from, to) {
  const out = [];
  let at = from;
  while (at < to) {
    const d = new Date(at);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const end = Math.min(next, to);
    out.push([localDay(at), end - at]);
    at = end;
  }
  return out;
}

// Adds work to a task's day (ms of agent time, turns finished), keeping the last WORK_DAYS days.
export function addWork(t, day, ms = 0, turns = 0) {
  if (!t || (!ms && !turns)) return;
  const w = (t.work ??= {});
  const [m0, t0] = w[day] ?? [0, 0];
  w[day] = [m0 + Math.max(0, Math.round(ms)), t0 + turns];
  const days = Object.keys(w).sort();
  for (const old of days.slice(0, Math.max(0, days.length - WORK_DAYS))) delete w[old];
}

// Joins two tasks' work (one moved into another).
export function mergeWork(into, from) {
  for (const [day, [ms, turns]] of Object.entries(from?.work ?? {})) addWork(into, day, ms, turns);
}

// The days of a period ending today, oldest first.
export function periodDays(n, now = Date.now()) {
  const d = new Date(now);
  return Array.from({ length: n }, (_, i) => localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (n - 1 - i)).getTime()));
}

// A period's numbers. `tasks`: the world's ({ t, project }); `project`: only that project's (null:
// all). Done counts the tasks done (not dropped); Worked on, the tasks whose agents worked in the
// period.
export function summary(tasks, { days, project = null }) {
  const inPeriod = new Set(days);
  const blank = () => ({ done: 0, worked: 0, turns: 0, ms: 0 });
  const totals = blank();
  const perDay = new Map(days.map((d) => [d, { day: d, done: 0, turns: 0, ms: 0 }]));
  const perProject = new Map();
  let since = null; // the first day with agent work kept, any task
  for (const x of tasks) {
    const t = x.t;
    for (const day of Object.keys(t.work ?? {})) if (!since || day < since) since = day;
    if (project !== null && x.project !== project) continue;
    const row = perProject.get(x.project ?? null) ?? blank();
    const doneDay = t.status === "done" && !isDropped(t) && t.done_at ? localDay(t.done_at) : null;
    if (doneDay && inPeriod.has(doneDay)) {
      totals.done++; row.done++; perDay.get(doneDay).done++;
    }
    let ms = 0, turns = 0;
    for (const [day, [m, n]] of Object.entries(t.work ?? {})) {
      if (!inPeriod.has(day)) continue;
      ms += m; turns += n;
      const pd = perDay.get(day);
      pd.ms += m; pd.turns += n;
    }
    if (ms || turns) {
      totals.worked++; row.worked++;
      totals.ms += ms; row.ms += ms; totals.turns += turns; row.turns += turns;
    }
    if (row.done || row.worked) perProject.set(x.project ?? null, row);
  }
  const projects = [...perProject.entries()].map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => b.ms - a.ms || b.done - a.done || b.turns - a.turns);
  return { totals, days: [...perDay.values()], projects, since };
}
