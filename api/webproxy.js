const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const PREFIX = '/api/p/';

// Hosts the proxy refuses to fetch.
const BLOCKED_HOSTS = [
  'facebook.com', 'instagram.com', 'tiktok.com',
  'twitter.com', 'x.com', 'reddit.com'
];

// Response headers that must never be forwarded: they either describe a body we
// re-encode, or they instruct the browser to block framing / cross-origin use.
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'strict-transport-security',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'feature-policy',
  'report-to',
  'nel',
  'set-cookie',
  'alt-svc'
]);

// Request headers that describe our own hop and must not be replayed upstream.
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'accept-encoding',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-fetch-user',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-vercel-id',
  'x-vercel-deployment-url',
  'x-vercel-forwarded-for',
  'x-real-ip',
  'forwarded'
]);

function encodeOrigin(origin) {
  return Buffer.from(origin, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeOrigin(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function isBlocked(hostname) {
  return BLOCKED_HOSTS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
}

/**
 * Turns `/api/p/<b64 origin>/<path>?<query>` back into the absolute target URL.
 * The path after the origin segment mirrors the real path, so relative URLs
 * inside the proxied page resolve to the right proxy path without rewriting.
 */
function parseProxyPath(requestUrl) {
  const withoutPrefix = requestUrl.slice(PREFIX.length);
  const slash = withoutPrefix.indexOf('/');
  const originSegment = slash === -1 ? withoutPrefix : withoutPrefix.slice(0, slash);
  const rest = slash === -1 ? '/' : withoutPrefix.slice(slash);

  const questionMark = originSegment.indexOf('?');
  const cleanSegment = questionMark === -1 ? originSegment : originSegment.slice(0, questionMark);

  let origin;
  try {
    origin = decodeOrigin(cleanSegment);
  } catch (err) {
    return null;
  }

  if (!/^https?:\/\/[^/]+$/i.test(origin)) return null;

  try {
    return { origin, target: new URL(rest, origin) };
  } catch (err) {
    return null;
  }
}

function proxyPathFor(absoluteUrl) {
  const u = new URL(absoluteUrl);
  return PREFIX + encodeOrigin(u.origin) + u.pathname + u.search;
}

/**
 * Set-Cookie rewriting: the cookie is stored against our origin, so the target's
 * Domain is meaningless and the Path must point back into the proxy namespace.
 */
function rewriteSetCookie(values) {
  return values.map(cookie =>
    cookie
      .split(/;\s*/)
      .filter(part => !/^domain=/i.test(part) && !/^samesite=/i.test(part))
      .map(part => (/^path=/i.test(part) ? 'Path=' + PREFIX : part))
      .concat('Path=' + PREFIX, 'SameSite=None', 'Secure')
      .filter((part, index, all) => {
        if (!/^path=/i.test(part)) return true;
        return all.findIndex(p => /^path=/i.test(p)) === index;
      })
      .join('; ')
  );
}

// zstd only exists on newer Node; anything not listed here must never be
// requested upstream, or we would serve compressed bytes as text.
const DECODABLE = ['gzip', 'deflate', 'br']
  .concat(typeof zlib.zstdDecompressSync === 'function' ? ['zstd'] : []);

function decompress(buffer, encoding) {
  const enc = (encoding || '').toLowerCase();
  if (!enc || enc === 'identity') return buffer;
  if (enc.includes('zstd')) {
    if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('zstd unsupported');
    return zlib.zstdDecompressSync(buffer);
  }
  if (enc.includes('br')) return zlib.brotliDecompressSync(buffer);
  if (enc.includes('gzip')) return zlib.gunzipSync(buffer);
  if (enc.includes('deflate')) return zlib.inflateSync(buffer);
  throw new Error('unknown content-encoding: ' + enc);
}

// Chrome advertises zstd. Forwarding that verbatim made origins reply with an
// encoding we could not decode, and the raw bytes were served as HTML.
function upstreamAcceptEncoding(clientValue) {
  if (!clientValue) return DECODABLE.join(', ');
  const kept = String(clientValue)
    .split(',')
    .map(part => part.trim())
    .filter(part => DECODABLE.includes(part.split(';')[0].trim().toLowerCase()));
  return kept.length ? kept.join(', ') : DECODABLE.join(', ');
}

/**
 * Injected into every proxied HTML document. The service worker already routes
 * all network traffic, so this only patches the APIs that change URLs without
 * making a request (SPA history, popups) and would otherwise escape the prefix.
 */
function clientShim(origin) {
  return `<script>(function(){
  var PREFIX = ${JSON.stringify(PREFIX)};
  var ORIGIN = ${JSON.stringify(origin)};
  function enc(s){return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
  function dec(s){return atob(s.replace(/-/g,'+').replace(/_/g,'/'));}
  function realUrl(){
    var seg = PREFIX + enc(ORIGIN);
    var path = location.pathname.indexOf(seg) === 0 ? location.pathname.slice(seg.length) : '/';
    return ORIGIN + (path || '/') + location.search + location.hash;
  }
  function isProxyPath(pathname){
    if (pathname.indexOf(PREFIX) !== 0) return false;
    var segment = pathname.slice(PREFIX.length).split('/')[0];
    try { return /^https?:\\/\\/[^/]+$/i.test(dec(segment)); } catch (e) { return false; }
  }
  function toProxy(u){
    try {
      var abs = new URL(u, realUrl());
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return u;
      // Idempotent: scripts re-assign already rewritten URLs constantly.
      if (isProxyPath(abs.pathname)) return abs.pathname + abs.search + abs.hash;
      return PREFIX + enc(abs.origin) + abs.pathname + abs.search + abs.hash;
    } catch (e) { return u; }
  }
  window.__proxyRealUrl = realUrl;
  window.__proxyResolve = toProxy;

  var push = history.pushState, replace = history.replaceState;
  history.pushState = function(s, t, u){ return push.call(history, s, t, u == null ? u : toProxy(u)); };
  history.replaceState = function(s, t, u){ return replace.call(history, s, t, u == null ? u : toProxy(u)); };

  var winOpen = window.open;
  window.open = function(u, n, f){ return winOpen.call(window, u ? toProxy(u) : u, n, f); };

  // URLs built at runtime never pass through the server-side rewriter. The
  // service worker catches them when it is available; these patches cover the
  // same traffic when it is not (registration blocked, or still activating).
  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function(input, init){
      try {
        if (typeof input === 'string') {
          input = toProxy(input);
        } else if (input && input.url) {
          input = new Request(toProxy(input.url), input);
        }
      } catch (e) {}
      return nativeFetch.call(window, input, init);
    };
  }

  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    var args = [].slice.call(arguments);
    try { args[1] = toProxy(url); } catch (e) {}
    return xhrOpen.apply(this, args);
  };

  if (navigator.sendBeacon) {
    var beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data){
      try { url = toProxy(url); } catch (e) {}
      return beacon(url, data);
    };
  }

  // A nested registration would claim a scope deeper than ours
  // (/api/p/<origin>/ beats /api/p/), so the site's own worker would win and
  // route requests it cannot understand. YouTube does this, and the result is a
  // reload loop. Keep the promise unsettled rather than rejecting, since a
  // rejection triggers unhandled-rejection paths in some apps.
  if (navigator.serviceWorker) {
    try {
      Object.defineProperty(navigator.serviceWorker, 'register', {
        configurable: true,
        value: function(){ return new Promise(function(){}); }
      });
      Object.defineProperty(navigator.serviceWorker, 'getRegistration', {
        configurable: true,
        value: function(){ return Promise.resolve(undefined); }
      });
      Object.defineProperty(navigator.serviceWorker, 'getRegistrations', {
        configurable: true,
        value: function(){ return Promise.resolve([]); }
      });
    } catch (e) {}
  }

  // Navigations are the escapes that hurt: they leave proxy space entirely and
  // the page reloads as our 404. Anchor clicks and form submits are catchable
  // here even when the URL was never written through a patched setter.
  // (location.href assignment still is not: location is unforgeable.)
  document.addEventListener('click', function(ev){
    try {
      var a = ev.target && ev.target.closest && ev.target.closest('a[href]');
      if (!a) return;
      var raw = a.getAttribute('href');
      if (!raw || /^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(raw)) return;
      var fixed = toProxy(raw);
      if (fixed !== raw && a.href !== new URL(fixed, location.href).href) {
        a.setAttribute('href', fixed);
      }
    } catch (e) {}
  }, true);

  document.addEventListener('submit', function(ev){
    try {
      var form = ev.target;
      if (!form || !form.getAttribute) return;
      var action = form.getAttribute('action');
      if (action == null || action === '') return;
      var fixed = toProxy(action);
      if (fixed !== action) form.setAttribute('action', fixed);
    } catch (e) {}
  }, true);

  var setAttr = Element.prototype.setAttribute;
  var URL_ATTRS = { src: 1, href: 1, action: 1, poster: 1 };
  Element.prototype.setAttribute = function(name, value){
    if (name && URL_ATTRS[String(name).toLowerCase()] && typeof value === 'string') {
      try { value = toProxy(value); } catch (e) {}
    }
    return setAttr.call(this, name, value);
  };

  // Direct property assignment (img.src = '/x.png') bypasses setAttribute.
  [[window.HTMLImageElement, 'src'], [window.HTMLScriptElement, 'src'],
   [window.HTMLMediaElement, 'src'], [window.HTMLIFrameElement, 'src'],
   [window.HTMLSourceElement, 'src'], [window.HTMLEmbedElement, 'src'],
   [window.HTMLTrackElement, 'src'], [window.HTMLLinkElement, 'href'],
   [window.HTMLAnchorElement, 'href'], [window.HTMLFormElement, 'action']
  ].forEach(function(pair){
    var ctor = pair[0], prop = pair[1];
    if (!ctor || !ctor.prototype) return;
    var desc = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
    if (!desc || !desc.set || !desc.configurable) return;
    Object.defineProperty(ctor.prototype, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function(value){
        try { if (typeof value === 'string') value = toProxy(value); } catch (e) {}
        return desc.set.call(this, value);
      }
    });
  });
})();</script>`;
}

/**
 * Rewrites URLs in markup so a proxied page works even when the service worker
 * is unavailable (registration blocked, still activating, or unsupported).
 * The worker is what catches script-generated URLs; this catches static ones.
 */
/**
 * True when a path is already in proxy space. Decodes the origin segment rather
 * than matching the prefix alone, so a target site that happens to serve its own
 * /api/p/... path is still proxied correctly.
 */
function isProxyPath(pathname) {
  if (!pathname.startsWith(PREFIX)) return false;
  const segment = pathname.slice(PREFIX.length).split('/')[0];
  try {
    return /^https?:\/\/[^/]+$/i.test(decodeOrigin(segment));
  } catch (err) {
    return false;
  }
}

function absoluteToProxy(rawUrl, baseUrl) {
  const trimmed = String(rawUrl).trim();

  if (!trimmed || /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(trimmed)) {
    return rawUrl;
  }

  try {
    const abs = new URL(trimmed, baseUrl);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return rawUrl;

    // Rewriting must be idempotent: page scripts routinely read an already
    // rewritten src/href back out and re-assign it, which would otherwise stack
    // a second /api/p/<origin> prefix and 404.
    if (isProxyPath(abs.pathname)) {
      return abs.pathname + abs.search + abs.hash;
    }

    return PREFIX + encodeOrigin(abs.origin) + abs.pathname + abs.search + abs.hash;
  } catch (err) {
    return rawUrl;
  }
}

function rewriteSrcset(value, baseUrl) {
  return value
    .split(',')
    .map(candidate => {
      const parts = candidate.trim().split(/\s+/);
      if (!parts[0]) return candidate;
      parts[0] = absoluteToProxy(parts[0], baseUrl);
      return parts.join(' ');
    })
    .join(', ');
}

function rewriteCss(css, baseUrl) {
  return css
    .replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
      (match, quote, target) => 'url(' + quote + absoluteToProxy(target, baseUrl) + quote + ')')
    .replace(/@import\s+(['"])([^'"]+)\1/gi,
      (match, quote, target) => '@import ' + quote + absoluteToProxy(target, baseUrl) + quote);
}

function rewriteHtmlUrls(html, baseUrl) {
  let out = html.replace(
    /\b(href|src|action|poster|data-src|formaction)\s*=\s*(["'])([^"']*)\2/gi,
    (match, attr, quote, value) => attr + '=' + quote + absoluteToProxy(value, baseUrl) + quote
  );

  out = out.replace(
    /\b(srcset|imagesrcset)\s*=\s*(["'])([^"']*)\2/gi,
    (match, attr, quote, value) => attr + '=' + quote + rewriteSrcset(value, baseUrl) + quote
  );

  // An unrewritten <base> would re-anchor every remaining relative URL onto the
  // real host, which is precisely what we are avoiding.
  out = out.replace(/<base\b[^>]*>/gi, '');

  out = out.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (match, css) => match.replace(css, rewriteCss(css, baseUrl))
  );

  return out;
}

function injectIntoHtml(html, origin, baseUrl) {
  // Meta CSP would block the injected script and every rewritten subresource.
  let out = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  out = rewriteHtmlUrls(out, baseUrl);
  const shim = clientShim(origin);

  if (/<head[^>]*>/i.test(out)) {
    return out.replace(/<head[^>]*>/i, match => match + shim);
  }
  if (/<html[^>]*>/i.test(out)) {
    return out.replace(/<html[^>]*>/i, match => match + shim);
  }
  return shim + out;
}

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function handleProxy(req, res, requestUrl) {
  const parsed = parseProxyPath(requestUrl);

  if (!parsed) {
    return sendError(res, 400, 'Malformed proxy URL');
  }

  const { origin, target } = parsed;

  if (isBlocked(target.hostname)) {
    return sendError(res, 403, 'Domain blocked');
  }

  const transport = target.protocol === 'https:' ? https : http;

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers[name] = value;
    }
  }
  headers['host'] = target.host;
  // Non-HTML bodies stream through still compressed, so only ask upstream for
  // encodings this client actually announced it can decode.
  headers['accept-encoding'] = upstreamAcceptEncoding(req.headers['accept-encoding']);

  // Referer/Origin must describe the target site, not our proxy host, or the
  // target rejects the request as cross-site.
  if (headers['referer']) {
    try {
      const ref = new URL(headers['referer']);
      headers['referer'] = ref.pathname.startsWith(PREFIX)
        ? (parseProxyPath(ref.pathname + ref.search) || {}).target?.href || origin + '/'
        : origin + '/';
    } catch (err) {
      headers['referer'] = origin + '/';
    }
  }
  if (headers['origin']) {
    headers['origin'] = origin;
  }

  const upstream = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers,
      timeout: 20000
    },
    upstreamRes => {
      const status = upstreamRes.statusCode || 502;
      const outHeaders = {};

      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
          outHeaders[name] = value;
        }
      }

      if (upstreamRes.headers['set-cookie']) {
        outHeaders['set-cookie'] = rewriteSetCookie(upstreamRes.headers['set-cookie']);
      }

      // Keep redirects inside the proxy namespace.
      if (status >= 300 && status < 400 && upstreamRes.headers.location) {
        try {
          outHeaders['location'] = proxyPathFor(new URL(upstreamRes.headers.location, target).href);
        } catch (err) {
          delete outHeaders['location'];
        }
      }

      const contentType = upstreamRes.headers['content-type'] || '';
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);
      const isCss = /text\/css/i.test(contentType);

      if (!isHtml && !isCss) {
        // Everything else streams through untouched, which keeps images, fonts,
        // media and script bytes intact.
        outHeaders['content-encoding'] = upstreamRes.headers['content-encoding'];
        if (!outHeaders['content-encoding']) delete outHeaders['content-encoding'];
        if (upstreamRes.headers['content-length']) {
          outHeaders['content-length'] = upstreamRes.headers['content-length'];
        }
        res.writeHead(status, outHeaders);
        upstreamRes.pipe(res);
        return;
      }

      const chunks = [];
      let size = 0;

      upstreamRes.on('data', chunk => {
        chunks.push(chunk);
        size += chunk.length;
        if (size > 12 * 1024 * 1024) {
          upstreamRes.destroy();
        }
      });

      upstreamRes.on('end', () => {
        const raw = Buffer.concat(chunks);
        let body;
        try {
          body = decompress(raw, upstreamRes.headers['content-encoding']).toString('utf8');
        } catch (err) {
          // Decoding failed, so the bytes are not text we can rewrite. Hand them
          // back compressed and let the browser decode, rather than rendering
          // the compressed stream as characters.
          const passthrough = Object.assign({}, outHeaders);
          if (upstreamRes.headers['content-encoding']) {
            passthrough['content-encoding'] = upstreamRes.headers['content-encoding'];
          }
          res.writeHead(status, passthrough);
          res.end(raw);
          return;
        }

        const rewritten = isCss
          ? rewriteCss(body, target.href)
          : injectIntoHtml(body, origin, target.href);

        outHeaders['content-type'] = contentType || (isCss ? 'text/css' : 'text/html; charset=utf-8');
        res.writeHead(status, outHeaders);
        res.end(rewritten);
      });
    }
  );

  upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error', err => {
    if (!res.headersSent) sendError(res, 502, 'Proxy error: ' + err.message);
    else res.end();
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    upstream.end();
  } else {
    req.pipe(upstream);
  }
}

/**
 * Service worker source, served from within the proxy prefix so its scope is
 * limited to proxied pages and it never intercepts the rest of the site.
 */
const SERVICE_WORKER = `
const PREFIX = ${JSON.stringify(PREFIX)};

function enc(s) {
  return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}

function dec(s) {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

function baseOriginOf(clientUrl) {
  try {
    const u = new URL(clientUrl);
    if (!u.pathname.startsWith(PREFIX)) return null;
    const segment = u.pathname.slice(PREFIX.length).split('/')[0];
    const origin = dec(segment);
    return /^https?:\\/\\/[^/]+$/i.test(origin) ? origin : null;
  } catch (e) {
    return null;
  }
}

function toProxy(absoluteUrl) {
  const u = new URL(absoluteUrl);
  return PREFIX + enc(u.origin) + u.pathname + u.search;
}

self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  event.respondWith((async () => {
    const request = event.request;
    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;

    // A rejected promise here makes respondWith produce a network error. On a
    // navigation that blanks the page and the site's shell retries, which shows
    // up as a reload loop, so every fetch below is guarded.
    function fail(e) {
      return new Response('Proxy fetch failed: ' + (e && e.message), {
        status: 502,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Already addressed to the proxy: let it through untouched.
    if (sameOrigin && url.pathname.startsWith(PREFIX)) {
      return fetch(request).catch(fail);
    }

    let base = null;
    if (event.clientId) {
      const client = await self.clients.get(event.clientId);
      if (client) base = baseOriginOf(client.url);
    }
    if (!base && request.referrer) base = baseOriginOf(request.referrer);
    if (!base && event.resultingClientId) {
      const client = await self.clients.get(event.resultingClientId);
      if (client) base = baseOriginOf(client.url);
    }

    // Root-relative URL that escaped the prefix: re-anchor it on the real site.
    let target;
    if (sameOrigin) {
      if (!base) return fetch(request).catch(fail);
      target = base + url.pathname + url.search;
    } else {
      target = request.url;
    }

    const proxied = toProxy(target);

    const init = {
      method: request.method,
      headers: request.headers,
      credentials: 'include',
      redirect: 'follow',
      mode: request.mode === 'navigate' ? 'same-origin' : 'cors'
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.clone().arrayBuffer();
    }

    try {
      return await fetch(new Request(proxied, init));
    } catch (e) {
      return fail(e);
    }
  })());
});
`;

function handleServiceWorker(res) {
  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Service-Worker-Allowed': PREFIX,
    'Cache-Control': 'no-cache'
  });
  res.end(SERVICE_WORKER);
}

module.exports = {
  PREFIX,
  encodeOrigin,
  decodeOrigin,
  proxyPathFor,
  rewriteHtmlUrls,
  rewriteCss,
  isProxyPath,
  absoluteToProxy,
  handleProxy,
  handleServiceWorker,
  SERVICE_WORKER
};
