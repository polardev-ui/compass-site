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

function renderResults(query, results, providerLabel) {
  if (!results.length) {
    return page(query + ' - search', `<div class="head">No results for &ldquo;${escapeHtml(query)}&rdquo; &middot; via ${escapeHtml(providerLabel)}</div>`);
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
    `<div class="head">${results.length} results for &ldquo;${escapeHtml(query)}&rdquo; &middot; via ${escapeHtml(providerLabel)}</div>${items}`);
}

function fetchJson(options, cb) {
  const request = https.get(options, apiRes => {
    const chunks = [];
    apiRes.on('data', chunk => chunks.push(chunk));
    apiRes.on('end', () => {
      let raw = Buffer.concat(chunks);
      if ((apiRes.headers['content-encoding'] || '').includes('gzip')) {
        try { raw = zlib.gunzipSync(raw); } catch (err) { /* fall through */ }
      }
      let parsed = null;
      try { parsed = JSON.parse(raw.toString('utf8')); } catch (err) { /* not json */ }
      cb(null, apiRes.statusCode, parsed);
    });
  });
  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', err => cb(err));
}

// Providers are ordered by result quality. Each is skipped unless its
// credentials are present, so the chain degrades to a keyless default.
const PROVIDERS = {
  brave: {
    label: 'Brave Search',
    available: env => !!env.BRAVE_API_KEY,
    request: (env, query) => ({
      hostname: 'api.search.brave.com',
      path: '/res/v1/web/search?count=20&q=' + encodeURIComponent(query),
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': env.BRAVE_API_KEY
      },
      timeout: 15000
    }),
    parse: body => ((body.web && body.web.results) || [])
      .map(r => ({ title: r.title, url: r.url, description: r.description }))
  },

  google: {
    label: 'Google',
    available: env => !!(env.GOOGLE_CSE_KEY && env.GOOGLE_CSE_ID),
    request: (env, query) => ({
      hostname: 'www.googleapis.com',
      path: '/customsearch/v1?key=' + encodeURIComponent(env.GOOGLE_CSE_KEY) +
            '&cx=' + encodeURIComponent(env.GOOGLE_CSE_ID) +
            '&num=10&q=' + encodeURIComponent(query),
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip' },
      timeout: 15000
    }),
    parse: body => (body.items || [])
      .map(r => ({ title: r.title, url: r.link, description: r.snippet }))
  },

  // Keyless fallback so search works with no signup at all. Small, old-web
  // index, so results are thin compared with the keyed providers.
  wiby: {
    label: 'wiby.me',
    available: () => true,
    request: (env, query) => ({
      hostname: 'wiby.me',
      path: '/json/?q=' + encodeURIComponent(query),
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip' },
      timeout: 15000
    }),
    parse: body => (Array.isArray(body) ? body : [])
      .map(r => ({ title: r.Title, url: r.URL, description: r.Snippet || r.Description }))
  }
};

const ORDER = ['brave', 'google', 'wiby'];

function handle(req, res, urlObj, env) {
  env = env || {};
  const query = (urlObj.searchParams.get('q') || '').trim();

  if (!query) {
    return send(res, 400, notice('No query', ['Add a <code>?q=</code> parameter.']));
  }

  const requested = urlObj.searchParams.get('engine');
  const chain = (requested && PROVIDERS[requested] ? [requested] : ORDER)
    .filter(name => PROVIDERS[name].available(env));

  if (!chain.length) {
    return send(res, 503, notice('Search is not configured', [
      'No search provider is available.'
    ]));
  }

  const problems = [];

  function attempt(i) {
    if (i >= chain.length) {
      return send(res, 502, notice('Search failed', problems.length ? problems : ['No provider returned results.']));
    }

    const name = chain[i];
    const provider = PROVIDERS[name];

    fetchJson(provider.request(env, query), (err, status, body) => {
      if (err) {
        problems.push(escapeHtml(provider.label + ': ' + err.message));
        return attempt(i + 1);
      }
      if (status === 401 || status === 403) {
        problems.push(provider.label + ': key rejected (' + status + '). Check the credentials in the Vercel environment variables.');
        return attempt(i + 1);
      }
      if (status === 429) {
        problems.push(provider.label + ': rate limited or quota exhausted (429).');
        return attempt(i + 1);
      }
      if (status !== 200 || !body) {
        problems.push(provider.label + ': returned ' + status + '.');
        return attempt(i + 1);
      }

      let results;
      try {
        results = provider.parse(body).filter(r => r && r.url);
      } catch (parseErr) {
        problems.push(provider.label + ': unexpected response shape.');
        return attempt(i + 1);
      }

      if (!results.length && i < chain.length - 1) {
        problems.push(provider.label + ': no results.');
        return attempt(i + 1);
      }

      send(res, 200, renderResults(query, results, provider.label));
    });
  }

  attempt(0);
}

module.exports = { handle };
