# Overlord 2.5.1 Upstream Synchronization Design

## Objective

Integrate the latest `vxaboveground/Overlord:main` release (`2.5.1`, commit
`1bc63640559af4ed1494b3d6b2f46c3bcf0562af`) into OverlordCyrax without
removing or weakening any Cyrax product feature. Release the integrated build
as `2.5.2`, publish it to GitHub, deploy it to the live Docker host, and retain
a tested rollback image.

The standalone Nextcloud/vlog transfer utility under `tools/vlog-transfer/`
is unrelated to Overlord and is excluded from this integration, release,
GitHub changes, and deployment.

## Repository Strategy

The integration branch starts from the clean Cyrax wallpaper checkpoint
`eb5aa63` on `codex/upstream-2.5.1-integration`. This base contains the existing
committed Cyrax product history and the repaired wallpaper transfer, but not
the unrelated vlog transfer commit.

Before merging upstream, copy the uncommitted Cyrax product changes from the
primary workspace into the integration branch and commit them as a preservation
checkpoint. Include the sound settings, notification sounds, soundboard pages,
viewer and split-screen work, webcam pages, deployment routes, WinRE routes,
and their tests. Exclude `tools/vlog-transfer/**` and the obsolete wallpaper
working-plan document.

Merge `upstream/main` with a merge commit. Do not rebase or rewrite the custom
history. The merge commit keeps the upstream boundary auditable and gives the
deployment a clear rollback point.

## Preservation Contract

The integrated product must retain all user-added Overlord functionality,
including:

- Split-screen remote desktop/viewer layouts and related controls.
- Unified desktop and webcam viewing workflows, webcam workspace/multiview,
  gallery behavior, and webcam lock handling.
- Wallpaper upload, real transfer progress, public endpoint discovery,
  remote-file verification, wallpaper application, and detailed failures.
- Trolling tools and the side action panel.
- Sound settings, notification sounds, sound previews, and soundboard pages.
- Cyrax branding, dashboard behavior, bans/removals, and tile limits.
- Deployment and Windows recovery environment routes currently present in the
  customized product.
- Existing custom authentication, console, remote desktop, and agent behavior.

The merge must also retain upstream `2.5.1` improvements, including virtual
mode, privacy selection, taskbar handling, snapping/stopping fixes, ping fixes,
build branding options, and the upstream H.264 hardware/software encoder paths
for AMF, NVENC, Quick Sync, and Media Foundation.

## Conflict Resolution Rules

Resolve each overlapping file by behavior, not by selecting an entire side.

1. Prefer upstream implementations for core transport, protocol compatibility,
   privacy/virtual desktop behavior, encoding, GPU selection, and stability
   fixes.
2. Preserve Cyrax UI, routes, controls, and workflows unless an upstream API
   requires a compatible adaptation.
3. Where both sides extend the same component, combine both behaviors and add
   or update a test that demonstrates each behavior remains available.
4. Preserve upstream defaults unless a Cyrax feature intentionally overrides
   them and the override is covered by a test or a direct UI verification.
5. Do not resolve conflicts by deleting unfamiliar custom code. Trace callers,
   HTML bindings, WebSocket events, and route registration before deciding.

The known overlap set includes server configuration and version files,
authentication and WebSocket handling, remote desktop HTML/JavaScript, shared
navigation/render/settings code, Docker Compose, agent configuration/runtime/
protocol files, tests, and the README. Additional overlaps discovered during
the merge follow the same rules.

## Versioning

Set all product version sources to `2.5.2` in the same integration commit:

- Server package metadata.
- Server runtime version constant.
- Agent version source and any user-visible build metadata.

No product code or UI change may be published or deployed without the version
sources remaining synchronized.

## Verification

Verification has four layers.

### Static and Unit Verification

- Run Bun server tests, including authentication, WebSocket/remote desktop,
  wallpaper routes, file download routes, and custom sound asset tests.
- Run the server TypeScript typecheck.
- Run Go tests for the agent, including handlers and wire protocol packages,
  then broaden to all agent packages if the focused suites pass.
- Run JavaScript syntax checks for modified browser assets where no unit test
  exists.

### Preservation Verification

Add focused assertions or smoke checks for route registration and assets that
are easy to lose in conflict resolution: wallpaper, soundboard, sound settings,
split-screen/viewer, webcams, trolling controls, deploy, and WinRE. Confirm
that the upstream privacy, virtual mode, and encoder controls are also reachable.

### Browser Verification

Run the merged server locally and inspect the main settings, viewer, remote
desktop, webcam, and soundboard surfaces at desktop and mobile widths. Confirm
that controls do not overlap and that the compact wallpaper transfer notice
remains in the bottom-left position.

### Deployment Verification

Build a new Docker image on `root@ratbox`, preserving the current live image
under a timestamped rollback tag. Start the integrated container with the
existing environment, including its externally configured public URL. Verify
container health, server version `2.5.2`, HTTP availability, and recent logs.
Do not remove the rollback image.

## GitHub Delivery

Push `codex/upstream-2.5.1-integration` to the `origin` fork and open a draft
pull request against `GiggleHacks/OverlordCyrax:main`. The pull request must
describe the upstream synchronization, preserved custom features, excluded
Nextcloud utility, version change, test evidence, live deployment result, and
rollback tag. Do not force-push or directly rewrite `main`.

## Failure Handling

If a baseline or merged test fails, determine whether it is pre-existing,
upstream-induced, or caused by conflict resolution before changing code. Do not
paper over failures by removing tests or features. If live health checks fail,
restore the timestamped rollback image and report the failing command, container
state, and relevant log excerpt.

## Completion Criteria

The work is complete only when:

- Upstream `2.5.1` is present in the integration history.
- All listed Cyrax features remain present and verified.
- The vlog/Nextcloud utility is absent from the integration diff.
- All version sources report `2.5.2`.
- Required Bun, TypeScript, Go, JavaScript, and browser checks pass.
- The integration branch and draft pull request are available on GitHub.
- Docker on `root@ratbox` is healthy on `2.5.2`, with a rollback image retained.
- The live progress page reflects actual completion.
- A Telegram completion message reports the work performed and elapsed time.
