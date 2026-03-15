const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();

async function summarizeTopNews(candidates, location) {
  const today = new Date().toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric', weekday: 'long'
  });

  const candidateText = candidates.map((c, i) =>
    `[${i+1}] SKOR:${c.score} | KAYNAK:${c.sourceCount} | ${c.isBreaking ? '🔴 SON DAKİKA' : ''}\nBAŞLIK: ${c.title}\nKAYNAKLAR: ${c.sources.join(', ')}\nÖZET: ${c.description || '-'}`
  ).join('\n\n---\n\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: 'Sen bir haber editörüsün. Sadece JSON döndür, hiçbir açıklama ekleme.',
    messages: [{
      role: 'user',
      content: `Bugün ${today}. ${location} için aşağıdaki haber adaylarından en önemli 5'ini seç ve sırala.

Kurallar:
- SKOR ve KAYNAK sayısı yüksek olanlar öncelikli
- SON DAKİKA işaretliler yukarı çıkabilir
- Aynı konu tekrar etmesin

Yanıtını SADECE şu JSON formatında ver:
{"news":[{"rank":1,"category":"Kategori","headline":"Max 90 karakter başlık","summary":"2-3 cümle özet","isBreaking":false,"sourceCount":2,"sources":["Kaynak1"]}]}

ADAYLAR:
${candidateText}`
    }],
  });

  const raw = message.content.filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1) throw new Error('JSON bulunamadı');
  return JSON.parse(raw.slice(start, end + 1)).news;
}

module.exports = { summarizeTopNews };
