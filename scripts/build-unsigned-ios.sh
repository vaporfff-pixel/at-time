#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This build requires the standard macOS cloud runner, not Windows."
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
export NODE_BINARY="$(command -v node)"
xcodebuild -version
pnpm exec expo prebuild --platform ios --no-install

# The app uses LOCAL notifications only. Free personal provisioning cannot use
# the paid APNs capability. Fail rather than silently carrying that entitlement.
python3 - <<'PY'
from pathlib import Path
import plistlib
files = list(Path('ios').glob('*/*.entitlements'))
if not files:
    raise SystemExit('Expected generated entitlements file was not found')
for path in files:
    data = plistlib.loads(path.read_bytes())
    if 'aps-environment' in data or 'com.apple.developer.aps-environment' in data:
        raise SystemExit(f'Remote push entitlement must be disabled: {path}')
print('Verified: no APNs entitlement; local notifications retained')
PY

(cd ios && pod install)
workspace="$(find "$root/ios" -maxdepth 1 -name '*.xcworkspace' -type d -print -quit)"
if [[ -z "$workspace" ]]; then echo "Generated workspace was not found"; exit 1; fi
scheme="$(basename "$workspace" .xcworkspace)"
mkdir -p "$root/build/package/Payload"

xcodebuild \
  -workspace "$workspace" \
  -scheme "$scheme" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -archivePath "$root/build/AtTime.xcarchive" \
  -derivedDataPath "$root/build/DerivedData" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  archive

app="$(find "$root/build/AtTime.xcarchive/Products/Applications" -maxdepth 1 -name '*.app' -type d -print -quit)"
if [[ -z "$app" ]]; then echo "Real-device application was not produced"; exit 1; fi
executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist")"
lipo -verify_arch arm64 "$app/$executable"
ditto "$app" "$root/build/package/Payload/$(basename "$app")"
(cd "$root/build/package" && zip -qry "$root/build/AtTime-unsigned.ipa" Payload)
(cd "$root/build" && shasum -a 256 AtTime-unsigned.ipa > SHA256SUMS)

cat > "$root/build/RELEASE_NOTES.txt" <<'NOTES'
到点 · 未签名 iPhone 真机包

该包不能直接点击安装。需要在 Windows 上使用 Sideloadly 和自己的免费 Apple 账号签名后安装；免费签名通常每 7 天续签一次。
这是 Release 构建，JavaScript 已随包内置，不依赖 Expo Go 或电脑开发服务器运行。
构建没有使用 Apple 付费账号、EAS 付费构建或第三方签名服务。

所有通知禁用提示音。App 内显示自定义卡片并请求触感反馈；系统通知外观、锁屏亮屏及后台触感仍受 iOS 管理，需真机测试。
请验证 SHA256SUMS。签名、安装、提醒和 iOS 27.0.1 兼容性均须分别验收；构建成功不代表已经安装成功。
NOTES

echo "Unsigned IPA prepared. Installability still requires personal signing."
