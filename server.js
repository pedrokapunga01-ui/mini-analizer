'use strict';

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

// URL de um cassino que exibe o histórico do Bac Bo (ex: Betano, Stake, JonBet)
// O seletor CSS precisa de ser ajustado para o site escolhido.
const CASINO_URL = process.env.CASINO_URL || 'https://www.betano.bet.br/casino/jogo/bac-bo-ao-vivo';
const RESULTS_SELECTOR = process.env.RESULTS_SELECTOR || '.bac-bo-history .result-item'; // Exemplo

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Scraping com Puppeteer ----------
async function scrapeResults() {
  let browser;
  try {
    // No Render, o Puppeteer precisa de argumentos específicos para funcionar no plano gratuito
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(CASINO_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Espera pelos elementos dos resultados (ajuste o seletor!)
    await page.waitForSelector(RESULTS_SELECTOR, { timeout: 15000 });

    // Extrai os dados
    const rounds = await page.evaluate((selector) => {
      const items = document.querySelectorAll(selector);
      return Array.from(items).map((el, index) => {
        // Lógica de extração: ajuste conforme a estrutura HTML do site escolhido
        const resultadoText = el.querySelector('.result-color')?.textContent?.trim() || el.textContent?.trim();
        let resultado = null;
        if (/azul|player|jogador/i.test(resultadoText)) resultado = 'Jogador';
        else if (/vermelho|banker|banca/i.test(resultadoText)) resultado = 'Banca';
        else if (/amarelo|empate|tie/i.test(resultadoText)) resultado = 'Empate';

        return {
          id: `scraped-${Date.now()}-${index}`,
          resultado,
          t: Date.now() - (index * 30000), // Aproximação
          pj: null, // O scraping visual pode não ter os scores dos dados
          pb: null
        };
      }).filter(r => r.resultado);
    }, RESULTS_SELECTOR);

    if (rounds.length === 0) throw new Error('Nenhum resultado encontrado na página.');
    console.log(`[OK] Scraper devolveu ${rounds.length} rodadas.`);
    return rounds;

  } catch (e) {
    console.error(`[ERRO SCRAPER] ${e.message}`);
    throw e;
  } finally {
    if (browser) await browser.close();
  }
}

// ---------- Rota principal ----------
app.get('/api/bacbo-results', async (req, res) => {
  try {
    const rounds = await scrapeResults();
    res.json({ ok: true, source: 'Puppeteer Scraper', count: rounds.length, data: rounds });
  } catch (e) {
    res.status(502).json({ ok: false, erro: 'Scraping falhou: ' + e.message, data: [] });
  }
});

// ---------- Health-check ----------
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

app.listen(PORT, HOST, () => {
  console.log(`[BOOT] bacbo-mini-analyzer (Puppeteer) a escutar em http://${HOST}:${PORT}`);
});