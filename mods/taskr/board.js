// The board: a tab with one column per status. Drag a card to another column
// to change its status, onto another card to put it there; click it to open it;
// right-click for its menu.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, setShared, run, shared, props, home } from "herdr";
import { S } from "./strings.js";
import { setStatus, kept, moveTask } from "./lib/store.js";
import { RANK, byRank, issueLabel, isLater, laterLabel } from "./lib/util.js";
import { statusIcon, taskMark, dueChip, chip, iconButton, icon, agentFor } from "./lib/ui.js";
import { taskWhere, pausedProjects } from "./lib/world.js";
import { openBoard } from "./lib/actions.js";
import { openDialog } from "./lib/open.js";

const COLUMNS = ["inbox", "next", "doing", "waiting", "review", "done"];
const DONE_DAYS = 7;

export const Board = {
  initBoard(cx) {
    // Every board is a tab: the board of every project, or one project's ({ project }).
    // Its pills go from one board to another; the tab's name says which one this is.
    this.fixedProject = props()?.project ?? null;
    this.boardProject = this.fixedProject;
    this.pressed = null; // task id held down
    this.over = null; // column under the pointer while dragging
    this.overCard = null; // card under it
    cx.timer.every(30000, (cx) => cx.notify());
  },

  boardColumns(w) {
    const now = Date.now();
    const cols = Object.fromEntries(COLUMNS.map((c) => [c, []]));
    const paused = pausedProjects(this.store.data);
    for (const x of w.tasks) {
      if (x.t.archived || x.t.status === "dropped") continue;
      if (this.boardProject && x.project !== this.boardProject) continue;
      // Every project's board leaves paused ones out, but for an agent that needs you or works.
      if (!this.boardProject && paused.has(x.project) && !["blocked", "working"].includes(x.top)) continue;
      if (x.t.status === "done" && now - (x.t.done_at ?? 0) > DONE_DAYS * 86400000 && !x.live.length) continue;
      cols[x.t.status]?.push(x);
    }
    for (const c of COLUMNS) {
      cols[c].sort(c === "done"
        ? (a, b) => (b.t.done_at ?? 0) - (a.t.done_at ?? 0)
        : (a, b) => byRank(a.t, b.t));
    }
    return cols;
  },

  drop(cx, status) {
    const from = this.pressed;
    const task = from && this.store.task(from);
    this.pressed = null;
    this.over = null;
    this.overCard = null;
    if (!task) return cx.notify();
    if (task.status !== status) {
      cx.spawn(async () => this.store.update((d) => { const t = d.tasks.find((y) => y.id === from); if (!t) return false; kept(t); setStatus(t, status); }));
    } else {
      setShared("taskr.selected", from);
      run("layout.show", { id: "taskr-detail" });
    }
    cx.notify();
  },

  // Released on a card: the dragged one takes its place (in its column, with its status).
  dropOnCard(cx, x, ids) {
    const from = this.pressed;
    if (!from || from === x.t.id || String(from).startsWith("tab:")) return this.drop(cx, x.t.status);
    cx.stop_propagation();
    this.pressed = null;
    this.over = null;
    this.overCard = null;
    const target = x.t.id, status = x.t.status;
    cx.spawn(async () => this.store.update((d) => {
      const t = d.tasks.find((y) => y.id === from);
      if (!t) return false;
      kept(t);
      setStatus(t, status);
      moveTask(d, from, ids, target);
    }));
    cx.notify();
  },

  card(t, x, ids = []) {
    const task = x.t;
    const e = [...x.agents].sort((a, b) => (RANK[b.top] ?? 0) - (RANK[a.top] ?? 0))[0];
    const blocked = e?.top === "blocked";
    const selected = shared("taskr.selected") === task.id;
    const lifted = this.pressed === task.id && ((this.over && this.over !== task.status) || (this.overCard && this.overCard !== task.id));
    // Another card held over this one: a line shows where it lands (below when it comes from above).
    const target = Boolean(this.pressed) && !String(this.pressed).startsWith("tab:") && this.overCard === task.id && this.pressed !== task.id;
    const below = target && ids.indexOf(this.pressed) >= 0 && ids.indexOf(this.pressed) < ids.indexOf(task.id);
    // As a row in Now: where it is (a project's board leaves its name out), how long its agent
    // has been as it is. Model, effort and context are in the terminal's header and the detail.
    const meta = [taskWhere(this.store.data, x, home(), { project: !this.boardProject }), e ? agentFor(e.top, this.sinceOf(e)) : null].filter(Boolean).join(" · ");
    const due = task.status === "done" ? null : dueChip(t, task.due);
    return v_flex().id(`card-${task.id}`).p(9).gap(6).flex_none().rounded(9).bg(t.background)
      .border_1().border_color(blocked ? t.blocked : selected ? t.accent : t.border)
      .when(lifted, (el) => el.opacity(0.45))
      .when(!lifted && isLater(task), (el) => el.opacity(0.6))
      .when(target && !below, (el) => el.border_t(3).border_color(t.accent))
      .when(target && below, (el) => el.border_b(3).border_color(t.accent))
      .cursor_pointer().hover((s) => s.border_color(t.input))
      .on_mouse_down("left", (_e, cx) => { this.pressed = task.id; this.over = task.status; this.overCard = null; cx.notify(); })
      .on_mouse_move((_e, cx) => {
        if (!this.pressed) return;
        cx.stop_propagation();
        if (this.overCard !== task.id || this.over !== task.status) { this.overCard = task.id; this.over = task.status; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => this.dropOnCard(cx, x, ids))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        setShared("taskr.selected", task.id);
        openDialog("menu", { task: task.id });
      })
      .child(h_flex().gap(7).items_start()
        .child(div().pt(1).child(taskMark(t, task, e?.top)))
        .child(div().flex_1().min_w(0).text_size(12.8).text_color(task.status === "done" ? t.dim : t.foreground).child(task.title)))
      .when(Boolean(task.next_step) && task.status !== "done", (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(`→ ${task.next_step}`)))
      .when(blocked && Boolean(e?.report?.msg), (el) => el.child(div().text_size(11).text_color(t.blocked).child(e.report.msg.replace(/^answer:\s*/i, ""))))
      .when(!blocked && Boolean(meta), (el) => el.child(div().truncate().text_size(11).text_color(t.muted).child(meta)))
      .when(Boolean(due) || isLater(task) || Boolean(task.issue) || Boolean(task.branch), (row) => row.child(h_flex().gap(5).items_center().flex_wrap()
        .when(Boolean(due), (el) => el.child(due))
        .when(isLater(task), (el) => el.child(chip(t, S.laterUntil(laterLabel(task.snooze)), t.dim)))
        .when(Boolean(task.issue), (el) => el.child(chip(t, issueLabel(task.issue), t.dim)))
        .when(Boolean(task.branch), (el) => el.child(h_flex().gap(3).items_center().text_size(10).text_color(t.dim).child(icon("git-branch", 11)).child(task.branch.replace(/^task\//, ""))))));
  },

  column(t, status, list, wip) {
    const ids = list.map((x) => x.t.id);
    const over = this.pressed && this.over === status;
    const full = status === "doing" && list.length > wip;
    return v_flex().id(`col-${status}`).flex_1().min_w(170).max_w(320).h_full().min_h(0).rounded(10)
      .bg(over ? t.selected : t.chrome).border_1().border_color(over ? t.accent : t.border)
      .on_mouse_move((_e, cx) => { if (this.pressed && (this.over !== status || this.overCard)) { this.over = status; this.overCard = null; cx.notify(); } })
      .on_mouse_up("left", (_e, cx) => this.drop(cx, status))
      .child(h_flex().px(12).h(38).flex_none().gap(7).items_center()
        .child(statusIcon(t, status, 14))
        .child(div().font_semibold().text_size(12.5).child(S.statusLabel[status]))
        .child(div().text_size(11.5).text_color(full ? t.ansi3 : t.dim).child(status === "doing" ? `${list.length}/${wip}` : String(list.length)))
        .child(div().flex_1())
        .when(["inbox", "next"].includes(status), (el) => el.child(iconButton(t, `col-add-${status}`, "plus", S.newTask,
          () => openDialog("task", { status, project: this.boardProject })))))
      .child(v_flex().id(`col-list-${status}`).flex_1().min_h(0).px(8).pb(8).gap(7).overflow_y_scrollbar()
        .children(list.map((x) => this.card(t, x, ids)))
        .when(!list.length, (el) => el.child(div().h(56).rounded(8).border_1().border_color(over ? t.accent : t.border).flex().items_center().justify_center()
          .text_size(11).text_color(t.dim).child(S.emptyColumn))));
  },

  renderBoard(cx) {
    const t = theme();
    const own = this.fixedProject ? this.store.project(this.fixedProject) : null;
    // The project went (deleted): its board shows every project.
    this.boardProject = own ? own.id : this.fixedProject && !this.store.loaded ? this.fixedProject : null;
    const cols = this.boardColumns(this.world);
    const wip = this.store.data.settings.wip;
    // A pill per board: this one lit, the others go to their tab (made when not open).
    const pill = (id, label) => {
      const here = this.boardProject === id;
      return h_flex().id(`bp-${id ?? "all"}`).px(9).h(24).gap(6).rounded(6).items_center().text_size(12)
        .bg(here ? t.selected : t.canvas).text_color(here ? t.foreground : t.muted)
        .when(!here, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(id ? S.boardOf(label) : S.boardAll)
          .on_click(() => openBoard(id ? this.store.project(id) : null)))
        .when(Boolean(id), (el) => el.child(icon("layers", 12))).child(label);
    };
    return v_flex().id("taskr-board").size_full().min_h(0).bg(t.canvas).text_color(t.foreground)
      // Released outside any column: the drag is off.
      .on_mouse_up("left", (_e, cx) => { if (this.pressed) { this.pressed = null; this.over = null; this.overCard = null; cx.notify(); } })
      .child(h_flex().px(14).h(44).flex_none().gap(6).items_center()
        .child(div().pr(8).text_size(14).font_semibold().child(S.board))
        .child(pill(null, S.allProjects))
        // Paused projects have no pill, but for the one this board is.
        .children(this.store.data.projects.filter((p) => !p.paused || p.id === this.boardProject).map((p) => pill(p.id, p.name)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(S.boardHint)))
      .child(h_flex().id("board-cols").flex_1().min_h(0).px(14).pb(14).gap(10).items_start().overflow_x_scrollbar()
        .children(COLUMNS.map((c) => this.column(t, c, cols[c], wip))));
  },
};
