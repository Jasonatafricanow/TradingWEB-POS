# TradingWEB POS

**An offline-first React Native / Expo point-of-sale client for TradingWEB.**

The engineering problem is not rendering a checkout screen. A store terminal must continue operating through weak networks, reconnect without duplicating orders, work with inconsistent hardware, preserve local operator state, and still defer business authority to the backend where appropriate.

## Portfolio role

```text
Cashier / store hardware
          |
          v
    TradingWEB POS
 local interaction + offline state
          |
          v
      TradingWEB
 orders / inventory / business authority
```

The POS is a client of [TradingWEB](https://github.com/Jasonatafricanow/TradingWEB), not a second independent commerce backend.

## The problem

Physical retail introduces failure modes that a normal web checkout can often ignore:

- connectivity can disappear during a sale;
- the same queued order may be retried several times;
- scanners and printers expose different transports;
- multiple staff share one device;
- discounts, refunds, and inventory adjustments need different authority;
- local data has to survive app restarts without becoming the final business truth.

These constraints drove the architecture.

## How the design evolved

### 1. Offline support became a state model, not a banner

"Offline mode" is useful only if the app knows which operations are local, which must sync, which are already acknowledged, and which can be replayed safely.

Orders therefore enter a pending synchronization path instead of pretending a failed request is a completed remote transaction.

### 2. Retry required idempotency across the client/server boundary

Reconnection makes duplicate submission normal. Each order carries a stable `client_ref`; TradingWEB uses that key to recognize retries instead of creating a second order.

### 3. Hardware differences required adapters

Camera scanning, HID scanners, Bluetooth devices, network printers, and system print services should not leak implementation details into cart and checkout logic.

Scanner and printer behavior is therefore isolated behind hardware abstractions.

### 4. Shared devices required local authority controls

Fast cashier switching, manager approvals, PIN throttling, secure token storage, and operation history are local operational concerns even though central business state belongs to TradingWEB.

## Key design decisions

### Offline-first, server-authoritative

The client may temporarily own pending work. It does not redefine canonical server orders or inventory.

### Idempotent resynchronization

Network recovery should replay intent, not duplicate effects.

### Hardware behind interfaces

Cart and order flows consume scanner/printer abstractions instead of transport-specific APIs.

### Sensitive actions are explicit

Refunds, discounts, settings, and inventory changes can require manager authorization rather than relying on UI obscurity.

### Local credentials use platform security primitives

Authentication material is stored through secure platform storage rather than ordinary application persistence.

## Architecture

```text
Camera / HID / BLE scanner       Printer / System print
           \                         /
            v                       v
              Hardware abstraction
                      |
                      v
           POS application state
       auth / cart / shift / settings
                      |
             online / offline queue
                      |
                      v
               TradingWEB API
              client_ref boundary
```

## Current implementation

The repository includes:

- product / variant lookup and cart;
- barcode scanning through multiple input paths;
- discounts and promotions;
- split-payment flows;
- returns / exchanges;
- inventory operations;
- cashier / shift workflows;
- receipt generation and printing abstractions;
- local persistence and offline queueing;
- idempotent synchronization;
- secure token storage;
- manager approval gates;
- local activity-log integrity checks.

## Verification

The project has separate unit and native-oriented test commands plus linting, type checking, bundling, and Android build helpers.

```bash
npm ci
npm run typecheck
npm test
npm run lint
```

## Boundaries and non-claims

This repository is not presented as a drop-in replacement for every commercial POS deployment.

Real scanner, printer, Bluetooth, USB, and device behavior depends on platform builds and physical hardware. Demo mode and automated tests establish software contracts; they do not substitute for certification against every device model or payment terminal.

## Stack

React Native · Expo · TypeScript · Zustand · SecureStore · Vitest · Jest

## Run

```bash
npm ci
npx expo start
```

Native builds are required for hardware paths that Expo Go cannot expose.

## Repository history

This public repository is a cleaned publication of an earlier project line. The initial public commit is the publication baseline, not the complete development history.

## Engineering philosophy

Offline systems should not hide uncertainty.

The client should know what is local, what is pending, what has been accepted remotely, and what may be retried. Reliability comes from explicit state and idempotency, not from assuming the network behaves.
