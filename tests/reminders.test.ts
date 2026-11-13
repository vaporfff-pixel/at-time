import { test } from "node:test";
import assert from "node:assert/strict";
import { contentFor, reconcile, replaceSchedule } from "../src/scheduler.ts";
import type { NotificationPort } from "../src/scheduler.ts";
import {
  decode,
  emptyState,
  nextAt,
  plans,
  PREFIX,
  validate,
} from "../src/domain.ts";
import type { Reminder } from "../src/domain.ts";
function reminder(patch: Partial<Reminder> = {}): Reminder {
  return {
    id: "alpha",
    text: "接孩子",
    at: new Date(2030, 0, 7, 15, 0).toISOString(),
    repeat: "once",
    completed: false,
    delivery: "scheduled",
    updatedAt: 1,
    ...patch,
  };
}
function fake(initial: string[] = [], failAt = 0) {
  const ids = new Set(initial);
  let calls = 0;
  const port: NotificationPort = {
    list: async () => [...ids],
    cancel: async (id) => {
      ids.delete(id);
    },
    schedule: async (plan) => {
      calls++;
      if (calls === failAt) throw new Error("schedule rejected");
      ids.add(plan.id);
    },
  };
  return { port, ids };
}
test("blank, invalid and past one-off reminders cannot be saved", () => {
  assert.throws(() => validate(" ", new Date(2030, 0, 1), "once", 0));
  assert.throws(() => validate("读书", new Date("invalid"), "daily", 0));
  assert.throws(() => validate("读书", new Date(1000), "once", 1000));
});
test("weekdays skip Friday after its time and the whole weekend", () => {
  const r = reminder({ repeat: "weekdays" });
  const result = nextAt(r, new Date(2026, 10, 13, 16));
  assert.equal(result.getDay(), 1);
  assert.equal(result.getDate(), 16);
  assert.equal(result.getHours(), 15);
});
test("daily uses next local clock time and handles month boundary", () => {
  const result = nextAt(
    reminder({ repeat: "daily" }),
    new Date(2026, 11, 31, 23),
  );
  assert.equal(result.getFullYear(), 2027);
  assert.equal(result.getMonth(), 0);
  assert.equal(result.getDate(), 1);
  assert.equal(result.getHours(), 15);
});
test("completed and past one-off reminders do not create notifications", () => {
  assert.equal(plans(reminder({ completed: true }), 0).length, 0);
  assert.equal(
    plans(reminder({ at: new Date(1000).toISOString() }), 1001).length,
    0,
  );
});
test("weekday repeating creates exactly five calendar requests", () => {
  const output = plans(reminder({ repeat: "weekdays" }));
  assert.deepEqual(
    output.map((p) => ("weekday" in p.trigger ? p.trigger.weekday : null)),
    [2, 3, 4, 5, 6],
  );
});
test("all scheduled notification content is silent and has no filler text", () => {
  for (const plan of plans(reminder({ repeat: "weekdays" }))) {
    const c = contentFor(plan);
    assert.equal(c.sound, false);
    assert.equal(c.title, "15:00  接孩子");
    assert.equal("body" in c, false);
  }
});
test("partial scheduling failure rolls back new requests and preserves old schedule", async () => {
  const old = `${PREFIX}alpha/1/once`;
  const f = fake([old, "other-app/keep"], 3);
  await assert.rejects(
    replaceSchedule(f.port, reminder({ repeat: "weekdays", updatedAt: 2 })),
    /rejected/,
  );
  assert.deepEqual([...f.ids], [old, "other-app/keep"]);
});
test("edit removes obsolete requests only after replacement is accepted", async () => {
  const old = `${PREFIX}alpha/1/once`;
  const f = fake([old, `${PREFIX}different/1/once`, "other-app/keep"]);
  await replaceSchedule(f.port, reminder({ updatedAt: 2 }));
  assert.equal(f.ids.has(old), false);
  assert.equal(f.ids.has(`${PREFIX}alpha/2/once`), true);
  assert.equal(f.ids.has(`${PREFIX}different/1/once`), true);
  assert.equal(f.ids.has("other-app/keep"), true);
});
test("reconcile removes deleted and completed reminders without touching other apps", async () => {
  const f = fake([
    `${PREFIX}deleted/1/once`,
    `${PREFIX}alpha/1/once`,
    "other-app/keep",
  ]);
  await reconcile(f.port, [reminder({ completed: true })]);
  assert.deepEqual([...f.ids], ["other-app/keep"]);
});
test("corrupt local state fails without silently resetting data", () => {
  assert.deepEqual(decode(null), emptyState());
  assert.throws(() => decode("{bad json"));
  const state = emptyState();
  state.reminders = [reminder(), reminder()];
  assert.throws(() => decode(JSON.stringify(state)), /损坏/);
});
test("failed cancellation cannot leave an uncommitted replacement scheduled", async () => {
  const old = `${PREFIX}alpha/1/once`,
    f = fake([old]);
  const cancel = f.port.cancel;
  f.port.cancel = async (identifier) => {
    if (identifier === old) throw new Error("cancel failed");
    await cancel(identifier);
  };
  await assert.rejects(
    replaceSchedule(f.port, reminder({ updatedAt: 2 })),
    /回退/,
  );
  assert.deepEqual([...f.ids], [old]);
});
