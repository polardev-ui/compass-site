const scramjet = require('../scramjet.js');

const blockedDomains = [
  'facebook.com', 'instagram.com', 'tiktok.com',
  'twitter.com', 'x.com', 'reddit.com'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url || !url.match(/^https?:\/\//)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const urlHostname = new URL(url).hostname;
  if (blockedDomains.some(domain => urlHostname.includes(domain))) {
    return res.status(403).json({ error: 'Domain blocked for privacy' });
  }

  try {
    const result = await scramjet.proxy(url);

    if (result.error) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    const isHTML = result.contentType.includes('text/html');

    return res.status(200).json({
      type: isHTML ? 'html' : 'text',
      content: result.content,
      status: 'success'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Proxy error' });
  }
}
