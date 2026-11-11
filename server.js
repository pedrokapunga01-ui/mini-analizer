'use strict';

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

// ========== FONTES DE DADOS ==========
// Fonte 1: API da Evolution (pode ser bloqueada)
const EVOLUTION_URL = 'https://api-cs.casino.org/svc-evolution-game-events/api/bacbo?page=0&size=50&sort=data.settledAt,desc&duration=120&wheelResults=PlayerWon,BankerWon,Tie';

// Fonte 2: API da TipMiner (fallback)
// Nota: Este endpoint é um exemplo. Pode ser necessário ajustar o caminho exato.
const TIPMINER_URL = 'https://api.tipminer.com/api/bacbo/results'; 

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Funções de Normalização (iguais às anteriores) ----------
function stripAccents(str) {
  return String(str ?? '').normalize('NFD').split('').filter((c) => {
    const code = c.charCodeAt(0);
    return code < 0x0300 || code > 0x036f;
  }).join('');
}

function normalizeOutcome(v) {
  if (v && typeof v === 'object') v = v.outcome ?? v.resultado ?? v.winner ?? v.name;
  const s = stripAccents(v).trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['player', 'jogador', 'playerwin', 'playerwins', 'playerwon', 'blue'].includes(s)) return 'Jogador';
  if (['banker', 'banca', 'bankerwin', 'bankerwins', 'bankerwon', 'red', 'vermelho'].includes(s)) return 'Banca';
  if (['tie', 'draw', 'empate', 'equal', 'push', 'tied'].includes(s)) return 'Empate';
  return null;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validMs(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function extractItems(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  return [body.data, body.results, body.items, body.resultados, body.rounds, body.events,
    body.data?.results, body.data?.items, body.data?.resultados, body.data?.rounds,
    body.data?.events, body.data?.data].find(Array.isArray) || [];
}

function normalizeRound(item) {
  const d = item?.data || item?.round || item || {};
  const r = (d.result && typeof d.result === 'object') ? d.result
    : (item?.result && typeof item.result === 'object') ? item.result : {};

  const t = validMs(d.settledAt ?? d.endTime ?? d.endedAt ?? d.finishedAt ??
    item?.settledAt ?? item?.fim);
  const raw = r.outcome ?? r.resultado ?? r.winner ??
    d.outcome ?? d.resultado ?? d.winner ??
    item?.outcome ?? item?.resultado ?? item?.winner ??
    (typeof d.result === 'string' ? d.result : null) ??
    (typeof item?.result === 'string' ? item.result : null);
  const resultado = normalizeOutcome(raw);
  const id = String(
    d.id ?? d.roundId ?? d.round_id ?? d.eventId ??
    item?.id ?? item?.roundId ?? item?.round_id ?? item?.eventId ?? ''
  ).trim();

  if (!id || !resultado || !t) return null;

  const pj = numOrNull(r.playerDice?.score ?? d.playerDice?.score ?? d.playerScore ?? d.player_score);
  const pb = numOrNull(r.bankerDice?.score ?? d.bankerDice?.score ?? d.bankerScore ?? d.banker_score);

  return { id, resultado, t, pj, pb };
}

// ---------- Função para tentar uma fonte ----------
async function fetchFromSource(url, sourceName) {
  try {
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: { Accept: 'application/json', 'User-Agent': 'CapungaAnalyzer/1.0' }
    });
    const map = new Map();
    for (const it of extractItems(resp.data)) {
      const rd = normalizeRound(it);
      if (rd) map.set(rd.id, rd);
    }
    const rounds = [...map.values()].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    if (rounds.length === 0) throw new Error('Resposta vazia');
    console.log(`[OK] Fonte ${sourceName} devolveu ${rounds.length} rodadas.`);
    return rounds;
  } catch (e) {
    console.warn(`[FALHA] Fonte ${sourceName}: ${e.message}`);
    throw e; // Propaga o erro para o fallback
  }
}

// ---------- Rota principal com Fallback ----------
app.get('/api/bacbo-results', async (req, res) => {
  try {
    // Tenta a Fonte 1 (Evolution)
    try {
      const rounds = await fetchFromSource(EVOLUTION_URL, 'Evolution');
      return res.json({ ok: true, source: 'Evolution', count: rounds.length, data: rounds });
    } catch (e) {
      console.log('Evolution falhou, a tentar TipMiner...');
    }

    // Se falhar, tenta a Fonte 2 (TipMiner)
    try {
      const rounds = await fetchFromSource(TIPMINER_URL, 'TipMiner');
      return res.json({ ok: true, source: 'TipMiner', count: rounds.length, data: rounds });
    } catch (e) {
      console.log('TipMiner também falhou.');
    }

    // Se ambas falharem, devolve erro
    throw new Error('Todas as fontes de dados falharam.');
  } catch (e) {
    console.error('[ERRO FINAL]', e.message);
    res.status(502).json({ ok: false, erro: 'Não foi possível obter dados de nenhuma fonte.', data: [] });
  }
});

// ---------- Health-check ----------
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

app.get('/', (req, res) => {
  res.json({ servico: 'bacbo-mini-analyzer', endpoints: ['/api/bacbo-results', '/health'] });
});

app.listen(PORT, HOST, () => {
  console.log(`[BOOT] bacbo-mini-analyzer a escutar em http://${HOST}:${PORT}`);
});