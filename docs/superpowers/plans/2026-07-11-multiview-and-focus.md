# Multi-View and Focused Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bulk webcam tiles, focused desktop/webcam viewers, combined viewing, sound feedback, and a compact live version label.

**Architecture:** Reuse existing feature-gated viewer pages and websocket protocols. Add a small multiview coordinator page that opens isolated webcam viewers in tiles, and share compact focus presentation through page classes and saved UI settings.

**Tech Stack:** Bun/TypeScript server, vanilla browser modules, WebSocket/WebRTC, HTML/CSS, Docker Compose.

## Global Constraints

- Limit bulk webcam viewing to six selected online webcam-capable clients.
- Each source commit increments `SERVER_VERSION`; every implementation commit is pushed and force-recreated on ratbox before reporting results.
- Preserve feature-access checks and saved stream transport settings.
- Respect reduced-motion and browser audio-unlock requirements.

---

### Task 1: Dashboard status, version label, and bulk webcam entry

**Files:** `public/index.html`, `public/assets/main.js`, `public/assets/main.css`, `public/assets/nav/template.js`, `public/assets/nav.js`, `src/version.ts`.

- [ ] Add the small live `vX.Y.Z` label under each navigation brand name and populate it from `/api/version`.
- [ ] Move the numeric-only ASCII online display to the first dashboard-toolbar position.
- [ ] Replace destructive bulk buttons with `View Webcams`; validate selected online webcam clients, render a six-tile animated confirmation modal, and navigate confirmed IDs to `/webcams?clientIds=...`.
- [ ] Verify JavaScript syntax, focused tests, bundle build; bump version, commit, push, force-recreate Docker, and check HTTPS `/api/version`.

### Task 2: Tiled webcam viewer

**Files:** Create `public/webcams.html`, `public/assets/webcams.js`; modify `src/server/routes/page-routes.ts`, `public/assets/main.css`, `src/version.ts`.

- [ ] Enforce six unique client IDs and feature access before rendering tiles.
- [ ] Create one independent webcam stream controller per tile; auto-start saved transport/settings, expose per-tile stop, and stop all other controllers before opening the selected focused webcam.
- [ ] Verify tile limit and stream lifecycle with focused tests/syntax/build; bump, commit, deploy, and verify the live container.

### Task 3: Focused Remote Desktop and combined view

**Files:** `public/remotedesktop.html`, `public/assets/remotedesktop.js`, create `public/combined-view.html`, `public/assets/combined-view.js`, modify page routes/CSS/version.

- [ ] Apply the same header-free compact 60%/100% persisted workspace behavior and auto-start logic to Remote Desktop.
- [ ] Build a two-pane combined page that independently controls remote desktop (left) and webcam (right), using existing websocket endpoints and feature checks.
- [ ] Verify saved scale, independent stop behavior, syntax/build; bump, commit, deploy, and health-check ratbox.

### Task 4: Sound preferences and Purgatory cue

**Files:** Create `public/assets/ui-sounds.js`; modify `public/assets/notify-client.js`, settings UI, CSS/version and relevant tests.

- [ ] Provide a gesture-unlocked, low-volume Web Audio utility with persisted enable/disable preference.
- [ ] Subscribe to the existing `client_purgatory` dashboard event and play the two-note Purgatory cue exactly once per arrival.
- [ ] Verify preference behavior and event hookup; bump, commit, deploy, and check production version/health.
