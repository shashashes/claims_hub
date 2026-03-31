// /api/trackingmore.js
// Vercel serverless function that proxies requests to TrackingMore API
// This avoids CORS issues from browser-side requests

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const API_KEY = process.env.TM_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'TM_API_KEY not configured' });
  }

  try {
    // Forward query params to TrackingMore
    const params = new URLSearchParams(req.query);
    const endpoint = '/trackings/get';
    const tmUrl = `https://api.trackingmore.com/v4${endpoint}?${params.toString()}`;

    const tmRes = await fetch(tmUrl, {
      method: req.method === 'POST' ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Tracking-Api-Key': API_KEY,
      },
      ...(req.method === 'POST' && req.body ? { body: JSON.stringify(req.body) } : {}),
    });

    const data = await tmRes.json();
    return res.status(tmRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
