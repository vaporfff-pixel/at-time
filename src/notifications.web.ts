import type { NotificationPort } from "./scheduler";
import type { Incoming } from "./notifications";
export type { Incoming };
export const deviceNotificationsAvailable = false;
export const permission = async (_request = false) => ({
  allowed: false,
  canAsk: false,
});
export const port: NotificationPort = {
  list: async () => [],
  cancel: async () => {},
  schedule: async () => {
    throw new Error("请在 iPhone 的 Expo Go 中测试系统通知。");
  },
};
export function listen(
  _receive: (message: Incoming) => void,
  _open: (message: Incoming) => void,
) {
  return () => {};
}
