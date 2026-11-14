// What taskr does in Herdr and git on a task's behalf.

import { run, exec, hc, knownAgents, home, focused, spaces, panes, window, terminals, shared, setShared } from "herdr";
import { untrackedName, released } from "./world.js";
import { adoptStage } from "./flow.js";
import { mergeWork } from "./stats.js";
import { git, place } from "./git.js";
import { setStatus, newTask } from "./store.js";
import { untilde, tilde, slug, projectFolder, label } from "./util.js";
import { S } from "../strings.js";

// Checkouts go where Herdr's own worktree dialog puts them, so its spaces list nests them.
const ROOT = () => `${home()}/.herdr/worktrees`;

export async function agentArgv(preferred) {
  try {
    const list = (await knownAgents()).filter((a) => a.installed && a.run?.length);
    const pick = list.find((a) => a.key === preferred) ?? list.find((a) => a.agent) ?? list[0];
    if (pick) return pick.run;
  } catch {}
  return [preferred || "claude"];
}

// How to start the agent `app` (a key of Herdr's agent menu), installed or not.
async function runOf(app) {
  try {
    const a = (await knownAgents()).find((x) => x.key === app && x.installed && x.run?.length);
    if (a) return a.run;
  } catch {}
  return [app];
}

// The model and reasoning effort an agent can be started with, by the agent's own flags: Claude
// Code (`--model`, `--effort`) and Codex (`-m`, `-c model_reasoning_effort=`). Others take neither.
export const EFFORTS = { claude: ["low", "medium", "high", "xhigh", "max"], codex: ["low", "medium", "high", "xhigh"] };
export const kindOf = (argv) => /(^|\/)(claude|codex)$/.exec(argv?.[0] ?? "")?.[2] ?? null;

export function withChoices(argv, { model = null, effort = null } = {}) {
  const kind = kindOf(argv);
  if (!kind) return argv;
  const out = [...argv];
  if (model) out.push(kind === "codex" ? "-m" : "--model", model);
  if (effort && EFFORTS[kind].includes(effort)) out.push(...(kind === "codex" ? ["-c", `model_reasoning_effort="${effort}"`] : ["--effort", effort]));
  return out;
}

// The command that continues a conversation: claude --resume <id>, codex resume <id>.
export async function resumeArgv(session) {
  const run = await runOf(session.app);
  return session.app === "codex" ? [...run, "resume", session.id] : [...run, "--resume", session.id];
}

// The space showing `folder` (or a folder inside it), preferring the selected one.
function spaceAt(folder) {
  const ps = panes();
  const inside = (p) => p && (p === folder || p.startsWith(folder + "/"));
  const list = spaces().filter((s) => !s.machine && inside(place(s, ps)));
  return list.find((s) => s.active) ?? list[0] ?? null;
}

// An agent that can work across the project's other repositories: Claude Code and
// Codex take them with --add-dir. Other programs get only the list, in the prompt.
export function withDirs(argv, dirs) {
  if (!dirs.length || !/(^|\/)(claude|codex)$/.test(argv[0] ?? "")) return argv;
  return [...argv, ...dirs.flatMap((d) => ["--add-dir", d])];
}

// Where project-wide work runs: the nearest folder holding all its repositories (~/dev),
// above them as the project is; `others`: repositories outside it, to add (none, usually).
// A project with no repositories yet, or none in common, works in the home folder.
export function projectPlace(project, h = home()) {
  if (!project) return null;
  const repos = (project.folders ?? []).map((r) => untilde(r, h));
  if (!repos.length) return { folder: h, others: [], all: [] };
  const folder = projectFolder(repos, h);
  const inside = (r) => r === folder || r.startsWith(folder + "/");
  return { folder, others: repos.filter((r) => !inside(r)), all: repos };
}

// The project's own space: named after it, in its folder. Several projects can share a
// folder (~/dev), so a space there that isn't named after this one isn't its.
export function projectSpace(project, folder) {
  const ps = panes();
  return spaces().find((s) => !s.machine && s.name === project.name && place(s, ps) === folder) ?? null;
}

// Opens a tab in the project's space (else makes the space) and remembers it, so the new
// tab's terminals get labelled taskr.project=<id> and show under the project.
export function openInProject(project) {
  const at = projectPlace(project);
  if (!at) return;
  const sp = spaces();
  const pending = { project: project.id, name: null, at: Date.now(),
    beforeSpaces: sp.map((s) => s.id), beforeTabs: sp.flatMap((s) => (s.tabs ?? []).map((t) => t.id)) };
  const space = projectSpace(project, at.folder);
  if (space) run("tab.new", { space: space.id, folder: at.folder });
  else run("space.new", { name: project.name, folder: at.folder });
  pending.space = space?.id ?? null;
  setShared("taskr.pending", [...(shared("taskr.pending") ?? []), pending]);
}

// A board is a tab whose only pane is this mod: one for every project (`project`), and one
// for all of them. Goes to the one open (tabs are told apart by name: panes() doesn't carry
// a mod's props), else makes it in the shown space.
export function openBoard(project = null) {
  const name = project ? S.boardOf(project.name) : S.board;
  const ps = panes();
  const tab = spaces().flatMap((s) => s.tabs ?? []).find((t) => t.name === name && ps.some((p) => p.tab === t.id && p.mod === "taskr"));
  const pane = tab && ps.find((p) => p.tab === tab.id && p.mod === "taskr");
  if (pane) run("pane.focus", { pane: pane.pane });
  else run("tab.new", { name, mod: "taskr", props: { role: "board", ...(project ? { project: project.id } : {}) } });
}

// Stats: one tab (a project's chosen in it, or every project's), opened or brought to the front.
export function openStats(project = null) {
  setShared("taskr.statsPick", { project: project?.id ?? null, at: Date.now() });
  const ps = panes();
  const tab = spaces().flatMap((s) => s.tabs ?? []).find((t) => t.name === S.stats && ps.some((p) => p.tab === t.id && p.mod === "taskr"));
  const pane = tab && ps.find((p) => p.tab === tab.id && p.mod === "taskr");
  if (pane) run("pane.focus", { pane: pane.pane });
  else run("tab.new", { name: S.stats, mod: "taskr", props: { role: "stats", ...(project ? { project: project.id } : {}) } });
}

// Labels a tab's terminals as the project's (shown at the project's level).
export async function labelProject(projectId, tabId, ts) {
  for (const term of ts.filter((x) => x.labels?.["herdr.tab"] === tabId && !x.address.includes("/"))) {
    try { await hc(["label", term.address, `taskr.project=${projectId}`]); } catch {}
  }
}

// A terminal in a folder, outside any task: a tab in the space already there, else a new space.
// (An agent starts from a task: Start agent, or Start with… to pick which.)
export function openHere(repoKey) {
  const folder = untilde(repoKey, home());
  const space = spaceAt(folder);
  if (space) run("tab.new", { space: space.id, folder });
  else run("space.new", { folder });
}

// Makes (or reuses) the task's worktree on branch task/<slug>. Another task with the
// same title gets its own: task/<slug>-<id end>.
async function ensureWorktree(task, others = []) {
  const h = home();
  const repo = untilde(task.folder, h);
  if (task.worktree) return { path: untilde(task.worktree, h), branch: task.branch };
  let name = slug(task.title);
  if (others.some((o) => o.id !== task.id && o.branch === `task/${name}`)) name = `${name}-${task.id.slice(-4)}`;
  const branch = `task/${name}`;
  const path = `${ROOT()}/${repo.split("/").pop()}/${name}`;
  const exists = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  const r = await git(repo, exists.ok ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path]);
  if (!r.ok && !/already exists/.test(r.err)) throw new Error(r.err || "git worktree add failed");
  return { path, branch };
}

// Starts an agent on the task. Returns what to watch for so the new tab can be
// tied to the task: { task, space | null, beforeTabs, beforeSpaces, at }.
export async function launch(store, task, { worktree = false, resume = null } = {}) {
  const h = home();
  const project = task.project ? store.data.projects.find((p) => p.id === task.project) : null;
  // A task of the whole project (no repository of its own) works across all of them,
  // resumed too: the other repositories are added again.
  const wide = !task.folder ? projectPlace(project, h) : null;
  // The agent the task was set to start with (Start with…), else the one in the settings.
  let argv = resume ? await resumeArgv(resume) : withChoices(await agentArgv(task.agent ?? store.data.settings.agent), task);
  // A resumed agent already has its conversation: no first message.
  const prompt = resume ? null : S.prompt(task, project);
  const beforeSpaces = new Set(spaces().map((s) => s.id));
  const beforeTabs = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  let folder = resume?.cwd ? untilde(resume.cwd, h) : task.worktree ? untilde(task.worktree, h) : task.folder ? untilde(task.folder, h) : wide?.folder ?? null;
  const patch = {};
  if (worktree && task.folder) {
    const wt = await ensureWorktree(task, store.data.tasks);
    folder = wt.path;
    patch.worktree = tilde(wt.path, h);
    patch.branch = wt.branch;
  }
  // Repositories outside the folder it runs in are added (resumed in one of them: the rest).
  if (wide) argv = withDirs(argv, wide.all.filter((d) => !(d === folder || d.startsWith(folder + "/"))));
  if (!folder) {
    // No folder: where the person is now.
    const f = focused();
    const s = spaces().find((x) => x.id === f?.space);
    folder = f?.cwd ?? (s ? place(s, panes()) : h);
  }
  // A task of the whole project runs in the project's own space, above its repositories.
  const own = wide && folder === wide.folder;
  const space = own ? projectSpace(project, folder) : spaceAt(folder);
  const name = task.title.slice(0, 40);
  const first = prompt ? { task: prompt } : {};
  if (space) run("tab.new", { space: space.id, name, folder, argv, ...first });
  else run("space.new", { folder, tab: name, argv, ...first, ...(own ? { name: project.name } : {}) });
  await store.update((d) => {
    const t = d.tasks.find((x) => x.id === task.id);
    if (!t) return false;
    Object.assign(t, patch);
    setStatus(t, "doing");
  });
  return { task: task.id, name, space: space?.id ?? null, beforeTabs, beforeSpaces, at: Date.now() };
}

// The tab a launch made: new since `pending`, in its space (or a new space), not
// `taken` by a task already; one named after the task first.
export function arrived(pending, sp, taken = new Set()) {
  const where = pending.space ? sp.filter((x) => x.id === pending.space) : sp.filter((x) => !pending.beforeSpaces.has(x.id));
  const fresh = where.flatMap((s) => s.tabs ?? []).filter((t) => !pending.beforeTabs.has(t.id) && !taken.has(t.id));
  return (fresh.find((t) => t.named && t.name === pending.name) ?? fresh[0])?.id ?? null;
}

// Ties a tab to a task, in the store and on its terminals (a label survives a lost store).
export async function link(store, taskId, tabId, ts) {
  await store.update((d) => {
    const t = d.tasks.find((x) => x.id === taskId);
    if (!t || t.tabs?.includes(tabId)) return false;
    (t.tabs ??= []).push(tabId);
    t.updated = Date.now();
  });
  for (const term of ts.filter((x) => x.labels?.["herdr.tab"] === tabId && !x.address.includes("/"))) {
    try { await hc(["label", term.address, `taskr.task=${taskId}`]); } catch {}
  }
}

// Makes a task of an agent's tab that belongs to none (`u` from the world's untracked list),
// tied to it: one with no plan (`auto`), named after its agent, in progress (an open agent is work
// under way). A tab opened for a whole project goes to that project, with no folder.
export async function adopt(store, u) {
  let id = null;
  const where = u.project ? { project: u.project, folder: null } : { folder: u.where.key };
  await store.update((d) => {
    // One task per tab (two looks at once, two lists). A task with no plan whose agent quit takes
    // it back: an agent started again in its tab goes on with it (in Review, it stays there).
    const had = d.tasks.find((t) => (t.tabs ?? []).includes(u.tab));
    if (had && !released(had)) return false;
    if (had) {
      setStatus(had, adoptStage(had));
      delete had.freed;
      id = had.id;
      return;
    }
    id = newTask(d, { title: untrackedName(u), ...where, status: "doing", tabs: [u.tab], auto: true }).id;
  });
  if (id) await link(store, id, u.tab, terminals());
  return id;
}

// Moves a task's tabs (its agent) into another task, and the first one goes: an agent started on
// its own, put in the task it was working for. Its conversations and agent time go along.
export async function merge(store, fromId, toId, ts) {
  const from = store.task(fromId);
  if (!from || fromId === toId) return false;
  const ok = await store.update((d) => {
    const a = d.tasks.find((t) => t.id === fromId), b = d.tasks.find((t) => t.id === toId);
    if (!a || !b) return false;
    b.tabs = [...new Set([...(b.tabs ?? []), ...(a.tabs ?? [])])];
    b.sessions = [...(b.sessions ?? []), ...(a.sessions ?? []).filter((s) => !(b.sessions ?? []).some((x) => x.id === s.id))].slice(-5);
    b.agent_ms = (b.agent_ms ?? 0) + (a.agent_ms ?? 0);
    mergeWork(b, a);
    b.updated = Date.now();
    d.tasks = d.tasks.filter((t) => t.id !== fromId);
  });
  if (!ok) return false;
  for (const tab of from.tabs ?? []) {
    for (const term of ts.filter((x) => x.labels?.["herdr.tab"] === tab && !x.address.includes("/"))) {
      try { await hc(["label", term.address, `taskr.task=${toId}`]); } catch {}
    }
  }
  return true;
}

// Deletes a task, and closes its tabs: an agent is always some task's, so it goes with it.
export async function remove(store, task) {
  const ok = await store.update((d) => {
    if (!d.tasks.some((t) => t.id === task.id)) return false;
    d.tasks = d.tasks.filter((t) => t.id !== task.id);
  });
  // Its tabs as stored, and any whose terminals still carry its label (a tab the store lost).
  const labelled = terminals().filter((x) => label(x, "task") === task.id).map((x) => x.labels["herdr.tab"]);
  if (ok) for (const tab of new Set([...(task.tabs ?? []), ...labelled].filter(Boolean))) run("tab.close", { id: tab, confirmed: true });
  return ok;
}

export async function send(address, text) {
  const r = await hc(["send", address, text]);
  return r.code === 0 ? null : (r.stderr || r.stdout || "hc send failed").trim();
}

// The pull request of the folder's branch (or of `branch`): { number, url, state, createdAt, review,
// failed: [names], pending }.
export async function pullRequest(folder, branch = null) {
  try {
    const r = await exec("gh", ["pr", "view", ...(branch ? [branch] : []), "--json", "number,url,state,createdAt,reviewDecision,statusCheckRollup"], { cwd: folder });
    if (r.code !== 0) return null;
    const d = JSON.parse(r.stdout);
    const checks = d.statusCheckRollup ?? [];
    const result = (c) => (c.conclusion ?? c.state ?? "").toUpperCase();
    return {
      number: d.number,
      url: d.url,
      state: d.state,
      createdAt: d.createdAt ?? null,
      review: d.reviewDecision,
      failed: checks.filter((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(result(c))).map((c) => c.name ?? c.context),
      pending: checks.filter((c) => ["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED"].includes(result(c))).length,
      total: checks.length,
    };
  } catch {
    return null;
  }
}

export async function issues(folder) {
  const r = await exec("gh", ["issue", "list", "--state", "open", "--limit", "50", "--json", "number,title,url,body,labels"], { cwd: folder });
  if (r.code !== 0) throw new Error((r.stderr || "gh issue list failed").trim());
  return JSON.parse(r.stdout);
}

// Done, its tabs put away, and (when asked) its worktree and branch removed.
export async function archive(store, task, { removeWorktree = false } = {}) {
  for (const tab of task.tabs ?? []) run("tab.settle", { id: tab });
  let warning = null;
  if (removeWorktree && task.worktree) {
    const h = home();
    const repo = untilde(task.folder, h);
    const r = await git(repo, ["worktree", "remove", untilde(task.worktree, h)]);
    if (!r.ok) warning = r.err;
    else if (task.branch) {
      const b = await git(repo, ["branch", "-d", task.branch]);
      if (!b.ok) warning = S.keptBranch(task.branch);
    }
  }
  await store.update((d) => {
    const t = d.tasks.find((x) => x.id === task.id);
    if (!t) return false;
    if (t.status !== "done") setStatus(t, "done");
    t.archived = true;
    if (removeWorktree && !warning) { t.worktree = null; }
  });
  return warning;
}

// A link in the system's browser.
export function openUrl(url) {
  if (!/^https?:\/\//.test(url ?? "")) return;
  const platform = window()?.platform;
  const [cmd, args] = platform === "windows" ? ["cmd", ["/c", "start", "", url]] : platform === "linux" ? ["xdg-open", [url]] : ["open", [url]];
  exec(cmd, args).catch(() => {});
}

// The repositories right inside a folder (~/dev → ~/dev/a, ~/dev/b): main checkouts, a `.git`
// folder each; hidden folders left out. Sorted by name.
export async function reposIn(folder) {
  try {
    const r = await exec("sh", ["-c", 'for d in "$1"/*/; do [ -d "$d.git" ] && printf "%s\\n" "${d%/}"; done', "sh", folder.replace(/\/+$/, "")]);
    return (r.stdout ?? "").split("\n").filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch {
    return [];
  }
}

// Takes a repository out of its project (or every project). Its tasks that only belonged to the
// project through it stay in the project.
export function removeRepo(data, repo, h) {
  const same = (r) => tilde(untilde(r, h), h) === repo;
  for (const p of data.projects) {
    if (!(p.folders ?? []).some(same)) continue;
    p.folders = p.folders.filter((r) => !same(r));
    for (const t of data.tasks) if (!t.project && t.folder && same(t.folder)) t.project = p.id;
  }
}

// Puts a repository (or any folder) in a project (it leaves the one it was in), or in none:
// before `target` (another of its folders), after it with `after`, else last. The same project
// with a target reorders its folders. Its tasks go with it: those of the project it left, and
// those in no project.
export function moveRepo(data, repo, projectId, h, { target = null, after = false } = {}) {
  const same = (r) => tilde(untilde(r, h), h) === repo;
  const was = data.projects.find((p) => (p.folders ?? []).some(same))?.id ?? null;
  for (const p of data.projects) p.folders = (p.folders ?? []).filter((r) => !same(r));
  const p = projectId && data.projects.find((x) => x.id === projectId);
  if (p) {
    const i = target ? p.folders.findIndex((r) => tilde(untilde(r, h), h) === target) : -1;
    if (i < 0) p.folders.push(repo); else p.folders.splice(i + (after ? 1 : 0), 0, repo);
  }
  for (const t of data.tasks) if (t.folder && same(t.folder) && (!t.project || t.project === was)) t.project = p ? p.id : null;
}

// Puts a task in another place of the outline: a folder (`folder`, in project `project` or none),
// or a project's own level (`folder: null`). A task with a worktree stays where it is (its
// checkout belongs to its folder).
export function moveTaskTo(data, id, { project = null, folder = null }) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t || t.worktree || (t.project === project && t.folder === folder)) return false;
  t.project = project;
  t.folder = folder;
  t.updated = Date.now();
  return true;
}
