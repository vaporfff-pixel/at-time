import { plans, PREFIX, timeLabel } from "./domain.ts";
import type { Reminder, Plan } from "./domain.ts";
export interface NotificationPort {
  list(): Promise<string[]>;
  schedule(plan: Plan): Promise<void>;
  cancel(id: string): Promise<void>;
}
// Only touch this app's identifiers: Expo Go may also host other projects.
export async function replaceSchedule(
  port: NotificationPort,
  reminder: Reminder,
) {
  const prefix = `${PREFIX}${reminder.id}/`,
    existing = (await port.list()).filter((id) => id.startsWith(prefix));
  const desired = plans(reminder),
    keep = new Set(desired.map((p) => p.id));
  const added: string[] = [];
  try {
    for (const plan of desired) {
      if (!existing.includes(plan.id)) {
        await port.schedule(plan);
        added.push(plan.id);
      }
    }
  } catch (error) {
    const cleanup = await Promise.allSettled(
      added.map((id) => port.cancel(id)),
    );
    if (cleanup.some((x) => x.status === "rejected"))
      throw new Error("设置失败，且部分新通知未能清理，请在提醒设置中重试。");
    throw error;
  }
  // Do not discard the previous schedule before replacement requests are accepted.
  try {
    for (const id of existing) if (!keep.has(id)) await port.cancel(id);
  } catch {
    const cleanup = await Promise.allSettled(
      added.map((id) => port.cancel(id)),
    );
    if (cleanup.some((x) => x.status === "rejected"))
      throw new Error("旧通知撤销失败，部分新通知也未能清理，请检查提醒安排。");
    throw new Error("旧通知未能全部撤销，新安排已回退，请检查并恢复提醒安排。");
  }
}
export async function clearReminder(port: NotificationPort, id: string) {
  const owned = (await port.list()).filter((x) =>
    x.startsWith(`${PREFIX}${id}/`),
  );
  for (const identifier of owned) await port.cancel(identifier);
}
export async function reconcile(port: NotificationPort, reminders: Reminder[]) {
  const ids = new Set(reminders.map((r) => r.id));
  for (const id of await port.list()) {
    if (
      id.startsWith(PREFIX) &&
      !ids.has(id.slice(PREFIX.length).split("/")[0])
    )
      await port.cancel(id);
  }
  for (const reminder of reminders) {
    if (reminder.completed || reminder.delivery !== "scheduled")
      await clearReminder(port, reminder.id);
    else await replaceSchedule(port, reminder);
  }
}
export function contentFor(plan: Plan) {
  return {
    title: `${timeLabel(plan.reminder.at)}  ${plan.reminder.text}`,
    sound: false as const,
    data: {
      app: "at-time",
      reminderId: plan.reminder.id,
      time: timeLabel(plan.reminder.at),
      text: plan.reminder.text,
      revisionId: `${plan.reminder.id}:${plan.reminder.updatedAt}`,
      at: plan.reminder.at,
      repeat: plan.reminder.repeat,
    },
  };
}
