(() => {
// Source unique : l'onglet « Transactions » du Google Sheet, export CSV d'Open Collective.
// Le Sheet doit être partagé en « Tous les utilisateurs disposant du lien : lecteur ».
// L'identifiant d'une carte est le pseudo Open Collective (colonne « Opposite Account Handle »).

const SHEET_ID = '1Bn6md9VQvYQc7cduu1_YDNqoTmEtrKNh2QmfbsPouzE';
const TRANSACTIONS_SHEET = 'Transactions';
const TRANSACTIONS_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(TRANSACTIONS_SHEET)}`;

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// "2026-10-16 13:53", "16/10/2026 13:53" ou ISO -> Date locale ; null si illisible.
function parseDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// "20,00", "1 234,50" ou "-30" -> nombre.
function parseAmount(s) {
  const n = parseFloat(String(s || '').replace(/[\s ]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Palier entre parenthèses en fin de description, ex. "(Cotisation mensuelle)".
function tierOf(description) {
  const m = String(description || '').match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : '';
}

function rowsToTransactions(rows) {
  if (!rows.length) return [];
  const h = rows[0].map(x => x.trim().toLowerCase());
  const col = (name) => h.indexOf(name.toLowerCase());
  const iDate = col('Effective Date & Time'), iAmt = col('Amount Single Column'),
        iHandle = col('Opposite Account Handle'), iName = col('Opposite Account Name'),
        iCD = col('Credit/Debit'), iKind = col('Kind'), iRev = col('Is Reversed'), iDesc = col('Description');
  if (iDate < 0 || iAmt < 0 || iHandle < 0) return [];
  return rows.slice(1).map(r => ({
    date: parseDate(r[iDate]),
    amount: parseAmount(r[iAmt]),            // négatif pour un remboursement (DEBIT)
    handle: (r[iHandle] || '').trim().toLowerCase(),
    name: (r[iName] || '').trim(),
    credit: iCD < 0 || (r[iCD] || '').trim().toUpperCase() !== 'DEBIT',
    contribution: iKind < 0 || (r[iKind] || '').trim().toUpperCase() === 'CONTRIBUTION',
    reversed: iRev >= 0 && (r[iRev] || '').trim() !== '',
    tier: tierOf(r[iDesc]),
  })).filter(t => t.date && t.handle);
}

async function loadTransactions() {
  try {
    const res = await fetch(TRANSACTIONS_CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const transactions = rowsToTransactions(parseCsv(await res.text()));
    if (!transactions.length) throw new Error('Onglet Transactions vide ou colonnes absentes');
    return { transactions, ok: true, error: null };
  } catch (err) {
    console.warn('Transactions indisponibles :', err.message);
    return { transactions: [], ok: false, error: err.message };
  }
}

// Un membre par pseudo : nom et palier pris sur la contribution la plus récente.
function membersFrom(transactions) {
  const byHandle = {};
  for (const t of transactions) {
    if (!t.contribution || !t.credit) continue;
    const m = byHandle[t.handle];
    if (!m || t.date > m.lastDate) {
      byHandle[t.handle] = { id: t.handle, name: t.name || t.handle, tier: t.tier, lastDate: t.date };
    }
  }
  return Object.values(byHandle).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const MONTH_LABEL = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (key) => { const [y, m] = key.split('-'); return `${MONTH_LABEL[+m - 1]} ${y}`; };

// Synthèse d'un pseudo : état du mois courant, montant net des derniers mois, dernière contribution.
// Les remboursements (DEBIT, montant négatif) se soustraient du mois où ils tombent.
function summarizeContributions(transactions, handle, months = 6, now = new Date()) {
  handle = (handle || '').trim().toLowerCase();
  if (!handle) return null;
  const mine = transactions.filter(t => t.handle === handle && t.contribution && !t.reversed);
  const byMonth = {};
  for (const t of mine) byMonth[monthKey(t.date)] = (byMonth[monthKey(t.date)] || 0) + t.amount;
  const recent = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    recent.push({ key, label: monthLabel(key), amount: byMonth[key] || 0 });
  }
  const credits = mine.filter(t => t.credit).sort((a, b) => b.date - a.date);
  const last = credits[0] || null;
  return {
    handle,
    count: credits.length,
    upToDate: (byMonth[monthKey(now)] || 0) > 0,
    recent,
    last: last ? { date: last.date, amount: last.amount, tier: last.tier } : null,
  };
}

// Extrait l'identifiant d'un contenu de QR code : URL avec ?id=… ou pseudo brut.
function extractId(raw) {
  raw = String(raw || '').trim();
  const m = raw.match(/[?&]id=([^&#\s]+)/i);
  let id = m ? decodeURIComponent(m[1]) : raw;
  id = id.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,80}$/.test(id) ? id : null;
}

window.CoopData = { loadTransactions, membersFrom, summarizeContributions, extractId, SHEET_ID, TRANSACTIONS_SHEET };
})();
