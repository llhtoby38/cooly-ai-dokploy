const db = require('../db');
const queueAdapter = require('../queue/queueAdapter');
const { child: makeLogger } = require('../utils/logger');
const log = makeLogger('outboxRelay');

function startOutboxRelay(options = {}) {
  const pollMs = Number(options.pollMs || process.env.OUTBOX_POLL_MS || 1000);
  const batch = Number(options.batch || process.env.OUTBOX_BATCH || 25);

  let backoffMs = pollMs;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      // Quick health check; if DB is unhealthy, back off
      try { await db.query('SELECT 1'); } catch (e) { throw e; }

      const queueUrl = queueAdapter.getQueueUrl();
      if (!queueUrl) {
        log.warn({ event: 'outbox.queue_missing', message: 'Queue not configured; skipping dispatch.' });
        backoffMs = Math.max(backoffMs, 5000);
        return;
      }

      const { rows } = await db.query(
        `WITH picked AS (
           SELECT id FROM outbox
           WHERE dispatched_at IS NULL
           ORDER BY created_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE outbox o
         SET dispatch_attempts = o.dispatch_attempts + 1
         FROM picked p
         WHERE o.id = p.id
         RETURNING o.*`,
        [batch]
      );

      if (!rows.length) {
        backoffMs = pollMs; // idle reset
        return;
      }

      // Contract Item A2.5: Use batch operations when available (SQS mode)
      const useBatch = queueAdapter.supportsBatch && queueAdapter.supportsBatch();

      if (useBatch && rows.length > 1) {
        // Batch send mode (SQS only)
        try {
          const messages = [];
          const messageIdToOutboxId = {};

          for (const row of rows) {
            const payload = row.payload || {};
            const event = String(row.event_type || '').toLowerCase();
            const jobName = event || 'unknown';

            if (!jobName || jobName === 'unknown') {
              log.warn({ event: 'outbox.unknown', type: row.event_type, id: row.id });
              continue;
            }

            const jobPayload = { ...payload, outboxId: row.id, jobType: payload?.jobType || jobName };
            const jobId = String(payload?.reservationId || payload?.clientKey || row.id);
            const msgId = `outbox-${row.id}`;

            messages.push({
              id: msgId,
              body: jobPayload,
              messageAttributes: {
                jobType: jobName,
                outboxId: String(row.id),
                jobId,
              },
            });

            messageIdToOutboxId[msgId] = row.id;
          }

          if (messages.length > 0) {
            const result = await queueAdapter.sendMessageBatch({ messages });

            // Mark successful dispatches
            const successfulIds = result.successful.map(s => messageIdToOutboxId[s.Id]).filter(Boolean);
            if (successfulIds.length > 0) {
              await db.query(
                'UPDATE outbox SET dispatched_at = NOW() WHERE id = ANY($1::uuid[])',
                [successfulIds]
              );
              log.info({
                event: 'outbox.batch_dispatched',
                count: successfulIds.length,
                queueType: queueAdapter.getType()
              });
            }

            // Log failures
            if (result.failed && result.failed.length > 0) {
              for (const failed of result.failed) {
                const outboxId = messageIdToOutboxId[failed.Id];
                log.warn({
                  event: 'outbox.batch_dispatch.error',
                  outboxId,
                  code: failed.Code,
                  msg: failed.Message
                });
              }
            }
          }
        } catch (e) {
          log.warn({ event: 'outbox.batch_dispatch.error', msg: e.message });
          // Fall back to individual dispatch on batch error
        }
      } else {
        // Individual dispatch mode (BullMQ or fallback)
        for (const row of rows) {
          try {
            const payload = row.payload || {};
            const event = String(row.event_type || '').toLowerCase();

            const jobName = event || 'unknown';
            if (!jobName || jobName === 'unknown') {
              log.warn({ event: 'outbox.unknown', type: row.event_type, id: row.id });
            } else {
              const jobPayload = { ...payload, outboxId: row.id, jobType: payload?.jobType || jobName };
              const jobId = String(payload?.reservationId || payload?.clientKey || row.id);
              await queueAdapter.sendMessage({
                body: jobPayload,
                messageAttributes: {
                  jobType: jobName,
                  outboxId: String(row.id),
                  jobId,
                },
              });
              try { log.info({ event: 'outbox.dispatched', outboxId: row.id, jobId, queueType: queueAdapter.getType() }); } catch (_) {}
            }

            await db.query('UPDATE outbox SET dispatched_at = NOW() WHERE id = $1', [row.id]);
          } catch (e) {
            // Leave row for retry; optionally log
            log.warn({ event: 'outbox.dispatch.error', id: row.id, msg: e.message });
          }
        }
      }

      backoffMs = pollMs; // success path
    } catch (e) {
      // Exponential backoff on DB errors
      backoffMs = Math.min(Number(process.env.OUTBOX_BACKOFF_MAX_MS || 10000), (backoffMs || pollMs) * 2);
      log.warn({ event: 'outbox.backoff', ms: backoffMs, msg: e.message });
    } finally {
      running = false;
      setTimeout(tick, backoffMs).unref?.();
    }
  }

  try { log.info({ event: 'start', pollMs, batch }); } catch {}
  tick();

  return () => {
    try { log.info({ event: 'stop' }); } catch {}
  };
}

module.exports = { startOutboxRelay };


