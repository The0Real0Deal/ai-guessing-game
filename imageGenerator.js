const { generateFallbackSVG } = require('./fallbackArt');

/**
 * Generates an image from a text prompt.
 * Priority:
 * 1. OpenAI Images API (if OPENAI_API_KEY is set)
 * 2. Google Gemini / Imagen API (if GEMINI_API_KEY is set)
 * 3. Pollinations.ai public inference endpoint (unless DISABLE_EXTERNAL_AI=1)
 * 4. Built-in procedural SVG illustration fallback
 */
async function generateAIImage(prompt) {
  const cleanPrompt = (prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('Prompt is empty');
  }

  // 1. OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_IMAGE_MODEL || 'dall-e-3',
          prompt: cleanPrompt,
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json',
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (b64) {
          return { imageUrl: `data:image/png;base64,${b64}`, provider: 'openai' };
        }
        const url = data?.data?.[0]?.url;
        if (url) {
          return { imageUrl: url, provider: 'openai' };
        }
      }
    } catch (err) {
      console.warn('[imageGenerator] OpenAI failed, falling back:', err.message);
    }
  }

  // 2. Gemini / Imagen
  if (process.env.GEMINI_API_KEY) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${process.env.GEMINI_API_KEY}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: cleanPrompt }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
        if (b64) {
          return { imageUrl: `data:image/png;base64,${b64}`, provider: 'imagen' };
        }
      }
    } catch (err) {
      console.warn('[imageGenerator] Imagen failed, falling back:', err.message);
    }
  }

  // 3. Pollinations.ai free endpoint
  if (process.env.DISABLE_EXTERNAL_AI !== '1') {
    try {
      const seed = Math.floor(Math.random() * 1000000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=768&height=768&seed=${seed}&nologo=true`;
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(12000),
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.startsWith('image/')) {
        const arrayBuf = await res.arrayBuffer();
        const b64 = Buffer.from(arrayBuf).toString('base64');
        return { imageUrl: `data:${contentType};base64,${b64}`, provider: 'pollinations' };
      }
    } catch (err) {
      console.warn('[imageGenerator] Pollinations failed, using local art fallback:', err.message);
    }
  }

  // 4. Local procedural SVG illustration fallback
  return {
    imageUrl: generateFallbackSVG(cleanPrompt),
    provider: 'local-studio',
  };
}

module.exports = { generateAIImage };
