# Generation Failure Handling Pipeline

This note summarizes the recent code changes that make provider failures propagate cleanly from the worker through the API to the UI. Keep it handy if you need to port the behaviour to another branch or tool.

## Backend

### Worker (`backend/src/queue/genWorker.js` and `src/queue/jobs/seedream4.js`)
- Catch provider errors, classify client-side 4xx (except 429) as fatal, and throw `JobProcessingError('DLQ:<code>', { permanent: true })` so the SQS worker forwards the payload to the DLQ immediately.
- Persist structured failure metadata into `generation_sessions.error_details JSONB` including:
  - `providerStatus`, `providerMessage`, trimmed provider body (≤2 KB)
  - Attempt counters (`attempts`, `maxAttempts`), fatal flag, timestamps
  - Reservation snapshot (`reservationAmount`, `refundedCredits`, `refundedAt`, `refundError`)
- Release the credit reservation immediately via `releaseReservation(reservationId)`.
- Update the session row to `status='failed'`, `completed_at=NOW()`, and store the `error_details` payload.
- Emit `NOTIFY session_completed` with `{ user_id, reservation_id, session_id, status: 'failed' }` so downstream listeners react instantly.

### SSE Bridge (`backend/src/api/seedream4.js`)
- Added a `LISTEN session_completed` bridge that:
  1. Re-hydrates the session row (`model`, `status`, `error_details`, `client_key`).
  2. Filters for Seedream sessions.
  3. Broadcasts `failed` events with full error payloads, and `done` events for completions, so the UI flips cards immediately even when the session was outside the first pagination page.
- Logging was added to surface notification receipt, session lookup, and SSE emission status for debugging.

### Credits util (`backend/src/utils/credits.js`)
- `releaseReservation` now returns the released amount so the worker can include the accurate refund value in `error_details`.

## Frontend

### SSE Handler (`frontend/src/app/image/seedream4/page.jsx`)
- The `failed` event listener now consumes `{ sessionId, clientKey, error_details }` from SSE, marks the card `failed` immediately, and injects the error payload before any polling occurs.
- Added retry fetch loop (3x) to pick up fresh DB state in case the SSE arrives before the transaction commits.
- Merge logic keeps the `failed` status once set and prefers new `error_details`; cards now survive partial/stale fetches.
- If a failure arrives before the UI has a card, a stub session is inserted so the user still sees the failure.

### Card + Modal (`frontend/src/app/components/history/ImageHistoryCard.jsx` / `ImageDetailsModal.jsx`)
- Parse `error_details` to display provider error copy (request id stripped) and refunded credits/timestamps.
- Removed the old debounce that delayed transitions to failed; cards flip immediately when `session.status === 'failed'`.

## Database
- Added migration `database/migrations/20251102_generation_sessions_error_details.sql` to create the `error_details JSONB` column on `generation_sessions`.

## Documentation
- `docs/enqueue-first-generation-architecture.md` now includes a “Failure payload propagation” section outlining the worker → DB → SSE → UI flow and a checklist for porting to other tools.
- `docs/capture-and-session-sweeper.md` notes how worker-triggered failures show up instantly through the SSE bridge, with the sweeper remaining a safety net.

## Quick sanity checks
1. Start API and worker; enqueue a nudity/sensitive Seedream job.
2. Watch worker logs for `session.failed.updated` and `session.failed.notify.sent`.
3. Confirm API logs show the SSE bridge emitting `failed` with `hasErrorDetails: true`.
4. UI card should flip to failed immediately with provider error text and refunded credits.

Use this summary if you need to cherry-pick the failure pipeline into another branch or feature.


