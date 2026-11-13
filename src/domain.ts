import { initialJournal, validateJournal } from "./journal.ts";
import type { Journal } from "./journal.ts";
export type Appearance = "light" | "dark";
export type Repeat = "once" | "daily" | "weekdays";
export type Delivery = "scheduled" | "disabled" | "failed";
export type Reminder = {
  id: string;
  text: string;
  at: string;
  repeat: Repeat;
  completed: boolean;
  delivery: Delivery;
  error?: string;
  updatedAt: number;
};
export type State = {
  version: 2;
  appearance: Appearance;
  reminders: Reminder[];
  journal: Journal;
};
export type Trigger =
  | { date: number }
  | { hour: number; minute: number; weekday?: number };
export type Plan = { id: string; reminder: Reminder; trigger: Trigger };
export const PREFIX = "at-time/v1/";
export const emptyState = (): State => ({
  version: 2,
  appearance: "light",
  reminders: [],
  journal: initialJournal(),
});
export function timeLabel(at: string | Date) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function dayLabel(at: string, now = new Date()) {
  const d = new Date(at),
    same = d.toDateString() === now.toDateString();
  return same ? "今天" : `${d.getMonth() + 1}月${d.getDate()}日`;
}
export function validate(
  text: string,
  at: Date,
  repeat: Repeat,
  now = Date.now(),
) {
  if (!text.trim()) throw new Error("请写下要做的事情。");
  if (text.trim().length > 120) throw new Error("事项最多写 120 个字。");
  if (!Number.isFinite(at.getTime())) throw new Error("请选择有效时间。");
  if (repeat === "once" && at.getTime() < now + 3000)
    throw new Error("提醒时间需要晚于现在，请重新选择。");
}
export function nextAt(
  reminder: Pick<Reminder, "at" | "repeat">,
  now = new Date(),
) {
  const base = new Date(reminder.at);
  if (reminder.repeat === "once") return base;
  const next = new Date(now);
  next.setHours(base.getHours(), base.getMinutes(), 0, 0);
  for (let i = 0; i < 8; i++) {
    if (
      next.getTime() > now.getTime() &&
      (reminder.repeat !== "weekdays" ||
        (next.getDay() !== 0 && next.getDay() !== 6))
    )
      return next;
    next.setDate(next.getDate() + 1);
  }
  throw new Error("无法计算下次提醒时间。");
}
export function plans(reminder: Reminder, now = Date.now()): Plan[] {
  if (reminder.completed) return [];
  const at = new Date(reminder.at),
    root = `${PREFIX}${reminder.id}/${reminder.updatedAt}/`;
  if (reminder.repeat === "once")
    return at.getTime() > now
      ? [{ id: `${root}once`, reminder, trigger: { date: at.getTime() } }]
      : [];
  const trigger = { hour: at.getHours(), minute: at.getMinutes() };
  return reminder.repeat === "daily"
    ? [{ id: `${root}daily`, reminder, trigger }]
    : [2, 3, 4, 5, 6].map((weekday) => ({
        id: `${root}${weekday}`,
        reminder,
        trigger: { ...trigger, weekday },
      }));
}
export function notificationCount(reminders: Reminder[]) {
  return reminders.flatMap((r) => plans(r)).length;
}
export function decode(raw: string | null): State {
  if (raw === null) return emptyState();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object")
    throw new Error("本地数据格式无法识别。");
  const s = value as Omit<State, "version"> & { version: number };
  if (
    ![1, 2].includes(s.version) ||
    !["light", "dark"].includes(s.appearance) ||
    !Array.isArray(s.reminders)
  )
    throw new Error("本地数据版本无法识别。");
  const ids = new Set<string>();
  for (const r of s.reminders) {
    if (
      !r ||
      typeof r.id !== "string" ||
      !/^[a-z0-9-]+$/i.test(r.id) ||
      ids.has(r.id) ||
      typeof r.text !== "string" ||
      !r.text.trim() ||
      r.text.length > 120 ||
      typeof r.at !== "string" ||
      !Number.isFinite(Date.parse(r.at)) ||
      !["once", "daily", "weekdays"].includes(r.repeat) ||
      typeof r.completed !== "boolean" ||
      !["scheduled", "disabled", "failed"].includes(r.delivery) ||
      !Number.isFinite(r.updatedAt)
    )
      throw new Error("本地提醒数据损坏，已保留原数据，请先导出备份。");
    ids.add(r.id);
  }
  if (s.version === 1)
    return {
      version: 2,
      appearance: s.appearance,
      reminders: s.reminders,
      journal: initialJournal(s.reminders),
    };
  validateJournal(s.journal);
  return { ...s, version: 2 };
}
export const repeatLabels = {
  once: "仅此一次",
  daily: "每天",
  weekdays: "工作日",
};
