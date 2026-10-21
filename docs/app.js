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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMember(id) {
  stopScanner();
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
$('#sheet-link').href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}`;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
