import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, emptyState } from "../src/domain.ts";
import type { Reminder } from "../src/domain.ts";
import {
  closeDays,
  dayKey,
  entriesForDay,
  entryFromIncoming,
  initialJournal,
  recordAnswer,
  rememberChange,
  revisionId,
} from "../src/journal.ts";
const date = (day: number, hour = 0, minute = 0) =>
  new Date(2026, 10, day, hour, minute);
const memo = (patch: Partial<Reminder> = {}): Reminder => ({
  id: "one",
  text: "今天学到了什么？",
  at: date(12, 15).toISOString(),
  repeat: "once",
  completed: false,
  delivery: "scheduled",
  updatedAt: date(12, 10).getTime(),
  ...patch,
});
test("midnight archives question and answer under the preceding local day", () => {
  let journal = initialJournal([memo()]);
  const entry = entriesForDay(journal, "2026-11-12", date(12, 16))[0];
  journal = recordAnswer(journal, entry, "学会了做时间规划。", date(12, 16));
  assert.equal(closeDays(journal, date(12, 23, 59)).cards.length, 0);
  const card = closeDays(journal, date(13)).cards[0];
  assert.equal(card.day, "2026-11-12");
  assert.equal(card.closedAt, date(13).toISOString());
  assert.equal(card.entries[0].answer, "学会了做时间规划。");
});
test("unanswered questions are retained instead of disappearing", () => {
  const card = closeDays(initialJournal([memo()]), date(13)).cards[0];
  assert.equal(card.entries.length, 1);
  assert.equal(card.entries[0].answer, undefined);
});
test("reopening after several closed days catches up daily and skips weekends", () => {
  const journal = initialJournal([memo({ repeat: "weekdays" })]);
  const cards = closeDays(journal, date(17)).cards;
  assert.deepEqual(
    cards.map((c) => c.day),
    ["2026-11-16", "2026-11-13", "2026-11-12"],
  );
});
test("answers to repeated reminders remain separate for each occurrence", () => {
  let journal = initialJournal([memo({ repeat: "daily" })]);
  const first = entriesForDay(journal, "2026-11-12", date(13, 16))[0],
    second = entriesForDay(journal, "2026-11-13", date(13, 16))[0];
  assert.notEqual(first.id, second.id);
  journal = recordAnswer(journal, first, "第一天");
  journal = recordAnswer(journal, second, "第二天");
  assert.equal(journal.answers.length, 2);
});
test("editing a question preserves the earlier snapshot and closes the old revision", () => {
  const old = memo({ repeat: "daily" }),
    changed = memo({
      repeat: "daily",
      text: "新的问题",
      updatedAt: date(13, 10).getTime(),
    });
  let journal = initialJournal([old]);
  journal = rememberChange(journal, changed, old, changed.updatedAt);
  assert.equal(
    entriesForDay(journal, "2026-11-12", date(14))[0].question,
    old.text,
  );
  assert.equal(
    entriesForDay(journal, "2026-11-13", date(14))[0].question,
    "新的问题",
  );
});
test("deleting a memo does not delete prior answers or historical questions", () => {
  const old = memo({ repeat: "daily" });
  let journal = initialJournal([old]);
  const entry = entriesForDay(journal, "2026-11-12", date(13))[0];
  journal = recordAnswer(journal, entry, "保留下来的回答");
  journal = rememberChange(journal, null, old, date(13, 10).getTime());
  const archived = closeDays(journal, date(14));
  assert.equal(archived.cards[0].entries[0].answer, "保留下来的回答");
  assert.equal(entriesForDay(journal, "2026-11-13", date(14)).length, 0);
});
test("late answers update an existing closed card without duplicating entries", () => {
  let journal = closeDays(initialJournal([memo()]), date(13));
  const entry = journal.cards[0].entries[0];
  const generated = journal.cards[0].generatedAt;
  journal = recordAnswer(journal, entry, "第二天补写", date(13, 9));
  journal = closeDays(journal, date(13, 9));
  assert.equal(journal.cards[0].entries.length, 1);
  assert.equal(journal.cards[0].entries[0].answer, "第二天补写");
  assert.equal(journal.cards[0].generatedAt, generated);
});
test("repeated rollover is idempotent and creates no fabricated empty-day cards", () => {
  const first = closeDays(initialJournal([memo()]), date(15));
  assert.equal(first.cards.length, 1);
  assert.deepEqual(closeDays(first, date(15, 10)), first);
});
test("a notification opened the next day still records against its original delivered day", () => {
  const r = memo({ repeat: "daily" }),
    journal = initialJournal([r]);
  const entry = entryFromIncoming(journal, {
    reminderId: r.id,
    revisionId: revisionId(r),
    time: "15:00",
    text: r.text,
    at: r.at,
    repeat: r.repeat,
    deliveredAt: date(12, 15).toISOString(),
  });
  assert.equal(entry.day, "2026-11-12");
});
test("old notifications keep their original question after an edit", () => {
  const old = memo(),
    newer = memo({ text: "新问题", updatedAt: date(12, 16).getTime() });
  let journal = initialJournal([old]);
  journal = rememberChange(journal, newer, old, newer.updatedAt);
  const entry = entryFromIncoming(journal, {
    reminderId: old.id,
    revisionId: revisionId(old),
    time: "15:00",
    text: old.text,
    at: old.at,
    repeat: "once",
    deliveredAt: date(12, 15).toISOString(),
  });
  assert.equal(entry.question, old.text);
  assert.equal(entry.revisionId, revisionId(old));
});
test("empty answers cannot be committed; resaving replaces rather than appends", () => {
  let journal = initialJournal([memo()]);
  const entry = entriesForDay(journal, "2026-11-12", date(13))[0];
  assert.throws(() => recordAnswer(journal, entry, "  "));
  journal = recordAnswer(journal, entry, "初稿");
  journal = recordAnswer(journal, entry, "修改稿");
  assert.equal(journal.answers.length, 1);
  assert.equal(journal.answers[0].answer, "修改稿");
});
test("legacy v1 data migrates in memory and preserves every existing reminder", () => {
  const reminder = memo(),
    legacy = { version: 1, appearance: "dark", reminders: [reminder] };
  const migrated = decode(JSON.stringify(legacy));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.appearance, "dark");
  assert.deepEqual(migrated.reminders, [reminder]);
  assert.equal(migrated.journal.revisions.length, 1);
});
test("invalid journal data fails instead of discarding answers", () => {
  const state = emptyState();
  (state.journal.answers as unknown[]) = [{ id: "broken" }];
  assert.throws(() => decode(JSON.stringify(state)), /回答数据损坏/);
});
test("future questions are not included in the current-day record", () => {
  assert.equal(
    entriesForDay(initialJournal([memo()]), "2026-11-12", date(12, 14)).length,
    0,
  );
});
test("a repeated reminder created after its time starts with the next occurrence", () => {
  const journal = initialJournal([
    memo({ repeat: "daily", updatedAt: date(12, 16).getTime() }),
  ]);
  assert.equal(entriesForDay(journal, "2026-11-12", date(13, 17)).length, 0);
  assert.equal(entriesForDay(journal, "2026-11-13", date(13, 17)).length, 1);
});
