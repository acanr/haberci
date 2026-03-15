const express = require('express');
const cors = require('cors');
const path = require('path');
const { getTopNews } = require('./lib/rss');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LOCATIONS = ['Turkiye', 'Dunya', 'Ekonomi', 'Spor', 'Teknoloji', 'Istanbul'];
const LOCATION_MAP = {
  'Turkiye': 'Türkiye',
  'Dunya': 'Dünya', 
  'Ekonomi': 'Ekonomi',
  'Spor': 'Spor',
  'Teknoloji': 'Teknoloji',
  'Istanbul': 'İstanbul',
};

app.get('/api/news', async (req, res) => {
  const locKey = req.query.loc || 'Turkiye';
  const loc = LOCATION_MAP[locKey];
  if (!loc) return res.status(400).json({ error: 'Geçersiz lokasyon', received: locKey });
  
  try {
    const data = await getTopNews(loc);
    if (!data || !data.candidates.length) {
      return res.status(503).json({ error: 'Haber bulunamadı', articleCount: data?.articleCount || 0 });
    }
    data.candidates = data.candidates.filter(c => !isBlacklisted(c.title));
    const news = data.candidates.slice(0, 5).map((c, i) => ({
      rank: i + 1,
      category: guessCategory(c.title, loc),
      headline: c.title,
      summary: c.description || 'Detaylar için habere tıklayın.',
      isBreaking: c.isBreaking,
      sourceCount: c.sourceCount,
      sources: c.sources,
      link: c.link,
    }));

    res.json({
      news,
      articleCount: data.articleCount,
      location: loc,
      updatedAt: Date.now(),
      cacheAge: 0,
      nextUpdateIn: 900,
    });
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/test', async (req, res) => {
  try {
    const fetch = require('node-fetch');
    const r = await fetch('https://www.ntv.com.tr/son-dakika.rss', { timeout: 5000 });
    res.json({ status: r.status, ok: r.ok });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
const SEO_BLACKLIST = [
  'deprem mi oldu', 'nerede oldu', 'kac siddetinde', 
  'son depremler', 'deprem buyuklugu', 'afad son',
  'kandilli', 'hava durumu', 'namaz vakti', 'nöbetçi eczane'
];

function isBlacklisted(title) {
  const t = (title || '').toLowerCase();
  return SEO_BLACKLIST.some(function(kw) { return t.indexOf(kw) !== -1; });
}
function guessCategory(title, loc) {
  const t = (title || '').toLowerCase();
  if (t.includes('borsa') || t.includes('dolar') || t.includes('faiz') || t.includes('enflasyon')) return 'Ekonomi';
  if (t.includes('deprem')) return 'Deprem';
  if (t.includes('savaş') || t.includes('saldırı') || t.includes('ordu')) return 'Güvenlik';
  if (t.includes('seçim') || t.includes('meclis') || t.includes('cumhurbaşkan')) return 'Siyaset';
  if (t.includes('maç') || t.includes('gol') || t.includes('futbol')) return 'Spor';
  if (t.includes('yapay zeka') || t.includes('teknoloji') || t.includes('iphone')) return 'Teknoloji';
  if (loc === 'Spor') return 'Spor';
  if (loc === 'Ekonomi') return 'Ekonomi';
  if (loc === 'Teknoloji') return 'Teknoloji';
  return 'Gündem';
}

module.exports = app;
