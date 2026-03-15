const fetch = require('node-fetch');

function parseDate(str) { 
  try { return new Date(str).getTime() || Date.now(); } 
  catch { return Date.now(); } 
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  if (!match) return '';
  return match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}

function parseRSS(xml) {
  const items = [];
  const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    const content = match[1];
    items.push({
      title: extractTag(content, 'title'),
      description: extractTag(content, 'description'),
      pubDate: extractTag(content, 'pubDate'),
      link: extractTag(content, 'link'),
    });
  }
  if (items.length === 0) {
    const entryMatches = xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi);
    for (const match of entryMatches) {
      const content = match[1];
      const linkMatch = content.match(/<link[^>]*href=["']([^"']+)["']/i);
      items.push({
        title: extractTag(content, 'title'),
        description: extractTag(content, 'summary') || extractTag(content, 'content'),
        pubDate: extractTag(content, 'updated') || extractTag(content, 'published'),
        link: linkMatch ? linkMatch[1] : '',
      });
    }
  }
  return items;
}

function getKeywords(title) {
  const stop = new Set(['ve','ile','bir','bu','da','de','den','için','olan','veya','ama','çok','en','mi','ne','ki']);
  return (title||'').toLowerCase().replace(/[^\wğüşıöçĞÜŞİÖÇ\s]/g,'').split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
}

function countOverlap(a, b) { 
  const s = new Set(b); 
  return a.filter(w => s.has(w)).length; 
}

const SOURCES = {
  'Türkiye': [
    { name: 'NTV',       url: 'https://www.ntv.com.tr/son-dakika.rss', weight: 1.0 },
    { name: 'Hürriyet',  url: 'https://www.hurriyet.com.tr/rss/anasayfa', weight: 1.0 },
    { name: 'Sabah',     url: 'https://www.sabah.com.tr/rss/anasayfa.xml', weight: 0.9 },
    { name: 'BBC Türkçe',url: 'https://feeds.bbci.co.uk/turkish/rss.xml', weight: 1.1 },
  ],
  'Ekonomi': [
    { name: 'Hürriyet Eko', url: 'https://www.hurriyet.com.tr/rss/ekonomi', weight: 1.0 },
    { name: 'Sabah Eko',    url: 'https://www.sabah.com.tr/rss/ekonomi.xml', weight: 0.9 },
  ],
  'Spor': [
    { name: 'NTV Spor', url: 'https://www.ntvspor.net/rss', weight: 1.1 },
    { name: 'Fanatik',  url: 'https://www.fanatik.com.tr/rss/anasayfa', weight: 0.9 },
  ],
  'Teknoloji': [
    { name: 'Webtekno',    url: 'https://www.webtekno.com/rss.xml', weight: 1.0 },
    { name: 'Shiftdelete', url: 'https://shiftdelete.net/feed', weight: 0.9 },
  ],
  'Dünya': [
    { name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkish/rss.xml', weight: 1.2 },
    { name: 'DW Türkçe',  url: 'https://rss.dw.com/rdf/rss-tur-all', weight: 1.1 },
  ],
  'İstanbul': [
    { name: 'Hürriyet', url: 'https://www.hurriyet.com.tr/rss/anasayfa', weight: 1.0 },
    { name: 'NTV',      url: 'https://www.ntv.com.tr/son-dakika.rss', weight: 1.0 },
  ],
};

const BREAKING_KEYWORDS = ['son dakika','acil','flaş','hayatını kaybetti','patlama','deprem','saldırı'];
const IMPORTANCE_BOOST = { 'savaş':1.5,'deprem':1.5,'seçim':1.4,'faiz':1.3,'cumhurbaşkan':1.3,'ölü':1.4 };

async function fetchRSS(source) {
  try {
    const res = await fetch(source.url, {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Haberci/1.0)' }
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRSS(xml);
    return items.slice(0, 25).map(item => ({
      title: item.title || '',
      description: item.description || '',
      pubDate: parseDate(item.pubDate || item.updated),
      link: item.link || '',
      source: source.name,
      sourceWeight: source.weight,
    })).filter(i => i.title.length > 10);
  } catch (err) {
    console.warn(`[RSS] ${source.name}:`, err.message);
    return [];
  }
}

async function fetchAllSources(location) {
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
    if (!matched) clusters.push({ keywords: words, articles: [article] });
  }
  return clusters;
}

function scoreCluster(cluster) {
  const now = Date.now();
  const uniqueSources = [...new Set(cluster.articles.map(a => a.source))];
  let score = uniqueSources.length * 25 * 0.5;
  score += cluster.articles.reduce((s, a) => s + a.sourceWeight, 0) * 5 * 0.15;
  const newest = Math.max(...cluster.articles.map(a => a.pubDate));
  const recencyMs = now - newest;
  const recencyScore = recencyMs < 15*60*1000 ? 40 : recencyMs < 60*60*1000 ? 20 : recencyMs < 4*60*60*1000 ? 10 : 0;
  score += recencyScore * 0.3;
  const titleText = (cluster.articles[0].title || '').toLowerCase();
  let kwBoost = 0;
  for (const kw of BREAKING_KEYWORDS) if (titleText.includes(kw)) { kwBoost += 15; break; }
  for (const [kw, mult] of Object.entries(IMPORTANCE_BOOST)) if (titleText.includes(kw)) { kwBoost += (mult-1)*20; break; }
  score += kwBoost * 0.2;
  return {
    score: Math.round(score),
    uniqueSources,
    sourceCount: uniqueSources.length,
    isBreaking: recencyMs < 15*60*1000 && uniqueSources.length >= 2,
    representative: cluster.articles[0],
  };
}

async function getTopNews(location) {
  const articles = await fetchAllSources(location);
  console.log(`[RSS] ${location}: ${articles.length} haber`);
  if (articles.length === 0) return { candidates: [], articleCount: 0, clusterCount: 0 };
  const clusters = clusterNews(articles);
  const scored = clusters
    .map(cluster => ({ cluster, ...scoreCluster(cluster) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  return {
    location,
    fetchedAt: Date.now(),
    articleCount: articles.length,
    clusterCount: clusters.length,
    candidates: scored.map(s => ({
      score: s.score,
      sourceCount: s.sourceCount,
      sources: s.uniqueSources,
      isBreaking: s.isBreaking,
      title: s.representative.title,
      description: s.representative.description?.slice(0, 400),
      link: s.representative.link,
      pubDate: new Date(s.representative.pubDate).toISOString(),
    })),
  };
}

module.exports = { getTopNews };
