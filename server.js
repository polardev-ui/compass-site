const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const scramjet = require('./scramjet');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  const env = {};
  
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const lines = content.split('\n');
      
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          env[key.trim()] = value;
        }
      });
    }
  } catch (err) {
    console.warn('Warning: Could not read .env file:', err.message);
  }
  
  return env;
}

const env = loadEnv();

function isBotUA(userAgent = '') {
  const botPatterns = [
    /bot/i, /crawler/i, /spider/i, /scraper/i, /curl/i, /wget/i,
    /python/i, /java(?!script)/i, /googlebot/i, /bingbot/i,
    /yandexbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
    /nutch/i, /mediapartners/i, /teoma/i, /gigablast/i
  ];
  return botPatterns.some(pattern => pattern.test(userAgent));
}

function handleAPIRequest(req, res) {
  const urlObj = new url.URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  if (pathname === '/api/scramjet/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(scramjet.getStatus()));
    return true;
  }

  if (pathname === '/api/scramjet/test') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(scramjet.test()));
    return true;
  }

  if (pathname === '/api/verify-user') {
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    const isBot = isBotUA(userAgent);

    if (isBot || !acceptLanguage) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'User verification failed' }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ verified: true, user_type: 'human' }));
    }
    return true;
  }

  if (pathname === '/api/proxy' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1024 * 100) {
        res.writeHead(413);
        res.end('Payload too large');
      }
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const targetURL = data.url;

        if (!targetURL || !targetURL.match(/^https?:\/\//)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid URL' }));
          return;
        }

        const blockedDomains = [
          'facebook.com', 'instagram.com', 'tiktok.com',
          'twitter.com', 'x.com', 'reddit.com'
        ];
        const urlHostname = new URL(targetURL).hostname;
        if (blockedDomains.some(domain => urlHostname.includes(domain))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Domain blocked for privacy' }));
          return;
        }

        const proxyResult = await scramjet.proxy(targetURL);

        if (proxyResult.error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: proxyResult.error }));
          return;
        }

        const isHTML = proxyResult.contentType?.includes('text/html');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: isHTML ? 'html' : 'text',
          content: proxyResult.content,
          status: 'success'
        }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message || 'Proxy error' }));
      }
    });
    return true;
  }

  return false;
}

console.log('Environment variables loaded:');
Object.keys(env).forEach(key => {
  console.log(`  ✓ ${key}`);
});

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    if (handleAPIRequest(req, res)) {
      return;
    }
  }

  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  const ext = path.extname(filePath);
  
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      let content = fs.readFileSync(filePath, 'utf-8');
      
      if (ext === '.html') {
        const envScript = `
<script>
window.__env = ${JSON.stringify(env)};
</script>
`;
        content = content.replace('</head>', envScript + '</head>');
      }
      
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4'
      };
      
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(content);
    } else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        let content = fs.readFileSync(indexPath, 'utf-8');
        const envScript = `
<script>
window.__env = ${JSON.stringify(env)};
</script>
`;
        content = content.replace('</head>', envScript + '</head>');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (err) {
    console.error('Error:', err);
    res.writeHead(500);
    res.end('Internal server error');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {});
