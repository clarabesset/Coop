// Chargement des membres depuis le Google Sheet, avec repli sur des données de démo.
// Le Sheet doit être partagé en « Tous les utilisateurs disposant du lien : lecteur ».

const SHEET_ID = '1U9XAJZzTZHdLWJXMzkiVB9A3gUnMywjgkTgNkE6l5L8';
const SHEET_GID = '0';
const SHEET_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&gid=${SHEET_GID}`;

// Copie de data/membres-fake.csv, utilisée si le Sheet est injoignable.
const FALLBACK_CSV = `
id,prenom,nom,email,telephone,statut,date_carte,oc_slug
037d34c1-2d96-42a8-8db8-afef734fe509,Camille,Durand,camille.durand@example.org,0601020304,sociétaire,2026-09-01,camille-durand
a4691e86-0ba8-45c2-adb8-b011dc507003,Inès,Moreau,ines.moreau@example.org,0605060708,adhérent,2026-09-03,
108bec2d-1780-4920-9396-cb870d6f5240,Théo,Lefèvre,theo.lefevre@example.org,0609101112,adhérent,2026-09-10,theo-lefevre
ce1d30ac-8d33-47b2-a2d4-59c2e1b3093d,Awa,Diallo,awa.diallo@example.org,0613141516,sociétaire,2026-09-12,
2d84f332-28e4-46c9-ac50-2d550a71cfc6,Lucas,Bernard,lucas.bernard@example.org,0617181920,adhérent,2026-09-20,
578c40cc-646d-40ad-b0fa-0cb3a616acf5,Nour,Haddad,nour.haddad@example.org,0621222324,sociétaire,2026-10-02,nour-haddad
4877aa94-8064-4e9f-ac13-99abeece699c,Maëlle,Petit,maelle.petit@example.org,0625262728,adhérent,2026-10-05,
012a28dd-3284-43ea-b3b7-47b322ebe225,Yanis,Roux,yanis.roux@example.org,0629303132,sociétaire,2026-10-14,
`.trim();

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

function rowsToMembers(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1)
    .filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])))
    .filter(m => m.id);
}

// Retourne { members, source } où source vaut 'sheet' ou 'demo'.
async function loadMembers() {
  try {
    const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const members = rowsToMembers(parseCsv(text));
    if (!members.length) throw new Error('Feuille vide ou colonne id absente');
    return { members, source: 'sheet' };
  } catch (err) {
    console.warn('Sheet injoignable, données de démo utilisées :', err.message);
    return { members: rowsToMembers(parseCsv(FALLBACK_CSV)), source: 'demo' };
  }
}

// Extrait l'UUID d'un contenu de QR code : URL avec ?id=… ou UUID brut.
function extractId(raw) {
  const m = String(raw).trim().match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

window.CoopData = { loadMembers, extractId, SHEET_ID, SHEET_GID };
