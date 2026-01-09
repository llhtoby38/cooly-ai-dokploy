const db = require('../db');

/**
 * Generic enqueue helper for generation-type jobs.
 * Requires caller to provide the computed credit cost and params.
 *
 * options: {
 *   jobType: 'gen.seedream4' | 'gen.seedream3' | 'gen.seedance' | ...,
 *   userId: uuid,
 *   clientKey?: string,
 *   params: object,
 *   cost: number,
 *   model?: string,
 *   mockFlag?: boolean,
 *   preInsertSession?: boolean (default true)
 * }
 */
async function enqueueGeneration(options) {
  const {
    jobType,
    userId,
    clientKey,
    params,
    cost,
    model,
    mockFlag = false,
    preInsertSession = true
  } = options || {};

  if (!jobType) throw new Error('enqueueGeneration: jobType is required');
  if (!userId) throw new Error('enqueueGeneration: userId is required');
  if (!params || typeof params !== 'object') throw new Error('enqueueGeneration: params object is required');
  const requestedOutputs = Math.max(1, Number(params.outputs || 1));
  const resolution = typeof params.size === 'string' ? params.size : (typeof params.resolution === 'string' ? params.resolution : null);
  const payloadVersion = Number(process.env.GENERATION_PAYLOAD_VERSION || 1);

  // Reserve credits
  const { reserveCredits, releaseReservation } = require('../utils/credits');
  const ttl = Number(process.env.RESERVATION_TTL_SECONDS || 600);
  const reserve = await reserveCredits(userId, Number(cost || 0), { description: jobType, ttlSeconds: ttl });
  if (!reserve.success) {
    return { accepted: false, error: reserve.error || 'Insufficient credits' };
  }

  let sessionId = null;
  try {
    if (preInsertSession) {
      const inputSettings = {
        ...params,
        model: model || params.model || null,
        outputs: requestedOutputs
      };
      const prompt = typeof params.prompt === 'string' ? params.prompt : '';
      const { rows } = await db.query(
        `INSERT INTO generation_sessions (user_id, prompt, outputs, model, status, resolution, credit_cost, reservation_id, input_settings, client_key, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`,
        [
          userId,
          prompt,
          requestedOutputs,
          model || params.model || null,
          'processing',
          resolution,
          Number(cost || 0),
          reserve.reservationId,
          JSON.stringify(inputSettings),
          clientKey || null
        ]
      );
      sessionId = rows[0].id;
      // Notify session_created early so UI shows card
      try {
        const payload = JSON.stringify({ user_id: userId, reservation_id: reserve.reservationId, session_id: sessionId, event_ts: Date.now() }).replace(/'/g, "''");
        await db.query(`NOTIFY session_created, '${payload}'`);
      } catch (_) {}
    }

    // Build outbox payload
    const jobData = {
      payloadVersion,
      jobType,
      userId,
      clientKey: clientKey || null,
      mock: !!mockFlag,
      reservationId: reserve.reservationId,
      sessionId: sessionId,
      params,
      meta: {
        requestedOutputs,
        resolution,
        model: model || params.model || null
      }
    };

    const { rows: ob } = await db.query(
      'INSERT INTO outbox (event_type, reservation_id, payload) VALUES ($1,$2,$3) RETURNING id',
      [jobType, reserve.reservationId, JSON.stringify(jobData)]
    );

    return {
      accepted: true,
      clientKey: clientKey || null,
      reservationId: reserve.reservationId,
      sessionId,
      outboxId: ob?.[0]?.id || null,
      status: 'queued'
    };
  } catch (e) {
    try { await releaseReservation(reserve.reservationId); } catch (_) {}
    throw e;
  }
}

module.exports = { enqueueGeneration };


