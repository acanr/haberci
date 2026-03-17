const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LOCATIONS = ['Turkiye', 'Dunya', 'Ekonomi', 'Spor', 'Teknoloji'];

const RSS_SOURCES = {
  'Turkiye': [
    { name: 'NTV',       url: 'https://www.ntv.com.tr/gundem.rss',          weight: 1.2 },
    { name: 'Hürriyet',  url: 'https://www.hurriyet.com.tr/rss/anasayfa',   weight: 1.0 },
    { name: 'Sözcü',     url: 'https://www.sozcu.com.tr/rss/anasayfa.xml',  weight: 1.0 },
    { name: 'DW Türkçe', url: 'https://rss.dw.com/rdf/rss-tur-all',         weight: 1.2 },
  ],
  'Dunya': [
    { name: 'NTV Dünya',      url: 'https://www.ntv.com.tr/dunya.rss',            weight: 1.2 },
    { name: 'Hürriyet Dünya', url: 'https://www.hurriyet.com.tr/rss/dunya',       weight: 1.0 },
    { name: 'DW Türkçe',      url: 'https://rss.dw.com/rdf/rss-tur-all',          weight: 1.2 },
  ],
  'Ekonomi': [
    { name: 'NTV Ekonomi',      url: 'https://www.ntv.com.tr/ekonomi.rss',              weight: 1.2 },
    { name: 'Hürriyet Ekonomi', url: 'https://www.hurriyet.com.tr/rss/ekonomi',         weight: 1.0 },
    { name: 'Sözcü Ekonomi',    url: 'https://www.sozcu.com.tr/rss/ekonomi.xml',        weight: 1.0 },
  ],
  'Spor': [
    { name: 'NTV Gündem',    url: 'https://www.ntv.com.tr/gundem.rss',         weight: 1.0 },
    { name: 'Hürriyet Spor', url: 'https://www.hurriyet.com.tr/rss/spor',     weight: 1.0 },
    { name: 'Sözcü Spor',    url: 'https://www.sozcu.com.tr/rss/spor.xml',    weight: 1.0 },
  ],
  'Teknoloji': [
    { name: 'NTV Teknoloji', url: 'https://www.ntv.com.tr/teknoloji.rss',  weight: 1.2 },
    { name: 'Webtekno',      url: 'https://www.webtekno.com/rss.xml',       weight: 1.0 },
    { name: 'ShiftDelete',   url: 'https://shiftdelete.net/feed',           weight: 1.0 },
  ],
};

const SPAM_KEYWORDS = [
  'ihale', 'satın alma daire', 'müdürlüğü ilanı', 'ihalesi',
  'şartname', 'teklif zarfı', 'resmi ilan', 'ilan no',
];

const CLICKBAIT_KEYWORDS = [
  'burç', 'astroloji', 'diyet', 'zayıflama', 'kilo ver',
  'tatil pozu', 'bikinili', 'sevgilisiyle', 'çekiliş', 'yarışma',
  'işte o an', 'bakın ne oldu', 'şaşırtan', 'inanamayacaksınız',
];

const IMPORTANCE_KEYWORDS = {
  'deprem': 30, 'sel': 20, 'yangın': 20, 'patlama': 25,
  'hayatını kaybetti': 20, 'öldü': 15, 'yaralı': 10,
  'savaş': 25, 'saldırı': 20, 'kriz': 15,
  'cumhurbaşkan': 15, 'meclis': 12, 'seçim': 15, 'hükümet': 10,
  'merkez bankası': 15, 'faiz': 12, 'dolar': 10, 'borsa': 10, 'enflasyon': 12,
  'şampiyon': 10, 'gol': 8, 'maç': 8,
  'yapay zeka': 12, 'iphone': 10, 'tesla': 8,
};

// Cluster için stop words — bunlar ortak kelime sayılmaz
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
    const description = extractTag(content, 'description');
    const pubDate = extractTag(content, 'pubDate');
    const link = extractTag(content, 'link') ||
      content.match(/<link>([^<]+)<\/link>/i)?.[1] || '';
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

// Başlıktan anlamlı kelimeleri çıkar (cluster için)
function getKeywords(title) {
  return title
    .toLowerCase()
    .replace(/[^\wğüşıöçĞÜŞİÖÇ\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

// İki başlık arasındaki ortak kelime sayısı
function overlapCount(wordsA, wordsB) {
  const setB = new Set(wordsB);
  return wordsA.filter(w => setB.has(w)).length;
}

// Haberleri cluster'la — benzer başlıkları grupla
function clusterNews(items) {
  const clusters = [];

  for (const item of items) {
    const words = getKeywords(item.title);
    let matched = false;

    for (const cluster of clusters) {
      if (overlapCount(words, cluster.keywords) >= 2) {
        cluster.items.push(item);
        // Cluster keyword setini genişlet
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

// Cluster bazlı çakışma bonusu
function clusterBonus(clusterSize) {
  if (clusterSize >= 4) return 75;
  if (clusterSize === 3) return 50;
  if (clusterSize === 2) return 25;
  return 0;
}

function scoreItem(item, clusterSize) {
  const t = (item.title + ' ' + (item.description || '')).toLowerCase();
  let score = 0;

  // 1. İçerik / önem kelimesi puanı
  for (const [kw, pts] of Object.entries(IMPORTANCE_KEYWORDS)) {
    if (t.includes(kw)) score += pts;
  }

  // 2. Tazelik puanı
  if (item.pubDate) {
    const ageHours = (Date.now() - new Date(item.pubDate).getTime()) / (1000 * 60 * 60);
    if (ageHours < 1)       score += 30;
    else if (ageHours < 3)  score += 20;
    else if (ageHours < 6)  score += 10;
    else if (ageHours < 12) score += 5;
  }

  // 3. Kaynak ağırlığı
  score += Math.round((item.sourceWeight || 1.0) * 5);

  // 4. Çoklu kaynak / cluster bonusu (A+C karışımı)
  score += clusterBonus(clusterSize);

  return score;
}

function guessCategory(title, desc, loc) {
  const t = (title + ' ' + (desc || '')).toLowerCase();
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

async function fetchNews(location) {
  const sources = RSS_SOURCES[location] || RSS_SOURCES['Turkiye'];
  const results = await Promise.allSettled(sources.map(fetchRSS));
  const allItems = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  console.log(`[RSS] ${location}: ${allItems.length} ham haber`);

  // Spam filtrele
  const clean = allItems.filter(item => !isSpam(item.title));

  // Cluster'la — benzer haberleri grupla
  const clusters = clusterNews(clean);
  console.log(`[CLUSTER] ${location}: ${clusters.length} cluster oluştu`);

  // Her cluster'dan en iyi temsilciyi seç, puana cluster bonusunu ekle
  const scored = clusters.map(cluster => {
    const size = cluster.items.length;
    const uniqueSources = [...new Set(cluster.items.map(i => i.source))];

    // Cluster içinden en yüksek kaynak ağırlıklı temsilciyi seç
    const representative = cluster.items.reduce((best, item) =>
      (item.sourceWeight || 1) >= (best.sourceWeight || 1) ? item : best
    );

    const score = scoreItem(representative, size);

    return {
      ...representative,
      score,
      clusterSize: size,
      sourceCount: uniqueSources.length,
      allSources: uniqueSources,
    };
  });

  // Puana göre sırala
  const sorted = scored.sort((a, b) => b.score - a.score);

  console.log(`[SCORE] ${location} top 3: ${sorted.slice(0,3).map(i => `"${i.title.slice(0,30)}" (${i.score}puan, ${i.clusterSize} kaynak)`).join(' | ')}`);

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
  }));

  return {
    news,
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
  const loc = req.query.loc || 'Turkiye';
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

app.get('/api/status', function(req, res) {
  res.json({
    locations: LOCATIONS.map(loc => {
      const c = cache.get(loc);
      return { location: loc, cached: !!c, source: c?.source, clusterCount: c?.clusterCount, updatedAt: c ? new Date(c.updatedAt).toISOString() : null };
    }),
    serverTime: new Date().toISOString(),
  });
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
