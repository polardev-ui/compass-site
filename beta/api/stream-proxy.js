const https = require('https');
const http = require('http');
const { URL: URLParser } = require('url');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("Missing 'url' query parameter.");

  try {
    const result = await fetchRaw(targetUrl);
    if (result.statusCode >= 400) {
      return res.status(result.statusCode).send('Upstream error');
    }

    const contentType = result.contentType || '';
    const isPlaylist = targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('m3u8');

    if (isPlaylist) {
      const text = result.buffer.toString('utf8');
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const absoluteUrl = trimmed.startsWith('http')
          ? trimmed
          : new URLParser(trimmed, baseUrl).href;
        return `/beta/api/stream-proxy?url=${encodeURIComponent(absoluteUrl)}`;
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.status(200).send(rewritten);
    }

    res.setHeader('Content-Type', contentType || 'video/MP2T');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(result.buffer);
  } catch (error) {
    console.error('Proxy error:', error.message);
    return res.status(500).send('Proxy failed');
  }
};

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URLParser(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
      timeout: 15000,
    }, (response) => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          contentType: response.headers['content-type'] || '',
          buffer: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}
