const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Claude API client for briefing generation
const anthropic = new Anthropic();
const briefingCache = new Map();

const LOCATIONS = ['Gundem', 'Dunya', 'Ekonomi', 'Spor', 'Teknoloji', 'KulturSanat'];

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
    { name: 'Hürriyet Spor',   url: 'https://www.hurriyet.com.tr/rss/spor',          weight: 1.0 },
    { name: 'Sözcü Spor',      url: 'https://www.sozcu.com.tr/rss/spor.xml',         weight: 1.0 },
    { name: 'A Spor',          url: 'https://www.aspor.com.tr/rss/anasayfa.xml',     weight: 1.0 },
    { name: 'TRT Spor',        url: 'https://www.trthaber.com/spor_articles.rss',    weight: 1.0 },
    { name: 'Sabah Spor',      url: 'https://www.sabah.com.tr/rss/spor.xml',         weight: 1.0 },
    { name: 'Haberturk Spor',  url: 'https://www.haberturk.com/rss/spor.xml',       weight: 1.0 },
    { name: 'Cumhuriyet Spor', url: 'https://www.cumhuriyet.com.tr/rss/spor',        weight: 1.0 },
  ],
'Teknoloji': [
    { name: 'NTV Teknoloji',      url: 'https://www.ntv.com.tr/teknoloji.rss',                    weight: 1.2 },
    { name: 'Webtekno',           url: 'https://www.webtekno.com/rss.xml',                         weight: 1.0 },
    { name: 'ShiftDelete',        url: 'https://shiftdelete.net/feed',                             weight: 1.0 },
    { name: 'Chip TR',            url: 'https://www.chip.com.tr/rss',                              weight: 1.0 },
    { name: 'Milliyet Teknoloji', url: 'https://www.milliyet.com.tr/rss/rssnew/teknolojirss.xml',  weight: 1.0 },
    { name: 'Haberturk Teknoloji',url: 'https://www.haberturk.com/rss/teknoloji.xml',              weight: 1.0 },
    { name: 'Log.com.tr',         url: 'https://www.log.com.tr/feed/',                             weight: 1.0 },
  ],
  'KulturSanat': [
    { name: 'Cumhuriyet K&S',  url: 'https://www.cumhuriyet.com.tr/rss/kultur-sanat',                       weight: 1.0 },
    { name: 'Sözcü K&S',       url: 'https://www.sozcu.com.tr/feeds-rss-category-kultur-sanat',             weight: 1.0 },
    { name: 'TRT K&S',         url: 'https://www.trthaber.com/kultur_sanat_articles.rss',                   weight: 1.0 },
    { name: 'Haberturk K&S',   url: 'https://www.haberturk.com/rss/kategori/kultur-sanat.xml',              weight: 1.0 },
    { name: 'Sabah K&S',       url: 'https://www.sabah.com.tr/rss/kultur-sanat.xml',                        weight: 1.0 },
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
  'deprem': 20, 'yangın': 20, 'patlama': 25,
  'hayatını kaybetti': 20, 'öldü': 15, 'yaralı': 10,
  'hava saldırısı': 35, 'füze saldırısı': 35, 'bombalı saldırı': 35,
  'silahlı saldırı': 30, 'terör saldırısı': 30,
  'saldırı': 10,
  'kriz': 10,
  'tutuklama': 20, 'tutuklandı': 20, 'gözaltı': 15,
  'görevden alma': 20, 'görevden alındı': 20,
  'istifa': 15, 'ihraç': 15,
  'cumhurbaşkan': 20, 'meclis': 12, 'seçim': 15, 'hükümet': 10,
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
  // Mevsimsel / genel kelimeler — cluster yanlış birleştirmesin
  'bayram', 'kutlama', 'kutladı', 'tebrik', 'mesaj', 'nevruz', 'ramazan',
  'kurban', 'yılbaşı', 'töreni', 'toplantı', 'ziyaret', 'açılış',
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
  if (clusterSize >= 6) return 70;
  if (clusterSize == 5) return 60;
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
  else                    score -= 50;
  score += Math.round((item.sourceWeight || 1.0) * 5);
  score += clusterBonus(clusterSize);
  if (location === 'Gundem') {
    const isSport = SPOR_KEYWORDS.some(kw => t.includes(kw));
    if (isSport) score -= 0;
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
  if (loc === 'KulturSanat') return 'Kültür Sanat';
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

  // Gündem → puan sıralaması, diğerleri → kronolojik (en yeni üstte)
  const sorted = location === 'Gundem'
    ? scored.sort((a, b) => b.score - a.score)
    : scored.sort((a, b) => getItemAge(a) - getItemAge(b));

  console.log(`[SCORE] ${location} top 3: ${sorted.slice(0,3).map(i => `"${i.title.slice(0,30)}" (${i.score}p, ${i.clusterSize}src)`).join(' | ')}`);

  // Gündem → 10 haber, diğerleri → 20 haber
  const limit = location === 'Gundem' ? 10 : 20;

  const news = sorted.slice(0, limit).map((item, i) => ({
    rank: i + 1,
    category: guessCategory(item.title, item.description, location),
    headline: item.title,
    summary: item.description?.slice(0, 300) || 'Detaylar için habere tıklayın.',
    isBreaking: getItemAge(item) < 60 * 60 * 1000,
    sourceCount: item.sourceCount,
    sources: item.allSources,
    link: item.link,
    score: item.score,
    pubDate: item.pubDate,
  }));

  const allNews = sorted.slice(0, 100).map(item => ({
    category: guessCategory(item.title, item.description, location),
    headline: item.title,
    summary: item.description?.slice(0, 300) || '',
    isBreaking: getItemAge(item) < 60 * 60 * 1000,
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

// ── Günün Brifingi: AI ile haber özeti üretimi ──────────────────────
async function generateBriefing(newsItems, location) {
  if (!newsItems || newsItems.length === 0) return null;
  
  const cacheKey = `briefing_${location}`;
  const cached = briefingCache.get(cacheKey);
  // Brifing cache'i 15 dakika geçerli (haberlerle senkron)
  if (cached && (Date.now() - cached.generatedAt) < 15 * 60 * 1000) {
    return cached;
  }

  const today = new Date().toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric', weekday: 'long'
  });

  const locationNames = {
    'Gundem': 'Türkiye Gündemi',
    'Dunya': 'Dünya',
    'Ekonomi': 'Ekonomi',
    'Spor': 'Spor',
    'Teknoloji': 'Teknoloji',
    'KulturSanat': 'Kültür Sanat'
  };

  const newsText = newsItems.slice(0, 10).map((item, i) =>
    `${i + 1}. ${item.headline}${item.summary ? ' — ' + item.summary.slice(0, 150) : ''}`
  ).join('\n');

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Bugün ${today}. Aşağıda ${locationNames[location] || 'Gündem'} kategorisindeki en önemli haberler var.

Bu haberlerden yola çıkarak "Gündemin Özeti" yaz. Kurallar:
- TAM OLARAK 2-3 cümle yaz, fazla değil
- Doğal, akıcı Türkçe kullan — haber bülteni gibi değil, zeki bir arkadaşın sabah özetlemesi gibi
- En önemli 2-3 gelişmeyi birbirine bağlayarak anlat
- Başlık veya kaynak adı yazma, sadece özet paragraf
- "Bugün" veya "Gündemde" ile başlama, doğrudan konuya gir

Haberler:
${newsText}`
      }],
    });

    const briefingText = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    const briefing = {
      text: briefingText,
      location,
      generatedAt: Date.now(),
      newsCount: newsItems.length,
    };

    briefingCache.set(cacheKey, briefing);
    console.log(`[BRIEFING] ${location}: "${briefingText.slice(0, 80)}..."`);
    return briefing;
  } catch (err) {
    console.error(`[BRIEFING ERROR] ${location}:`, err.message);
    // Hata durumunda eski cache'i döndür
    if (cached) return cached;
    return null;
  }
}

app.get('/api/news', async function(req, res) {
  const loc = req.query.loc || 'Gundem';
  if (!LOCATIONS.includes(loc)) {
    return res.status(400).json({ error: 'Geçersiz lokasyon', received: loc });
  }
  const cached = cache.get(loc);
  if (cached && (Date.now() - cached.updatedAt) < 15 * 60 * 1000) {
    // Cache geçerli — brifing sadece Gündem için
    const briefing = loc === 'Gundem' ? briefingCache.get(`briefing_${loc}`) : null;
    return res.json({
      ...cached,
      briefing: briefing || null,
      cacheAge: Math.round((Date.now() - cached.updatedAt) / 1000),
      nextUpdateIn: Math.max(0, Math.round((cached.updatedAt + 900000 - Date.now()) / 1000)),
    });
  }
  try {
    const data = await fetchNews(loc);
    cache.set(loc, data);
    
    // Brifing sadece Gündem kategorisinde üretilsin
    if (loc === 'Gundem') {
      generateBriefing(data.news, loc).catch(err => 
        console.error('[BRIEFING BG]', err.message)
      );
    }
    
    const briefing = loc === 'Gundem' ? briefingCache.get(`briefing_${loc}`) : null;
    res.json({ ...data, briefing: briefing || null });
  } catch (err) {
    console.error('[ERROR]', err.message);
    if (cached) return res.json(cached);
    res.status(503).json({ error: err.message });
  }
});

// Brifing endpoint — sadece Gündem için
app.get('/api/briefing', async function(req, res) {
  const loc = req.query.loc || 'Gundem';
  if (loc !== 'Gundem') {
    return res.json({ text: null });
  }
  const briefing = briefingCache.get(`briefing_${loc}`);
  if (briefing) {
    return res.json(briefing);
  }
  const newsCache = cache.get(loc);
  if (newsCache?.news) {
    try {
      const result = await generateBriefing(newsCache.news, loc);
      return res.json(result || { text: null });
    } catch (err) {
      return res.status(503).json({ error: err.message });
    }
  }
  res.json({ text: null });
});

// ── Neden Önemli: Haber analiz endpoint'i ──────────────────────
const explainCache = new Map();

app.post('/api/explain', async function(req, res) {
  const { headline, summary } = req.body;
  if (!headline) {
    return res.status(400).json({ error: 'headline gerekli' });
  }

  // Cache kontrolü — aynı başlık için tekrar API çağrısı yapma
  const cacheKey = headline.slice(0, 80).toLowerCase().trim();
  const cached = explainCache.get(cacheKey);
  if (cached && (Date.now() - cached.generatedAt) < 60 * 60 * 1000) {
    return res.json(cached);
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Aşağıdaki haber başlığını ve özetini oku. Sonra bu haberin neden önemli olduğunu sıradan bir Türk vatandaşına açıkla.

Kurallar:
- TAM OLARAK 2-3 cümle yaz
- İlk cümle: bu haberin arka planı/bağlamı (kısaca)
- İkinci cümle: bunun sıradan bir insanın hayatına etkisi veya neden umursaması gerektiği
- Sade, anlaşılır Türkçe kullan — akademik değil, sohbet gibi
- "Bu haber önemli çünkü" gibi klişelerle başlama, doğrudan konuya gir

Başlık: ${headline}
${summary ? 'Özet: ' + summary.slice(0, 200) : ''}`
      }],
    });

    const explainText = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    const result = {
      text: explainText,
      headline,
      generatedAt: Date.now(),
    };

    explainCache.set(cacheKey, result);

    // Cache'i temiz tut — max 200 giriş
    if (explainCache.size > 200) {
      const oldest = [...explainCache.entries()]
        .sort((a, b) => a[1].generatedAt - b[1].generatedAt)[0];
      if (oldest) explainCache.delete(oldest[0]);
    }

    res.json(result);
  } catch (err) {
    console.error('[EXPLAIN ERROR]', err.message);
    res.status(503).json({ error: 'Analiz üretilemedi: ' + err.message });
  }
});

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
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  res.json({ query: q, count: results.length, results: results.slice(0, 50) });
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

// Supabase config
const SUPABASE_URL = 'https://wrxjeywvpjjbmksrmvzz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bHrUMbP1Bl52bxg4bIyazw_PeTGgYkH';

// Kullanıcı token + keyword kaydet / güncelle
app.post('/api/register', async function(req, res) {
  const { deviceToken, keywords = [], categories = [] } = req.body;
  if (!deviceToken) return res.status(400).json({ error: 'deviceToken gerekli' });

  try {
    const fetch = require('node-fetch');
    const response = await fetch(`${SUPABASE_URL}/rest/v1/user_preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        device_token: deviceToken,
        keywords,
        categories,
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) throw new Error(await response.text());
    res.json({ success: true });
  } catch (err) {
    console.error('[REGISTER]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Kullanıcı tercihlerini getir
app.get('/api/preferences/:token', async function(req, res) {
  const token = req.params.token;
  try {
    const fetch = require('node-fetch');
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/user_preferences?device_token=eq.${encodeURIComponent(token)}&select=keywords,categories`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const data = await response.json();
    res.json(data[0] || { keywords: [], categories: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ── Otomatik Tweet: Günlük sabah brifingi ──────────────────────
app.get('/api/cron/tweet', async function(req, res) {
  // Vercel cron veya manuel tetikleme
  try {
    const { TwitterApi } = require('twitter-api-v2');
    
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    // Gündem haberlerini çek
    const data = await fetchNews('Gundem');
    if (!data.news || data.news.length === 0) {
      return res.json({ success: false, error: 'Haber bulunamadı' });
    }

    // AI brifing üret
    const briefing = await generateBriefing(data.news, 'Gundem');

    if (!briefing?.text) {
      return res.json({ success: false, error: 'Brifing üretilemedi' });
    }

    // Tarih formatı
    const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

    // Tek tweet: Gündem özeti + hashtag
    const tweetText = `📰 Gündemin Özeti | ${today}\n\n${briefing.text.slice(0, 200)}\n\n15+ kaynaktan, yapay zeka ile derlendi\n🔗 haberimvar.app\n\n#gündem #haberler`;

    const result = await twitterClient.v2.tweet(tweetText);
    console.log('[TWEET] Gündem özeti paylaşıldı:', result.data.id);

    res.json({ success: true, tweeted: 1, tweetId: result.data.id });
  } catch (err) {
    console.error('[TWEET CRON ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
