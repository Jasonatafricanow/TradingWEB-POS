# TradingWEB POS — Development and Verification Notes

This document records the architecture intent behind the mobile POS. Current code, tests,
CI and backend contracts are stronger authority than historical feature descriptions.

## 1. Offline state is not server authority

The client needs local state because connectivity can disappear during a store workflow.
That does not make local storage the final business authority.

The design therefore separates:

```text
local pending intent
        !=
server-accepted business effect
```

A locally created `client_ref` accompanies retried order submission so TradingWEB can
recognize repeated delivery of the same intended transaction.

## 2. Hardware sits behind adapters

Scanner and receipt/print behavior are separated from checkout/domain state. Camera, HID,
BLE, TCP and system-level mechanisms have different capabilities and failure modes; the
application should not require checkout logic to know the transport details.

Public source and automated tests can verify adapter behavior and bundling, but physical
hardware compatibility remains a separate empirical question.

## 3. Local credential/control boundary

The application uses `expo-secure-store` for application tokens and implements staff PIN
lockout/rate behavior plus integrity checks for local activity records.

The current local PIN representation uses a salted iterated SHA-256 format. This file does
not label that mechanism "enterprise-grade" or equivalent to a modern password KDF. It is
a local application control and should be evaluated against the deployment threat model;
TradingWEB remains responsible for server-side authentication/authorization.

## 4. HTTPS correction

The public release was followed by a security/CI correction that requires HTTPS for POS
server connections and restores the main-branch quality gate. This is intentionally visible
in Git history rather than presented as if the initial release already had the boundary.

## 5. Automated verification

Current GitHub Actions runs:

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run i18n:check
npm run bundle:android
```

These checks cover code/test/bundle integration. Physical scanner/printer testing, battery
behavior, long-duration operation and real store recovery should be reported separately
when performed.
