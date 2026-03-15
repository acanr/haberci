const express = require('express');
const cors = require('cors');
const path = require('path');
const { getTopNews } = require('./lib/rss');
const { summarizeTopNews } = require('./lib/summarizer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const cache = new Map();
const LOCATIONS = ['Türkiye', 'Dünya', 'Ekonomi', 'Spor', 'Teknoloji', 'İstanbul'];

function getCached(loc) {
  const entry = cache.get(loc);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > 20 * 60 * 1000) return null;
  return entry;
}

async function updateNews(location) {
  try {
    const rssData = await getTopNews(location);
    if (!rssData || rssData.candidates.length === 0) return;
    const news = await summarizeTopNews(rssData.candidates, location);
    cache.set(location, {
      location, news,
      updatedAt: Date.now(),
      articleCount: rssData.articleCount,
      clusterCount: rssData.clusterCount,
      nextUpdate: Date.now() + 15 * 60 * 1000,
    });
  } catch (err) {
    console.error(`[ERROR] ${location}:`, err.message);
  }
}

app.get('/api/news', async (req, res) => {
  const loc = req.query.loc || 'Türkiye';
  if (!LOCATIONS.includes(loc)) return res.status(400).json({ error: 'Geçersiz lokasyon' });
  let cached = getCached(loc);
  if (!cached) {
    await updateNews(loc);
    cached = getCached(loc);
  }
  if (!cached) return res.status(503).json({ error: 'Haberler yüklenemiyor.' });
  res.json({
    ...cached,
    cacheAge: Math.round((Date.now() - cached.updatedAt) / 1000),
    nextUpdateIn: Math.max(0, Math.round((cached.nextUpdate - Date.now()) / 1000)),
  });
});

app.get('/api/status', (req, res) => {
  res.json({ status: LOCATIONS.map(loc => ({ location: loc, cached: cache.has(loc) })), serverTime: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
