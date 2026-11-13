import type { Reminder, Repeat } from "./domain.ts";

export type Revision = {
  id: string;
  reminderId: string;
  question: string;
  at: string;
  repeat: Repeat;
  hour: number;
  minute: number;
  from: number;
  until: number | null;
};
export type JournalEntry = {
  id: string;
  reminderId: string;
  revisionId: string;
  question: string;
  at: string;
  day: string;
  time?: string;
  answer?: string;
  answeredAt?: string;
};
export type Answer = JournalEntry & { answer: string; answeredAt: string };
export type DailyCard = {
  day: string;
  closedAt: string;
  generatedAt: string;
  entries: JournalEntry[];
};
export type Journal = {
  revisions: Revision[];
  answers: Answer[];
  cards: DailyCard[];
};
export type Incoming = {
  reminderId: string;
  time: string;
  text: string;
  revisionId?: string;
  at?: string;
  repeat?: Repeat;
  deliveredAt: string;
};
const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const entryTime = (entry: JournalEntry) =>
  entry.time ??
  `${pad(new Date(entry.at).getHours())}:${pad(new Date(entry.at).getMinutes())}`;
export function dayStart(day: string) {
  const d = new Date(day + "T00:00:00");
  if (!Number.isFinite(d.getTime()) || dayKey(d) !== day)
    throw new Error("记录日期无效。");
  return d;
}
export function dayEnd(day: string) {
  const d = dayStart(day);
  d.setDate(d.getDate() + 1);
  return d;
}
export const revisionId = (r: Pick<Reminder, "id" | "updatedAt">) =>
  `${r.id}:${r.updatedAt}`;
function revision(r: Reminder, from: number): Revision {
  const d = new Date(r.at);
  return {
    id: revisionId(r),
    reminderId: r.id,
    question: r.text,
    at: r.at,
    repeat: r.repeat,
    hour: d.getHours(),
    minute: d.getMinutes(),
    from,
    until: null,
  };
}
export function initialJournal(reminders: Reminder[] = []): Journal {
  return {
    revisions: reminders
      .filter((r) => !r.completed)
      .map((r) => revision(r, r.updatedAt)),
    answers: [],
    cards: [],
  };
}
export function rememberChange(
  journal: Journal,
  next: Reminder | null,
  previous: Reminder | undefined,
  now: number,
): Journal {
  const id = next?.id ?? previous!.id;
  const revisions = journal.revisions.map((r) =>
    r.reminderId === id && r.until === null ? { ...r, until: now } : r,
  );
  if (next && !next.completed) revisions.push(revision(next, now));
  return { ...journal, revisions };
}
function entryFor(r: Revision, at: Date): JournalEntry {
  return {
    id: `${r.id}@${at.toISOString()}`,
    reminderId: r.reminderId,
    revisionId: r.id,
    question: r.question,
    at: at.toISOString(),
    day: dayKey(at),
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}
export function entriesForDay(
  journal: Journal,
  day: string,
  now = new Date(),
): JournalEntry[] {
  const entries = new Map<string, JournalEntry>();
  for (const r of journal.revisions) {
    const at = r.repeat === "once" ? new Date(r.at) : dayStart(day);
    if (r.repeat !== "once") at.setHours(r.hour, r.minute, 0, 0);
    const ms = at.getTime();
    if (
      dayKey(at) !== day ||
      ms > now.getTime() ||
      ms < r.from ||
      (r.until !== null && ms >= r.until)
    )
      continue;
    if (r.repeat === "weekdays" && (at.getDay() === 0 || at.getDay() === 6))
      continue;
    const entry = entryFor(r, at);
    entries.set(entry.id, entry);
  }
  for (const answer of journal.answers)
    if (answer.day === day) entries.set(answer.id, { ...answer });
  return [...entries.values()].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
}
export function entryFromIncoming(
  journal: Journal,
  incoming: Incoming,
): JournalEntry {
  const delivered = new Date(incoming.deliveredAt);
  if (!Number.isFinite(delivered.getTime()))
    throw new Error("提醒时间无法识别。");
  const known =
    journal.revisions.find((r) => r.id === incoming.revisionId) ??
    journal.revisions
      .filter(
        (r) =>
          r.reminderId === incoming.reminderId && r.from <= delivered.getTime(),
      )
      .sort((a, b) => b.from - a.from)[0];
  const repeat = incoming.repeat ?? known?.repeat ?? "once";
  const firstAt = incoming.at ?? known?.at;
  let at = firstAt ? new Date(firstAt) : new Date(delivered);
  if (repeat !== "once" || !firstAt) {
    const [h, m] = incoming.time.split(":").map(Number);
    if (
      !Number.isInteger(h) ||
      h < 0 ||
      h > 23 ||
      !Number.isInteger(m) ||
      m < 0 ||
      m > 59
    )
      throw new Error("提醒时间格式不正确。");
    at = new Date(delivered);
    at.setHours(h, m, 0, 0);
    if (at.getTime() > delivered.getTime() + 1000) at.setDate(at.getDate() - 1);
    if (repeat === "weekdays")
      while (at.getDay() === 0 || at.getDay() === 6)
        at.setDate(at.getDate() - 1);
  }
  const rev: Revision = {
    id: incoming.revisionId ?? known?.id ?? `${incoming.reminderId}:legacy`,
    reminderId: incoming.reminderId,
    question: incoming.text,
    at: at.toISOString(),
    repeat,
    hour: at.getHours(),
    minute: at.getMinutes(),
    from: 0,
    until: null,
  };
  const entry = { ...entryFor(rev, at), time: incoming.time },
    answer = journal.answers.find((a) => a.id === entry.id);
  return answer ? { ...answer } : entry;
}
export function recordAnswer(
  journal: Journal,
  entry: JournalEntry,
  value: string,
  now = new Date(),
): Journal {
  const answer = value.trim();
  if (!answer) throw new Error("请写下这次的记录，再点确认。");
  if (answer.length > 2000) throw new Error("每次记录最多 2000 个字。");
  const saved: Answer = { ...entry, answer, answeredAt: now.toISOString() };
  return {
    ...journal,
    answers: [...journal.answers.filter((a) => a.id !== entry.id), saved],
  };
}
function mergeAnswers(entries: JournalEntry[], answers: Answer[], day: string) {
  const all = new Map(entries.map((e) => [e.id, e]));
  for (const answer of answers)
    if (answer.day === day) all.set(answer.id, { ...answer });
  return [...all.values()].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
}
export function closeDays(journal: Journal, now = new Date()): Journal {
  const today = dayKey(now),
    cards = new Map(journal.cards.map((c) => [c.day, c]));
  // Existing closed cards retain their question/time snapshots even after edits,
  // deletes or a timezone change. A later answer can still be added to its card.
  for (const c of journal.cards) {
    const entries = mergeAnswers(c.entries, journal.answers, c.day);
    if (JSON.stringify(entries) !== JSON.stringify(c.entries))
      cards.set(c.day, { ...c, entries });
  }
  const candidates = [
    ...journal.revisions.map((r) => dayKey(new Date(r.from))),
    ...journal.answers.map((a) => a.day),
  ].sort();
  if (candidates.length) {
    const cursor = dayStart(candidates[0]);
    let days = 0;
    while (dayKey(cursor) < today) {
      if (++days > 36600) throw new Error("记录跨度异常，已保留原数据。");
      const day = dayKey(cursor);
      if (!cards.has(day)) {
        const entries = entriesForDay(journal, day, now);
        if (entries.length)
          cards.set(day, {
            day,
            closedAt: dayEnd(day).toISOString(),
            generatedAt: now.toISOString(),
            entries,
          });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const result = [...cards.values()].sort((a, b) => b.day.localeCompare(a.day));
  return JSON.stringify(result) === JSON.stringify(journal.cards)
    ? journal
    : { ...journal, cards: result };
}
export function validateJournal(value: unknown): asserts value is Journal {
  const j = value as Journal;
  const date = (x: unknown) =>
    typeof x === "string" && Number.isFinite(Date.parse(x));
  const validDay = (x: unknown) => {
    try {
      return typeof x === "string" && dayKey(dayStart(x)) === x;
    } catch {
      return false;
    }
  };
  const entry = (e: JournalEntry) =>
    !!e &&
    typeof e.id === "string" &&
    typeof e.reminderId === "string" &&
    typeof e.revisionId === "string" &&
    typeof e.question === "string" &&
    e.question.length <= 120 &&
    date(e.at) &&
    validDay(e.day) &&
    (e.time === undefined ||
      (typeof e.time === "string" &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.time))) &&
    (e.answer === undefined ||
      (typeof e.answer === "string" && e.answer.length <= 2000)) &&
    (e.answeredAt === undefined || date(e.answeredAt));
  const unique = (rows: { id: string }[]) =>
    new Set(rows.map((x) => x.id)).size === rows.length;
  if (
    !j ||
    !Array.isArray(j.revisions) ||
    !Array.isArray(j.answers) ||
    !Array.isArray(j.cards)
  )
    throw new Error("记录数据无法识别，已保留原数据。");
  if (
    !j.revisions.every(
      (r) =>
        r &&
        typeof r.id === "string" &&
        typeof r.reminderId === "string" &&
        typeof r.question === "string" &&
        r.question.length <= 120 &&
        date(r.at) &&
        ["once", "daily", "weekdays"].includes(r.repeat) &&
        Number.isInteger(r.hour) &&
        r.hour >= 0 &&
        r.hour < 24 &&
        Number.isInteger(r.minute) &&
        r.minute >= 0 &&
        r.minute < 60 &&
        Number.isFinite(r.from) &&
        (r.until === null || (Number.isFinite(r.until) && r.until >= r.from)),
    ) ||
    !unique(j.revisions)
  )
    throw new Error("事项历史数据损坏，已保留原数据。");
  if (
    !j.answers.every(
      (a) => entry(a) && typeof a.answer === "string" && date(a.answeredAt),
    ) ||
    !unique(j.answers)
  )
    throw new Error("回答数据损坏，已保留原数据。");
  if (
    !j.cards.every(
      (c) =>
        c &&
        validDay(c.day) &&
        date(c.closedAt) &&
        date(c.generatedAt) &&
        Array.isArray(c.entries) &&
        c.entries.every((e) => entry(e) && e.day === c.day) &&
        unique(c.entries),
    ) ||
    new Set(j.cards.map((c) => c.day)).size !== j.cards.length
  )
    throw new Error("记录卡数据损坏，已保留原数据。");
}
