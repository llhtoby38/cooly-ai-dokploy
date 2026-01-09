const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { child: makeLogger } = require('../utils/logger');
const log = makeLogger('veoGoogle');

class VeoGoogleProvider {
  constructor() {
    this.projectId = process.env.GOOGLE_PROJECT_ID;
    this.location = process.env.GOOGLE_LOCATION || 'us-central1';
    if (!this.projectId) throw new Error('GOOGLE_PROJECT_ID is required');
    // Prefer explicit 3.1 model ids; allow fast vs quality mapping
    this.modelId = process.env.GOOGLE_VEO_MODEL || null; // e.g., 'veo-3.1-generate-preview'
    this.auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }

  endpoint(modelId) {
    return `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${modelId}`;
  }

  selectModelId(model) {
    if (this.modelId) return this.modelId;
    const m = String(model || '').toLowerCase();
    if (m.includes('fast')) return 'veo-3.1-fast-generate-preview';
    return 'veo-3.1-generate-preview';
  }

  async getAccessToken() {
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    return token && (token.token || token);
  }

  async fetchAsBase64(url) {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 10 * 1024 * 1024 });
    const contentType = (resp.headers && resp.headers['content-type']) || 'image/jpeg';
    const base64 = Buffer.from(resp.data).toString('base64');
    return { base64, mime: contentType };
  }

  parseGcsUri(gcsUri) {
    try {
      const uri = String(gcsUri || '');
      if (uri.startsWith('gs://')) {
        const without = uri.slice('gs://'.length);
        const idx = without.indexOf('/');
        if (idx === -1) return null;
        const bucket = without.slice(0, idx);
        const object = without.slice(idx + 1);
        return { bucket, object };
      }
      if (uri.startsWith('https://storage.googleapis.com/')) {
        const without = uri.slice('https://storage.googleapis.com/'.length);
        const idx = without.indexOf('/');
        if (idx === -1) return null;
        const bucket = without.slice(0, idx);
        const object = without.slice(idx + 1);
        return { bucket, object };
      }
      return null;
    } catch {
      return null;
    }
  }

  async fetchGcsBytes(gcsUri) {
    const parsed = this.parseGcsUri(gcsUri);
    if (!parsed) throw new Error('Unsupported GCS URI');
    const token = await this.getAccessToken();
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o/${encodeURIComponent(parsed.object)}?alt=media`;
    const headers = { Authorization: `Bearer ${token}` };
    const resp = await axios.get(url, { headers, responseType: 'arraybuffer', timeout: 120000, maxContentLength: 500 * 1024 * 1024 });
    const mime = (resp.headers && resp.headers['content-type']) || 'video/mp4';
    return { buffer: Buffer.from(resp.data), mime };
  }

  async createVideo({ prompt, model, aspectRatio, resolution, duration, imageUrl, startFrameUrl, endFrameUrl, resizeMode = 'pad', sampleCount = 1, generateAudio = true }) {
    const modelId = this.selectModelId(model);
    const url = `${this.endpoint(modelId)}:predictLongRunning`;
    const token = await this.getAccessToken();
    try { log.info({ event: 'provider.submit', modelId, aspectRatio, resolution, duration, sampleCount, generateAudio }); } catch {}

    const instances = [{}];
    if (prompt) instances[0].prompt = prompt;
    // Map optional start image (startFrame) and lastFrame (bytes)
    if (startFrameUrl) {
      const { base64, mime } = await this.fetchAsBase64(startFrameUrl);
      instances[0].image = { bytesBase64Encoded: base64, mimeType: mime };
    } else if (imageUrl) {
      const { base64, mime } = await this.fetchAsBase64(imageUrl);
      instances[0].image = { bytesBase64Encoded: base64, mimeType: mime };
    }
    if (endFrameUrl) {
      const { base64, mime } = await this.fetchAsBase64(endFrameUrl);
      instances[0].lastFrame = { bytesBase64Encoded: base64, mimeType: mime };
    }

    const parameters = {
      aspectRatio: aspectRatio || '16:9',
      durationSeconds: Number(duration) || 8,
      resolution: resolution || '720p',
      generateAudio: Boolean(generateAudio),
      sampleCount: Number(sampleCount) || 1,
    };
    if (resizeMode && (resizeMode === 'pad' || resizeMode === 'crop')) parameters.resizeMode = resizeMode;

    const body = { instances, parameters };
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const resp = await axios.post(url, body, { headers, timeout: 60000 });
    const name = resp && resp.data && resp.data.name;
    if (!name) throw new Error('No operation name returned by Vertex');
    // Return full operation name (we will pass it back for polling)
    try { log.info({ event: 'provider.submit.done', operation: name }); } catch {}
    return { task_id: name, operation_name: name };
  }

  async getTask(operationName) {
    const modelId = this.modelId || 'veo-3.1-generate-preview'; // model not needed for fetch, but endpoint wants a model path
    const url = `${this.endpoint(modelId)}:fetchPredictOperation`;
    const token = await this.getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const body = { operationName };
    const resp = await axios.post(url, body, { headers, timeout: 60000 });
    const data = resp && resp.data;
    if (!data) return { status: 'processing' };
    if (data.done) {
      try { log.info({ event: 'provider.fetch.done', operationName }); } catch {}
      const videos = (((data.response || {}).videos) || []);
      const results = [];
      for (const v of videos) {
        if (v.bytesBase64Encoded) {
          results.push({ type: 'buffer', buffer: Buffer.from(v.bytesBase64Encoded, 'base64'), mime: v.mimeType || 'video/mp4' });
        } else if (v.gcsUri) {
          results.push({ type: 'gcs', gcsUri: v.gcsUri, mime: v.mimeType || 'video/mp4' });
        }
      }
      return { status: 'completed', results, raw: data };
    }
    return { status: 'processing', raw: data };
  }
}

module.exports = VeoGoogleProvider;
