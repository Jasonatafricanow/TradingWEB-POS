# TradingWEB POS

TradingWEB POS is a React Native / Expo client for store-side sales workflows that connect
to TradingWEB. The project focuses on three engineering problems:

- keeping a store workflow usable when connectivity is unreliable;
- separating hardware-specific behavior behind adapters;
- preventing retries from becoming duplicate server-side business effects.

It includes a local demo/mock mode, but demo completeness should not be read as proof that
every live hardware/payment path has been field-validated.

## Runtime shape

```text
cashier / scanner / local UI
          |
          v
cart + shift + local pending state
          |
          +--> hardware adapters (scanner / receipt / print)
          |
          v
TradingWEB API adapter
          |
          v
server-side order / inventory authority
```

## Offline and retry boundary

A sale that cannot reach the server can remain pending locally and be retried later.
`client_ref` is the cross-boundary idempotency identifier used so repeated submission can
represent the same intended transaction instead of a new order.

The POS client does not become the final authority for shared business state merely because
it can operate offline.

## Hardware abstraction

The repository separates scanner and receipt/printing concerns from checkout logic:

```text
src/hardware/scanner/
src/hardware/printer/
```

The implementation contains adapters for camera/HID/BLE/TCP/system-print related paths.
The public repository and CI do **not** by themselves prove compatibility with every
physical scanner or printer model. See `docs/` for the current contracts and compatibility
notes.

## Authentication and local controls

- application tokens use `expo-secure-store` rather than ordinary application storage;
- staff/manager PIN flows include local rate/lockout behavior;
- sensitive local activity records include a hash-chain integrity mechanism;
- server connections were later hardened to require HTTPS.

The local PIN representation in the current codebase is an application control, not a
claim of server-grade password storage or hardware-backed credential security. Production
deployment should be judged together with TradingWEB's server-side authentication and the
actual device threat model.

## Verification

The GitHub Actions quality gate runs on Windows and currently executes:

```text
npm ci
npm run typecheck
npm test
npm run lint
npm run i18n:check
npm run bundle:android
```

This verifies TypeScript/build/test/lint/native-bundle integration. It does not substitute
for physical-device or long-duration store testing.

Local development:

```bash
npm ci
npx expo start
```

Native builds:

```bash
npx expo run:android
npx expo run:ios
```

## Implemented application surfaces

The source tree contains checkout/cart flows, product/customer/order views, staff/shift
state, offline/pending synchronization, scanner handling, receipt/printing abstractions and
a TradingWEB API adapter.

Useful entry points:

- `docs/BACKEND_API.md` — server contract;
- `docs/设备兼容矩阵.md` — hardware compatibility notes;
- `src/api/` — mock and TradingWEB adapters;
- `src/hardware/` — scanner/printing boundaries;
- `src/stores/` — persisted client state.

## Scope / non-claims

The repository does not by itself establish:

- parity with Shopify POS as a product;
- production operation across a fleet of stores;
- successful validation with every advertised printer/scanner transport;
- payment-network certification;
- long-duration offline recovery under real store load;
- that a successful Android bundle implies physical hardware compatibility.

The useful engineering evidence is narrower: offline/pending state, idempotent server
handoff, hardware abstraction, client security controls and an automated mobile quality
gate.

## Stack

React Native 0.79 · Expo SDK 53 · TypeScript · Zustand · Vitest/Jest

MIT — see [LICENSE](LICENSE).
