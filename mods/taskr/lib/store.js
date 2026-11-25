// tasks.json: the person's projects and tasks. Every copy of the mod reads the
// same file; writes are compare-and-swap, so two copies never undo each other.
// People and agents edit the file by hand too: what's read is checked and
// filled in, and a file that isn't valid JSON is never written over.

import { readTextFile, writeTextFile, appHome, watchFolder } from "herdr";
import * as fs from "fs/promises";
import { uid, STATUSES, parseDue, daysUntil, byRank, reorder, localDay, stageOf } from "./util.js";
import { S } from "../strings.js";
import { WORK_DAYS } from "./stats.js";

export const DIR = () => `${appHome()}/data/taskr`;
// Where taskr kept its files when it was called tasker (before 1.6).
const OLD_DIR = () => `${appHome()}/data/tasker`;
export const FILE = () => `${DIR()}/tasks.json`;

// `park_after`: minutes a task (planned or not) stays with its agent idle (seen, waiting
// for you) before it's parked until that agent works again; 0: never (the default).
export const PARK_AFTER = [0, 60, 120, 240, 480, 1440, 2880, 4320, 10080];
// What the status bar shows (the ones that need you always do).
export const BAR_ITEMS = ["done", "turns", "working", "open"];
// What Stats shows besides agent time and the tasks worked on.
export const STATS_ITEMS = ["done", "turns"];
export const DEFAULTS = { agent: "claude", usage: false, reminders: true, revive: true, park_after: 0, activity: false };
const EMPTY = () => ({ version: 1, settings: { ...DEFAULTS }, projects: [], tasks: [] });

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const strOrNull = (v) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);
const list = (v) => (Array.isArray(v) ? v : []);
const OPEN_BEFORE = ["inbox", "next", "doing", "waiting", "review"];
// What a status change records: the stages, Dropped, and Waiting from files before 1.7.
const HISTORY = [...STATUSES, "dropped", "waiting"];
const PRIORITY = { high: 1, normal: 2, low: 3, p1: 1, p2: 2, p3: 3 };

// A task's work per day as stats read it: days with two counts, the last WORK_DAYS.
function cleanWork(w) {
  if (!w || typeof w !== "object" || Array.isArray(w)) return null;
  const days = Object.keys(w).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Array.isArray(w[d])).sort().slice(-WORK_DAYS);
  if (!days.length) return null;
  return Object.fromEntries(days.map((d) => [d, [Math.max(0, num(w[d][0], 0)), Math.max(0, Math.round(num(w[d][1], 0)))]]));
}

// One task as the views expect it, whatever was in the file.
export function cleanTask(t) {
  const now = Date.now();
  // Files from before 1.7: Dropped was a status (now Done with an outcome), and Waiting too (now
  // parked, waiting on someone, back on its day: three days after it began waiting). A task with
  // no plan that was Idle (its agent seen, waiting for you) is parked until its agent works, in progress.
  const waited = t.status === "waiting";
  const idled = t.auto === true && t.idle === true && OPEN_BEFORE.includes(t.status);
  const status = waited || (idled && ["inbox", "next"].includes(t.status)) ? "doing" : t.status === "dropped" ? "done" : STATUSES.includes(t.status) ? t.status : "inbox";
  const dropped = t.status === "dropped" || (status === "done" && t.outcome === "dropped");
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? v : null);
  const snooze = t.snooze === "someday" || t.snooze === "agent" ? t.snooze : day(t.snooze)
    ?? (waited ? localDay(num(list(t.history).at(-1)?.at, num(t.updated, now)) + 3 * 86400000) : idled ? "agent" : null);
  const p = PRIORITY[str(t.priority).toLowerCase()] ?? num(t.priority, 2);
  // Only absolute dates: a word like "tomorrow" in the file would move every day.
  const due = /^\d{4}-\d{1,2}-\d{1,2}$/.test(str(t.due).trim()) ? parseDue(t.due) : null;
  const { auto: _auto, idle: _idle, freed: _freed, repo: _repo, outcome: _outcome, waiting_on: _wo, agent: _ag, model: _mo, effort: _ef, work: _work, turn_at: _turn, ...rest } = t;
  return {
    ...rest,
    id: str(t.id) || uid(),
    title: str(t.title).trim() || "Untitled",
    project: strOrNull(t.project),
    // Where it is: a folder (a git repository or not). `repo` is its name in files from before.
    folder: strOrNull(t.folder ?? t.repo),
    status,
    ...(dropped ? { outcome: "dropped" } : {}),
    // Its place in every list, set by dragging (lower first). A task without one (written by
    // hand or by an agent, or from before) gets one on reading; `priority` only says where.
    rank: Number.isFinite(Number(t.rank)) && t.rank !== null && t.rank !== "" ? Number(t.rank) : null,
    ...(t.rank == null || t.rank === "" ? { priority: [1, 2, 3].includes(p) ? p : 2 } : {}),
    due: due ?? null,
    estimate: strOrNull(t.estimate),
    next_step: str(t.next_step),
    notes: str(t.notes),
    issue: t.issue && typeof t.issue === "object" && t.issue.number != null ? { ...t.issue, url: str(t.issue.url) } : null,
    // Made by taskr for an agent's tab (a task with no plan): named after its agent, until the
    // person changes anything on it. `freed`: its agent quit, and its tabs are terminals again.
    ...(t.auto === true ? { auto: true } : {}),
    ...(t.freed === true ? { freed: true } : {}),
    // Parked: until a day, "someday" or "agent"; waiting on someone (a name, or "" for anyone);
    // and the last day a due reminder went out.
    snooze,
    ...(snooze && (typeof t.waiting_on === "string" || waited) ? { waiting_on: str(t.waiting_on).trim() } : {}),
    reminded: /^\d{4}-\d{2}-\d{2}$/.test(str(t.reminded)) ? t.reminded : null,
    // How its agent starts (Start with…): an agent of Herdr's menu, a model, a reasoning effort.
    ...Object.fromEntries(["agent", "model", "effort"].filter((k) => strOrNull(t[k])).map((k) => [k, strOrNull(t[k]).trim()])),
    worktree: strOrNull(t.worktree),
    branch: strOrNull(t.branch),
    tabs: list(t.tabs).filter((x) => typeof x === "string"),
    created: num(t.created, now),
    updated: num(t.updated, num(t.created, now)),
    done_at: t.done_at == null ? null : num(t.done_at, null),
    agent_ms: num(t.agent_ms, 0),
    // Its agents' work per day (lib/stats.js): { "YYYY-MM-DD": [ms, turns] }.
    ...(cleanWork(t.work) ? { work: cleanWork(t.work) } : {}),
    // When its agent last ended a turn (working, then finished or idle): Now's Finished holds it
    // till you choose a stage after that. An agent that opens idle (a restart) ends no turn.
    ...(Number.isFinite(Number(t.turn_at)) && t.turn_at > 0 ? { turn_at: Number(t.turn_at) } : {}),
    history: list(t.history).filter((h) => h && HISTORY.includes(h.s)).map((h) => ({ s: h.s, at: num(h.at, now) })),
    // Agent conversations it had, newest last, to resume after a restart.
    sessions: list(t.sessions).filter((x) => x && ["claude", "codex"].includes(x.app) && typeof x.id === "string" && /^[\w-]+$/.test(x.id))
      .map((x) => ({ app: x.app, id: x.id, cwd: strOrNull(x.cwd),
        // What it ran with, to resume it so: flags, model and effort (lib/actions.js resumeChoices).
        ...(list(x.flags).length && list(x.flags).every((f) => typeof f === "string") ? { flags: list(x.flags) } : {}),
        ...(typeof x.model === "string" && x.model ? { model: x.model } : {}),
        ...(typeof x.effort === "string" && /^[a-z]+$/.test(x.effort) ? { effort: x.effort } : {}),
        at: num(x.at, now) })).slice(-5),
  };
}

export function cleanProject(p) {
  // `paused`: put aside for now; its tasks leave Now (unless an agent needs you or works, or they're
  // parked: those stay in Later) and it
  // waits folded at the end of Projects. A `color` from before stays in the file, unused.
  // Its folders (git repositories or not); `repos` in files from before. `paused_auto`: when taskr
  // paused it for having nothing going on (it comes back by itself); `active_at`: since when it's
  // active (made, or made active again).
  const { repos: _repos, paused_auto: _pa, active_at: _aa, ...rest } = p;
  // A project taskr paused by itself (before 1.7.9, for being quiet) stays paused, now as a pause of
  // yours: nothing comes back by itself, as with what's in Later.
  const paused = p.paused === true;
  return { ...rest, id: str(p.id) || uid(), name: str(p.name).trim() || "Untitled", folders: list(p.folders ?? p.repos).filter((r) => typeof r === "string"), paused,
    ...(Number.isFinite(Number(p.active_at)) && p.active_at ? { active_at: Number(p.active_at) } : {}) };
}

// Every task gets a place: one without (hand-written, an agent's, a file from before ranks)
// goes last, or first when its priority is high (1 / "high"); several in the old order
// (priority, due date, oldest), so a file from before keeps its order. Deterministic: the
// same file reads the same until it's written.
export function rankTasks(tasks) {
  const ranked = tasks.filter((t) => t.rank != null);
  const legacy = (a, b) => (a.priority ?? 2) - (b.priority ?? 2) || (daysUntil(a.due) ?? 9999) - (daysUntil(b.due) ?? 9999) || (a.created ?? 0) - (b.created ?? 0);
  const unranked = tasks.filter((t) => t.rank == null).sort(legacy);
  if (unranked.length) {
    const first = unranked.filter((t) => t.priority === 1), last = unranked.filter((t) => t.priority !== 1);
    let lo = ranked.length ? Math.min(...ranked.map((t) => t.rank)) : 1;
    let hi = ranked.length ? Math.max(...ranked.map((t) => t.rank)) : 0;
    for (const t of [...first].reverse()) t.rank = --lo;
    for (const t of last) t.rank = ++hi;
  }
  for (const t of tasks) delete t.priority;
  return tasks;
}

// Two tasks with one id (two hand-made entries in the same second) would be one
// task to every view: the later ones get "-2", "-3", the same on every read.
function unique(tasks) {
  const seen = new Set();
  for (const t of tasks) {
    let id = t.id, n = 1;
    while (seen.has(id)) id = `${t.id}-${++n}`;
    t.id = id;
    seen.add(id);
  }
  return tasks;
}

export function parse(text) {
  if (!text) return EMPTY();
  const d = JSON.parse(text);
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("not a JSON object");
  const settings = { ...DEFAULTS, ...(d.settings && typeof d.settings === "object" ? d.settings : {}) };
  // Gone in 1.7.9: the in-progress limit, days without movement, and quiet projects pausing by
  // themselves (parking idle agents does that job, task by task).
  delete settings.wip;
  delete settings.stale_days;
  delete settings.pause_after;
  settings.agent = str(settings.agent) || DEFAULTS.agent;
  settings.usage = settings.usage === true; // off unless turned on: it starts a `claude` now and then
  settings.reminders = settings.reminders !== false;
  settings.revive = settings.revive !== false;
  // Every agent's tab is a task now: the old switch is gone.
  delete settings.track;
  // Before 1.7 a task with no plan left To review after `review_after`: it's gone (tasks no
  // longer go to Review when their agent stops), and parking idle agents is off unless chosen.
  // Who had it set keeps the habit: Idle after an hour becomes parked after an hour.
  if (d.settings?.park_after == null && num(d.settings?.review_after, 0) > 0) settings.park_after = PARK_AFTER.find((m) => m >= num(d.settings.review_after)) ?? 1440;
  delete settings.review_after;
  settings.park_after = PARK_AFTER.includes(num(settings.park_after, -1)) ? num(settings.park_after) : DEFAULTS.park_after;
  settings.activity = settings.activity === true; // the detail's list of status changes: off unless turned on
  const bar = settings.bar && typeof settings.bar === "object" ? settings.bar : {};
  settings.bar = Object.fromEntries(BAR_ITEMS.map((k) => [k, bar[k] !== false])); // every item shown unless turned off
  const stats = settings.stats && typeof settings.stats === "object" ? settings.stats : {};
  settings.stats = Object.fromEntries(STATS_ITEMS.map((k) => [k, stats[k] !== false]));
  const obj = (x) => x && typeof x === "object" && !Array.isArray(x);
  return {
    ...d,
    version: d.version ?? 1,
    settings,
    projects: list(d.projects).filter(obj).map(cleanProject),
    // A deleted task is gone (older files kept it marked `deleted`).
    tasks: rankTasks(unique(list(d.tasks).filter((t) => obj(t) && t.deleted !== true).map(cleanTask))),
  };
}

// Brings tasker's files over the first time (tasks, conversations to resume, the Linear key);
// the old folder stays as it was.
export async function moveIn() {
  for (const name of ["tasks.json", "terminals.json", "linear-key"]) {
    const read = async (path) => { try { return await readTextFile(path); } catch { return null; } };
    if (await read(`${DIR()}/${name}`)) continue;
    const old = await read(`${OLD_DIR()}/${name}`);
    // Written only where there's nothing yet (compare-and-swap against no file).
    if (old) { try { await writeTextFile(`${DIR()}/${name}`, old, null); } catch {} }
  }
}

export class Store {
  constructor() {
    this.data = EMPTY();
    this.text = null; // what the file held when last read or written
    this.loaded = false;
    this.error = null;
  }

  async load() {
    let text;
    try {
      text = await readTextFile(FILE());
    } catch (e) {
      this.error = S.storeBad(e?.message ?? e);
      this.loaded = true;
      return;
    }
    try {
      this.data = parse(text);
      this.text = text;
      this.error = null;
    } catch (e) {
      // Keep showing the last good data; say what's wrong.
      this.text = text;
      this.error = S.storeBad(e?.message ?? e);
    }
    this.loaded = true;
  }

  // Reloads whenever the file changes (another copy, an agent, a hand edit), and
  // redraws after its own writes too: the watch can't tell those apart from no change.
  watch(cx) {
    cx.spawn(async (cx) => {
      this.changed = () => cx.notify();
      try { await fs.mkdir(DIR(), { recursive: true }); } catch {}
      await moveIn();
      await this.load();
      cx.notify();
      for (;;) {
        // The folder also holds each copy's localStorage: only tasks.json matters.
        let changed;
        try { changed = await watchFolder(DIR()); } catch { return; }
        if (!changed.some((p) => p.endsWith("tasks.json") || p === DIR())) continue;
        const before = this.text;
        await this.load();
        if (this.text !== before) cx.notify();
      }
    });
  }

  // Applies `fn` to a fresh copy and writes it; on a stale snapshot, rereads and retries.
  // Returns true when written. A file that can't be parsed is left alone.
  async update(fn) {
    for (let i = 0; i < 4; i++) {
      let current, data;
      try {
        current = await readTextFile(FILE());
        data = parse(current);
      } catch (e) {
        this.fail(S.storeBad(e?.message ?? e));
        return false;
      }
      if (fn(data) === false) return false;
      const text = JSON.stringify(data, null, 1) + "\n";
      let written = false;
      try {
        await writeTextFile(FILE(), text, current);
        written = true;
      } catch {
        // Someone wrote in between: read again.
      }
      if (written) {
        this.data = data;
        this.text = text;
        this.error = null;
        this.changed?.();
        return true;
      }
    }
    this.fail(S.storeBusy);
    return false;
  }

  // Shows what went wrong, redrawing only when it's news: a render that retries a
  // failing write must not loop.
  fail(error) {
    if (this.error === error) return;
    this.error = error;
    this.changed?.();
  }

  task(id) {
    return this.data.tasks.find((t) => t.id === id) ?? null;
  }

  project(id) {
    return this.data.projects.find((p) => p.id === id) ?? null;
  }
}

// Mutations on a data object (used inside Store.update).

export function newTask(data, fields) {
  const now = Date.now();
  const t = {
    id: uid(),
    title: "",
    project: null,
    folder: null,
    status: "inbox",
    rank: Math.max(0, ...data.tasks.map((x) => (Number.isFinite(x.rank) ? x.rank : 0))) + 1, // last
    due: null,
    estimate: null,
    next_step: "",
    notes: "",
    issue: null,
    worktree: null,
    branch: null,
    tabs: [],
    created: now,
    updated: now,
    done_at: null,
    agent_ms: 0,
    history: [{ s: fields.status ?? "inbox", at: now }],
    ...fields,
  };
  data.tasks.push(t);
  return t;
}

// The person changed something on a task: one with no plan becomes theirs (kept, named as it is).
export function kept(t) {
  if (t) delete t.auto;
  return t;
}

// To a stage, or "dropped" (Done, not done). Started or closed: no longer parked.
export function setStatus(t, status, now = Date.now()) {
  if (!t || stageOf(t) === status) return false;
  const drop = status === "dropped";
  t.status = drop ? "done" : status;
  if (drop) t.outcome = "dropped"; else delete t.outcome;
  delete t.idle;
  t.updated = now;
  t.done_at = t.status === "done" ? now : null;
  // Starting or closing unparks; any stage does for one parked until its agent works (parked by
  // taskr for being idle): a stage chosen is a decision about it. A day you set stays.
  if (["doing", "done"].includes(t.status) || t.snooze === "agent") unpark(t);
  (t.history ??= []).push({ s: status, at: now });
  if (t.history.length > 60) t.history.splice(0, t.history.length - 60);
  return true;
}

// Parks a task until a day, "someday" or "agent"; `who`: waiting on someone ("" for anyone).
export function park(t, snooze, who = null) {
  if (!t) return false;
  t.snooze = snooze;
  if (who == null) delete t.waiting_on; else t.waiting_on = String(who).trim();
  return true;
}

export function unpark(t) {
  if (!t) return false;
  const was = t.snooze != null;
  t.snooze = null;
  delete t.waiting_on;
  return was;
}

// Dragged onto `target` in a list showing `ids` in order: it takes that place there, the
// list's tasks sharing out the places they had (and its own), so nothing else moves.
export function moveTask(data, id, ids, target) {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  if (!byId.has(id) || !byId.has(target) || id === target) return false;
  // Two tasks in one place (copied by hand): every task gets its own first.
  const ranks = data.tasks.map((t) => t.rank);
  if (new Set(ranks).size !== ranks.length || ranks.some((r) => !Number.isFinite(r))) {
    [...data.tasks].sort(byRank).forEach((t, i) => { t.rank = i + 1; });
  }
  const order = reorder(ids.filter((x) => byId.has(x)), id, target);
  const places = order.map((x) => byId.get(x).rank).sort((a, b) => a - b);
  order.forEach((x, i) => { byId.get(x).rank = places[i]; });
  return true;
}

// First in every list.
export function toTop(data, id) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) return false;
  const lo = Math.min(...data.tasks.filter((x) => x !== t && Number.isFinite(x.rank)).map((x) => x.rank));
  if (Number.isFinite(lo) && t.rank < lo) return false;
  t.rank = (Number.isFinite(lo) ? lo : 1) - 1;
  return true;
}

// Paused or active by the person: a pause of theirs stays until they lift it, and an active
// project counts its quiet days from now.
export function setPaused(p, paused, now = Date.now()) {
  if (!p) return false;
  p.paused = paused;
  delete p.paused_auto;
  if (!paused) p.active_at = now;
}

export function newProject(data, fields) {
  const p = { id: uid(), name: "", folders: [], paused: false, active_at: Date.now(), ...fields };
  data.projects.push(p);
  return p;
}
