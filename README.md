# TradingWEB POS

[English](README.md) | [简体中文](README.zh-CN.md)

An offline-first Expo / React Native checkout client for TradingWEB. Cashiers can queue sales locally and submit them with stable `client_ref` identities when synchronization runs.

## Engineering details

- Idempotent order submission and HMAC-protected pending requests.
- Salted, iterated local PIN hashes and a hash-chained audit log.
- Scanner and printer adapters for camera, HID, BLE, TCP and ESC/POS paths.

## Run and verify

```bash
npm ci
npm start
npm run typecheck
npm test
npm run lint
```

Android build commands and integration requirements: [implementation guide](docs/IMPLEMENTATION.md). [Device matrix (Chinese)](docs/设备兼容矩阵.md).

## Field evidence

The [single-store acceptance checklist (Chinese)](docs/单店试点验收清单.md) is still pending. Automated tests and an Android build do not establish in-store acceptance. A demo APK, an offline-to-online recording and real device evidence are still needed. Automatic synchronization runs on startup, foreground entry, newly eligible pending work and network recovery. While foregrounded, retryable pending orders use 3/6/12/24/48/60-second backoff, capped at 60 seconds. Offline/background states pause scheduling; blocked orders remain excluded. Native network detection still needs device verification.

## License

MIT — see [LICENSE](LICENSE).
