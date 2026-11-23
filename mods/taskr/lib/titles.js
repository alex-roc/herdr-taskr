// Agents that report no state to Herdr (Claude Code attached to its background session with
// `claude attach`) still show it in their terminal's title: a spinner first while working,
// ✳ when stopped. Herdr hands mods the title without that mark, so it's read from the core
// (`hc get`), every few seconds while the window is in front, and only for those agents.
// Shared by every copy; a change redraws them all (once, not on every look).
//
// The title says working or stopped, never "finished while you weren't looking" (Herdr's `done`,
// which turns `idle` once you look): from working to stopped with its terminal not in front of
// you, it's `done` here too, until you look at it. (Claude Code also reports nothing when, as it
// started, the terminal didn't answer its question about reports in time: a dozen agents resumed
// at once after a restart.)

import { hc, setShared, focused, window } from "herdr";
import { sharedCache, busy } from "./cache.js";
import { titleState, unreported } from "./world.js";

const SILENT_MS = 60000; // silent this long: shown, with a way to restart it

export class Titles {
  constructor() {
    this.c = sharedCache("titles"); // info: address -> "working" | "idle" | "done" | "unknown"; seen: address -> last look
  }

  get(address) {
    return this.c.info[address] ?? null;
  }

  // A Claude Code that missed its reports as it started (world.js `unreported`), for a while now.
  silent(e, now = Date.now()) {
    return unreported(e) && this.silentFor(e.a.address, now) > SILENT_MS;
  }

  // When its state (as its title says) last changed, as taskr saw it: the clock for one that reports
  // nothing, since the core's own stamp is from its last report, maybe days ago.
  changedAt(address) {
    return this.c.changed?.[address] ?? null;
  }

  // How long it has reported nothing, as far as taskr has seen (0: not seen silent).
  silentFor(address, now = Date.now()) {
    const at = this.c.quietAt?.[address];
    return at ? now - at : 0;
  }

  refresh(cx, addresses, maxAge = 3000) {
    const now = Date.now();
    const c = this.c;
    // Since when each has been silent: from the first look, forgotten once it reports (or goes).
    c.quietAt ??= {};
    for (const a of Object.keys(c.quietAt)) if (!addresses.includes(a)) delete c.quietAt[a];
    for (const a of addresses) c.quietAt[a] ??= now;
    const due = addresses.filter((a) => !a.includes("/") && !busy(c, a, now) && now - (c.seen[a] ?? 0) > maxAge);
    if (!due.length) return;
    for (const a of due) c.busy[a] = now;
    cx.spawn(async () => {
      let changed = false;
      for (const a of due) {
        let state = "unknown";
        try {
          const r = await hc(["get", a, "--json"]);
          if (r?.code === 0) state = titleState(JSON.parse(r.stdout || "{}").title) ?? "unknown";
        } catch {}
        // Stopped: finished while you weren't looking, until you look.
        if (state === "idle") {
          const looking = Boolean(window()?.active) && focused()?.terminal === a;
          if (!looking && ["working", "done"].includes(c.info[a])) state = "done";
        }
        c.changed ??= {};
        // done and idle as one: looking at it doesn't move its clock.
        const was = c.info[a] === "done" ? "idle" : c.info[a];
        if (was !== (state === "done" ? "idle" : state) || !c.changed[a]) c.changed[a] = Date.now();
        if (c.info[a] !== state) { c.info[a] = state; changed = true; }
        c.seen[a] = Date.now();
        delete c.busy[a];
      }
      if (changed) setShared("taskr.titles", Date.now());
    });
  }
}
