const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GNEWS_KEY = process.env.GNEWS_API_KEY;
const LOCATIONS = ['Turkiye', 'Dunya', 'Ekonomi', 'Spor', 'Teknoloji'];

const RSS_SOURCES = {
  'Turkiye': [
    { name: 'NTV',      url: 'https://www.ntv.com.tr/son-dakika.rss' },
    { name: 'Hürriyet', url: 'https://www.hurriyet.com.tr/rss/anasayfa' },
    { name: 'Sözcü',    url: 'https://www.sozcu.com.tr/rss/anasayfa.xml' },
  ],
  'Dunya': [
    { name: 'NTV Dünya',      url: 'https://www.ntv.com.tr/dunya.rss' },
    { name: 'Hürriyet Dünya', url: 'https://www.hurriyet.com.tr/rss/dunya' },
  ],
  'Ekonomi': [
    { name: 'NTV Ekonomi',      url: 'https://www.ntv.com.tr/ekonomi.rss' },
    { name: 'Hürriyet Ekonomi', url: 'https://www.hurriyet.com.tr/rss/ekonomi' },
  ],
  'Spor': [
    { name: 'NTV Spor',      url: 'https://www.ntv.com.tr/spor.rss' },
    { name: 'Hürriyet Spor', url: 'https://www.hurriyet.com.tr/rss/spor' },
  ],
  'Teknoloji': [
    { name: 'Webtekno',    url: 'https://www.webtekno.com/rss.xml' },
    { name: 'ShiftDelete', url: 'https://shiftdelete.net/feed' },
  ],
};

const GNEWS_PARAMS = {
  'Turkiye':   { lang: 'tr', country: 'tr', q: 'türkiye OR ankara OR erdoğan OR meclis OR hükümet OR tbmm' },
  'Dunya':     { lang: 'tr', q: 'dünya' },
  'Ekonomi':   { lang: 'tr', country: 'tr', q: 'ekonomi' },
  'Spor':      { lang: 'tr', country: 'tr', q: 'spor' },
  'Teknoloji': { lang: 'tr', country: 'tr', q: 'teknoloji' },
};

const SPAM_KEYWORDS = ['ihale', 'satın alma', 'daire başkanlığı', 'müdürlüğü ilanı', 'ihalesi', 'şartname', 'teklif zarfı'];

const cache = new Map();

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  if (!match) return '';
  return match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#\d+;/g,'').trim();
}

function parseRSS(xml, sourceName) {
  const items = [];
  const matches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
  for (const match of matches) {
    const content = match[1];
    const title = extractTag(content, 'title');
    const description = extractTag(content, 'description');
    const pubDate = extractTag(content, 'pubDate');
    const link = extractTag(content, 'link') || content.match(/<link>([^<]+)<\/link>/i)?.[1] || '';
    if (title && title.length > 10) {
      items.push({ title, description, pubDate, link, source: sourceName });
    }
  }
  return items.slice(0, 20);
}

async function fetchRSS(source) {
  const fetch = require('node-fetch');
  try {
    const res = await fetch(source.url, {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Haberimvar/1.0)' }
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRSS(xml, source.name);
  } catch (err) {
    console.warn(`[RSS] ${source.name} hata:`, err.message);
    return [];
  }
}

function guessCategory(title, desc, loc) {
  const t = ((title || '') + ' ' + (desc || '')).toLowerCase();
  if (t.includes('borsa') || t.includes('dolar') || t.includes('faiz') || t.includes('enflasyon') || t.includes('merkez bankası')) return 'Ekonomi';
  if (t.includes('deprem')) return 'Deprem';
  if (t.includes('savaş') || t.includes('saldırı') || t.includes('ordu') || t.includes('asker')) return 'Güvenlik';
  if (t.includes('seçim') || t.includes('meclis') || t.includes('cumhurbaşkan') || t.includes('hükümet')) return 'Siyaset';
  if (t.includes('maç') || t.includes('gol') || t.includes('futbol') || t.includes('şampiyon')) return 'Spor';
  if (t.includes('yapay zeka') || t.includes('teknoloji') || t.includes('iphone') || t.includes('samsung')) return 'Teknoloji';
  if (loc === 'Spor') return 'Spor';
  if (loc === 'Ekonomi') return 'Ekonomi';
  if (loc === 'Teknoloji') return 'Teknoloji';
  if (loc === 'Dunya') return 'Dünya';
  return 'Gündem';
}

async function fetchFromRSS(location) {
  const sources = RSS_SOURCES[location] || [];
  const results = await Promise.allSettled(sources.map(fetchRSS));
  const allItems = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  console.log(`[RSS] ${location}: ${allItems.length} haber`);
  if (allItems.length < 3) return null;

  const seen = new Set();
  const sourceCounts = {};
  const unique = allItems.filter(item => {
    const key = item.title.slice(0, 30).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    // Her kaynaktan max 4 haber
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
    if (sourceCounts[item.source] > 4) return false;
    // Spam/ilan filtresi
    const titleLower = item.title.toLowerCase();
    if (SPAM_KEYWORDS.some(kw => titleLower.includes(kw))) return false;
    return true;
  });

  const news = unique.slice(0, 10).map((item, i) => ({
    rank: i + 1,
    category: guessCategory(item.title, item.description, location),
    headline: item.title,
    summary: item.description?.slice(0, 300) || 'Detaylar için habere tıklayın.',
    isBreaking: false,
    sourceCount: 1,
    sources: [item.source],
    link: item.link,
  }));

  return {
    news,
    articleCount: allItems.length,
    location,
    updatedAt: Date.now(),
    cacheAge: 0,
    nextUpdateIn: 900,
    source: 'rss',
  };
}

async function fetchFromGNews(location) {
  const fetch = require('node-fetch');
  const params = GNEWS_PARAMS[location] || GNEWS_PARAMS['Turkiye'];
  let url = 'https://gnews.io/api/v4/top-headlines?lang=' + params.lang;
  if (params.country) url += '&country=' + params.country;
  if (params.q) url += '&q=' + encodeURIComponent(params.q);
  url += '&max=10&apikey=' + GNEWS_KEY;

  const res = await fetch(url, { timeout: 8000 });
  if (!res.ok) throw new Error('GNews API hatası: ' + res.status);
  const data = await res.json();
  if (!data.articles?.length) throw new Error('Haber bulunamadı');

  const news = data.articles.slice(0, 5).map((a, i) => ({
    rank: i + 1,
    category: guessCategory(a.title, a.description, location),
    headline: a.title,
    summary: a.description || 'Detaylar için habere tıklayın.',
    isBreaking: false,
    sourceCount: 1,
    sources: [a.source?.name || 'Haber'],
    link: a.url,
  }));

  return {
    news,
    articleCount: data.articles.length,
    location,
    updatedAt: Date.now(),
    cacheAge: 0,
    nextUpdateIn: 900,
    source: 'gnews',
  };
}

async function fetchNews(location) {
  const rssData = await fetchFromRSS(location);
  if (rssData) return rssData;
  console.log(`[FALLBACK] ${location} GNews'e düşüyor`);
  return await fetchFromGNews(location);
}

app.get('/api/news', async function(req, res) {
  const loc = req.query.loc || 'Turkiye';
  if (!LOCATIONS.includes(loc)) {
    return res.status(400).json({ error: 'Geçersiz lokasyon', received: loc });
  }
  const cached = cache.get(loc);
  if (cached && (Date.now() - cached.updatedAt) < 15 * 60 * 1000) {
    return res.json({
      ...cached,
      cacheAge: Math.round((Date.now() - cached.updatedAt) / 1000),
      nextUpdateIn: Math.max(0, Math.round((cached.updatedAt + 900000 - Date.now()) / 1000))
    });
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
    locations: LOCATIONS.map(loc => {
      const c = cache.get(loc);
      return { location: loc, cached: !!c, source: c?.source, updatedAt: c ? new Date(c.updatedAt).toISOString() : null };
    }),
    serverTime: new Date().toISOString(),
  });
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
