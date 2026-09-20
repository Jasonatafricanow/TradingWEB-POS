# Android Runtime Measurement Method

Use the same physical device or emulator, Android image, app data fixture,
release artifact type, power mode, and network conditions for both sides of a
comparison. Enable release diagnostics with
`EXPO_PUBLIC_PERF_DIAGNOSTICS=1` before building.

The harness installs the supplied APK, performs two excluded warm-ups, then
runs at least ten cold launches. It records Android `am start -W`, the
application's monotonic `cold_start` mark, `dumpsys gfxinfo`, and
`dumpsys meminfo`. Raw output and aggregates are written below the ignored
`.perf-results/` directory.

Run from the repository root:

```powershell
npm.cmd run perf:android -- -ArtifactPath android/app/build/outputs/apk/release/app-release.apk
```

For list and memory comparisons, seed the same 500-product and
100-pending-order fixture, clear `gfxinfo`, perform the same register search,
scroll, add-to-cart, cart-edit, and orders-scroll gestures, then capture the
post-scenario `gfxinfo` and `meminfo` output. Keep raw evidence with the source
commit and artifact SHA-256.

The command fails when the artifact is missing, ADB is unavailable, there is
not exactly one authorized target, launch status is not `ok`, or fewer than the
requested valid samples contain the application mark. If a target is not
available, runtime results must be reported as `not measured`.
