const { loadMembers, extractId, SHEET_ID, SHEET_GID } = window.CoopData;

const $ = (sel) => document.querySelector(sel);
const video = $('#video');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let members = [];
let stream = null;
let scanning = false;

function setStatus(text) { $('#status').textContent = text; }

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.hidden = s.dataset.screen !== name);
}

function renderMember(id) {
  const m = members.find(x => x.id === id);
  const card = $('#member');
  if (!m) {
    card.className = 'member unknown';
    card.innerHTML = `<h2>Carte inconnue</h2><p class="muted">Aucun membre avec cet id.</p>`;
  } else {
    const statut = (m.statut || '').toLowerCase();
    card.className = `member ${statut.startsWith('soci') ? 'societaire' : 'adherent'}`;
    card.innerHTML = `
      <p class="label">Membre</p>
      <h2>${escapeHtml(m.prenom)} ${escapeHtml(m.nom)}</h2>
      <p class="badge">${escapeHtml(m.statut || 'statut inconnu')}</p>`;
  }
  showScreen('result');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function startScanner() {
  showScreen('scan');
  setStatus('Ouverture de la caméra…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    });
  } catch (err) {
    setStatus('Caméra indisponible : ' + err.message);
    $('#manual-form').hidden = false;
    return;
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  scanning = true;
  setStatus('Visez un QR code');
  requestAnimationFrame(tick);
}

function stopScanner() {
  scanning = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

function tick() {
  if (!scanning) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (code && code.data) {
      const id = extractId(code.data);
      if (id) {
        if (navigator.vibrate) navigator.vibrate(80);
        stopScanner();
        renderMember(id);
        return;
      }
      setStatus('QR code lu, mais pas de carte membre dedans');
    }
  }
  requestAnimationFrame(tick);
}

async function init() {
  const { members: list, source } = await loadMembers();
  members = list;
  const src = $('#source');
  if (source === 'demo') {
    src.textContent = 'Données de démo (Sheet non accessible)';
    src.className = 'source demo';
  } else {
    src.textContent = `${members.length} membres chargés depuis le Sheet`;
    src.className = 'source sheet';
  }

  const id = extractId(new URLSearchParams(location.search).get('id') || '');
  if (id) { renderMember(id); return; }
  startScanner();
}

$('#again').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname);
  startScanner();
});
$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = extractId($('#manual-id').value);
  if (id) { stopScanner(); renderMember(id); }
  else setStatus('Id invalide');
});
$('#sheet-link').href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}`;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
