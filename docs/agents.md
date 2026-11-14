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
   like "tomorrow" are dropped), `next_step`, `notes`. To park a task (it keeps its status), set
   `snooze` to a day (`YYYY-MM-DD`: it comes back then), `"someday"` or `"agent"` (until its agent
   works again); `null` brings it back. When it waits on someone, add `waiting_on` (`"Ana"`, or `""`)
   and a day to follow up in `snooze`.
   **Order**: leave `rank` out and the task goes last in its lists; add `"priority": "high"` (or `1`)
   to put it first instead. The person orders the rest by dragging (`rank`, lower first): don't
   change another task's `rank`.
3. **Status** is the task's stage, one of `inbox`, `next`, `doing` (shown as *In progress*), `review`, `done`. A task closed
   without being done is `done` with `"outcome": "dropped"`. When you change it, also set `updated`
   (ms since the epoch) and append `{ "s": "<status>", "at": <ms> }` to `history` (`"dropped"` for a
   dropped one), so the person sees when it moved. For `done`, set `done_at` too.
4. **Don't mark the person's tasks done** unless they asked: when the whole task is finished, put it
   in `review`. Finishing one turn of work isn't finishing the task.
5. **Don't delete tasks.** Mark one dropped if it must go. Removing an entry from `tasks.json` is what the person's *Delete* does, and it also closes the task's tabs and the agent in them. Old `deleted: true` entries are dropped when the file is read.
6. **Leave `tabs`, `sessions`, `agent_ms`, `work`, `worktree`, `branch`, `auto` and `freed` alone** unless you know why: taskr keeps them.
   `agent`, `model` and `effort` say how the task's agent starts (the person's *Start with…*).
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

`settings` holds `wip`, `stale_days`, `agent`, `usage`, `reminders`, `activity`, `park_after` (minutes
a task with no plan stays in progress with its agent idle before it's parked until that agent works: 60,
240, 1440, or 0 for never) and
`pause_after` (days with nothing happening before a project pauses by itself: 1, 3, 7, 14, 30, or 0 for
never). A project paused by taskr has `paused_auto` (taskr lifts it when something happens); leave
`paused_auto` and `active_at` to taskr.
Projects list their `folders`; tasks have a `folder`. Files with the old `repos` and `repo` keys are
still read and rewritten, and so are those from before 1.7: status `waiting` (now parked with
`waiting_on`), status `dropped` (now `outcome`), `idle` (now `snooze: "agent"`) and `review_after`.

## Tasks with no plan

`"auto": true` marks a task taskr made by itself for an agent that started in a tab with no task,
titled after the agent, in `doing`. It has no plan yet: it stays in progress while its agent is open,
and when its agent quits it's Done (or stays in Review, if it was there) with `"freed": true`: its tab
is then a plain terminal, and an agent started there again takes the same task back up. With
`park_after` set, taskr parks it (`snooze: "agent"`) once its agent has been idle that long. Anything
you change on it makes it the person's, and taskr removes `auto`. Don't set `auto` on a task you create.

## Showing a task

`herdr-app do taskr.select:<task id>` shows that task in the detail panel (the taskr layout must be
the one on screen). `herdr-app do taskr.board` opens the board.

## Which task am I?

An agent started from a task has the task in its first message, and its terminal carries the label
`taskr.task=<id>`: `hc get "$HC_TERMINAL_ID" --json` shows it under `labels`.
