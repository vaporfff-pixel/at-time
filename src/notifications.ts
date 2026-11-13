import * as Notifications from "expo-notifications";
import * as Haptics from "expo-haptics";
import { AppState } from "react-native";
import { contentFor } from "./scheduler";
import type { NotificationPort } from "./scheduler";
import type { Plan } from "./domain";
import type { Incoming } from "./journal";
export type { Incoming } from "./journal";
function message(n: Notifications.Notification): Incoming {
  const d = n.request.content.data ?? {};
  const version = n.request.identifier.split("/")[3];
  return {
    reminderId: String(d.reminderId),
    time: String(d.time),
    text: String(d.text),
    revisionId:
      typeof d.revisionId === "string"
        ? d.revisionId
        : version
          ? `${d.reminderId}:${version}`
          : undefined,
    at: typeof d.at === "string" ? d.at : undefined,
    repeat:
      d.repeat === "daily" || d.repeat === "weekdays" || d.repeat === "once"
        ? d.repeat
        : undefined,
    deliveredAt: new Date(n.date).toISOString(),
  };
}
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
export const port: NotificationPort = {
  list: async () =>
    (await Notifications.getAllScheduledNotificationsAsync()).map(
      (r) => r.identifier,
    ),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  schedule: async (plan: Plan) => {
    const t = plan.trigger;
    const trigger: Notifications.NotificationTriggerInput =
      "date" in t
        ? {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(t.date),
          }
        : {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            hour: t.hour,
            minute: t.minute,
            second: 0,
            ...(t.weekday ? { weekday: t.weekday } : {}),
            repeats: true,
          };
    await Notifications.scheduleNotificationAsync({
      identifier: plan.id,
      content: contentFor(plan),
      trigger,
    });
  },
};
export async function permission(request = false) {
  let p = await Notifications.getPermissionsAsync();
  if (
    request &&
    p.canAskAgain &&
    p.ios?.status !== Notifications.IosAuthorizationStatus.AUTHORIZED
  )
    p = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowSound: false,
        allowBadge: false,
        allowProvisional: false,
      },
    });
  return {
    allowed:
      p.granted ||
      p.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
      p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
    canAsk: p.canAskAgain,
  };
}
export function listen(
  onIncoming: (message: Incoming) => void,
  onOpen: (message: Incoming) => void,
) {
  const receive = Notifications.addNotificationReceivedListener((n) => {
    const d = n.request.content.data ?? {};
    if (d.app !== "at-time" || AppState.currentState !== "active") return;
    onIncoming(message(n));
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {});
  });
  const open = Notifications.addNotificationResponseReceivedListener((r) => {
    const d = r.notification.request.content.data ?? {};
    if (d.app === "at-time") onOpen(message(r.notification));
  });
  void Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      const d = r?.notification.request.content.data;
      if (d?.app === "at-time") {
        onOpen(message(r!.notification));
        void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    })
    .catch(() => {});
  return () => {
    receive.remove();
    open.remove();
  };
}
export const deviceNotificationsAvailable = true;
