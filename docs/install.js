(() => {
// Bannière « Ajouter à l'écran d'accueil ».
// iOS Safari : aucune API d'installation, on guide le geste Partager → Sur l'écran d'accueil.
// Android Chrome : on capture beforeinstallprompt et on propose un bouton Installer.
const DISMISS_KEY = 'coop.install.dismissed';
// Pictogramme Partager d'iOS : carré ouvert surmonté d'une flèche.
const SHARE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/></svg>`;
const banner = document.getElementById('install');
if (!banner) return;

const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafariIOS = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
const dismissed = (() => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } })();

function dismiss() {
  banner.hidden = true;
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
}

function show(html) {
  banner.innerHTML = `<div class="install-body">${html}</div><button class="install-close" aria-label="Fermer">✕</button>`;
  banner.querySelector('.install-close').addEventListener('click', dismiss);
  banner.hidden = false;
}

if (standalone || dismissed) return;

if (isIOS) {
  if (isSafariIOS) {
    show(`<strong>Ajouter à l'écran d'accueil</strong>
      <ol class="install-steps">
        <li>Appuie sur <span class="ios-key" aria-label="Plus">•••</span> en bas de Safari</li>
        <li>Puis sur <span class="ios-key" aria-label="Partager">${SHARE_ICON}</span> Partager</li>
        <li>Puis sur « Sur l'écran d'accueil »</li>
      </ol>`);
  } else {
    show(`<strong>Ajouter à l'écran d'accueil</strong><br>
      Ouvre cette page dans Safari, puis Partager → « Sur l'écran d'accueil ».`);
  }
  return;
}

// Android / Chrome / Edge : l'événement n'arrive que si le site est installable.
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  show(`<strong>Installer Coop Scan</strong><br>Une icône sur l'écran d'accueil, plein écran.
    <button id="install-btn" class="install-btn">Installer</button>`);
  banner.querySelector('#install-btn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') banner.hidden = true;
  });
});
window.addEventListener('appinstalled', () => { banner.hidden = true; });
})();
