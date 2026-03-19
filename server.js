const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LOCATIONS = ['Gundem', 'Dunya', 'Ekonomi', 'Spor', 'Teknoloji'];

const RSS_SOURCES = {
  'Gundem': [
    { name: 'NTV',        url: 'https://www.ntv.com.tr/gundem.rss',                      weight: 1.0 },
    { name: 'Hürriyet',   url: 'https://www.hurriyet.com.tr/rss/gundem',                  weight: 1.0 },
    { name: 'DW Türkçe',  url: 'https://rss.dw.com/rdf/rss-tur-all',                      weight: 1.0 },
    { name: 'TRT Haber',  url: 'https://www.trthaber.com/sondakika.rss',                  weight: 1.0 },
    { name: 'Sabah',      url: 'https://www.sabah.com.tr/rss/gundem.xml',                 weight: 1.0 },
    { name: 'Sabah SD',   url: 'https://www.sabah.com.tr/rss/sondakika.xml',              weight: 1.0 },
    { name: 'Milliyet',   url: 'https://www.milliyet.com.tr/rss/rssnew/sondakikarss.xml', weight: 1.0 },
    { name: 'Cumhuriyet', url: 'https://www.cumhuriyet.com.tr/rss',                       weight: 1.0 },
    { name: 'Haberturk',  url: 'https://www.haberturk.com/rss',                           weight: 1.0 },
  ],
  'Dunya': [
    { name: 'NTV Dünya',      url: 'https://www.ntv.com.tr/dunya.rss',          weight: 1.2 },
    { name: 'Hürriyet Dünya', url: 'https://www.hurriyet.com.tr/rss/dunya',     weight: 1.0 },
    { name: 'DW Türkçe',      url: 'https://rss.dw.com/rdf/rss-tur-all',        weight: 1.2 },
  ],
  'Ekonomi': [
    { name: 'Hürriyet Ekonomi', url: 'https://www.hurriyet.com.tr/rss/ekonomi', weight: 1.0 },
    { name: 'Bloomberg HT',     url: 'https://www.bloomberght.com/rss',          weight: 1.3 },
  ],
  'Spor': [
    { name: 'Hürriyet Spor', url: 'https://www.hurriyet.com.tr/rss/spor',  weight: 1.0 },
  ],
  'Teknoloji': [
    { name: 'NTV Teknoloji', url: 'https://www.ntv.com.tr/teknoloji.rss', weight: 1.2 },
    { name: 'Webtekno',      url: 'https://www.webtekno.com/rss.xml',      weight: 1.0 },
    { name: 'ShiftDelete',   url: 'https://shiftdelete.net/feed',          weight: 1.0 },
  ],
};

const SPAM_KEYWORDS = [
  'ihale', 'satın alma daire', 'müdürlüğü ilanı', 'ihalesi',
  'şartname', 'teklif zarfı', 'resmi ilan', 'ilan no',
  'tatil deneyimi', 'keşfedin', 'size özel', 'kampanya fırsatı',
  'sponsorlu', 'reklam', 'advertorial', 'brand', 'partner içerik',
  'fırsatı kaçırmayın', 'hemen satın al', 'indirim fırsatı',
  'ücretsiz deneyin', 'tıklayın ve kazanın',
];

const CLICKBAIT_KEYWORDS = [
  'burç', 'astroloji', 'diyet', 'zayıflama', 'kilo ver',
  'tatil pozu', 'bikinili', 'sevgilisiyle', 'çekiliş', 'yarışma',
  'işte o an', 'bakın ne oldu', 'şaşırtan', 'inanamayacaksınız',
];

const IMPORTANCE_KEYWORDS = {
  'deprem': 20,'yangın': 20, 'patlama': 25,
  'hayatını kaybetti': 20, 'öldü': 15, 'yaralı': 10,
  'saldırı': 30, 'kriz': 10,
  'tutuklama': 20, 'tutuklandı': 20, 'gözaltı': 15,
  'görevden alma': 20, 'görevden alındı': 20,
  'istifa': 15, 'ihraç': 15,
  'cumhurbaşkan': 15, 'meclis': 12, 'seçim': 15, 'hükümet': 10,
  'merkez bankası': 15, 'faiz': 12, 'dolar': 10, 'borsa': 10, 'enflasyon': 12,
  'şampiyon': 10, 'gol': 8, 'maç': 8,
  'yapay zeka': 0, 'iphone': 0, 'tesla': 0,
};

const SPOR_KEYWORDS = [
  'maç', 'gol', 'futbol', 'şampiyon', 'hat-trick', 'penaltı',
  'fenerbahçe', 'galatasaray', 'beşiktaş', 'trabzonspor',
  'süper lig', 'milli takım', 'teknik direktör', 'transfer',
];

const STOP_WORDS = new Set([
  've', 'ile', 'bir', 'bu', 'da', 'de', 'den', 'için', 'olan', 'veya',
  'ama', 'çok', 'en', 'mi', 'ne', 'ki', 'the', 'a', 'an', 'in', 'on',
  'at', 'to', 'of', 'is', 'was', 'are', 'oldu', 'etti', 'var', 'yok',
  'son', 'ilk', 'yeni', 'büyük', 'küçük', 'açıkladı', 'dedi', 'geldi',
]);

const cache = new Map();

function decodeEntities(str) {
  return (str || '')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#\d+;/g, '').trim();
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  if (!match) return '';
  return decodeEntities(match[1].replace(/<[^>]+>/g, ''));
}

function parseRSS(xml, source) {
  const items = [];
  const matches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
  for (const match of matches) {
    const content = match[1];
    const title = extractTag(content, 'title');
    const description = extractTag(content, 'description') || extractTag(content, 'announce');
    const pubDate = extractTag(content, 'pubDate');
    let link = extractTag(content, 'link')
      || content.match(/<link>([^<]+)<\/link>/i)?.[1]
      || content.match(/<guid[^>]*isPermaLink="true"[^>]*>([^<]+)<\/guid>/i)?.[1]
      || '';
    if (!link || !link.startsWith('http')) {
      const sourceDomain = source.url.match(/https?:\/\/(?:www\.)?([^/]+)/)?.[1] || '';
      if (sourceDomain) {
        const urlInDesc = content.match(new RegExp(`https?://(?:www\\.)?${sourceDomain.replace('.', '\\.')}[^\\s"'<>]+`, 'i'))?.[0] || '';
        if (urlInDesc.startsWith('http')) link = urlInDesc;
      }
    }
    if (!link || !link.startsWith('http')) {
      const guid = content.match(/<guid[^>]*>([^<]+)<\/guid>/i)?.[1] || '';
      if (guid.startsWith('http')) link = guid;
    }
    if (title && title.length > 10) {
      items.push({ title, description, pubDate, link, source: source.name, sourceWeight: source.weight });
    }
  }
  return items.slice(0, 25);
}

async function fetchRSS(source) {
  const fetch = require('node-fetch');
  try {
    const res = await fetch(source.url, {
      timeout: 7000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Haberimvar/1.0; +https://haberimvar.app)' }
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRSS(xml, source);
  } catch (err) {
    console.warn(`[RSS] ${source.name} hata:`, err.message);
    return [];
  }
}

function isSpam(title) {
  const t = title.toLowerCase();
  if (title.length > 15 && title === title.toUpperCase()) return true;
  if (title.length < 15) return true;
  if (SPAM_KEYWORDS.some(kw => t.includes(kw))) return true;
  if (CLICKBAIT_KEYWORDS.some(kw => t.includes(kw))) return true;
  return false;
}

function getKeywords(title) {
  return title
    .toLowerCase()
    .replace(/[^\wğüşıöçĞÜŞİÖÇ\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

function overlapCount(wordsA, wordsB) {
  const setB = new Set(wordsB);
  return wordsA.filter(w => setB.has(w)).length;
}

function clusterNews(items) {
  const clusters = [];
  for (const item of items) {
    const words = getKeywords(item.title);
    let matched = false;
    for (const cluster of clusters) {
      if (overlapCount(words, cluster.keywords) >= 2) {
        cluster.items.push(item);
        cluster.keywords = [...new Set([...cluster.keywords, ...words])];
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ keywords: words, items: [item] });
    }
  }
  return clusters;
}

function clusterBonus(clusterSize) {
  if (clusterSize >= 5) return 60;
  if (clusterSize == 4) return 50;
  if (clusterSize === 3) return 40;
  if (clusterSize === 2) return 25;
  return 0;
}

function getItemAge(item) {
  if (!item.pubDate) return Infinity;
  return Date.now() - new Date(item.pubDate).getTime();
}

function scoreItem(item, clusterSize, location) {
  const t = (item.title + ' ' + (item.description || '')).toLowerCase();
  let score = 0;
  for (const [kw, pts] of Object.entries(IMPORTANCE_KEYWORDS)) {
    if (t.includes(kw)) score += pts;
  }
  const ageHours = getItemAge(item) / (1000 * 60 * 60);
  if (ageHours < 1)       score += 30;
  else if (ageHours < 3)  score += 20;
  else if (ageHours < 6)  score += 10;
  else if (ageHours < 12) score += 5;
  else if (ageHours < 24) score += 0;
  else if (ageHours < 36) score -= 10;
  score += Math.round((item.sourceWeight || 1.0) * 5);
  score += clusterBonus(clusterSize);
  if (location === 'Gundem') {
    const isSport = SPOR_KEYWORDS.some(kw => t.includes(kw));
    if (isSport) score -= 10;
  }
  return score;
}

function guessCategory(title, desc, loc) {
  const t = (title + ' ' + (desc || '')).toLowerCase();
  if (t.includes('borsa') || t.includes('dolar') || t.includes('faiz') || t.includes('enflasyon') || t.includes('merkez bankası')) return 'Ekonomi';
  if (t.includes('deprem')) return 'Deprem';
  if (t.includes('saldırı') || t.includes('ordu') || t.includes('asker') || t.includes('füze')) return 'Güvenlik';
  if (t.includes('tutuklama') || t.includes('tutuklandı') || t.includes('gözaltı') || t.includes('görevden') || t.includes('istifa')) return 'Siyaset';
  if (t.includes('seçim') || t.includes('meclis') || t.includes('cumhurbaşkan') || t.includes('hükümet')) return 'Siyaset';
  if (t.includes('maç') || t.includes('gol') || t.includes('futbol') || t.includes('şampiyon')) return 'Spor';
  if (t.includes('yapay zeka') || t.includes('teknoloji') || t.includes('iphone') || t.includes('samsung')) return 'Teknoloji';
  if (loc === 'Spor') return 'Spor';
  if (loc === 'Ekonomi') return 'Ekonomi';
  if (loc === 'Teknoloji') return 'Teknoloji';
  if (loc === 'Dunya') return 'Dünya';
  return 'Gündem';
}

async function fetchNews(location) {
  const sources = RSS_SOURCES[location] || RSS_SOURCES['Gundem'];
  const results = await Promise.allSettled(sources.map(fetchRSS));
  const allItems = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  console.log(`[RSS] ${location}: ${allItems.length} ham haber`);

  const clean = allItems.filter(item => !isSpam(item.title));
  const clusters = clusterNews(clean);
  console.log(`[CLUSTER] ${location}: ${clusters.length} cluster oluştu`);

  const scored = clusters.map(cluster => {
    const size = cluster.items.length;
    const uniqueSources = [...new Set(cluster.items.map(i => i.source))];
    const representative = cluster.items.reduce((best, item) =>
      getItemAge(item) < getItemAge(best) ? item : best
    );
    const score = scoreItem(representative, size, location);
    return { ...representative, score, clusterSize: size, sourceCount: uniqueSources.length, allSources: uniqueSources };
  });

  const sorted = location === 'Ekonomi'
    ? scored.sort((a, b) => getItemAge(a) - getItemAge(b))
    : scored.sort((a, b) => b.score - a.score);

  console.log(`[SCORE] ${location} top 3: ${sorted.slice(0,3).map(i => `"${i.title.slice(0,30)}" (${i.score}p, ${i.clusterSize}src)`).join(' | ')}`);

  // Top 10 kullanıcıya gösterilir
  const news = sorted.slice(0, 10).map((item, i) => ({
    rank: i + 1,
    category: guessCategory(item.title, item.description, location),
    headline: item.title,
    summary: item.description?.slice(0, 300) || 'Detaylar için habere tıklayın.',
    isBreaking: item.score > 50,
    sourceCount: item.sourceCount,
    sources: item.allSources,
    link: item.link,
    score: item.score,
    pubDate: item.pubDate,
  }));

  // Tüm haberler search için cache'e kaydedilir (max 100)
  const allNews = sorted.slice(0, 100).map(item => ({
    category: guessCategory(item.title, item.description, location),
    headline: item.title,
    summary: item.description?.slice(0, 300) || '',
    isBreaking: item.score > 50,
    sourceCount: item.sourceCount,
    sources: item.allSources,
    link: item.link,
    score: item.score,
    pubDate: item.pubDate,
    location,
  }));

  return {
    news,
    allNews,
    articleCount: allItems.length,
    clusterCount: clusters.length,
    location,
    updatedAt: Date.now(),
    cacheAge: 0,
    nextUpdateIn: 900,
    source: 'rss',
  };
}

app.get('/api/news', async function(req, res) {
  const loc = req.query.loc || 'Gundem';
  if (!LOCATIONS.includes(loc)) {
    return res.status(400).json({ error: 'Geçersiz lokasyon', received: loc });
  }
  const cached = cache.get(loc);
  if (cached && (Date.now() - cached.updatedAt) < 15 * 60 * 1000) {
    return res.json({
      ...cached,
      cacheAge: Math.round((Date.now() - cached.updatedAt) / 1000),
      nextUpdateIn: Math.max(0, Math.round((cached.updatedAt + 900000 - Date.now()) / 1000)),
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

// SEARCH endpoint — tüm kategorilerdeki cache'li haberler içinde arama
app.get('/api/search', async function(req, res) {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'En az 2 karakter girin', results: [] });
  }

  const results = [];
  const seen = new Set();

  for (const loc of LOCATIONS) {
    const cached = cache.get(loc);
    if (!cached?.allNews) continue;
    for (const item of cached.allNews) {
      const text = (item.headline + ' ' + item.summary).toLowerCase();
      if (text.includes(q) && !seen.has(item.headline)) {
        seen.add(item.headline);
        results.push(item);
      }
    }
  }

  // Skora göre sırala
  results.sort((a, b) => (b.score || 0) - (a.score || 0));

  res.json({
    query: q,
    count: results.length,
    results: results.slice(0, 50),
  });
});

app.get('/api/status', function(req, res) {
  res.json({
    locations: LOCATIONS.map(loc => {
      const c = cache.get(loc);
      return { location: loc, cached: !!c, source: c?.source, clusterCount: c?.clusterCount, updatedAt: c ? new Date(c.updatedAt).toISOString() : null };
    }),
    serverTime: new Date().toISOString(),
  });
});

app.get('/hakkimizda', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'hakkimizda.html'));
});
app.get('/iletisim', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'iletisim.html'));
});
app.get('/gizlilik', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'gizlilik.html'));
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
