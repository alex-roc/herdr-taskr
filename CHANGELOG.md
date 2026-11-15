# Changelog

## 1.7.8 — 2026-11-15

### Fixed
- **A task with no plan follows its agent to every folder, not just the first.** One whose agent
  began in a folder (your home, say) kept it: quit the agent, `cd` into another folder and start a new
  one in the same tab, and the task still read *~*. Its folder is now its agent's whenever that
  changes (at the project's own place, project-wide again). A task you moved by hand is yours and
  stays put.

## 1.7.7 — 2026-11-15

### Changed
- **Finished holds only the turns you haven't decided on.** A task whose agent stopped stayed under
  Finished whatever you did with it: moving it to Next, to do it later, changed nothing on screen.
  Now a stage changed after its agent's turn ended puts it in that stage's section (Next is then the
  list of what's pending), until its agent finishes another turn.
- **A stage chosen brings back a task parked until its agent works.** Parked by *Park idle agents*,
  a task moved to Next stayed in Later. Now any stage chosen unparks it (a day you set stays), and a
  task you decided on isn't parked again while its agent stays idle: it isn't waiting for you.
- **Settings in groups**, in two columns that fit without scrolling (Now and lists, Limits, Status
  bar, Notifications and details, Agents), with
  more times to park idle agents (1, 2, 4, 8 hours, 1, 2, 3 days, a week) and to pause quiet projects
  (12 hours to 30 days).
- **Stacked, Now and Projects no longer repeat icons**: find, the board and Stats are in Projects'
  header, Now keeps its +.
- **The board puts parked cards last** in their column, and its project pills, like Stats', stay in
  one row that scrolls sideways instead of spilling onto the cards.

### Added
- **What the status bar shows**, in the settings: done today, in progress, working, open tasks (the
  tasks that need you always show).

## 1.7.6 — 2026-11-15

### Added
- **An agent that isn't reporting says so, and restarts in one click.** A Claude Code that missed the
  terminal's answer about status reports as it started (see 1.7.5) stays silent for the whole session.
  After a minute its row says *not reporting*, and its card in the detail offers **Restart** once it's
  stopped: it quits (`/exit`) and comes back in the same conversation, in the same terminal.
  `claude attach` never reports, by design, and isn't flagged.

## 1.7.5 — 2026-11-15

### Fixed
- **An agent started in a project's tab after a `cd` goes under that folder.** Open a terminal for a
  project, make a folder and start an agent in it: its task stayed at the project's level and read
  *~/dev*, the folder the terminal began in. Where an agent works is now read from the agent itself,
  and a task with no plan and no folder takes it (one at the project's own place stays project-wide).
- **An agent that reports no state still turns Finished.** Claude Code asks the terminal, as it
  starts, whether it takes status reports; with no answer in time it reports nothing for the whole
  session, and taskr read its title, which only tells working from stopped: it never showed as
  finished. A stop while you look elsewhere is now *finished* (green) until you look at it, as
  Herdr's own reports are.
- **After a restart, agents are typed back one at a time**, two seconds apart: a dozen starting at
  once is when they miss that answer.

### Added
- **Add to project** on a folder row that shows only for its tasks (an agent started in a new
  folder): it keeps the folder in the project once they're gone.

### Changed
- **Done counts every task, planned or not.** *Done today* in the status bar and Stats' *Done* left
  out the tasks with no plan, so working only with agents always read 0 done. Now they count like any
  other (dropped tasks still don't), and *Worked on* no longer sets them apart with "N with no plan".
  What still sets a task with no plan apart is only what it lacks a plan for: it's named after its
  agent and it's done when its agent quits.

## 1.7.4 — 2026-11-15

### Changed
- **Park idle agents parks any task, planned or not.** Every agent is a task: one you gave details to
  and one you didn't are parked alike after their agent waits for you that long, so two sessions
  idle as long no longer end up one in Finished and the other in Later.

## 1.7.3 — 2026-11-15

### Fixed
- **Agents back after a restart, once.** A Mac starting brings a dozen terminals back at once, and a
  resume typed while a terminal was still being recovered could arrive twice: the agent came back
  with the same `cd … && claude --resume …` line waiting in its input box. The line now waits until
  the new shell has been in front a few seconds.
- **A conversation is no longer forgotten on shutdown.** Shutting down quits the agents before their
  shells, and a shell alone for ten seconds was taken as an agent quit by hand: that terminal came
  back as a plain shell. Only a shell alone for two minutes counts as that now.
- **A task with no plan isn't closed and reopened by a restart.** Its agent gone while the terminals
  came back, it was marked Done and opened again seconds later, leaving a stray Done in its history.
  A task whose agent taskr is bringing back now waits for it.
- The list of conversations to resume is read and written again after the mod reloads in the middle
  of either.

## 1.7.2 — 2026-11-14

### Fixed
- **The status bar's *N working* counts as Now does**: open tasks whose agent works. It counted
  every agent at work in any tab, a task's sub-agents and the agents of archived tasks too, so it
  could say 3 with one row under Working.

## 1.7.1 — 2026-11-14

### Fixed
- **Stats**: over 7 days the bars sat bunched on the left while the first and last dates went to the
  edges. Each day now has its own slot across the width, with its date under it over a week (the
  first and last over 30 or 90 days), and the four numbers at the top are the same height.

- **Pull requests only for a task with its own branch.** The detail no longer offers *Ask for a pull
  request*, nor asks `gh`, for a task worked on in its folder's own branch (main, say): only one
  started in a worktree has a PR and checks to show, as with Review when its PR opens.

### Docs
- New screenshots for 1.7 (Now, Projects, the board, the details, the form, find, settings, stacked
  lists) and one of Stats, now on the site and in the tutorial. The demo keeps some weeks of agent work
  and tasks done earlier, so Stats has something to show.

## 1.7.0 — 2026-11-14

**One language for tasks: three questions, three owners.** A task's **stage** (Inbox, Next, In progress,
Review, Done) is where the work is, and you set it. Its agent's **turn** (Working, Needs you,
Finished, Idle) is what the agent is doing now, Herdr's own words, never kept. **Parked** says when it
comes back. The turn no longer writes the stage, but for an agent starting work (In progress): a
finished turn isn't a finished task.

### New
- **Stats**: a tab (the chart button in Now, *Stats* in a project's menu, `taskr.stats`) with today
  or the last 7, 30 or 90 days, for every project or one: tasks done, tasks worked on (those with no
  plan counted like any other), agents' turns and agent time, a chart per day for agent time and one
  for done tasks, and a table by project. Agent time and turns are kept per day from now on (`work`
  on each task); done tasks count backwards from their history.

### Changed
- **A task no longer goes to Review when its agent stops.** It stays in progress (its agent Idle once
  you've seen it) until you say it's ready: *Ready for review* in the detail or the menu, or an agent
  writing it in the file. An agent working on a task in Review leaves it there (fixing what you found
  is part of the review). If you work with pull requests, a PR opened for a task with its own worktree
  branch moves it to Review; nothing else asks `gh` in the background.
- **Now follows one rule**: what the agents ask of you first (*Needs you*, *Finished*, *Working*),
  then the stages (*To review*, *In progress*, *Next*, *Inbox*), then *Later*. *Up next* is *Next*.
  *Finished* is new: agents that finished their turn and wait for a word from you, the ones you haven't
  seen first (in bold), then the Idle ones. *In progress* shows work under way with no agent working or
  waiting for you.
- **Doing is called In progress** (still `doing` in the file): "in progress" isn't "being done right
  now", which is *Working*. The limit (`In progress 2/6`) is in the status bar and on the board.
- **Stalled is no longer a section**: a task in progress that hasn't moved for days shows its time
  in yellow on its row (`in progress 5d`). The setting *Stalled after* is *Days without movement*.
- **Waiting is no longer a stage, but a way to park**: *Waiting on…* (the menu or the detail) takes who
  and a day to follow up (three days unless you type another); it comes back by itself, with
  *Follow up with Ana* as its next step if it had none. The board has five columns.
- **Dropped is Done with an outcome** (✗): still picked like a stage, out of the board and of *Done
  today*.
- **Idle is no longer a section**: Idle is the agent's turn (seen, waiting for you), and a no-plan
  task whose agent is idle stays in progress (under Finished), counted for the limit. *Later…* has *Until its agent works*,
  and *Park idle agents* in the settings (1 hour, 4 hours, a day; off by default) does it by itself,
  in place of *To review, for tasks with no plan*.
- **A parked task leaves the in-progress count**, in the status bar, in Now and on the board.
- A task with no plan is made in progress (it used to be Next, Review or Idle as its agent was). When
  its agent quits it's Done (one in Review stays there); either way its tab is a terminal
  again (`zsh · folder`), and an agent started in it again takes the same task back up.
- An agent's question reads *needs you 3m* (was *waiting 3m*, which clashed with the Waiting status).
- One vocabulary everywhere: the task form's *Status* is *Stage*, Later's button is *Park* (was *Put
  off*), and the words that went (Up next, Stalled, Idle as a section, Waiting as a status) are gone
  from the app, the docs and the site.
- **Projects is an outliner.** A folder dragged onto another takes that place (a line shows where
  it lands): it reorders a project's folders, or moves one into another project at that spot; onto a
  project's header it goes last there. A task dragged onto a folder, a project's header or a task in
  another folder moves there (one with a worktree stays with its folder). What's dragged is dimmed with
  what's in it, and letting go no longer folds the row. It used to move only onto a project's header,
  with no sign of where.
- Projects' header has no `+` any more: tasks are made in their project or folder (their own `+`),
  or from Now. No eye either: done tasks are on the board (Projects still shows a closed task while
  its terminal is open).
- **A project's row glows under the pointer**, as Now's rows do, and its actions read task, terminal,
  board, menu (a folder's: task, terminal, menu). The green line that could show over the projects
  without dragging is gone: a press becomes a drag only once the pointer moves, a press whose release
  went to a menu expires, and leaving the list ends a drag.
- **Start with…** (beside *Start agent* in the detail, and in the task's menu) picks the agent, its
  model and reasoning effort, and a worktree; the task keeps them for its next starts (`agent`,
  `model`, `effort` in tasks.json). The project and folder menus no longer list every installed
  agent: a terminal, and agents from tasks. *Start in a worktree* moved into it (`w` still does it).
- **The task form asks only what it doesn't know**: from a project or a folder it says where ("New
  task · Acme") and leaves the project out; editing never moves a task to another project (drag it in
  Projects); a new task starts in Inbox or Next.
- Quiet projects pause after a day by default (it was 3).
- One rule for dimmed rows, in Now, Projects and the board: closed or parked, unless its agent
  works or asks for you.

### tasks.json
- Status is `inbox`, `next`, `doing`, `review` or `done`; a dropped task has `outcome: "dropped"`.
  Parked tasks have `snooze` (`YYYY-MM-DD`, `someday` or `agent`) and, when waiting on someone,
  `waiting_on`. A no-plan task whose agent quit has `freed`. The setting `review_after` is now
  `park_after`.
- Files from before are read as they were meant: `waiting` as in progress, parked waiting on someone (back
  three days after it began waiting), `dropped` as Done with its outcome, an Idle task with no plan as
  parked until its agent works, and `review_after` as `park_after` (an hour stays an hour; *always*
  is never).
- The rules that move a task by themselves live in one module, `lib/flow.js`, with their tests.

## 1.6.0 — 2026-11-14

**tasker is now taskr** (herdr-taskr). `./install.sh` moves an old install over: it removes the
old mod, layout and theme, carries the `layout:tasker` shortcuts to `layout:taskr`, and shows the
new layout; your tasks come from `data/tasker` on first start (that folder is left as it was), and
terminals labelled `tasker.task` / `tasker.project` are still read. Commands are `taskr.*`.

### Changed: one model
- **Project → folder → terminals and tasks.** A folder is any folder, a git repository or not
  ("repository" is "folder" everywhere). A terminal is not a task; **every agent is one**: a task
  with no plan, named after its agent, from the moment it starts. Fill in its plan when you want
  (*Plan it…* in the detail); planned tasks start agents as before.
- Gone: the *Track agents automatically* setting, *Not in a task* in Now, *Make task*, and the
  board's *No task* lane.
- **A task with no plan looks after itself**: out of *To review* after the time set in *To review,
  for tasks with no plan* (15 min, 1 h, 4 h, 1 day, or always), to a new folded *Idle* section while its agent stays open, and back to Doing when the agent works again;
  Done when its agent quits or its tab closes (it used to vanish), resumable from there. *Done today* counts only the tasks you closed.
- **Delete closes the task's tabs**, agent included (the dialog says so), and the task leaves the
  file; older files' deleted tasks are dropped. A tab whose task was deleted used to stay out of
  every task for good.
- **Quiet projects pause by themselves**: no task changed and no agent at work for a day (*Pause
  quiet projects* in the settings: 1, 3, 7, 14, 30 days or never), and they come back by themselves at
  the next sign of life. A project you pause stays paused.
- **Move to task…** (a task's menu) moves its agent, conversations and agent time into another task.
- tasks.json: projects have `folders` (was `repos`) and tasks a `folder` (was `repo`); the old keys
  are still read. New setting `review_after`; `track` is gone.
- The project form adds a plain folder (no repositories inside) at once, and a folder of
  repositories can go in itself. *Start in a worktree* only shows for a git repository.

### New
- **Pause a project** (its menu, or its form): it waits folded under *Paused* at the end of Projects,
  and its tasks leave Now and the board of every project, but for an agent that needs you or works.
  *Make active* brings it back.
- **Fold a stacked list**: the chevron by *Projects* or *Now* folds it to its header and the other
  takes the room; a double click on a name gives that list all of it.
- **Add repositories straight from a folder**: in the project form, *Add folder…* takes a repository
  at once, or lists the repositories inside a folder (`~/dev`) to tick, with a filter and *Add all*.
  The form shows only the project's repositories, each with ✕, and fits a long list.
- **Remove a repository from its project** from its menu; its tasks stay in the project.
- **Drag a repository (or a folder, such as `~` under No project) onto a project's header** to move
  it there; the project is lit while it's under the pointer. *Move to project…* in its menu does the
  same. Its tasks go with it.
- **Each terminal's header says what it's for**: its task's title (else its program), the agent's
  model · effort · context, its folder and state. Split, zoom and close while the pointer is on it;
  a click selects its task. The tasker layout draws it in place of Herdr's own `pane` header.

### Changed
- **Projects have an icon, not a color**: the color picker and the colored squares (Projects, board
  pills and cards, menus) are gone: a project shows `layers` (a stack of repositories), a repository a
  folder. A `color` already in the file is left alone.
- A repository's menu moves it with *Move to project…*, a list that fits any number of projects,
  instead of a row of small names.
- **A row's second line says where it is**: *project › repository* (or the folder) and how long its
  agent has been as it is, in Now and on the board's cards, for tasks and terminals alike. A task
  that names no repository shows the one its terminal is in (a task of a project's own space, its
  agent in `~/dev/ai-editor`: `General › ai-editor`), else that folder (`General › ~`). The repository leaves the right of
  the title, which gets the room. Model, effort and context moved to the terminal's header (and stay
  in the detail). An agent's question still takes that line when it needs you.

- A project's own work opens in the home folder when its repositories share nothing below it (it
  used to take the first repository's folder).

### Fixed
- **A terminal opened for a project could land under No project**: its tab was labelled for the
  project only if its terminal was already there when the tab appeared. It now waits for it (a
  minute at most). A project's space is also recognised by its name in a folder that's no repository
  (`~`), so one opened before the project had repositories stays in it.
- **Later looked disabled** in a task's menu: a dim "Later" label beside small choices. It's now a
  plain item, *Later…* (`z`), that opens its dialog with Tomorrow, Next week and Someday at a click,
  or a day you type.

## 1.5.1 — 2026-11-08

### Fixed
- A terminal's task stayed in Now after you quit its agent (`/exit`), its tab still open: a light
  task now goes 30 seconds after its agent quits, not only when its tab closes. After a restart the
  agent is resumed first, and its task comes back with it. An agent Herdr still lists after it quit
  (its shell back in front) no longer counts as one anywhere, so the shell isn't made a task again.

## 1.5.0 — 2026-11-08

### Changed
- **What goes first is where you put it**: priorities (P1–P3) are gone. Drag a task onto another in
  Up next, the Inbox, a project in Projects or a board column and it takes that place (a line shows
  where it lands); from the Inbox onto Up next it's planned too. `t`, or *Move to the top* in a
  task's menu, puts it first; new tasks go last. A file from before keeps its order; a task an agent
  writes goes last, or first with `"priority": "high"`. Rows and cards lose the P chip.
- The detail's **Activity** (every status change) is off by default: *Activity in the details* in the
  settings shows it. How long the task has been in its status still shows.
- New screenshots for the README and the website, without priorities and with the new setting.

## 1.4.0 — 2026-11-08

### New
- **Tasks or terminals, the same flow**: every agent's tab is a task from its start, a light one
  named after what the agent calls its work, following it (Doing, Review) on the list, the board and
  in Projects. Change anything on it and it's yours; untouched, it goes away with its tab. Work only
  with terminals and still get the board, Later, reminders and the resume after a restart. *Track
  agents automatically* in the settings (on by default) turns it off.
- **Reorder projects** by dragging one's row onto another in Projects; the board's pills and the
  task form follow the same order.
- A project with no repositories yet has its terminal, agents and project tasks too, in its own
  space in the home folder.
- **Agents after a restart**: Herdr brings terminals back as shells after a reboot; tasker types
  each one's Claude Code or Codex resume into it (`cd <folder> && claude --resume <id>`), with a
  notification. Quitting an agent yourself isn't undone. On by default, off in the settings.

### Changed
- New screenshots for the README and the website (light tasks, the new settings); the board's *No
  task* lane only shows with tracking off. The settings dialog fits every option.

### Fixed
- Claude Code attached to its background session (`claude attach`) reports no state to Herdr, so its
  tab showed nowhere in Now: an agent program in front counts as an agent, working or idle as its
  terminal's title says, with its model and context read from its transcript.

## 1.3.0 — 2026-11-08

### New
- **A board per project**: every board is a tab, "Board" for every project (`cmd-shift-b`) and
  "Board · Acme" for each project, with only its tasks and agents. The pills at the top go from one
  board to another (opening its tab the first time) instead of filtering in place.
- **A project's actions where you look for them**: while the pointer is on a project's row, its board,
  a terminal, a task and its menu show in place of its count. The menu is grouped: plan (board, new
  task), work across its repositories (terminal, agents), manage (edit, close). The header of
  Projects drops its board button: each project's row has its own (Now keeps the board of every
  project).

### Changed
- The settings dialog is taller, so every option shows without scrolling.
- New screenshots for the README and the website (Later, project-wide work, stacked lists, the new
  settings); the demo covers them.

## 1.2.1 — 2026-11-08

### Changed
- Work for a whole project (its terminal and agents, a task with a project but no repository) opens in
  the project's own space, in the nearest folder holding all its repositories (`~/dev`), instead of
  its first repository, and shows at the project's level, above its repositories (its terminals are
  labelled `tasker.project=<id>`). *Close project* closes that space too.

## 1.2.0 — 2026-11-08

### New
- **Later**: put a task off until a day (tomorrow, next week, `fri`, `+3d`, …) or *someday*, from its
  menu, the detail or `z`. It leaves Now's lists for a folded *Later* section and comes back on its
  day; an agent that asks for you still shows. Starting, finishing or dropping it ends the wait.
- **Reminders**: a notification when a task comes back from Later, and once a day for what's due or
  late; clicking it shows the task. On by default, off in the settings. `tasker.select:<id>` (scripts,
  notifications) opens the detail on that task.
- **Now and Projects stacked**: a setting shows both lists at once, one above the other (as Herdr's
  spaces and agents), or one with tabs as before. The layout holds both in a `tasker-lists` stack; a
  list block takes `"view": "now" | "projects"` in its props for layouts of your own. Projects is
  on top, Now below; `tab` moves between them, and Now takes the layout's keys.
- **Projects as a place to work**: a project has its own terminal, task and menu. An agent for the
  whole project (from its menu, or on a task with a project and no repository) starts in its first
  repository with the others added (`--add-dir`: Claude Code and Codex) and is told which they are;
  a task in one repository of a bigger project hears of the others.
- **Close a repository or a project**: from its menu, with one question, closes its spaces in Herdr.
- Terminals and agents in no task show the same second line as a task: model, effort, context, and
  how long in their state.
- **Add folder…** in the project form: attach any local repository, not only those open in Herdr.

### Changed
- **The task panel stays as you leave it**: selecting a task no longer opens it. Open it when you
  want more with the panel button in the status bar, `cmd-i`, `i`, or *Details* in a task's menu
  (a card clicked on the board still opens it). Picking a task in Find goes to its agent, as a click.
- A finished agent sends its task to *To review* only from Doing: a task you put in Next, Waiting or
  Inbox stays there.
- **Plan usage is off by default** (it starts your `claude` CLI for a moment every few minutes); turn
  it on in the settings.
- Right-clicking a project opens its menu; *Edit project…* is in it.
- **Lighter on the window**: every redraw of a mod redraws the whole window, so tasker now redraws
  only for news. The detail panel looks again every 15 s without drawing, and draws only when the
  screen, diff or PR changed; it doesn't read an agent's screen while its terminal has the focus
  (you're typing in it). Agent info, repository state and plan usage redraw only when they changed.
- Clicking a task in the list (Now or Projects) brings its agent's tab to the front, or a terminal of
  the task when it has no agent.

### Fixed
- **Delete task** didn't delete, and the same with the other actions of the task menu (status,
  priority, Start, Resume), *Move to project* in a repository's menu, *Make task* on an agent in no
  task and *Add to task…*: the dialog closed before it wrote, and closing drops its work.
- A change made in the detail panel (priority, status, …) showed only after something else moved:
  the copy of the mod that wrote a change now redraws too.
- The task form says what *Notes* is for (context and instructions the agent gets with the title),
  with room for more of it.

## 1.1.0 — 2026-11-07

### New
- **Plan usage in the status bar**: Claude Code's and Codex's 5-hour and weekly limits, amber from
  70% and red from 90%, with reset times on hover. Asks your own `claude` CLI (no token read, no
  prompt sent) and reads Codex's logs. Can be turned off in the settings.
- **Resume agent**: each task remembers its Claude Code or Codex conversation; after a restart,
  *Resume agent* (or `r`) continues it in its folder, tied to the task.
- **Agents in no task**: a *Not in a task* section in Now, *Add to task…* to tie one to an existing
  task, and a *No task* lane on the board to drag one onto a column.
- **Linear**: *Import Linear issues* brings your open assigned issues into the Inbox with their
  priority and due date (personal API key from `LINEAR_API_KEY` or a key file).
- **Website** with a tutorial and examples: https://alex-roc.github.io/herdr-taskr/

### Fixed
- Tasks with the same id in `tasks.json` (two entries made in the same second) are told apart.

## 1.0.0 — 2026-11-07

First public release.

### New
- **Now, Projects, Board and a task detail** over Herdr's spaces, tabs and agents, with model,
  reasoning effort and context for Claude Code and Codex agents.
- **Settings** (gear in the status bar): Doing limit, days before a task counts as stalled, and the
  agent *Start agent* runs (installed ones only).
- **Due dates in words**: `today`, `tomorrow`, `fri`, `+3d`, `2w`, `12-24`, with the date it means
  shown as you type.
- **Delete asks first**; menus have icons; the task and project forms keep their buttons in view.
- **`tasker.select:<id>`** and **`tasker.settings`** commands, for scripts and agents.
- **`./install.sh --keys`** merges the shortcuts without replacing yours; the layout has a picture in
  Settings.
- **docs/agents.md**: how agents can add and move tasks safely.

### Fixed
- A hand-edited `tasks.json` with an unexpected value (a due date like "next week", a missing title,
  a stray entry) no longer blanks the list and the board: every field is checked on read.
- A `tasks.json` with a JSON error is never written over.
- Pressing Enter twice in the task form no longer creates the task twice.
- Two agents started in the same space at once are each tied to the right task.
- Two tasks with the same title get their own worktree branch.
- Tabs outside a task are named after what runs in them (`zsh · acme-web`), not their address.
- The sidebar, the board and the detail agree on how long an agent has been working.
- The board's columns fit the window instead of running off its edge.
- "No project" counts the terminals under it.
- Issue and pull request links open on Linux and Windows too.
- Model and effort of agents on another machine are read from that machine's home.

### Faster
- Agent logs and repository state are read once for every view, not once per view.
- The detail panel stops reading the screen, the diff and the PR while it's closed.
- Repositories are looked at side by side.
