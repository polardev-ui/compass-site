module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    version: '4.36.2',
    operational: true,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    platform: 'Vercel'
  });
}
