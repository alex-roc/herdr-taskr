#!/usr/bin/env node
// A demo of taskr in the running Herdr window, for screenshots and trying it out:
// three made-up repositories and a plain folder in ~/taskr-demo, tasks in every status, and stand-in
// agents (scripts/fake-agent.sh) working, blocked on a question and done.
//
//   node scripts/demo.mjs          set it up (your tasks.json is put aside first)
//   node scripts/demo.mjs --adopt <tab id>   also show one of your real agent tabs as a demo task
//   node scripts/demo.mjs --clean  close the demo spaces, delete ~/taskr-demo, restore your tasks
//
// Nothing here touches your own spaces or repositories.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const ROOT = join(HOME, "taskr-demo");
const STATE = join(ROOT, ".demo.json");
const APP = process.env.HERDR_APP_HOME ?? join(HOME, ".config", "herdr-app");
const FILE = join(APP, "data", "taskr", "tasks.json");
const BACKUP = `${FILE}.before-demo`;
const AGENT = join(dirname(fileURLToPath(import.meta.url)), "fake-agent.sh");
const DAY = 86400000;

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const herdr = (command, args) => JSON.parse(sh("herdr-app", ["do", command, JSON.stringify(args)]));
// A local date n days from today (Stats and due dates go by the local day).
const day = (n) => { const d = new Date(Date.now() + n * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function clean() {
  if (existsSync(STATE)) {
    const { spaces = [] } = JSON.parse(readFileSync(STATE, "utf8"));
    for (const id of spaces) { try { herdr("space.close", { id, confirmed: true }); } catch {} }
  }
  if (existsSync(BACKUP)) renameSync(BACKUP, FILE);
  rmSync(ROOT, { recursive: true, force: true });
  console.log("Demo removed; your tasks.json is back.");
}

function repo(name, files, dirty = {}) {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); }
  sh("git", ["init", "-q", "-b", "main"], { cwd: dir });
  sh("git", ["add", "."], { cwd: dir });
  sh("git", ["-c", "user.name=Demo", "-c", "user.email=demo@example.com", "commit", "-qm", "Start"], { cwd: dir });
  for (const [f, text] of Object.entries(dirty)) writeFileSync(join(dir, f), text);
  return `~/taskr-demo/${name}`;
}

function agent(title, state, msg = "") {
  return ["env", `TITLE=${title}`, "sh", AGENT, state, msg];
}

function setup() {
  if (existsSync(ROOT)) { console.error(`${ROOT} exists: run with --clean first.`); process.exit(1); }
  const web = repo("acme-web", { "README.md": "# acme-web\n", "src/auth/login.tsx": "export {};\n" }, { "src/auth/login.tsx": "export const login = () => {};\n", "src/auth/callback.ts": "// wip\n" });
  const api = repo("acme-api", { "README.md": "# acme-api\n", "src/limits.ts": "export {};\n" });
  const book = repo("handbook", { "README.md": "# Handbook\n" });
  // A folder that's no repository: notes.
  const notes = "~/taskr-demo/notes";
  mkdirSync(join(ROOT, "notes"), { recursive: true });
  writeFileSync(join(ROOT, "notes", "ideas.md"), "# Ideas\n");
  const abs = (r) => r.replace(/^~/, HOME);

  const w1 = herdr("space.new", { folder: abs(web), tab: "Add OAuth login", argv: agent("Add OAuth login", "working") });
  const w2 = herdr("tab.new", { space: w1.space, name: "Pick a database", folder: abs(web), argv: agent("Pick a database", "blocked", "Sessions: Postgres or SQLite?") });
  const a1 = herdr("space.new", { folder: abs(api), tab: "Rate limiter", argv: agent("Rate-limit the public API", "done") });
  // An agent started on its own: a task with no plan, its turn finished.
  const b1 = herdr("space.new", { folder: abs(book), tab: "docs search", argv: agent("Try a search box for the docs", "done") });
  // A plain terminal in the notes folder: no task.
  const n1 = herdr("tab.new", { space: b1.space, name: "notes", folder: abs(notes) });
  // Acme's own space, in the folder above its two repositories: work for the whole project.
  const p1 = herdr("space.new", { name: "Acme", folder: ROOT, tab: "map services", argv: agent("Map the services across both repos", "idle") });
  // Optionally, a real agent tab of yours shown as a demo task (its real model and effort): --adopt <tab id>.
  const adopt = process.argv.includes("--adopt") ? process.argv[process.argv.indexOf("--adopt") + 1] : null;
  // Every other tab of yours goes in an archived task, shown nowhere: not tracked as demo tasks,
  // not in the screenshots. All of them: an agent that reports no state to Herdr (one resumed
  // after a restart can) has neither an app nor a status here, and a plain terminal would show
  // under No project.
  const demoSpaces = new Set([w1.space, a1.space, b1.space, p1.space]);
  const yours = JSON.parse(sh("herdr-app", ["ls"])).spaces.filter((s) => !demoSpaces.has(s.id))
    .flatMap((s) => s.tabs.filter((t) => t.id !== adopt).map((t) => t.id));
  writeFileSync(STATE, JSON.stringify({ spaces: [w1.space, a1.space, b1.space, p1.space] }));

  mkdirSync(dirname(FILE), { recursive: true });
  if (existsSync(FILE) && !existsSync(BACKUP)) copyFileSync(FILE, BACKUP);
  const now = Date.now();
  let n = 0;
  const task = (f) => ({ id: `demo${++n}`, project: null, folder: null, status: "next", rank: n, due: null, estimate: null, next_step: "", notes: "",
    issue: null, worktree: null, branch: null, tabs: [], created: now - (3 + n) * DAY, updated: now - DAY, done_at: null, agent_ms: 0,
    history: [{ s: "inbox", at: now - (3 + n) * DAY }, { s: f.status ?? "next", at: f.updated ?? now - DAY }], ...f });
  // Agent work over the last weeks, for Stats: [ms, turns] on some days, the same every run.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const work = (days, perDay, from = 0) => Object.fromEntries(Array.from({ length: days }, (_, i) => from + i)
    .filter((i) => i === from || rand() < 0.6).map((i) => [day(-i), [Math.round((0.3 + rand()) * perDay * 60000), 1 + Math.floor(rand() * 4)]]));
  // Older tasks, done and put away: the board doesn't show them, Stats counts them.
  const past = () => ["Add the health check", "Cache the session lookup", "Fix the date picker in Safari", "Retry failed webhooks",
    "Write the API reference", "Drop the old auth middleware", "Speed up the test suite", "Translate the handbook intro",
    "Log slow queries", "Tidy the README", "Add a status page", "Paginate the audit log"]
    .map((title, i) => task({ title, project: i % 3 ? "acme" : "book", folder: i % 3 ? (i % 2 ? web : api) : book, status: "done", archived: true,
      done_at: now - (1 + i * 2.3) * DAY, work: work(4, 25, Math.round(1 + i * 2.3)) }));
  const data = {
    version: 1,
    // No reminders: a demo isn't the time for notifications.
    settings: { wip: 6, stale_days: 3, agent: "claude", usage: false, reminders: false, revive: false },
    projects: [
      { id: "acme", name: "Acme", folders: [web, api] },
      { id: "book", name: "Handbook", folders: [book, notes] },
    ],
    tasks: [
      task({ title: "Add OAuth login", project: "acme", folder: web, status: "doing", due: day(2), next_step: "Wire the callback route", tabs: [w1.tab], agent_ms: 47 * 60000, estimate: "1d", work: work(6, 30) }),
      task({ title: "Pick a database for sessions", project: "acme", folder: web, status: "doing", tabs: [w2.tab], agent_ms: 12 * 60000, work: work(3, 15) }),
      task({ title: "Rate-limit the public API", project: "acme", folder: api, status: "review", tabs: [a1.tab], agent_ms: 33 * 60000, work: work(5, 20),
        issue: { number: 31, url: "https://github.com/example/acme-api/issues/31", body: "" } }),
      // Its agent ran yesterday and is gone: the detail offers Resume agent.
      task({ title: "Fix the flaky checkout test", project: "acme", folder: web, due: day(0), next_step: "Reproduce with --repeat 50",
        sessions: [{ app: "claude", id: "3f2c9a1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f", cwd: web, at: now - 20 * 3600000 }], agent_ms: 25 * 60000 }),
      task({ title: "Write the onboarding guide", project: "book", folder: book, due: day(4), estimate: "3h" }),
      task({ title: "Upgrade to Node 24", project: "acme", folder: api, rank: 99 }),
      // Waiting on someone: parked, back on the day to follow up.
      task({ title: "Pricing page copy", project: "acme", folder: web, status: "doing", snooze: day(2), waiting_on: "design", updated: now - 5 * DAY }),
      // In progress for days with nothing moving: its time shows in yellow.
      task({ title: "Split the billing module", project: "acme", folder: api, status: "doing", next_step: "Find the seams", updated: now - 5 * DAY }),
      task({ title: "Try a dark theme for the docs", project: "book", status: "inbox", snooze: day(3) }),
      // Parked: back in three days, and someday.
      task({ title: "Move the docs to MDX", project: "book", folder: book, status: "next", snooze: "someday" }),
      // A task for the whole project: its agent works across acme-web and acme-api.
      task({ title: "Share one auth client across web and api", project: "acme", next_step: "List where each repo calls auth" }),
      task({ title: "Import the old wiki", project: "book", folder: book, status: "inbox" }),
      task({ title: "Ship the v1.4 changelog", project: "book", folder: book, status: "done", done_at: now - 2 * 3600000 }),
      task({ title: "Rotate the API keys", project: "acme", folder: api, status: "done", done_at: now - 2 * DAY }),
      ...past(),
      ...(adopt ? [task({ title: "Polish the README", project: "book", folder: book, status: "doing", next_step: "Add a quick start", tabs: [adopt], agent_ms: 38 * 60000 })] : []),
      ...(yours.length ? [task({ title: "Your own tabs (hidden in the demo)", status: "done", archived: true, tabs: yours })] : []),
    ],
  };
  writeFileSync(FILE, JSON.stringify(data, null, 1) + "\n");
  herdr("space.select", { id: w1.space });
  void n1;
  console.log("Demo ready: three repos and a folder in ~/taskr-demo, 14 tasks (and 12 done earlier, for Stats), 4 stand-in agents. Clean up with: node scripts/demo.mjs --clean");
}

process.argv.includes("--clean") ? clean() : setup();
