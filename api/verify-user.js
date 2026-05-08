function isBotUA(userAgent = '') {
  const botPatterns = [
    /bot/i, /crawler/i, /spider/i, /scraper/i, /curl/i, /wget/i,
    /python/i, /java(?!script)/i, /googlebot/i, /bingbot/i,
    /yandexbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
    /nutch/i, /mediapartners/i, /teoma/i, /gigablast/i
  ];
  return botPatterns.some(pattern => pattern.test(userAgent));
}

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const isBot = isBotUA(userAgent);

  if (isBot || !acceptLanguage) {
    return res.status(403).json({ error: 'User verification failed' });
  }

  return res.status(200).json({
    verified: true,
    user_type: 'human',
    platform: 'Vercel'
  });
}
