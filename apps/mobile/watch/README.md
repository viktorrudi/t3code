# T3 Code Personal on Apple Watch

The native client uses HTTPS and a dedicated Watch gateway. After setup, browsing, replies and voice do not use the iPhone as a network proxy. The gateway forwards commands to the same T3 threads used by the phone and desktop.

## Build and Install

The Watch app is part of the personal iPhone fork. Every `T3CODE_IOS_FORK=1` Expo prebuild embeds the `T3Watch` target from `Sources/` through `plugins/withPersonalWatch.cjs`; upstream builds never include it. Build, archive and deliver it with the iPhone app through the [personal iOS fork release workflow](../README.md#private-updates-through-testflight). The release script rejects an archive without the Watch app, or with a mismatched bundle ID, companion ID, version or build. Installing the TestFlight build on the iPhone offers the Watch app in the iPhone's Watch app.

Use Xcode 26.4 with watchOS platform support. The minimum deployment target is watchOS 10. The bundle ID is `<fork bundle ID>.watchkitapp` (`com.viktorrudi.t3code.watchkitapp`). Register that App ID with Push Notifications in the same team as the phone app, and keep it stable across updates.

For local development, run `vp run ios:fork:release` with `T3CODE_IOS_FORK_TEAM_ID` set, or run Expo prebuild with `T3CODE_IOS_FORK=1` and open `ios/T3CodePersonal.xcworkspace`. Choose the `T3Watch` scheme with a Watch simulator or a paired Watch that has Developer Mode enabled. The native fingerprint includes the Watch sources.

## Prepare the Gateway

Build from an installed repository checkout:

```sh
cd apps/mobile/scripts/watch-gateway
vp pack
```

Copy the resulting repository-root `.t3/watch-gateway/main.mjs` into a private directory outside the repository. Copy `config.example.json`, replace its placeholders, and protect that directory with mode 700. The gateway binds only to loopback. Configure a dedicated, internet-reachable HTTPS origin that forwards only to this gateway. A Tailscale Serve address alone does not establish access from Watch cellular. Preserve the existing T3 and phone notification routes.

Pair the gateway with a fresh T3 pairing-link token carrying `orchestration:read` and `orchestration:operate`. Save the bootstrap token to a private temporary file, then run:

```sh
node main.mjs pair /absolute/config.json ENVIRONMENT_ID /absolute/private/bootstrap-token
```

Delete the bootstrap file after pairing. Use a separate session and credential file from the phone notification hub. Revoking this session stops gateway access to that environment.

Create a private allowlist JSON file mapping environment IDs to project IDs:

```json
{ "ENVIRONMENT_ID": ["PROJECT_ID"] }
```

Issue a dedicated Watch credential and start the gateway:

```sh
node main.mjs invite /absolute/config.json /absolute/allowlist.json
node main.mjs run /absolute/config.json
```

`invite` prints a private setup-file path, never its credentials. The Watch credential expires after 30 days. Add `read-only` to `invite` to disable writes. `revoke /absolute/config.json WATCH_ID` revokes one Watch. Restart is unnecessary for revocation.

Transfer the setup JSON through the companion iPhone's Settings → Notifications → Apple Watch → Connect, or enter it directly on the standalone Watch setup screen. Remove the setup file after transfer. Confirm that only allowlisted projects appear.

## Direct Watch Notifications

Configure an optional `apns` object with `keyPath`, `keyId`, `teamId` and `bundleId`. The topic must be `com.viktorrudi.t3code.watchkitapp`; the key stays on the Mac. The setup JSON contains a separate notification-registration credential that cannot browse or operate T3.

On the Watch, choose Enable notifications. This registers the Watch's own APNs token. The gateway uses the existing hub's candidate projection, durable deduplication and retry logic, with a separate Watch device store. Revoked or expired grants and projects outside the allowlist cannot receive new Watch deliveries. Direct and mirrored phone notifications still require physical testing for cross-topic duplicate presentation.

## Verification Boundary

Source validation is distinct from installation. Native SDK compilation, Expo prebuild and gateway tests do not establish microphone quality, on-screen layout, VoiceOver gestures, signing, or APNs delivery.

Before relying on the app:

1. Complete a signed native build and inspect Overview, scope, long messages, largest text size, Reduce Motion and VoiceOver on the Watch or simulator.
2. Exercise typing, voice consent, interrupted recording, failed upload, retry, persistent drafts and duplicate-safe sends against a sandbox environment.
3. Check both swipe directions, five-second Undo, permanent Wake/Reopen, pending approvals, offline reading and credential revocation.
4. With the phone powered off, test HTTPS browsing, replies and direct notification taps on Wi-Fi and cellular.
5. Measure Czech and English transcription quality and stop-to-draft latency on real Ultra recordings. The current capture settings are a candidate, not a measured quality claim.

New-chat creation currently requires resolved local-workspace defaults. Worktree/container launch, cloud transcription selection, custom project images, the full locale set and guarded undo across concurrent clients need integration before the complete approved acceptance matrix can pass. Approval execution remains on iPhone or Mac, as designed. No App Store or TestFlight upload is performed by the gateway or project generator.
