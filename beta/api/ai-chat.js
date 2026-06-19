const AI_API_URL = 'https://api.wsgpolar.me/v1/ai/chat';
const ALLOWED_MODELS = new Set(['llama-3.1-8b-instant']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  const { model, messages } = req.body || {};

  if (!model || !ALLOWED_MODELS.has(model)) {
    return res.status(400).json({ error: 'Invalid model' });
  }

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  for (const msg of messages) {
    if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'Invalid message format' });
    }
    if (msg.content.length > 8000) {
      return res.status(400).json({ error: 'Message too long' });
    }
  }

  try {
    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages })
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'AI request failed' });
  }
};
