const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const SOURCES = {
  'Türkiye': [
    { name: 'NTV',        url: 'https://www.ntv.com.tr/son-dakika.rss',                weight: 1.0 },
    { name: 'Hürriyet',   url: 'https://www.hurriyet.com.tr/rss/anasayfa',              weight: 1.0 },
    { name: 'Sabah',      url: 'https://www.sabah.com.tr/rss/anasayfa.xml',             weight: 0.9 },
    { name: 'Milliyet',   url: 'https://www.milliyet.com.tr/rss/rssNew/gundemRss.xml',  weight: 0.9 },
    { name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkish/rss.xml',              weight: 1.1 },
  ],
  'Ekonomi': [
    { name: 'Bloomberg HT', url: 'https://www.bloomberght.com/rss',                     weight: 1.2 },
    { name: 'Hürriyet Eko', url: 'https://www.hurriyet.com.tr/rss/ekonomi',             weight: 1.0 },
    { name: 'Sabah Eko',    url: 'https://www.sabah.com.tr/rss/ekonomi.xml',            weight: 0.9 },
  ],
  'Spor': [
    { name: 'NTV Spor', url: 'https://www.ntvspor.net/rss',         weight: 1.1 },
    { name: 'Fanatik',  url: 'https://www.fanatik.com.tr/rss/anasayfa', weight: 0.9 },
  ],
  'Teknoloji': [
    { name: 'Webtekno',    url: 'https://www.webtekno.com/rss.xml',  weight: 1.0 },
    { name: 'Shiftdelete', url: 'https://shiftdelete.net/feed',      weight: 0.9 },
  ],
  'Dünya': [
    { name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkish/rss.xml', weight: 1.2 },
    { name: 'DW Türkçe',  url: 'https://rss.dw.com/rdf/rss-tur-all',       weight: 1.1 },
    { name: 'NTV Dünya',  url: 'https://www.ntv.com.tr/dunya.rss',         weight: 1.0 },
  ],
  'İstanbul': [
    { name: 'Hürriyet', url: 'https://www.hurriyet.com.tr/rss/anasayfa',            weight: 1.0 },
    { name: 'NTV',      url: 'https://www.ntv.com.tr/son-dakika.rss',               weight: 1.0 },
    { name: 'Milliyet', url: 'https://www.milliyet.com.tr/rss/rssNew/gundemRss.xml',weight: 0.9 },
  ],
};

const BREAKING_KEYWORDS = ['son dakika','acil','flaş','breaking','gelişme','hayatını kaybetti','patlama','deprem','saldırı'];
const IMPORTANCE_BOOST = { 'savaş':1.5,'deprem':1.5,'seçim':1.4,'faiz':1.3,'borsa':1.2,'cumhurbaşkanı':1.3,'ölü':1.4,'yaralı':1.3,'tutuklama':1.2 };

async function fetchRSS(source) {
  try {
    const res = await fetch(source.url, { timeout: 8000, headers: { 'User-Agent': 'Haberci/1.0' } });
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const channel = parsed?.rss?.channel || parsed?.feed;
    const items = channel?.item || channel?.entry || [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.slice(0, 30).map(item => ({
      title: cleanText(item.title || item['title']?.['#text'] || ''),
      description: cleanText(item.description || item.summary || ''),
      pubDate: parseDate(item.pubDate || item.updated || item.published),
      link: item.link?.['@_href'] || item.link || '',
      source: source.name,
      sourceWeight: source.weight,
    })).filter(i => i.title.length > 10);
  } catch (err) {
    console.warn(`[RSS] ${source.name} hatası:`, err.message);
    return [];
  }
}

async function fetchAllSources(location = 'Türkiye') {
  const sources = SOURCES[location] || SOURCES['Türkiye'];
  const results = await Promise.allSettled(sources.map(fetchRSS));
  return results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
}

function clusterNews(articles) {
  const clusters = [];
  for (const article of articles) {
    const words = getKeywords(article.title);
    let matched = false;
    for (const cluster of clusters) {
      if (countOverlap(words, cluster.keywords) >= 2) {
        cluster.articles.push(article);
        cluster.keywords = [...new Set([...cluster.keywords, ...words])];
        matched = true; break;
      }
    }
    if (!matched) clusters.push({ keywords: words, articles: [article], firstSeen: article.pubDate });
  }
  return clusters;
}

function scoreCluster(cluster) {
  const now = Date.now();
  let score = 0;
  const uniqueSources = [...new Set(cluster.articles.map(a => a.source))];
  score += uniqueSources.length * 25 * 0.5;
  score += cluster.articles.reduce((s, a) => s + a.sourceWeight, 0) * 5 * 0.15;
  const newest = Math.max(...cluster.articles.map(a => a.pubDate));
  const recencyMs = now - newest;
  const recencyScore = recencyMs < 15*60*1000 ? 40 : recencyMs < 60*60*1000 ? 20 : recencyMs < 4*60*60*1000 ? 10 : 0;
  score += recencyScore * 0.3;
  const oldest = Math.min(...cluster.articles.map(a => a.pubDate));
  if ((newest - oldest) < 15*60*1000 && uniqueSources.length >= 3) score += 30;
  const titleText = cluster.articles[0].title.toLowerCase();
  let kwBoost = 0;
  for (const kw of BREAKING_KEYWORDS) if (titleText.includes(kw)) { kwBoost += 15; break; }
  for (const [kw, mult] of Object.entries(IMPORTANCE_BOOST)) if (titleText.includes(kw)) { kwBoost += (mult-1)*20; break; }
  score += kwBoost * 0.2;
  return { score: Math.round(score), uniqueSources, sourceCount: uniqueSources.length, isBreaking: recencyMs < 15*60*1000 && uniqueSources.length >= 2, representative: cluster.articles[0] };
}

async function getTopNews(location = 'Türkiye') {
  const articles = await fetchAllSources(location);
  if (articles.length === 0) return null;
  const clusters = clusterNews(articles);
  const scored = clusters.map(cluster => ({ cluster, ...scoreCluster(cluster) })).sort((a, b) => b.score - a.score).slice(0, 15);
  return {
    location, fetchedAt: Date.now(), articleCount: articles.length, clusterCount: clusters.length,
    candidates: scored.map(s => ({
      score: s.score, sourceCount: s.sourceCount, sources: s.uniqueSources, isBreaking: s.isBreaking,
      title: s.representative.title, description: s.representative.description?.slice(0, 300),
      link: s.representative.link, pubDate: new Date(s.representative.pubDate).toISOString(),
    })),
  };
}

function cleanText(str) {
  if (typeof str === 'object' && str !== null) {
    str = str['#text'] || str['_'] || Object.values(str)[0] || '';
  }
  return String(str || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function countOverlap(a, b) { const s = new Set(b); return a.filter(w => s.has(w)).length; }

module.exports = { getTopNews };
