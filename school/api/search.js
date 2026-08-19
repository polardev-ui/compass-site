const https = require('https');
const zlib = require('zlib');
const webproxy = require('./webproxy');

const ENDPOINT = 'api.search.brave.com';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Brave marks matched terms with <strong>; drop the markup and escape the rest.
function plain(value) {
  return escapeHtml(String(value || '').replace(/<[^>]*>/g, ''));
}

function page(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 22px 60px;
    background: #000; color: #fff;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    line-height: 1.5;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  .head { color: #666; font-size: 13px; margin-bottom: 22px; border-bottom: 1px solid #222; padding-bottom: 12px; }
  .result { margin-bottom: 26px; }
  .result a.title { color: #8ab4f8; font-size: 18px; text-decoration: none; display: block; margin-bottom: 3px; }
  .result a.title:hover { text-decoration: underline; }
  .result .url { color: #3a8f4f; font-size: 12.5px; word-break: break-all; margin-bottom: 5px; }
  .result .desc { color: #bbb; font-size: 14px; }
  .notice { border: 1px solid #333; border-radius: 6px; padding: 18px 20px; background: #0d0d0d; }
  .notice h1 { font-size: 17px; margin: 0 0 10px; }
  .notice p { color: #aaa; font-size: 14px; margin: 0 0 8px; }
  .notice code { background: #1a1a1a; padding: 2px 6px; border-radius: 3px; color: #ff8080; font-size: 13px; }
</style></head>
<body><div class="wrap">${bodyHtml}</div></body></html>`;
}

function notice(heading, lines) {
  return page(heading, `<div class="notice"><h1>${escapeHtml(heading)}</h1>${
    lines.map(l => `<p>${l}</p>`).join('')
  }</div>`);
}

function send(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

function renderResults(query, results) {
  if (!results.length) {
    return page(query + ' - search', `<div class="head">No results for &ldquo;${escapeHtml(query)}&rdquo;</div>`);
  }

  const items = results.map(r => {
    // Every result opens through the proxy rather than leaving it.
    let href;
    try {
      href = webproxy.proxyPathFor(r.url);
    } catch (err) {
      return '';
    }
    return `<div class="result">
      <a class="title" href="${escapeHtml(href)}">${plain(r.title)}</a>
      <div class="url">${plain(r.url)}</div>
      <div class="desc">${plain(r.description)}</div>
    </div>`;
  }).join('');

  return page(query + ' - search',
    `<div class="head">${results.length} results for &ldquo;${escapeHtml(query)}&rdquo; &middot; via Brave Search</div>${items}`);
}

function handle(req, res, urlObj, apiKey) {
  const query = (urlObj.searchParams.get('q') || '').trim();

  if (!query) {
    return send(res, 400, notice('No query', ['Add a <code>?q=</code> parameter.']));
  }

  if (!apiKey) {
    return send(res, 503, notice('Search is not configured', [
      'Set <code>BRAVE_API_KEY</code> in the Vercel project environment variables, then redeploy.',
      'Get a key at <code>api-dashboard.search.brave.com</code> — the free tier covers about 2,000 queries a month.',
      'Search engines block this host&rsquo;s datacenter IP, so their pages cannot be scraped; the API is keyed instead of IP-judged.'
    ]));
  }

  const request = https.get({
    hostname: ENDPOINT,
    path: '/res/v1/web/search?count=20&q=' + encodeURIComponent(query),
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    },
    timeout: 15000
  }, apiRes => {
    const chunks = [];
    apiRes.on('data', chunk => chunks.push(chunk));
    apiRes.on('end', () => {
      let raw = Buffer.concat(chunks);
      if ((apiRes.headers['content-encoding'] || '').includes('gzip')) {
        try { raw = zlib.gunzipSync(raw); } catch (err) { /* fall through */ }
      }

      if (apiRes.statusCode === 401 || apiRes.statusCode === 403) {
        return send(res, 502, notice('Search key rejected', [
          'Brave returned ' + apiRes.statusCode + '. Check that <code>BRAVE_API_KEY</code> is correct and the subscription is active.'
        ]));
      }
      if (apiRes.statusCode === 429) {
        return send(res, 502, notice('Search quota reached', [
          'Brave returned 429 (rate limited). The free tier allows roughly 2,000 queries a month and one query per second.'
        ]));
      }
      if (apiRes.statusCode !== 200) {
        return send(res, 502, notice('Search failed', ['Brave returned ' + apiRes.statusCode + '.']));
      }

      let parsed;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch (err) {
        return send(res, 502, notice('Search failed', ['Could not parse the response from Brave.']));
      }

      const results = ((parsed.web && parsed.web.results) || [])
        .filter(r => r && r.url);
      send(res, 200, renderResults(query, results));
    });
  });

  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', err => {
    if (!res.headersSent) send(res, 502, notice('Search failed', [escapeHtml(err.message)]));
  });
}

module.exports = { handle };
