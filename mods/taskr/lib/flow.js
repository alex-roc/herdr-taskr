// How a task moves by itself: every automatic rule in one place, as plain functions.
//
// A task answers three questions, each with one owner:
//   stage  (inbox, next, doing, review, done): where the work is. You set it; kept in the file.
//   turn   (working, blocked, done, idle): what its agent is doing now. Herdr says it; never kept.
//   parked (snooze): when it comes back. You park it; it comes back by itself.
// The turn never writes the stage, but for one thing: an agent starting work means the work is
// under way (In progress, `doing` in the file). A finished turn isn't a finished task.

import { OPEN, isDropped, isLater, tilde } from "./util.js";

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

// Whether an agent worked on a task since you last chose its stage: a conversation kept, or a
// turn ended, after it. Kept in the file, so it outlives a restart: a task you gave details to whose
// agent went while taskr wasn't looking (its tab closed, or taken by another task) is closed as one
// seen going. One you moved by hand since (back to In progress, say) waits for you.
export function ranSince(t) {
  const chosen = t?.history?.at(-1)?.at ?? 0;
  const ran = Math.max(t?.turn_at ?? 0, ...(t?.sessions ?? []).map((s) => s?.at ?? 0));
  return ran > 0 && ran >= chosen;
}

// Where a task with no plan works: its agent's folder, wherever it goes (a `cd`, then another agent
// started there), as the repository it's in (`repo`) or the folder itself (`here`). In the task's
// project, its place is project-wide work: no folder. Moved by hand, a task isn't one with no plan
// any longer (`kept`) and stays where you put it.
export function agentFolder(here, repo, place, h) {
  if (!here) return undefined;
  if (place && here === place) return null;
  return tilde(repo ?? here, h);
}

// A task whose agent you've seen and that waits for a word from you, for longer than `minutes`
// (0: never): parked until its agent works again. Planned or not: every agent is a task. One you
// decided on since (a stage chosen after its agent stopped, `turnAt`: Next, say) isn't waiting.
export function parkDue(t, top, since, now, minutes, turnAt = since) {
  return minutes > 0 && OPEN.has(t?.status) && !isLater(t) && top === "idle"
    && Boolean(since) && now - since > minutes * 60000 && (t.history?.at(-1)?.at ?? 0) <= (turnAt ?? since);
}

// A pull request opened since the task went in progress: ready for review. Only for a task with its
// own branch (a worktree taskr made), so a PR is surely its own.
export function prReady(t, pr) {
  if (t?.status !== "doing" || !t.branch || pr?.state !== "OPEN") return false;
  const since = [...(t.history ?? [])].reverse().find((h) => h.s === "doing")?.at ?? 0;
  const opened = Date.parse(pr.createdAt ?? "");
  return Number.isFinite(opened) && opened >= since - 60000;
}

// Where a task shows in Now: what its agent asks of you first (a question, a turn it finished,
// seen or not), what it's doing, then parked, then its stage. Closed tasks aren't in Now. A task in
// progress (doing) shows there only with no agent waiting for you: in progress isn't "doing now".
// Finished holds the turns you haven't decided on: its stage changed since its agent's turn ended
// (`turnAt`; Next for later, say), it goes to that stage, until another turn ends.
export function nowSection(x, turnAt = null) {
  if (!OPEN.has(x.t.status)) return null;
  if (x.top === "blocked") return "needs";
  if (x.top === "working") return "working";
  const decided = turnAt != null && (x.t.history?.at(-1)?.at ?? 0) > turnAt;
  if (x.top === "done" && !decided) return "finished";
  if (isLater(x.t)) return "later";
  if (x.top === "idle" && !decided) return "finished";
  // What's yours to do: in progress with no agent at work or waiting, to review, next. The Inbox
  // (ideas, imported issues) stays in Projects and the board until you pick from it.
  return ["doing", "review", "next"].includes(x.t.status) ? "next" : null;
}
