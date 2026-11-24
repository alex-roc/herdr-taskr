// The header of each terminal, for the taskr layout ({ "header": { "content": { "mod": "taskr" } } }):
// Herdr draws one copy per pane, with props { pane, terminal }. It says what the terminal is for
// (its task's title, else its program) and, for an agent, its model, effort and context; then the
// folder and the agent's state. The buttons split, zoom and close this pane, as Herdr's own header.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, panes, terminals, props, home, setShared, focused, nextCommand } from "herdr";
import { S } from "./strings.js";
import { shortModel, kilo, tilde, label } from "./lib/util.js";
import { icon, agentMark, programIcon, shownLists } from "./lib/ui.js";
import { claim } from "./lib/cache.js";
import { closeGuarded } from "./lib/actions.js";

// The task a terminal is in: the label taskr puts on the terminals it opens, else its tab.
export function taskOfPane(data, p, term) {
  const live = data.tasks.filter((t) => !t.deleted && !t.archived);
  const id = label(term, "task");
  return (id && live.find((t) => t.id === id)) || live.find((t) => (t.tabs ?? []).includes(p.tab)) || null;
}

export const Pane = {
  initPane(cx) {
    this.hovered = false;
    // cmd-w and cmd-shift-w go to the lists; with none on screen, to the focused pane's header.
    cx.spawn(async () => {
      for (;;) {
        let c = null;
        try { c = await nextCommand(); } catch {}
        if (c == null) return;
        if (!["close", "closePane"].includes(c) || shownLists().length || focused()?.pane !== props()?.pane) continue;
        if (claim(c)) closeGuarded(c === "close" ? "tab" : "pane");
      }
    });
  },

  paneButton(t, id, iconName, tooltip, onClick) {
    return div().id(id).p(3).rounded(4).text_color(t.dim).tooltip(tooltip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); })
      .child(icon(iconName, 13));
  },

  renderPane(cx) {
    const t = theme();
    const p = panes().find((x) => x.pane === props()?.pane);
    if (!p) return div();
    const term = p.terminal ? terminals().find((x) => x.address === p.terminal) ?? null : null;
    // Model and context: the sidebar already looks them up for every agent; this asks only
    // for its own (a shared cache, so once), in case the lists are hidden.
    if (term && (p.program?.agent || p.app)) this.info.refresh(cx, [term]);
    const info = p.terminal ? this.info.get(p.terminal) : null;
    const task = this.store.loaded ? taskOfPane(this.store.data, p, term) : null;
    const prog = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || S.terminal;
    const meta = [shortModel(info?.model), info?.effort, info?.ctx ? S.ctx(kilo(info.ctx)) : null].filter(Boolean).join(" · ");
    const mark = p.status ? agentMark(t, p.status, false) : null;
    const pane = p.pane;
    return h_flex().id(`ph-${pane}`).size_full().px(10).gap(8).items_center().bg(t.background)
      .border_b(1).border_color(t.border).text_size(12)
      .on_hover((on, cx) => { if (this.hovered !== on) { this.hovered = on; cx.notify(); } })
      // Focuses the pane; a task's also becomes the selected one, as clicking its row does.
      .on_click(() => { if (task) setShared("taskr.selected", task.id); run("pane.focus", { pane }); })
      .child(programIcon(p.program, 14, t.dim) ?? icon("square-terminal", 13, t.dim))
      .child(div().flex_none().max_w(320).truncate().font_medium().text_color(t.foreground).child(task ? task.title : prog))
      .when(Boolean(meta), (el) => el.child(div().flex_none().max_w(220).truncate().text_size(11.5).text_color(t.muted).child(meta)))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(p.cwd ? tilde(p.cwd, home()) : ""))
      .when(Boolean(mark), (el) => el.child(mark))
      .when(this.hovered, (el) => el
        .child(this.paneButton(t, `ph-r-${pane}`, "columns-2", S.paneSplitRight, () => run("pane.split", { direction: "right", pane })))
        .child(this.paneButton(t, `ph-d-${pane}`, "rows-2", S.paneSplitDown, () => run("pane.split", { direction: "down", pane })))
        .child(this.paneButton(t, `ph-z-${pane}`, p.zoomed ? "minimize-2" : "maximize-2", p.zoomed ? S.paneUnzoom : S.paneZoom, () => run("pane.zoom", { pane })))
        // Not an agent's: it quits from inside (lib/actions.js closeGuarded).
        .child(this.paneButton(t, `ph-x-${pane}`, "x", S.paneClose, () => closeGuarded("pane", pane))));
  },
};
