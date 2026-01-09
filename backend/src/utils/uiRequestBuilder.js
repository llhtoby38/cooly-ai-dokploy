/**
 * Build the same endpoint + payload the UI sends for image generation.
 * Returns { path, payload }
 */
function buildImageRequest({ model, prompt, outputs }) {
  const m = String(model || '').toLowerCase();
  const isCanonical = (val) => /seedream-(3|4)-/.test(String(val || '').toLowerCase());
  const isSeedream4 = m.includes('seedream-4');
  if (isSeedream4) {
    return {
      path: '/api/images/seedream4/generate',
      payload: {
        prompt,
        // UI typically relies on route default; only send model if canonical
        ...(isCanonical(model) ? { model } : {}),
        ...(Number(outputs) > 1 ? { outputs: Number(outputs) } : {})
      }
    };
  }
  // Seedream 3 UI payload (ensure canonical key)
  const isSeedream3Canonical = /seedream-3-/.test(m);
  const model3 = isSeedream3Canonical ? model : 'seedream-3-0-t2i-250415';
  return {
    path: '/api/image/generate',
    payload: {
      prompt,
      model: model3,
      response_format: 'url',
      size: '1024x1024',
      guidance_scale: 3,
      outputs
    }
  };
}

module.exports = { buildImageRequest };


