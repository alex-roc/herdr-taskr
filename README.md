# taskr

**You plan. Your agents move the task. You close it.**
A light, local task manager for work done with coding agents, as a layout for the [Herdr app](https://herdr.dev):
projects → folders → tasks → the agents working on them, with what needs you first.

taskr was called tasker before 1.6. `./install.sh` moves an old install over: your tasks from `data/tasker`, your shortcuts from `layout:tasker`; `tasker.*` terminal labels are still read.

**[Website, tutorial and examples →](https://alex-roc.github.io/herdr-taskr/)**

![taskr: the Now list, an agent at work, and the task's detail](preview.png)

Herdr already shows every terminal and agent you run. taskr adds the layer above them: *what are
these agents for?* Each tab can belong to a task; a task knows its folder, due date and
next step, and sits where you dragged it; and the list tells you what to do next: answer the agent that's waiting, review what one
finished, or start the next task.

What makes it different:

- **Tasks follow their agents, and you have the last word.** A task moves to Doing when its agent
  starts working and to Review when it stops; only you mark it Done. No pipeline to configure.
- **Real planning, not just a list of agents.** Projects and folders, an order you set by dragging,
  due dates in plain words, a limit on what's in progress, and stalled work called out.
- **Light and local.** One mod and one JSON file you (or an agent) can edit. No service, daemon,
  account or extra CLI. GitHub and Linear are optional imports.

- [What you get](#what-you-get)
- [Install](#install)
- [Use it](#use-it)
- [Keys](#keys)
- [Your data](#your-data) · [For agents](docs/agents.md)
- [What it runs on your machine](#what-it-runs-on-your-machine)
- [Troubleshooting](#troubleshooting)
- [Tutorial](https://alex-roc.github.io/herdr-taskr/tutorial.html) · [Examples](https://alex-roc.github.io/herdr-taskr/examples.html)
- [Develop](docs/development.md) · [Recipe](RECIPE.md) · [Changelog](CHANGELOG.md)

## What you get

**Now**: one list, in the order things move forward:

| Section | What's in it |
|---|---|
| **Needs you** | Tasks whose agent is blocked, with the agent's question right in the row |
| **To review** | Tasks in Review, and tasks in Doing whose agent finished |
| **Working** | Tasks with an agent at work |
| **Up next** | Next, Doing and Waiting tasks, in the order you set: drag a row onto another |
| **Stalled** | Doing or Waiting tasks that haven't moved in a few days |
| **Inbox** | Ideas and imported issues, not yet planned |
| **Later** | Tasks you put off, folded: each comes back on its day (or *someday*: when you bring it back) |
| **Idle** | Agents started on their own (tasks with no plan) you've seen, waiting for a word from you, folded |

Under each row, and on each board card: where it is and how long its agent has been as it is
(`Acme › api · working 14m`). Where is the task's folder, else the one its terminal is in now,
else that folder (`General › ~` for a project's own space). An agent's question takes that line
when it needs you. Its model, effort and context are in the terminal's header and the detail.

Which status when: **Next** you'll do it, **Waiting** it depends on someone else, **Inbox** not decided,
**Dropped** you won't.

**What goes first is where you put it.** Drag a task onto another in Up next, the Inbox or a project
in Projects, and it takes that place (a line shows where it lands); drag an idea from the Inbox onto
Up next and it's planned. `t`, or *Move to the top* in its menu, puts it first. New tasks go last.

To put one off without changing what it is, use **Later** (right-click → *Later…*, `z`, or
the detail): tomorrow, next week or *someday* at a click, or a day you type (`fri`, `+3d`, `12-24`) or *someday*. On its day it
comes back with a notification. Once a day, a notification also tells you what's due or late
(*Reminders* in the settings turns both off).

**Tasks or terminals, the same flow.** Every agent is a task. When one starts in a tab with no task,
taskr makes a task *with no plan*, named after what the agent calls its work. A planned task is the
same thing with its plan filled in (next step, notes, due date…): *Plan it…* in the detail opens its
form. Change anything on a no-plan task and it's yours from then on.

A no-plan task is Doing while its agent works or asks, and in To review once it finishes. It leaves
To review as soon as you look at its terminal, or after the time you set (*To review, for tasks with no
plan* in the settings: 15 minutes, 1 hour, 4 hours, a day, or until you've seen it), and goes to
**Idle**, folded at the end of Now, while its agent stays open; it goes back to Doing when its agent
works again. When its agent quits (30 seconds after) or its tab closes (a minute after), it goes to
Done, and *Resume agent* picks it up. A planned task only goes
Done by your hand. *Done today* in the status bar doesn't count no-plan tasks. So you can work only
with terminals and agents and still get the list, the board, Later, the reminders and the resume after
a restart; and plan tasks with details (next step, notes, due date, issues, a worktree) when you want.

A terminal (a shell) isn't a task: it shows in Projects under its folder, or its project. A plain
terminal in no task has **Add to task…** in its menu. A task with tabs has **Move to task…**: it moves
its agent (tabs, conversations, agent time) into another open task, and the first task goes.

**Projects**: an outline of projects → folders → terminals and tasks. A folder is a git repository or not. A git
folder shows its branch, commits not pushed (↑) and uncommitted changes (•). From a folder: `›_` opens
a terminal there, `+` a task, and `⋯` (or right-click) starts any installed agent there, imports
GitHub or Linear issues, moves it to another project, removes it from its project, or closes its
spaces. A folder in a project is only a pointer: no terminal and no
task until you start something there. A project's row shows its actions while the pointer is on it: its board, a terminal and a task
for the whole project, and `⋯` (or right-click), its menu: board and new task; a terminal or any
installed agent across its folders; edit it, pause it, or close all its spaces. A **paused**
project waits folded under *Paused* at the end of Projects, and its tasks leave Now and the board of
every project, but for an agent that needs you or is working; *Make active* brings it back. A project
where nothing happens (no task changes, no agent works) pauses by itself after 3 days (*Pause quiet
projects* in the settings: 1, 3, 7, 14 or 30 days, or never), and comes back by itself as soon as
something does; one you pause stays paused. Work for the whole project
(its terminal, its agents, a task with a project but no folder) opens in the project's own space,
named after it, in the nearest folder holding all its folders (`~/dev` for `~/dev/a` and
`~/dev/b`; your home folder while it has none, or when they share nothing below it), and shows at the project's level, above its
folders. Drag a project's row onto another to reorder them. Its agent is told which
folders are the project's (any outside that folder is added with `--add-dir`, Claude Code and
Codex); a task in one folder of a bigger project hears of the others. Terminals show the same line as a task:
where they are and how long in their state. With no folder, a terminal opens in `~`.

**Each terminal's header** says what it's for: its task's title (else its program), the agent's
model · effort · context, its folder and state; split, zoom and close while the pointer is on it.
Click it to select its task.

**Board**: a kanban tab (`cmd-shift-b`, or the board button in Now) with Inbox, Next, Doing (with your
limit), Waiting, Review and Done (last 7 days). Drag a card to another column to change its status, or onto another card to put it there; click to open it,
right-click for its menu. Every board is a tab: **Board** for every project, and **Board · Acme** for
each project, with only its tasks and agents. The pills at the top (All · Acme · …) go from one board
to another, opening its tab the first time.

![The board](docs/board.png)

**Task detail** (right panel, when you want more: the panel button in the status bar, `cmd-i`, `i`
or *Details* in a task's menu; selecting a task never opens it, and it stays as you left it): status, the next step and notes; each agent with its
model, reasoning effort, context, turn and sub-agents, and the question it's waiting on; the last
lines of its screen; the changes in its folder, its pull request and CI checks (with *Ask for a pull
request* and *Send failed checks*); a box to **message the agent**; time in state and agent time
(and every status change, with *Activity in the details* on in the settings).

**Start agent** on a task opens your agent in the folder's space with the task (title, next
step, notes, issue) as its first message. **Start in a worktree** first creates the branch
`task/<name>` in `~/.herdr/worktrees/<repo>/<name>`, where Herdr's own worktree tools find it. It's offered only when the folder is a git repository.

Tasks follow their agents: when an agent starts working the task moves to **Doing**; when it stops,
to **Review**. Only you mark a planned task **Done**. **Delete** closes the task's tabs, and the agent in them, after the dialog says so. **Archive** puts its tabs away and can remove its
worktree (a branch with unmerged commits is kept).

**Resume agent**: taskr remembers the Claude Code or Codex conversation each task's agent was in.
After a restart, or once you closed its tab, *Resume agent* (or `r`) runs `claude --resume <id>` or
`codex resume <id>` in its folder, tied to the task again.

**Plan usage** in the status bar (off until you turn it on in the settings): `Claude 28% wk 34%`, `Codex 8% wk 12%`, amber from 70% and red
from 90%; hover for when each limit resets, click to look again.

Inspired by the task → worktree → review → ship flow of [Orca](https://github.com/stablyai/orca).

## Install

You need the Herdr app (0.1.13 or later). `git` is used for repository state and worktrees, and
`gh` (optional) for issues and pull requests.

**From the gallery**: find *taskr* at [herdr.dev/layouts](https://herdr.dev/layouts) and ask your
agent in Herdr to add it, or point it at this repository: *"add the layout at
github.com/alex-roc/herdr-taskr"*. Herdr's agents know how to install a shared layout.

**With the script**:

```sh
git clone https://github.com/alex-roc/herdr-taskr && cd herdr-taskr
./install.sh --keys    # the layout, its picture and theme, the mod, and its shortcuts
```

Then pick **taskr** in Settings → Look, or run `herdr-app do layout.switch '{"name":"taskr"}'`.
Your other layouts are untouched; switch back the same way.

- `./install.sh` alone skips the shortcuts. `--keys` adds a `layout:taskr` section to
  `keys.json` and never replaces a key you already bound there.
- Run it again to update. `./install.sh --uninstall` removes taskr and keeps your tasks.
- It copies instead of linking: Herdr only hot-reloads files saved inside its own folder.

**By hand**: copy `layouts/taskr.json` and `layouts/taskr.svg` to `~/.config/herdr-app/layouts/`,
`themes/taskr.json` to `~/.config/herdr-app/themes/`, and `mods/taskr/` to
`~/.config/herdr-app/mods/`. Check it with `herdr-app check ~/.config/herdr-app/mods/taskr`.

## Use it

1. **Add a project.** In Projects, the folder button makes one. *Add folder…* takes a repository, or a
   plain folder with no repositories inside, at once; pick a folder that holds several (`~/dev`) and its
   repositories are listed to tick, with a filter and *Add all*, or *Add <folder> itself*. Or drag a folder onto a project's header, or right-click it →
   *Move to project…*; its tasks go with it.
2. **Add tasks.** `n`, the `+` button, `+` on a folder, or *Import GitHub issues* / *Import
   Linear issues* from a folder's menu. A due date takes `today`, `tomorrow`, `fri`, `+3d`, `2w`,
   `12-24` or `2026-12-24`.
3. **Start an agent.** `l` (or ▶ on hover, or *Start agent* in the detail) starts your agent with the
   task as its first message; `w` does it in a new worktree. The new tab is tied to the task.
4. **Already working?** Your agents' tabs are tasks already, with no plan. Open one's detail and press
   **Plan it…** to give it a next step, notes or a due date.
5. **Work from Now.** Answer what needs you, review what's done (*Show changes*, the PR and its
   checks are in the detail), then press `space` to mark it done.

Settings (the gear in the status bar): Now and Projects as tabs or **stacked** (both at once, one
above the other, as Herdr's spaces and agents), how many tasks can be in Doing before the status bar
warns you, after how many days a task counts as stalled, which agent *Start agent* runs, how long a no-plan task stays in To review (*To review, for tasks with no plan*), after how many quiet days a project pauses by itself, whether
the detail lists every status change (*Activity*, off by default) and whether the status bar shows
plan usage. Stacked, `tab` moves the keys between the two lists; the chevron by a list's name folds
it to its header (the other takes the room), and a double click on the name gives it all the room.

**After a restart**: Herdr brings every terminal back, as a shell in its last folder. taskr
remembers which Claude Code or Codex conversation each one had (`data/taskr/terminals.json`), and
in a terminal that comes back as a fresh shell it types `cd <folder> && claude --resume <id>` (or
`codex resume <id>`), with a notification. Quitting an agent yourself isn't undone. *Agents after a
restart* in the settings turns it off. Agents that report no state to Herdr (Claude Code attached to
its background session with `claude attach`) still show as agents, with their model and context;
whether they work or stopped is read from their terminal's title.

**Linear** (optional): create a personal API key (Linear → Settings → Security & access → Personal
API keys) and either export it as `LINEAR_API_KEY` in your login shell profile or save it alone in
`~/.config/herdr-app/data/taskr/linear-key`. *Import Linear issues* lists your open issues assigned
to you, most urgent first, with their due date. taskr only reads from Linear.

## Keys

With `./install.sh --keys` (only while the taskr layout is shown):

| Key | Does |
|---|---|
| `cmd-j` | Move the keyboard to the task list |
| `cmd-k` | Find a task |
| `cmd-shift-n` | New task |
| `cmd-shift-o` | Switch Now ⇄ Projects |
| `cmd-i` | Show or hide the task detail |
| `cmd-shift-b` | Open the board |

In the list: `j`/`k` or arrows move, `enter` goes to the task's agent, `space` marks done (again: back
to Next), `t` to the top, `n` new, `e` edit, `l` start agent, `w` start in a worktree, `r` resume
its agent, `z` later, `i` details, `/` find, `tab` switches view. Clicking a task shows it and brings its agent's tab (or its
terminal) to the front. Right-click a task, a folder or a project for its menu.

From a script or an agent: `herdr-app do taskr.new`, `taskr.board`, `taskr.view`, `taskr.jump`,
`taskr.settings`, `taskr.linear` (import Linear issues), and `taskr.select:<task id>` (shows that task).

## Your data

Everything lives in `~/.config/herdr-app/data/taskr/tasks.json`: plain JSON that you, or an agent,
can edit. taskr reloads it within a second of a save, checks every field, and never writes over a
file it can't read (it shows what's wrong instead). It never goes in this repository.

```jsonc
{
  "settings": { "wip": 3, "stale_days": 3, "agent": "claude", "usage": false, "reminders": true, "activity": false, "review_after": 60, "pause_after": 3 },  // agent: a key from Herdr's agent menu; review_after: minutes in To review for no-plan tasks (0: until seen); pause_after: quiet days before a project pauses (0: never)
  "projects": [{ "id": "p1", "name": "Acme", "folders": ["~/dev/acme"], "paused": false }],
  "tasks": [{
    "id": "t1", "title": "Add OAuth login", "project": "p1", "folder": "~/dev/acme",
    "status": "next",            // inbox | next | doing | waiting | review | done | dropped
    "rank": 4,                   // its place in every list, lower first (set by dragging; leave it out: last)
    "due": "2026-11-20", "estimate": "2h", "next_step": "Wire the callback", "notes": "",
    "snooze": null,              // Later: "YYYY-MM-DD" (back that day) or "someday"
    "issue": { "source": "github", "number": 12, "url": "https://github.com/…", "body": "…" },  // Linear: "number": "ENG-12"
    "worktree": null, "branch": null,
    "auto": false,               // true: a task with no plan, made for an agent; any change of yours drops it
    "tabs": ["<herdr tab id>"], "agent_ms": 0, "history": [{ "s": "next", "at": 1794000000000 }],
    "sessions": [{ "app": "claude", "id": "<session id>", "cwd": "~/dev/acme", "at": 1794000000000 }]
  }]
}
```

Only `id` and `title` are needed for a new task; everything else gets a default. Old files with `repos`, `repo` or `deleted: true` are still read and rewritten as `folders` and `folder`, and deleted tasks are dropped. A task's tabs are
also labelled on their terminals (`taskr.task=<id>`, see `hc ls`; old `tasker.*` labels are still read), so a task finds its agents again
even if the file loses them. Agents that should add or move tasks: see **[docs/agents.md](docs/agents.md)**.

## What it runs on your machine

The mod runs these programs, only on your machine (or the machine a space lives on):

- `git`: read-only status and diffs, without taking locks; `worktree add`, `worktree remove` and
  `branch -d` only when you ask for a worktree or archive one.
- `gh`: `issue list` and `pr view`, when you import issues or look at a task in review.
- `hc` (Herdr's core): read an agent's last screen lines, send it your message, label terminals.
- `tail`, `grep` and `lsof`: to read the model, effort and context of Claude Code
  (`~/.claude/sessions`, `~/.claude/projects`) and Codex (`~/.codex/sessions`) from their own logs.
- `open` (`xdg-open` on Linux) for issue and pull request links.
- Your `claude` CLI, for a moment every 5 minutes while the window is in front, to ask for plan
  usage (`mods/taskr/bin/claude-usage.sh`): the CLI signs in by itself, taskr reads no token or
  credential file, and no prompt is sent. Codex's limits come from its own logs. Turn it off in the
  settings.

Its only request of its own goes to `api.linear.app`, and only when you open *Import Linear issues*.
Nothing else is sent anywhere. While the window is in the background, or the detail panel is closed,
it looks less often or not at all.

## Troubleshooting

- **The list says tasks.json can't be read.** The file has a JSON error (often a hand edit): fix
  it and save; taskr picks it up. Nothing was overwritten.
- **No model or effort on an agent.** Only Claude Code and Codex write them where taskr can read
  them. They appear after the agent's first reply.
- **A launched agent isn't tied to its task.** taskr looks for the new tab for 30 seconds. Use
  **Move to task…** on the tab, or add its tab id to the task's `tabs`.
- **Claude's usage shows `!`.** Hover it for the reason. taskr asks your `claude` CLI (`claude -p`
  with a usage request); an old CLI, or an account without plan limits, has nothing to report.
- **Resume agent doesn't appear.** taskr learns a task's conversation while its agent runs (Claude
  Code and Codex only); a task whose agent never ran under taskr has nothing to resume.
- **Changes in a mod file don't show up.** Run `./install.sh` again: Herdr doesn't reload a mod
  folder that is a symlink. `herdr-app status` lists any error.
- **Stuck in a broken layout.** `ctrl-alt-shift-escape` always goes back to Herdr's default layout.

## License

[MIT](LICENSE). Icons are [Lucide](https://lucide.dev) (ISC, `mods/taskr/icons/LICENSE`).
