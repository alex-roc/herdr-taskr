// The rules under the views: dates, cleaning what's read, which tab is whose,
// what the Now view puts first, how tasks follow their agents, and what's read
// from the agents' own logs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { H, command } from "herdr";
import { parseDue, dueLabel, slug, shortModel, byRank, reorder, duration, parseLater, aside } from "../mods/taskr/lib/util.js";
import { parse, cleanTask, Store, setStatus, moveTask, toTop, newTask } from "../mods/taskr/lib/store.js";
import { build, nowView, projectTree } from "../mods/taskr/lib/world.js";
import { arrived, launch, openInProject, moveRepo } from "../mods/taskr/lib/actions.js";
import { AgentInfo } from "../mods/taskr/lib/agentinfo.js";
import { RepoCache } from "../mods/taskr/lib/git.js";
import { parseClaude, parseCodex, Usage } from "../mods/taskr/lib/usage.js";
import { isElement, walk, text } from "gpui-kit";
import { untrackedName } from "../mods/taskr/lib/world.js";
import Taskr from "../mods/taskr/main.js";
import { world, cx, settle, until, FILE, iso, task, CLAUDE_USAGE, DAY } from "./fixture.mjs";

const at = new Date(2026, 10, 7, 15, 0); // Saturday 7 Nov 2026

test("parseDue: words, shortcuts and dates", () => {
  assert.equal(parseDue("", at), null);
  assert.equal(parseDue("today", at), "2026-11-07");
  assert.equal(parseDue("Tomorrow", at), "2026-11-08");
  assert.equal(parseDue("tmr", at), "2026-11-08");
  assert.equal(parseDue("+3", at), "2026-11-10");
  assert.equal(parseDue("3d", at), "2026-11-10");
  assert.equal(parseDue("+2w", at), "2026-11-21");
  assert.equal(parseDue("sat", at), "2026-11-14", "the next one, never today");
  assert.equal(parseDue("friday", at), "2026-11-13");
  assert.equal(parseDue("mon", at), "2026-11-09");
  assert.equal(parseDue("2026-12-01", at), "2026-12-01");
  assert.equal(parseDue("2026-2-30", at), undefined);
  assert.equal(parseDue("12-24", at), "2026-12-24");
  assert.equal(parseDue("01-05", at), "2027-01-05", "a day that passed is next year's");
  assert.equal(parseDue("soon", at), undefined);
  assert.equal(parseDue("3", at), undefined, "a bare number is ambiguous");
});

test("dueLabel and friends", () => {
  assert.equal(dueLabel(iso(0)), "today");
  assert.equal(dueLabel(iso(1)), "tomorrow");
  assert.equal(dueLabel(iso(-2)), "2d late");
  assert.equal(dueLabel(iso(3)), "in 3d");
  assert.equal(dueLabel("junk"), null);
  assert.equal(slug("Árbol de decisión: ¡v2!"), "arbol-de-decision-v2");
  assert.equal(slug("!!!"), "task");
  assert.equal(shortModel("claude-opus-5-5-20261001"), "opus 5.5");
  assert.equal(shortModel("gpt-5.5-codex"), "gpt-5.5-codex");
  assert.equal(duration(30000), "<1m");
  assert.equal(duration(90 * 60000), "1h 30m");
  assert.equal(duration(3 * 86400000), "3d");
  assert.ok(byRank({ rank: 1, created: 2 }, { rank: 2, created: 1 }) < 0, "the order set first");
  assert.ok(byRank({ rank: 3, created: 1 }, { rank: 3, created: 2 }) < 0, "then oldest");
  assert.deepEqual(reorder(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"], "from above: lands below the target");
  assert.deepEqual(reorder(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"], "from below: lands above it");
  assert.deepEqual(reorder(["b", "c"], "x", "c"), ["b", "x", "c"], "from another list: above it");
});

test("order: a file from before keeps its order; a task without a place goes last, or first when high", () => {
  const now = Date.now();
  const d = parse(JSON.stringify({ tasks: [
    { id: "low", priority: 3, created: now - 5 }, { id: "high", priority: 1, created: now - 4 },
    { id: "soon", priority: 2, due: iso(1), created: now - 3 }, { id: "plain", priority: 2, created: now - 6 },
  ] }));
  const order = (data) => [...data.tasks].sort(byRank).map((t) => t.id);
  assert.deepEqual(order(d), ["high", "soon", "plain", "low"], "priority, then due date, then oldest");
  assert.ok(d.tasks.every((t) => t.priority === undefined && Number.isFinite(t.rank)), "priority isn't kept");
  // An agent adds two tasks to that file, one high.
  const raw = JSON.parse(JSON.stringify(d));
  raw.tasks.push({ id: "agent", title: "Follow-up" }, { id: "urgent", title: "Hotfix", priority: "high" });
  const e = parse(JSON.stringify(raw));
  assert.deepEqual(order(e), ["urgent", "high", "soon", "plain", "low", "agent"]);
  assert.deepEqual(order(parse(JSON.stringify(raw))), order(e), "the same file, the same order");
  // Dragged: low onto soon (from below: above it); the rest keep their places.
  assert.ok(moveTask(e, "low", ["urgent", "high", "soon", "plain", "low", "agent"], "soon"));
  assert.deepEqual(order(e), ["urgent", "high", "low", "soon", "plain", "agent"]);
  // Only the tasks of the list shown trade places.
  assert.ok(moveTask(e, "plain", ["high", "plain"], "high"));
  assert.deepEqual(order(e), ["urgent", "plain", "low", "soon", "high", "agent"]);
  assert.ok(toTop(e, "agent"));
  assert.equal(order(e)[0], "agent");
  assert.equal(toTop(e, "agent"), false, "already first");
  const t = newTask(e, { title: "New" });
  assert.equal(order(e).at(-1), t.id, "a new task goes last");
  // Two tasks in one place (copied by hand): sorted out before a move.
  e.tasks.find((x) => x.id === "soon").rank = e.tasks.find((x) => x.id === "low").rank;
  assert.ok(moveTask(e, "soon", ["low", "soon"], "low"));
  assert.deepEqual(order(e).filter((x) => ["low", "soon"].includes(x)), ["soon", "low"]);
  assert.equal(new Set(e.tasks.map((x) => x.rank)).size, e.tasks.length);
});

test("what's read is cleaned: odd values, missing fields, junk entries", () => {
  const d = parse(JSON.stringify({
    settings: { wip: "0", stale_days: "x" },
    projects: [{ id: "p" }, null, 3],
    tasks: [{ id: "a", title: 7, status: "bogus", priority: "high", due: "tomorrow", tabs: ["tb1", 2], history: [{ s: "doing", at: 1 }, { s: "?" }] }, "junk"],
  }));
  assert.equal(d.settings.wip, 1);
  assert.equal(d.settings.stale_days, 3);
  assert.equal(d.projects.length, 1);
  assert.equal(d.projects[0].name, "Untitled");
  assert.equal(d.tasks.length, 1);
  const t = d.tasks[0];
  assert.equal(t.title, "7");
  assert.equal(t.status, "inbox");
  assert.equal(t.priority, undefined);
  assert.equal(t.rank, 0, "high: before everything");
  assert.equal(t.due, null, "words aren't kept in the file: they'd move every day");
  assert.deepEqual(t.tabs, ["tb1"]);
  assert.deepEqual(t.history, [{ s: "doing", at: 1 }]);
  assert.equal(cleanTask({ due: "2026-1-5" }).due, "2026-01-05");
  const dup = parse(JSON.stringify({ tasks: [{ id: "x", title: "a" }, { id: "x", title: "b" }, { id: "x", title: "c" }] }));
  assert.deepEqual(dup.tasks.map((t) => t.id), ["x", "x-2", "x-3"], "repeated ids are told apart, the same way every time");
  assert.throws(() => parse("[]"));
});

test("files from before: repos and repo read as folders and folder, deleted tasks and the old track switch dropped", () => {
  const d = parse(JSON.stringify({ settings: { track: false }, projects: [{ id: "a", name: "A", repos: ["~/dev/x", "~/notes"] }],
    tasks: [{ id: "1", title: "One", repo: "~/dev/x" }, { id: "2", title: "Two", deleted: true }, { id: "3", title: "Three", folder: "~/notes" }] }));
  assert.deepEqual(d.projects[0].folders, ["~/dev/x", "~/notes"]);
  assert.equal("repos" in d.projects[0], false);
  assert.deepEqual(d.tasks.map((t) => [t.id, t.folder, "repo" in t]), [["1", "~/dev/x", false], ["3", "~/notes", false]]);
  assert.equal("track" in d.settings, false);
  assert.equal(d.settings.park_after, 0, "parking idle agents is off unless chosen");
  assert.equal(d.settings.pause_after, 1);
  assert.equal(parse(JSON.stringify({ settings: { park_after: 7 } })).settings.park_after, 0, "only the offered choices");
  assert.equal(parse(JSON.stringify({ settings: { park_after: 240 } })).settings.park_after, 240);
  assert.equal("review_after" in parse(JSON.stringify({ settings: { review_after: 60 } })).settings, false);
  assert.equal(parse(JSON.stringify({ settings: { review_after: 0 } })).settings.park_after, 0);
});

test("files from before 1.7: Dropped is Done with an outcome, Waiting is parked, Idle is gone", () => {
  const began = new Date(2026, 10, 1, 12).getTime();
  const d = parse(JSON.stringify({ tasks: [
    { id: "d", title: "Dropped", status: "dropped", history: [{ s: "dropped", at: 1 }] },
    { id: "w", title: "Waiting", status: "waiting", history: [{ s: "waiting", at: began }] },
    { id: "ws", title: "Waiting, someday", status: "waiting", snooze: "someday" },
    { id: "i", title: "Idle", status: "review", auto: true, idle: true },
    { id: "in", title: "Idle, adopted resting", status: "next", auto: true, idle: true },
    { id: "o", title: "Odd", status: "next", outcome: "dropped", waiting_on: "Ana" },
  ] }));
  const t = (id) => d.tasks.find((x) => x.id === id);
  assert.deepEqual([t("d").status, t("d").outcome], ["done", "dropped"]);
  assert.deepEqual(t("d").history, [{ s: "dropped", at: 1 }], "the old status change is kept");
  assert.deepEqual([t("w").status, t("w").snooze, t("w").waiting_on], ["doing", "2026-11-04", ""], "back three days after it began waiting");
  assert.deepEqual([t("ws").snooze, t("ws").waiting_on], ["someday", ""]);
  assert.equal(t("i").idle, undefined);
  assert.deepEqual([t("i").status, t("i").snooze], ["review", "agent"], "Idle: parked until its agent works");
  assert.deepEqual([t("in").status, t("in").snooze], ["doing", "agent"], "an open agent is work in progress");
  assert.equal(parse(JSON.stringify({ settings: { review_after: 60 } })).settings.park_after, 60, "who had Idle after an hour keeps it");
  assert.equal(parse(JSON.stringify({ settings: { review_after: 15 } })).settings.park_after, 60);
  assert.equal(parse(JSON.stringify({ settings: { review_after: 0 } })).settings.park_after, 0);
  assert.equal(parse(JSON.stringify({ settings: { review_after: 60, park_after: 0 } })).settings.park_after, 0, "a choice made since stays");
  assert.equal(t("o").outcome, undefined, "only a Done task is dropped");
  assert.equal(t("o").waiting_on, undefined, "only a parked task waits");
});

test("tasker's files come over to taskr the first time, and never over taskr's own", async () => {
  const { moveIn } = await import("../mods/taskr/lib/store.js");
  world();
  const old = `${H.appHome}/data/tasker`;
  H.files.set(`${old}/tasks.json`, '{"tasks":[{"id":"o1","title":"From tasker"}]}');
  H.files.set(`${old}/linear-key`, "lin_x");
  H.files.delete(FILE());
  await moveIn();
  assert.match(H.files.get(FILE()), /From tasker/);
  assert.equal(H.files.get(`${H.appHome}/data/taskr/linear-key`), "lin_x");
  H.files.set(FILE(), '{"tasks":[]}');
  await moveIn();
  assert.equal(H.files.get(FILE()), '{"tasks":[]}');
});

test("store: a fresh home starts empty and saves", async () => {
  world();
  H.files.clear();
  const s = new Store();
  await s.load();
  assert.equal(s.error, null);
  assert.equal(s.data.tasks.length, 0);
  assert.equal(await s.update((d) => { d.tasks.push(task({ id: "x" })); }), true);
  assert.equal(JSON.parse(H.files.get(FILE())).tasks[0].id, "x");
});

test("store: a file that can't be read is said once, not redrawn over and over", async () => {
  world();
  const s = new Store();
  await s.load();
  let draws = 0;
  s.changed = () => draws++;
  H.files.set(FILE(), "{ broken");
  assert.equal(await s.update((d) => { d.tasks.push(task({ id: "x" })); }), false);
  assert.equal(await s.update((d) => { d.tasks.push(task({ id: "x" })); }), false);
  assert.equal(draws, 1);
  assert.match(s.error, /can't be read/);
});

test("store: a write that races another one is retried, not lost", async () => {
  world();
  const s = new Store();
  await s.load();
  let raced = false;
  await s.update((d) => {
    if (!raced) { raced = true; const other = JSON.parse(H.files.get(FILE())); other.tasks.push(task({ id: "other" })); H.files.set(FILE(), JSON.stringify(other)); }
    d.tasks.push(task({ id: "mine" }));
  });
  const ids = JSON.parse(H.files.get(FILE())).tasks.map((t) => t.id);
  assert.ok(ids.includes("other") && ids.includes("mine"));
});

function look() {
  const w = build({ data: parse(H.files.get(FILE())), sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  return w;
}

test("world: tabs are found through the store and through terminal labels", () => {
  world();
  const w = look();
  assert.equal(w.taskById.get("doing1").tabs[0], "tb1", "label tasker.task on t1 (its name before 1.6) still counts");
  assert.equal(w.taskById.get("blocked1").top, "blocked");
  assert.equal(w.taskById.get("review1").top, "done");
  assert.ok(!w.taskById.has("del1"));
  // Sub-agents: t9 working under t2, t10 blocked under t9; the finished one is left out.
  const e = w.byTab.get("tb2")[0];
  assert.deepEqual(e.subs.map((k) => [k.term.address, k.depth]), [["t9", 1], ["t10", 2]]);
  assert.deepEqual(w.untracked.map((u) => u.tab).sort(), ["tb3", "tb4", "tb5", "tb6"]);
  // And taskr's own label.
  H.terminals.find((t) => t.address === "t4").labels["taskr.task"] = "next1";
  assert.deepEqual(look().taskById.get("next1").tabs, ["tb4"]);
});

test("Now: what needs you first, each task once", () => {
  world();
  const w = look();
  const v = nowView(w, parse(H.files.get(FILE())));
  const ids = (l) => l.map((x) => x.t.id);
  assert.deepEqual(ids(v.needs), ["blocked1"]);
  assert.deepEqual(ids(v.finished), ["review1"], "its agent finished: that comes before its stage");
  assert.deepEqual(ids(v.working).sort(), ["doing1", "remote1"]);
  assert.deepEqual(ids(v.review), []);
  assert.deepEqual(ids(v.doing), []);
  assert.deepEqual(ids(v.next), ["next2", "next1"], "a file with priorities keeps their order");
  assert.deepEqual(ids(v.inbox).sort(), ["inbox1", "inbox2"]);
  assert.deepEqual(ids(v.later), ["wait1"], "Waiting, from before, is parked");
  const all = Object.values(v).flat().map((x) => x.t.id);
  assert.equal(new Set(all).size, all.length);
  // tb4's agent has no task yet (the sidebar makes it one): never a row of Now on its own.
  assert.ok(w.untracked.some((u) => u.tab === "tb4"));
  assert.ok(!Object.values(v).flat().some((x) => x.tab === "tb4"));
});
test("Projects: repos under their project, worktrees under their repo, counts include loose tabs", () => {
  world();
  const w = look();
  const tree = projectTree(w, parse(H.files.get(FILE())), H.home);
  const app = tree.projects.find((x) => x.p.id === "pa");
  assert.deepEqual([...app.repos.keys()], ["~/dev/app"]);
  const appRepo = app.repos.get("~/dev/app");
  // review1 has no project but its repo is App's; in the order set (here, from priorities).
  assert.deepEqual(appRepo.tasks.map((x) => x.t.id), ["doing1", "blocked1", "review1"]);
  assert.equal(app.count, 3 + appRepo.untracked.length);
  assert.ok(tree.orphan.repos.has("~"), "a folder with only a loose terminal shows under No project");
  assert.ok(tree.orphan.count > 0);
});

test("untracked tabs are named by what they run, never by address", () => {
  world();
  const w = look();
  const names = Object.fromEntries(w.untracked.map((u) => [u.tab, untrackedName(u)]));
  assert.equal(names.tb4, "spike", "a named tab keeps its name");
  assert.equal(names.tb5, "zsh · web");
  assert.equal(names.tb3, "zsh · app");
});

test("arrived: the launched tab, not another new one", () => {
  const sp = [{ id: "s", tabs: [{ id: "a" }, { id: "b", named: true, name: "Fix it" }, { id: "c", named: true, name: "Other" }] }];
  const p = { space: "s", name: "Fix it", beforeTabs: new Set(["a"]), beforeSpaces: new Set(["s"]) };
  assert.equal(arrived(p, sp), "b");
  assert.equal(arrived({ ...p, name: "Nope" }, sp, new Set(["b"])), "c", "taken tabs are skipped");
  assert.equal(arrived({ space: null, name: "x", beforeTabs: new Set(), beforeSpaces: new Set(["s"]) }, [...sp, { id: "n", tabs: [{ id: "z" }] }]), "z");
  assert.equal(arrived(p, [{ id: "s", tabs: [{ id: "a" }] }]), null);
});

test("launch: opens the agent in the folder's space and puts the task in progress", async () => {
  world();
  const s = new Store();
  await s.load();
  const p = await launch(s, s.task("next1"));
  const [cmd, args] = H.runs.at(-1);
  assert.equal(cmd, "tab.new");
  assert.equal(args.space, "sp2");
  assert.deepEqual(args.argv, ["claude"]);
  assert.match(args.task, /^Write docs/);
  assert.equal(s.task("next1").status, "doing");
  assert.equal(p.name, "Write docs");
});

test("launch a task of the whole project: in the folder above its repositories, in the project's own space", async () => {
  world();
  const s = new Store();
  await s.load();
  await launch(s, s.task("next2")); // project Website (~/dev/web, /home/me/dev/docs), no repo of its own
  const [cmd, args] = H.runs.at(-1);
  assert.equal(cmd, "space.new", "not a repository's space");
  assert.equal(args.folder, "/home/me/dev");
  assert.equal(args.name, "Website");
  assert.deepEqual(args.argv, ["claude"], "both repositories are inside: nothing to add");
  assert.match(args.task, /project "Website"[\s\S]*- ~\/dev\/web[\s\S]*- \/home\/me\/dev\/docs[\s\S]*access to all of them/);
  // A task with its own repo hears of the others, without the extra access.
  await launch(s, s.task("next1"));
  assert.deepEqual(H.runs.at(-1)[1].argv, ["claude"]);
  assert.match(H.runs.at(-1)[1].task, /- ~\/dev\/web \(this task's\)/);
});

test("a project with no repositories yet: its terminal opens in the home folder, in its own space", async () => {
  world({ projects: [{ id: "pe", name: "Empty", color: "ansi2", repos: [] }] });
  const s = new Store();
  await s.load();
  openInProject(s.project("pe"));
  assert.deepEqual(H.runs.at(-1), ["space.new", { name: "Empty", folder: H.home }]);
  assert.equal(H.shared["taskr.pending"].at(-1).project, "pe");
});

test("a project's terminal: its own space above the repositories, shown at the project's level", async () => {
  world();
  const s = new Store();
  await s.load();
  const proj = s.project("pw");
  openInProject(proj);
  assert.deepEqual(H.runs.at(-1), ["space.new", { name: "Website", folder: "/home/me/dev" }]);
  const pending = H.shared["taskr.pending"].at(-1);
  assert.equal(pending.project, "pw");
  // The space arrives, its terminal labelled for the project (as the bookkeeping does).
  H.spaces.push({ id: "sp9", index: 9, name: "Website", named: true, folder: "/home/me/dev", machine: null, branch: null, active: false, status: null,
    tabs: [{ id: "tb9", index: 1, name: "1", named: false, active: true, status: null, panes: 1 }] });
  H.panes.push({ pane: "p9", tab: "tb9", terminal: "t9z", title: "t9z", cwd: "/home/me/dev", branch: null, status: null, app: null,
    program: { key: "shell", name: "zsh", shell: true, agent: false }, focused: false, zoomed: false, movable: true });
  H.terminals.push({ address: "t9z", state: "live", labels: { "herdr.space": "sp9", "herdr.tab": "tb9", "taskr.project": "pw" }, foreground: { pid: 99, argv: ["zsh"], cwd: "/home/me/dev" } });
  const w = build({ data: s.data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const tree = projectTree(w, s.data, H.home);
  const web = tree.projects.find((x) => x.p.id === "pw");
  assert.deepEqual(web.untracked.map((u) => u.tab), ["tb9"], "at the project's level");
  assert.ok(![...web.repos.values()].some((r) => r.untracked.some((u) => u.tab === "tb9")));
  assert.ok(!tree.orphan.repos.has("~/dev"), "not a folder under No project");
});

test("a project's space whose label never came: known by its name, in a folder that's no repository", async () => {
  world();
  const s = new Store();
  await s.load();
  // Opened at ~ (before the project had repositories); its terminal has no taskr.project.
  H.spaces.push({ id: "sp9", index: 9, name: "Website", named: true, folder: H.home, machine: null, branch: null, active: false, status: null,
    tabs: [{ id: "tb9", index: 1, name: "1", named: false, active: true, status: null, panes: 1 }] });
  H.panes.push({ pane: "p9", tab: "tb9", terminal: "t9z", title: "t9z", cwd: H.home, branch: null, status: null, app: null,
    program: { key: "shell", name: "zsh", shell: true, agent: false }, focused: false, zoomed: false, movable: true });
  H.terminals.push({ address: "t9z", state: "live", labels: { "herdr.space": "sp9", "herdr.tab": "tb9" }, foreground: { pid: 99, argv: ["zsh"], cwd: H.home } });
  const w = build({ data: s.data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const tree = projectTree(w, s.data, H.home);
  assert.deepEqual(tree.projects.find((x) => x.p.id === "pw").untracked.map((u) => u.tab), ["tb9"]);
  assert.ok(![...tree.orphan.repos.values()].some((r) => r.untracked.some((u) => u.tab === "tb9")), "not under No project");
});

test("moving a repository takes its tasks along, from the project it left or none", () => {
  const data = { projects: [{ id: "a", name: "A", folders: ["~/dev/x"] }, { id: "b", name: "B", folders: [] }],
    tasks: [{ id: "1", folder: "~/dev/x", project: "a" }, { id: "2", folder: "~/dev/x", project: null }, { id: "3", folder: "~/dev/x", project: "c" }, { id: "4", folder: "~/dev/y", project: "a" }] };
  moveRepo(data, "~/dev/x", "b", "/home/me");
  assert.deepEqual(data.projects.map((p) => p.folders), [[], ["~/dev/x"]]);
  assert.deepEqual(data.tasks.map((t) => t.project), ["b", "b", "c", "a"]);
});

test("a project's new tab waits for its terminal before labelling it", async () => {
  world();
  const s = new Store();
  await s.load();
  openInProject(s.project("pw"));
  const before = H.shared["taskr.pending"].at(-1);
  // The tab is there, its terminal not yet.
  H.spaces.push({ id: "sp9", index: 9, name: "Website", named: true, folder: "/home/me/dev", machine: null, branch: null, active: false, status: null,
    tabs: [{ id: "tb9", index: 1, name: "1", named: false, active: true, status: null, panes: 1 }] });
  const { Sidebar } = await import("../mods/taskr/sidebar.js");
  const host = Object.assign(Object.create(Sidebar), { store: s });
  const w = build({ data: s.data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const spawned = [];
  const c = { spawn: (f) => spawned.push(f), notify() {} };
  // Only the pending launches matter here; the rest of the bookkeeping needs a mounted copy.
  try { host.keepBooks(c, w); } catch {}
  const p = H.shared["taskr.pending"].find((x) => x.at === before.at);
  assert.equal(p?.tab, "tb9", "kept, with its tab");
  assert.equal(spawned.length, 0, "nothing labelled yet");
});

test("resume a task of the whole project: the other repositories are added again", async () => {
  world();
  const s = new Store();
  await s.load();
  await launch(s, s.task("next2"), { resume: { app: "claude", id: "abc", cwd: "~/dev/web", at: 1 } });
  const [, args] = H.runs.at(-1);
  assert.deepEqual(args.argv, ["claude", "--resume", "abc", "--add-dir", "/home/me/dev/docs"]);
  assert.equal(args.task, undefined, "no first message");
});

test("launch in a worktree: same title, its own branch", async () => {
  world({ tasks: [task({ id: "dupe", title: "Write docs", repo: "~/dev/web", branch: "task/write-docs", worktree: "~/.herdr/worktrees/web/write-docs" })] });
  const s = new Store();
  await s.load();
  await launch(s, s.task("next1"), { worktree: true });
  const t = s.task("next1");
  assert.equal(t.branch, "task/write-docs-ext1".replace("ext1", "next1".slice(-4)));
  assert.equal(H.runs.at(-1)[0], "space.new");
  const wt = H.execLog.find(([c, a]) => c === "git" && a[0] === "worktree");
  assert.deepEqual(wt[1].slice(0, 3), ["worktree", "add", "-b"]);
});

test("tasks follow their agents: working → in progress; a finished turn moves nothing; never done", async () => {
  world();
  H.props = { role: "sidebar" };
  const v = new Taskr();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  await settle();
  v.render(cx()); // first look: nothing moves
  await settle();
  // next1 gets an agent that starts working.
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.find((t) => t.id === "next1").tabs = ["tb5"];
  H.files.set(FILE(), JSON.stringify(d));
  await v.store.load();
  H.agents.push({ address: "t1q", pane: "p5", space: "sp2", tab: "tb5", status: "working", program: { key: "claude", name: "Claude Code" }, title: "a" });
  v.render(cx());
  await settle();
  assert.equal(v.store.task("next1").status, "doing");
  H.agents.at(-1).status = "done";
  v.render(cx());
  await settle();
  assert.equal(v.store.task("next1").status, "doing", "a turn isn't the task");
  H.agents.at(-1).status = "idle";
  v.render(cx());
  await settle();
  assert.equal(v.store.task("next1").status, "doing", "never to Review or Done by itself");
  // In Review, an agent at work again (fixing what the review found) leaves it there.
  await v.store.update((x) => { setStatus(x.tasks.find((t) => t.id === "next1"), "review"); });
  H.agents.at(-1).status = "working";
  v.render(cx());
  await settle();
  assert.equal(v.store.task("next1").status, "review");
  assert.ok(v.store.task("next1").agent_ms >= 0);
});
test("agent info: Claude Code model, effort and context; Codex from its rollout", async () => {
  world();
  H.files.set("/home/me/.claude/sessions/1001.json", JSON.stringify({ sessionId: "abc", cwd: "/home/me/dev/app" }));
  const info = new AgentInfo();
  info.refresh(cx(), H.terminals.filter((t) => ["t1", "vps/t7"].includes(t.address)));
  await settle();
  assert.deepEqual(
    { ...info.get("t1"), session: undefined },
    { app: "claude", model: "claude-opus-5-5", effort: "high", ctx: 12 + 200000 + 3000 + 800, ctxMax: null, session: undefined, cwd: "/home/me/dev/app" },
  );
  const grep = H.execLog.find(([c, a]) => c === "sh" && a.join(" ").includes("grep"));
  assert.equal(grep[1].at(-1), "/home/me/.claude/projects/-home-me-dev-app/abc.jsonl");
  assert.deepEqual(info.get("vps/t7"), { app: "codex", model: "gpt-5.5-codex", effort: "medium", ctx: 51000, ctxMax: 272000,
    session: "0aa1b2c3-1111-2222-3333-444455556666", cwd: "/srv/api" });
  // Shared: another copy sees it without looking again.
  const n = H.execLog.length;
  const other = new AgentInfo();
  other.refresh(cx(), H.terminals.filter((t) => t.address === "t1"));
  await settle();
  assert.equal(H.execLog.length, n);
  assert.equal(other.get("t1").model, "claude-opus-5-5");
});

test("agent info on another machine reads that machine's home", async () => {
  world();
  const t = { ...H.terminals.find((x) => x.address === "t1"), address: "vps/t1" };
  H.files.set("vps:/home/remote/.claude/sessions/1001.json", JSON.stringify({ sessionId: "r", cwd: "/srv/x" }));
  const info = new AgentInfo();
  info.refresh(cx(), [t]);
  await settle();
  assert.equal(info.get("vps/t1")?.model, "claude-opus-5-5");
  const grep = H.execLog.find(([c, a]) => c === "sh" && a.join(" ").includes("grep"));
  assert.equal(grep[2].on, "vps");
  assert.equal(grep[1].at(-1), "/home/remote/.claude/projects/-srv-x/r.jsonl");
});

test("detail: nothing is looked up while the panel is hidden", async () => {
  world();
  const find = (n) => (n.id === "taskr-detail" ? n : (n.children ?? []).map(find).find(Boolean));
  find(H.layout).hidden = true;
  H.props = { role: "detail" };
  H.shared["taskr.selected"] = "blocked1";
  const v = new Taskr();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  await settle();
  v.render(cx());
  await settle();
  assert.equal(H.hcLog.length, 0);
  assert.ok(!H.execLog.some(([c]) => c === "gh" || c === "git"));
  delete find(H.layout).hidden;
  v.render(cx());
  await settle();
  assert.ok(H.hcLog.some((a) => a[0] === "read"));
  assert.ok(H.execLog.some(([c, args]) => c === "git" && args.includes("diff")), "its changes are looked up once shown");
});

test("Now and Projects stacked: each list its own view, the books kept once, key commands acted on once", async () => {
  world();
  // The layout shows the two lists, one above the other.
  const find = (n, id) => (n.id === id ? n : (n.children ?? []).map((c) => find(c, id)).find(Boolean));
  find(H.layout, "taskr-lists").active = "taskr-split";
  const mk = async (view) => {
    H.props = { role: "sidebar", view };
    const v = new Taskr();
    v.c = cx();
    v.init(H.props, v.c);
    await until(() => v.store.loaded);
    await settle();
    return v;
  };
  // Projects above, Now below (the layout's order).
  const projects = await mk("projects");
  const now = await mk("now");
  const ids = (v) => walk(v.render(cx())).map((n) => n.id).filter(Boolean);
  assert.ok(ids(now).includes("sec-needs") && !ids(now).includes("v-projects"), "Now alone, no tabs");
  assert.ok(ids(projects).some((i) => i.startsWith("p:")) && !ids(projects).includes("sec-needs"), "Projects alone");
  // An agent works, then stops: its time is added once, not once per list.
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.find((t) => t.id === "next1").tabs = ["tb5"];
  d.tasks.find((t) => t.id === "next1").agent_ms = 0;
  H.files.set(FILE(), JSON.stringify(d));
  await now.store.load(); await projects.store.load();
  H.agents.push({ address: "t1q", pane: "p5", space: "sp2", tab: "tb5", status: "working", program: { key: "claude", name: "Claude Code" }, title: "a" });
  now.render(cx()); projects.render(cx());
  await settle();
  globalThis.__taskr.books.info.workSince.t1q -= 60000;
  H.agents.at(-1).status = "done";
  now.render(cx()); projects.render(cx());
  await settle();
  await now.store.load();
  const ms = now.store.task("next1").agent_ms;
  assert.ok(ms >= 60000 && ms < 120000, `counted once: ${ms}`);
  // A key command reaches both lists; only Now acts on it.
  H.overlays.length = 0;
  command("jump");
  await settle();
  assert.equal(H.overlays.length, 1, "one dialog, not one per list");
  command("focus");
  await settle();
  assert.ok(now.c.focused && !projects.c.focused, "Now takes the keys");
});

test("Now: an agent that finished, seen or not, is in Finished (unseen first); in progress isn't 'doing now'", () => {
  world();
  const d = JSON.parse(H.files.get(FILE()));
  // t4 is done (unseen) on tab tb4: give it to a task in Next.
  d.tasks.push(task({ id: "later-agent", title: "Parked", status: "next", tabs: ["tb4"] }));
  let data = parse(JSON.stringify(d));
  let w = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  assert.ok(nowView(w, data).finished.some((x) => x.t.id === "later-agent"));
  H.agents.find((a) => a.address === "t4").status = "idle";
  w = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  assert.ok(nowView(w, data).finished.some((x) => x.t.id === "later-agent"), "seen: still waiting for a word from you");
  assert.ok(!nowView(w, data).next.some((x) => x.t.id === "later-agent"));
  // Unseen first: t8 (review1) finished, not seen; t4 seen.
  assert.deepEqual(nowView(w, data).finished.map((x) => x.t.id), ["review1", "later-agent"]);
  // Parked until its agent works: in Later while it's idle.
  data.tasks.find((t) => t.id === "later-agent").snooze = "agent";
  assert.ok(nowView(w, data).later.some((x) => x.t.id === "later-agent"));
});
test("Later: parked until a day or someday, out of Now's lists, soonest first", () => {
  assert.equal(parseLater("someday"), "someday");
  assert.equal(parseLater("tomorrow", at), "2026-11-08");
  assert.equal(parseLater("blah"), undefined);
  assert.equal(parseLater("today", at), null, "today isn't later");
  assert.equal(parseLater("2020-01-01", at), null);
  world();
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.find((t) => t.id === "next1").snooze = "someday";
  d.tasks.find((t) => t.id === "inbox1").snooze = iso(2);
  d.tasks.find((t) => t.id === "blocked1").snooze = iso(2); // its agent asks: still in Needs you
  const data = parse(JSON.stringify(d));
  const w = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const v = nowView(w, data);
  const ids = (l) => l.map((x) => x.t.id);
  assert.deepEqual(ids(v.later).sort(), ["inbox1", "next1", "wait1"]);
  assert.equal(ids(v.later).at(-1), "next1", "someday last");
  assert.ok(!ids(v.next).includes("next1") && !ids(v.inbox).includes("inbox1"));
  assert.ok(ids(v.needs).includes("blocked1"));
  // Starting it is no longer putting it off.
  const t = data.tasks.find((x) => x.id === "next1");
  setStatus(t, "doing");
  assert.equal(t.snooze, null);
});

test("Later comes back on its day with one notification, and what's due is told once a day", async () => {
  world();
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.find((t) => t.id === "next1").snooze = iso(0);
  H.files.set(FILE(), JSON.stringify(d));
  const mk = async (view) => {
    H.props = { role: "sidebar", view };
    const v = new Taskr();
    v.init(H.props, cx());
    await until(() => v.store.loaded);
    await settle();
    return v;
  };
  const find = (n, id) => (n.id === id ? n : (n.children ?? []).map((c) => find(c, id)).find(Boolean));
  find(H.layout, "taskr-lists").active = "taskr-split";
  const a = await mk("projects"), b = await mk("now");
  H.notes.length = 0;
  a.render(cx()); b.render(cx());
  await settle();
  await a.store.load();
  assert.equal(a.store.task("next1").snooze, null, "back");
  const backs = H.notes.filter((n) => /Back from Later/.test(n.title));
  assert.equal(backs.length, 1, "told once, not once per list");
  assert.equal(backs[0].action.name, "taskr.select:next1");
  const dues = H.notes.filter((n) => !/Back from Later/.test(n.title));
  assert.equal(dues.length, 1);
  assert.match(dues[0].body, /Add login/);
  // The next look the same day: nothing new.
  H.notes.length = 0;
  a.render(cx()); b.render(cx());
  await settle();
  assert.equal(H.notes.length, 0);
});

test("reminders off: nothing is sent", async () => {
  world({ settings: { reminders: false } });
  H.props = { role: "sidebar" };
  const v = new Taskr();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  await settle();
  H.notes.length = 0;
  v.render(cx());
  await settle();
  assert.equal(H.notes.length, 0);
});

test("an agent that reports no state (claude attach) is still an agent, its state from its title", () => {
  world();
  // t6's pane runs Claude Code attached to its background session: no status, not in agents().
  const p6 = H.panes.find((p) => p.terminal === "t6");
  p6.app = "claude-code";
  p6.program = { key: "claude", name: "Claude Code", agent: false, shell: false };
  const data = parse(H.files.get(FILE()));
  const w = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const u = w.untracked.find((x) => x.tab === "tb6");
  assert.equal(u.agents.length, 1);
  assert.equal(u.agents[0].status, "unknown");
  // Its title tells working (a spinner first) from idle (✳).
  const t6 = H.terminals.find((t) => t.address === "t6");
  t6.title = "◑ Fix the parser";
  const ww = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  assert.equal(ww.untracked.find((x) => x.tab === "tb6").top, "working");
  t6.title = "✳ Fix the parser";
  const wi = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  assert.equal(wi.untracked.find((x) => x.tab === "tb6").top, "idle");
  delete t6.title;
  // A shell whose report lingers from an agent that quit is no agent.
  p6.program = { key: "shell", name: "zsh", agent: false, shell: true };
  const w2 = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  assert.equal(w2.untracked.find((x) => x.tab === "tb6").agents.length, 0);
});

test("an agent's state from its title as the core has it (Herdr strips the mark for mods)", async () => {
  world();
  const p6 = H.panes.find((p) => p.terminal === "t6");
  p6.program = { key: "claude", name: "Claude Code", agent: false, shell: false };
  H.hc = (args) => (args[0] === "get" && args[1] === "t6" ? { code: 0, stdout: JSON.stringify({ title: "◐ Fix the parser" }) } : { code: 0, stdout: "" });
  H.props = { role: "sidebar" };
  const v = new Taskr();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle();
  assert.equal(H.shared["taskr.titles"] != null, true, "a change redraws every copy");
  v.render(cx());
  // Its task made meanwhile (every agent is one): the state is the same either way.
  assert.equal((v.world.untracked.find((x) => x.tab === "tb6") ?? v.world.taskOfTab.get("tb6")).top, "working");
  // Looked again within a few seconds: not asked again.
  const n = H.hcLog.filter((a) => a[0] === "get").length;
  v.render(cx());
  await settle();
  assert.equal(H.hcLog.filter((a) => a[0] === "get").length, n);
});

async function sidebar(opts) {
  world(opts);
  H.props = { role: "sidebar" };
  const v = new Taskr();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle();
  await v.store.load();
  return v;
}
const tick = async (v) => { v.render(cx()); await settle(); await v.store.load(); };

test("every agent's tab is a task: one with no plan, named after its agent, Done when its tab closes", async () => {
  const v = await sidebar();
  const light = () => v.store.data.tasks.filter((t) => t.auto);
  // tb4's agent (finished) had no task: now one with no plan, in progress; shells (tb3, tb6) aren't tasks.
  assert.deepEqual(light().map((t) => [t.tabs[0], t.status]), [["tb4", "doing"]]);
  const id = light()[0].id;
  assert.ok(H.hcLog.some((a) => a[0] === "label" && a[2] === `taskr.task=${id}`), "its terminal is labelled");
  // Its name follows its agent's.
  H.agents.find((a) => a.address === "t4").title = "Spike the cache";
  H.terminals.find((t) => t.address === "t4").title = "Spike the cache";
  await tick(v);
  assert.equal(v.store.task(id).title, "Spike the cache");
  // Its tab closes: Done a minute later (not at once: Herdr may be bringing spaces back), resumable.
  H.spaces[0].tabs = H.spaces[0].tabs.filter((t) => t.id !== "tb4");
  H.agents = H.agents.filter((a) => a.address !== "t4");
  await tick(v);
  assert.equal(v.store.task(id).status, "doing", "still as it was right after");
  globalThis.__taskr.books.info.gone[id] -= 61000;
  await tick(v);
  assert.equal(v.store.task(id).status, "done");
  assert.equal(v.store.task(id).freed, true);
});

test("an agent's task: in progress whatever its agent does, one per tab", async () => {
  const { adopt } = await import("../mods/taskr/lib/actions.js");
  world();
  const store = new Store();
  await store.load();
  const w = look();
  const u = w.untracked.find((x) => x.tab === "tb4");
  for (const top of ["working", "blocked", "done", "idle"]) {
    await store.update((d) => { d.tasks = d.tasks.filter((t) => !t.tabs.includes("tb4")); });
    const id = await adopt(store, { ...u, top });
    assert.equal(store.task(id).status, "doing", top);
    assert.equal(store.task(id).idle, undefined, top);
    assert.equal(store.task(id).auto, true);
  }
  // One task per tab.
  assert.equal(await adopt(store, u), null);
});
test("a task with no plan is Done when its agent quits, its tab still open; after a restart it waits for the agent", async () => {
  const v = await sidebar();
  const id = v.store.data.tasks.find((t) => t.auto).id;
  const t4 = H.terminals.find((t) => t.address === "t4");
  // A restart: another shell, the agent being resumed in it a moment later. Kept meanwhile.
  t4.pid = 4004;
  t4.foreground = { pid: 4004, argv: ["/bin/zsh", "-l"], name: "zsh" };
  await tick(v);
  assert.ok(globalThis.__taskr.books.info.gone[id], "counting");
  t4.foreground = { pid: 4010, argv: ["claude"], name: "2.1.0" };
  await tick(v);
  assert.ok(!globalThis.__taskr.books.info.gone[id], "its agent is back: not counting");
  // Quit by hand (/exit): the shell is in front again and stays.
  t4.foreground = { pid: 4004, argv: ["/bin/zsh", "-l"], name: "zsh" };
  await tick(v);
  assert.equal(v.store.task(id).status, "doing", "not at once");
  globalThis.__taskr.books.info.gone[id] -= 31000;
  await tick(v);
  assert.equal(v.store.task(id).status, "done", "done, its tab still open");
  assert.ok(H.spaces[0].tabs.some((t) => t.id === "tb4"));
  // Herdr still lists the agent that quit: no second task for the shell.
  await tick(v);
  assert.equal(v.store.data.tasks.filter((t) => t.tabs.includes("tb4")).length, 1);
  // What's left in its tab is a terminal like any other: not the closed task's row.
  assert.ok(!v.world.taskOfTab.has("tb4"));
  assert.ok(v.world.untracked.some((u) => u.tab === "tb4" && !u.agents.length));
  const tree = projectTree(v.world, v.store.data, H.home);
  const shown = [...tree.projects, tree.orphan].flatMap((p) => [...p.loose, ...[...p.repos.values()].flatMap((r) => r.tasks)]);
  assert.ok(!shown.some((x) => x.t.id === id), "the closed task isn't shown for its terminal");
  assert.ok([...tree.projects, tree.orphan].some((p) => [...p.untracked, ...[...p.repos.values()].flatMap((r) => r.untracked)].some((u) => u.tab === "tb4")), "the terminal is");
  // An agent started again in that tab takes the same task back up.
  t4.foreground = { pid: 4020, argv: ["claude"], name: "2.1.0" };
  H.agents.find((a) => a.address === "t4").status = "working";
  await tick(v);
  await tick(v);
  assert.equal(v.store.data.tasks.filter((t) => t.tabs.includes("tb4")).length, 1, "no second task");
  assert.equal(v.store.task(id).status, "doing");
  assert.equal(v.store.task(id).freed, undefined, "its tab is its own again");
  assert.equal(v.world.taskOfTab.get("tb4")?.t.id, id);
});

test("a task with no plan in Review whose agent quits waits there for you, and lets go of its tab", async () => {
  const v = await sidebar();
  const id = v.store.data.tasks.find((t) => t.auto).id;
  await v.store.update((d) => { setStatus(d.tasks.find((t) => t.id === id), "review"); });
  const t4 = H.terminals.find((t) => t.address === "t4");
  t4.pid = 4004;
  t4.foreground = { pid: 4004, argv: ["/bin/zsh", "-l"], name: "zsh" };
  await tick(v);
  globalThis.__taskr.books.info.gone[id] -= 31000;
  await tick(v);
  assert.equal(v.store.task(id).status, "review");
  assert.equal(v.store.task(id).freed, true);
  await tick(v);
  assert.ok(!v.world.taskOfTab.has("tb4"), "its tab is a terminal again");
  assert.equal(v.store.task(id).status, "review", "and it stays there");
});

test("an agent started again in the tab of a closed task with no plan goes on with it; a planned one keeps its tab", async () => {
  const { adopt } = await import("../mods/taskr/lib/actions.js");
  world({ tasks: [task({ id: "light", title: "Spike", status: "done", tabs: ["tb4"], auto: true })] });
  const store = new Store();
  await store.load();
  const w = look();
  const u = w.untracked.find((x) => x.tab === "tb4");
  assert.ok(u, "its tab belongs to no task");
  assert.equal(await adopt(store, { ...u, top: "done" }), "light");
  assert.equal(store.task("light").status, "doing");
  // One left in Review (its agent quit) is taken up again in Review.
  await store.update((d) => { const t = d.tasks.find((x) => x.id === "light"); t.status = "review"; t.freed = true; });
  assert.equal(await adopt(store, { ...u, top: "working" }), "light");
  assert.equal(store.task("light").status, "review");
  assert.equal(store.task("light").freed, undefined);
  assert.equal(store.data.tasks.filter((t) => t.tabs.includes("tb4")).length, 1);
  // A closed task you planned keeps its tab: no task is made or reopened for it.
  world({ tasks: [task({ id: "mine", title: "Mine", status: "done", tabs: ["tb4"] })] });
  const s2 = new Store();
  await s2.load();
  assert.ok(!look().untracked.some((x) => x.tab === "tb4"));
  assert.equal(await adopt(s2, u), null);
});

test("dimmed: what's closed or parked, unless its agent works or asks", () => {
  const later = "2999-01-01";
  assert.equal(aside({ status: "doing" }), false);
  assert.equal(aside({ status: "done" }), true);
  assert.equal(aside({ status: "done", outcome: "dropped" }), true);
  assert.equal(aside({ status: "next", snooze: later }), true);
  assert.equal(aside({ status: "next", snooze: "someday" }, "idle"), true);
  assert.equal(aside({ status: "doing", snooze: "agent" }, "idle"), true, "parked until its agent works");
  assert.equal(aside({ status: "doing", auto: true }, "idle"), false, "an idle agent's task is work in progress");
  assert.equal(aside({ status: "next", snooze: later }, "working"), false, "parked, but its agent works");
  assert.equal(aside({ status: "doing", snooze: "agent" }, "blocked"), false, "parked, but its agent asks");
});
test("park idle agents: off by default; when set, a task with no plan waiting on you is parked until its agent works", async () => {
  const v = await sidebar();
  const id = v.store.data.tasks.find((t) => t.auto).id;
  const t4 = H.terminals.find((t) => t.address === "t4");
  H.agents.find((a) => a.address === "t4").status = "idle";
  H.agents.find((a) => a.address === "t8").status = "idle";
  t4.status_ms = Date.now() - 5 * 3600000;
  H.terminals.find((t) => t.address === "t8").status_ms = Date.now() - 5 * 3600000;
  await tick(v);
  assert.equal(v.store.task(id).snooze, null, "off by default: it stays in progress");
  assert.ok(nowView(v.world, v.store.data).finished.some((x) => x.t.id === id), "waiting for a word from you");
  // Four hours: parked until its agent works; the planned one (review1, t8 idle as long) isn't.
  await v.store.update((d) => { d.settings.park_after = 240; });
  await tick(v);
  assert.equal(v.store.task(id).snooze, "agent");
  assert.equal(v.store.task(id).status, "doing", "its stage doesn't change");
  assert.equal(v.store.task("review1").snooze, null);
  v.render(cx());
  assert.ok(nowView(v.world, v.store.data).later.some((x) => x.t.id === id));
  // Its agent works again: back, in progress.
  H.agents.find((a) => a.address === "t4").status = "working";
  t4.status_ms = Date.now();
  await tick(v);
  assert.equal(v.store.task(id).snooze, null);
  assert.equal(v.store.task(id).status, "doing");
});
test("quiet projects pause by themselves and come back at the next sign of life; one you pause stays", async () => {
  const old = Date.now() - 5 * DAY;
  // pa (App) has an agent at work (doing1, t1); pw (Website) and pq (quiet) have had nothing for days.
  const v = await sidebar({ settings: { pause_after: 1 }, projects: [
    { id: "pa", name: "App", repos: ["~/dev/app"], active_at: old },
    { id: "pw", name: "Website", repos: ["~/dev/web"], active_at: old },
    { id: "pq", name: "Quiet", repos: [], active_at: old },
    { id: "pm", name: "Mine", repos: [], paused: true, active_at: old },
    { id: "pn", name: "New", repos: [] } ] });
  await v.store.update((d) => { for (const t of d.tasks) if (t.project === "pw" || t.folder === "~/dev/web") { t.updated = old; t.history = [{ s: t.status, at: old }]; } });
  await tick(v);
  const p = (id) => v.store.project(id);
  assert.equal(p("pa").paused, false, "an agent works there");
  assert.equal(p("pw").paused, true);
  assert.ok(p("pw").paused_auto);
  assert.equal(p("pq").paused, true);
  assert.ok(p("pn").active_at, "a project seen for the first time starts counting now");
  assert.equal(p("pn").paused, false);
  // A task of Website changes: it's back.
  await v.store.update((d) => { d.tasks.find((t) => t.id === "next1").updated = Date.now(); });
  await tick(v);
  assert.equal(p("pw").paused, false);
  assert.equal(p("pw").paused_auto, undefined);
  // Paused by you: stays, whatever happens; made active by you, its quiet days count from now.
  await v.store.update((d) => { d.projects.find((x) => x.id === "pm").paused = true; d.tasks.push({ ...task({ id: "m1", project: "pm" }), updated: Date.now() }); });
  await tick(v);
  assert.equal(p("pm").paused, true);
  // Never: nothing pauses.
  await v.store.update((d) => { d.settings.pause_after = 0; const q = d.projects.find((x) => x.id === "pq"); q.paused = false; delete q.paused_auto; });
  await tick(v);
  assert.equal(p("pq").paused, false);
});

test("a task with no plan you touch is yours: it keeps its name and its status", async () => {
  const v = await sidebar();
  const id = v.store.data.tasks.find((t) => t.auto).id;
  // Moved to the top from the list's keys: kept.
  H.shared["taskr.selected"] = id;
  v.command("top", cx());
  await settle();
  assert.equal(v.store.task(id).auto, undefined);
  H.spaces[0].tabs = H.spaces[0].tabs.filter((t) => t.id !== "tb4");
  H.agents = H.agents.filter((a) => a.address !== "t4");
  await tick(v);
  assert.ok(!globalThis.__taskr.books.info.gone?.[id], "not counted down");
  assert.equal(v.store.task(id).status, "doing", "still as you left it");
});

test("a deleted task is gone from the file, and its tab's agent gets a task again", async () => {
  // Older files kept deleted tasks, marked: they're dropped, and their tab is free.
  const v = await sidebar({ tasks: [task({ id: "gone1", title: "Old", status: "next", tabs: ["tb4"], deleted: true })] });
  await tick(v);
  assert.equal(v.store.task("gone1"), null);
  assert.ok(v.store.data.tasks.some((t) => t.auto && t.tabs.includes("tb4")));
  assert.ok(!v.store.data.tasks.some((t) => t.deleted));
});

test("move a task's agent into another task: its tabs, conversations and time go, the first task goes", async () => {
  const { merge } = await import("../mods/taskr/lib/actions.js");
  const v = await sidebar();
  const id = v.store.data.tasks.find((t) => t.auto).id;
  await v.store.update((d) => { const t = d.tasks.find((x) => x.id === id); t.sessions = [{ app: "claude", id: "s9", cwd: "~/dev/app", at: 1 }]; t.agent_ms = 5000; });
  assert.equal(await merge(v.store, id, "next1", H.terminals), true);
  const t = v.store.task("next1");
  assert.equal(v.store.task(id), null);
  assert.deepEqual(t.tabs, ["tb4"]);
  assert.deepEqual(t.sessions.map((s) => s.id), ["s9"]);
  assert.equal(t.agent_ms, 5000);
  assert.ok(H.hcLog.some((a) => a[0] === "label" && a[1] === "t4" && a[2] === "taskr.task=next1"));
});

test("agents back after a restart: a terminal back as a fresh shell gets its conversation resumed, once", async () => {
  world();
  const { Revive, FILE: REVIVE } = await import("../mods/taskr/lib/revive.js");
  const sent = [];
  const realExec = H.exec;
  H.exec = (cmd, args, opts) => (cmd === "env" ? (sent.push(args), { code: 0, stdout: "" }) : realExec(cmd, args, opts));
  const info = { get: (a) => (a === "t5" ? { app: "claude", session: "sess-1", cwd: "/home/me/dev/app", model: "claude-opus-5-5" } : a === "t6" ? { app: "claude", session: "empty", cwd: "/home/me" } : null) };
  const term = (pid, fgPid, agent, tab = "tbR") => ({ address: "t5", state: "live", pid, labels: { "herdr.tab": tab },
    foreground: { pid: fgPid, argv: agent ? ["claude"] : ["/bin/zsh", "-l"], cwd: "/home/me/dev/app" }, program: { agent } });
  const r = new Revive();
  const c = cx();
  r.step(c, [], info);
  await settle();
  // An agent at work: remembered (one without a transcript, t6, isn't).
  const t6 = { ...term(70, 71, true), address: "t6" };
  r.step(c, [term(10, 11, true), t6], info);
  await settle();
  const saved = JSON.parse(H.files.get(REVIVE()));
  assert.equal(saved.t5.id, "sess-1");
  assert.ok(!saved.t6, "an empty conversation can't resume");
  // Right after a crash the old pid lingers with nothing in front: not "quit by hand".
  r.step(c, [term(10, null, false)], info);
  // Back as a fresh shell (another pid): the resume is typed, once, without hc's "from" wrapper.
  H.notes.length = 0;
  r.step(c, [term(20, 20, false)], info);
  r.step(c, [term(20, 20, false)], info);
  await settle();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], ["-u", "HC_TERMINAL_ID", "hc", "send", "t5", "cd '/home/me/dev/app' && claude --resume sess-1"]);
  assert.match(H.notes[0].title, /agent is back/);
  // Quit by hand (the same shell in front for a while): forgotten, so a later crash types nothing.
  r.c.recs.t5.quit = Date.now() - 20000;
  r.step(c, [term(20, 20, false)], info);
  assert.ok(!r.c.recs.t5);
  // An address reused by a terminal in another tab gets nothing.
  r.c.recs.t5 = { pid: 30, tab: "tbR", app: "claude", id: "sess-1", cwd: "/x", at: Date.now() };
  r.step(c, [term(40, 40, false, "tbOther")], info);
  await settle();
  assert.equal(sent.length, 1);
  assert.ok(!r.c.recs.t5);
  H.exec = realExec;
});

test("detail: looks again without redrawing unless something changed, and skips the screen in view", async () => {
  world();
  H.props = { role: "detail" };
  H.shared["taskr.selected"] = "blocked1";
  const v = new Taskr();
  const c = cx();
  v.init(H.props, c);
  await until(() => v.store.loaded);
  await settle();
  v.render(cx());
  await settle();
  assert.ok(H.hcLog.some((a) => a[0] === "read"), "first look reads the screen");
  // Same answers again: nothing to draw.
  const lc = cx();
  v.det.at = 0;
  v.lookUp(lc, v.world.taskById.get("blocked1"));
  await settle();
  assert.equal(lc.notified, 0);
  // The agent's terminal has the focus: its screen isn't read.
  H.hcLog.length = 0;
  H.focused = { pane: v.leadOf(v.world.taskById.get("blocked1")).a.pane };
  v.det.at = 0;
  v.lookUp(cx(), v.world.taskById.get("blocked1"));
  await settle();
  assert.ok(!H.hcLog.some((a) => a[0] === "read"));
});

test("detail: a status picked there is saved and drawn at once; Activity only when turned on", async () => {
  world();
  H.props = { role: "detail" };
  H.shared["taskr.selected"] = "blocked1";
  const v = new Taskr();
  const c = cx();
  v.init(H.props, c);
  await until(() => v.store.loaded);
  await settle();
  const { S } = await import("../mods/taskr/strings.js");
  assert.ok(!text(v.render(cx())).includes(S.activity.toUpperCase()), "off by default");
  const chip = walk(v.render(cx())).find((n) => n.id === "ds-dropped");
  const before = c.notified;
  chip.handlers.on_click({}, cx());
  await settle();
  assert.deepEqual([v.store.task("blocked1").status, v.store.task("blocked1").outcome], ["done", "dropped"]);
  assert.ok(c.notified > before, "the copy that wrote redraws");
  await v.store.update((d) => { d.settings.activity = true; });
  assert.ok(text(v.render(cx())).includes(S.activity.toUpperCase()), "on in the settings");
});

test("detail: pull requests only for a task with its own branch; working on main, no gh and no button", async () => {
  world();
  H.props = { role: "detail" };
  H.shared["taskr.selected"] = "blocked1"; // in progress, an agent, changes in ~/dev/app, no branch
  const v = new Taskr();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle(30);
  const ids = () => walk(v.render(cx())).map((n) => n.id);
  assert.ok(text(v.render(cx())).includes("+10"), "its changes show");
  assert.ok(!ids().includes("d-pr") && !ids().includes("d-pr-link"));
  assert.ok(!H.execLog.some(([cmd]) => cmd === "gh"), "gh isn't asked");
  H.shared["taskr.selected"] = "review1"; // its own worktree branch, with a PR
  v.render(cx());
  await settle(30);
  v.render(cx());
  await settle(30);
  assert.ok(ids().includes("d-pr-link"), "its PR shows");
  assert.ok(H.execLog.some(([cmd, args]) => cmd === "gh" && args.includes("task/feature")));
});

test("plan usage: Claude's get_usage reply and Codex's logged limits", () => {
  const now = Date.now();
  const c = parseClaude(CLAUDE_USAGE, now);
  assert.equal(c.five.pct, 28);
  assert.equal(c.week.pct, 74);
  assert.ok(c.five.resets > now);
  // Only the newer "limits" list: still read.
  const alt = parseClaude(JSON.stringify({ response: { response: { rate_limits: { limits: [{ kind: "session", percent: 5 }, { kind: "weekly_all", percent: 9 }] } } } }), now);
  assert.deepEqual([alt.five.pct, alt.week.pct], [5, 9]);
  assert.throws(() => parseClaude(JSON.stringify({ response: { response: { rate_limits_available: false } } })));
  // A reset that passed means the window is empty again.
  const past = parseClaude(JSON.stringify({ response: { response: { rate_limits: { five_hour: { utilization: 99, resets_at: new Date(now - 1000).toISOString() } } } } }), now);
  assert.equal(past.five.pct, 0);
  const line = JSON.stringify({ timestamp: new Date(now).toISOString(), payload: { type: "token_count", rate_limits: { secondary: { used_percent: 12, window_minutes: 10080 }, primary: { used_percent: 8.4, window_minutes: 300 } } } });
  const x = parseCodex(`junk\n${line}\n{"other":1}`, now);
  assert.deepEqual([x.five.pct, x.week.pct], [8, 12]);
  assert.equal(parseCodex("nothing here"), null);
});

test("plan usage is off unless turned on", () => {
  assert.equal(parse("{}").settings.usage, false);
  assert.equal(parse('{"settings":{"usage":true}}').settings.usage, true);
});

test("status bar: plan usage shown, colored by the fuller limit, and off when asked", async () => {
  world({ settings: { usage: true } });
  H.props = { role: "status" };
  const v = new Taskr();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle();
  const words = text(v.render(cx()));
  assert.match(words, /Claude 28% wk 74%/);
  assert.match(words, /Codex 8% wk 92%/);
  const t = (await import("herdr")).theme();
  const codex = walk(v.render(cx())).find((n) => n.id === "st-u-codex");
  assert.ok(codex.calls.some(([m, a]) => m === "text_color" && a[0] === t.blocked), "92% is red");
  const n = H.execLog.length;
  v.render(cx());
  await settle();
  assert.equal(H.execLog.length, n, "not asked again within 5 minutes");
  // Off in the settings: nothing shown, nothing run.
  const d = JSON.parse(H.files.get(FILE())); d.settings.usage = false; H.files.set(FILE(), JSON.stringify(d));
  await v.store.load();
  assert.doesNotMatch(text(v.render(cx())), /Claude/);
});

test("status bar: working counts as Now's Working does; an archived task's agent isn't counted", async () => {
  world();
  H.props = { role: "status" };
  const v = new Taskr();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle();
  const count = () => Number(walk(v.render(cx())).find((n) => n.id === "st-working").children.map(text).join(" ").match(/(\d+) working/)[1]);
  const now = () => nowView(v.world, v.store.data).working.length;
  assert.ok(now() > 0);
  assert.equal(count(), now());
  const id = nowView(v.world, v.store.data).working[0].t.id;
  await v.store.update((d) => { const x = d.tasks.find((y) => y.id === id); x.status = "done"; x.archived = true; });
  v.render(cx());
  await settle();
  assert.equal(count(), now(), "still the same as Now");
});

async function mountRole(props, setup) {
  world();
  setup?.();
  H.props = props;
  const v = new Taskr();
  v.init(props, cx());
  await until(() => v.store.loaded);
  await settle();
  return v;
}

test("find a task in attach mode ties the loose tab to the picked task", async () => {
  const v = await mountRole({ dialog: "jump", overlay: "ov1", attach: "tb3" });
  v.query = "pick a database";
  const c = cx();
  v.pickJump(undefined, c);
  await settle();
  assert.ok(v.store.task("blocked1").tabs.includes("tb3"));
  assert.ok(v.jumpList().every((x) => ["inbox", "next", "doing", "review"].includes(x.status)), "only open tasks are offered");
});

test("sessions are kept on the task, and Resume continues the last one in its folder", async () => {
  const v = await mountRole({ role: "sidebar" }, () => {
    H.files.set("/home/me/.claude/sessions/1001.json", JSON.stringify({ sessionId: "sess-1", cwd: "/home/me/dev/app" }));
  });
  v.render(cx());
  await settle();
  v.render(cx());
  await settle();
  const t = v.store.task("doing1");
  assert.deepEqual(t.sessions.map((x) => [x.app, x.id, x.cwd]), [["claude", "sess-1", "~/dev/app"]]);
  // Its agent is gone (a restart): Resume.
  H.agents = H.agents.filter((a) => a.address !== "t1");
  H.terminals = H.terminals.filter((x) => x.address !== "t1");
  v.resume(cx(), v.store.task("doing1"));
  await settle();
  const [cmd, args] = H.runs.filter(([c]) => c === "tab.new" || c === "space.new").at(-1);
  assert.deepEqual(args.argv, ["claude", "--resume", "sess-1"]);
  assert.equal(args.folder, "/home/me/dev/app");
  assert.equal(args.task, undefined, "no first message: the conversation is already there");
  assert.equal(cmd, "tab.new");
});

test("detail offers Resume when the task's agent is gone", async () => {
  const v = await mountRole({ role: "detail" }, () => {
    H.shared["taskr.selected"] = "next1";
    const d = JSON.parse(H.files.get(FILE()));
    d.tasks.find((x) => x.id === "next1").sessions = [{ app: "codex", id: "0aa1b2c3-1111-2222-3333-444455556666", cwd: "~/dev/web", at: Date.now() - 3600000 }];
    H.files.set(FILE(), JSON.stringify(d));
  });
  const node = walk(v.render(cx())).find((n) => n.id === "d-resume");
  assert.ok(node);
  node.handlers.on_click({}, cx());
  await settle();
  const args = H.runs.filter(([c]) => c === "tab.new").at(-1)[1];
  assert.deepEqual(args.argv, ["codex", "resume", "0aa1b2c3-1111-2222-3333-444455556666"]);
});

test("Linear: no key says how to add one; with a key, assigned issues import with priority and due", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push([url, opts]);
    return { ok: true, status: 200, json: async () => ({ data: { viewer: { assignedIssues: { nodes: [
      { identifier: "ENG-12", title: "Rate limits on login", url: "https://linear.app/o/issue/ENG-12", description: "Too many tries", priority: 1, dueDate: "2026-12-01", state: { name: "Todo" }, team: { key: "ENG" }, labels: { nodes: [{ name: "bug" }] } },
      { identifier: "ENG-13", title: "Low one", url: "https://linear.app/o/issue/ENG-13", priority: 4, dueDate: null, state: { name: "Backlog" }, labels: { nodes: [] } },
    ] } } } }) };
  };
  try {
    let v = await mountRole({ dialog: "issues", overlay: "ov1", source: "linear", repo: "~/dev/app" });
    assert.match(text(v.render(cx())), /personal API key/);
    assert.equal(calls.length, 0);

    v = await mountRole({ dialog: "issues", overlay: "ov1", source: "linear", repo: "~/dev/app" }, () => {
      H.files.set(`${H.appHome}/data/taskr/linear-key`, "lin_api_test\n");
    });
    await settle();
    assert.equal(calls[0][1].headers.Authorization, "lin_api_test");
    assert.match(text(v.render(cx())), /ENG-12/);
    walk(v.render(cx())).find((n) => n.id === "i-ENG-12").handlers.on_click({}, cx());
    walk(v.render(cx())).find((n) => n.id === "import").handlers.on_click({}, cx());
    await settle();
    const t = v.store.data.tasks.find((x) => x.issue?.number === "ENG-12");
    assert.equal(t.status, "inbox");
    assert.equal(t.priority, undefined);
    assert.equal(t.due, "2026-12-01");
    assert.equal(t.issue.source, "linear");
    const { S } = await import("../mods/taskr/strings.js");
    assert.match(S.prompt(t), /^Rate limits on login[\s\S]*Linear issue ENG-12/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a project's own folder: the one holding its repositories, else home", async () => {
  const { projectFolder } = await import("../mods/taskr/lib/util.js");
  const h = "/Users/me";
  assert.equal(projectFolder([], h), h, "no repositories yet");
  assert.equal(projectFolder(["/Users/me/dev/a", "/Users/me/dev/b"], h), "/Users/me/dev");
  assert.equal(projectFolder(["/Users/me/dev/a"], h), "/Users/me/dev", "a lone repository's parent");
  assert.equal(projectFolder(["/Users/me/a", "/Volumes/x/b"], h), h, "nothing in common");
  assert.equal(projectFolder(["/Users/me/a", "/Users/other/b"], h), h, "only a folder above home in common");
});

test("where a row is: project › repository, else the folder its terminal is in", async () => {
  const { whereLabel, taskWhere } = await import("../mods/taskr/lib/world.js");
  const h = "/Users/me";
  const data = { projects: [{ id: "g", name: "General", repos: [] }, { id: "a", name: "Acme", repos: ["~/dev/api"] }] };
  assert.equal(whereLabel(data, { project: "a", repo: "~/dev/api" }, h), "Acme › api");
  assert.equal(whereLabel(data, { project: "g", folder: h }, h), "General › ~", "a project's own space says its folder");
  assert.equal(whereLabel(data, { folder: "/Users/me/notes" }, h), "~/notes");
  // A task of a project with no repositories, its terminal in one: that repository.
  const x = { t: { repo: null }, project: "g", folder: "/Users/me/dev/ai-editor", repoHere: "/Users/me/dev/ai-editor" };
  assert.equal(taskWhere(data, x, h), "General › ai-editor");
  assert.equal(taskWhere(data, { ...x, repoHere: null }, h), "General › ~/dev/ai-editor", "not a repository (or not looked yet): the folder");
  assert.equal(taskWhere(data, x, h, { project: false }), "ai-editor", "a project's board leaves its name out");
});

test("a paused project: out of Now and Projects' list, but for an agent that needs you or works", () => {
  const w0 = world();
  const d = parse(H.files.get(FILE()));
  d.projects.find((p) => p.id === "pa").paused = true;
  const w = build({ data: d, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const v = nowView(w, d);
  const all = [...v.review, ...v.doing, ...v.next, ...v.inbox, ...v.later];
  assert.ok(!all.some((x) => x.project === "pa"), "its waiting work leaves Now");
  assert.ok(v.needs.some((x) => x.t.id === "blocked1"), "an agent asking still shows");
  const tree = projectTree(w, d, H.home);
  assert.ok(!tree.projects.some((x) => x.p.id === "pa") && tree.paused.some((x) => x.p.id === "pa"));
  void w0;
});

test("sidebar: stacked lists fold to their header, never both", async () => {
  world();
  H.props = { role: "sidebar", view: "projects" };
  const view = new Taskr();
  view.init(H.props, cx());
  await until(() => view.store.loaded);
  H.runs.length = 0;
  view.stackFold("projects", true);
  assert.deepEqual(H.runs, [["layout.resize", { id: "taskr-projects", px: 41 }], ["layout.resize", { id: "taskr-now", weight: 1 }]]);
  assert.equal(H.shared["taskr.stackFolded"], "projects");
  assert.ok(!walk(view.render(cx())).some((n) => n.id === "taskr-list"), "only its header");
  H.runs.length = 0;
  view.stackFocus("projects"); // all the room to Projects: it unfolds, Now folds
  assert.equal(H.shared["taskr.stackFolded"], "now");
  assert.deepEqual(H.runs.at(-2), ["layout.resize", { id: "taskr-now", px: 41 }]);
});

test("flow: the turn writes the stage only when an agent starts work; quitting closes only what has no plan", async () => {
  const { onWorking, quitStage, adoptStage, prReady, stale, nowSection, parkDue } = await import("../mods/taskr/lib/flow.js");
  assert.equal(onWorking({ status: "next" }), "doing");
  assert.equal(onWorking({ status: "inbox" }), "doing");
  assert.equal(onWorking({ status: "done" }), "doing", "work on a closed task opens it again");
  assert.equal(onWorking({ status: "done", outcome: "dropped" }), null);
  assert.equal(onWorking({ status: "review" }), null, "fixing what the review found is part of it");
  assert.equal(onWorking({ status: "doing" }), null);
  assert.equal(quitStage({ status: "doing" }), "done");
  assert.equal(quitStage({ status: "review" }), "review");
  assert.equal(adoptStage(null), "doing");
  assert.equal(adoptStage({ status: "review" }), "review");
  const since = Date.now() - 3600000;
  const t = { status: "doing", branch: "task/x", history: [{ s: "doing", at: since }] };
  assert.equal(prReady(t, { state: "OPEN", createdAt: new Date(since + 1000).toISOString() }), true);
  assert.equal(prReady(t, { state: "OPEN", createdAt: new Date(since - 86400000).toISOString() }), false, "an older PR isn't this round's");
  assert.equal(prReady({ ...t, branch: null }, { state: "OPEN", createdAt: new Date().toISOString() }), false, "only a task with its own branch");
  assert.equal(prReady(t, { state: "MERGED", createdAt: new Date().toISOString() }), false);
  assert.equal(prReady(t, null), false);
  const now = Date.now(), day = 86400000;
  assert.equal(stale({ status: "doing" }, null, now - 5 * day, now, 3 * day), true);
  assert.equal(stale({ status: "doing" }, "idle", now - 5 * day, now, 3 * day), true);
  assert.equal(stale({ status: "doing" }, "working", now - 5 * day, now, 3 * day), false);
  assert.equal(stale({ status: "next" }, null, now - 5 * day, now, 3 * day), false);
  assert.equal(stale({ status: "doing", snooze: "someday" }, null, now - 5 * day, now, 3 * day), false);
  const x = (t, top = null) => ({ t, top });
  assert.equal(nowSection(x({ status: "done" }, "blocked")), null);
  assert.equal(nowSection(x({ status: "next", snooze: "someday" }, "blocked")), "needs");
  assert.equal(nowSection(x({ status: "review" }, "done")), "finished");
  assert.equal(nowSection(x({ status: "doing", snooze: "agent" }, "idle")), "later");
  assert.equal(nowSection(x({ status: "doing" }, "idle")), "finished", "an idle agent waits for you: not 'doing'");
  assert.equal(nowSection(x({ status: "doing" })), "doing", "in progress, no agent waiting");
  assert.equal(parkDue({ status: "doing", auto: true }, "idle", now - 2 * 3600000, now, 60), true);
  assert.equal(parkDue({ status: "doing", auto: true }, "idle", now - 2 * 3600000, now, 0), false, "never by default");
  assert.equal(parkDue({ status: "doing" }, "idle", now - 2 * 3600000, now, 60), false, "a planned task is never parked by itself");
  assert.equal(parkDue({ status: "doing", auto: true }, "done", now - 2 * 3600000, now, 60), false, "not before you've seen it");
});

test("setStatus: Dropped is Done with an outcome; Done again clears it; starting or closing unparks", () => {
  const t = cleanTask({ id: "a", title: "A", status: "next", snooze: "someday", waiting_on: "Ana" });
  assert.equal(t.waiting_on, "Ana");
  setStatus(t, "dropped");
  assert.deepEqual([t.status, t.outcome, t.snooze, t.waiting_on, t.history.at(-1).s], ["done", "dropped", null, undefined, "dropped"]);
  assert.ok(t.done_at);
  assert.equal(setStatus(t, "dropped"), false);
  setStatus(t, "done");
  assert.deepEqual([t.status, t.outcome], ["done", undefined]);
});

test("a pull request opened for a task with its own branch moves it to Review; tasks without one never ask gh", async () => {
  const v = await sidebar({ tasks: [
    task({ id: "wt", title: "Branch work", repo: "~/dev/app", status: "doing", branch: "task/wt", worktree: "~/.herdr/worktrees/app/wt", history: [{ s: "doing", at: Date.now() - 3600000 }] }),
    task({ id: "plain", title: "Main checkout", repo: "~/dev/app", status: "doing", history: [{ s: "doing", at: Date.now() - 3600000 }] }),
  ] });
  const base = H.exec;
  H.exec = (cmd, args, opts) => (cmd === "gh" && args[0] === "pr"
    ? { code: 0, stdout: JSON.stringify({ number: 5, url: "u", state: "OPEN", createdAt: new Date().toISOString(), statusCheckRollup: [] }), stderr: "" }
    : base(cmd, args, opts));
  globalThis.__taskr.books.info.prAt = 0;
  await tick(v);
  await tick(v);
  assert.equal(v.store.task("wt").status, "review");
  assert.equal(v.store.task("plain").status, "doing", "no PR check for work in the main checkout");
  assert.deepEqual([...new Set(H.execLog.filter(([c, a]) => c === "gh" && a[0] === "pr").map(([, a]) => a[2]))], ["task/wt"]);
});

test("back from waiting on someone: its next step is to follow up", async () => {
  const v = await sidebar({ settings: { reminders: false }, tasks: [
    task({ id: "w", title: "Census data", status: "doing", snooze: iso(0), waiting_on: "Ana" }),
    task({ id: "w2", title: "Has a step", status: "doing", snooze: iso(0), waiting_on: "", next_step: "Merge it" }),
  ] });
  await tick(v);
  assert.deepEqual([v.store.task("w").snooze, v.store.task("w").waiting_on, v.store.task("w").next_step], [null, undefined, "Follow up with Ana"]);
  assert.equal(v.store.task("w2").next_step, "Merge it", "a step of yours stays");
});

test("outline: a folder takes another's place (reordering its own project), a task moves to another folder", async () => {
  const { moveTaskTo } = await import("../mods/taskr/lib/actions.js");
  const data = { projects: [{ id: "a", folders: ["~/dev/x", "~/dev/y", "~/dev/z"] }, { id: "b", folders: ["~/dev/w"] }],
    tasks: [{ id: "1", folder: "~/dev/z", project: "a" }, { id: "2", folder: "~/dev/x", project: "a", worktree: "~/.herdr/worktrees/x/two" }] };
  moveRepo(data, "~/dev/z", "a", "/home/me", { target: "~/dev/x" });
  assert.deepEqual(data.projects[0].folders, ["~/dev/z", "~/dev/x", "~/dev/y"], "before it");
  moveRepo(data, "~/dev/z", "a", "/home/me", { target: "~/dev/y", after: true });
  assert.deepEqual(data.projects[0].folders, ["~/dev/x", "~/dev/y", "~/dev/z"], "after it, coming from above");
  moveRepo(data, "~/dev/y", "b", "/home/me", { target: "~/dev/w" });
  assert.deepEqual(data.projects.map((p) => p.folders), [["~/dev/x", "~/dev/z"], ["~/dev/y", "~/dev/w"]]);
  assert.equal(moveTaskTo(data, "1", { project: "b", folder: "~/dev/w" }), true);
  assert.deepEqual([data.tasks[0].project, data.tasks[0].folder], ["b", "~/dev/w"]);
  assert.equal(moveTaskTo(data, "1", { project: "b", folder: null }), true, "to the project's own level");
  assert.equal(data.tasks[0].folder, null);
  assert.equal(moveTaskTo(data, "2", { project: "b", folder: "~/dev/w" }), false, "a task with a worktree stays with its folder");
});

test("an agent starts with its model and effort by its own flags; others get neither", async () => {
  const { withChoices, kindOf } = await import("../mods/taskr/lib/actions.js");
  assert.deepEqual(withChoices(["claude"], { model: "opus", effort: "xhigh" }), ["claude", "--model", "opus", "--effort", "xhigh"]);
  assert.deepEqual(withChoices(["/usr/local/bin/codex"], { model: "gpt-6.1-sol", effort: "low" }), ["/usr/local/bin/codex", "-m", "gpt-6.1-sol", "-c", 'model_reasoning_effort="low"']);
  assert.deepEqual(withChoices(["codex"], { effort: "max" }), ["codex"], "an effort Codex doesn't have is left out");
  assert.deepEqual(withChoices(["opencode"], { model: "x", effort: "high" }), ["opencode"]);
  assert.equal(kindOf(["pi"]), null);
});

test("stats: agent work split at midnight, kept per day for 120 days; a period counts tasks done and agents' work, no-plan ones too", async () => {
  const { byDay, addWork, summary, periodDays, mergeWork } = await import("../mods/taskr/lib/stats.js");
  const late = new Date(2026, 10, 13, 23, 30).getTime();
  assert.deepEqual(byDay(late, late + 3600000), [["2026-11-13", 1800000], ["2026-11-14", 1800000]]);
  const t = {};
  for (let i = 0; i < 130; i++) addWork(t, `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, "0")}`, 1000, 1);
  assert.equal(Object.keys(t.work).length, 120, "the last 120 days");
  const days = periodDays(7);
  const today = days.at(-1);
  const x = (t, project = "pa") => ({ t, project });
  const tasks = [
    x({ status: "done", done_at: Date.now(), work: { [today]: [3600000, 2] } }),
    x({ status: "done", done_at: Date.now(), outcome: "dropped" }),
    x({ status: "done", done_at: Date.now(), auto: true, work: { [today]: [600000, 3] } }, "pw"),
    x({ status: "doing", auto: true, work: { [days[0]]: [60000, 1], "2020-01-01": [9, 9] } }, null),
    x({ status: "done", done_at: Date.now() - 30 * 86400000 }),
  ];
  const s = summary(tasks, { days });
  assert.deepEqual(s.totals, { done: 1, worked: 3, noPlan: 2, turns: 6, ms: 4260000 }, "done: closed by you, planned, not dropped; worked: any task whose agents worked");
  assert.equal(s.days.at(-1).ms, 4200000);
  assert.equal(s.days.at(-1).done, 1);
  assert.deepEqual(s.projects.map((r) => r.id), ["pa", "pw", null], "by agent time");
  assert.equal(s.since, "2020-01-01");
  assert.deepEqual(summary(tasks, { days, project: "pw" }).totals, { done: 0, worked: 1, noPlan: 1, turns: 3, ms: 600000 });
  const into = { work: { [today]: [1, 1] } };
  mergeWork(into, { work: { [today]: [2, 3] } });
  assert.deepEqual(into.work[today], [3, 4]);
});

test("the books keep each task's agent work per day and count a turn when a working agent finishes", async () => {
  const { localDay } = await import("../mods/taskr/lib/util.js");
  const v = await sidebar();
  // doing1's agent t1 is working; it finishes a turn.
  globalThis.__taskr.books.info.workSince.t1 = Date.now() - 600000;
  H.agents.find((a) => a.address === "t1").status = "done";
  await tick(v);
  const w = v.store.task("doing1").work?.[localDay(Date.now())];
  assert.ok(w && w[0] >= 590000 && w[1] === 1, JSON.stringify(w));
  // An agent that asks for you mid-turn: its time counts, no turn yet.
  globalThis.__taskr.books.info.workSince.t1 = Date.now() - 60000;
  H.agents.find((a) => a.address === "t1").status = "blocked";
  await tick(v);
  assert.equal(v.store.task("doing1").work[localDay(Date.now())][1], 1);
});
