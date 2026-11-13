import React, { forwardRef, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { JournalEntry } from "./journal";
import { entryTime } from "./journal";
import { orange } from "./theme";
import type { Palette } from "./theme";
import { timeLabel } from "./domain";

export function RecordDialog({
  entry,
  p,
  busy,
  error,
  onCancel,
  onSave,
}: {
  entry: JournalEntry | null;
  p: Palette;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSave: (entry: JournalEntry, text: string) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(entry?.answer ?? "");
  }, [entry?.id]);
  return (
    <Modal
      visible={!!entry}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onCancel();
      }}
    >
      <KeyboardAvoidingView
        style={j.scrim}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[j.dialog, { backgroundColor: p.bg, borderColor: p.line }]}
        >
          <View style={j.dialogHeader}>
            <Text style={{ color: p.muted, fontSize: 12 }}>
              {entry?.day.replaceAll("-", ".") + " · 这次记录"}
            </Text>
            <Pressable
              disabled={busy}
              accessibilityLabel="关闭记录输入"
              onPress={onCancel}
              style={j.close}
            >
              <Text style={{ color: p.ink, fontSize: 23 }}>×</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            <View style={[j.question, { backgroundColor: p.card }]}>
              <View style={j.time}>
                <Text style={[j.timeText, { color: p.ink }]}>
                  {entry ? entryTime(entry) : ""}
                </Text>
              </View>
              <Text style={[j.questionText, { color: p.ink }]}>
                {entry?.question}
              </Text>
            </View>
            <Text style={[j.label, { color: p.muted }]}>写下此刻的记录</Text>
            <TextInput
              accessibilityLabel="这次提醒的记录"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={2000}
              editable={!busy}
              placeholder="此刻发生了什么？你想记住什么？"
              placeholderTextColor={p.muted}
              selectionColor={orange}
              style={[
                j.answerInput,
                { backgroundColor: p.soft, color: p.ink, borderColor: p.line },
              ]}
            />
            {!!error && (
              <Text
                accessibilityRole="alert"
                style={{
                  color: p.accentText,
                  fontSize: 12,
                  lineHeight: 20,
                  marginTop: 10,
                }}
              >
                {error}
              </Text>
            )}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              if (entry) onSave(entry, text);
            }}
            style={[j.confirm, { opacity: busy ? 0.6 : 1 }]}
          >
            {busy ? (
              <ActivityIndicator color="#111" />
            ) : (
              <Text style={{ color: "#111", fontSize: 15, fontWeight: "700" }}>
                确认记录
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export const DailyRecordCard = forwardRef<
  React.ElementRef<typeof View>,
  {
    day: string;
    entries: JournalEntry[];
    p: Palette;
    preview?: boolean;
    onEntry?: (entry: JournalEntry) => void;
    onHeight?: (height: number) => void;
  }
>(function DailyRecordCard(
  { day, entries, p, preview, onEntry, onHeight },
  ref,
) {
  const answered = entries.filter((e) => e.answer).length;
  return (
    <View
      ref={ref}
      collapsable={false}
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      style={[j.dailyCard, { backgroundColor: p.card, borderColor: p.line }]}
    >
      <Text style={{ color: p.muted, fontSize: 11, letterSpacing: 2 }}>
        到点 · 一日记录
      </Text>
      <Text style={[j.dateTitle, { color: p.ink }]}>
        {day.replaceAll("-", ".")}
      </Text>
      <Text
        style={{
          color: p.muted,
          fontSize: 12,
          lineHeight: 20,
          marginBottom: 18,
        }}
      >
        {entries.length} 个时刻 · {answered} 条记录
        {preview ? " · 今日预览" : " · 已归档"}
      </Text>
      {!entries.length && (
        <Text
          style={{
            color: p.muted,
            fontSize: 14,
            lineHeight: 24,
            paddingVertical: 20,
          }}
        >
          这一天还没有到时间的事项。
        </Text>
      )}
      {entries.map((entry) => (
        <Pressable
          key={entry.id}
          accessibilityRole="button"
          accessibilityLabel={`记录 ${entryTime(entry)} ${entry.question}`}
          disabled={!onEntry}
          onPress={() => onEntry?.(entry)}
          style={[j.dailyEntry, { borderTopColor: p.line }]}
        >
          <View style={j.dailyQuestion}>
            <Text
              style={{
                color: p.accentText,
                fontSize: 16,
                fontWeight: "800",
                fontVariant: ["tabular-nums"],
              }}
            >
              {entryTime(entry)}
            </Text>
            <Text
              style={{
                color: p.ink,
                fontSize: 15,
                fontWeight: "700",
                lineHeight: 24,
                flex: 1,
              }}
            >
              {entry.question}
            </Text>
          </View>
          <Text
            style={{
              color: entry.answer ? p.ink : p.muted,
              fontSize: 14,
              lineHeight: 24,
              marginTop: 9,
            }}
          >
            {entry.answer || "未记录"}
          </Text>
        </Pressable>
      ))}
      <Text
        style={{ color: p.muted, fontSize: 11, lineHeight: 18, marginTop: 24 }}
      >
        把每一个时刻，留在这一天。
      </Text>
    </View>
  );
});
const j = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "#00000070",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  dialog: {
    width: "100%",
    maxWidth: 430,
    maxHeight: "90%",
    borderWidth: 1,
    borderRadius: 25,
    padding: 20,
  },
  dialogHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  close: {
    height: 44,
    width: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  question: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 18,
  },
  time: {
    width: 68,
    height: 68,
    borderWidth: 4,
    borderColor: orange,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  timeText: {
    fontSize: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.7,
  },
  questionText: {
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 27,
    textAlign: "center",
  },
  label: { fontSize: 12, marginTop: 25, marginBottom: 12 },
  answerInput: {
    minHeight: 150,
    maxHeight: 280,
    textAlignVertical: "top",
    fontSize: 16,
    lineHeight: 25,
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
  },
  confirm: {
    marginTop: 18,
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: orange,
    justifyContent: "center",
    alignItems: "center",
  },
  dailyCard: { borderWidth: 1, borderRadius: 20, padding: 22 },
  dateTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginTop: 10,
    marginBottom: 7,
  },
  dailyEntry: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 18 },
  dailyQuestion: { flexDirection: "row", gap: 13, alignItems: "baseline" },
});
