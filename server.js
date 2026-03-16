const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GNEWS_KEY = process.env.GNEWS_API_KEY;
const LOCATIONS = ['Turkiye', 'Dunya', 'Ekonomi', 'Spor', 'Teknoloji', 'Istanbul'];

const GNEWS_PARAMS = {
  'Turkiye':     { lang: 'tr', country: 'tr', topic: 'breaking-news', q: 'türkiye OR ankara OR erdoğan OR meclis OR hükümet' },
  'SonHaberler': { lang: 'tr', country: 'tr', topic: 'breaking-news' },
  'Dunya':       { lang: 'tr', topic: 'world' },
  'Ekonomi':     { lang: 'tr', country: 'tr', topic: 'business' },
  'Spor':        { lang: 'tr', country: 'tr', topic: 'sports' },
  'Teknoloji':   { lang: 'tr', topic: 'technology' },
  'Istanbul':    { lang: 'tr', q: 'istanbul' },
};

const LOCATIONS = ['Turkiye', 'SonHaberler', 'Dunya', 'Ekonomi', 'Spor', 'Teknoloji', 'Istanbul'];

const LOC_DISPLAY = {
  'Turkiye': 'Turkiye', 'Dunya': 'Dunya', 'Ekonomi': 'Ekonomi',
  'Spor': 'Spor', 'Teknoloji': 'Teknoloji', 'Istanbul': 'Istanbul',
};

const cache = new Map();

async function fetchNews(location) {
  const fetch = require('node-fetch');
  const params = GNEWS_PARAMS[location] || GNEWS_PARAMS['Turkiye'];
  
  let url = 'https://gnews.io/api/v4/top-headlines?';
  url += 'lang=' + params.lang;
  url += '&country=' + params.country;
  if (params.topic) url += '&topic=' + params.topic;
  if (params.q) url += '&q=' + encodeURIComponent(params.q);
  url += '&max=10';
  url += '&apikey=' + GNEWS_KEY;

  const res = await fetch(url, { timeout: 8000 });
  if (!res.ok) throw new Error('GNews API hatasi: ' + res.status);
  const data = await res.json();
  
  if (!data.articles || data.articles.length === 0) {
    throw new Error('Haber bulunamadi');
  }

  const news = data.articles.slice(0, 5).map(function(a, i) {
    return {
      rank: i + 1,
      category: guessCategory(a.title, a.description, location),
      headline: a.title,
      summary: a.description || 'Detaylar icin habere tiklayin.',
      isBreaking: false,
      sourceCount: 1,
      sources: [a.source ? a.source.name : 'Haber'],
      link: a.url,
    };
  });

  return {
    news: news,
    articleCount: data.articles.length,
    location: LOC_DISPLAY[location] || location,
    updatedAt: Date.now(),
    cacheAge: 0,
    nextUpdateIn: 900,
  };
}

app.get('/api/news', async function(req, res) {
  const loc = req.query.loc || 'Turkiye';
  if (LOCATIONS.indexOf(loc) === -1) {
    return res.status(400).json({ error: 'Gecersiz lokasyon', received: loc });
  }

  const cached = cache.get(loc);
  if (cached && (Date.now() - cached.updatedAt) < 15 * 60 * 1000) {
    return res.json(Object.assign({}, cached, {
      cacheAge: Math.round((Date.now() - cached.updatedAt) / 1000),
      nextUpdateIn: Math.max(0, Math.round((cached.updatedAt + 900000 - Date.now()) / 1000)),
    }));
  }

  try {
    const data = await fetchNews(loc);
    cache.set(loc, data);
    res.json(data);
  } catch (err) {
    console.error('[ERROR]', err.message);
    if (cached) return res.json(cached);
    res.status(503).json({ error: err.message });
  }
});

app.get('/api/status', function(req, res) {
  res.json({
    locations: LOCATIONS.map(function(loc) {
      const c = cache.get(loc);
      return { location: loc, cached: !!c, updatedAt: c ? new Date(c.updatedAt).toISOString() : null };
    }),
    serverTime: new Date().toISOString(),
  });
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function guessCategory(title, desc, loc) {
  const t = ((title || '') + ' ' + (desc || '')).toLowerCase();
  if (t.indexOf('borsa') !== -1 || t.indexOf('dolar') !== -1 || t.indexOf('faiz') !== -1 || t.indexOf('enflasyon') !== -1) return 'Ekonomi';
  if (t.indexOf('deprem') !== -1) return 'Deprem';
  if (t.indexOf('savas') !== -1 || t.indexOf('saldiri') !== -1 || t.indexOf('ordu') !== -1) return 'Guvenlik';
  if (t.indexOf('secim') !== -1 || t.indexOf('meclis') !== -1 || t.indexOf('cumhurbaskani') !== -1) return 'Siyaset';
  if (t.indexOf('mac') !== -1 || t.indexOf('gol') !== -1 || t.indexOf('futbol') !== -1) return 'Spor';
  if (t.indexOf('yapay zeka') !== -1 || t.indexOf('teknoloji') !== -1 || t.indexOf('iphone') !== -1) return 'Teknoloji';
  if (loc === 'Spor') return 'Spor';
  if (loc === 'Ekonomi') return 'Ekonomi';
  if (loc === 'Teknoloji') return 'Teknoloji';
  return 'Gundem';
}

module.exports = app;
