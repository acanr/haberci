const express = require('express');
const cors = require('cors');
const path = require('path');
const { getTopNews } = require('./lib/rss');
const { summarizeTopNews } = require('./lib/summarizer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const cache = new Map();
const LOCATIONS = ['Türkiye', 'Dünya', 'Ekonomi', 'Spor', 'Teknoloji', 'İstanbul'];

app.get('/api/rss', async (req, res) => {
  const loc = req.query.loc || 'Türkiye';
  if (!LOCATIONS.includes(loc)) return res.status(400).json({ error: 'Geçersiz lokasyon' });
  try {
    const data = await getTopNews(loc);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/summarize', async (req, res) => {
  const { candidates, location } = req.body;
  if (!candidates || !location) return res.status(400).json({ error: 'Eksik parametre' });
  try {
    const news = await summarizeTopNews(candidates, location);
    res.json({ news });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
