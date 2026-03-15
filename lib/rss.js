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
      { name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkish/rss.xml', weight: 1.0 },
      { name: 'NTV', url: 'https://www.ntv.com.tr/son-dakika.rss', weight: 1.0 },
      { name: 'Hürriyet', url: 'https://www.hurriyet.com.tr/rss/anasayfa', weight: 0.9 },
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
          if (!article.title) continue;
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
    return clusters.filter(c => c.articles.length > 0);
}

function scoreCluster(cluster) {
    if (!cluster.articles || cluster.articles.length === 0) return null;
    const rep = cluster.articles[0];
    if (!rep) return null;

  const now = Date.now();
    const uniqueSources = [...new Set(cluster.articles.map(a => a.source))];
    let score = uniqueSources.length * 25 * 0.5;
    score += cluster.articles.reduce((s, a) => s + (a.sourceWeight || 1), 0) * 5 * 0.15;
    const newest = Math.max(...cluster.articles.map(a => a.pubDate || Date.now()));
    const recencyMsc o=n snto wf e-t cnhe w=e srte;q
  u i rceo(n'snto dree-cfeentccyhS'c)o;r
  e
   f=u nrcetcieonnc ypMasr s<e D1a5t*e6(0s*t1r0)0 0{  ?
    4 0t r:y  r{e creentcuyrMns  n<e w6 0D*a6t0e*(1s0t0r0) .?g e2t0T i:m er(e)c e|n|c yDMast e<. n4o*w6(0)*;6 0}* 1
     0 0 0c a?t c1h0  {:  r0e;t
     u r ns cDoartee .+n=o wr(e)c;e n}c y
  S}c
o
rfeu n*c t0i.o3n; 
e x tcroancsttT atgi(txlmelT,e xtta g=)  ({r
                                           e p .ctointslte  m|a|t c'h' )=. txomLlo.wmeartCcahs(en(e)w; 
R e glEextp (k`w<B$o{otsatg }=[ ^0>;]
* > (f?o:r< !(\c\o[nCsDtA TkAw\ \o[f) ?B(R[E\A\KsI\N\GS_]K*E?Y)W(O?R:D\S\)] \i\f] >()t?i<t\l\e/T$e{xtta.gi}n>c`l,u d'eis'()k)w;)
)   {i fk w(B!omoasttc h+)=  r1e5t;u rbnr e'a'k;;
    } 
r e tfuorrn  (mcaotncsht[ 1[]k.wr,e pmlualcte]( /o<f[ ^O>b]j+e>c/tg.,e n't'r)i.erse(pIlMaPcOeR(T/A&NaCmEp_;B/OgO,S'T&)')) .irfe p(ltaictel(e/T&elxtt;./ign,c'l<u'd)e.sr(ekpwl)a)c e{( /k&wgBto;o/sgt, '+>=' )(.mruelptl-a1c)e*(2/0&;q uborte;a/kg;, '}"
  ' ) .srceoprlea c+e=( /k&w#B3o9o;s/tg ,*" '0".)2.;t
  r i mr(e)t;u
r}n

{f
 u n c t isocno rpea:r sMeaRtShS.(rxomuln)d ({s
                                              c o rceo)n,s
 t   i t eumnsi q=u e[S]o;u
 r c ecso,n
 s t   i tseomuMractecChoeusn t=:  xumnli.qmuaetScohuArlcle(s/.<lietnegmt[h^,>
                                                            ] * > ( [i\ssB\rSe]a*k?i)n<g\:/ irteecme>n/cgyiM)s; 
<   1f5o*r6 0(*c1o0n0s0t  &m&a tucnhi qoufe SiotuermcMeast.clheensg)t h{ 
 > =   2 ,c
  o n s t  rceopnrteesnetn t=a tmiavtec:h [r1e]p;,

} ;i
 t}e
m
sa.spyunsch (f{u
n c t i o n  tgiettlTeo:p Neexwtsr(alcotcTaatgi(ocno)n t{e
                                                         n t ,c o'ntsitt laer't)i,c
                                                         l e s   =   adweasictr ifpetticohnA:l leSxoturraccetsT(algo(ccaotnitoenn)t;,
                                                                                                                  ' dceosncsroilpet.iloong'()`,[
                                                                                                                  R S S ]   $ {pluobcDaattieo:n }e:x t$r{aacrttTiacgl(ecso.nlteenngtt,h }' phuabbDeart`e)';)
                                                           , 
                                                             i f   ( a rltiinckl:e se.xlternagctthT a=g=(=c o0n)t ernett,u r'nl i{n kc'a)n,d
                                                         i d a t e}s):; 
[ ] ,} 
a r tiifc l(eiCtoeumnst.:l e0n,g tchl u=s=t=e r0C)o u{n
                                                      t :   0  c}o;n
s
t   ecnotnrsytM actlcuhsetse r=s  x=m lc.lmuasttcehrANlelw(s/(<aernttircyl[e^s>)];*
> ( [c\osn\sSt] *s?c)o<r\e/de n=t rcyl>u/sgtie)r;s

        f.omra p((ccolnusstt emra t=c>h  {o fc oennsttr ysM a=t cshceosr)e C{l
                                          u s t e r ( cclounsstte rc)o;n treenttu r=n  msa t?c h{[ 1.].;.
                                          s   }   :   ncuolnls;t  }l)i
n k M a t.cfhi l=t ecro(nBtoeonlte.amna)t
c h ( / <.lsionrkt[(^(>a],* hbr)e f==>[ "b'.]s(c[o^r"e' ]-+ )a[."s'c]o/rie));;


     / /  iKtaeymnsa.kp uçsehşi(t{l
i l i ğ i   k u rtailtıl:e
                                  :   e/x/t rİlakc t3T asgı(rcaoynat eynatl,n ı'ztciat l2e+' )k,a
                                  y n a k t a n   gdeelsecnr ihpatbieornl:e re xgtirraecbtiTlaigr(.c
                                  o n tceonnts,t  'tsoupm3m a=r y[']); 
| |  ceoxntsrta crteTsatg (=c o[n]t;e
                                  n
                                  t ,  f'ocro n(tceonnts't) ,i
                                  t e m   o f   s cpourbeDda)t e{:
                                    e x t riafc t(Tiatge(mc.osnotuerncte,C o'uunptd a>t=e d2' )& &| |t oepx3t.rlaecntgTtahg (<c o3n)t e{n
                                                                                                                                        t ,   ' p u btloips3h.epdu's)h,(
                                                                                                                                          i t e m ) ; 
                                        l i n}k :e llsien k{M
                                                            a t c h   ?  rleisntk.Mpautschh([i1t]e m:) ;'
                                                              ' , 
                                                           } 
                                  }}
)
; 
  / /   t}o
p 3  }d
o l mraedtıuyrsna  irteesmts';t
e}n

tfaumnacmtliao
n   gwehtiKleey w(otrodps3(.tlietnlget)h  {<
  3  c&o&n srte sstt.olpe n=g tnhe w>  S0e)t ({[
    ' v e ' ,t'oipl3e.'p,u'sbhi(rr'e,s'tb.us'h,i'fdta('),)';d
                                e ' ,}'
                                                      d
                                e n 'c,o'nisçitn 'f,i'noalla n=' ,['.v.e.ytao'p,3',a m.a.'.,r'eçsotk]'.,s'leinc'e,('0m,i '1,0')n;e
                                                                   '
                                                                   , ' krie't]u)r;n
  { 
  r e t u rlno c(attiitolne,|
    | ' ' ) .fteotLcohweedrACta:s eD(a)t.er.enpolwa(c)e,(
    / [ ^ \ wağürşıtöiçĞcÜŞlİÖeÇ\Cso]u/ngt,:' 'a)r.tsipclliets(./l\esn+g/t)h.,f
    i l t e rc(lwu s=t>e rwC.oluenntg:t hc l>u s3t e&r&s .!lsetnogpt.hh,a
    s ( w ) )c;a
    n}d
  i
  dfautnecst:i ofni ncaolu.nmtaOpv(esr l=a>p ((a{,
                                                 b )   {   
                                              s c ocroen:s ts .ss c=o rnee,w
  S e t ( b )s;o u
  r c erCeotuunrtn:  as..fsiolutrecre(Cwo u=n>t ,s
                                      . h a s ( w )s)o.ulrecnegst:h ;s .
    u}n
i
qcuoenSsotu rScOeUsR,C
E S   =   { 
  i s B'rTeüarkkiinyge:' :s .[i
  s B r e a{k innagm,e
            :   ' N T V 't,i t l e :   s .urrelp:r e'shetnttpast:i/v/ew.wtwi.tnltev,.
              c o m . t r /dseosnc-rdiapktiikoan.:r s(ss'.,r ewperiegshetn:t a1t.i0v e}.,d
              e s c r i{p tniaomne :| |' H'ür'r)i.yselti'c,e ( 0u,r l4:0 0')h,t
              t p s : / / wlwiwn.kh:u rsr.iryeeptr.ecsoemn.ttart/irvses./lainnaks,a
                        y f a ' ,   wpeuibgDhatt:e :1 .n0e w} ,D
                          a t e ( s{. rneapmree:s e'nStaabtaihv'e,. p u b D autrel):. t'ohItStOpSst:r/i/nwgw(w).,s
                          a b a h .}c)o)m,.
                          t r /}r;s
            s}/
a
nmaosdauylfea..exxmplo'r,t sw e=i g{h tg:e t0T.o9p N}e,w
  s   } ; { name: 'BBC Türkçe',url: 'https://feeds.bbci.co.uk/turkish/rss.xml', weight: 1.1 },
  ],
  'Ekonomi': [
    { name: 'Hürriyet Eko', url: 'https://www.hurriyet.com.tr/rss/ekonomi', weight: 1.0 },
    { name: 'Sabah Eko',    url: 'https://www.sabah.com.tr/rss/ekonomi.xml', weight: 0.9 },
      ],
      'Spor': [
    { name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkish/rss.xml', weight: 1.0 },
    { name: 'NTV', url: 'https://www.ntv.com.tr/son-dakika.rss', weight: 1.0 },
    { name: 'Hürriyet', url: 'https://www.hurriyet.com.tr/rss/anasayfa', weight: 0.9 },
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
          if (!article.title) continue;
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
    return clusters.filter(c => c.articles.length > 0);
}

function scoreCluster(cluster) {
    if (!cluster.articles || cluster.articles.length === 0) return null;
    const rep = cluster.articles[0];
    if (!rep) return null;

  const now = Date.now();
    const uniqueSources = [...new Set(cluster.articles.map(a => a.source))];
    let score = uniqueSources.length * 25 * 0.5;
    score += cluster.articles.reduce((s, a) => s + (a.sourceWeight || 1), 0) * 5 * 0.15;
    const newest = Math.max(...cluster.articles.map(a => a.pubDate || Date.now()));
    const recencyMs = now - newest;
    const recencyScore = recencyMs < 15*60*1000 ? 40 : recencyMs < 60*60*1000 ? 20 : recencyMs < 4*60*60*1000 ? 10 : 0;
    score += recencyScore * 0.3;
    const titleText = (rep.title || '').toLowerCase();
    let kwBoost = 0;
    for (const kw of BREAKING_KEYWORDS) if (titleText.includes(kw)) { kwBoost += 15; break; }
    for (const [kw, mult] of Object.entries(IMPORTANCE_BOOST)) if (titleText.includes(kw)) { kwBoost += (mult-1)*20; break; }
    score += kwBoost * 0.2;
    return {
          score: Math.round(score),
          uniqueSources,
          sourceCount: uniqueSources.length,
          isBreaking: recencyMs < 15*60*1000 && uniqueSources.length >= 2,
          representative: rep,
    };
}

async function getTopNews(location) {
    const articles = await fetchAllSources(location);
    console.log(`[RSS] ${location}: ${articles.length} haber`);
    if (articles.length === 0) return { candidates: [], articleCount: 0, clusterCount: 0 };

  const clusters = clusterNews(articles);
    const scored = clusters
      .map(cluster => { const s = scoreCluster(cluster); return s ? { ...s } : null; })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

  // Kaynak çeşitliliği kuralı:
  // İlk 3 sıraya yalnızca 2+ kaynaktan gelen haberler girebilir.
  const top3 = [];
    const rest = [];

  for (const item of scored) {
        if (item.sourceCount >= 2 && top3.length < 3) {
                top3.push(item);
        } else {
                rest.push(item);
        }
  }

  // top3 dolmadıysa rest'ten tamamla
  while (top3.length < 3 && rest.length > 0) {
        top3.push(rest.shift());
  }

  const final = [...top3, ...rest].slice(0, 10);

  return {
        location,
        fetchedAt: Date.now(),
        articleCount: articles.length,
        clusterCount: clusters.length,
        candidates: final.map(s => ({
                score: s.score,
                sourceCount: s.sourceCount,
                sources: s.uniqueSources,
                isBreaking: s.isBreaking,
                title: s.representative.title,
                description: (s.representative.description || '').slice(0, 400),
                link: s.representative.link,
                pubDate: new Date(s.representative.pubDate).toISOString(),
        })),
  };
}

module.exports = { getTopNews };
