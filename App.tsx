import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  decode,
  dayLabel,
  emptyState,
  nextAt,
  notificationCount,
  repeatLabels,
  timeLabel,
  validate,
} from "./src/domain";
import type { Reminder, Repeat, State } from "./src/domain";
import { clearReminder, reconcile, replaceSchedule } from "./src/scheduler";
import {
  deviceNotificationsAvailable,
  listen,
  permission,
  port,
} from "./src/notifications";
import type { Incoming } from "./src/notifications";
import { orange, palettes } from "./src/theme";
import Constants, { ExecutionEnvironment } from "expo-constants";
import {
  closeDays,
  entryTime,
  dayKey,
  entriesForDay,
  entryFromIncoming,
  recordAnswer,
  rememberChange,
} from "./src/journal";
import type { JournalEntry } from "./src/journal";
import { DailyRecordCard, RecordDialog } from "./src/JournalViews";
import { shareCard } from "./src/shareCard";

const KEY = "at-time/state/v1";
const LEGACY_BACKUP = "at-time/backup/before-journal-v2";
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const futureDate = () => {
  const d = new Date(Date.now() + 3600_000);
  d.setSeconds(0, 0);
  return d;
};
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作没有完成，请重试。";
const id = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function App() {
  return (
    <SafeAreaProvider>
      <ReminderApp />
    </SafeAreaProvider>
  );
}
function ReminderApp() {
  const [state, setState] = useState<State>(emptyState);
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false),
    locked = useRef(false);
  const [editor, setEditor] = useState(false),
    [settings, setSettings] = useState(false),
    [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null),
    [text, setText] = useState(""),
    [at, setAt] = useState(futureDate),
    [repeat, setRepeat] = useState<Repeat>("once");
  const [formError, setFormError] = useState(""),
    [notice, setNotice] = useState("");
  const [incoming, setIncoming] = useState<Incoming | null>(null),
    [allowed, setAllowed] = useState(false);
  const [clock, setClock] = useState(Date.now()),
    pendingOpen = useRef<Incoming | null>(null);
  const [tab, setTab] = useState<"reminders" | "today" | "cards">("reminders");
  const [recordEntry, setRecordEntry] = useState<JournalEntry | null>(null);
  const [cardDay, setCardDay] = useState(dayKey());
  const cardRef = useRef<React.ElementRef<typeof View> | null>(null),
    cardHeight = useRef(0),
    readyRef = useRef(false),
    archiveDay = useRef(dayKey());
  const p = palettes[state.appearance],
    dark = state.appearance === "dark";
  const s = styles;

  async function commit(next: State) {
    const rolled = { ...next, journal: closeDays(next.journal) };
    await AsyncStorage.setItem(KEY, JSON.stringify(rolled));
    stateRef.current = rolled;
    setState(rolled);
    archiveDay.current = dayKey();
  }
  async function run(action: () => Promise<void>) {
    if (locked.current || !ready || loadError) return;
    locked.current = true;
    setBusy(true);
    setFormError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      const message = errorText(e);
      setFormError(message);
      setNotice(message);
      Alert.alert("没有完成", message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function edit(reminder?: Reminder) {
    if (locked.current) return;
    setEditingId(reminder?.id ?? null);
    setText(reminder?.text ?? "");
    setAt(
      reminder
        ? reminder.repeat === "once"
          ? new Date(reminder.at)
          : nextAt(reminder)
        : futureDate(),
    );
    setRepeat(reminder?.repeat ?? "once");
    setFormError("");
    setEditor(true);
    setIncoming(null);
  }
  function openRecord(entry: JournalEntry) {
    const saved = stateRef.current.journal.answers.find(
      (a) => a.id === entry.id,
    );
    setFormError("");
    setIncoming(null);
    setEditor(false);
    setSettings(false);
    setRecordEntry(saved ?? entry);
  }
  function openIncoming(message: Incoming) {
    if (!readyRef.current || locked.current) {
      pendingOpen.current = message;
      return;
    }
    try {
      openRecord(entryFromIncoming(stateRef.current.journal, message));
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function saveRecord(entry: JournalEntry, value: string) {
    await run(async () => {
      await commit({
        ...stateRef.current,
        journal: recordAnswer(stateRef.current.journal, entry, value),
      });
      setRecordEntry(null);
      setNotice("已保存这次记录。");
    });
  }
  async function persistReminder(next: Reminder | null, previous?: Reminder) {
    const targetId = next?.id ?? previous!.id;
    if (next?.delivery === "scheduled" && !next.completed)
      await replaceSchedule(port, next);
    else await clearReminder(port, targetId);
    try {
      const current = stateRef.current;
      const reminders = current.reminders.filter((r) => r.id !== targetId);
      if (next) reminders.push(next);
      await commit({
        ...current,
        reminders,
        journal: rememberChange(
          current.journal,
          next,
          previous,
          next?.updatedAt ?? Date.now(),
        ),
      });
    } catch (e) {
      // Roll back the native schedule if durable storage fails.
      try {
        if (previous?.delivery === "scheduled" && !previous.completed)
          await replaceSchedule(port, previous);
        else await clearReminder(port, targetId);
      } catch {
        throw new Error(
          "本地保存失败，通知状态也未能恢复。请在提醒设置中检查并重试。",
        );
      }
      throw e;
    }
  }
  async function save() {
    await run(async () => {
      validate(text, at, repeat);
      const current = stateRef.current,
        old = current.reminders.find((r) => r.id === editingId);
      const reminder: Reminder = {
        id: old?.id ?? id(),
        text: text.trim(),
        at: at.toISOString(),
        repeat,
        completed: false,
        delivery: "disabled",
        updatedAt: Date.now(),
      };
      const total = notificationCount([
        ...current.reminders.filter((r) => r.id !== reminder.id),
        { ...reminder, delivery: "scheduled" },
      ]);
      if (total > 48)
        throw new Error(
          "已达到通知容量，请先完成或删除一些提醒。工作日重复会占用 5 个通知位置。",
        );
      const status = await permission(true);
      setAllowed(status.allowed);
      validate(text, at, repeat);
      reminder.delivery = status.allowed ? "scheduled" : "disabled";
      await persistReminder(reminder, old);
      setEditor(false);
      setNotice(
        status.allowed
          ? "已保存，系统已接收提醒安排。"
          : "备忘已保存；通知尚未开启，请在提醒设置中开启。",
      );
    });
  }
  async function changeCompleted(r: Reminder) {
    if (
      r.completed &&
      r.repeat === "once" &&
      new Date(r.at).getTime() <= Date.now()
    ) {
      edit(r);
      setFormError("这条提醒时间已过，请修改时间后保存。");
      return;
    }
    const action = () =>
      run(async () => {
        const status = await permission(!r.completed ? false : true);
        setAllowed(status.allowed);
        const next = {
          ...r,
          completed: !r.completed,
          updatedAt: Date.now(),
          delivery: (status.allowed
            ? "scheduled"
            : "disabled") as Reminder["delivery"],
        };
        await persistReminder(next, r);
        setIncoming(null);
      });
    if (!r.completed && r.repeat !== "once")
      Alert.alert(
        "完成这个重复提醒？",
        "完成后将停止这条提醒的后续重复。需要时可在「已完成」中恢复。",
        [
          { text: "取消", style: "cancel" },
          {
            text: "完成并停止重复",
            onPress: () => {
              void action();
            },
          },
        ],
      );
    else await action();
  }
  function remove(r: Reminder) {
    Alert.alert("删除这条提醒？", r.text, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void run(async () => {
            await persistReminder(null, r);
            setEditor(false);
            setIncoming((current) =>
              current?.reminderId === r.id ? null : current,
            );
          });
        },
      },
    ]);
  }
  async function enableNotifications() {
    await run(async () => {
      const status = await permission(true);
      setAllowed(status.allowed);
      if (!status.allowed) {
        Alert.alert(
          "请开启通知",
          `在 iPhone 设置中允许${isExpoGo ? " Expo Go " : "「到点」"}的通知，并开启锁定屏幕和横幅。`,
          [
            { text: "稍后", style: "cancel" },
            {
              text: "打开设置",
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        return;
      }
      const next = {
        ...stateRef.current,
        reminders: stateRef.current.reminders.map((r) => ({
          ...r,
          delivery: "scheduled" as const,
        })),
      };
      await reconcile(port, next.reminders);
      await commit(next);
      setNotice("提醒安排已检查并更新。");
    });
  }
  async function testNotification() {
    await run(async () => {
      const status = await permission(true);
      setAllowed(status.allowed);
      if (!status.allowed)
        throw new Error("请先开启通知权限。浏览器预览不支持手机系统通知。");
      if (notificationCount(stateRef.current.reminders) >= 48)
        throw new Error("通知容量已满，请先删除或完成一条提醒。");
      const reminder: Reminder = {
        id: id(),
        text: "测试静音提醒",
        at: new Date(Date.now() + 10_000).toISOString(),
        repeat: "once",
        completed: false,
        delivery: "scheduled",
        updatedAt: Date.now(),
      };
      await persistReminder(reminder);
      setSettings(false);
      Alert.alert(
        "已安排 10 秒后提醒",
        "现在可以锁屏，检查实际通知效果。没有提示音；锁屏亮屏与后台震动受 iOS 控制。",
      );
    });
  }
  async function snooze() {
    const current = stateRef.current.reminders.find(
      (r) => r.id === incoming?.reminderId,
    );
    if (!current) return;
    await run(async () => {
      const isOnce = current.repeat === "once";
      const next: Reminder = {
        ...current,
        id: isOnce ? current.id : id(),
        repeat: "once",
        at: new Date(Date.now() + 600_000).toISOString(),
        completed: false,
        delivery: "scheduled",
        updatedAt: Date.now(),
      };
      if (!(await permission()).allowed)
        throw new Error("通知权限已关闭，请先开启。");
      if (!isOnce && notificationCount(stateRef.current.reminders) >= 48)
        throw new Error("通知容量已满，暂时无法增加延后提醒。");
      await persistReminder(next, isOnce ? current : undefined);
      setIncoming(null);
      setNotice("已延后 10 分钟。");
    });
  }
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const decoded = decode(raw);
        if (
          raw &&
          JSON.parse(raw).version === 1 &&
          !(await AsyncStorage.getItem(LEGACY_BACKUP))
        )
          await AsyncStorage.setItem(LEGACY_BACKUP, raw);
        const loaded = { ...decoded, journal: closeDays(decoded.journal) };
        if (raw !== JSON.stringify(loaded))
          await AsyncStorage.setItem(KEY, JSON.stringify(loaded));
        stateRef.current = loaded;
        if (!live) return;
        setState(loaded);
        const status = await permission();
        setAllowed(status.allowed);
        if (deviceNotificationsAvailable) {
          try {
            await reconcile(port, loaded.reminders);
          } catch (e) {
            setNotice("通知安排检查未完成：" + errorText(e));
          }
        }
        readyRef.current = true;
        archiveDay.current = dayKey();
        setReady(true);
      } catch (e) {
        if (live) {
          setLoadError(errorText(e));
          setReady(true);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => listen(setIncoming, openIncoming), []);
  useEffect(() => {
    if (ready && !busy && pendingOpen.current) {
      const message = pendingOpen.current;
      pendingOpen.current = null;
      openIncoming(message);
    }
  }, [ready, busy]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    const subscription = AppState.addEventListener("change", (value) => {
      if (value === "active") {
        setClock(Date.now());
        void permission()
          .then((status) => setAllowed(status.allowed))
          .catch(() => {});
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (
      ready &&
      !busy &&
      !loadError &&
      archiveDay.current !== dayKey(new Date(clock))
    )
      void run(() => commit(stateRef.current));
  }, [clock, ready, busy, loadError]);

  const pending = state.reminders
    .filter((r) => !r.completed)
    .sort(
      (a, b) =>
        nextAt(a, new Date(clock)).getTime() -
        nextAt(b, new Date(clock)).getTime(),
    );
  const done = state.reminders.filter((r) => r.completed);
  const selected = state.reminders.find((r) => r.id === editingId);
  const today = dayKey(new Date(clock));
  const todayEntries = entriesForDay(state.journal, today, new Date(clock));
  const cardEntries =
    cardDay === today
      ? todayEntries
      : (state.journal.cards.find((c) => c.day === cardDay)?.entries ?? []);
  const textCard = () => {
    const message = [
      `到点 · ${cardDay} 一日记录`,
      "",
      ...cardEntries.flatMap((e) => [
        `${entryTime(e)}  ${e.question}`,
        e.answer || "未记录",
        "",
      ]),
    ].join("\n");
    void Share.share({ message }).catch((e) =>
      Alert.alert("分享失败", errorText(e)),
    );
  };
  const deliveryText = (r: Reminder) =>
    r.delivery === "failed"
      ? "提醒设置失败"
      : r.delivery === "disabled" || !allowed
        ? "通知未开启"
        : r.repeat === "once" && new Date(r.at).getTime() <= clock
          ? "时间已到"
          : repeatLabels[r.repeat];
  function renderRow(r: Reminder, index: number) {
    const next = nextAt(r, new Date(clock));
    return (
      <View key={r.id} style={[s.row, { borderBottomColor: p.line }]}>
        <Pressable
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`编辑 ${timeLabel(r.at)} ${r.text}`}
          onPress={() => edit(r)}
          style={s.rowMain}
        >
          <Text
            style={[
              s.rowTime,
              {
                color: r.completed
                  ? p.muted
                  : index === 0
                    ? p.accentText
                    : p.ink,
              },
            ]}
          >
            {timeLabel(r.at)}
          </Text>
          <View style={s.rowCopy}>
            <Text
              style={[
                s.rowText,
                {
                  color: r.completed ? p.muted : p.ink,
                  textDecorationLine: r.completed ? "line-through" : "none",
                },
              ]}
            >
              {r.text}
            </Text>
            <Text style={[s.rowMeta, { color: p.muted }]}>
              {dayLabel(next.toISOString(), new Date(clock))} ·{" "}
              {deliveryText(r)}
            </Text>
          </View>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => {
            void changeCompleted(r);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: r.completed }}
          accessibilityLabel={r.completed ? `恢复 ${r.text}` : `完成 ${r.text}`}
          style={s.checkTarget}
        >
          <View
            style={[
              s.checkCircle,
              {
                borderColor: p.muted,
                backgroundColor: r.completed ? p.soft : "transparent",
              },
            ]}
          >
            <Text style={{ color: p.ink, fontSize: 12 }}>
              {r.completed ? "✓" : ""}
            </Text>
          </View>
        </Pressable>
      </View>
    );
  }
  const appearanceControl = (
    <Pressable
      disabled={busy}
      accessibilityRole="switch"
      accessibilityState={{ checked: dark }}
      accessibilityLabel="夜间模式"
      onPress={() => {
        void run(() =>
          commit({ ...stateRef.current, appearance: dark ? "light" : "dark" }),
        );
      }}
      style={[
        s.themeToggle,
        {
          backgroundColor: dark ? orange : p.soft,
          borderColor: dark ? orange : p.line,
        },
      ]}
    >
      <Text style={{ color: dark ? "#111111" : p.ink, fontSize: 12 }}>
        ☾ 夜间模式
      </Text>
    </Pressable>
  );
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      disabled={disabled || busy}
      onPress={onPress}
      accessibilityRole="button"
      style={[s.primary, { opacity: disabled || busy ? 0.6 : 1 }]}
    >
      {busy ? (
        <ActivityIndicator color="#111111" />
      ) : (
        <Text style={s.primaryText}>{label}</Text>
      )}
    </Pressable>
  );

  if (!ready)
    return (
      <SafeAreaView style={[s.screen, { backgroundColor: p.bg }]}>
        <ActivityIndicator color={orange} style={{ marginTop: 100 }} />
      </SafeAreaView>
    );
  if (loadError)
    return (
      <SafeAreaView style={[s.screen, { backgroundColor: p.bg, padding: 28 }]}>
        <Text style={[s.heading, { color: p.ink }]}>数据读取未完成</Text>
        <Text style={[s.info, { color: p.muted }]}>{loadError}</Text>
        {button("导出原始数据", () => {
          void AsyncStorage.getItem(KEY)
            .then((raw) =>
              Share.share({ message: raw ?? "没有找到本地数据。" }),
            )
            .catch((e) => Alert.alert("导出失败", errorText(e)));
        })}
        <Text style={[s.info, { color: p.muted }]}>
          原数据已保留，没有自动重置或覆盖。
        </Text>
      </SafeAreaView>
    );
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[s.screen, { backgroundColor: p.bg }]}
    >
      <StatusBar style={dark ? "light" : "dark"} />
      <View style={s.appearanceRow}>{appearanceControl}</View>
      <View style={s.content}>
        <View style={s.header}>
          <View>
            <Text style={[s.eyebrow, { color: p.muted }]}>
              {new Date(clock).getMonth() + 1}月{new Date(clock).getDate()}日 ·
              星期{"日一二三四五六"[new Date(clock).getDay()]}
            </Text>
            <Text style={[s.brand, { color: p.ink }]}>
              到点<Text style={{ color: orange }}>.</Text>
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="提醒设置"
            onPress={() => setSettings(true)}
            style={s.settingsButton}
          >
            <Text style={{ color: p.muted, fontSize: 13 }}>提醒设置</Text>
          </Pressable>
        </View>
        <View style={s.tabs}>
          {(
            [
              { key: "reminders", label: "提醒" },
              { key: "today", label: "今日记录" },
              { key: "cards", label: "记录卡" },
            ] as const
          ).map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item.key }}
              onPress={() => setTab(item.key)}
              style={[
                s.tabButton,
                {
                  backgroundColor: tab === item.key ? p.soft : "transparent",
                  borderBottomColor: tab === item.key ? orange : "transparent",
                },
              ]}
            >
              <Text
                style={{
                  color: p.ink,
                  fontSize: 13,
                  fontWeight: tab === item.key ? "700" : "400",
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={s.sectionHeader}>
          <Text style={{ color: p.muted, fontSize: 12 }}>
            {tab === "reminders"
              ? "接下来"
              : tab === "today"
                ? "每一个到点的时刻"
                : "按日期收好每一份记录"}
          </Text>
          <Text style={{ color: p.muted, fontSize: 12 }}>
            {tab === "reminders"
              ? `${pending.length} 件小事`
              : tab === "today"
                ? `${todayEntries.filter((e) => e.answer).length} / ${todayEntries.length} 已记录`
                : ""}
          </Text>
        </View>
        <ScrollView
          style={s.list}
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {tab === "reminders" && (
            <>
              <View
                style={{
                  borderTopColor: p.line,
                  borderTopWidth: pending.length ? StyleSheet.hairlineWidth : 0,
                }}
              >
                {pending.map(renderRow)}
              </View>
              {!pending.length && (
                <View style={s.empty}>
                  <Text style={[s.emptyTitle, { color: p.ink }]}>
                    给要做的事，留个时间。
                  </Text>
                  <Text style={[s.info, { color: p.muted }]}>
                    点下方「记一件事」，添加第一条提醒。
                  </Text>
                </View>
              )}
              {!!done.length && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showDone }}
                  onPress={() => setShowDone(!showDone)}
                  style={s.completedToggle}
                >
                  <Text style={{ color: p.muted, fontSize: 12 }}>
                    {showDone ? "⌃" : "⌄"} 已完成 {done.length}
                  </Text>
                </Pressable>
              )}
              {showDone && done.map(renderRow)}
            </>
          )}
          {tab === "today" && (
            <>
              {!todayEntries.length && (
                <View style={s.empty}>
                  <Text style={[s.emptyTitle, { color: p.ink }]}>
                    让这一刻，留下点什么。
                  </Text>
                  <Text style={[s.info, { color: p.muted }]}>
                    提醒到点后，点击顶部卡片写记录；也可以回来这里补记。
                  </Text>
                </View>
              )}
              {todayEntries.map((entry) => (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityLabel={`记录 ${entryTime(entry)} ${entry.question}`}
                  onPress={() => openRecord(entry)}
                  style={[s.journalRow, { borderBottomColor: p.line }]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "baseline",
                      gap: 14,
                    }}
                  >
                    <Text style={[s.rowTime, { color: p.accentText }]}>
                      {entryTime(entry)}
                    </Text>
                    <Text style={[s.rowText, { color: p.ink, flex: 1 }]}>
                      {entry.question}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={2}
                    style={{
                      color: entry.answer ? p.ink : p.muted,
                      fontSize: 14,
                      lineHeight: 23,
                      marginTop: 10,
                    }}
                  >
                    {entry.answer || "未记录 · 点此写下此刻"}
                  </Text>
                </Pressable>
              ))}
            </>
          )}
          {tab === "cards" && (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  gap: 8,
                  paddingVertical: 8,
                  paddingBottom: 20,
                }}
              >
                {[
                  today,
                  ...state.journal.cards
                    .map((c) => c.day)
                    .filter((day) => day < today),
                ].map((day) => (
                  <Pressable
                    key={day}
                    accessibilityRole="button"
                    accessibilityState={{ selected: cardDay === day }}
                    accessibilityLabel={`查看${day}记录卡`}
                    onPress={() => setCardDay(day)}
                    style={[
                      s.dayChip,
                      {
                        borderColor: cardDay === day ? orange : p.line,
                        backgroundColor:
                          cardDay === day ? p.soft : "transparent",
                      },
                    ]}
                  >
                    <Text style={{ color: p.ink, fontSize: 12 }}>
                      {day === today
                        ? "今天"
                        : day.slice(5).replace("-", "月") + "日"}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <DailyRecordCard
                ref={cardRef}
                day={cardDay}
                entries={cardEntries}
                p={p}
                preview={cardDay === today}
                onEntry={openRecord}
                onHeight={(height) => {
                  cardHeight.current = height;
                }}
              />
              <Text style={[s.info, { color: p.muted }]}>
                {cardDay === today
                  ? "按每天 00:00 分日。App 关闭期间的卡片，会在下次打开时自动补齐。"
                  : "点一条事项可以补写或修改回答，原问题和时间会保留。"}
              </Text>
              <Pressable
                accessibilityRole="button"
                style={[s.secondary, { borderColor: p.line, marginTop: 4 }]}
                onPress={textCard}
              >
                <Text style={{ color: p.ink }}>分享文字</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
        {!!notice && (
          <Text
            accessibilityLiveRegion="polite"
            style={[s.notice, { color: p.muted }]}
          >
            {notice}
          </Text>
        )}
        {tab === "reminders"
          ? button("＋  记一件事", () => edit())
          : tab === "today"
            ? button("查看今日记录卡", () => {
                setCardDay(today);
                setTab("cards");
              })
            : button(
                "导出记录卡图片",
                () => {
                  void run(() => shareCard(cardRef, cardHeight.current));
                },
                Platform.OS === "web" || !cardEntries.length,
              )}
      </View>
      {incoming && (
        <View
          accessibilityLiveRegion="polite"
          style={[s.incoming, { backgroundColor: p.card, borderColor: p.line }]}
        >
          <Pressable
            accessibilityLabel="关闭提醒卡片"
            onPress={() => setIncoming(null)}
            style={s.dismiss}
          >
            <Text style={{ color: p.ink }}>×</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              openIncoming(incoming);
            }}
            style={s.incomingMain}
          >
            <View style={s.clockBox}>
              <Text style={[s.clockText, { color: p.ink }]}>
                {incoming.time}
              </Text>
            </View>
            <Text style={[s.incomingText, { color: p.ink }]}>
              {incoming.text}
            </Text>
          </Pressable>
          <View style={[s.incomingActions, { borderTopColor: p.line }]}>
            <Pressable
              disabled={busy}
              style={s.incomingAction}
              onPress={() => {
                void snooze();
              }}
            >
              <Text style={{ color: p.ink }}>10 分钟后</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              style={s.incomingAction}
              onPress={() => openIncoming(incoming)}
            >
              <Text style={{ color: p.ink }}>写记录</Text>
            </Pressable>
          </View>
        </View>
      )}
      <RecordDialog
        entry={recordEntry}
        p={p}
        busy={busy}
        error={formError}
        onCancel={() => setRecordEntry(null)}
        onSave={(entry, value) => {
          void saveRecord(entry, value);
        }}
      />
      <Modal
        visible={editor}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (!busy) setEditor(false);
        }}
      >
        <SafeAreaView style={[s.screen, { backgroundColor: p.bg }]}>
          <StatusBar style={dark ? "light" : "dark"} />
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={s.editorHeader}>
              <Pressable
                disabled={busy}
                onPress={() => setEditor(false)}
                style={s.textTarget}
              >
                <Text style={{ color: p.muted }}>取消</Text>
              </Pressable>
              <Text style={[s.heading, { color: p.ink }]}>
                {editingId ? "编辑提醒" : "新建提醒"}
              </Text>
              <View style={{ width: 48 }} />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.editorContent}
            >
              <Text style={[s.fieldLabel, { color: p.muted }]}>
                到时，提醒我
              </Text>
              <TextInput
                accessibilityLabel="提醒事项"
                value={text}
                onChangeText={setText}
                placeholder="要做什么？"
                placeholderTextColor={p.muted}
                maxLength={120}
                multiline
                editable={!busy}
                style={[
                  s.textInput,
                  { color: p.ink, borderBottomColor: p.line },
                ]}
                selectionColor={orange}
              />
              <Text style={[s.fieldLabel, { color: p.muted, marginTop: 28 }]}>
                {repeat === "once" ? "提醒日期与时间" : "每天提醒的时间"}
              </Text>
              {Platform.OS === "web" ? (
                <View style={s.webDateFields}>
                  <TextInput
                    accessibilityLabel="日期 YYYY-MM-DD"
                    style={[s.webDate, { color: p.ink, borderColor: p.line }]}
                    value={`${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`}
                    onChangeText={(v) => {
                      const d = new Date(v + "T" + timeLabel(at));
                      if (Number.isFinite(d.getTime())) setAt(d);
                    }}
                  />
                  <TextInput
                    accessibilityLabel="时间 HH:MM"
                    style={[s.webDate, { color: p.ink, borderColor: p.line }]}
                    value={timeLabel(at)}
                    onChangeText={(v) => {
                      const [h, m] = v.split(":").map(Number);
                      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                        const d = new Date(at);
                        d.setHours(h, m, 0, 0);
                        setAt(d);
                      }
                    }}
                  />
                </View>
              ) : (
                <DateTimePicker
                  value={at}
                  mode={repeat === "once" ? "datetime" : "time"}
                  display="spinner"
                  onChange={(_, d) => {
                    if (d) setAt(d);
                  }}
                  locale="zh-CN"
                  themeVariant={dark ? "dark" : "light"}
                  textColor={p.ink}
                  accentColor={orange}
                  minimumDate={repeat === "once" ? new Date() : undefined}
                  style={{ width: "100%" }}
                />
              )}
              <Text style={[s.fieldLabel, { color: p.muted, marginTop: 20 }]}>
                重复
              </Text>
              <View style={s.repeatChoices}>
                {(["once", "daily", "weekdays"] as Repeat[]).map((value) => (
                  <Pressable
                    key={value}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: repeat === value }}
                    onPress={() => setRepeat(value)}
                    style={[
                      s.repeatChoice,
                      {
                        borderColor: repeat === value ? orange : p.line,
                        backgroundColor:
                          repeat === value ? p.soft : "transparent",
                      },
                    ]}
                  >
                    <Text style={{ color: p.ink, fontSize: 13 }}>
                      {repeatLabels[value]}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {repeat !== "once" && (
                <Text style={[s.info, { color: p.muted }]}>
                  从下一个符合条件的时间开始，按手机当地时间重复。
                </Text>
              )}
              <View style={s.deliveryRow}>
                <Text style={{ color: p.ink, fontSize: 13 }}>提醒方式</Text>
                <Text style={{ color: p.muted, fontSize: 12 }}>无提示音</Text>
              </View>
              <Text style={[s.info, { color: p.muted }]}>
                App 内收到提醒时震动。锁屏亮屏、后台震动和系统横幅由 iOS 管理。
              </Text>
              {!!formError && (
                <Text
                  accessibilityRole="alert"
                  style={[s.info, { color: p.accentText }]}
                >
                  {formError}
                </Text>
              )}
            </ScrollView>
            <View style={s.editorFooter}>
              {button("保存提醒", () => {
                void save();
              })}
              {selected && (
                <Pressable
                  disabled={busy}
                  onPress={() => remove(selected)}
                  style={s.textTarget}
                >
                  <Text style={{ color: p.accentText }}>删除提醒</Text>
                </Pressable>
              )}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={settings}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSettings(false)}
      >
        <SafeAreaView style={[s.screen, { backgroundColor: p.bg }]}>
          <StatusBar style={dark ? "light" : "dark"} />
          <View style={s.editorHeader}>
            <Pressable onPress={() => setSettings(false)} style={s.textTarget}>
              <Text style={{ color: p.muted }}>返回</Text>
            </Pressable>
            <Text style={[s.heading, { color: p.ink }]}>提醒设置</Text>
            <View style={{ width: 48 }} />
          </View>
          <ScrollView contentContainerStyle={s.settingsContent}>
            <Text style={[s.settingsTitle, { color: p.ink }]}>
              安静地，记住一件事。
            </Text>
            <Text style={[s.info, { color: p.muted }]}>
              所有通知都不播放提示音。备忘和配色保存在这部手机上，不上传备忘内容。
            </Text>
            <View style={[s.settingsSection, { borderColor: p.line }]}>
              <Text style={[s.heading, { color: p.ink }]}>
                系统通知 · {allowed ? "已允许" : "尚未开启"}
              </Text>
              <Text style={[s.info, { color: p.muted }]}>
                {deviceNotificationsAvailable
                  ? "开启通知后，可在锁屏和其他 App 上方收到系统提醒。"
                  : "这是浏览器开发预览；系统通知需要在 iPhone 中测试。"}
              </Text>
              {button(
                allowed ? "检查并恢复提醒安排" : "开启通知",
                () => {
                  void enableNotifications();
                },
                !deviceNotificationsAvailable,
              )}
            </View>
            <View style={[s.settingsSection, { borderColor: p.line }]}>
              <Text style={[s.heading, { color: p.ink }]}>真机测试</Text>
              <Text style={[s.info, { color: p.muted }]}>
                设定 10 秒后的真实通知，然后锁屏检查。App
                内的橙色时间卡片是自定义样式；系统横幅保留 iOS 的样式。
              </Text>
              {button(
                "10 秒后测试",
                () => {
                  void testNotification();
                },
                !deviceNotificationsAvailable,
              )}
            </View>
            <Text style={[s.info, { color: p.muted }]}>
              {isExpoGo ? "在 Expo Go 中，通知设置属于 Expo Go。" : ""}
              低电量模式、专注模式、通知预览与触感设置都可能影响提醒效果。关闭提示音后，后台震动无法由此版本保证。
            </Text>
            <Pressable
              onPress={() => {
                void Share.share({
                  message: JSON.stringify(stateRef.current, null, 2),
                }).catch((e) => Alert.alert("导出失败", errorText(e)));
              }}
              style={[s.secondary, { borderColor: p.line }]}
            >
              <Text style={{ color: p.ink }}>导出我的备忘备份</Text>
            </Pressable>
            <Text style={[s.info, { color: p.muted }]}>
              1.1.0 · 到点 · {isExpoGo ? "Expo Go 体验版" : "独立安装版"}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 8, marginBottom: 22 },
  tabButton: {
    minHeight: 44,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderBottomWidth: 2,
  },
  journalRow: {
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayChip: {
    paddingHorizontal: 13,
    minHeight: 42,
    justifyContent: "center",
    borderRadius: 11,
    borderWidth: 1,
  },
  screen: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 26, paddingBottom: 20 },
  appearanceRow: {
    alignItems: "flex-end",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  themeToggle: {
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 32,
  },
  eyebrow: { fontSize: 12, letterSpacing: 1, marginBottom: 7 },
  brand: { fontSize: 38, fontWeight: "800", letterSpacing: -1.5 },
  settingsButton: {
    minHeight: 44,
    minWidth: 72,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  list: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 88,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 19,
  },
  rowTime: {
    fontSize: 22,
    fontWeight: "700",
    minWidth: 62,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.7,
  },
  rowCopy: { flex: 1 },
  rowText: { fontSize: 16, fontWeight: "700", lineHeight: 24 },
  rowMeta: { fontSize: 11, lineHeight: 18, marginTop: 4 },
  checkTarget: {
    width: 44,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircle: {
    width: 21,
    height: 21,
    borderWidth: 1,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  primary: {
    backgroundColor: orange,
    minHeight: 54,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
  },
  primaryText: { color: "#111111", fontSize: 15, fontWeight: "700" },
  completedToggle: {
    minHeight: 48,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  empty: { paddingTop: 58, paddingBottom: 40 },
  emptyTitle: { fontSize: 19, fontWeight: "600", lineHeight: 30 },
  info: { fontSize: 12, lineHeight: 21, marginVertical: 10 },
  notice: { fontSize: 12, lineHeight: 20, marginVertical: 12 },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  heading: { fontSize: 17, fontWeight: "700" },
  textTarget: {
    minHeight: 44,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  editorContent: { paddingHorizontal: 26, paddingTop: 28, paddingBottom: 28 },
  fieldLabel: { fontSize: 12, marginBottom: 12 },
  textInput: {
    fontSize: 26,
    fontWeight: "600",
    lineHeight: 38,
    minHeight: 112,
    paddingBottom: 22,
    borderBottomWidth: StyleSheet.hairlineWidth,
    textAlignVertical: "top",
  },
  repeatChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  repeatChoice: {
    minHeight: 44,
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
  },
  deliveryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 28,
  },
  editorFooter: { paddingHorizontal: 26, paddingBottom: 18, gap: 6 },
  settingsContent: { paddingHorizontal: 26, paddingTop: 28, paddingBottom: 30 },
  settingsTitle: { fontSize: 26, lineHeight: 38, fontWeight: "700" },
  settingsSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 24,
    marginTop: 24,
    paddingBottom: 4,
  },
  secondary: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 22,
  },
  incoming: {
    position: "absolute",
    top: 68,
    left: 14,
    right: 14,
    borderWidth: 1,
    borderRadius: 22,
    padding: 15,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  incomingMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingTop: 6,
  },
  clockBox: {
    width: 68,
    height: 68,
    borderWidth: 4,
    borderColor: orange,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  clockText: {
    fontSize: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.7,
  },
  incomingText: {
    flex: 1,
    textAlign: "center",
    fontSize: 19,
    fontWeight: "800",
    lineHeight: 28,
  },
  dismiss: {
    position: "absolute",
    right: 0,
    top: -8,
    width: 38,
    height: 38,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  incomingActions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingTop: 6,
    flexDirection: "row",
  },
  incomingAction: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  webDateFields: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  webDate: {
    minWidth: 110,
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
});
