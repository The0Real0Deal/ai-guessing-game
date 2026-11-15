const { generateFallbackSVG } = require('./fallbackArt');

/**
 * If a Gemini API key is available and the prompt contains Hebrew,
 * translate & enrich it into a vivid English image prompt using gemini-2.5-flash (free tier).
 */
async function translatePromptIfHebrew(prompt, geminiKey) {
  const hasHebrew = /[\u0590-\u05FF]/.test(prompt);
  if (!hasHebrew || !geminiKey) return prompt;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Translate this Hebrew image description into a clear, vivid English AI image generation prompt (1-2 sentences, no text/words inside the image). Return ONLY the English prompt:\n\n${prompt}`,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const translated = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (translated) return translated;
    }
  } catch (err) {
    console.warn('[imageGenerator] Prompt translation skipped:', err.message);
  }
  return prompt;
}

/**
 * Generates an image from a text prompt.
 * Priority:
 * 1. Gemini API (room-provided key or process.env.GEMINI_API_KEY)
 * 2. OpenAI Images API (if OPENAI_API_KEY is set)
 * 3. Pollinations.ai free Flux model (with Hebrew->English translation if Gemini key exists)
 * 4. Built-in procedural SVG illustration fallback
 */
async function generateAIImage(prompt, options = {}) {
  const cleanPrompt = (prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('Prompt is empty');
  }

  const geminiKey = (options.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  const englishPrompt = await translatePromptIfHebrew(cleanPrompt, geminiKey);
  const styledPrompt = `Vivid, expressive, colorful digital illustration, clear focal subject, no text or letters in the image: ${englishPrompt}`;

  let geminiError = null;

  // 1. Gemini API
  if (geminiKey) {
    const geminiModels = [
      'gemini-2.5-flash-image',
      'gemini-2.0-flash-preview-image-generation',
      'gemini-2.0-flash-exp-image-generation',
    ];

    for (const model of geminiModels) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: styledPrompt }] }],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
            },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (res.ok) {
          const data = await res.json();
          const parts = data?.candidates?.[0]?.content?.parts || [];
          const imagePart = parts.find((p) => p.inlineData && p.inlineData.data);
          if (imagePart) {
            const mime = imagePart.inlineData.mimeType || 'image/png';
            return {
              imageUrl: `data:${mime};base64,${imagePart.inlineData.data}`,
              provider: `Gemini (${model})`,
            };
          }
        } else {
          const errJson = await res.json().catch(() => null);
          geminiError = errJson?.error?.message || `HTTP ${res.status}`;
          console.warn(`[imageGenerator] ${model} failed:`, geminiError);
        }
      } catch (err) {
        geminiError = err.message;
        console.warn(`[imageGenerator] ${model} error:`, err.message);
      }
    }

    // Backup: Imagen 3 / 4 predict endpoint
    const imagenModels = ['imagen-3.0-generate-002', 'imagen-4.0-generate-001'];
    for (const imagenModel of imagenModels) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${imagenModel}:predict?key=${encodeURIComponent(geminiKey)}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: styledPrompt }],
            parameters: { sampleCount: 1, aspectRatio: '1:1' },
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          const data = await res.json();
          const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
          if (b64) {
            return {
              imageUrl: `data:image/png;base64,${b64}`,
              provider: `Google ${imagenModel}`,
            };
          }
        } else {
          const errJson = await res.json().catch(() => null);
          geminiError = errJson?.error?.message || `HTTP ${res.status}`;
        }
      } catch (err) {
        geminiError = err.message;
      }
    }
  }

  // 2. OpenAI
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
          prompt: styledPrompt,
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
          return { imageUrl: `data:image/png;base64,${b64}`, provider: 'OpenAI DALL-E' };
        }
        const url = data?.data?.[0]?.url;
        if (url) {
          return { imageUrl: url, provider: 'OpenAI DALL-E' };
        }
      }
    } catch (err) {
      console.warn('[imageGenerator] OpenAI failed, falling back:', err.message);
    }
  }

  // 3. Pollinations.ai free Flux endpoint (best free no-key fallback)
  if (process.env.DISABLE_EXTERNAL_AI !== '1') {
    try {
      const seed = Math.floor(Math.random() * 1000000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(styledPrompt)}?width=768&height=768&seed=${seed}&model=flux&enhance=true&nologo=true`;
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(25000),
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.startsWith('image/')) {
        const arrayBuf = await res.arrayBuffer();
        const b64 = Buffer.from(arrayBuf).toString('base64');
        return {
          imageUrl: `data:${contentType};base64,${b64}`,
          provider: 'Flux AI (חינמי)',
          geminiError,
        };
      }
    } catch (err) {
      console.warn('[imageGenerator] Pollinations failed, using local art fallback:', err.message);
    }
  }

  // 4. Local procedural SVG illustration fallback
  return {
    imageUrl: generateFallbackSVG(cleanPrompt),
    provider: 'סטודיו איורים מקומי (מצב אופליין)',
    geminiError,
  };
}

module.exports = { generateAIImage };
