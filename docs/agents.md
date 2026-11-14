# taskr for agents

How a coding agent (Claude Code, Codex, any program with a shell) can read and change the person's
tasks. Paste this into an agent's instructions, or point it here.

## Where the tasks are

`~/.config/herdr-app/data/taskr/tasks.json` (or `$HERDR_APP_HOME/data/taskr/tasks.json`). The
layout reloads it within a second of any save, from any program.

## Rules

1. **Read, change, write the whole file**, and keep every field you don't touch. Write to a temporary
   file next to it and rename it over `tasks.json`, so nobody reads half a file.
2. **New task**: `id` (any unique string, e.g. `agent-` + a timestamp) and `title` are enough.
   Usual extras: `project` (a project's `id`), `folder` (`~/path/to/folder`, a git repository or not), `status` (`inbox` for an
   idea, `next` for planned work), `due` (`YYYY-MM-DD`; words
   like "tomorrow" are dropped), `next_step`, `notes`. To put a task off, set `snooze` to a day
   (`YYYY-MM-DD`: it comes back then) or `"someday"`; `null` brings it back.
   **Order**: leave `rank` out and the task goes last in its lists; add `"priority": "high"` (or `1`)
   to put it first instead. The person orders the rest by dragging (`rank`, lower first): don't
   change another task's `rank`.
3. **Status** is one of `inbox`, `next`, `doing`, `waiting`, `review`, `done`, `dropped`. When you
   change it, also set `updated` (ms since the epoch) and append `{ "s": "<status>", "at": <ms> }` to
   `history`, so the person sees when it moved. For `done`, set `done_at` too.
4. **Don't mark the person's tasks done** unless they asked: put finished work in `review`.
5. **Don't delete tasks.** Set `status` to `dropped` if one must go. Removing an entry from `tasks.json` is what the person's *Delete* does, and it also closes the task's tabs and the agent in them. Old `deleted: true` entries are dropped when the file is read.
6. **Leave `tabs`, `sessions`, `agent_ms`, `worktree`, `branch` and `auto` alone** unless you know why: taskr keeps them.
7. Never put secrets in a task. The file is plain text in the person's home.

## Example (Node)

```js
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
const file = `${process.env.HERDR_APP_HOME ?? `${homedir()}/.config/herdr-app`}/data/taskr/tasks.json`;
const data = JSON.parse(readFileSync(file, "utf8"));
const now = Date.now();
data.tasks.push({ id: `agent-${now}`, title: "Write tests for the parser", folder: "~/dev/app",
  status: "next", next_step: "Cover empty input", created: now, updated: now,
  history: [{ s: "next", at: now }] });
writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1) + "\n");
renameSync(`${file}.tmp`, file);
```

## Example (shell, with jq)

```sh
f=~/.config/herdr-app/data/taskr/tasks.json
now=$(($(date +%s) * 1000))
jq --arg id "agent-$now" --argjson now "$now" \
  '.tasks += [{id: $id, title: "Update the changelog", status: "inbox", created: $now, updated: $now, history: [{s: "inbox", at: $now}]}]' \
  "$f" > "$f.tmp" && mv "$f.tmp" "$f"
```

## Settings and old keys

`settings` holds `wip`, `stale_days`, `agent`, `usage`, `reminders`, `activity`, `review_after` (minutes
a task with no plan stays in To review: 15, 60, 240, 1440, or 0 for always) and
`pause_after` (days with nothing happening before a project pauses by itself: 1, 3, 7, 14, 30, or 0 for
never). A project paused by taskr has `paused_auto` (taskr lifts it when something happens); leave
`paused_auto` and `active_at` to taskr.
Projects list their `folders`; tasks have a `folder`. Files with the old `repos` and `repo` keys are
still read and rewritten.

## Tasks with no plan

`"auto": true` marks a task taskr made by itself for an agent that started in a tab with no task,
titled after the agent. It has no plan yet: taskr moves it as its agent works (Doing, To review), marks it
Idle (`"idle": true`) after `review_after`, and Done when its agent
quits; its tab is then a plain terminal, and an agent started there again reopens the same task. Anything you change on it makes it the person's, and taskr removes `auto`. Don't set `auto`
on a task you create.

## Showing a task

`herdr-app do taskr.select:<task id>` shows that task in the detail panel (the taskr layout must be
the one on screen). `herdr-app do taskr.board` opens the board.

## Which task am I?

An agent started from a task has the task in its first message, and its terminal carries the label
`taskr.task=<id>`: `hc get "$HC_TERMINAL_ID" --json` shows it under `labels`.
