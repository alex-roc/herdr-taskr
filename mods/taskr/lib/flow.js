// How a task moves by itself: every automatic rule in one place, as plain functions.
//
// A task answers three questions, each with one owner:
//   stage  (inbox, next, doing, review, done): where the work is. You set it; kept in the file.
//   turn   (working, blocked, done, idle): what its agent is doing now. Herdr says it; never kept.
//   parked (snooze): when it comes back. You park it; it comes back by itself.
// The turn never writes the stage, but for one thing: an agent starting work means the work is
// under way (In progress, `doing` in the file). A finished turn isn't a finished task.

import { OPEN, isDropped, isLater } from "./util.js";

// An agent started working: the task it's for is under way. Review stays Review (fixing what a
// review found is part of it); Dropped stays dropped.
export function onWorking(t) {
  if (["inbox", "next"].includes(t?.status)) return "doing";
  if (t?.status === "done" && !isDropped(t)) return "doing";
  return null;
}

// The stage of a task with no plan made (or taken up again) for an agent: under way, unless it
// was waiting for your review.
export const adoptStage = (had) => (had?.status === "review" ? "review" : "doing");

// A task with no plan whose agent quit (or whose tab closed): nothing else says when it's done,
// so it is; one in Review waits for you.
export const quitStage = (t) => (t?.status === "review" ? "review" : "done");

// A task whose agent you've seen and that waits for a word from you, for longer than `minutes`
// (0: never): parked until its agent works again. Planned or not: every agent is a task.
export function parkDue(t, top, since, now, minutes) {
  return minutes > 0 && OPEN.has(t?.status) && !isLater(t) && top === "idle"
    && Boolean(since) && now - since > minutes * 60000;
}

// A pull request opened since the task went in progress: ready for review. Only for a task with its
// own branch (a worktree taskr made), so a PR is surely its own.
export function prReady(t, pr) {
  if (t?.status !== "doing" || !t.branch || pr?.state !== "OPEN") return false;
  const since = [...(t.history ?? [])].reverse().find((h) => h.s === "doing")?.at ?? 0;
  const opened = Date.parse(pr.createdAt ?? "");
  return Number.isFinite(opened) && opened >= since - 60000;
}

// In progress for days without anything moving (no change of yours, no agent at work): its time
// shows in yellow on its row. `last`: when something last happened; `staleMs`: the setting.
export const stale = (t, top, last, now, staleMs) =>
  t?.status === "doing" && !isLater(t) && !["working", "blocked", "done"].includes(top) && now - (last ?? 0) > staleMs;

// Where a task shows in Now: what its agent asks of you first (a question, a turn it finished,
// seen or not), what it's doing, then parked, then its stage. Closed tasks aren't in Now. A task in
// progress (doing) shows there only with no agent waiting for you: in progress isn't "doing now".
export function nowSection(x) {
  if (!OPEN.has(x.t.status)) return null;
  if (x.top === "blocked") return "needs";
  if (x.top === "working") return "working";
  if (x.top === "done") return "finished";
  if (isLater(x.t)) return "later";
  if (x.top === "idle") return "finished";
  return x.t.status;
}
