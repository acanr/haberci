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
    const titleText = (cluster.articcloenss[t0 ]f.etticthl e=  |r|e q'u'i)r.et(o'Lnoowdeer-Cfaestec(h)';)
; 

lfeutn cktwiBoono spta r=s e0D;a
  t e (fsotrr )( c{o n
                   s t  tkrwy  o{f  rBeRtEuArKnI NnGe_wK EDYaWtOeR(DsSt)r )i.fg e(ttTiitmlee(T)e x|t|. iDnactleu.dneosw((k)w;) )}  {
                       k wcBaotocsht  {+ =r e1t5u;r nb rDeaatke;. n}o
                     w ( )f;o r}  (
                     c}o
  n
  sftu n[cktwi,o nm uelxtt]r aocft TOabgj(excmtl.,e nttargi)e s{(
    I M PcOoRnTsAtN CmEa_tBcOhO S=T )x)m li.fm a(ttciht(lneeTwe xRte.giEnxcpl(u`d<e$s{(tkawg)})[ ^{> ]k*w>B(o?o:s<t! \+\=[ C(DmAuTlAt\-\1[))*?2(0[;\ \bsr\e\aSk];* ?})
    ( ? :s\c\o]r\e\ ]+>=) ?k<w\B\o/o$s{tt a*g }0>.`2,; 
                                                        ' i 'r)e)t;u
                                                                r n  i{f
                                                                         ( ! m astccohr)e :r eMtautrhn. r'o'u;n
                                                                       d ( srceotruer)n, 
                                                                         m a t c hu[n1i]q.ureeSpoluarccee(s/,<
                                                                         [ ^ > ] +s>o/ugr,c e'C'o)u.nrte:p luancieq(u/e&Saomupr;c/egs,.'l&e'n)g.trhe,p
                                                                       l a c e (i/s&Blrte;a/kgi,n'g<:' )r.erceepnlcaycMes( /<& g1t5;*/6g0,*'1>0'0)0. r&e&p luancieq(u/e&Sqouuortc;e/sg.,l'e"n'g)t.hr e>p=l a2c,e
                                                                       ( / & # 3r9e;p/rge,s"e'n"t)a.ttirviem:( )c;l
                                                                       u}s
                                                                t
                                                                efru.nacrttiiocnl epsa[r0s]e,R
                                                                S S (}x;m
  l})

{a
s y ncco nfsutn cittieomns  g=e t[T]o;p
 N e wcso(nlsotc aittieomnM)a t{c
                                h e sc o=n sxtm la.rmtaitcclheAsl l=( /a<wiatietm [f^e>t]c*h>A(l[l\Sso\uSr]c*e?s)(<l\o/ciatteimo>n/)g;i
                                ) ; 
 c o nfsoorl e(.cloongs(t` [mRaStSc]h  $o{fl oictaetmiMoant}c:h e$s{)a r{t
 i c l e sc.olnesntg tcho}n theanbte r=` )m;a
                                t c hi[f1 ](;a
                                r t i c lietse.mlse.npgutshh (={=
                                                              =   0 )   r ettiutrlne :{  ecxatnrdaicdtaTtaegs(:c o[n]t,e natr,t i'ctlietCloeu'n)t,:
                                    0 ,   c l udsetsecrrCioputnito:n :0  e}x;t
                                r a c
                                t T acgo(ncsotn tcelnuts,t e'rdse s=c rcilputsitoenr'N)e,w
                                s ( a r t i cpluebsD)a;t
                                e :  ceoxntsrta cstcToarge(dc o=n tcelnuts,t e'rpsu
                                  b D a t e.'m)a,p
                                  ( c l u s t elri n=k>:  (e{x tcrlaucsttTearg,( c.o.n.tsecnotr,e C'lluisntke'r)(,c
                                                             l u s t e}r)); 
                               } ) )}

     i f. s(oirtte(m(sa.,l ebn)g t=h>  =b=.=s c0o)r e{ 
-   a . sccoonrset) ;e
       n
       t r y/M/a tKcahyensa k=  çxemşilt.lmialticğhiA lklu(r/a<leın:t
         r y [/^/> ]İl*k> (3[ \ssı\rSa]y*a? )y<a\l/neınztcray >2/+g ik)a;y
       n a k t afno rg e(lceonn shta bmeartlcehr  ogfi reenbtirlyiMra.t
       c h e/s/)  T{e
                    k   k a y n ackotnasnt  gceolnetnelnetr  =4 .m astıcrha[d1a]n; 
       i t i b a r ecno nlsits tleiynek Maaltıcnhı r=. 
         c o nctoennstt. mtaotpc3h (=/ <[l]i;n
                                    k [ ^c>o]n*shtr erfe=s[t" '=] ([[]^;"
                    '
                      ] + )f[o"r' ](/cio)n;s
                      t   i t e m  iotfe mssc.opruesdh)( {{

                                                                   i f   (tiittelme.:s oeuxrtcreaCcotuTnatg (>c=o n2t e&n&t ,t o'pt3i.tlleen'g)t,h
                        <   3 )   { 
                        d e s c r itpotpi3o.np:u sehx(tirtaecmt)T;a
                                                                     g ( c o n}t eenlts,e  '{s
                                                                     u m m a r y 'r)e s|t|. peuxsthr(aictteTma)g;(
                                                                     c o n t e}n
                                                          t ,  }'
                      c
                    o n t/e/n tt'o)p,3
                        d o l m a d ı ypsuab D(ayteet:e relxit rçaockt-Tkaagy(ncaoknltıe nhta,b e'ru pydoaktsead)' )r e|s|t 'etxetnr atcatmTaamgl(ac
                      o n twehnitl,e  '(ptuobpl3i.slheendg't)h, 
                      <   3   & &   r elsitn.kl:e nlgitnhk M>a t0c)h  {?
                        l i n ktMoapt3c.hp[u1s]h (:r e's't,.
                      s h i f t ( )}));;

} 

} 
  c o}n
s t  rfeitnuarln  =i t[e.m.s.;t
o}p
3
,f u.n.c.trieosnt ]g.estlKiecyew(o0r,d s1(0t)i;t
l
e )  r{e
t u rcno n{s
           t   s t olpo c=a tnieown ,S
           e t ( [ 'fveet'c,h'eidlAet':, 'Dbaitre'.,n'obwu('),,'
             d a ' , 'adret'i,c'ldeeCno'u,n'ti:ç ianr't,i'colleasn.'l,e'nvgetyha,'
           , ' a m ac'l,u'sçotke'r,C'oeunn't,:' mcil'u,s'tneer's,.'lkein'g]t)h;,

           r e tcuarnnd i(dtaittelse:| |f'i'n)a.lt.omLaopw(esr C=a>s e(({)
             . r e p l a csec(o/r[e^:\ wsğ.üşsıcöçoĞÜrŞİeÖÇ,\
                              s ] / g , ' 's)o.usrpcleiCto(u/n\ts:+ /s)..sfoiulrtceerC(owu n=t>, 
           w . l e n g tsho u>r c3e s&:&  s!.sutnoipq.uheaSso(uwr)c)e;s
           ,}


 f u n c tiisoBnr ecaokuinntgO:v esr.liaspB(rae,a kbi)n g{, 

            c o n stti tsl e=:  nse.wr eSperte(sbe)n;t a
   t i vree.ttuirtnl ea,.
     f i l t e r (dwe s=c>r isp.thiaosn(:w )s)..rleepnrgetshe;n t
   a}t
       i
       vceo.ndsets cSrOiUpRtCiEoSn ?=. s{l
                                         i c e'(T0ür,k i4y0e0'):, 
       [ 
         {l innakm:e :s .'rNeTpVr'e,s e n t a t i vuer.ll:i n'kh,t
          t p s : / / wpwuwb.Dnattve.:c onme.wt rD/astoen(-sd.arkeipkrae.sresnst'a,t iwveei.gphutb:D a1t.e0) .}t,o
            I S O S t{r innagm(e):, 
                                         ' H ü r r}i)y)e,t
                                           ' ,  } ;u
                                           r}l
                                         :
           m'ohdtutlpes.:e/x/pwowrwt.sh u=r r{i ygeett.TcoopmN.etwrs/ r}s;s/anasayfa', weight: 1.0 },
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
      .sort((a, b) => b.score - a.score);

  // Kaynak çeşitliliği kuralı:
  // İlk 3 sıraya yalnızca 2+ kaynaktan gelen haberler girebilir.
  // Tek kaynaktan gelenler 4. sıradan itibaren listeye alınır.
  const top3 = [];
    const rest = [];

  for (const item of scored) {
        if (item.sourceCount >= 2 && top3.length < 3) {
                top3.push(item);
        } else {
                rest.push(item);
        }
  }

  // top3 dolmadıysa (yeterli çok-kaynaklı haber yoksa) rest'ten tamamla
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
                description: s.representative.description?.slice(0, 400),
                link: s.representative.link,
                pubDate: new Date(s.representative.pubDate).toISOString(),
        })),
  };
}

module.exports = { getTopNews };
