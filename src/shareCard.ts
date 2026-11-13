import type { RefObject, ElementRef } from "react";
import type { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
export async function shareCard(
  ref: RefObject<ElementRef<typeof View> | null>,
  height: number,
) {
  if (!ref.current) throw new Error("请先打开记录卡。");
  if (height > 16000)
    throw new Error(
      "记录卡较长，暂时无法导出完整图片。可以使用「分享文字」保留全部内容。",
    );
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("这台设备暂时无法分享图片，请使用「分享文字」。");
  const uri = await captureRef(ref, {
    format: "png",
    quality: 1,
    result: "tmpfile",
  });
  await Sharing.shareAsync(uri, {
    mimeType: "image/png",
    dialogTitle: "分享这一日的记录",
    UTI: "public.png",
  });
}
