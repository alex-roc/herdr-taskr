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
import { titleState } from "./world.js";

export class Titles {
  constructor() {
    this.c = sharedCache("titles"); // info: address -> "working" | "idle" | "done" | "unknown"; seen: address -> last look
  }

  get(address) {
    return this.c.info[address] ?? null;
  }

  refresh(cx, addresses, maxAge = 3000) {
    const now = Date.now();
    const c = this.c;
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
        if (c.info[a] !== state) { c.info[a] = state; changed = true; }
        c.seen[a] = Date.now();
        delete c.busy[a];
      }
      if (changed) setShared("taskr.titles", Date.now());
    });
  }
}
