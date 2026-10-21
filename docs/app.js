(() => {
const { loadTransactions, membersFrom, summarizeContributions, extractId, SHEET_ID, TRANSACTIONS_SHEET } = window.CoopData;

const $ = (sel) => document.querySelector(sel);
const video = $('#video');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let members = [];
let transactions = [];
let transactionsOk = false;
let stream = null;
let scanning = false;

function setStatus(text) { $('#status').textContent = text; }

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.dataset.screen !== name);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtEuro = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} €`;
const fmtDate = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

function renderContributions(m) {
  const s = summarizeContributions(transactions, m.id);
  const rows = s.recent.map(r => `
      <li class="${r.amount > 0 ? 'paid' : 'missing'}">
        <span>${escapeHtml(r.label)}</span><span>${r.amount > 0 ? fmtEuro(r.amount) : '—'}</span>
      </li>`).join('');
  return `
    <p class="contrib ${s.upToDate ? 'ok' : 'ko'}">${s.upToDate ? 'À jour ce mois-ci' : 'Pas de contribution ce mois-ci'}</p>
    <p class="muted small">Dernière contribution : ${fmtDate(s.last.date)} · ${fmtEuro(s.last.amount)}</p>
    <ul class="months">${rows}</ul>`;
}

function renderMember(id) {
  stopScanner();
  const m = members.find(x => x.id === id);
  const card = $('#member');
  if (!m) {
    card.className = 'member unknown';
    card.innerHTML = `<h2>Carte inconnue</h2><p class="muted">Aucun contributeur avec le pseudo « ${escapeHtml(id)} ».</p>`;
  } else {
    const s = summarizeContributions(transactions, m.id);
    card.className = `member ${s.upToDate ? 'uptodate' : 'late'}`;
    card.innerHTML = `
      <p class="label">Contributeur · ${escapeHtml(m.id)}</p>
      <h2>${escapeHtml(m.name)}</h2>
      ${m.tier ? `<p class="badge">${escapeHtml(m.tier)}</p>` : ''}
      ${renderContributions(m)}`;
  }
  showScreen('result');
}

// Décode une image (frame vidéo ou photo) et renvoie l'id trouvé, sinon null.
function decode(source, width, height) {
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(source, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return code && code.data ? { id: extractId(code.data), raw: code.data } : null;
}

function explainCameraError(err) {
  const name = err && err.name;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'Ce navigateur ne donne pas accès à la caméra. Ouvrez le lien dans Safari ou Chrome directement.';
  }
  if (!window.isSecureContext) return 'La caméra exige une adresse en https://.';
  if (name === 'NotAllowedError') return 'Accès caméra refusé. Sur iPhone : Réglages → Safari → Caméra → Autoriser, puis rechargez.';
  if (name === 'NotFoundError') return 'Aucune caméra trouvée sur cet appareil.';
  if (name === 'NotReadableError') return 'Caméra occupée par une autre application.';
  return `${name || 'Erreur'} : ${err && err.message ? err.message : 'inconnue'}`;
}

// Doit être appelé depuis un geste utilisateur (tap) : Safari iOS le demande.
async function startScanner() {
  showScreen('scan');
  $('#start').hidden = true;
  $('#manual-form').hidden = true;
  setStatus('Ouverture de la caméra…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    stopScanner();
    setStatus('Caméra indisponible. ' + explainCameraError(err));
    $('#start').textContent = 'Réessayer la caméra';
    $('#start').hidden = false;
    $('#manual-form').hidden = false;
    return;
  }
  scanning = true;
  setStatus('Visez un QR code');
  requestAnimationFrame(tick);
}

function stopScanner() {
  scanning = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
}

function tick() {
  if (!scanning) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
    const found = decode(video, video.videoWidth, video.videoHeight);
    if (found) {
      if (found.id) {
        if (navigator.vibrate) navigator.vibrate(80);
        renderMember(found.id);
        return;
      }
      setStatus('QR code lu, mais pas de carte membre dedans');
    }
  }
  requestAnimationFrame(tick);
}

// Repli : photo prise avec l'appareil photo natif, décodée ensuite.
async function scanPhoto(file) {
  if (!file) return;
  stopScanner();
  setStatus('Lecture de la photo…');
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const found = decode(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    bitmap.close && bitmap.close();
    if (found && found.id) { renderMember(found.id); return; }
    setStatus(found ? 'QR code lu, mais pas de carte membre dedans' : 'Aucun QR code lisible sur la photo. Réessayez de plus près.');
  } catch (err) {
    setStatus('Photo illisible : ' + err.message);
  }
  $('#start').hidden = false;
}

function showIdle() {
  showScreen('scan');
  $('#start').textContent = 'Démarrer la caméra';
  $('#start').hidden = false;
  setStatus('Appuyez sur le bouton pour scanner une carte.');
}

async function init() {
  const tx = await loadTransactions();
  transactions = tx.transactions;
  transactionsOk = tx.ok;
  members = membersFrom(transactions);
  const src = $('#source');
  if (!tx.ok) {
    src.textContent = 'Onglet Transactions injoignable : ' + tx.error;
    src.className = 'source demo';
  } else {
    src.textContent = `${members.length} contributeurs · ${transactions.length} transactions`;
    src.className = 'source sheet';
  }

  const id = extractId(new URLSearchParams(location.search).get('id') || '');
  if (id) { renderMember(id); return; }
  showIdle();
}

$('#start').addEventListener('click', startScanner);
$('#photo').addEventListener('change', (e) => { scanPhoto(e.target.files[0]); e.target.value = ''; });
$('#again').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname);
  startScanner();
});
$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = extractId($('#manual-id').value);
  if (id) renderMember(id);
  else setStatus('Id invalide');
});
window.addEventListener('pagehide', stopScanner);
document.addEventListener('visibilitychange', () => { if (document.hidden && scanning) { stopScanner(); showIdle(); } });
$('#sheet-link').href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
})();
