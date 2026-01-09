# Credit Finalization: Session Sweeper + Capture Worker

This document explains how stuck-session cleanup and credit finalization work today, and how to operate and extend them safely.

## TL;DR
- The API enqueues jobs and creates sessions with a reserved credit hold.
- The Session Sweeper marks long-running or stuck sessions as failed using configurable thresholds and immediately emits `NOTIFY session_finalize`.
- The Capture Worker LISTENs for `session_finalize` and, based on the session status, captures or releases the reservation. It also periodically sweeps the DB to finalize any missed cases and expires overdue reservations.
- All thresholds, intervals, and per-tool overrides are editable live from Admin → Settings. The sweeper reloads settings on every tick.

---

## Components

### 1) Session Sweeper (generic watchdog)
- File: `backend/src/workers/sessionSweeper.js`
- Started from: `backend/src/app.js` (gated by `ENABLE_SESSION_SWEEPER=true`)
- Purpose: Detect and finalize "stuck" sessions across image and video tools.
- Actions:
  - Marks sessions as `failed` when thresholds are exceeded.
  - Emits `NOTIFY session_finalize` with `{ reservation_id, session_id, status }` so credits are finalized immediately by the capture worker.

Supported tables and rules:
- Images: `generation_sessions`
  - Global: `IMG_MAX` seconds (auto-fail if still `processing` beyond this age)
  - Per-tool overrides: `Seedream 3`, `Seedream 4`
- Videos: `video_generation_sessions` (Seedance), `sora_video_sessions` (Sora 2), `veo31_video_sessions` (Veo 3.1)
  - Global: `VIDEO_MAX` seconds (hard cap for any video session)
  - Early timeout: `VIDEO_NOTASK_TTL` seconds (only for tools you mark as task-id tools)
    - Applies when a tool should quickly return a `task_id` (e.g., Seedance, Sora, Veo 3.1)
    - If no `task_id` appears within TTL, the sweeper fails early with reason `no_task_ttl_exceeded`
  - Per-tool overrides: each video tool can override both `No-task TTL` and `Video Max` independently

Tick cycle:
- Interval controlled by `Interval (s)` in Admin → Settings (global)
- Every tick:
  1) Load overrides from `app_settings`
  2) Sweep images with effective per-tool IMG_MAX
  3) Sweep each video table with effective per-tool `No-task TTL` and `Video Max`
  4) Emit `session_finalize` NOTIFY for failed sessions
  5) Log `tick.done` with effective thresholds

### 2) Capture Worker (reservation finalizer)
- File: `backend/src/workers/captureWorker.js`
- Started from: `backend/src/app.js` (gated by `ENABLE_CAPTURE_WORKER=true`)
- Purpose: Convert a reservation into a captured debit on success, or release it on failure. Also acts as fallback to clean up missed cases.

Behavior:
- LISTEN/NOTIFY
  - Subscribes to `session_finalize` channel
  - On message: looks up the reservation and session status
    - If status is `completed`: attempts `captureReservation(reservation_id)`
      - If the hold already expired, falls back to a direct `debitCredits` with the same amount for audit continuity
    - If status is `failed`: calls `releaseReservation(reservation_id)`
- Periodic sweep
  - Interval controlled by env `CAPTURE_WORKER_INTERVAL_MS` (default 10s)
  - Expires overdue reservations (`expires_at < NOW()`)
  - For each session table, finds rows in terminal state (`completed` or `failed`) whose reservation is still `reserved` or `expired`, then captures or releases accordingly

---

## Configuration

Enablement (env):
- `ENABLE_SESSION_SWEEPER=true`
- `ENABLE_CAPTURE_WORKER=true`

Live-tunable (DB-backed via Admin → Settings → Session Sweeper):
- Global
  - `Enable Session Sweeper`: on/off (DB)
  - `Interval (s)`: tick frequency
  - `IMG_MAX (s)`: global image max age
  - `VIDEO_MAX (s)`: global video max age
  - `VIDEO_NOTASK_TTL (s)`: early timeout for task-id tools
  - `Tools requiring task_id (early TTL)`: checkbox list for `seedance`, `sora`, `veo31`
- Per-tool overrides
  - Image
    - `Seedream 3 — IMG_MAX (s)`
    - `Seedream 4 — IMG_MAX (s)`
  - Video
    - `Seedance — No-task TTL (s), Video Max (s)`
    - `Sora 2 — No-task TTL (s), Video Max (s)`
    - `Veo 3.1 — No-task TTL (s), Video Max (s)`

Precedence:
1) Per-tool override (if set) →
2) Global value in `app_settings` (if set) →
3) Env default in code

Notes:
- `VIDEO_NOTASK_TTL (s)` should be smaller than `VIDEO_MAX (s)`. If TTL ≥ MAX, it will never apply.
- Leaving a per-tool field blank makes it inherit the global.

---

## End-to-end Flow

1) API enqueues a generation and creates a session (status `processing`). A credit reservation is created with TTL.
2) Worker completes the job:
   - On success: worker updates the session to `completed`, emits `session_finalize`, and also triggers the new `session_completed` NOTIFY that the API LISTENs to for SSE updates. Capture worker captures the reservation.
   - On failure: worker updates the session to `failed` and emits both `session_finalize` and `session_completed`. Capture worker releases the reservation and the API broadcasts an SSE `failed` payload so the UI flips immediately.
3) If the job never completes (provider issue, callback lost, etc.):
   - Session Sweeper marks the session `failed` based on thresholds (IMG_MAX, VIDEO_NOTASK_TTL, or VIDEO_MAX)
   - Sweeper emits `session_finalize` immediately (capture worker releases credits) and the API bridge relays the final status via SSE.
4) The frontend reacts to SSE `done` / `failed` regardless of current pagination. Initial history fetch now scales its `limit` (10, 20, … up to 100) so all cards rendered in the current load test window stay synchronized.

---

## Logs to Expect

Startup:
- `sessionSweeper.started` and a `component: sessionSweeper, event: start` line showing interval and effective thresholds
- `captureWorker` logs: `event: start`, followed by `listen.started` for `session_finalize`

Activity:
- Sweeper
  - `sweep.image.failed` with `tool`, `ageMs`, and effective `maxAge`
  - `sweep.video.failed` / `sweep.sora.failed` / `sweep.veo31.failed` with `reason` (e.g., `no_task_ttl_exceeded`, `max_age_exceeded`), `hasTask`, `requiresTask`, and effective thresholds
  - `tick.done` with `imgMaxMs`, `videoMaxMs`, `noTaskTtlMs`, and `taskToolsCsv`
- Capture Worker
  - `listen.started` on channel `session_finalize`
  - Silent success on capture/release; errors are logged as warnings when they occur

Example (Sora max-age fail):
```json
{"component":"sessionSweeper","event":"sweep.sora.failed","tool":"sora","sessionId":"…","ageMs":2005468293,"reason":"max_age_exceeded","requiresTask":true,"hasTask":true,"effMax":600000,"effNoTask":180000}
```

---

## How to Operate

- Enable sweeper: set `ENABLE_SESSION_SWEEPER=true` in `.env`, and turn ON in Admin → Settings.
- Tune globally in seconds, then optionally refine with per-tool overrides.
- For task-id tools (those that return a provider `task_id` quickly), keep `VIDEO_NOTASK_TTL` small (e.g., 60–180s) so truly stuck jobs get failed quickly. Keep `VIDEO_MAX` much larger (e.g., 30–120 min).
- If sessions are failing too aggressively, increase per-tool or global thresholds.

---

## Adding a New Tool

- Image tool
  - Ensure its sessions are saved in `generation_sessions` with `status`, `reservation_id`, and `model` including a recognizable tool substring for per-tool overrides.
  - Optionally expand `detectImageTool()` if you need a new per-tool IMG_MAX setting in the UI.

- Video tool
  - Use a dedicated table (e.g., `xyz_video_sessions`) or reuse `video_generation_sessions` if it matches the generic shape.
  - Ensure columns: `status`, `reservation_id`, `task_id` (if provider returns one), `model` for per-tool recognition.
  - Register the tool in the Settings UI checkbox (if it uses `task_id`) and/or add per-tool fields for `No-task TTL (s)` and `Video Max (s)` if needed.
  - In the sweeper, mirror the Sora/Veo31 helpers for your new table (or reuse `video_generation_sessions` path).

---

## Troubleshooting

- Sweeper not starting
  - Check `.env`: `ENABLE_SESSION_SWEEPER=true` (literal string "true")
  - Confirm startup logs include `sessionSweeper.started`
  - If module load fails, review server console for a syntax error; restart after fixing

- TTL vs Max
  - If `VIDEO_NOTASK_TTL` ≥ `VIDEO_MAX`, only `VIDEO_MAX` applies (TTL effectively disabled)

- Credits not moving
  - Ensure `captureWorker` shows `listen.started` and there are no connection errors
  - Verify `session_finalize` NOTIFY lines appear in sweeper logs when sessions are failed
  - Check the reservation TTL: if a reservation expired before capture, the capture worker will fallback to `debitCredits` on success

---

## Quick Verification Steps

1) Set from Admin → Settings:
   - Enable Session Sweeper: ON
   - Interval (s): 5
   - IMG_MAX (s): 600
   - VIDEO_NOTASK_TTL (s): 120
   - VIDEO_MAX (s): 1800
   - Tools requiring task_id: check Seedance/Sora/Veo31 as appropriate
2) Stop your worker to simulate stuck jobs, trigger a few generations, then watch sweeper logs:
   - Expect `sweep.*.failed` lines within the configured thresholds
   - Expect credits to be released (captureWorker listening)
3) Turn off the sweeper in Settings; expect `tick.skip.disabled` after the next tick.

---

## Reference
- Sweeper startup: `backend/src/app.js` (logs `sessionSweeper.started`)
- Sweeper logic: `backend/src/workers/sessionSweeper.js`
- Capture worker: `backend/src/workers/captureWorker.js` (logs `listen.started` and runs periodic sweep)
- Settings API: `backend/src/api/admin.js` (`/api/admin/settings`)
- Admin UI: `frontend/src/app/admin/page.jsx` (Session Sweeper section)
