const express = require('express');
const cors = require('cors');
const path = require('path');
const { getTopNews } = require('./lib/rss');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LOCATIONS = ['Türkiye', 'Dünya', 'Ekonomi', 'Spor', 'Teknoloji', 'İstanbul'];

app.get('/api/news', async (req, res) => {
  const loc = req.query.loc || 'Türkiye';
  if (!LOCATIONS.includes(loc)) return res.status(400).json({ error: 'Geçersiz lokasyon' });
  try {
    const data = await getTopNews(loc);
    if (!data || !data.candidates.length) return res.status(503).json({ error: 'Haber bulunamadı' });
    
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function guessCategory(title, loc) {
  const t = title.toLowerCase();
  if (t.includes('borsa') || t.includes('dolar') || t.includes('faiz') || t.includes('enflasyon') || t.includes('ekonomi')) return 'Ekonomi';
  if (t.includes('deprem')) return 'Deprem';
  if (t.includes('savaş') || t.includes('saldırı') || t.includes('ordu') || t.includes('asker')) return 'Güvenlik';
  if (t.includes('seçim') || t.includes('meclis') || t.includes('cumhurbaşkan') || t.includes('hükümet')) return 'Siyaset';
  if (t.includes('maç') || t.includes('gol') || t.includes('futbol') || t.includes('spor') || t.includes('şampiyon')) return 'Spor';
  if (t.includes('yapay zeka') || t.includes('teknoloji') || t.includes('iphone') || t.includes('yazılım')) return 'Teknoloji';
  if (t.includes('istanbul') || t.includes('ankara') || t.includes('izmir')) return 'Şehir';
  if (loc === 'Spor') return 'Spor';
  if (loc === 'Ekonomi') return 'Ekonomi';
  if (loc === 'Teknoloji') return 'Teknoloji';
  return 'Gündem';
}

module.exports = app;
