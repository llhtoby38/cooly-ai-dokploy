const express = require('express');
const WebSocket = require('ws');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { debitCredits } = require('../utils/credits');
const router = express.Router();

const BYTEPLUS_APP_ID = process.env.BYTEPLUS_APP_ID;
const BYTEPLUS_ACCESS_TOKEN = process.env.BYTEPLUS_ACCESS_TOKEN;
const BYTEPLUS_TTS_WS_URL = 'wss://openspeech.byteoversea.com/api/v1/tts/ws_binary';

router.post('/tts', auth, async (req, res) => {
  const { text, voice = 'en_us_1', format = 'wav', sample_rate = 16000 } = req.body;
  
  // TTS costs 1 credit
  const COST_PER_TTS = 1;
  
  // Check and debit credits
  const creditResult = await debitCredits(req.user.userId, COST_PER_TTS);
  if (!creditResult.success) {
    return res.status(402).json({ 
      error: creditResult.error === 'Insufficient credits' ? 'Not enough credits' : 'Credit check failed',
      creditsLeft: creditResult.creditsLeft
    });
  }

  let audioBuffers = [];
  let isClosed = false;

  const ws = new WebSocket(BYTEPLUS_TTS_WS_URL, {
    headers: {
      'Authorization': `Bearer; ${BYTEPLUS_ACCESS_TOKEN}`
    }
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({
      app: { appid: BYTEPLUS_APP_ID, token: BYTEPLUS_ACCESS_TOKEN, cluster: '' },
      user: { uid: 'user-001' },
      audio: { format, rate: sample_rate, bits: 16, channel: 1, language: 'en-US' },
      request: {
        reqid: uuidv4(),
        workflow: 'audio_in,resample,partition,vad,fe,decode',
        sequence: 1,
        nbest: 1,
        show_utterances: true,
        text: text
      }
    }));
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      audioBuffers.push(data);
    } else {
      const msg = data.toString();
      try {
        const json = JSON.parse(msg);
        if (json.code && json.code !== 20000000) {
          if (!isClosed) {
            isClosed = true;
            ws.close();
            res.status(500).json({ error: json.message || 'BytePlus TTS error' });
          }
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }
  });

  ws.on('close', () => {
    if (!isClosed) {
      isClosed = true;
      const audioBuffer = Buffer.concat(audioBuffers);
      res.set('Content-Type', 'audio/wav');
      res.set('X-Credits-Left', creditResult.creditsLeft.toString());
      res.send(audioBuffer);
    }
  });

  ws.on('error', (err) => {
    if (!isClosed) {
      isClosed = true;
      // Refund credits on error
      debitCredits(req.user.userId, -COST_PER_TTS).catch(console.error);
      res.status(500).json({ error: err.message });
    }
  });
});

module.exports = router; 