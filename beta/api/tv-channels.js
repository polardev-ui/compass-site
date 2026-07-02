const https = require('https');
const http = require('http');
const { URL: URLParser } = require('url');

const BASE = 'https://iptv-org.github.io/api';
let cache = null;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { country, category, search, page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(Math.max(1, parseInt(limit)), 100);

  try {
    if (!cache) {
      const [channels, streams, logos] = await Promise.all([
        fetchJSON(`${BASE}/channels.json`),
        fetchJSON(`${BASE}/streams.json`),
        fetchJSON(`${BASE}/logos.json`),
      ]);

      const streamMap = {};
      for (const s of streams) {
        if (s.channel) {
          (streamMap[s.channel] || (streamMap[s.channel] = [])).push(s.url);
        }
      }

      const logoMap = {};
      for (const l of logos) {
        if (l.channel && !logoMap[l.channel]) {
          logoMap[l.channel] = l.url;
        }
      }

      cache = [];
      for (const ch of channels) {
        const urls = streamMap[ch.id];
        if (urls && urls.length) {
          cache.push({
            id: ch.id,
            name: ch.name,
            country: ch.country,
            categories: ch.categories,
            logo: logoMap[ch.id] || null,
            url: urls[0],
          });
        }
      }
    }

    let filtered = cache;
    if (country) filtered = filtered.filter(c => c.country === country);
    if (category) filtered = filtered.filter(c => c.categories.includes(category));
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(c => c.name.toLowerCase().includes(q));
    }

    const total = filtered.length;
    const start = (pageNum - 1) * limitNum;
    const paged = filtered.slice(start, start + limitNum);

    res.status(200).json({ channels: paged, total, page: pageNum });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch channel data' });
  }
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URLParser(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'CompassTV/1.0' }, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('Timeout')); });
  });
}
