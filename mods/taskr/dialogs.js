// taskr's dialogs and popups: each is this mod opened as an overlay with
// props { dialog, ... } (see lib/open.js). They write tasks.json themselves;
// every other copy sees the change through its file watch.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, home, spaces, panes, shared, setShared, run, notify, knownAgents, terminals, layout, pickFolder } from "herdr";
import { untrackedName } from "./lib/world.js";
import { S } from "./strings.js";
import { newTask, newProject, setStatus, setPaused, kept, toTop, park, unpark, PARK_AFTER, PAUSE_AFTER } from "./lib/store.js";
import { CHOICES, stageOf, tilde, untilde, base, byRank, OPEN, parseDue, dueLabel, issueLabel, isLater, laterLabel, parseLater } from "./lib/util.js";
import { linearKey, linearIssues } from "./lib/linear.js";
import { place, repoState } from "./lib/git.js";
import { STATUS_ICON, button, chip, statusIcon, statusColor, icon } from "./lib/ui.js";
import { openDialog } from "./lib/open.js";
import * as act from "./lib/actions.js";

// The quick choices of Later, by the word each one is (as typed in its box); "agent": until its
// agent works again.
const LATER_QUICK = [["tomorrow", "laterTomorrow"], ["mon", "laterNextWeek"], ["someday", "laterSomeday"], ["agent", "laterAgent"]];
// Waiting on someone comes back to follow up in three days unless another day is typed.
const WAITING_DAY = "+3d";
// Quick picks for the model: Claude Code's aliases for its latest models (any name can be typed).
const MODELS = { claude: ["fable", "opus", "sonnet", "haiku"] };

const close = () => closeOverlay(props().overlay);

function field(t, label, el, hint) {
  return v_flex().gap(5)
    .child(h_flex().gap(8).items_baseline().child(div().text_size(11).text_color(t.dim).child(label))
      .when(Boolean(hint), (h) => h.child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(hint?.color ?? t.dim).child(hint?.text ?? ""))))
    .child(el);
}

function input(t, state, focused, bad = false) {
  return Input.new(state).h(32).px(9).rounded(8).border_1().border_color(bad ? t.blocked : focused ? t.accent : t.input)
    .bg(t.background).text_size(12.8).text_color(t.foreground);
}

// options: [value, label, color?, Lucide icon?]
function segmented(t, id, options, value, onPick) {
  return h_flex().gap(4).flex_wrap().children(options.map(([v, label, color, iconName]) =>
    div().id(`${id}-${v}`).h(24).px(8).gap(5).rounded(6).flex().items_center().text_size(11.5).cursor_pointer()
      .border_1().border_color(v === value ? (color ?? t.accent) : t.input)
      .bg(v === value ? (color ?? t.accent) + "26" : t.background)
      .text_color(v === value ? (color ?? t.foreground) : t.muted)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { onPick(v); cx.notify(); })
      .when(Boolean(iconName), (el) => el.child(icon(iconName, 12)))
      .child(label)));
}

// Folders tasks can live in: the projects' repos and the repos open now (looked at side by side).
async function repoChoices(store) {
  const h = home();
  const out = new Map();
  for (const p of store.data.projects) for (const r of p.folders ?? []) out.set(tilde(untilde(r, h), h), p.id);
  const ps = panes();
  const folders = [...new Set(spaces().filter((s) => !s.machine).map((s) => place(s, ps)).filter(Boolean))];
  const states = await Promise.all(folders.map((f) => repoState(f, null).catch(() => null)));
  // Only folders in git: a home folder or a download folder isn't a repository.
  folders.forEach((f, i) => {
    if (!states[i]) return;
    const k = tilde(states[i].main, h);
    if (!out.has(k)) out.set(k, null);
  });
  return [...out.keys()];
}

export const Dialogs = {
  // Runs `work`, then closes. Never the other way round: closing drops this copy of
  // the mod, and with it whatever it had spawned and not finished.
  closeAfter(cx, work) {
    if (this.saving) return;
    this.saving = true;
    cx.spawn(async () => { try { await work(); } finally { close(); } });
  },

  initDialog(cx) {
    const p = props() ?? {};
    this.handle = cx.focus_handle();
    const init = {
      task: () => this.initTaskForm(cx, p),
      project: () => this.initProjectForm(cx, p),
      jump: () => this.initJump(cx),
      issues: () => this.initIssues(cx, p),
      repo: () => this.initRepoMenu(cx),
      "project-menu": () => this.initRepoMenu(cx),
      later: () => this.initLater(cx, p),
      start: () => this.initStart(cx, p),
      settings: () => this.initSettings(cx),
    }[p.dialog];
    if (init) init(); else this.handle.focus();
  },

  renderDialog(cx) {
    const t = theme();
    const p = props() ?? {};
    const body = {
      task: () => this.taskForm(t, cx),
      project: () => this.projectForm(t, cx),
      menu: () => this.menu(t, p),
      repo: () => this.repoMenu(t, p),
      "project-menu": () => this.projectMenu(t, p),
      "repo-project": () => this.repoProject(t, p),
      later: () => this.laterForm(t, cx),
      start: () => this.startForm(t, cx),
      jump: () => this.jump(t, cx),
      issues: () => this.issuesList(t, cx),
      archive: () => this.archiveConfirm(t, p),
      loose: () => this.looseMenu(t, p, cx),
      "confirm-delete": () => this.deleteConfirm(t, p),
      "confirm-close": () => this.closeConfirm(t, p, cx),
      settings: () => this.settingsForm(t, cx),
    }[p.dialog]?.() ?? div();
    return v_flex().id("taskr-dialog").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(12.8).child(body);
  },

  title(t, text) {
    return h_flex().items_center().gap(8).pb(12).child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(text))
      .child(div().text_size(11).text_color(t.dim).child("Esc"));
  },

  // ── Task form ──────────────────────────────────────────────────────────
  initTaskForm(cx, p) {
    const existing = p.task ? this.store.task(p.task) : null;
    this.form = existing ? { ...existing, status: stageOf(existing) } : {
      title: "", project: p.project ?? null, folder: p.repo ?? null, status: p.status ?? "next",
      due: null, estimate: null, next_step: "", notes: "",
    };
    this.isNew = !existing;
    // Where it goes is known when it's made from a project or a folder (or edited: a task moves
    // to another project by dragging it in Projects): the project picker is only for one from Now.
    this.pickProject = !existing && !p.project && !p.repo;
    this.saving = false;
    const mk = (key, placeholder) => {
      const st = InputState.new({ value: this.form[key] ?? "", placeholder });
      st.on("change", (_e, cx) => { this.form[key] = st.value(); cx.notify(); });
      st.on("submit", (_e, cx) => this.saveTask(cx));
      st.on("focus", (_e, cx) => { this.focusedField = key; cx.notify(); });
      return st;
    };
    this.inputs = { title: mk("title", S.titlePlaceholder), next_step: mk("next_step", S.nextStepPlaceholder), due: mk("due", S.duePlaceholder), estimate: mk("estimate", S.estimatePlaceholder) };
    this.notes = TextareaState.new({ value: this.form.notes ?? "", rows: 7 });
    this.notes.on("change", () => { this.form.notes = this.notes.value(); });
    this.inputs.title.focus();
    this.focusedField = "title";
    this.repoList = [];
    cx.spawn(async (cx) => {
      await this.store.load();
      // A task opened before the file was read: fill the form now.
      if (p.task && this.isNew && this.store.task(p.task)) { this.initTaskForm(cx, p); return; }
      this.repoList = await repoChoices(this.store);
      cx.notify();
    });
  },

  saveTask(cx) {
    const f = this.form;
    const due = parseDue(f.due);
    if (!String(f.title ?? "").trim() || due === undefined || this.saving) return;
    this.saving = true;
    const id = props().task;
    cx.spawn(async () => {
      let ok = false;
      try {
        ok = await this.store.update((d) => {
          const fields = { title: f.title.trim(), project: f.project, folder: f.folder, due, estimate: (f.estimate ?? "").trim() || null, next_step: (f.next_step ?? "").trim(), notes: f.notes ?? "" };
          if (!id) {
            const t = newTask(d, { ...fields, status: f.status === "dropped" ? "done" : f.status, ...(f.status === "dropped" ? { outcome: "dropped", done_at: Date.now() } : {}) });
            setShared("taskr.selected", t.id);
            return;
          }
          const t = d.tasks.find((x) => x.id === id);
          if (!t) return false;
          Object.assign(kept(t), fields, { updated: Date.now() });
          setStatus(t, f.status);
        });
      } finally {
        this.saving = false;
      }
      if (ok) close();
      else if (this.store.error) notify({ title: S.appName, body: this.store.error, level: "error" });
    });
  },

  taskForm(t, cx) {
    const f = this.form;
    const h = home();
    const projects = this.store.data.projects;
    const inProject = f.project ? (projects.find((p) => p.id === f.project)?.folders ?? []).map((r) => tilde(untilde(r, h), h)) : [];
    const repos = [...new Set([...inProject, ...(f.project ? [] : this.repoList), ...(f.folder ? [f.folder] : [])])];
    const due = parseDue(f.due);
    const dueHint = due === undefined ? { text: S.dueBad, color: t.blocked } : due ? { text: `${dueLabel(due)} · ${due}` } : null;
    const canSave = Boolean(String(f.title ?? "").trim()) && due !== undefined;
    const where = projects.find((p) => p.id === f.project)?.name ?? (f.folder ? base(f.folder) : null);
    // A new task starts in Inbox or Next; the rest of its stages come later (an agent, review, done).
    const stages = this.isNew ? ["inbox", "next"] : CHOICES;
    return this.withFooter(t, v_flex().gap(12)
      .child(this.title(t, this.isNew ? (where && !this.pickProject ? S.newTaskIn(where) : S.newTaskTitle) : S.editTask))
      .child(field(t, S.title, input(t, this.inputs.title, this.focusedField === "title")))
      .when(this.pickProject, (el) => el.child(field(t, S.project, segmented(t, "proj", [[null, S.none], ...projects.filter((p) => !p.paused || p.id === f.project).map((p) => [p.id, p.name])], f.project, (v) => { f.project = v; f.folder = null; }))))
      .when(repos.length > 0, (el) => el.child(field(t, S.repo, segmented(t, "repo", [[null, f.project ? S.wholeProject : S.none], ...repos.map((r) => [r, base(r)])], f.folder, (v) => { f.folder = v; }))))
      .child(field(t, S.status, segmented(t, "st", stages.map((s) => [s, S.statusLabel[s], statusColor(t, s), STATUS_ICON[s]]), f.status, (v) => { f.status = v; })))
      .child(h_flex().gap(12)
        .child(div().flex_1().min_w(0).child(field(t, S.due, input(t, this.inputs.due, this.focusedField === "due", due === undefined), dueHint)))
        .child(div().w(110).child(field(t, S.estimate, input(t, this.inputs.estimate, this.focusedField === "estimate")))))
      .child(field(t, S.nextStep, input(t, this.inputs.next_step, this.focusedField === "next_step")))
      .child(field(t, S.notes, Textarea.new(this.notes).h(140).p(8).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5), { text: S.notesHint })),
    [button(t, "cancel", S.cancel, close), button(t, "save", S.save, (_e, cx) => this.saveTask(cx), { primary: true, disabled: !canSave || this.saving })]);
  },

  // A form that scrolls, with its buttons always in view.
  withFooter(t, body, buttons, left = []) {
    return v_flex().size_full().min_h(0)
      .child(v_flex().id("dlg-body").flex_1().min_h(0).px(18).pt(18).pb(8).overflow_y_scrollbar().child(body))
      .child(h_flex().flex_none().px(18).py(12).gap(8).border_t(1).border_color(t.border).children(left).child(div().flex_1()).children(buttons));
  },

  // ── Project form: its name, active or paused, and its folders ────
  // Only the project's own folders show; *Add folder…* takes a repository or a plain folder at once,
  // or lists the repositories inside a folder (~/dev) to tick several, with a filter.
  initProjectForm(cx, p) {
    const existing = p.project ? this.store.project(p.project) : null;
    this.form = existing ? { name: existing.name, paused: existing.paused === true, repos: [...(existing.folders ?? [])] }
      : { name: "", paused: false, repos: p.repo ? [p.repo] : [] };
    this.isNew = !existing;
    // Where it goes is known when it's made from a project or a folder (or edited: a task moves
    // to another project by dragging it in Projects): the project picker is only for one from Now.
    this.pickProject = !existing && !p.project && !p.repo;
    this.saving = false;
    this.found = null; // { folder, repos: [~paths] | null while looking }
    this.foundFilter = "";
    this.nameInput = InputState.new({ value: this.form.name, placeholder: S.namePlaceholder });
    this.nameInput.on("change", (_e, cx) => { this.form.name = this.nameInput.value(); cx.notify(); });
    this.nameInput.on("submit", (_e, cx) => this.saveProject(cx));
    this.nameInput.focus();
    this.filterInput = InputState.new({ placeholder: S.filterRepos });
    this.filterInput.on("change", (_e, cx) => { this.foundFilter = this.filterInput.value(); cx.notify(); });
    cx.spawn(async (cx) => {
      await this.store.load();
      if (p.project && this.isNew && this.store.project(p.project)) { this.initProjectForm(cx, p); return; }
      cx.notify();
    });
  },

  saveProject(cx) {
    const f = this.form;
    if (!String(f.name ?? "").trim() || this.saving) return;
    this.saving = true;
    const id = props().project;
    cx.spawn(async () => {
      let ok = false;
      try {
        ok = await this.store.update((d) => {
          // A repo belongs to one project.
          for (const p of d.projects) if (p.id !== id) p.folders = (p.folders ?? []).filter((r) => !f.repos.includes(r));
          const fields = { name: f.name.trim(), folders: f.repos };
          if (!id) { setPaused(newProject(d, fields), f.paused); return; }
          const p = d.projects.find((x) => x.id === id);
          if (!p) return false;
          Object.assign(p, fields);
          // Its state as picked; untouched, a pause taskr made stays one it can lift.
          if (p.paused !== f.paused) setPaused(p, f.paused);
        });
      } finally {
        this.saving = false;
      }
      if (ok) close();
    });
  },

  // A folder from the system's picker: a repository goes in at once (its main checkout, as a
  // worktree belongs to its repo), and so does a folder with none inside; one holding
  // repositories (~/dev) lists them to tick, or goes in itself.
  addFolder(cx) {
    cx.spawn(async (cx) => {
      let folder = null;
      try { folder = await pickFolder({ prompt: S.addFolderPrompt }); } catch {}
      if (!folder) return;
      const h = home();
      const st = await repoState(folder, null).catch(() => null);
      if (st) {
        const key = tilde(st.main, h);
        if (!this.form.repos.includes(key)) this.form.repos = [...this.form.repos, key];
        this.found = null;
        cx.notify();
        return;
      }
      this.found = { folder: tilde(folder, h), repos: null };
      this.foundFilter = "";
      this.filterInput.set_value("");
      cx.notify();
      const repos = await act.reposIn(folder);
      if (this.found?.folder !== tilde(folder, h)) return;
      // A folder with no repositories inside (notes, a book): it goes in itself, at once.
      if (!repos.length) {
        const key = tilde(folder, h);
        if (!this.form.repos.includes(key)) this.form.repos = [...this.form.repos, key];
        this.found = null;
      } else this.found.repos = repos.map((r) => tilde(r, h));
      cx.notify();
    });
  },

  projectForm(t, cx) {
    const f = this.form;
    const owner = new Map();
    for (const p of this.store.data.projects) for (const r of p.folders ?? []) owner.set(r, p);
    const toggle = (r) => (_e, cx) => { f.repos = f.repos.includes(r) ? f.repos.filter((x) => x !== r) : [...f.repos, r]; cx.notify(); };
    const elsewhere = (r) => { const o = owner.get(r); return o && o.id !== props().project ? o : null; };
    // The project's folders, each with ✕.
    const mine = f.repos.map((r) => h_flex().id(`r-${r}`).h(26).px(6).gap(8).rounded(6).items_center().hover((s) => s.bg(t.hover))
      .child(icon("folder", 13, t.muted)).child(div().flex_1().min_w(0).truncate().child(r))
      .child(div().id(`rx-${r}`).p(3).rounded(4).cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(S.removeRepo).on_click(toggle(r)).child(icon("x", 12))));
    // What a picked folder holds.
    const fd = this.found;
    const q = this.foundFilter.trim().toLowerCase();
    const shown = (fd?.repos ?? []).filter((r) => !q || r.toLowerCase().includes(q));
    const notYet = shown.filter((r) => !f.repos.includes(r));
    const found = !fd ? null : v_flex().gap(6).pt(4)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(fd.repos == null ? S.lookingIn(fd.folder) : S.reposIn(fd.repos.length, fd.folder)))
        .when(fd.repos != null && !f.repos.includes(fd.folder), (el) => el.child(button(t, "found-self", S.addThisFolder(base(fd.folder)), (_e, cx) => { f.repos = [...f.repos, fd.folder]; this.found = null; cx.notify(); }, { small: true })))
        .when(notYet.length > 1, (el) => el.child(button(t, "found-all", S.addAll(notYet.length), (_e, cx) => { f.repos = [...f.repos, ...notYet]; cx.notify(); }, { small: true })))
        .child(div().id("found-x").p(3).rounded(4).cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(S.closeList).on_click((_e, cx) => { this.found = null; cx.notify(); }).child(icon("x", 12))))
      .when((fd.repos?.length ?? 0) > 8, (el) => el.child(input(t, this.filterInput, false)))
      .when(fd.repos != null && !fd.repos.length, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(S.noReposIn)))
      .children(shown.map((r) => {
        const on = f.repos.includes(r);
        const other = elsewhere(r);
        return h_flex().id(`f-${r}`).h(26).px(6).gap(8).rounded(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(toggle(r))
          .child(icon(on ? "circle-check" : "circle", 14, on ? t.accent : t.dim))
          .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(base(r)))
          .when(Boolean(other), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(S.inProject(other.name))));
      }));
    return this.withFooter(t, v_flex().gap(12)
      .child(this.title(t, this.isNew ? S.newProject : S.editProject))
      .child(field(t, S.name, Input.new(this.nameInput).h(32).px(9).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(12.8)))
      .child(field(t, S.projectState, segmented(t, "pst", [["active", S.projectActive, null, "circle-play"], ["paused", S.projectPaused, null, "circle-pause"]],
        f.paused ? "paused" : "active", (v) => { f.paused = v === "paused"; }), { text: f.paused ? S.pausedHint : "" }))
      .child(field(t, `${S.repos}${f.repos.length ? ` · ${f.repos.length}` : ""}`, v_flex().gap(2)
        .when(!f.repos.length, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(S.reposHint)))
        .children(mine)
        .child(h_flex().pt(4).child(button(t, "add-folder", `${S.addFolder}…`, (_e, cx) => this.addFolder(cx), { small: true, iconName: "folder-plus" })))
        .when(Boolean(found), (el) => el.child(found)))),
    [button(t, "cancel", S.cancel, close), button(t, "save", S.save, (_e, cx) => this.saveProject(cx), { primary: true, disabled: !String(f.name ?? "").trim() })],
    this.isNew ? [] : [button(t, "del", S.remove, (_e, cx) => {
      const id = props().project;
      cx.spawn(async () => { await this.store.update((d) => { d.projects = d.projects.filter((p) => p.id !== id); for (const x of d.tasks) if (x.project === id) x.project = null; }); close(); });
    }, { danger: true, iconName: "trash-2" })]);
  },

  // ── Context menu of a task ─────────────────────────────────────────────
  menu(t, p) {
    const task = this.store.task(p.task);
    if (!task) return div().p(10).text_color(t.dim).child(S.loading);
    const upd = (fn) => (_e, cx) => this.closeAfter(cx, () => this.store.update((d) => { const x = d.tasks.find((y) => y.id === task.id); if (!x) return false; fn(kept(x)); x.updated = Date.now(); }));
    const item = (id, iconName, label, onClick, hint, color) => h_flex().id(id).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer()
      .text_color(color ?? t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick)
      .child(icon(iconName, 13, color ?? t.muted)).child(div().flex_1().child(label))
      .when(Boolean(hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(hint)));
    const sep = () => div().h(1).my(4).bg(t.border);
    return v_flex().p(5).text_size(12.5)
      .child(item("details", "panel-right", S.showDetails, () => { close(); run("layout.show", { id: "taskr-detail" }); }, "i"))
      .child(item("edit", "pencil", `${S.editTask}…`, () => { close(); openDialog("task", { task: task.id }); }, "e"))
      .child(item("launch", "play", S.start, (_e, cx) => this.closeAfter(cx, () => this.startAgent(task, false)), "l"))
      .child(item("launch-with", "settings", `${S.startWith}…`, () => { close(); openDialog("start", { task: task.id }); }))
      .when(Boolean(task.sessions?.length), (el) => el.child(item("resume", "rotate-ccw", S.resume, (_e, cx) => this.closeAfter(cx, () => this.resumeAgent(task)), "r")))
      .when(Boolean(task.folder) && !this.repos.notGit(untilde(task.folder, home())), (el) => el.child(item("launch-wt", "git-fork", S.startWorktree, (_e, cx) => this.closeAfter(cx, () => this.startAgent(task, true)), "w")))
      .child(sep())
      .child(h_flex().px(8).py(4).gap(4).flex_wrap().children(CHOICES.map((s) => div().id(`s-${s}`).px(6).h(22).rounded(5).flex().items_center().cursor_pointer()
        .bg(stageOf(task) === s ? statusColor(t, s) + "26" : t.popover).text_color(statusColor(t, s)).hover((x) => x.bg(t.hover))
        .tooltip(S.statusLabel[s]).on_click(upd((x) => setStatus(x, s))).child(statusIcon(t, s, 13)))))
      .child(item("top", "arrow-up-to-line", S.moveTop, (_e, cx) => this.closeAfter(cx, () => this.store.update((d) => { const x = d.tasks.find((y) => y.id === task.id); if (!x) return false; kept(x); return toTop(d, task.id); })), "t"))
      .child(sep())
      .when(task.status === "doing", (el) => el.child(item("review", "eye", S.readyForReview, upd((x) => setStatus(x, "review")))))
      // Park it: until a day (it comes back by itself), someday or its agent works; or waiting on
      // someone. Plain items: a label beside the choices read as a disabled one.
      .child(item("later", "moon", `${S.later}…`, () => { close(); openDialog("later", { task: task.id }); }, "z"))
      .child(item("waiting", "circle-pause", S.waitingItem, () => { close(); openDialog("later", { task: task.id, waiting: true }); }))
      .when(isLater(task), (el) => el.child(item("bring-back", "rotate-ccw", `${S.bringBack} (${S.laterUntil(laterLabel(task.snooze), task.waiting_on)})`, upd((x) => { unpark(x); }))))
      .child(sep())
      // Its agent (its tabs) into another task: one started on its own, put where it belongs.
      .when((task.tabs ?? []).length > 0, (el) => el.child(item("merge", "list-plus", `${S.moveToTask}…`, () => { close(); openDialog("jump", { merge: task.id }); })))
      .child(item("archive", "circle-check", `${S.archive}…`, () => { close(); openDialog("archive", { task: task.id }); }))
      .child(item("delete", "trash-2", `${S.remove}…`, () => { close(); openDialog("confirm-delete", { task: task.id }); }, null, t.blocked));
  },

  // ── Menu of a folder: a task, a terminal, issues, its project ──
  initRepoMenu() {
    this.handle.focus();
  },

  repoMenu(t, p) {
    if (!p.repo) return div();
    const h = home();
    const item = (id, iconName, label, onClick) => h_flex().id(id).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(onClick).child(icon(iconName, 13, t.muted)).child(div().flex_1().truncate().child(label));
    const sep = () => div().h(1).my(4).bg(t.border);
    const owner = this.store.data.projects.find((x) => (x.folders ?? []).some((r) => tilde(untilde(r, h), h) === p.repo));
    // A task, a terminal (an agent starts from a task: Start with… picks which), then issues, then
    // where it is.
    return v_flex().p(5).text_size(12.5)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(p.repo))
      .child(item("r-task", "plus", `${S.newTaskTitle}…`, () => { close(); openDialog("task", { repo: p.repo, project: p.project ?? owner?.id ?? null }); }))
      .child(item("r-term", "square-terminal", S.newTerminal, () => { close(); act.openHere(p.repo); }))
      .child(sep())
      .child(item("r-issues", "circle-dot", `${S.importIssues}…`, () => { close(); openDialog("issues", { repo: p.repo, project: owner?.id ?? null }); }))
      .child(item("r-linear", "list-plus", `${S.importLinear}…`, () => { close(); openDialog("issues", { source: "linear", repo: p.repo, project: owner?.id ?? null }); }))
      .child(sep())
      // Plain items: a row of small project names read as disabled, and many didn't fit.
      .child(item("r-move", "arrow-right", `${S.moveToProject}…`, () => { close(); openDialog("repo-project", { repo: p.repo }); }))
      .when(Boolean(owner), (el) => el.child(item("r-remove", "folder-minus", S.removeFromProject(owner.name),
        (_e, cx) => this.closeAfter(cx, () => this.store.update((d) => act.removeRepo(d, p.repo, h))))))
      .when(this.spacesOf([p.repo]).length > 0, (el) => el.child(item("r-close", "circle-x", `${S.closeRepo}…`, () => { close(); openDialog("confirm-close", { repos: [p.repo], name: base(p.repo) }); })));
  },

  // ── Which project a repository is in: a list, as long as it needs ──────
  repoProject(t, p) {
    const h = home();
    const owner = this.store.data.projects.find((x) => (x.folders ?? []).some((r) => tilde(untilde(r, h), h) === p.repo));
    const pick = (pid) => (_e, cx) => this.closeAfter(cx, () => this.store.update((d) => act.moveRepo(d, p.repo, pid, h)));
    const row = (id, label, on, dim, onClick) => h_flex().id(id).h(28).px(8).gap(8).rounded(6).flex_none().items_center().cursor_pointer()
      .bg(on ? t.selected : t.popover).hover((s) => s.bg(t.hover)).on_click(onClick)
      .child(icon(id === "rp-none" ? "circle-x" : "layers", 13, t.muted)).child(div().flex_1().min_w(0).truncate().text_color(dim ? t.dim : t.foreground).child(label))
      .when(on, (el) => el.child(icon("circle-check", 13, t.accent)));
    const projects = [...this.store.data.projects].sort((a, b) => (a.paused === true) - (b.paused === true));
    return v_flex().size_full().min_h(0).p(5).text_size(12.5)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(S.moveRepoTitle(base(p.repo))))
      .child(v_flex().id("rp-list").flex_1().min_h(0).overflow_y_scrollbar()
        .children(projects.map((x) => row(`rp-${x.id}`, x.paused ? `${x.name} · ${S.projectPaused.toLowerCase()}` : x.name, owner?.id === x.id, x.paused, pick(x.id))))
        .child(row("rp-none", S.noProjectShort, !owner, true, pick(null))));
  },

  // ── Menu of a project: a terminal or an agent across its repos, a task, the form ──
  projectMenu(t, p) {
    const proj = this.store.project(p.project);
    if (!proj) return div().p(10).text_color(t.dim).child(S.loading);
    const item = (id, iconName, label, onClick, hint = null) => h_flex().id(id).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(onClick).child(icon(iconName, 13, t.muted)).child(div().flex_1().min_w(0).truncate().child(label))
      .when(Boolean(hint), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(11).text_color(t.dim).child(hint)));
    const sep = () => div().h(1).my(4).bg(t.border);
    const has = (proj.folders ?? []).length > 0;
    const at = act.projectPlace(proj, home());
    // As its row: a task, a terminal (across its folders, in the folder above them), its board; then
    // manage it. An agent starts from a task (Start with… picks which).
    return v_flex().p(5).text_size(12.5)
      .child(h_flex().px(8).pt(4).pb(6).gap(6).items_center()
        .child(icon("layers", 13, t.muted))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(proj.name))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(has ? S.reposCount(proj.folders.length) : S.noRepos)))
      .child(item("p-task", "plus", `${S.newTaskTitle}…`, () => { close(); openDialog("task", { project: proj.id }); }))
      .child(item("p-term", "square-terminal", S.projectTerminal, () => { close(); act.openInProject(proj); }, tilde(at.folder, home())))
      .child(item("p-board", "square-kanban", S.projectBoard, () => { close(); act.openBoard(proj); }))
      .child(item("p-stats", "chart-column", S.stats, () => { close(); act.openStats(proj); }))
      .child(sep())
      .child(item("p-edit", "pencil", `${S.editProjectItem}…`, () => { close(); openDialog("project", { project: proj.id }); }))
      // Paused: its tasks leave Now and the board of every project; it waits folded in Projects.
      .child(item("p-pause", proj.paused ? "circle-play" : "circle-pause", proj.paused ? S.activateProject : S.pauseProject,
        (_e, cx) => this.closeAfter(cx, () => this.store.update((d) => { const x = d.projects.find((y) => y.id === proj.id); if (!x) return false; setPaused(x, !x.paused); }))))
      .when(this.spacesOf(proj.folders ?? [], proj.id).length > 0, (el) => el.child(item("p-close", "circle-x", `${S.closeProject}…`, () => { close(); openDialog("confirm-close", { repos: proj.folders, name: proj.name, project: proj.id }); })));
  },

  // ── Menu of a terminal in no task (a shell): put it in a task, or go to it ──
  looseMenu(t, p, cx) {
    this.look(cx);
    const u = this.world.untracked.find((x) => x.tab === p.tab);
    if (!u) return div().p(10).text_color(t.dim).child(S.loading);
    const pane = u.agents[0]?.a.pane ?? u.panes[0]?.pane;
    const item = (id, iconName, label, onClick) => h_flex().id(id).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(onClick).child(icon(iconName, 13, t.muted)).child(div().flex_1().truncate().child(label));
    return v_flex().p(5).text_size(12.5)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(untrackedName(u)))
      .child(item("l-add", "list-plus", S.addToTask, () => { close(); openDialog("jump", { attach: u.tab }); }))
      .when(Boolean(pane), (el) => el.child(item("l-go", "arrow-right", S.focusAgent, () => { close(); run("pane.focus", { pane }); })));
  },

  // ── Later: a quick choice, or a day typed as for a due date, or "someday" ──
  // Waiting on someone ({ waiting: true }): who (optional), and the day to follow up.
  initLater(cx, p) {
    this.saving = false;
    this.waiting = p?.waiting === true;
    this.laterText = this.waiting ? WAITING_DAY : "";
    this.whoText = "";
    this.laterInput = InputState.new({ value: this.laterText, placeholder: S.laterPlaceholder });
    this.laterInput.on("change", (_e, cx) => { this.laterText = this.laterInput.value(); cx.notify(); });
    this.laterInput.on("submit", (_e, cx) => this.saveLater(cx));
    this.whoInput = InputState.new({ placeholder: S.waitingPlaceholder });
    this.whoInput.on("change", (_e, cx) => { this.whoText = this.whoInput.value(); cx.notify(); });
    this.whoInput.on("submit", (_e, cx) => this.saveLater(cx));
    (this.waiting ? this.whoInput : this.laterInput).focus();
    cx.spawn(async (cx) => { if (!this.store.loaded) await this.store.load(); cx.notify(); });
  },

  // `word`: one of the quick choices (tomorrow, mon, someday, agent), else what was typed.
  saveLater(cx, word = null) {
    const v = word === "agent" ? "agent" : parseLater(word ?? this.laterText);
    const id = props().task;
    if (!v || !id) return;
    const who = this.waiting ? this.whoText : null;
    this.closeAfter(cx, () => this.store.update((d) => { const x = d.tasks.find((y) => y.id === id); if (!x) return false; park(kept(x), v, who); x.updated = Date.now(); }));
  },

  laterForm(t, cx) {
    const task = this.store.task(props().task);
    const v = parseLater(this.laterText);
    const who = this.waiting ? this.whoText.trim() : null;
    const hint = !this.laterText.trim() ? null : v ? { text: S.laterUntil(laterLabel(v), who) + (v === "someday" ? "" : ` · ${v}`) }
      : { text: v === null ? S.laterPast : S.laterBad, color: t.blocked };
    return v_flex().p(18).gap(10).size_full()
      .child(this.title(t, (this.waiting ? S.waitingTitle : S.laterTitle)(task?.title ?? "")))
      .when(this.waiting, (el) => el.child(field(t, S.waitingOn, input(t, this.whoInput, true))))
      .when(!this.waiting, (el) => el.child(h_flex().gap(6).flex_wrap().children(LATER_QUICK.map(([word, label]) => button(t, `later-${word}`, S[label], (_e, cx) => this.saveLater(cx, word),
        { small: true, tooltip: word === "agent" ? S.laterAgentHint : null })))))
      .child(field(t, this.waiting ? S.waitingDay : S.laterDay, input(t, this.laterInput, !this.waiting, this.laterText.trim() && !v), hint))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end().child(button(t, "cancel", S.cancel, close))
        .child(button(t, "later-save", S.laterSave, (_e, cx) => this.saveLater(cx), { primary: true, iconName: this.waiting ? "circle-pause" : "moon", disabled: !v })));
  },

  // ── Start with…: which agent, model and effort, and whether in a worktree ──
  // Saved on the task, so its next starts (l, ▶, Start agent) use them too.
  initStart(cx, p) {
    this.saving = false;
    this.agentList = null;
    // What the task starts with now (read again once the file is: a dialog may open before).
    const fill = () => {
      const task = this.store.task(p.task);
      this.choice = { agent: task?.agent ?? null, model: task?.model ?? "", effort: task?.effort ?? null, worktree: p.worktree === true };
      this.modelInput?.set_value(this.choice.model);
    };
    fill();
    this.modelInput = InputState.new({ value: this.choice.model, placeholder: S.defaultChoice });
    this.modelInput.on("change", (_e, cx) => { this.choice.model = this.modelInput.value(); cx.notify(); });
    this.modelInput.on("submit", (_e, cx) => this.saveStart(cx));
    this.handle.focus();
    cx.spawn(async (cx) => {
      if (!this.store.loaded) { await this.store.load(); fill(); }
      try { this.agentList = (await knownAgents()).filter((a) => a.installed && a.run?.length && a.agent); } catch { this.agentList = []; }
      cx.notify();
    });
  },

  saveStart(cx) {
    const id = props().task;
    if (!id) return;
    const c = this.choice;
    const pick = { agent: c.agent || null, model: c.model.trim() || null, effort: c.effort || null };
    this.closeAfter(cx, async () => {
      await this.store.update((d) => {
        const x = d.tasks.find((y) => y.id === id);
        if (!x) return false;
        for (const [k, v] of Object.entries(pick)) { if (v) x[k] = v; else delete x[k]; }
      });
      const task = this.store.task(id);
      if (task) await this.startAgent(task, c.worktree && Boolean(task.folder) && !this.repos.notGit(untilde(task.folder, home())));
    });
  },

  startForm(t, cx) {
    const task = this.store.task(props().task);
    const s = this.store.data.settings;
    const c = this.choice;
    const agents = this.agentList ?? [];
    const key = c.agent ?? s.agent;
    const chosen = agents.find((a) => a.key === key);
    const kind = act.kindOf(chosen?.run);
    const name = (k) => agents.find((a) => a.key === k)?.name ?? k;
    const git = Boolean(task?.folder) && !task?.worktree && !this.repos.notGit(untilde(task.folder, home()));
    const modelPick = !kind ? null : v_flex().gap(6).child(input(t, this.modelInput, false))
      .when(kind === "claude", (col) => col.child(segmented(t, "sm", MODELS.claude.map((m) => [m, m]), c.model.trim(), (v) => { c.model = v; this.modelInput.set_value(v); })));
    const effortPick = kind ? segmented(t, "se", [[null, S.defaultChoice], ...act.EFFORTS[kind].map((x) => [x, x])], c.effort, (v) => { c.effort = v; }) : null;
    const wherePick = !git ? null : segmented(t, "sw", [[false, S.inItsFolder], [true, S.inWorktree]], c.worktree, (v) => { c.worktree = v; });
    return this.withFooter(t, v_flex().gap(12)
      .child(this.title(t, S.startTitle(task?.title ?? "")))
      .child(field(t, S.agentField, this.agentList == null ? div().text_color(t.dim).child(S.loading)
        : segmented(t, "sa", [[null, S.defaultAgentChoice(name(s.agent))], ...agents.filter((a) => a.key !== s.agent).map((a) => [a.key, a.name])], c.agent, (v) => { c.agent = v; c.effort = null; })))
      // Model and effort: for the agents whose flags taskr knows (Claude Code, Codex).
      .when(Boolean(kind), (el) => el.child(field(t, S.modelField, modelPick, { text: S.modelHint[kind] })).child(field(t, S.effortField, effortPick)))
      .when(git, (el) => el.child(field(t, S.whereField, wherePick, { text: S.startWorktreeHint }))),
    [button(t, "cancel", S.cancel, close), button(t, "start-go", S.start, (_e, cx) => this.saveStart(cx), { primary: true, iconName: "play", disabled: this.saving || this.agentList == null })]);
  },

  // ── Archive and delete ─────────────────────────────────────────────────
  confirmBox(t, title, body, buttons) {
    return v_flex().p(18).gap(10).size_full()
      .child(this.title(t, title))
      .child(div().text_color(t.muted).child(body))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end().child(button(t, "cancel", S.cancel, close)).children(buttons));
  },

  archiveConfirm(t, p) {
    const task = this.store.task(p.task);
    if (!task) return div();
    const go = (removeWorktree) => (_e, cx) => {
      if (this.saving) return;
      this.saving = true;
      cx.spawn(async () => {
        const warning = await act.archive(this.store, task, { removeWorktree });
        close();
        if (warning) notify({ title: S.archive, body: warning, level: "warning" });
      });
    };
    return this.confirmBox(t, S.archiveTitle(task.title),
      task.worktree ? S.archiveBodyWorktree(task.worktree, task.branch) : S.archiveBody, [
        ...(task.worktree ? [button(t, "arch-wt", S.archiveAndRemove, go(true), { danger: true })] : []),
        button(t, "arch", S.archive, go(false), { primary: true }),
      ]);
  },

  // The spaces open in these repositories (a worktree's space counts as its repo's), and
  // with `project`, the project's own spaces (where its tabs above the repositories are).
  spacesOf(repos, project = null) {
    this.look(null);
    const h = home();
    const keys = new Set(repos.map((r) => tilde(untilde(r, h), h)));
    const own = new Set(project ? this.world.untracked.filter((u) => u.project === project).map((u) => u.where.s.id) : []);
    const proj = project ? this.store.project(project) : null;
    const at = proj ? act.projectPlace(proj, h) : null;
    const mine = (s) => own.has(s.s.id) || (at && s.s.name === proj.name && s.folder === at.folder);
    return this.world.spaces.filter((s) => !s.on && ((s.key && keys.has(s.key)) || mine(s)));
  },

  closeConfirm(t, p, cx) {
    this.look(cx);
    const list = this.spacesOf(p.repos ?? [], p.project ?? null);
    const tabs = new Set(list.flatMap((s) => (s.s.tabs ?? []).map((x) => x.id)));
    const agents = [...this.world.byTab.entries()].filter(([tab]) => tabs.has(tab)).reduce((n, [, es]) => n + es.length, 0);
    const go = () => { for (const s of list) run("space.close", { id: s.s.id, confirmed: true }); close(); };
    return this.confirmBox(t, S.closeTitle(p.name ?? ""), S.closeBody(list.length, agents),
      [button(t, "close-it", S.closeIt, go, { danger: true, iconName: "circle-x", disabled: !list.length })]);
  },

  deleteConfirm(t, p) {
    const task = this.store.task(p.task);
    if (!task) return div();
    this.look(null);
    const open = this.world.taskById.get(task.id)?.live.length ?? 0;
    const del = (_e, cx) => this.closeAfter(cx, async () => {
      await act.remove(this.store, task);
      if (shared("taskr.selected") === task.id) setShared("taskr.selected", null);
    });
    return this.confirmBox(t, S.deleteTitle(task.title), open ? S.deleteBodyTabs(open) : S.deleteBody, [button(t, "del", S.remove, del, { danger: true, iconName: "trash-2" })]);
  },

  // ── Settings ───────────────────────────────────────────────────────────
  initSettings(cx) {
    this.handle.focus();
    this.agentList = null;
    cx.spawn(async (cx) => {
      try { this.agentList = (await knownAgents()).filter((a) => a.run?.length && a.agent); } catch { this.agentList = []; }
      cx.notify();
    });
  },

  settingsForm(t, cx) {
    const s = this.store.data.settings;
    const set = (patch) => (_e, cx) => cx.spawn(async (cx) => { await this.store.update((d) => { Object.assign(d.settings, patch); }); cx.notify(); });
    const stepper = (id, value, min, max, label, key) => h_flex().gap(6).items_center()
      .child(div().id(`${id}-minus`).size(24).rounded(6).border_1().border_color(t.input).flex().items_center().justify_center().cursor_pointer()
        .hover((x) => x.bg(t.hover)).when(value > min, (el) => el.on_click(set({ [key]: value - 1 }))).child("−"))
      .child(div().min_w(64).text_size(12.5).flex().justify_center().child(label))
      .child(div().id(`${id}-plus`).size(24).rounded(6).border_1().border_color(t.input).flex().items_center().justify_center().cursor_pointer()
        .hover((x) => x.bg(t.hover)).when(value < max, (el) => el.on_click(set({ [key]: value + 1 }))).child("+"));
    // Installed agents, and the chosen one even when it isn't.
    const agents = (this.agentList ?? []).filter((a) => a.installed || a.key === s.agent);
    const known = agents.some((a) => a.key === s.agent);
    // The layout's stack of lists (taskr's own layout has one; a custom layout may not).
    const find = (n) => (n?.id === "taskr-lists" ? n : (n?.children ?? []).map(find).find(Boolean));
    const lists = find(layout());
    const setting = (label, hint, el) => v_flex().gap(6)
      .child(div().text_size(12).font_medium().child(label)).child(el)
      .child(div().text_size(11).text_color(t.dim).child(hint));
    const onOff = (key) => h_flex().gap(4).children([[true, S.on], [false, S.off]].map(([v, label]) =>
      h_flex().id(`${key}-${v}`).h(26).px(10).rounded(6).items_center().text_size(11.5).cursor_pointer()
        .border_1().border_color(s[key] === v ? t.accent : t.input).bg(s[key] === v ? t.accent + "26" : t.background)
        .hover((x) => x.bg(t.hover)).on_click(set({ [key]: v })).child(label)));
    return this.withFooter(t, v_flex().gap(14)
      .child(this.title(t, S.settingsTitle))
      .child(setting(S.parkAfter, S.parkAfterHint, h_flex().gap(4).flex_wrap().children(PARK_AFTER.map((m) =>
        h_flex().id(`park-${m}`).h(26).px(10).rounded(6).items_center().text_size(11.5).cursor_pointer()
          .border_1().border_color(s.park_after === m ? t.accent : t.input).bg(s.park_after === m ? t.accent + "26" : t.background)
          .hover((x) => x.bg(t.hover)).on_click(set({ park_after: m })).child(S.parkAfterLabel(m))))))
      .when(Boolean(lists), (el) => el.child(setting(S.listsLayout, S.listsLayoutHint, h_flex().gap(4).children([["taskr-sidebar", S.listsTabs], ["taskr-split", S.listsStacked]].map(([child, label]) => {
        const on = (lists.active ?? lists.children?.[0]?.id) === child;
        return h_flex().id(`lists-${child}`).h(26).px(10).rounded(6).items_center().text_size(11.5).cursor_pointer()
          .border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent + "26" : t.background)
          .hover((x) => x.bg(t.hover)).on_click(() => run("layout.select", { stack: "taskr-lists", child })).child(label);
      })))))
      .child(setting(S.pauseAfter, S.pauseAfterHint, h_flex().gap(4).flex_wrap().children(PAUSE_AFTER.map((n) =>
        h_flex().id(`pause-${n}`).h(26).px(10).rounded(6).items_center().text_size(11.5).cursor_pointer()
          .border_1().border_color(s.pause_after === n ? t.accent : t.input).bg(s.pause_after === n ? t.accent + "26" : t.background)
          .hover((x) => x.bg(t.hover)).on_click(set({ pause_after: n })).child(S.pauseAfterLabel(n))))))
      .child(setting(S.wipLimit, S.wipLimitHint, stepper("wip", s.wip, 1, 20, String(s.wip), "wip")))
      .child(setting(S.staleDays, S.staleDaysHint, stepper("stale", s.stale_days, 1, 60, S.days(s.stale_days), "stale_days")))
      .child(setting(S.revive, S.reviveHint, onOff("revive")))
      .child(setting(S.reminders, S.remindersHint, onOff("reminders")))
      .child(setting(S.showActivity, S.showActivityHint, onOff("activity")))
      .child(setting(S.showUsage, S.showUsageHint, onOff("usage")))
      .child(setting(S.defaultAgent, S.defaultAgentHint, this.agentList == null ? div().text_color(t.dim).child(S.loading)
        : h_flex().gap(4).flex_wrap().children([...agents, ...(known ? [] : [{ key: s.agent, name: s.agent, installed: false }])].map((a) => {
          const on = a.key === s.agent;
          return h_flex().id(`ag-${a.key}`).h(26).px(9).gap(6).rounded(6).items_center().text_size(11.5).cursor_pointer()
            .border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent + "26" : t.background)
            .text_color(a.installed ? t.foreground : t.dim).hover((x) => x.bg(t.hover))
            .on_click(set({ agent: a.key }))
            .child(a.name).when(!a.installed, (el) => el.child(div().text_size(10).text_color(t.dim).child(S.notInstalled)));
        })))), [button(t, "close", S.close, close, { primary: true })]);
  },

  // ── Jump palette ───────────────────────────────────────────────────────
  initJump(cx) {
    this.query = "";
    this.at = 0;
    this.q = InputState.new({ placeholder: S.searchTasks.replace(" (/)", "") });
    this.q.on("change", (_e, cx) => { this.query = this.q.value(); this.at = 0; cx.notify(); });
    this.q.on("submit", (_e, cx) => this.pickJump(undefined, cx));
    this.q.focus();
  },

  jumpList() {
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const projects = new Map(this.store.data.projects.map((p) => [p.id, p.name]));
    const attach = Boolean(props()?.attach || props()?.merge);
    const merge = props()?.merge;
    return this.store.data.tasks.filter((x) => !x.archived && x.id !== merge && (!attach || OPEN.has(x.status)))
      .filter((x) => words.every((w) => `${x.title} ${x.folder ?? ""} ${x.next_step ?? ""} ${projects.get(x.project) ?? ""} ${issueLabel(x.issue)}`.toLowerCase().includes(w)))
      .sort((a, b) => (OPEN.has(a.status) ? 0 : 1) - (OPEN.has(b.status) ? 0 : 1) || byRank(a, b)).slice(0, 12);
  },

  pickJump(id, cx) {
    const list = this.jumpList();
    const task = id ? list.find((x) => x.id === id) : list[this.at];
    if (!task) return;
    // As a click in the list: select it and bring its agent to the front. Opened to put
    // a loose tab in a task: tie it first.
    // Opened to move a task's agent into another: the first one goes.
    const tab = props()?.attach, merge = props()?.merge;
    setShared("taskr.selected", task.id);
    if (tab && cx) { this.closeAfter(cx, () => act.link(this.store, task.id, tab, terminals())); return; }
    if (merge && cx) { this.closeAfter(cx, () => act.merge(this.store, merge, task.id, terminals())); return; }
    this.look(null);
    const pane = this.paneOf(this.world.taskById.get(task.id));
    if (pane) run("pane.focus", { pane });
    close();
  },

  jump(t, cx) {
    const list = this.jumpList();
    return v_flex().p(10).gap(6).size_full().min_h(0)
      .on_key_down((e, cx) => {
        if (e.key === "down") { this.at = Math.min(this.at + 1, list.length - 1); cx.notify(); cx.stop_propagation(); }
        if (e.key === "up") { this.at = Math.max(this.at - 1, 0); cx.notify(); cx.stop_propagation(); }
      })
      .when(Boolean(props()?.attach || props()?.merge), (el) => el.child(div().px(2).pb(2).text_size(12).text_color(t.muted).child(props()?.merge ? S.moveToTaskTitle : S.addToTaskTitle)))
      .child(Input.new(this.q).h(34).px(10).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(13))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(list.map((x, i) =>
        h_flex().id(`j-${x.id}`).h(30).px(8).gap(8).rounded(6).items_center().cursor_pointer()
          .bg(i === this.at ? t.selected : t.popover).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.pickJump(x.id, cx))
          .child(statusIcon(t, stageOf(x), 13))
          .child(div().flex_1().truncate().child(x.title))
          .when(Boolean(x.folder), (el) => el.child(div().text_size(11).text_color(t.dim).child(base(x.folder))))))
        .when(!list.length, (el) => el.child(div().p(8).text_color(t.dim).child(this.query ? S.noMatch(this.query) : S.noTasks))));
  },

  // ── Import issues: GitHub (gh) or Linear ───────────────────────────────
  initIssues(cx, p) {
    this.issues = null;
    this.issuesError = null;
    this.picked = new Set();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        if (p.source === "linear") {
          const key = await linearKey();
          if (!key) this.issuesError = S.linearNoKey;
          else this.issues = await linearIssues(key);
        } else {
          this.issues = (await act.issues(untilde(p.repo, home()))).map((i) => ({ ...i, source: "github" }));
        }
      } catch (e) { this.issuesError = String(e?.message ?? e); }
      cx.notify();
    });
  },

  issuesList(t, cx) {
    const p = props();
    const linear = p.source === "linear";
    const known = new Set(this.store.data.tasks.map((x) => x.issue?.url).filter(Boolean));
    const list = (this.issues ?? []).filter((i) => !known.has(i.url));
    return v_flex().p(18).gap(10).size_full().min_h(0)
      .child(this.title(t, linear ? S.linearTitle(p.repo ? base(p.repo) : null) : S.issuesTitle(base(p.repo ?? ""))))
      .when(linear && !this.issuesError, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(S.linearHint)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(
        this.issuesError ? [div().text_color(this.issuesError === S.linearNoKey ? t.muted : t.blocked).child(this.issuesError)]
          : !this.issues ? [div().text_color(t.dim).child(S.loading)]
          : !list.length ? [div().text_color(t.dim).child(S.noIssues)]
          : list.map((i) => {
            const on = this.picked.has(i.url);
            return h_flex().id(`i-${i.number}`).min_h(28).px(6).gap(8).rounded(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => { on ? this.picked.delete(i.url) : this.picked.add(i.url); cx.notify(); })
              .child(icon(on ? "circle-check" : "circle", 14, on ? t.accent : t.dim))
              .child(div().w(linear ? 64 : 40).flex_none().truncate().text_color(t.dim).child(issueLabel(i)))
              .child(div().flex_1().truncate().child(String(i.title ?? "")))
              .when(Boolean(i.due), (el) => el.child(chip(t, i.due.slice(5), t.dim)))
              .children((i.labels ?? []).slice(0, 2).map((l) => chip(t, String(l.name ?? ""), t.dim)));
          })))
      .child(h_flex().gap(8).justify_end()
        .child(button(t, "cancel", S.cancel, close))
        .child(button(t, "import", S.importN(this.picked.size), (_e, cx) => {
          const chosen = list.filter((i) => this.picked.has(i.url));
          if (!chosen.length || this.saving) return;
          this.saving = true;
          cx.spawn(async () => {
            await this.store.update((d) => {
              // Most urgent first (Linear's priority), each after the last.
              for (const i of [...chosen].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2))) {
                newTask(d, { title: i.title, folder: p.repo ?? null, project: p.project ?? null, status: "inbox",
                  due: i.due ?? null,
                  issue: { source: i.source, number: i.number, url: i.url, body: (i.body ?? "").slice(0, 4000) } });
              }
            });
            close();
          });
        }, { primary: true, disabled: !this.picked.size })));
  },
};
