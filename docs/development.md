# Developing taskr

## The loop

```sh
pnpm test            # or: node --import ./test/register.mjs --test 'test/*.test.mjs'
pnpm run check       # herdr-app check, once per role and dialog
./install.sh         # copy into ~/.config/herdr-app: Herdr reloads it at once
herdr-app status     # errors from the mod, if any
herdr-app shot x.png # the last frame (bring the window to the front first, or it may be stale)
```

There are no dependencies to install: the tests use Node's own runner (Node 22 or later).

## Layout of the code

```
layouts/taskr.json   Herdr's main layout with the task list, the detail column and a status bar
layouts/taskr.svg    the picture Settings shows for the layout
themes/taskr.json    the dark theme (light uses Herdr's paper)
mods/taskr/
  main.js             one mod, several roles by props: sidebar | detail | status | board | stats | dialog,
                      and pane (a terminal's header: Herdr's own { pane, terminal })
  sidebar.js          Now and Projects, and the bookkeeping (ties new tabs to tasks, moves tasks
                      as their agents work, adds up agent time); only the sidebar copy does it
  detail.js           the task panel; looks up screen, diff and PR only while shown
  board.js            the kanban tab
  stats.js            the Stats tab: a period and a project, tiles, a chart per measure, a table
  pane.js             each terminal's header: its task, its agent's model and context
  dialogs.js          task and project forms, menus, find, issues, archive, delete, settings
  strings.js          every word the person reads (translate this file to localize)
  lib/store.js        tasks.json: read, cleaned, compare-and-swap writes, file watch
  lib/flow.js         every rule that moves a task by itself (stage, turn, parked), as plain functions
  lib/world.js        joins tasks with Herdr's spaces, tabs, agents and terminals; Now and Projects
  lib/agentinfo.js    model, effort and context from Claude Code and Codex logs
  lib/git.js          repository state, read without locks
  lib/actions.js      start an agent, worktrees, archive, gh, links
  lib/cache.js        caches shared by every copy of the mod (globalThis)
  lib/usage.js        plan usage: Claude (bin/claude-usage.sh) and Codex (its logs)
  lib/stats.js        work per day (agent time, turns) and a period's summary, as plain functions
  lib/linear.js       Linear's assigned issues, for the import dialog
  bin/claude-usage.sh asks the claude CLI for usage (get_usage control request), no token read
  lib/open.js         opens dialogs with their sizes
  lib/ui.js           shared pieces: icons, chips, buttons, marks
test/                 Node tests with fake `herdr` and `gpui-kit` modules
scripts/              check.sh, demo.mjs, fake-agent.sh, gpui-methods.mjs
```

## Tests

`test/stubs/` fakes Herdr's modules: `herdr.js` holds a world you set (spaces, agents, terminals,
files, what `git`/`gh`/`hc` answer) and records what the mod does; `gpui-kit.js` builds element
trees that refuse what the app refuses (a `null` child, an element used twice, a method gpui-kit
doesn't have; the list is in `gpui-methods.json`, refresh it after a Herdr update with
`node scripts/gpui-methods.mjs`).

- `test/render.test.mjs` renders every role and dialog against a busy world
  (`test/fixture.mjs`), then fires every click, key and hover and renders again. It catches what
  `herdr-app check` can't: rows that only exist with data, async states and handlers.
- `test/logic.test.mjs` covers the rules: due dates, cleaning a hand-edited file, which tab is
  whose, the Now order, the rules of `lib/flow.js`, files from before, reading agent logs, lookups only
while shown.

`scripts/check.sh` runs Herdr's own `herdr-app check` on a copy of the mod per role and dialog
(`check` alone renders with no props).

## A demo in the real window

```sh
node scripts/demo.mjs          # 3 made-up folders in ~/taskr-demo, 14 tasks (12 more done earlier, for Stats), 4 stand-in agents
node scripts/demo.mjs --adopt <tab id>   # also one of your real agent tabs, as a demo task
node scripts/demo.mjs --clean  # closes the demo spaces, deletes ~/taskr-demo, restores your tasks
```

The stand-in agents (`scripts/fake-agent.sh`) report working, blocked (with a question) and done
through the Program Status Protocol, as real agents do:
`printf '\e]7501;state=blocked:kind=question:app=claude-code:msg=<base64>\e\\'`. This is how
`preview.png` and `docs/board.png` are made: no personal data in them. The demo covers a blocked, a
working and a finished agent, a task to resume, one parked until a day and one *someday*, one waiting
on someone, one in progress that hasn't moved for days, a task and a terminal
for the whole Acme project (its own space, `~/taskr-demo`), and reminders off (no toasts in shots).

Screenshots, with the window maximized (`herdr-app do window.maximize`, again to put it back: a window
in split view is half as wide) and the sidebar at 330px (`layout.resize {id: "sidebar", px: 330}`);
`herdr-app shot` gives a 2× frame (4480×2460 on a 4.5K display). The demo puts your own agents' tabs in an archived
task, so they're neither made into no-plan tasks nor drawn; its agents' addresses change every run
(find one by its tab's name in `herdr-app ls`).

- Bring the window to the front first (`osascript -e 'tell application "Herdr" to activate'`) or the
  frame is stale; two identical shots mean it was. That takes whoever uses the Mac to Herdr's desktop:
  say so first and take every shot in one go; to check behaviour, read files instead (`tasks.json`). Close a stray popup with `herdr-app do overlay.close`.
- Drive it with commands: `taskr.view`, `taskr.select:<id>` (opens the detail), `taskr.board`,
  `taskr.new`, `taskr.settings`, `taskr.jump`, `layout.select`/`layout.hide`, `pane.focus {terminal}`.
- `preview.png`, `site/img/overview.png`, `board.png` and `stats.png`: the whole frame at half size, with
  Now in the sidebar (Projects lists your own plain terminals under *No project*: they'd be in the shot).
  Lists: x 0–660 from y 80; cut Projects above *No project*. Detail: x 3746–4480 from y 84. Dialogs: their box (settings exactly, the form and the
  find box with a 20px margin); the form is a demo task's (*Edit task*), since *New task* lists the
  folders open on your Mac. Shots taken one after another can repeat a stale frame: activate the
  window before each one and compare them. Update `width`/`height` in `site/*.html` when a size changes.
- Find a dialog's box by its background (`#282b2e` in the dark theme) rather than by eye; the find
  box is 1040px wide at x 1720.
- Note what you changed (sidebar size, stack child, detail shown, `taskr.view`) and put it back
  after `--clean`.

## Things that tripped the build up

- A lost terminal (reboot, core crash, `kill -9` of its shell: try that on a test space) comes back
  at the same address, in the same tab, with the same `created_ms` and another `pid`, a shell in
  front. Herdr never runs its program again: `lib/revive.js` types the resume.
- Typed while a terminal is still being recovered (a Mac starting, a dozen terminals at once), the
  resume line can arrive twice: the shell runs one and Claude Code finds the other in its input
  box. `lib/revive.js` waits until the new shell has been in front 3 s. Shutting down quits the
  agents before their shells: only a shell alone for minutes means an agent quit by hand. While
  revive brings an agent back (`revive.coming(tabs)`), `follow` doesn't count its task's agent as
  quit, or a task with no plan would be closed as Done and reopened at every restart.
- To try a restart on one agent: `herdr-app do terminal.open` with `claude --model haiku "…"` in a
  scratch folder, wait for `terminals.json` to list it, then `kill -9` its pid (or its shell's).
- The window draws nothing while it's hidden or the screen sleeps, and mods run only when it draws:
  if `tasks.json` and `terminals.json` stop changing and `herdr-app shot` repeats an old frame,
  that's why, not a bug.
- `hc send` from inside a terminal (with `HC_TERMINAL_ID` set) wraps the text as a message from that
  agent, `<hc from="t11">…</hc>`: a shell can't run it. Clear the variable to type a command.
- Herdr's `app` on a pane can linger after its agent quits (a zsh still says `claude-code`), and
  `claude attach` reports no state with `program.agent: false` (key `claude`): decide by the
  program in front, a shell being no agent. Claude Code marks its title (◐◑ working, ✳ idle), but
  `terminals()` and `panes()` hand mods the title without the mark: `hc get` has it.

- Dragging is three handlers, no drag API: `on_mouse_down` marks what's held, `on_mouse_move` over
  another row or card marks the target (and draws the line), `on_mouse_up` there drops. The target
  calls `cx.stop_propagation()` so its container's own `on_mouse_up` (a board column's drop, the
  list's "drag is off") doesn't run too; a card's `on_mouse_move` stops it as well, or the column
  under it would take the target back.
- One handler per event on an element: when one element takes two kinds of drag (a project
  header: projects to reorder, folders to move in), branch inside a single `on_mouse_move`
  and `on_mouse_up`. The test stub keeps only the last handler of each kind.
- A new tab can show up in `spaces()` a look before its terminal is in `terminals()`. Labelling
  its terminals (`taskr.project`) then finds none and the label is lost: keep the pending launch
  (with its tab) until the terminal is there. `space.new` and `tab.new` take no labels.
- Herdr keeps terminals alive when the app quits or updates (herdr-core holds them), but after a
  reboot or a core crash a terminal comes back as a bare shell: its program is never run again.
  So agents back after a restart are taskr's doing (`lib/revive.js` types `claude --resume <id>`),
  not Herdr's; checked with Herdr 0.1.15 / hc 0.1.21. Before removing it, look at the shell's
  children (`ps`): a `claude --resume` started a few seconds after the shell is revive.
- Herdr doesn't hot-reload a mod folder that is a symlink: install by copying.
- A pane header is a mod Herdr draws once per pane with `props()` = `{pane, terminal}`: the layout
  names it with no props of its own (`{"mod": "taskr"}`), and `main.js` takes `pane` for that role.
- `layout.resize {id, px}` sizes a block and Herdr keeps it in `layouts/.state/<layout>.json`;
  `{id, weight}` with the file's own weight drops what it kept. Folding a stacked list is that.
- In a menu, a dim label beside small choices reads as a disabled item: people click the label. Make
  every action a plain item, and put its choices in the dialog it opens (Later went this way).
- `child(null)` throws in gpui-kit, and so does using an element twice. `false` is fine.
- Every copy of the mod (sidebar, detail, status bar, board, each dialog) runs its own `init` and
  `render`, but they share `globalThis`: caches of agent info, repository state and "since when"
  live there (`lib/cache.js`) so each is looked up once.
- Closing an overlay drops that copy of the mod, and what it spawned and hadn't finished never
  runs. A dialog writes first and closes after: `this.closeAfter(cx, work)` in `dialogs.js`. The
  test stub does the same (`cx().spawn` in `test/fixture.mjs` skips work once its overlay is closed).
- Every redraw of a mod redraws the whole window, terminals included: a lookup redraws only when
  what it found changed (`cx.notify()` behind a comparison), and timers look without drawing.
- Several lists can be on screen (Now and Projects stacked). Key commands reach every shown copy:
  only one list acts, Now when both show (`isFirstList`); the test stub delivers a command to every
  waiting copy, as Herdr does. Bookkeeping state (`workSince`, `prevTop`) lives in
  `sharedCache("books")`, so whichever list draws first records a change once. A stack shows one
  child: `onScreen` and `shownLists` in `lib/ui.js` follow its `active` one.
- `layout()` reflects nodes hidden by clicks (`hidden: true`): `onScreen(id)` in `lib/ui.js`.
- `terminals()` doesn't always carry `status_ms`; tabs carry `working_since` and `changed_at`.
- Claude Code transcripts hold multi-megabyte lines (pasted images): grep the fields from the last
  4 MB (16 MB if needed) with `LC_ALL=C` instead of parsing JSON lines.
- `hc read` output has `[hc] …` notes: drop them.
- The `tabs` mod re-hides the `panel` column per space, so the detail is its own column.
- `herdr-app shot` returns the last frame; with the window in the background it can be stale.

## The website

`site/` is the GitHub Pages site (https://alex-roc.github.io/herdr-taskr/): plain HTML and CSS, no
build. `.github/workflows/pages.yml` publishes it on every push that touches `site/`. Its pictures
in `site/img/` come from the demo (`scripts/demo.mjs`), cropped; never from your own spaces. Preview
it with `python3 -m http.server -d site 8765`.

## Publishing

The repository is laid out as herdr.dev expects a layout: `layouts/taskr.json`, `mods/taskr/`,
`RECIPE.md` and `preview.png` at the root, and the GitHub topic `herdr-layout`. herdr.dev picks it up
within the hour. Before a release: tests, `scripts/check.sh`, a new `preview.png` from the demo if the
look changed, and a line in `CHANGELOG.md`.
