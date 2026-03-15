require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const { getTopNews } = require('./lib/rss');
const { summarizeTopNews } = require('./lib/summarizer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const cache = new Map();

function getCached(loc) {
  const entry = cache.get(loc);
  if (!entry) return null;
  const age = Date.now() - entry.updatedAt;
  if (age > 20 * 60 * 1000) return null;
  return entry;
}

async function updateNews(location) {
  console.log(`[CRON] ${location} güncelleniyor — ${new Date().toLocaleTimeString('tr-TR')}`);
  try {
    const rssData = await getTopNews(location);
    if (!rssData || rssData.candidates.length === 0) return;

    const existing = cache.get(location);
    const existingTitles = existing?.news?.map(n => n.headline) || [];
    const newTopTitle = rssData.candidates[0]?.title || '';
    const hasChange = !existingTitles.some(t => similarity(t, newTopTitle) > 0.6);

    if (!existing || hasChange) {
      console.log(`[Claude] ${location} için özetleme yapılıyor...`);
      const news = await summarizeTopNews(rssData.candidates, location);
      cache.set(location, {
        location, news,
        updatedAt: Date.now(),
        articleCount: rssData.articleCount,
        clusterCount: rssData.clusterCount,
        nextUpdate: Date.now() + 15 * 60 * 1000,
      });
      console.log(`[OK] ${location} güncellendi`);
    } else {
      if (existing) {
        existing.updatedAt = Date.now();
        existing.nextUpdate = Date.now() + 15 * 60 * 1000;
      }
    }
  } catch (err) {
    console.error(`[ERROR] ${location}:`, err.message);
  }
}

const LOCATIONS = ['Türkiye', 'Dünya', 'Ekonomi', 'Spor', 'Teknoloji', 'İstanbul'];

async function updateAll() {
  for (const loc of LOCATIONS) {
    await updateNews(loc);
    await sleep(3000);
  }
}

cron.schedule('*/15 * * * *', () => updateAll().catch(console.error));

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
  const status = LOCATIONS.map(loc => {
    const entry = cache.get(loc);
    return { location: loc, cached: !!entry, updatedAt: entry ? new Date(entry.updatedAt).toISOString() : null };
  });
  res.json({ status, serverTime: new Date().toISOString() });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🗞 Haberci → http://localhost:${PORT}`);
  await updateAll();
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function similarity(a, b) {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.max(wa.size, wb.size, 1);
}
