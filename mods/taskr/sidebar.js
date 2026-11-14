// The sidebar: Now (what unblocks progress) and Projects (the outline).
// The sidebar copy also keeps the books: it ties new tabs to the tasks that
// launched them, moves tasks as their agents work, and adds up agent time.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, run, shared, setShared, setAgentOrder, home, spaces, terminals, panes, nextCommand, props, notify, window, focused } from "herdr";
import { S } from "./strings.js";
import { setStatus, kept, moveTask, toTop } from "./lib/store.js";
import { nowView, projectTree, untrackedName, agentTitle, taskWhere, looseWhere } from "./lib/world.js";
import { arrived, link, openHere, adopt, openInProject, labelProject, openBoard, moveRepo } from "./lib/actions.js";
import { RANK, OPEN, tilde, untilde, today, isLater, laterLabel } from "./lib/util.js";
import { taskMark, dueChip, agentMark, sectionHeader, iconButton, programIcon, CHEVRON, icon, agentFor, shownLists } from "./lib/ui.js";
import { sharedCache } from "./lib/cache.js";
import { Revive } from "./lib/revive.js";
import { openDialog } from "./lib/open.js";

// A task with no plan whose agent quit is closed this long after (time for an agent to come back
// by itself after a restart, or for you to start it again in the same tab).
const QUIT_MS = 30000;
// The stacked lists' blocks in the layout, and the height of a folded one (its header).
const STACK = { projects: "taskr-projects", now: "taskr-now" };
const STACK_HEADER = 41;

const lead = (x) => [...(x.agents ?? [])].sort((a, b) => (RANK[b.top] ?? 0) - (RANK[a.top] ?? 0))[0] ?? null;

export const Sidebar = {
  initSidebar(cx) {
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    this.filters = JSON.parse(localStorage.getItem("filters") ?? '{"done":false}');
    // A list can show one view only ({ view: "now" | "projects" }): two of them, one above
    // the other, show both at once. Without it, the list has Now/Projects tabs.
    this.fixedView = ["now", "projects"].includes(props()?.view) ? props().view : null;
    // Bookkeeping state lives where every list sees it: with two lists on screen,
    // whichever draws first records a change, and the other finds it recorded.
    this.books = sharedCache("books").info; // prevTop: task id -> top state; workSince: address -> ms
    this.revive = new Revive(); // agents back after a restart (shared state)
    this.handle = cx.focus_handle();
    this.order = [];
    cx.timer.every(30000, (cx) => cx.notify()); // durations
    // Agents that report no state: their titles say it (read without drawing; a change redraws).
    cx.timer.every(3000, (cx) => { if (this.quiet?.length && window()?.active) this.titles.refresh(cx, this.quiet); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommandSafe();
        if (c == null) return;
        // Key commands reach every list on screen: the first one acts.
        if (!this.isFirstList()) continue;
        if (c === "focus") this.handle.focus();
        else this.command(c, cx);
        cx.notify();
      }
    });
  },

  // The list that takes key commands and sets agent.next/prev: the only one on screen,
  // Now when both show (the list you work from), else the first.
  isFirstList() {
    const lists = shownLists();
    if (!lists.length) return true;
    return (lists.includes("now") ? "now" : lists[0]) === this.fixedView;
  },

  view() {
    return this.fixedView ?? shared("taskr.view") ?? "now";
  },

  // To the other view: the other tab, or the other list when both show.
  switchView() {
    const next = this.view() === "now" ? "projects" : "now";
    if (!this.fixedView || !shownLists().includes(next)) return setShared("taskr.view", next);
    sharedCache("lists").info.focus = next;
    setShared("taskr.listFocus", Date.now()); // redraws every list; that one takes the keys
  },

  // Stacked lists (Projects over Now): one folds to its header and the other takes the room;
  // never both. Herdr keeps the sizes; which one is folded is shared by both copies.
  stackFold(view, fold) {
    const other = view === "now" ? "projects" : "now";
    if (fold) {
      run("layout.resize", { id: STACK[view], px: STACK_HEADER });
      run("layout.resize", { id: STACK[other], weight: 1 });
    } else run("layout.resize", { id: STACK[view], weight: 1 });
    setShared("taskr.stackFolded", fold ? view : null);
  },

  // All the room to this one: the other folds (this one unfolds first if it was).
  stackFocus(view) {
    if (shared("taskr.stackFolded") === view) this.stackFold(view, false);
    this.stackFold(view === "now" ? "projects" : "now", true);
  },

  fold(id, cx) {
    this.folded.has(id) ? this.folded.delete(id) : this.folded.add(id);
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
    cx.notify();
  },

  // Selecting shows the task in the detail panel when it's open; it never opens it:
  // the panel is there when the person wants more (its button, cmd-i, i, Details).
  select(id) {
    setShared("taskr.selected", id);
  },

  // The pane to show for a task: its agent's (the one that needs you most), else a
  // terminal in one of its open tabs.
  paneOf(x) {
    const e = x && lead(x);
    if (e?.a?.pane) return e.a.pane;
    for (const tab of x?.live ?? []) {
      const p = panes().find((y) => y.tab === tab && y.terminal);
      if (p) return p.pane;
    }
    return null;
  },

  // To the task's agent or terminal; without one, its form.
  go(task, x) {
    const pane = this.paneOf(x);
    if (pane) run("pane.focus", { pane });
    else this.openTaskForm({ task: task.id });
  },

  // Keys: j/k move, enter goes to the agent, space done, t to the top, n new, e edit, l launch, w worktree, / jump.
  command(c, cx) {
    const sel = shared("taskr.selected");
    const i = this.order.indexOf(sel);
    const task = this.store.task(sel);
    const move = (d) => { const id = this.order[Math.max(0, Math.min(this.order.length - 1, (i < 0 ? -d : i) + d))]; if (id) setShared("taskr.selected", id); };
    const upd = (fn) => task && cx.spawn(async () => this.store.update((d) => { const x = d.tasks.find((y) => y.id === task.id); if (!x) return false; fn(kept(x)); x.updated = Date.now(); }));
    // "select:<task id>" (herdr-app do taskr.select:<id>): show that task, for scripts and agents.
    // Asked for by a script or a notification: the panel opens for it.
    if (c.startsWith("select:")) {
      const id = c.slice(7);
      if (this.store.task(id)) { this.select(id); run("layout.show", { id: "taskr-detail" }); }
      return;
    }
    switch (c) {
      case "down": return move(1);
      case "up": return move(-1);
      case "open": return task && this.go(task, this.world?.taskById.get(task.id));
      case "done": return upd((x) => setStatus(x, x.status === "done" ? "next" : "done"));
      case "top": return task && cx.spawn(async () => this.store.update((d) => { const x = d.tasks.find((y) => y.id === task.id); if (!x) return false; kept(x); return toTop(d, task.id); }));
      case "new": return this.openTaskForm({});
      case "edit": return task && this.openTaskForm({ task: task.id });
      case "launch": return task && this.launch(cx, task, false);
      case "worktree": return task?.folder && !this.repos.notGit(untilde(task.folder, home())) && this.launch(cx, task, true);
      case "resume": return task && this.resume(cx, task);
      case "later": return task && openDialog("later", { task: task.id });
      case "details": return task && run("layout.show", { id: "taskr-detail" });
      case "jump": return openDialog("jump");
      case "board": return this.openBoard();
      case "settings": return openDialog("settings");
      case "linear": return openDialog("issues", { source: "linear" });
      case "view": return this.switchView();
    }
  },

  key(e, cx) {
    const map = { j: "down", down: "down", k: "up", up: "up", enter: "open", space: "done", t: "top", n: "new", e: "edit", l: "launch", w: "worktree", r: "resume", z: "later", i: "details", "/": "jump", tab: "view" };
    const c = e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt ? null : map[e.key];
    if (!c) return;
    this.command(c, cx);
    cx.stop_propagation();
    cx.notify();
  },

  // The board of every project (cmd-shift-b); a project's own comes from its menu.
  openBoard() {
    openBoard();
  },

  openTaskForm(p) {
    openDialog("task", p);
  },

  // ── Bookkeeping (this copy only) ────────────────────────────────────────
  keepBooks(cx, w) {
    const ops = [];
    const now = Date.now();
    // New tabs from launches.
    const pending = shared("taskr.pending") ?? [];
    if (pending.length) {
      const sp = spaces();
      const left = [];
      const taken = new Set(w.taskOfTab.keys());
      const ts = terminals();
      for (const p of pending) {
        const tab = p.tab ?? arrived({ ...p, beforeTabs: new Set(p.beforeTabs), beforeSpaces: new Set(p.beforeSpaces) }, sp, taken);
        // A project's tab is known only by the label on its terminals: it waits (a minute at
        // most) until its first terminal is there to be labelled, which can be a look later.
        if (tab && p.project && !ts.some((x) => x.labels?.["herdr.tab"] === tab)) {
          taken.add(tab);
          if (now - p.at < 60000) left.push({ ...p, tab });
        } else if (tab) {
          taken.add(tab);
          if (p.project) cx.spawn(async () => labelProject(p.project, tab, ts));
          else cx.spawn(async () => link(this.store, p.task, tab, ts));
        }
        else if (now - p.at < 30000) left.push(p);
      }
      if (left.length !== pending.length || left.some((p, i) => p !== pending[i])) setShared("taskr.pending", left);
    }
    // Agent time, per agent.
    const live = new Set();
    for (const x of w.tasks) {
      for (const e of x.agents) {
        const addr = e.a.address;
        live.add(addr);
        const workSince = (this.books.workSince ??= {});
        const since = workSince[addr];
        if (e.status === "working" && since == null) workSince[addr] = now;
        if (e.status !== "working" && since != null) {
          const ms = Math.min(now - since, 8 * 3600000);
          ops.push((d) => { const t = d.tasks.find((y) => y.id === x.t.id); if (t) t.agent_ms = (t.agent_ms ?? 0) + ms; });
          delete workSince[addr];
        }
      }
    }
    for (const a of Object.keys(this.books.workSince ?? {})) if (!live.has(a)) delete this.books.workSince[a];
    // The conversation each local agent is in, kept on its task so it can be resumed.
    for (const x of w.tasks) {
      for (const e of x.agents) {
        const info = e.a.address.includes("/") ? null : this.info.get(e.a.address);
        if (!info?.session || (x.t.sessions ?? []).some((s) => s.id === info.session)) continue;
        const rec = { app: info.app, id: info.session, cwd: info.cwd ? tilde(info.cwd, home()) : null, at: now };
        ops.push((d) => {
          const t = d.tasks.find((y) => y.id === x.t.id);
          if (t && !(t.sessions ?? []).some((s) => s.id === rec.id)) t.sessions = [...(t.sessions ?? []), rec].slice(-5);
        });
      }
    }
    // Task status follows its agents; never to done by itself.
    const first = this.books.prevTop == null;
    const prev = this.books.prevTop ?? {};
    this.books.prevTop = {};
    for (const x of w.tasks) {
      const top = x.top;
      this.books.prevTop[x.t.id] = top;
      if (first || prev[x.t.id] === top || x.t.archived || x.t.status === "dropped") continue;
      const was = prev[x.t.id];
      if (top === "working" && ["inbox", "next", "waiting", "review", "done"].includes(x.t.status)) ops.push((d) => setStatus(d.tasks.find((y) => y.id === x.t.id), "doing"));
      if (was === "working" && (top === "done" || top === "idle") && x.t.status === "doing") {
        ops.push((d) => setStatus(d.tasks.find((y) => y.id === x.t.id), "review"));
      }
      // Herdr itself notifies when an agent needs you or finishes: no second toast here.
    }
    this.follow(cx, w, ops, now);
    this.pauseQuiet(w, ops, now);
    this.remind(w, ops, now);
    this.revive.step(cx, [...w.termBy.values()], this.info, this.store.data.settings.revive !== false);
    if (ops.length) cx.spawn(async () => this.store.update((d) => { for (const op of ops) op(d); }));
  },

  // Every agent's tab is a task: one with no plan (`auto`) from its start, named after its
  // agent, until the person changes anything on it. Planned or not, a task moves with its agent
  // (keepBooks); one with no plan is also looked after for you: once you look at its terminal, or
  // after `review_after` minutes, it leaves To review for Idle while its agent stays open, back in
  // Doing when it works again; Done once its agent quits or its tab closes (resumable from there). After a restart the agent comes back by itself (lib/revive.js)
  // before that, and the task goes on.
  follow(cx, w, ops, now) {
    const adopting = (this.books.adopting ??= {});
    for (const u of w.untracked) {
      if (!u.agents.length || adopting[u.tab]) continue;
      adopting[u.tab] = now;
      cx.spawn(async () => { try { await adopt(this.store, u); } finally { delete adopting[u.tab]; } });
    }
    const gone = (this.books.gone ??= {});
    const anySpace = w.spaces.length > 0;
    const wait = (this.store.data.settings.review_after ?? 60) * 60000;
    const looking = window()?.active ? focused()?.pane ?? null : null;
    const close = (id) => ops.push((d) => { const y = d.tasks.find((z) => z.id === id); if (y?.auto && OPEN.has(y.status)) setStatus(y, "done", now); });
    const rest = (id) => ops.push((d) => { const y = d.tasks.find((z) => z.id === id); if (y?.auto && OPEN.has(y.status) && !y.idle) y.idle = true; });
    for (const x of w.tasks) {
      if (!x.t.auto || !x.open) { delete gone[x.t.id]; continue; }
      const name = x.agents.map(agentTitle).find(Boolean);
      if (name && name !== x.t.title) ops.push((d) => { const y = d.tasks.find((z) => z.id === x.t.id); if (y?.auto) y.title = name; });
      // Its tab closed, or its agent quit (and not because Herdr is still bringing spaces back,
      // or a machine is away).
      if (!(x.live.length && x.agents.length)) {
        if (!anySpace || x.tabs.some((tab) => tab.includes("/"))) { delete gone[x.t.id]; continue; }
        gone[x.t.id] ??= now;
        if (now - gone[x.t.id] > (x.live.length ? QUIT_MS : 60000)) { delete gone[x.t.id]; close(x.t.id); }
        continue;
      }
      delete gone[x.t.id];
      // Its agent stopped: seen (its terminal in front), or waiting longer than asked.
      if (["working", "blocked"].includes(x.top) || x.t.idle || isLater(x.t)) continue;
      const since = (x.t.history ?? []).at(-1)?.at ?? x.t.updated ?? now;
      const seen = Boolean(looking) && x.agents.some((e) => e.a.pane === looking);
      if (seen || (wait > 0 && now - since > wait)) rest(x.t.id);
    }
  },

  // Projects with nothing going on for `pause_after` days pause by themselves, and come back by
  // themselves at the next sign of life (a task changed, an agent at work or asking). One the
  // person paused stays paused.
  pauseQuiet(w, ops, now) {
    const days = this.store.data.settings.pause_after ?? 3;
    const last = new Map();
    const touch = (id, at) => { if (id && at > (last.get(id) ?? 0)) last.set(id, at); };
    for (const x of w.tasks) {
      touch(x.project, Math.max(x.t.updated ?? 0, x.t.history?.at(-1)?.at ?? 0, x.t.done_at ?? 0));
      if (["working", "blocked"].includes(x.top)) touch(x.project, now);
    }
    for (const u of w.untracked) if (["working", "blocked"].includes(u.top)) touch(u.project ?? w.projectOfRepo.get(u.where.key), now);
    for (const p of this.store.data.projects) {
      const at = Math.max(last.get(p.id) ?? 0, p.active_at ?? 0);
      // A project with nothing in it yet counts from when taskr first sees it.
      if (!p.active_at && !p.paused && !last.has(p.id)) { ops.push((d) => { const y = d.projects.find((z) => z.id === p.id); if (y && !y.active_at) y.active_at = now; }); continue; }
      if (p.paused && p.paused_auto && at > p.paused_auto) {
        ops.push((d) => { const y = d.projects.find((z) => z.id === p.id); if (y?.paused_auto) { y.paused = false; delete y.paused_auto; y.active_at = now; } });
      } else if (!p.paused && days > 0 && now - at > days * 86400000) {
        ops.push((d) => { const y = d.projects.find((z) => z.id === p.id); if (y && !y.paused) { y.paused = true; y.paused_auto = now; } });
      }
    }
  },

  // Tasks put off whose day came: back in Now, with a notification. And once a day,
  // what's due or late. `books.sent` keeps two lists on screen from sending twice.
  remind(w, ops, now) {
    const day = today();
    const sent = (this.books.sent ??= {});
    const on = this.store.data.settings.reminders !== false;
    const pick = (list) => list.map((x) => x.t);
    const tell = (title, tasks, level = "info") => {
      if (!on || !tasks.length) return;
      notify({ title, body: tasks.map((t) => t.title).slice(0, 4).join(" · ") + (tasks.length > 4 ? " …" : ""), level,
        action: tasks.length === 1 ? { name: `taskr.select:${tasks[0].id}` } : { name: "taskr.focus" } });
    };
    const back = pick(w.tasks.filter((x) => x.open && !x.t.archived && x.t.snooze && x.t.snooze !== "someday" && x.t.snooze <= day && sent[`back:${x.t.id}`] !== x.t.snooze));
    for (const t of back) {
      sent[`back:${t.id}`] = t.snooze;
      ops.push((d) => { const y = d.tasks.find((z) => z.id === t.id); if (y && y.snooze === t.snooze) { y.snooze = null; y.updated = now; } });
    }
    tell(S.backTitle(back.length), back);
    // One notification per task a day: one back from Later today isn't told again as due.
    const told = new Set(back.map((t) => t.id));
    const due = pick(w.tasks.filter((x) => x.open && !x.t.archived && !told.has(x.t.id) && !isLater(x.t) && x.t.due && x.t.due <= day && x.t.reminded !== day && sent[`due:${x.t.id}`] !== day));
    for (const t of due) {
      sent[`due:${t.id}`] = day;
      ops.push((d) => { const y = d.tasks.find((z) => z.id === t.id); if (y) y.reminded = day; });
    }
    tell(S.dueTitle(due.some((t) => t.due < day), due.length), due, due.some((t) => t.due < day) ? "warning" : "info");
  },

  // A project dropped on another: it takes that one's place (the order of tasks.json, which
  // the board's pills and the task form follow too).
  dropProject(cx, target) {
    const from = this.dragProject;
    this.dragProject = null;
    this.dragOver = null;
    if (!from || from === target) return;
    cx.stop_propagation();
    cx.spawn(async () => this.store.update((d) => {
      const i = d.projects.findIndex((x) => x.id === from), j = d.projects.findIndex((x) => x.id === target);
      if (i < 0 || j < 0) return false;
      const [moved] = d.projects.splice(i, 1);
      d.projects.splice(j, 0, moved);
    }));
    cx.notify();
  },

  // A repository (or folder) dropped on a project's header: it moves there ("No project": out).
  dropRepo(cx, projectId) {
    const from = this.dragRepo;
    this.dragRepo = null;
    this.dragOver = null;
    if (!from || from.project === projectId) return cx.notify();
    cx.stop_propagation();
    cx.spawn(async () => this.store.update((d) => moveRepo(d, from.key, projectId, home())));
    cx.notify();
  },

  // A task dropped on another row: it takes that one's place in the list (`ids`, in order).
  // From Inbox onto Up next (or back) it changes list too.
  dropTask(cx, target, ids) {
    const from = this.dragTask;
    this.dragTask = null;
    this.dragOver = null;
    if (!from || from === target) return;
    cx.stop_propagation();
    const plan = ["inbox", "next"];
    cx.spawn(async () => this.store.update((d) => {
      const t = d.tasks.find((y) => y.id === from), to = d.tasks.find((y) => y.id === target);
      if (!t || !to) return false;
      kept(t);
      if (t.status !== to.status && plan.includes(t.status) && plan.includes(to.status)) setStatus(t, to.status);
      t.updated = Date.now();
      return moveTask(d, from, ids, target);
    }));
    cx.notify();
  },

  // Where a row being dragged may land: in its own list, or between Inbox and Up next.
  canDrop(task, ids) {
    const from = this.dragTask && this.store.task(this.dragTask);
    if (!from || from.id === task.id) return false;
    return ids.includes(from.id) || (["inbox", "next"].includes(from.status) && ["inbox", "next"].includes(task.status));
  },

  // ── Rows ────────────────────────────────────────────────────────────────
  // `ids`: the list it's in, in order, when it can be dragged to another place in it.
  taskRow(t, x, { showWhere = false, depth = 0, ids = null } = {}) {
    const task = x.t;
    const e = lead(x);
    const selected = shared("taskr.selected") === task.id;
    const blocked = e?.top === "blocked";
    const msg = blocked ? (e.report?.msg ?? "").replace(/^answer:\s*/i, "") : null;
    const since = this.sinceOf(e);
    const later = isLater(task) ? S.laterUntil(laterLabel(task.snooze)) : null;
    // Where it is (Projects' outline already says it), then how long its agent has been as it is.
    // Model, effort and context live in the terminal's header and the detail.
    const where = showWhere ? taskWhere(this.store.data, x, home()) : null;
    const tail = (e ? agentFor(e.top, since) : null) ?? later ?? (task.next_step ? `→ ${task.next_step}` : null);
    const second = msg || [where, tail].filter(Boolean).join(" · ") || null;
    const done = task.status === "done" || task.status === "dropped";
    const due = done ? null : dueChip(t, task.due);
    // Another row held over this one: a line shows where it lands (below when it comes from above).
    const target = Boolean(ids) && this.dragOver === task.id && this.canDrop(task, ids);
    const below = target && ids.indexOf(this.dragTask) >= 0 && ids.indexOf(this.dragTask) < ids.indexOf(task.id);
    return v_flex().id(`t-${task.id}`).pl(8 + depth * 14).pr(6).py(4).flex_none().rounded(8).gap(1)
      .when(selected, (el) => el.bg(t.selected))
      .when(this.dragTask === task.id && Boolean(this.dragOver) && this.dragOver !== task.id, (el) => el.opacity(0.45))
      .when(target && !below, (el) => el.rounded_none().border_t(2).border_color(t.accent))
      .when(target && below, (el) => el.rounded_none().border_b(2).border_color(t.accent))
      .when(Boolean(ids), (el) => el
        .on_mouse_down("left", () => { this.dragTask = task.id; this.dragOver = null; })
        .on_mouse_move((_e, cx) => { if (this.dragTask && this.dragOver !== task.id) { this.dragOver = task.id; cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { if (this.canDrop(task, ids)) this.dropTask(cx, task.id, ids); }))
      .cursor_pointer().hover((s) => s.bg(t.hover))
      // Shows the task and brings its tab to the front; a task with none keeps the keys here.
      .on_click((_e, cx) => {
        this.select(task.id);
        const pane = this.paneOf(x);
        if (pane) run("pane.focus", { pane }); else this.handle.focus();
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); setShared("taskr.selected", task.id); openDialog("menu", { task: task.id }); })
      .on_hover((on, cx) => { this.hovered = on ? task.id : this.hovered === task.id ? null : this.hovered; cx.notify(); })
      .child(h_flex().h(20).gap(7).items_center()
        .child(taskMark(t, task, e?.top))
        .child(div().flex_1().min_w(0).truncate().text_color(done || later ? t.dim : t.foreground).when(e?.top === "done", (el) => el.font_semibold()).child(task.title))
        .when(this.hovered === task.id && !e && !done, (el) => el.child(iconButton(t, `go-${task.id}`, "play", S.startHint, (_e, cx) => this.launch(cx, task, false))))
        .when(Boolean(due), (el) => el.child(due)))
      .when(Boolean(second), (el) => el.child(div().pl(23).truncate().text_size(11).text_color(blocked ? t.blocked : t.dim).child(second)));
  },

  untrackedRow(t, u, depth = 0, showWhere = false) {
    const e = u.agents[0];
    const p0 = u.panes[0];
    const name = untrackedName(u);
    const pic = programIcon(e?.a.program ?? p0?.program, 14, t.muted) ?? icon("square-terminal", 13, t.dim);
    const pane = e?.a.pane ?? p0?.pane;
    // The same second line as a task's: where it is, how long in this state.
    const where = showWhere ? looseWhere(this.world, this.store.data, u, home()) : null;
    const time = e ? agentFor(u.top ?? e.status, this.sinceOf(e)) : null;
    const blocked = u.top === "blocked";
    const msg = blocked ? (e?.report?.msg ?? "").replace(/^answer:\s*/i, "") : "";
    const second = msg || [where, time].filter(Boolean).join(" · ");
    return v_flex().id(`u-${u.tab}`).pl(8 + depth * 14).pr(6).py(3).flex_none().gap(1).rounded(8)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => pane && run("pane.focus", { pane }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openDialog("loose", { tab: u.tab }); })
      .child(h_flex().h(20).gap(7).items_center()
      .child(h_flex().w(16).justify_center().child(agentMark(t, u.top) ?? pic))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(name)))
      .when(Boolean(second), (el) => el.child(div().pl(23).truncate().text_size(11).text_color(blocked ? t.blocked : t.dim).child(second)));
  },

  // ── Now ─────────────────────────────────────────────────────────────────
  nowRows(t, w) {
    const v = nowView(w, this.store.data);
    const rows = [];
    const order = [];
    // `shut`: folded until opened (Later: out of the way is the point).
    const section = (id, label, list, color, { max = 99, shut = false } = {}) => {
      if (!list.length) return;
      const key = shut ? `${id}:open` : id;
      const open = shut ? this.folded.has(key) : !this.folded.has(key);
      rows.push(sectionHeader(t, `sec-${id}`, label, list.length, color, open, (cx) => this.fold(key, cx)));
      if (!open) return;
      // Later keeps its order by day; every other list can be reordered by dragging.
      const ids = shut ? null : list.map((x) => x.t.id);
      for (const x of list.slice(0, max)) { rows.push(this.taskRow(t, x, { showWhere: true, ids })); order.push(x.t.id); }
      if (list.length > max) rows.push(div().id(`more-${id}`).pl(31).h(22).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click(() => setShared("taskr.view", "projects")).child(S.more(list.length - max)));
    };
    section("needs", S.needsYou, v.needs, t.blocked);
    section("review", S.toReview, v.review, t.done);
    section("working", S.working, v.working, t.working);
    section("next", S.nextUp, v.next, t.foreground, { max: 7 });
    section("stalled", S.stalled, v.stalled, t.ansi3);
    section("inbox", S.inbox, v.inbox, t.dim, { max: 5 });
    section("later", S.later, v.later, t.dim, { shut: true });
    // Last: agents you've seen, waiting for a word from you.
    section("idle", S.idle, v.idle, t.dim, { shut: true });
    this.order = order;
    if (!rows.length) rows.push(div().px(12).pt(12).text_size(12).text_color(t.dim).child(S.emptyNow));
    return rows;
  },

  // ── Projects ────────────────────────────────────────────────────────────
  projectRows(t, w) {
    const tree = projectTree(w, this.store.data, home(), this.filters);
    const rows = [];
    const order = [];
    const repoRows = (proj, r) => {
      const id = `r:${proj?.id ?? "-"}:${r.key}`;
      const open = !this.folded.has(id);
      const sp = r.spaces[0];
      const st = sp?.repo;
      // Open: a space is in it, or one of its tasks has a terminal alive (an agent started elsewhere).
      const live = Boolean(sp) || r.tasks.some((x) => x.live.length > 0);
      const top = [...r.tasks.map((x) => x.top), ...r.untracked.map((u) => u.top)].reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      rows.push(h_flex().id(id).pl(18).pr(6).h(26).flex_none().gap(6).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.fold(id, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openDialog("repo", { repo: r.key, project: proj?.id ?? null }); })
        // Dragged onto a project's header, it moves to that project.
        .on_mouse_down("left", () => { this.dragRepo = { key: r.key, project: proj?.id ?? null }; this.dragOver = null; })
        .when(this.dragRepo?.key === r.key && Boolean(this.dragOver), (el) => el.opacity(0.45))
        .child(svg(CHEVRON(open)).size(10).flex_none().text_color(t.dim))
        .child(icon("folder", 12, live ? t.muted : t.dim))
        .child(div().flex_none().max_w(150).truncate().text_color(live ? t.foreground : t.dim).child(r.name))
        .when(Boolean(st?.branch), (el) => el.child(div().id(`br-${id}`).min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(S.branchHint(st.branch)).child(`⎇ ${st.branch}`)))
        .when((st?.ahead ?? 0) > 0, (el) => el.child(div().id(`ah-${id}`).text_size(10.5).text_color(t.dim).tooltip(S.aheadHint(st.ahead)).child(`↑${st.ahead}`)))
        .when((st?.dirty ?? 0) > 0, (el) => el.child(div().id(`dt-${id}`).text_size(10.5).text_color(t.ansi3).tooltip(S.dirtyHint(st.dirty)).child(`•${st.dirty}`)))
        .when(!live, (el) => el.child(div().id(`no-${id}`).text_size(10.5).text_color(t.dim).tooltip(S.notOpenHint).child(S.notOpen)))
        .child(div().flex_1())
        .when(!open && Boolean(top), (el) => el.child(agentMark(t, top)))
        .child(iconButton(t, `term-${id}`, "square-terminal", S.newTerminal, () => openHere(r.key)))
        .child(iconButton(t, `add-${id}`, "plus", S.newTask, () => this.openTaskForm({ repo: r.key, project: proj?.id ?? null })))
        .child(iconButton(t, `more-${id}`, "ellipsis", S.repoMenu, () => openDialog("repo", { repo: r.key, project: proj?.id ?? null }))));
      if (!open) return;
      const ids = r.tasks.map((x) => x.t.id);
      for (const x of r.tasks) { rows.push(this.taskRow(t, x, { depth: 2, ids })); order.push(x.t.id); }
      for (const u of r.untracked) rows.push(this.untrackedRow(t, u, 2));
    };
    const projectHeader = (x) => {
      const p = x.p;
      const id = `p:${p?.id ?? "-"}`;
      const open = !this.folded.has(id);
      // Its actions show while the pointer is on it (board, terminal, task, menu); else its count.
      const acts = Boolean(p) && this.hovered === id && !this.dragProject;
      // Dragged onto another project: a line shows where it lands (above when moving up).
      const order = this.store.data.projects.map((y) => y.id);
      const dragging = Boolean(p) && this.dragProject && this.dragOver === p.id && this.dragProject !== p.id;
      const below = dragging && order.indexOf(this.dragProject) < order.indexOf(p.id);
      // A repository dragged over it: the project it would go to is lit.
      const target = p?.id ?? null;
      const repoOver = Boolean(this.dragRepo) && this.dragOver === `p:${target ?? "-"}` && this.dragRepo.project !== target;
      rows.push(h_flex().id(id).px(8).pt(8).h(32).flex_none().gap(7).items_center().cursor_pointer()
        .when(Boolean(p) && this.dragProject === p.id && Boolean(this.dragOver) && this.dragOver !== p.id, (el) => el.opacity(0.45))
        .when(dragging && !below, (el) => el.border_t(2).border_color(t.accent))
        .when(dragging && below, (el) => el.border_b(2).border_color(t.accent))
        .when(repoOver, (el) => el.rounded(6).bg(t.selected))
        .on_click((_e, cx) => this.fold(id, cx))
        .on_mouse_down("right", (_e, cx) => { if (p) { cx.stop_propagation(); openDialog("project-menu", { project: p.id }); } })
        .when(Boolean(p), (el) => el.on_mouse_down("left", () => { this.dragProject = p.id; this.dragOver = null; }))
        // Over it: a project being dragged (to reorder) or a repository (to move it here).
        .on_mouse_move((_e, cx) => {
          const over = this.dragRepo ? id : this.dragProject && p ? p.id : null;
          if (over && this.dragOver !== over) { this.dragOver = over; cx.notify(); }
        })
        .on_mouse_up("left", (_e, cx) => { if (this.dragRepo) this.dropRepo(cx, target); else if (p) this.dropProject(cx, p.id); })
        .on_hover((on, cx) => { this.hovered = on ? id : this.hovered === id ? null : this.hovered; cx.notify(); })
        .child(icon("layers", 13, p && !p.paused ? t.muted : t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(p && !p.paused ? t.foreground : t.dim).child(p?.name ?? S.noProject))
        .when(!open && Boolean(x.top), (el) => el.child(agentMark(t, x.top)))
        .when(acts, (el) => el
          .child(iconButton(t, `pboard-${id}`, "square-kanban", S.boardOf(p.name), () => openBoard(p)))
          .child(iconButton(t, `pterm-${id}`, "square-terminal", S.projectTerminalHint, () => openInProject(p)))
          .child(iconButton(t, `padd-${id}`, "plus", S.projectTaskHint, () => this.openTaskForm({ project: p.id })))
          .child(iconButton(t, `pmore-${id}`, "ellipsis", S.projectMenu, () => openDialog("project-menu", { project: p.id }))))
        .when(!acts, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(x.count))))
        .child(svg(CHEVRON(open)).size(11).flex_none().text_color(t.dim)));
      if (!open) return;
      // The whole project's work first (tasks and tabs above its repositories), then each repository.
      const ids = x.loose.map((y) => y.t.id);
      for (const t2 of x.loose) { rows.push(this.taskRow(t, t2, { depth: 1, ids })); order.push(t2.t.id); }
      for (const u of x.untracked) rows.push(this.untrackedRow(t, u, 1));
      for (const r of x.repos.values()) repoRows(p, r);
    };
    for (const x of tree.projects) projectHeader(x);
    if (tree.orphan.count || tree.orphan.repos.size) projectHeader(tree.orphan);
    // Paused projects: folded at the end until opened (out of the way is the point, as Later).
    if (tree.paused.length) {
      const key = "paused:open";
      const open = this.folded.has(key);
      rows.push(sectionHeader(t, "sec-paused", S.pausedProjects, tree.paused.length, t.dim, open, (cx) => this.fold(key, cx)));
      if (open) for (const x of tree.paused) projectHeader(x);
    }
    this.order = order;
    if (!rows.length) rows.push(div().px(12).pt(12).text_size(12).text_color(t.dim).child(S.emptyProjects));
    return rows;
  },

  renderSidebar(cx) {
    const t = theme();
    const w = this.world;
    const view = this.view();
    const stackFolded = Boolean(this.fixedView) && shared("taskr.stackFolded") === this.fixedView;
    // Asked to take the keys (tab in the other list).
    const lists = sharedCache("lists").info;
    if (this.fixedView && lists.focus === this.fixedView) { lists.focus = null; this.handle.focus(); }
    const rows = !this.store.loaded ? [div().px(12).text_color(t.dim).child(S.loading)]
      : view === "now" ? this.nowRows(t, w) : this.projectRows(t, w);
    // agent.next/prev follow the list.
    const seen = new Set();
    const addrs = [];
    for (const id of this.order) for (const e of w.taskById.get(id)?.agents ?? []) if (!seen.has(e.a.address)) { seen.add(e.a.address); addrs.push(e.a.address); }
    // agent.next/prev follow the first list on screen.
    if (this.isFirstList()) setAgentOrder(addrs);
    const tabBtn = (id, label) => div().id(`v-${id}`).px(9).h(24).gap(5).rounded(6).flex().items_center().text_size(12).cursor_pointer()
      .bg(view === id ? t.selected : t.chrome).text_color(view === id ? t.foreground : t.muted).font_medium()
      .hover((s) => s.bg(t.hover)).on_click(() => setShared("taskr.view", id)).child(icon(id === "now" ? "zap" : "folder-tree", 13)).child(label);
    return v_flex().id("taskr-sidebar").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      // Released anywhere but on a project: the drag is off.
      .on_mouse_up("left", (_e, cx) => { if (this.dragProject || this.dragTask || this.dragRepo) { this.dragProject = null; this.dragTask = null; this.dragRepo = null; this.dragOver = null; cx.notify(); } })
      .size_full().min_h(0).bg(t.chrome).text_size(12.8).text_color(t.foreground)
      .child(h_flex().px(10).h(40).flex_none().gap(4).items_center().border_b(1).border_color(t.border)
        .when(!this.fixedView, (el) => el.child(tabBtn("now", S.now)).child(tabBtn("projects", S.projects)))
        // Stacked: the chevron folds this list to its header (the other takes the room); a
        // double click on its name gives it the room.
        .when(Boolean(this.fixedView), (el) => el.child(h_flex().id("stack-fold").px(4).h(24).gap(6).rounded(6).items_center().text_size(12).font_medium()
          .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(stackFolded ? S.stackUnfold : S.stackFold)
          .on_click((e, cx) => { if ((e?.click_count ?? 1) >= 2) this.stackFocus(view); else this.stackFold(view, !stackFolded); cx.notify(); })
          .child(svg(CHEVRON(!stackFolded)).size(10).flex_none().text_color(t.dim))
          .child(icon(view === "now" ? "zap" : "folder-tree", 13)).child(view === "now" ? S.now : S.projects)))
        .child(div().flex_1())
        .when(view === "projects", (el) => el.child(iconButton(t, "flt-done", this.filters.done ? "eye" : "eye-off", this.filters.done ? S.hideDone : S.showDone, (_e, cx) => {
          this.filters.done = !this.filters.done; localStorage.setItem("filters", JSON.stringify(this.filters)); cx.notify();
        })).child(iconButton(t, "add-proj", "folder-plus", S.newProject, () => openDialog("project"))))
        // The board of every project from Now; in Projects each project's row has its own.
        .when(view === "now", (el) => el.child(iconButton(t, "board", "square-kanban", S.openBoard, () => this.openBoard())))
        .child(iconButton(t, "jump", "search", S.searchTasks, () => this.command("jump", null)))
        .child(iconButton(t, "add-task", "plus", S.newTask, () => this.openTaskForm({}))))
      .when(Boolean(this.store.error), (el) => el.child(div().px(12).py(6).text_size(11).text_color(t.blocked).child(this.store.error)))
      .when(!stackFolded, (el) => el.child(v_flex().id("taskr-list").flex_1().min_h(0).px(6).pb(10).overflow_y_scrollbar().children(rows)));
  },
};

// Key commands bound to this mod in keys.json ("taskr.jump"…), and "focus" from pane.go.
async function nextCommandSafe() {
  try { return await nextCommand(); } catch { return null; }
}
