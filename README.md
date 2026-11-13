# 到点 / At Time

A minimal, local-first iPhone reminder and reflection journal. Warm cream and black themes share a bright orange accent.

## Features

- One-off, daily and weekday local reminders. Notification sounds are explicitly disabled.
- Tap an in-app reminder, or open a system notification, to write an answer associated with that occurrence.
- Daily record cards keep each time, question and answer together. Unanswered entries remain visible.
- Past questions survive edits and deletion of the original reminder. Late answers update their original daily card.
- Cards are divided at local midnight. If iOS suspended the app, missing cards are assembled when the app next opens; this is not a guarantee of background execution at midnight.
- Share a card as text, or export its image on iPhone.
- All journal data stays in device storage. This repository contains application code, not personal reminders or answers.

## Development

Requires Node.js 24 and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm start
```

Expo Go SDK 58 can run the project. iOS development-server loading requires the same Expo account on the CLI and the phone. A standalone Release build includes its JavaScript bundle and does not use Expo Go or Metro at runtime.

## Free unsigned real-device build

The manually triggered `Free public iOS build (unsigned)` workflow runs only in a **public** repository on the standard `macos-26` runner. It skips private repositories before runner allocation. It does not invoke EAS, use Apple signing credentials, select a larger runner, or upload Actions caches/artifacts. The IPA and checksum are published as Release assets.

The workflow archives for `generic/platform=iOS`, checks arm64, and packages an **unsigned** IPA. This is not an iOS simulator build. The output cannot be installed just by tapping a download link: personal signing is still necessary.

Sideloadly on Windows supports free personal Apple-account signing, typically with a seven-day validity period. Initial installation, renewal, system compatibility and notification behavior still require testing on the device. No paid signing or development account is required by this workflow.

## Platform limits

iOS controls ordinary Lock Screen and cross-app notification presentation. The custom centered recording card is shown inside this app after opening the notification. Background vibration and screen wake cannot be guaranteed, especially with sound disabled. Foreground haptics also depend on system settings and device state.

GitHub's current rules: [public standard runners](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Release asset limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases). Signing: [Sideloadly official FAQ](https://sideloadly.io/faq.html).
