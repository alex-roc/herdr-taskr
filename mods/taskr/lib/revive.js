// Agents back after a restart. Herdr keeps every terminal: one that's lost (a reboot, the
// core crashing) comes back as a shell in its last folder, at the same address and in the
// same tab, but its program never runs again. taskr remembers which conversation each
// local Claude Code or Codex agent is in (data/taskr/terminals.json); a terminal that
// comes back as a fresh shell (another pid, no agent in front) gets
// `cd <folder> && claude --resume <id>` (or `codex resume <id>`) typed in.
// Quitting the agent yourself leaves the same shell (same pid): nothing is typed.
//
// Two things learned the hard way:
// - Text typed while a terminal is still being recovered (a Mac starting, a dozen terminals
//   coming back at once) can arrive twice: the shell runs the first copy and the agent finds the
//   second in its input box. So the line waits until the new shell has been in front a moment.
// - A dozen agents started at once may each miss the terminal's answer to their question about
//   status reports, and then report no state at all: they're typed back one at a time.
// - Shutting down quits the agents before their shells, and a shell left alone for a few seconds
//   looked like an agent quit by hand: its conversation was forgotten. Only minutes alone count.
// - A pid alone doesn't say it's the same shell: a Mac starting brings its terminals back in the
//   same order, and a shell can get the very pid it had before the restart. Taken for the old
//   shell, its agent counted as quit by hand and never came back. A record from before the Mac
//   started (`boot`, from `kern.boottime`) is never this shell, whatever its pid.

import { readTextFile, writeTextFile, exec, notify } from "herdr";
import { DIR } from "./store.js";
import { sharedCache } from "./cache.js";
import { resumeArgv } from "./actions.js";
import { agentInFront, shellOnly } from "./world.js";
import { S } from "../strings.js";

export const FILE = () => `${DIR()}/terminals.json`;
const KEEP_DAYS = 14;
const QUIT_MS = 120000; // a shell alone this long: its agent was quit by hand
const SETTLE_MS = 3000; // a new shell in front this long before the line is typed
const STUCK_MS = 60000;
const STAGGER_MS = 2000; // between one agent typed back and the next
const COMING_MS = 120000; // after the line is typed, its agent is still on its way this long
const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;


// What gets typed: back to the conversation's folder, then the agent's resume.
export async function resumeLine(r) {
  const argv = await resumeArgv({ app: r.app, id: r.id });
  return `${r.cwd ? `cd ${quote(r.cwd)} && ` : ""}${argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : quote(a))).join(" ")}`;
}

// Restarts an agent in its own terminal: quits it (/exit), waits for its shell, then resumes its
// conversation there. For one that reports no state (see world.js `unreported`), stopped.
export async function restart(addr, r) {
  const hcx = (args) => exec("env", ["-u", "HC_TERMINAL_ID", "hc", ...args]);
  const line = await resumeLine(r);
  await hcx(["send", addr, "/exit"]);
  for (let i = 0; i < 20; i++) {
    await exec("sleep", ["0.5"]);
    let t = null;
    try { t = JSON.parse((await hcx(["get", addr, "--json"]))?.stdout || "null"); } catch {}
    if (shellOnly(t)) return (await hcx(["send", addr, line]))?.code === 0;
  }
  return false;
}

export class Revive {
  constructor() {
    this.c = sharedCache("revive").info; // recs: address -> { pid, tab, app, id, cwd, at }; text: the file as read or written
  }

  // Once per look, from the bookkeeping. `ts`: terminals(); `info`: AgentInfo.
  step(cx, ts, info, enabled = true) {
    const c = this.c;
    if (!c.loaded) return this.load(cx);
    const now = Date.now();
    const live = new Map(ts.filter((t) => t.state === "live" && !t.address.includes("/")).map((t) => [t.address, t]));
    let dirty = false;
    let later = false;
    const back = [];
    const coming = new Set();
    c.typed ??= {};
    for (const [addr, r] of Object.entries(c.recs)) {
      if (now - (r.at ?? 0) > KEEP_DAYS * 86400000) { delete c.recs[addr]; dirty = true; continue; }
      const t = live.get(addr);
      if (!t) continue; // gone for now (a core still starting): kept
      if (enabled && now - (c.typed[addr] ?? 0) < COMING_MS && !agentInFront(t)) coming.add(r.tab);
      if (t.pid === r.pid && !(c.boot && (r.at ?? 0) < c.boot)) {
        // The same shell, itself in front for a while: the agent was quit by hand, so it isn't
        // one to bring back. (Right after a crash the old pid lingers with nothing in front.)
        if (shellOnly(t)) {
          r.quit ??= now;
          if (now - r.quit > QUIT_MS) { delete c.recs[addr]; dirty = true; }
        } else delete r.quit;
        continue;
      }
      // The address went to a terminal in another tab: not this one.
      if ((t.labels?.["herdr.tab"] ?? null) !== r.tab) { delete c.recs[addr]; dirty = true; continue; }
      // Its agent is back already (resumed some other way): nothing to type.
      if (agentInFront(t)) { r.pid = t.pid; r.at = now; delete r.quit; delete r.settling; dirty = true; continue; }
      if (enabled) coming.add(r.tab);
      // A new shell: typed into once it has been in front, settled, a moment (see above).
      if (!shellOnly(t)) continue;
      if (r.settling?.pid !== t.pid) { r.settling = { pid: t.pid, at: now }; later = true; continue; }
      if (now - r.settling.at < SETTLE_MS) { later = true; continue; }
      // One at a time, a moment apart: a dozen agents starting at once can miss the terminal's answer
      // to their question about status reports, and then report nothing for the whole session.
      if (enabled && (back.length || now < (c.nextAt ?? 0))) { later = true; continue; }
      r.pid = t.pid; // typed once for this shell: never twice (`at`: since this Mac started)
      r.at = now;
      delete r.quit;
      delete r.settling;
      dirty = true;
      if (enabled) { back.push({ addr, r: { ...r } }); c.typed[addr] = now; c.nextAt = now + STAGGER_MS; }
    }
    c.coming = coming;
    // A shell settling: look again once it has, though nothing else changes on screen.
    if (later && !(c.wakeAt > now)) {
      c.wakeAt = now + SETTLE_MS;
      cx.timer?.after(SETTLE_MS + 100, (cx) => cx.notify());
    }
    // Remember the conversation each local agent is in, while it's in front.
    for (const t of live.values()) {
      const i = info.get(t.address);
      // Only a conversation with a transcript (its model was read): an empty one can't resume.
      if (!i?.session || !i.model || !["claude", "codex"].includes(i.app) || !agentInFront(t)) continue;
      const r = c.recs[t.address];
      const tab = t.labels?.["herdr.tab"] ?? null;
      if (!r || r.pid !== t.pid || r.id !== i.session || r.tab !== tab) {
        c.recs[t.address] = { pid: t.pid, tab, app: i.app, id: i.session, cwd: i.cwd ?? t.foreground?.cwd ?? t.cwd ?? null, at: now };
        dirty = true;
      } else if (now - r.at > 3600000) { r.at = now; dirty = true; }
    }
    if (back.length) {
      cx.spawn(async () => {
        let n = 0;
        for (const b of back) {
          // Without HC_TERMINAL_ID: sent from inside a terminal, hc wraps the text as a message
          // from that agent (<hc from="t7">…</hc>), which a shell can't run.
          try { const res = await exec("env", ["-u", "HC_TERMINAL_ID", "hc", "send", b.addr, await resumeLine(b.r)]); if (res?.code === 0) n++; } catch {}
        }
        if (n) notify({ title: S.revived(n), body: S.revivedBody, level: "info" });
      });
    }
    if (dirty || c.unsaved) this.save(cx);
  }

  // Whether one of these tabs has its agent on its way back (a new shell its line isn't typed into
  // yet, or typed a moment ago): a restart, not an agent quit, so its task isn't closed meanwhile.
  coming(tabs) {
    return Boolean(this.c.coming) && tabs.some((tab) => this.c.coming.has(tab));
  }

  load(cx) {
    const c = this.c;
    // A load or a write a reload of the mod cut short counts as over after a minute.
    if (c.loading && Date.now() - c.loading < STUCK_MS) return;
    c.loading = Date.now();
    cx.spawn(async () => {
      let text = null;
      try { text = await readTextFile(FILE()); } catch {}
      // When this Mac started: `{ sec = 1795434657, usec = 975012 } Mon Nov 23 07:50:57 2026`.
      try { const m = /sec = (\d+)/.exec((await exec("sysctl", ["-n", "kern.boottime"]))?.stdout ?? ""); if (m) c.boot = Number(m[1]) * 1000; } catch {}
      let recs = {};
      try { const d = JSON.parse(text ?? "{}"); if (d && typeof d === "object" && !Array.isArray(d)) recs = d; } catch {}
      c.recs = recs;
      c.text = text;
      c.loaded = true;
    });
  }

  // One write at a time; a change while writing is written after.
  save(cx) {
    const c = this.c;
    c.dirty = true;
    if (c.writing && Date.now() - c.writing < STUCK_MS) return;
    c.writing = Date.now();
    cx.spawn(async () => {
      while (c.dirty) {
        c.dirty = false;
        const text = JSON.stringify(c.recs, (k, v) => (k === "settling" ? undefined : v), 1) + "\n";
        if (text === c.text) continue;
        try {
          await writeTextFile(FILE(), text, c.text);
          c.text = text;
          c.unsaved = false;
        } catch {
          // Changed under us (by hand): read it again; the next look writes.
          try { c.text = await readTextFile(FILE()); } catch {}
          c.unsaved = true;
          break;
        }
      }
      c.writing = false;
    });
  }
}
