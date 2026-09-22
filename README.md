# TradingWEB POS

TradingWEB POS is an Expo/React Native point-of-sale client for TradingWEB.

It is designed for intermittent connectivity, shared store devices, and hardware that may differ between deployments.

## Order flow

```text
cashier action
    |
    v
local cart / order
    |
    +---- online ------> TradingWEB API
    |
    +---- offline -----> local pending queue
                           |
                           v
                     retry on reconnect
                           |
                           v
                 TradingWEB API + client_ref
```

A queued local order is not treated as a server-accepted order.

Each logical order keeps a stable `client_ref` so reconnect/retry can be idempotent on the server.

## Current implementation

The repository includes:

- product/variant lookup;
- cart and checkout;
- barcode scanning through multiple input paths;
- discounts/promotions;
- split-payment flows;
- returns/exchanges;
- inventory operations;
- cashier/shift workflows;
- receipt generation;
- printer abstractions;
- local persistence;
- offline queueing and resynchronization;
- secure token storage;
- manager approval gates;
- local activity-log integrity checks.

## Hardware

Scanner and printer details sit behind adapters rather than being embedded in cart/order code.

Current paths include camera/HID/Bluetooth-style scanning and printer/system-print abstractions. Physical device behavior still depends on native builds and the actual hardware.

## Shared-device handling

The client includes cashier switching, PIN/manager approval flows, secure credential storage, shift state, and local operation history.

Sensitive actions such as refunds or inventory changes can require explicit approval.

## Verification

```bash
npm ci
npm run typecheck
npm test
npm run lint
```

The repository also contains native bundling/build helpers. Hardware-specific behavior requires device testing in addition to automated tests.

## Run

```bash
npm ci
npx expo start
```

Some scanner/printer paths require a native build and are not available through Expo Go.

## Stack

React Native · Expo · TypeScript · Zustand · SecureStore · Vitest · Jest

## Repository history

This public repository is a cleaned publication of an earlier project line. The initial public commit is the publication baseline rather than the original start date.
