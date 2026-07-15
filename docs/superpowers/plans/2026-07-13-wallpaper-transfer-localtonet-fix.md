# Wallpaper Transfer Localtonet Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wallpaper transfers use the configured public Localtonet endpoint for legacy and current agents, provide exact timeout diagnostics, and shrink the notification into the bottom-left corner.

**Architecture:** The server chooses an authoritative pull origin from `OVERLORD_EXTERNAL_URL`, with trusted proxy/request values as fallback, and records how that endpoint was selected in each wallpaper job. Transfer jobs distinguish a command that received no client acknowledgement from an active transfer, while the UI presents the same structured state in a compact notification.

**Tech Stack:** Bun/TypeScript server, Go client agent, browser JavaScript/CSS, Docker Compose.

## Global Constraints

- Preserve compatibility with deployed agent `2.3.4`, which uses absolute upload URLs literally.
- Use `https://overheh.foxnews17.com:2725` from deployment configuration as the canonical external origin.
- Display `100%` only after transfer verification and wallpaper application succeed.
- Bump server, package, and agent versions together to `2.4.25`.
- Do not modify or revert unrelated dirty-worktree files.

---

### Task 1: Canonical Pull Origin And Diagnostics

**Files:**
- Modify: `Overlord-Server/src/server/routes/wallpaper-routes.ts`
- Modify: `Overlord-Server/src/server/routes/wallpaper-routes.test.ts`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `OVERLORD_EXTERNAL_URL`, request proxy headers, client `version` metadata.
- Produces: wallpaper status fields `endpointSource`, `clientVersion`, `clientAcknowledged`, and `transferState`.

- [ ] **Step 1: Write failing route tests**

Add a test that sets `OVERLORD_EXTERNAL_URL=https://public.example:2725`, submits through an internal request host, and expects `pullOrigin` to use the public origin. Extend timeout coverage to expect the legacy client version and `command_sent_no_client_progress` state.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test src/server/routes/wallpaper-routes.test.ts`

Expected: FAIL because the route currently returns the internal request host and omits the diagnostic fields.

- [ ] **Step 3: Implement canonical origin selection**

Read and validate `OVERLORD_EXTERNAL_URL`, choose it before forwarded/request host values, record the source, and pass the variable through Docker Compose. Increase the default transfer timeout to five minutes so legacy agents can return their final network error.

- [ ] **Step 4: Implement transfer-state diagnostics**

Record command dispatch, client progress acknowledgement, client version, last progress time, and endpoint source. Include those fields in job status and timeout errors.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `bun test src/server/routes/wallpaper-routes.test.ts`

Expected: all wallpaper route tests pass.

### Task 2: Compact Bottom-Left Notification

**Files:**
- Modify: `Overlord-Server/public/assets/main.css`
- Modify: `Overlord-Server/public/assets/side-panel.js`

**Interfaces:**
- Consumes: wallpaper job status and structured error fields from Task 1.
- Produces: compact bottom-left transfer notification and clearer labels.

- [ ] **Step 1: Add the compact layout behavior**

Move `.sp-toast-container` to `left: 12px; bottom: 12px`, reverse the stack so new notifications grow upward, cap width at `300px`, and reduce notification padding, gaps, icon size, and detail typography without clipping long paths.

- [ ] **Step 2: Improve transfer copy**

Replace `Via` with `Endpoint`, show transfer state and client version on errors, and truncate long endpoint presentation visually while retaining its full text in the structured failure message.

- [ ] **Step 3: Validate asset syntax and selectors**

Run Bun syntax/type checks and grep the built assets for the bottom-left selectors and new diagnostic labels.

### Task 3: Version, Verification, And Deployment

**Files:**
- Modify: `Overlord-Server/src/version.ts`
- Modify: `Overlord-Server/package.json`
- Modify: `Overlord-Client/cmd/agent/config/config.go`

**Interfaces:**
- Produces: synchronized release version `2.4.25` and a deployed Docker image.

- [ ] **Step 1: Bump all release versions to 2.4.25**

Update the server constant, package version, and agent constant together.

- [ ] **Step 2: Run local and Docker-capable verification**

Run Go tests, Bun wallpaper/file route tests, typecheck, diff checks, and version consistency checks. Use the remote Docker build environment for Bun checks if Bun is unavailable locally.

- [ ] **Step 3: Build and deploy to root@ratbox**

Create a rollback image tag, build `overlord-cyrax:latest`, restart `overlord-server`, and verify container health, `/health`, `/api/version`, and the canonical external URL environment.

- [ ] **Step 4: Send Telegram completion notification**

Send David Quake a concise emoji summary naming the completed wallpaper transfer fix, deployment, and measured elapsed time. Do not store the bot token in repository files.
