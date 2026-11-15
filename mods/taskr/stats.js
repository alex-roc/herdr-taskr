// Stats: a tab with what got done and how much the agents worked, over today or the last 7, 30
// or 90 days, for every project or one. Every task counts alike, planned or not.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, props } from "herdr";
import { S } from "./strings.js";
import { duration } from "./lib/util.js";
import { icon } from "./lib/ui.js";
import { PERIODS, periodDays, summary } from "./lib/stats.js";

const BAR_H = 72; // the tallest bar, px

export const Stats = {
  initStats(cx) {
    this.statsProject = props()?.project ?? null;
    this.statsSeen = shared("taskr.statsPick")?.at ?? 0;
    let saved = null;
    try { saved = localStorage.getItem("statsPeriod"); } catch {}
    this.statsPeriod = PERIODS.some(([k]) => k === saved) ? saved : "7d";
    cx.timer.every(60000, (cx) => cx.notify());
  },

  renderStats() {
    const t = theme();
    // Asked for a project's stats (its menu) while this tab was open: show that one.
    const pick = shared("taskr.statsPick");
    if (pick && pick.at > this.statsSeen) { this.statsSeen = pick.at; this.statsProject = pick.project; }
    if (this.statsProject && !this.store.project(this.statsProject) && this.store.loaded) this.statsProject = null;
    const n = PERIODS.find(([k]) => k === this.statsPeriod)?.[1] ?? 7;
    const days = periodDays(n);
    const sum = summary(this.world.tasks, { days, project: this.statsProject });
    const pill = (id, label, on, onClick, iconName = null) => h_flex().id(id).flex_none().px(9).h(24).gap(6).rounded(6).items_center().text_size(12)
      .bg(on ? t.selected : t.canvas).text_color(on ? t.foreground : t.muted)
      .when(!on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { onClick(); cx.notify(); }))
      .when(Boolean(iconName), (el) => el.child(icon(iconName, 12))).child(label);
    const setPeriod = (k) => { this.statsPeriod = k; try { localStorage.setItem("statsPeriod", k); } catch {} };
    const tile = (id, label, value, sub = null) => v_flex().id(id).flex_1().min_w(130).p(12).gap(2).rounded(9).bg(t.chrome).border_1().border_color(t.border)
      .child(div().text_size(11).text_color(t.dim).child(label))
      .child(div().text_size(22).font_semibold().text_color(t.foreground).child(value))
      .when(Boolean(sub), (el) => el.child(div().text_size(11).text_color(t.muted).child(sub)));
    const hours = (ms) => (ms ? duration(ms) : "0m");
    // A bar per day: one measure per chart, its height from that chart's largest day. Each day has
    // its slot; its date shows under it over a week or less, else under the first and last.
    const bars = (id, label, values, color, show) => {
      const max = Math.max(...values.map((v) => v.value), 0);
      const dated = (i) => values.length <= 7 || i === 0 || i === values.length - 1;
      return v_flex().id(id).gap(6).p(12).rounded(9).bg(t.chrome).border_1().border_color(t.border).min_w(0)
        .child(div().text_size(11.5).text_color(t.muted).child(label))
        .child(h_flex().gap(2).items_end().min_w(0)
          .children(values.map((v, i) => v_flex().id(`${id}-${i}`).flex_1().min_w(2).gap(4).items_center()
            .tooltip(`${S.statsDay(v.day)}: ${show(v.value)}`)
            .child(h_flex().h(BAR_H).w_full().items_end().justify_center()
              .child(div().w_full().max_w(28).h(max ? Math.max(v.value ? 3 : 1, Math.round((v.value / max) * BAR_H)) : 1)
                .rounded_t(3).bg(v.value ? color : t.border)))
            .child(div().h(14).text_size(10.5).text_color(t.dim).whitespace_nowrap().child(dated(i) ? S.statsDay(v.day) : "")))));
    };
    const name = (id) => (id ? this.store.project(id)?.name ?? S.noProject : S.noProject);
    const cell = (text, w, right = true, color = t.foreground) => div().w(w).flex_none().when(right, (el) => el.text_right()).text_color(color).child(text);
    const table = v_flex().id("st-projects").p(12).gap(4).rounded(9).bg(t.chrome).border_1().border_color(t.border)
      .child(h_flex().pb(4).gap(8).text_size(11).text_color(t.dim).border_b(1).border_color(t.border)
        .child(div().flex_1().child(S.project)).child(cell(S.statsDone, 70, true, t.dim)).child(cell(S.statsWorked, 90, true, t.dim))
        .child(cell(S.statsTurns, 70, true, t.dim)).child(cell(S.statsAgentTime, 90, true, t.dim)))
      .children(sum.projects.map((r) => h_flex().id(`st-p-${r.id ?? "-"}`).h(24).gap(8).items_center().text_size(12)
        .child(div().flex_1().min_w(0).truncate().child(name(r.id)))
        .child(cell(String(r.done), 70)).child(cell(String(r.worked), 90)).child(cell(String(r.turns), 70)).child(cell(hours(r.ms), 90))))
      .when(!sum.projects.length, (el) => el.child(div().py(6).text_size(12).text_color(t.dim).child(S.statsNothing)));
    // Agent work is kept from the first day taskr saw it: say so when the period reaches before.
    const partial = !sum.since || sum.since > days[0];
    return v_flex().id("taskr-stats").size_full().min_h(0).bg(t.canvas).text_color(t.foreground)
      // The periods, then the projects in one row that scrolls sideways when they don't fit (as the board's).
      .child(h_flex().px(14).h(44).flex_none().gap(6).items_center()
        .child(div().flex_none().pr(8).text_size(14).font_semibold().child(S.stats))
        .children(PERIODS.map(([k]) => pill(`sp-${k}`, S.statsPeriod[k], this.statsPeriod === k, () => setPeriod(k))))
        .child(div().flex_none().w(12))
        .child(h_flex().id("st-pills").flex_1().min_w(0).gap(6).items_center().overflow_x_scrollbar()
          .child(pill("spj-all", S.allProjects, !this.statsProject, () => { this.statsProject = null; }))
          .children(this.store.data.projects.filter((p) => !p.paused || p.id === this.statsProject)
            .map((p) => pill(`spj-${p.id}`, p.name, this.statsProject === p.id, () => { this.statsProject = p.id; }, "layers")))))
      .child(v_flex().id("st-body").flex_1().min_h(0).px(14).pb(16).gap(12).overflow_y_scrollbar()
        .child(h_flex().gap(10).flex_wrap().items_stretch()
          .child(tile("st-done", S.statsDone, String(sum.totals.done), S.statsDoneSub))
          .child(tile("st-worked", S.statsWorked, String(sum.totals.worked)))
          .child(tile("st-turns", S.statsTurns, String(sum.totals.turns)))
          .child(tile("st-time", S.statsAgentTime, hours(sum.totals.ms))))
        .when(n > 1, (el) => el
          .child(bars("st-bars-time", S.statsTimePerDay, sum.days.map((d) => ({ day: d.day, value: d.ms })), t.working, hours))
          .child(bars("st-bars-done", S.statsDonePerDay, sum.days.map((d) => ({ day: d.day, value: d.done })), t.done, String)))
        .when(!this.statsProject, (el) => el.child(table))
        .when(partial, (el) => el.child(div().text_size(11).text_color(t.dim).child(sum.since ? S.statsSince(S.statsDay(sum.since)) : S.statsSinceNow))));
  },
};
