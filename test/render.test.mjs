// Renders every role and dialog of the mod against a busy world, then fires every
// click, press and hover in what it drew and renders again. Catches what
// `herdr-app check` can't reach: rows that only exist with data, async states,
// and handlers. A null child or a mistyped style method fails as in the app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { H, touch } from "herdr";
import { walk, isElement, text } from "gpui-kit";
import Taskr from "../mods/taskr/main.js";
import { world, cx, settle, until, FILE, task, iso } from "./fixture.mjs";

async function mount(props, setup) {
  const w = world();
  setup?.(w);
  H.props = props;
  // Claude Code's session file for the agents (pid 1000 + n).
  for (const t of H.terminals) {
    const pid = t.foreground?.pid;
    if (pid) H.files.set(`/home/me/.claude/sessions/${pid}.json`, JSON.stringify({ sessionId: `s${pid}`, cwd: "/home/me/dev/app" }));
  }
  const view = new Taskr();
  const c = cx();
  view.init(props, c);
  await until(() => view.store.loaded);
  await settle();
  return { view, c };
}

function render(view) {
  const c = cx();
  const tree = view.render(c);
  assert.ok(isElement(tree), "render returns an element");
  return { tree, c };
}

// Fires every handler once (each on a fresh render, as the person would).
async function fireAll(view, { skip = [] } = {}) {
  const { tree } = render(view);
  const nodes = walk(tree).filter((n) => Object.keys(n.handlers).length);
  const fired = [];
  for (const node of nodes) {
    for (const [name, fn] of Object.entries(node.handlers)) {
      if (skip.some((s) => (node.id ?? "").startsWith(s))) continue;
      const c = cx();
      const ev = name.startsWith("on_key_down") ? { key: "j", modifiers: {} } : name === "on_hover" ? true : { position: { x: 1, y: 1 }, modifiers: {} };
      fn(ev, c);
      await settle(25);
      assert.deepEqual(c.errors.map(String), [], `${node.id ?? node.kind} ${name}`);
      fired.push(`${node.id}:${name}`);
      render(view); // still draws after it
    }
  }
  return fired;
}

const ROLES = [{ role: "sidebar" }, { role: "detail" }, { role: "status" }, { role: "board" }, { role: "stats" }, { role: "stats", project: "pa" }];

for (const p of ROLES) {
  test(`role ${p.role}: renders and every control works`, async () => {
    const { view, c } = await mount(p, () => { H.shared["taskr.selected"] = "blocked1"; });
    assert.deepEqual(c.errors.map(String), []);
    assert.ok(view.store.loaded);
    render(view);
    await settle();
    render(view);
    const fired = await fireAll(view);
    assert.ok(p.role === "status" || fired.length > 3, `${p.role} has controls (${fired.length})`);
  });
}

test("sidebar: Projects view, everything folded and unfolded; no toggle for done tasks (they're on the board)", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "projects";
  render(view);
  await settle();
  assert.ok(!walk(render(view).tree).some((n) => n.id === "flt-done"));
  await fireAll(view);
  for (const id of ["p:pa", "p:-", "r:pa:~/dev/app"]) view.folded.add(id);
  render(view);
});

test("sidebar: the key commands", async () => {
  const { view } = await mount({ role: "sidebar" });
  render(view);
  for (const k of ["j", "j", "k", "down", "up", "enter", "space", "1", "2", "3", "n", "e", "l", "w", "/", "tab", "tab", "x"]) {
    const c = cx();
    view.key({ key: k, modifiers: {} }, c);
    await settle(5);
    assert.deepEqual(c.errors.map(String), [], k);
    render(view);
  }
  for (const c2 of ["board", "jump", "view", "new", "focus"]) view.command(c2, cx());
});

for (const dialog of ["task", "project", "menu", "repo", "repo-project", "jump", "issues", "archive", "settings", "confirm-delete", "loose", "project-menu", "confirm-close", "later", "start"]) {
  for (const extra of [{}, { task: "blocked1", project: "pa", repo: "~/dev/app", tab: "tb4", repos: ["~/dev/app"], name: "App" }, { task: "review1", project: "pw", repo: "~/dev/web", tab: "tb3", attach: "tb4" }]) {
    test(`dialog ${dialog} ${JSON.stringify(extra)}`, async () => {
      const { view, c } = await mount({ dialog, overlay: "ov1", ...extra });
      assert.deepEqual(c.errors.map(String), []);
      render(view);
      await settle();
      await fireAll(view);
    });
  }
}

test("task form: saves once even when Enter is pressed twice", async () => {
  const { view } = await mount({ dialog: "task", overlay: "ov1" });
  const c = cx();
  view.inputs.title.type("Brand new", c);
  view.inputs.title.submit(c);
  view.inputs.title.submit(c);
  await settle();
  const data = JSON.parse(H.files.get(FILE()));
  assert.equal(data.tasks.filter((t) => t.title === "Brand new").length, 1);
});

test("delete: the task is gone, and its tabs closed, before the dialog closes", async () => {
  const { view } = await mount({ dialog: "confirm-delete", overlay: "ov1", task: "review1" });
  H.shared["taskr.selected"] = "review1";
  const del = walk(render(view).tree).find((n) => n.id === "del");
  del.handlers.on_click({}, cx());
  await settle();
  assert.equal(JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "review1"), undefined);
  assert.ok(H.runs.some(([n, a]) => n === "tab.close" && a.id === "tb8" && a.confirmed), "its tab (its agent) closes with it");
  assert.equal(H.shared["taskr.selected"], null);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("task menu: a status picked there is saved, then the menu closes", async () => {
  const { view } = await mount({ dialog: "menu", overlay: "ov1", task: "review1" });
  walk(render(view).tree).find((n) => n.id === "s-done").handlers.on_click({}, cx());
  await settle();
  assert.equal(JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "review1").status, "done");
  assert.deepEqual(H.closed, ["ov1"]);
});

test("sidebar: clicking a task shows it and brings its agent's tab to the front", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "projects";
  const row = (id) => walk(render(view).tree).find((n) => n.id === `t-${id}`);
  H.runs.length = 0;
  row("doing1").handlers.on_click({}, cx());
  assert.equal(H.shared["taskr.selected"], "doing1");
  assert.deepEqual(H.runs.find(([n]) => n === "pane.focus"), ["pane.focus", { pane: "p1" }]);
  assert.ok(!H.runs.some(([n]) => n === "layout.show"), "selecting never opens the task panel");
  H.runs.length = 0;
  row("next1").handlers.on_click({}, cx());
  assert.equal(H.shared["taskr.selected"], "next1");
  assert.ok(!H.runs.some(([n]) => n === "pane.focus"), "a task with no tab only shows");
});

test("project form: a repository or a plain folder goes in at once; a folder of repositories lists them, or goes in itself", async () => {
  const { view } = await mount({ dialog: "project", overlay: "ov1" });
  const add = async () => { walk(render(view).tree).find((n) => n.id === "add-folder").handlers.on_click({}, cx()); await settle(25); };
  H.picked = "/home/me/dev/web";
  await add();
  assert.deepEqual(view.form.repos, ["~/dev/web"]);
  assert.ok(walk(render(view).tree).some((n) => n.id === "r-~/dev/web"), "listed with its ✕");
  // ~/dev isn't a repository: its repositories are listed to tick.
  H.picked = "/home/me/dev";
  await add();
  assert.deepEqual(view.found.repos, ["~/dev/app", "~/dev/web"]);
  walk(render(view).tree).find((n) => n.id === "f-~/dev/app").handlers.on_click({}, cx());
  assert.deepEqual(view.form.repos, ["~/dev/web", "~/dev/app"]);
  // ✕ takes one out.
  walk(render(view).tree).find((n) => n.id === "rx-~/dev/web").handlers.on_click({}, cx());
  assert.deepEqual(view.form.repos, ["~/dev/app"]);
  // Nothing else is listed: not the repositories taskr knows, not the open spaces.
  assert.ok(!walk(render(view).tree).some((n) => n.id === "r-/srv/api"));
  // ~/dev itself can go in too.
  H.picked = "/home/me/dev";
  await add();
  walk(render(view).tree).find((n) => n.id === "found-self").handlers.on_click({}, cx());
  assert.deepEqual(view.form.repos, ["~/dev/app", "~/dev"]);
  // A folder that's no repository and holds none (notes): in at once.
  H.picked = "/home/me/notes";
  await add();
  assert.deepEqual(view.form.repos, ["~/dev/app", "~/dev", "~/notes"]);
  assert.equal(view.found, null);
  delete H.picked;
});

test("project form: paused is saved", async () => {
  const { view } = await mount({ dialog: "project", overlay: "ov1", project: "pa" });
  walk(render(view).tree).find((n) => n.id === "pst-paused").handlers.on_click({}, cx());
  walk(render(view).tree).find((n) => n.id === "save").handlers.on_click({}, cx());
  await settle();
  assert.equal(JSON.parse(H.files.get(FILE())).projects.find((p) => p.id === "pa").paused, true);
});

test("repository menu: remove it from its project, or move it from a list", async () => {
  const { view } = await mount({ dialog: "repo", overlay: "ov1", repo: "~/dev/app", project: "pa" });
  await settle();
  walk(render(view).tree).find((n) => n.id === "r-remove").handlers.on_click({}, cx());
  await settle();
  const d = JSON.parse(H.files.get(FILE()));
  assert.ok(!d.projects.find((p) => p.id === "pa").folders.some((r) => r.endsWith("dev/app")));
  assert.ok(d.tasks.filter((x) => x.folder === "~/dev/app").every((x) => x.project), "its tasks keep a project");
  const m = await mount({ dialog: "repo-project", overlay: "ov2", repo: "~/dev/app" });
  walk(render(m.view).tree).find((n) => n.id === "rp-pw").handlers.on_click({}, cx());
  await settle();
  const d2 = JSON.parse(H.files.get(FILE()));
  assert.ok(d2.projects.find((p) => p.id === "pw").folders.includes("~/dev/app"));
  assert.ok(d2.tasks.filter((x) => x.folder === "~/dev/app" && !x.deleted).every((x) => x.project === "pw"), "its tasks go with it");
});

test("a repository dragged onto another project's header moves there", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "projects";
  await settle();
  const nodes = walk(render(view).tree);
  const row = nodes.find((n) => n.id === "r:pa:~/dev/app");
  assert.ok(row, "the repository's row");
  row.handlers["on_mouse_down:left"]({}, cx());
  const header = walk(render(view).tree).find((n) => n.id === "p:pw");
  header.handlers.on_mouse_move({}, cx());
  header.handlers["on_mouse_up:left"]({}, cx());
  await settle();
  const d = JSON.parse(H.files.get(FILE()));
  assert.ok(d.projects.find((p) => p.id === "pw").folders.includes("~/dev/app"));
  assert.ok(!d.projects.find((p) => p.id === "pa").folders.includes("~/dev/app"));
});

test("close a project: one question, then every space of its repos closes", async () => {
  const { view } = await mount({ dialog: "confirm-close", overlay: "ov1", repos: ["~/dev/app", "~/dev/web"], name: "Both" });
  const words = text(render(view).tree);
  assert.match(words, /Close Both\?/);
  assert.match(words, /its 2 spaces/);
  H.runs.length = 0;
  walk(render(view).tree).find((n) => n.id === "close-it").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.filter(([n]) => n === "space.close").map(([, a]) => [a.id, a.confirmed]).sort(), [["sp1", true], ["sp2", true]]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("close a project: its own space above the repositories closes too", async () => {
  const { view } = await mount({ dialog: "confirm-close", overlay: "ov1", repos: ["~/dev/web", "/home/me/dev/docs"], name: "Website", project: "pw" }, () => {
    H.spaces.push({ id: "sp9", index: 9, name: "Website", named: true, folder: "/home/me/dev", machine: null, branch: null, active: false, status: null,
      tabs: [{ id: "tb9", index: 1, name: "1", named: false, active: true, status: null, panes: 1 }] });
    H.panes.push({ pane: "p9", tab: "tb9", terminal: "t9z", title: "t9z", cwd: "/home/me/dev", branch: null, status: null, app: null,
      program: { key: "shell", name: "zsh", shell: true, agent: false }, focused: false, zoomed: false, movable: true });
  });
  H.runs.length = 0;
  walk(render(view).tree).find((n) => n.id === "close-it").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.filter(([n]) => n === "space.close").map(([, a]) => a.id).sort(), ["sp2", "sp9"]);
});

test("an agent's task with no plan shows its agent's line: model, context, how long", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "now";
  render(view);
  await until(() => view.store.data.tasks.some((t) => t.auto));
  await view.store.load();
  const id = view.store.data.tasks.find((t) => t.auto).id;
  const row = walk(render(view).tree).find((n) => n.id === `t-${id}`);
  const words = row.children.map(text).join(" ");
  assert.match(words, /\d+\s?(s|m|h)/i);
  assert.ok(!walk(render(view).tree).some((n) => (n.id ?? "").startsWith("u-tb4")), "never as a terminal in no task");
});

test("later dialog: a word for a day puts the task off", async () => {
  const { view } = await mount({ dialog: "later", overlay: "ov1", task: "next1" });
  view.laterInput.type("someday", cx());
  view.laterInput.submit(cx());
  await settle();
  assert.equal(JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "next1").snooze, "someday");
  assert.deepEqual(H.closed, ["ov1"]);
});

test("status bar: a button opens and closes the task panel", async () => {
  const { view } = await mount({ role: "status" });
  H.runs.length = 0;
  walk(render(view).tree).find((n) => n.id === "st-detail").handlers.on_click({}, cx());
  assert.deepEqual(H.runs, [["layout.toggle", { id: "taskr-detail" }]]);
});

test("boards: one tab per project and one for all, the pills go from one to another", async () => {
  const { view } = await mount({ role: "board", project: "pw" });
  const tree = walk(render(view).tree);
  const ids = tree.map((n) => n.id).filter(Boolean);
  assert.ok(ids.includes("card-next1") && !ids.includes("card-doing1"), "Website's tasks only");
  assert.ok(ids.includes("bp-all") && ids.includes("bp-pa"), "pills to the other boards");
  assert.ok(!tree.find((n) => n.id === "bp-pw").handlers.on_click, "this board's pill does nothing");
  // A pill opens that board's tab; open again, it's focused.
  H.runs.length = 0;
  tree.find((n) => n.id === "bp-pa").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.at(-1), ["tab.new", { name: "Board · App", mod: "taskr", props: { role: "board", project: "pa" } }]);
  H.spaces[0].tabs.push({ id: "tbA", index: 9, name: "Board · App", named: true });
  H.panes.push({ pane: "pA", tab: "tbA", terminal: null, mod: "taskr", title: "taskr" });
  tree.find((n) => n.id === "bp-pa").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.at(-1), ["pane.focus", { pane: "pA" }]);
  // All: the fixture's "Board" tab.
  tree.find((n) => n.id === "bp-all").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.at(-1), ["pane.focus", { pane: "pB" }]);
});

test("a project's row shows its actions while the pointer is on it", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "projects";
  const ids = () => walk(render(view).tree).map((n) => n.id).filter(Boolean);
  assert.ok(!ids().includes("pboard-p:pa"), "out of the way");
  assert.ok(!ids().includes("board"), "no board button in Projects' header: each project has its own");
  walk(render(view).tree).find((n) => n.id === "p:pa").handlers.on_hover(true, cx());
  assert.ok(["pboard-p:pa", "pterm-p:pa", "padd-p:pa", "pmore-p:pa"].every((i) => ids().includes(i)));
});

test("projects reorder by dragging one onto another; a plain click still folds", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "projects";
  const row = (id) => walk(render(view).tree).find((n) => n.id === id);
  row("p:pa").handlers["on_mouse_down:left"]({}, cx());
  row("p:pw").handlers.on_mouse_move({}, cx());
  assert.ok(row("p:pw").calls.some(([m]) => m === "border_b"), "a line below Website: App lands after it");
  const c = cx();
  row("p:pw").handlers["on_mouse_up:left"]({}, c);
  await settle();
  assert.deepEqual(JSON.parse(H.files.get(FILE())).projects.map((p) => p.id), ["pw", "pa"]);
  assert.ok(c.stopped > 0, "the drop isn't also a click");
  // Press and release on the same project: nothing moves.
  row("p:pa").handlers["on_mouse_down:left"]({}, cx());
  row("p:pa").handlers["on_mouse_up:left"]({}, cx());
  await settle();
  assert.deepEqual(JSON.parse(H.files.get(FILE())).projects.map((p) => p.id), ["pw", "pa"]);
  assert.equal(view.dragProject, null);
});

test("tasks reorder by dragging a row onto another; from Inbox onto Next it changes list", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "now";
  const row = (id) => walk(render(view).tree).find((n) => n.id === `t-${id}`);
  const order = () => { const d = JSON.parse(H.files.get(FILE())); return d.tasks.filter((t) => ["next2", "next1"].includes(t.id)).sort((a, b) => a.rank - b.rank).map((t) => t.id); };
  // Next: next2 (was P1) above next1 (was P3). next1 dragged onto next2: above it.
  row("next1").handlers["on_mouse_down:left"]({}, cx());
  row("next2").handlers.on_mouse_move({}, cx());
  assert.ok(row("next2").calls.some(([m]) => m === "border_t"), "a line above next2");
  const c = cx();
  row("next2").handlers["on_mouse_up:left"]({}, c);
  await settle();
  assert.deepEqual(order(), ["next1", "next2"]);
  assert.ok(c.stopped > 0, "the drop isn't also a click");
  // An idea from the Inbox dropped onto Next: decided, at that place.
  row("inbox1").handlers["on_mouse_down:left"]({}, cx());
  row("next2").handlers.on_mouse_move({}, cx());
  row("next2").handlers["on_mouse_up:left"]({}, cx());
  await settle();
  const d = JSON.parse(H.files.get(FILE()));
  const t = (id) => d.tasks.find((x) => x.id === id);
  assert.equal(t("inbox1").status, "next");
  assert.ok(t("next1").rank < t("inbox1").rank && t("inbox1").rank < t("next2").rank, "between them");
  // Onto a row of another kind of list (Working): nothing moves.
  const before = H.files.get(FILE());
  row("next1").handlers["on_mouse_down:left"]({}, cx());
  row("doing1").handlers.on_mouse_move({}, cx());
  assert.ok(!row("doing1").calls.some(([m]) => m === "border_t" || m === "border_b"), "no line where it can't land");
  row("doing1").handlers["on_mouse_up:left"]({}, cx());
  await settle();
  assert.equal(H.files.get(FILE()), before);
});

test("board: a card dropped onto another takes its place, in its column", async () => {
  const { view } = await mount({ role: "board" });
  const card = (id) => walk(render(view).tree).find((n) => n.id === `card-${id}`);
  card("inbox2").handlers["on_mouse_down:left"]({}, cx());
  card("next2").handlers.on_mouse_move({}, cx());
  assert.ok(card("next2").calls.some(([m]) => m === "border_t"), "a line above it");
  const c = cx();
  card("next2").handlers["on_mouse_up:left"]({}, c);
  await settle();
  assert.ok(c.stopped > 0, "not also a drop on the column");
  const d = JSON.parse(H.files.get(FILE()));
  const t = (id) => d.tasks.find((x) => x.id === id);
  assert.equal(t("inbox2").status, "next");
  assert.ok(t("inbox2").rank < t("next2").rank);
  const cards = walk(render(view).tree).map((n) => n.id).filter((i) => ["card-inbox2", "card-next2", "card-next1"].includes(i));
  assert.deepEqual(cards, ["card-inbox2", "card-next2", "card-next1"], "drawn in that order");
});

test("task form: due accepts words and shortcuts", async () => {
  const { view } = await mount({ dialog: "task", overlay: "ov1" });
  const c = cx();
  view.inputs.title.type("Due test", c);
  view.inputs.due.type("tomorrow", c);
  render(view);
  view.saveTask(c);
  await settle();
  const t = JSON.parse(H.files.get(FILE())).tasks.find((x) => x.title === "Due test");
  assert.match(t.due, /^\d{4}-\d{2}-\d{2}$/);
});

test("a hand-edited tasks.json with odd values still draws", async () => {
  const { view, c } = await mount({ role: "sidebar" }, () => {
    const d = JSON.parse(H.files.get(FILE()));
    d.tasks.push({ id: "odd1" }, { id: "odd2", title: 42, status: "nope", priority: "high", due: 5, tabs: "x", history: null, issue: { number: 3 } }, null, "junk");
    d.projects.push({ id: "pz" }, null);
    H.files.set(FILE(), JSON.stringify(d));
  });
  assert.deepEqual(c.errors.map(String), []);
  for (const v of ["now", "projects"]) { H.shared["taskr.view"] = v; render(view); }
  await fireAll(view);
});

test("an invalid tasks.json is never overwritten", async () => {
  const { view } = await mount({ role: "sidebar" }, () => H.files.set(FILE(), "{ broken"));
  assert.ok(view.store.error);
  await view.store.update((d) => { d.tasks.push(task({ title: "x" })); });
  assert.equal(H.files.get(FILE()), "{ broken");
  render(view);
});

test("store reloads when the file changes on disk", async () => {
  const { view } = await mount({ role: "sidebar" });
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.push(task({ id: "fromagent", title: "Added by an agent" }));
  H.files.set(FILE(), JSON.stringify(d));
  touch(FILE());
  await settle();
  assert.ok(view.store.task("fromagent"));
});

test("pane header: a terminal says its task, its agent's model and context; its buttons work", async () => {
  const { view } = await mount({ pane: "p1", terminal: "t1" });
  assert.equal(view.role, "pane");
  render(view); // asks for its agent's model and context
  await settle(50);
  const words = text(render(view).tree);
  assert.match(words, /Add login/, "the task its terminal is labelled with");
  assert.match(words, /opus 5\.5|ctx/i, "its agent's model and context");
  view.hovered = true;
  const fired = await fireAll(view);
  assert.ok(fired.some((f) => f.startsWith("ph-z-p1")), "zoom, split and close while hovered");
  // A shell in no task: its program, no task.
  const plain = await mount({ pane: "p3", terminal: "t3" });
  assert.doesNotMatch(text(render(plain.view).tree), /Add login|Pick a database|ctx/);
});

test("menu: Later is a plain item that opens its dialog; the dialog's quick choices put the task off", async () => {
  const { view } = await mount({ dialog: "menu", overlay: "ov1", task: "next1" });
  H.overlays.length = 0;
  walk(render(view).tree).find((n) => n.id === "later").handlers.on_click({}, cx());
  assert.deepEqual(H.overlays.map((o) => o.props.dialog), ["later"]);
  const d = await mount({ dialog: "later", overlay: "ov2", task: "next1" });
  walk(render(d.view).tree).find((n) => n.id === "later-someday").handlers.on_click({}, cx());
  await settle();
  assert.equal(JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "next1").snooze, "someday");
});

test("Now: a row's second line says where it is and how long, not the model", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "now";
  await settle(25);
  const tree = walk(render(view).tree);
  const row = (id) => tree.find((n) => n.id === id).children.map(text).join(" ");
  assert.match(row("t-blocked1"), /Use Postgres or SQLite/, "a question first");
  assert.match(row("t-doing1"), /App › app/i);
  assert.doesNotMatch(row("t-doing1"), /ctx|opus/i);
});

test("board: a card says where it is and how long, not the model", async () => {
  const { view } = await mount({ role: "board" });
  await settle(25);
  const tree = walk(render(view).tree);
  const card = tree.find((n) => n.id === "card-review1").children.map(text).join(" ");
  assert.match(card, /app/);
  assert.doesNotMatch(card, /opus|ctx|high/i);
});

test("waiting on someone: who and a day to follow up (three days by default); until its agent works, from Later", async () => {
  const { view } = await mount({ dialog: "menu", overlay: "ov1", task: "next1" });
  H.overlays.length = 0;
  walk(render(view).tree).find((n) => n.id === "waiting").handlers.on_click({}, cx());
  assert.deepEqual(H.overlays.map((o) => [o.props.dialog, o.props.waiting]), [["later", true]]);
  const d = await mount({ dialog: "later", overlay: "ov2", task: "next1", waiting: true });
  assert.equal(d.view.laterText, "+3d");
  d.view.whoInput.type("Ana", cx());
  d.view.whoInput.submit(cx());
  await settle();
  const t = JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "next1");
  assert.equal(t.waiting_on, "Ana");
  assert.match(t.snooze, /^\d{4}-\d{2}-\d{2}$/);
  const l = await mount({ dialog: "later", overlay: "ov3", task: "inbox1" });
  walk(render(l.view).tree).find((n) => n.id === "later-agent").handlers.on_click({}, cx());
  await settle();
  const i = JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "inbox1");
  assert.equal(i.snooze, "agent");
  assert.equal(i.waiting_on, undefined);
});

test("Now: In progress counts its rows (the limit is in the status bar); one that hasn't moved for days shows its time in yellow", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "now";
  await view.store.update((d) => {
    const t = d.tasks.find((x) => x.id === "next1");
    t.status = "doing";
    t.updated = Date.now() - 10 * 86400000;
    t.history = [{ s: "doing", at: t.updated }];
  });
  await settle(25);
  const tree = walk(render(view).tree);
  // Only next1 is in the section (doing1, remote1 work and blocked1 asks): 1, not 4/2.
  const head = tree.find((n) => n.id === "sec-doing").children.map(text).join(" ");
  assert.match(head, /In progress\s*1/);
  assert.doesNotMatch(head, /\//);
  assert.match(tree.find((n) => n.id === "t-next1").children.map(text).join(" "), /in progress 10d/);
});

test("Projects is an outliner: a folder dragged onto another shows where it lands and takes that place; a task goes into a folder", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "projects";
  await settle();
  const node = (id) => walk(render(view).tree).find((n) => n.id === id);
  // docs onto web, in Website: a line above web, the dragged row dimmed, then docs first.
  node("r:pw:~/dev/docs").handlers["on_mouse_down:left"]({}, cx());
  node("r:pw:~/dev/web").handlers.on_mouse_move({}, cx());
  const target = node("r:pw:~/dev/web");
  assert.ok(target.calls.some(([m]) => m === "border_t"), "a line shows where it lands");
  assert.ok(node("r:pw:~/dev/docs").calls.some(([m, v]) => m === "opacity" && v[0] < 1), "the dragged folder is lifted");
  node("r:pw:~/dev/web").handlers["on_mouse_up:left"]({}, cx());
  await settle();
  assert.deepEqual(JSON.parse(H.files.get(FILE())).projects.find((p) => p.id === "pw").folders, ["~/dev/docs", "~/dev/web"]);
  // Let go on itself: nothing moves, and the click that ends the drag doesn't fold it.
  node("r:pw:~/dev/web").handlers["on_mouse_down:left"]({}, cx());
  node("r:pw:~/dev/web").handlers.on_mouse_move({}, cx());
  node("r:pw:~/dev/web").handlers["on_mouse_up:left"]({}, cx());
  node("r:pw:~/dev/web").handlers.on_click({}, cx());
  assert.ok(!view.folded.has("r:pw:~/dev/web"));
  // app (App) onto web (Website): it moves there, before web.
  node("r:pa:~/dev/app").handlers["on_mouse_down:left"]({}, cx());
  node("r:pw:~/dev/web").handlers.on_mouse_move({}, cx());
  node("r:pw:~/dev/web").handlers["on_mouse_up:left"]({}, cx());
  await settle();
  let d = JSON.parse(H.files.get(FILE()));
  assert.deepEqual(d.projects.find((p) => p.id === "pw").folders, ["~/dev/docs", "~/dev/app", "~/dev/web"]);
  // A task (next1, in web) onto the docs folder: the folder is lit, the task goes in.
  await view.store.load();
  await settle();
  node("t-next1").handlers["on_mouse_down:left"]({}, cx());
  node("r:pw:~/dev/docs").handlers.on_mouse_move({}, cx());
  assert.ok(node("r:pw:~/dev/docs").calls.some(([m]) => m === "bg"), "the folder it would go in is lit");
  node("r:pw:~/dev/docs").handlers["on_mouse_up:left"]({}, cx());
  await settle();
  d = JSON.parse(H.files.get(FILE()));
  assert.deepEqual(["project", "folder"].map((k) => d.tasks.find((x) => x.id === "next1")[k]), ["pw", "~/dev/docs"]);
});

test("the + for a new task is in Now's header, not in Projects' (tasks are made in their project or folder)", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "projects";
  await settle();
  assert.ok(!walk(render(view).tree).some((n) => n.id === "add-task"));
  H.shared["taskr.view"] = "now";
  assert.ok(walk(render(view).tree).some((n) => n.id === "add-task"));
});

test("Start with…: the agent, model and effort are kept on the task and its agent starts with their flags", async () => {
  const d = await mount({ dialog: "start", overlay: "ov1", task: "next1" });
  await settle();
  const node = (id) => walk(render(d.view).tree).find((n) => n.id === id);
  node("sa-codex").handlers.on_click({}, cx());
  d.view.modelInput.type("gpt-6.1-sol", cx());
  node("se-high").handlers.on_click({}, cx());
  node("start-go").handlers.on_click({}, cx());
  await settle(40);
  const t = JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "next1");
  assert.deepEqual([t.agent, t.model, t.effort], ["codex", "gpt-6.1-sol", "high"]);
  const opened = H.runs.find(([n]) => n === "tab.new" || n === "space.new");
  assert.deepEqual(opened[1].argv, ["codex", "-m", "gpt-6.1-sol", "-c", 'model_reasoning_effort="high"']);
  // Back to the default agent and no model: the task forgets them.
  const d2 = await mount({ dialog: "start", overlay: "ov2", task: "next1" });
  await settle();
  walk(render(d2.view).tree).find((n) => n.id === "sa-null").handlers.on_click({}, cx());
  d2.view.modelInput.set_value("");
  d2.view.choice.model = "";
  walk(render(d2.view).tree).find((n) => n.id === "start-go").handlers.on_click({}, cx());
  await settle(40);
  const t2 = JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "next1");
  assert.deepEqual([t2.agent, t2.model], [undefined, undefined]);
});

test("project and folder menus: a task, a terminal, the board; no list of every agent", async () => {
  const pm = await mount({ dialog: "project-menu", overlay: "ov1", project: "pw" });
  await settle();
  const ids = walk(render(pm.view).tree).map((n) => n.id).filter((x) => /^p-/.test(x ?? ""));
  assert.deepEqual(ids.slice(0, 3), ["p-task", "p-term", "p-board"]);
  assert.ok(!ids.some((x) => x.startsWith("p-ag-")));
  const rm = await mount({ dialog: "repo", overlay: "ov2", repo: "~/dev/web", project: "pw" });
  await settle();
  const rids = walk(render(rm.view).tree).map((n) => n.id).filter((x) => /^r-/.test(x ?? ""));
  assert.deepEqual(rids.slice(0, 2), ["r-task", "r-term"]);
  assert.ok(!rids.some((x) => x.startsWith("r-ag-")));
});

test("a press becomes a drag only when the pointer moves; a stale press expires; leaving the list ends it", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["taskr.view"] = "projects";
  await settle();
  const node = (id) => walk(render(view).tree).find((n) => n.id === id);
  const at = (x, y) => ({ position: { x, y } });
  // Pressed (a button's click whose release went to a menu) and barely moved: no drag, no line.
  node("p:pa").handlers["on_mouse_down:left"](at(10, 10), cx());
  node("p:pw").handlers.on_mouse_move(at(11, 11), cx());
  assert.equal(view.dragProject ?? null, null);
  assert.ok(!node("p:pw").calls.some(([m]) => m === "border_t" || m === "border_b"));
  // Long after: the press is forgotten, however far the pointer goes.
  view.pressed.at -= 5000;
  node("p:pw").handlers.on_mouse_move(at(10, 80), cx());
  assert.equal(view.dragProject ?? null, null);
  assert.equal(view.pressed, null);
  // A real drag, then the pointer leaves the list: over.
  node("p:pa").handlers["on_mouse_down:left"](at(10, 10), cx());
  node("p:pw").handlers.on_mouse_move(at(10, 40), cx());
  assert.equal(view.dragProject, "pa");
  walk(render(view).tree).find((n) => n.id === "taskr-sidebar").handlers.on_hover(false, cx());
  assert.equal(view.dragProject, null);
});

test("task form: from a project or a folder it says where and doesn't ask for the project; from Now it does; a new task starts in Inbox or Next", async () => {
  const inProject = await mount({ dialog: "task", overlay: "ov1", project: "pw", repo: "~/dev/web" });
  await settle();
  let ids = walk(render(inProject.view).tree).map((n) => n.id ?? "");
  assert.match(text(render(inProject.view).tree), /New task · Website/);
  assert.ok(!ids.some((x) => x.startsWith("proj-")), "no project picker");
  assert.ok(ids.includes("repo-~/dev/docs"), "its folders to pick from");
  assert.deepEqual(ids.filter((x) => x.startsWith("st-")), ["st-inbox", "st-next"]);
  const fromNow = await mount({ dialog: "task", overlay: "ov2" });
  await settle();
  ids = walk(render(fromNow.view).tree).map((n) => n.id ?? "");
  assert.ok(ids.some((x) => x.startsWith("proj-")), "from Now: where does it go?");
  const edit = await mount({ dialog: "task", overlay: "ov3", task: "next1" });
  await settle();
  ids = walk(render(edit.view).tree).map((n) => n.id ?? "");
  assert.ok(!ids.some((x) => x.startsWith("proj-")), "editing doesn't move it to another project");
  assert.ok(ids.includes("st-dropped"));
});

test("Stats: periods and projects to pick, tiles, a chart per measure, a table by project; opened from Now and a project's menu", async () => {
  const { view } = await mount({ role: "stats" }, () => {
    const d = JSON.parse(H.files.get(FILE()));
    d.tasks.push(task({ id: "w1", title: "Worked", project: "pa", status: "doing", auto: true, work: { [iso(0)]: [7200000, 4] } }));
    H.files.set(FILE(), JSON.stringify(d));
  });
  await settle();
  let words = text(render(view).tree);
  assert.match(words, /Worked on/);
  assert.match(words, /1 with no plan/);
  assert.match(words, /2h/);
  const node = (id) => walk(render(view).tree).find((n) => n.id === id);
  assert.ok(node("st-bars-time") && node("st-bars-done"), "two charts, one measure each");
  node("sp-today").handlers.on_click({}, cx());
  assert.ok(!node("st-bars-time"), "no bars for a single day");
  node("spj-pa").handlers.on_click({}, cx());
  assert.ok(!node("st-projects"), "one project: no table by project");
  const side = await mount({ role: "sidebar" });
  H.runs.length = 0;
  walk(render(side.view).tree).find((n) => n.id === "stats").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.at(-1), ["tab.new", { name: "Stats", mod: "taskr", props: { role: "stats" } }]);
});
