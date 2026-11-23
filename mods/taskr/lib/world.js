// Joins the person's tasks with what Herdr shows now: which spaces are which
// repo, which tabs belong to which task, and which agents work in them.

import { place } from "./git.js";
import { report, word } from "./agentinfo.js";
import { tilde, untilde, base, OPEN, RANK, byRank, isLater, projectFolder, label } from "./util.js";
import { nowSection } from "./flow.js";
import { S } from "../strings.js";

// The state an agent shows in its terminal's title when it reports none to Herdr: Claude
// Code puts a spinner first while it works (◐◓◑◒, or braille) and ✳ when it stops.
export function titleState(title) {
  const c = String(title ?? "").codePointAt(0);
  if (c == null) return null;
  if ((c >= 0x25d0 && c <= 0x25d3) || (c >= 0x2801 && c <= 0x28ff)) return "working";
  if (c === 0x2733) return "idle";
  return null;
}

// An agent in front of a terminal: Herdr's program table says so, or its command is one.
export const agentInFront = (t) => Boolean(t?.program?.agent) || /(^|\/)(claude|codex)$/.test(t?.foreground?.argv?.[0] ?? "");

// The terminal's own shell is in front again: the agent it ran has quit (or never ran). A remote
// terminal, or one that doesn't say, counts as still running its agent.
// Claude Code in front that reports no state to Herdr: it asks the terminal once, as it starts, and
// stays silent for the whole session if no answer came in time (a dozen agents starting at once).
// `claude attach` never reports, by design: not this.
export const unreported = (e) => Boolean(e?.quiet) && /(^|\/)claude$/.test(e?.term?.foreground?.argv?.[0] ?? "")
  && e.term.foreground.argv[1] !== "attach";

// The folder a terminal works in: its program's in front (an agent started after a `cd`), else the
// terminal's own, which can stay where its shell began.
export const workDir = (t) => t?.foreground?.cwd ?? t?.cwd ?? null;

export const shellOnly = (t) => Boolean(t?.foreground) && t.pid != null && t.foreground.pid === t.pid && !agentInFront(t);

// A task whose agent quit: its tabs are no longer its own (terminals again). Planned or not; a
// closed task with no plan lets go of them too.
export const released = (t) => t?.freed === true || (t?.auto === true && !OPEN.has(t.status));

// Live sub-agents of `addr`, depth first.
function kids(ts, addr, depth = 1) {
  return ts.filter((k) => k.parent === addr && k.state === "live")
    .flatMap((k) => [{ term: k, depth }, ...kids(ts, k.address, depth + 1)]);
}

export function build({ data, sp, ps, ag, ts, repos, h, titles = null }) {
  const termBy = new Map(ts.map((t) => [t.address, t]));
  const agentStatus = new Map(ag.map((a) => [a.address, a.status]));

  // Spaces and the repo each is in now (a worktree counts as its main repo).
  const spaces = sp.map((s) => {
    const folder = place(s, ps);
    const on = s.machine ?? null;
    const repo = folder ? repos.get(folder, on) : undefined;
    const key = repo?.main ? tilde(repo.main, h) : folder ? tilde(folder, h) : null;
    return { s, folder, on, repo, key };
  });
  const spaceOfTab = new Map();
  for (const x of spaces) for (const tab of x.s.tabs ?? []) spaceOfTab.set(tab.id, { ...x, tab });

  // Agents by tab, each with its terminal and sub-agents.
  const byTab = new Map();
  for (const a of ag) {
    const term = termBy.get(a.address) ?? null;
    // Herdr can keep listing an agent that quit: with its shell back in front, it's none.
    if (shellOnly(term)) continue;
    const entry = { a, term, status: a.status, report: report(term), subs: kids(ts, a.address) };
    for (const k of entry.subs) {
      const s = agentStatus.get(k.term.address) ?? word(k.term);
      if ((RANK[s === "error" ? "blocked" : s] ?? 0) > (RANK[entry.top ?? entry.status] ?? 0)) entry.top = s === "error" ? "blocked" : s;
    }
    entry.top ??= entry.status;
    if (!byTab.has(a.tab)) byTab.set(a.tab, []);
    byTab.get(a.tab).push(entry);
  }

  // Agents that report no state (Claude Code attached to its background session with
  // `claude attach`): a pane whose program is an agent still counts as one, state unknown.
  const reporting = new Set(ag.map((a) => a.address));
  for (const p of ps) {
    if (!p.terminal || reporting.has(p.terminal)) continue;
    const term = termBy.get(p.terminal) ?? null;
    // What's in front decides: a shell is none (its `app` can linger from an agent that quit);
    // otherwise an agent by Herdr's table, its report, or its program (claude, codex).
    const prog = p.program ?? term?.program;
    if (!prog || prog.shell || shellOnly(term) || !(prog.agent || p.app || ["claude", "codex"].includes(prog.key))) continue;
    // Its state from its title (working, idle): as given, else as read from the core
    // (Herdr hands mods the title without the mark), else unknown.
    const status = titleState(term?.title ?? p.title) ?? titles?.get(p.terminal) ?? "unknown";
    const a = { address: p.terminal, pane: p.pane, tab: p.tab, status, app: p.app ?? null, program: p.program ?? term?.program, title: p.title };
    const entry = { a, term, status, top: status, quiet: true, report: report(term), subs: kids(ts, p.terminal) };
    if (!byTab.has(p.tab)) byTab.set(p.tab, []);
    byTab.get(p.tab).push(entry);
  }

  // Tasks and their tabs: as stored, plus terminals labelled with a task (a tab the store lost).
  const tasks = data.tasks.filter((t) => !t.deleted).map((t) => ({ t, tabs: [...(t.tabs ?? [])] }));
  const taskById = new Map(tasks.map((x) => [x.t.id, x]));
  for (const term of ts) {
    const id = label(term, "task"), tab = term.labels?.["herdr.tab"];
    const x = id && taskById.get(id);
    if (x && tab && !x.tabs.includes(tab)) x.tabs.push(tab);
  }
  // A task with no plan lets go of its tabs once it's closed (its agent quit): what's left in
  // them is a terminal like any other, and an agent started there again takes the task back up.
  const taskOfTab = new Map();
  for (const x of tasks) if (!released(x.t)) for (const tab of x.tabs) taskOfTab.set(tab, x);

  const projectOfRepo = new Map();
  for (const p of data.projects) for (const r of p.folders ?? []) projectOfRepo.set(tilde(untilde(r, h), h), p.id);
  // A tab opened for a whole project: its terminals carry taskr.project=<id>; else its
  // space is the project's own (named after it, in the folder above its repositories).
  const labelled = new Map();
  for (const term of ts) {
    const id = label(term, "project"), tab = term.labels?.["herdr.tab"];
    if (id && tab) labelled.set(tab, id);
  }
  const roots = data.projects.map((p) => {
    const repos = (p.folders ?? []).map((r) => untilde(r, h));
    const dir = projectFolder(repos, h);
    return { id: p.id, name: p.name, key: dir ? tilde(dir, h) : null };
  });
  const known = new Set(data.projects.map((p) => p.id));
  const projectOfTab = (tab, where) => {
    const id = labelled.get(tab);
    if (id && known.has(id)) return id;
    if (where.on) return null;
    // Its space, by name: in the project's folder, or in one that's no repository (the
    // folder moves when the project's repositories change: ~ while it has none).
    return roots.find((r) => where.s.name === r.name && ((r.key && r.key === where.key) || (where.key && !where.repo?.main)))?.id ?? null;
  };

  for (const x of tasks) {
    // A task with no plan whose agent quit has none: an agent started again in its tab is taken up
    // by adoption (actions.adopt), not seen here first.
    x.agents = released(x.t) ? [] : x.tabs.flatMap((tab) => byTab.get(tab) ?? []);
    x.live = released(x.t) ? [] : x.tabs.filter((tab) => spaceOfTab.has(tab));
    x.top = x.agents.reduce((m, e) => ((RANK[e.top] ?? 0) > (RANK[m] ?? 0) ? e.top : m), null);
    x.project = x.t.project ?? (x.t.folder ? projectOfRepo.get(x.t.folder) ?? null : null);
    x.open = OPEN.has(x.t.status);
    // The folder its work is in now (its agent's, else a terminal's in its open tabs) and the
    // repository there: a task may name none (a project's own space) and still be in one.
    const tab = x.live.find((tb) => ps.some((p) => p.tab === tb && p.cwd));
    x.folderOn = tab ? spaceOfTab.get(tab)?.on ?? null : null;
    x.folder = x.agents.map((e) => workDir(e.term)).find(Boolean) ?? (tab ? ps.find((p) => p.tab === tab && p.cwd).cwd : null);
    x.repoHere = x.folder ? repos.get(x.folder, x.folderOn)?.main ?? null : null;
  }

  // Tabs that belong to no task: plain terminals, and an agent's for the moment before its task is made.
  const untracked = [];
  for (const [tab, where] of spaceOfTab) {
    if (taskOfTab.has(tab)) continue;
    const entries = byTab.get(tab) ?? [];
    const tabPanes = ps.filter((p) => p.tab === tab && p.terminal);
    if (!entries.length && !tabPanes.length) continue;
    const folder = workDir(entries[0]?.term) ?? tabPanes.find((p) => p.cwd)?.cwd ?? where.folder ?? null;
    const repoHere = folder ? repos.get(folder, where.on)?.main ?? null : null;
    untracked.push({ tab, where, agents: entries, panes: tabPanes, folder, repoHere, project: projectOfTab(tab, where), top: entries.reduce((m, e) => ((RANK[e.top] ?? 0) > (RANK[m] ?? 0) ? e.top : m), null) });
  }

  return { spaces, spaceOfTab, byTab, tasks, taskById, taskOfTab, projectOfRepo, untracked, termBy };
}

// The ids of the projects put aside for now.
export const pausedProjects = (data) => new Set(data.projects.filter((p) => p.paused).map((p) => p.id));

// Now's lists: what the agents ask of you (needs you, finished, working), what's yours to do next,
// then what's parked. Each task once.
export const NOW_SECTIONS = ["needs", "finished", "working", "next", "later"];

// `turnAt(x)`: when its agent's last turn ended (see flow.js `nowSection`).
export function nowView(w, data, turnAt = () => null) {
  const lists = Object.fromEntries(NOW_SECTIONS.map((k) => [k, []]));
  // A paused project's work is out of Now, but for an agent that needs you or works, and what you
  // parked: it stays in Later, where you put it (put aside already, not twice).
  const paused = pausedProjects(data);
  for (const x of w.tasks) {
    const at = nowSection(x, turnAt(x));
    if (!at || (paused.has(x.project) && !["blocked", "working"].includes(x.top) && at !== "later")) continue;
    lists[at].push(x);
  }
  for (const k of NOW_SECTIONS) if (k !== "later") lists[k].sort((a, b) => byRank(a.t, b.t));
  // Finished is a queue: the turn that ended last on top. Seeing one doesn't move it (it stays,
  // no longer bold); it goes down as other turns end.
  lists.finished.sort((a, b) => (turnAt(b) ?? 0) - (turnAt(a) ?? 0) || byRank(a.t, b.t));
  // Soonest back first; "until its agent works", then someday, last.
  const back = (t) => (t.snooze === "someday" ? 2 : t.snooze === "agent" ? 1 : 0);
  lists.later.sort((a, b) => back(a.t) - back(b.t) || String(a.t.snooze).localeCompare(String(b.t.snooze)) || byRank(a.t, b.t));
  // Every agent is in a task (the sidebar makes one as it starts): terminals in no task are
  // shells, and those live in Projects, under their folder.
  return lists;
}

// The Projects outline: project → repo → tasks (+ untracked tabs).
export function projectTree(w, data, h) {
  // Open tasks, and finished ones whose terminals are still open (work you can still see); every
  // closed task is on the board's Done column.
  const show = (x) => x.open || (!x.t.archived && x.live.length > 0);
  const repoNode = (key) => ({
    key,
    name: base(key),
    spaces: w.spaces.filter((s) => s.key === key),
    tasks: [],
    // A tab opened for a project shows at the project's level, wherever its shell went.
    untracked: w.untracked.filter((u) => !u.project && u.where.key === key),
  });
  const projects = data.projects.map((p) => {
    const repos = new Map((p.folders ?? []).map((r) => { const k = tilde(untilde(r, h), h); return [k, repoNode(k)]; }));
    return { p, repos, loose: [], untracked: w.untracked.filter((u) => u.project === p.id) };
  });
  const byId = new Map(projects.map((x) => [x.p.id, x]));
  const orphan = { p: null, repos: new Map(), loose: [], untracked: [] };
  for (const x of w.tasks) {
    if (!show(x)) continue;
    const home = (x.project && byId.get(x.project)) || orphan;
    if (x.t.folder) {
      if (!home.repos.has(x.t.folder)) home.repos.set(x.t.folder, repoNode(x.t.folder));
      home.repos.get(x.t.folder).tasks.push(x);
    } else home.loose.push(x);
  }
  // Open repos in no project, when something there belongs to no task: a space
  // whose tabs are all some task's shows up under that task instead.
  for (const s of w.spaces) {
    if (!s.key || w.projectOfRepo.has(s.key) || orphan.repos.has(s.key)) continue;
    if (!w.untracked.some((u) => !u.project && u.where.key === s.key)) continue;
    if (projects.some((x) => x.repos.has(s.key))) continue;
    orphan.repos.set(s.key, repoNode(s.key));
  }
  // Open first, then the order you set (dragging a row moves it there).
  const order = (list) => list.sort((a, b) => (OPEN.has(a.t.status) ? 0 : 1) - (OPEN.has(b.t.status) ? 0 : 1) || byRank(a.t, b.t));
  for (const x of [...projects, orphan]) {
    x.loose = order(x.loose);
    for (const r of x.repos.values()) r.tasks = order(r.tasks);
    // What's under it: tasks, and tabs that belong to no task.
    const repos = [...x.repos.values()];
    x.count = x.loose.length + x.untracked.length + repos.reduce((n, r) => n + r.tasks.length + r.untracked.length, 0);
    x.top = [...x.loose, ...x.untracked, ...repos.flatMap((r) => [...r.tasks, ...r.untracked])].reduce((m, t) => ((RANK[t.top] ?? 0) > (RANK[m] ?? 0) ? t.top : m), null);
  }
  // Active projects in your order; paused ones apart (Projects folds them at the end).
  return { projects: projects.filter((x) => !x.p.paused), paused: projects.filter((x) => x.p.paused), orphan };
}

// An agent's own title (what it calls its work), unless it's only its address.
export function agentTitle(e) {
  const addresses = new Set([e?.a?.address, e?.a?.address?.split("/").pop()].filter(Boolean));
  const t = [e?.term?.title, e?.a?.title].map((x) => String(x ?? "").trim()).find((x) => x && !addresses.has(x));
  return t || null;
}

// A tab outside any task, by what people recognise: its name, the agent's title,
// else the program and the folder it's in (never a bare address like "t4").
export function untrackedName(u) {
  if (u.where.tab.named && u.where.tab.name) return u.where.tab.name;
  const e = u.agents[0];
  const p0 = u.panes[0];
  // A shell's title is often just its address ("t4", "vps/t1q"): not a name.
  const addresses = new Set([e?.a.address, p0?.terminal].filter(Boolean).flatMap((a) => [a, a.split("/").pop()]));
  const isAddress = (x) => !x || addresses.has(x);
  const title = [e?.term?.title, e?.a.title, p0?.title].find((x) => !isAddress(x));
  if (title) return title;
  const prog = e?.a.program ?? p0?.program;
  const folder = base(workDir(e?.term) ?? p0?.cwd ?? "");
  const who = prog && prog.key !== "program" ? prog.name : S.terminal;
  return folder ? `${who} · ${folder}` : who;
}

// Where a row's work is, as people find it: "Project › repo", or the folder when it's in no
// repository ("General › ~", "~/notes"). `project: null` leaves the project out (a project's board).
export function whereLabel(data, { project = null, repo = null, folder = null } = {}, h = "") {
  const p = project ? data.projects.find((q) => q.id === project) : null;
  const place = repo ? base(repo) : folder ? tilde(untilde(folder, h), h) : null;
  return [p?.name, place].filter(Boolean).join(" › ") || null;
}

// A task's: the repository it names, else the one its terminal is in, else that folder.
export const taskWhere = (data, x, h, { project = true } = {}) =>
  whereLabel(data, { project: project ? x.project : null, repo: x.t.folder ?? x.repoHere, folder: x.folder }, h);

// A terminal in no task: its project (its space's, or its repository's) and where it is.
export function looseWhere(w, data, u, h, { project = true } = {}) {
  const id = u.project ?? (u.repoHere ? w.projectOfRepo.get(tilde(u.repoHere, h)) : null) ?? null;
  return whereLabel(data, { project: project ? id : null, repo: u.repoHere, folder: u.folder }, h);
}
