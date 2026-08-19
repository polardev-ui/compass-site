module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    status: 'operational',
    version: '4.36.2',
    latency: Math.floor(Math.random() * 50) + 5,
    platform: 'Vercel'
  });
}
