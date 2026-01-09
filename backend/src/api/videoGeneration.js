const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const db = require('../db');
const { reserveCredits, captureReservation, releaseReservation, getCredits } = require('../utils/credits');
const { uploadVeo3Video } = require('../utils/storage');
const router = express.Router();

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_API_BASE = process.env.KIE_API_BASE || 'https://api.kie.ai';
const KIE_ENABLE_FALLBACK = (process.env.KIE_ENABLE_FALLBACK || 'true').toLowerCase() === 'true';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_API_BASE;
const KIE_CALLBACK_URL = process.env.KIE_CALLBACK_URL || (PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL.replace(/\/$/, '')}/api/video/kie-callback` : undefined);
// Defaults based on official docs: https://docs.kie.ai/veo3-api/quickstart
const KIE_CREATE_PATHS = (process.env.KIE_CREATE_PATHS || '/api/v1/veo/generate').split(',').map(p => p.trim()).filter(Boolean);
// Use template with {taskId} token so we can build query-string style paths
const KIE_TASK_PATHS = (process.env.KIE_TASK_PATHS || '/api/v1/veo/record-info?taskId={taskId}').split(',').map(p => p.trim()).filter(Boolean);

// (No Seedance config here; Seedance lives in its own router)

// Video generation cost
const COST_PER_VIDEO = 5;

// Mock mode for testing (env-driven)
// Enable globally with MOCK_API=true or only for video with MOCK_VIDEO=true
const MOCK_MODE = (
  String(process.env.MOCK_API || '').toLowerCase() === 'true' ||
  String(process.env.MOCK_VIDEO || '').toLowerCase() === 'true'
);

// Download remote video and upload to B2 under the appropriate provider folder
async function downloadAndUploadToB2(videoUrl, sessionId, model) {
  try {
    console.log(`📥 Downloading video from KIE: ${videoUrl}`);
    
    // Download video from KIE
    const response = await axios.get(videoUrl, { 
      responseType: 'arraybuffer',
      timeout: 60000 // 60 second timeout for videos
    });
    
    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const filename = `vid_${sessionId}_${timestamp}_${randomId}.mp4`;
    
    console.log(`📤 Uploading to B2: ${filename}`);
    
    // Choose upload tool based on model
    const lower = (model || '').toLowerCase();
    let permanentUrl;
    if (lower.startsWith('seedance')) {
      permanentUrl = await uploadSeedanceVideo(response.data, filename);
    } else {
      permanentUrl = await uploadVeo3Video(response.data, filename);
    }
    
    return {
      original_url: videoUrl,
      b2_url: permanentUrl,
      b2_filename: filename,
      file_size: response.data.length,
      b2_folder: process.env.B2_VIDEOS_FOLDER || (lower.startsWith('seedance') ? 'generated-content/seedance-1-0' : 'generated-content/google-veo3')
    };
    
  } catch (error) {
    console.error('❌ Failed to process video:', error);
    throw new Error(`Video processing failed: ${error.message}`);
  }
} // Set to false to disable mock

// Mock KIE.AI response function with attempt counter
let mockAttemptsByTask = {};

async function mockKieResponse(taskId) {
  console.log('🔧 MOCK MODE: Simulating KIE.AI response for task:', taskId);
  
  // Initialize attempt counter for this task
  if (!mockAttemptsByTask[taskId]) {
    mockAttemptsByTask[taskId] = 0;
  }
  
  mockAttemptsByTask[taskId]++;
  const attemptCount = mockAttemptsByTask[taskId];
  
  console.log(`🔧 MOCK MODE: Attempt ${attemptCount} for task ${taskId}`);
  
  // Force completion after 6 attempts (1 minute of polling at 10-second intervals)
  if (attemptCount >= 6) {
    console.log('🔧 MOCK MODE: Completing after 6 attempts (1 minute)');
    delete mockAttemptsByTask[taskId]; // Clean up
    return {
      status: 'completed',
      video_urls: ['https://www.w3schools.com/html/mov_bbb.mp4'],
      error: null
    };
  }
  
  return {
    status: 'processing',
    video_urls: null,
    error: null
  };
}

// Note: Local video downloading removed. We now store only remote URLs from the provider.

function extractKieUrls(raw) {
  const urls = new Set();

  const tryAddFromString = (val) => {
    if (!val || typeof val !== 'string') return;
    // Try JSON parse first
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        parsed.forEach(u => typeof u === 'string' && /^https?:\/\//.test(u) && urls.add(u));
        return;
      }
    } catch {}
    // Fallback: split by comma/whitespace and add http(s) tokens
    val.split(/[\s,]+/).forEach(token => {
      if (/^https?:\/\//.test(token)) urls.add(token);
    });
  };

  const tryAddFromArray = (arr) => {
    if (!arr) return;
    if (Array.isArray(arr)) {
      arr.forEach(item => {
        if (typeof item === 'string' && /^https?:\/\//.test(item)) urls.add(item);
        else if (item && typeof item === 'object' && typeof item.url === 'string' && /^https?:\/\//.test(item.url)) urls.add(item.url);
      });
    }
  };

  // Common fields
  tryAddFromString(raw?.data?.resultUrls);
  tryAddFromString(raw?.data?.info?.resultUrls);
  tryAddFromArray(raw?.data?.response?.resultUrls);
  tryAddFromArray(raw?.data?.urls);
  tryAddFromArray(raw?.data?.videoUrls);
  tryAddFromString(raw?.data?.resultUrl);
  tryAddFromString(raw?.resultUrls);
  tryAddFromArray(raw?.urls);
  tryAddFromArray(raw?.video_urls);
  tryAddFromArray(raw?.output);

  return Array.from(urls);
}

async function kiePostCreateVideo(prompt, model, aspectRatio) {
  let lastError;
  for (const path of KIE_CREATE_PATHS) {
    const url = `${KIE_API_BASE}${path}`;
    try {
      console.log('Calling KIE API:', url, { model, aspectRatio });
      // Try a few common payload shapes used by different providers
      const candidateBodies = [
        // Simple generations payload
        { prompt, model, aspectRatio, enableFallback: KIE_ENABLE_FALLBACK, ...(KIE_CALLBACK_URL ? { callBackUrl: KIE_CALLBACK_URL } : {}) },
        // Task-creation style A
        { type: 'video', prompt, model, aspect_ratio: aspectRatio },
        // Task-creation style B
        { task_type: 'video', prompt, model, aspect_ratio: aspectRatio },
        // Task-creation style C (nested params)
        { type: 'video', params: { prompt, model, aspect_ratio: aspectRatio } },
        // Generic input style
        { kind: 'video', input: { prompt }, model, aspect_ratio: aspectRatio }
      ];

      let lastInnerError;
      for (const body of candidateBodies) {
        try {
          const resp = await axios.post(url, body, {
            headers: {
              'Authorization': `Bearer ${KIE_API_KEY}`,
              'Content-Type': 'application/json'
            }
          });
          const payload = resp.data;
          // Normalize to { task_id }
          const taskId = payload?.data?.taskId || payload?.task_id || payload?.id || payload?.taskId;
          if (!taskId && payload?.code && payload?.code !== 200) {
            throw new Error(payload?.msg || 'KIE returned non-success code');
          }
          return { task_id: taskId, raw: payload };
        } catch (innerErr) {
          const s = innerErr?.response?.status;
          // If the path exists (not 404/405) but payload wrong (400/422), surface that error immediately
          if (s && s !== 404 && s !== 405) {
            throw innerErr;
          }
          lastInnerError = innerErr;
        }
      }
      // If none of the payload shapes worked and we only saw 404/405, fall through to try next path
      lastError = lastInnerError;
      throw lastInnerError || new Error('Unknown error trying candidate payloads');
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.warn('KIE create failed for path', path, { status, data });
      lastError = err;
      if (status === 404 || status === 405) {
        continue; // try next path
      }
      throw new Error(`KIE create error (${status || 'no-status'}): ${typeof data === 'object' ? JSON.stringify(data) : data || err.message}`);
    }
  }
  throw new Error(`KIE create endpoint not found. Tried: ${KIE_CREATE_PATHS.join(', ')}. Last error: ${lastError?.message || lastError}`);
}

async function kieGetTask(taskId) {
  let lastError;
  for (const path of KIE_TASK_PATHS) {
    // Support three forms: '/x/y', '/x/y?taskId={taskId}', '/x/{taskId}'
    let builtPath = path;
    if (builtPath.includes('{taskId}')) {
      builtPath = builtPath.replace('{taskId}', encodeURIComponent(taskId));
    } else if (builtPath.includes('?')) {
      const sep = builtPath.includes('taskId=') ? '' : (builtPath.endsWith('?') ? '' : '&');
      builtPath = `${builtPath}${sep}${builtPath.includes('taskId=') ? '' : 'taskId='}${encodeURIComponent(taskId)}`;
    } else if (!builtPath.endsWith(`/${taskId}`)) {
      builtPath = `${builtPath}/${taskId}`;
    }
    const url = `${KIE_API_BASE}${builtPath}`;
    try {
      const resp = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      const raw = resp.data;
      // Normalize to { status, video_urls }
      if (typeof raw?.code === 'number' && raw?.data) {
        const flag = raw.data.successFlag;
        if (flag === 0) return { status: 'processing', raw };
        if (flag === 1) {
          const urlsStr = raw.data.resultUrls || raw.data.info?.resultUrls || '[]';
          let urls = [];
          try { urls = JSON.parse(urlsStr); } catch {}
          return { status: 'completed', video_urls: urls, raw };
        }
        return { status: 'failed', error: raw.msg || 'Generation failed', raw };
      }
      return raw;
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.warn('KIE task fetch failed for path', path, { status, data });
      lastError = err;
      if (status === 404 || status === 405) {
        continue;
      }
      throw new Error(`KIE task error (${status || 'no-status'}): ${typeof data === 'object' ? JSON.stringify(data) : data || err.message}`);
    }
  }
  throw new Error(`KIE task endpoint not found. Tried: ${KIE_TASK_PATHS.join(', ')}. Last error: ${lastError?.message || lastError}`);
}

// Check KIE.AI status
async function checkKieStatus(taskId) {
  if (MOCK_MODE && taskId.startsWith('mock-')) {
    console.log('🔧 MOCK MODE: Checking status for mock task:', taskId);
    return mockKieResponse(taskId);
  }
  
  try {
    return await kieGetTask(taskId);
  } catch (error) {
    console.error('KIE status check failed:', error);
    throw error;
  }
}

// Wait for KIE.AI completion with 30-second polling (per docs)
async function waitForKieCompletion(taskId) {
  console.log(`�� Waiting for KIE.AI task completion: ${taskId}`);
  console.log('This may take several minutes. Checking status every 30 seconds...');
  
  return new Promise((resolve, reject) => {
    const checkStatus = async () => {
      try {
        const statusData = await checkKieStatus(taskId);
        console.log('KIE status:', statusData.status);
        const st = (statusData.status || '').toLowerCase();
        if (st === 'completed' || st === 'succeeded' || st === 'success') {
          console.log('✅ KIE.AI task completed successfully');
          let urls = extractKieUrls(statusData) || statusData.video_urls || statusData.urls || (Array.isArray(statusData.output) ? statusData.output.map(o => o.url).filter(Boolean) : []);
          if (!urls || urls.length === 0 && statusData.raw) {
            const raw = statusData.raw;
            const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
            console.log('KIE raw completion payload:', rawStr);
            urls = extractKieUrls(raw) || [];
          }
          resolve(urls);
        } else if (st === 'failed' || st === 'error') {
          reject(new Error(`KIE.AI task failed: ${statusData.error || 'Unknown error'}`));
        } else {
          // Still processing, wait 30 seconds and check again
          setTimeout(checkStatus, 30000);
        }
      } catch (error) {
        reject(error);
      }
    };

    // Start checking status
    checkStatus();
  });
}

// Generate video
router.post('/generate', auth, async (req, res) => {
  try {
    const { prompt, model = 'veo3', aspectRatio = '16:9' } = req.body;
    // Enforce 16:9 for now regardless of client input
    const normalizedAspect = '16:9';

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!KIE_API_KEY && !MOCK_MODE) {
      return res.status(500).json({ error: 'KIE.AI API key not configured' });
    }

    // Reserve credits (skip in mock mode)
    let reservation;
    if (MOCK_MODE) {
      const bal = await getCredits(req.user.userId);
      reservation = { success: true, reservationId: null, creditsLeft: bal?.credits ?? 0 };
    } else {
      const modelStr = String(model || '').toLowerCase();
      let veoLabel = null;
      if (modelStr.includes('veo')) {
        if (modelStr.includes('fast') || modelStr.includes('turbo') || modelStr.includes('lite') || modelStr.includes('speed')) {
          veoLabel = 'Google Veo 3 Fast';
        } else if (modelStr.includes('quality') || modelStr.includes('standard') || modelStr.includes('std') || modelStr.includes('default')) {
          veoLabel = 'Google Veo 3 Quality';
        } else {
          veoLabel = 'Google Veo 3';
        }
      }
      reservation = await reserveCredits(
        req.user.userId,
        COST_PER_VIDEO,
        { description: `${veoLabel || (model || 'Video')} (reservation)`, ttlSeconds: Number(process.env.RESERVATION_TTL_SECONDS || 600) }
      );
    }
    if (!reservation.success) {
      return res.status(402).json({ 
        error: reservation.error === 'Insufficient credits' ? 'Not enough credits' : 'Credit check failed',
        creditsLeft: reservation.creditsLeft
      });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Create video generation session
      const { rows: sessionRows } = await client.query(
        'INSERT INTO video_generation_sessions (user_id, prompt, model, aspect_ratio, status, credit_cost, reservation_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [req.user.userId, prompt, model, normalizedAspect, 'processing', COST_PER_VIDEO, reservation.reservationId]
      );
      const sessionId = sessionRows[0].id;

      // Start KIE.AI video generation (or create a mock task id in MOCK_MODE)
      let taskId;
      if (MOCK_MODE) {
        taskId = `mock-${Date.now()}`;
        console.log('🔧 MOCK MODE: Created mock task id:', taskId);
      } else {
        // Default to KIE/Veo3
        const createData = await kiePostCreateVideo(prompt, model, normalizedAspect);
        taskId = createData.task_id || createData.id || createData.taskId;
        if (!taskId) throw new Error('KIE generation response missing task id');
      }
      console.log(`🎬 KIE.AI video generation started. Task ID: ${taskId}`);

      // Update session with task ID
      await client.query(
        'UPDATE video_generation_sessions SET task_id = $1 WHERE id = $2',
        [taskId, sessionId]
      );

      await client.query('COMMIT');

      // Start background processing (don't await it)
      console.log('Starting background video processing...');
      const requestStartMs = Date.now();
      processVideoCompletion(taskId, sessionId, prompt, requestStartMs).catch(error => {
        console.error('Background video processing failed:', error);
        // Update session status to failed
        db.query(
          'UPDATE video_generation_sessions SET status = $1 WHERE id = $2',
          ['failed', sessionId]
        ).catch(console.error);
      });

      // Return response immediately
      res.json({
        success: true,
        sessionId: sessionId,
        taskId: taskId,
        message: 'Video generation started! Check status for progress.',
        prompt: prompt,
        credits_left: (await getCredits(req.user.userId))?.credits
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Video generation error:', error);
    const message = process.env.NODE_ENV === 'production' ? 'Video generation failed' : (error?.message || String(error));
    // Release reservation if initial request failed
    try { if (reservation?.reservationId) await releaseReservation(reservation.reservationId); } catch(_) {}
    res.status(500).json({ error: message });
  }
});

// Background function to process video completion
async function processVideoCompletion(taskId, sessionId, prompt, requestStartMs) {
  console.log(`Background processing started for task: ${taskId}`);

  try {
    // Wait for video generation to complete
    console.log('Waiting for video generation to complete...');
    console.log('This may take several minutes. Checking status every 10 seconds...');

    // Poll KIE/Veo3
    const videoUrls = await waitForKieCompletion(taskId);

    if (!videoUrls || videoUrls.length === 0) {
      throw new Error('No video URLs received from kie.ai');
    }

    // Use the first video URL (kie.ai may return multiple formats)
    const videoUrl = videoUrls[0];
    console.log('Video URL received:', videoUrl);

    // Download and upload to B2
    console.log('Downloading video and uploading to B2...');
    const result = await downloadAndUploadToB2(videoUrl, sessionId, 'veo-3');
    
    const { rows: videoRows } = await db.query(
      `INSERT INTO videos (
        session_id, 
        original_url, 
        b2_filename, 
        b2_url, 
        b2_folder, 
        file_size, 
        storage_provider,
        generation_tool
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        sessionId, 
        videoUrl, 
        result.b2_filename, 
        result.b2_url, 
        result.b2_folder, 
        result.file_size, 
        'b2',
        'google-veo3'
      ]
    );

    // Update session status to completed and persist duration
    const totalMs = Math.max(0, Date.now() - (requestStartMs || Date.now()));
    await db.query(
      'UPDATE video_generation_sessions SET status = $1, completed_at = NOW(), duration_ms = $3 WHERE id = $2',
      ['completed', sessionId, totalMs]
    );
    // Capture reservation associated to this session (if any)
    try {
      const { rows } = await db.query('SELECT reservation_id FROM video_generation_sessions WHERE id = $1', [sessionId]);
      const resId = rows?.[0]?.reservation_id;
      if (resId) await captureReservation(resId, { description: 'Google Veo 3' });
    } catch (e) { console.error('captureReservation (video) failed:', e); }
    console.log(`[gen][total] ${totalMs}ms sessionId=${sessionId}`);

    console.log(`✅ Video processing completed successfully for session: ${sessionId}`);
    console.log(`🔗 Video URL stored: ${videoUrl}`);
    console.log(`💾 Database updated with video ID: ${videoRows[0].id}`);

  } catch (error) {
    console.error(`❌ Background video processing failed for session ${sessionId}:`, error);

    // Update session status to failed
    await db.query(
      'UPDATE video_generation_sessions SET status = $1 WHERE id = $2',
      ['failed', sessionId]
    );
    // Release reservation on failure
    try {
      const { rows } = await db.query('SELECT reservation_id FROM video_generation_sessions WHERE id = $1', [sessionId]);
      const resId = rows?.[0]?.reservation_id;
      if (resId) await releaseReservation(resId);
    } catch (_) {}

    throw error;
  }
}

// Check video generation status
router.get('/status/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const { rows } = await db.query(
      'SELECT * FROM video_generation_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, req.user.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = rows[0];
    
    if (session.status === 'completed') {
      const { rows: videoRows } = await db.query(
        'SELECT * FROM videos WHERE session_id = $1',
        [sessionId]
      );
      
      return res.json({
        success: true,
        sessionId,
        status: 'completed',
        videos: videoRows.map(video => ({
          id: video.id,
          url: video.b2_url || video.original_url,
          original_url: video.original_url,
          filename: video.b2_filename,
          file_size: video.file_size,
          generation_tool: video.generation_tool
        }))
      });
    }

    res.json({
      success: true,
      sessionId,
      status: session.status,
      message: 'Session found'
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Status check failed' });
  }
});

// Get video generation history
router.get('/history', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Default 10 items per page
    const offset = parseInt(req.query.offset) || 0; // Default start from beginning
    const modelLike = (req.query.model_like || '').trim();
    
    // Build WHERE clause with optional model filter (server-side filtered pagination)
    const whereParts = ['s.user_id = $1'];
    const params = [req.user.userId];
    if (modelLike) {
      whereParts.push('LOWER(s.model) LIKE LOWER($2)');
      params.push(modelLike);
    }
    // Add pagination params at the end
    params.push(limit);
    params.push(offset);

    const whereSql = whereParts.join(' AND ');

    const { rows } = await db.query(
      `SELECT 
        s.id AS session_id,
        s.prompt,
        s.model,
        s.aspect_ratio,
        s.ref_image_url,
        s.resolution,
        s.video_duration,
        s.status,
        s.storage_status,
        s.credit_cost,
        s.task_id,
        s.created_at,
        s.completed_at,
        s.duration_ms,
        v.original_url,
        v.b2_url,
        v.b2_filename,
        v.file_size,
        v.generation_tool
      FROM video_generation_sessions s
      LEFT JOIN videos v ON v.session_id = s.id
      WHERE ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    // Also get total count for pagination info
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) as total FROM video_generation_sessions s WHERE ${whereSql}`,
      modelLike ? [req.user.userId, modelLike] : [req.user.userId]
    );

    res.json({
      items: rows,
      pagination: {
        total: parseInt(countRows[0].total),
        limit,
        offset,
        hasMore: offset + limit < parseInt(countRows[0].total)
      }
    });
  } catch (error) {
    console.error('Error fetching video history:', error);
    res.status(500).json({ error: 'Failed to fetch video history' });
  }
});

// Average estimate endpoint (last up to 32 completed sessions)
router.get('/estimate', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT duration_ms AS ms
       FROM video_generation_sessions
       WHERE status = 'completed' AND duration_ms IS NOT NULL AND duration_ms > 0
       ORDER BY completed_at DESC
       LIMIT 32`
    );
    const durations = rows.map(r => Number(r.ms)).filter(n => Number.isFinite(n) && n > 0);
    const sampleSize = durations.length;
    let averageMs = sampleSize > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / sampleSize) : 60000; // default 60s
    if (sampleSize > 0) averageMs += 2000; // add 2s buffer to calculated average
    res.json({ averageMs, sampleSize });
  } catch (err) {
    console.error('Video estimate error:', err);
    res.status(500).json({ error: 'Failed to compute estimate' });
  }
});

module.exports = router;

// Optional: KIE callback receiver (secure with shared secret header if desired)
router.post('/kie-callback', express.json(), async (req, res) => {
  try {
    const payload = req.body || {};
    const taskId = payload?.data?.taskId || payload?.taskId;
    if (!taskId) {
      return res.status(400).json({ error: 'Missing taskId' });
    }

    // Find session by task_id
    const { rows } = await db.query('SELECT id FROM video_generation_sessions WHERE task_id = $1', [taskId]);
    if (!rows.length) {
      // Accept but log; polling may have created/linked later
      console.warn('Callback for unknown taskId:', taskId);
      return res.status(200).json({ status: 'received' });
    }
    const sessionId = rows[0].id;

    // Extract URLs
    const urls = extractKieUrls(payload) || [];
    const videoUrl = urls[0];
    if (videoUrl) {
      try {
        // Download and upload to B2
        const result = await downloadAndUploadToB2(videoUrl, sessionId, 'veo-3');
        
        await db.query(
          `INSERT INTO videos (
            session_id, 
            original_url, 
            b2_filename, 
            b2_url, 
            b2_folder, 
            file_size, 
            storage_provider,
            generation_tool
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            sessionId, 
            videoUrl, 
            result.b2_filename, 
            result.b2_url, 
            result.b2_folder, 
            result.file_size, 
            'b2',
            'google-veo3'
          ]
        );
        
        await db.query(
          'UPDATE video_generation_sessions SET status = $1, completed_at = NOW(), duration_ms = EXTRACT(EPOCH FROM (NOW() - created_at))*1000 WHERE id = $2',
          ['completed', sessionId]
        );
      } catch (error) {
        console.error('Failed to process video in callback:', error);
        await db.query(
          'UPDATE video_generation_sessions SET status = $1 WHERE id = $2',
          ['failed', sessionId]
        );
      }
    }

    res.status(200).json({ status: 'received' });
  } catch (err) {
    console.error('KIE callback error:', err);
    res.status(500).json({ error: 'Callback handling failed' });
  }
});