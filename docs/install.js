(() => {
// Bannière « Ajouter à l'écran d'accueil ».
// iOS Safari : aucune API d'installation, on guide le geste Partager → Sur l'écran d'accueil.
// Android Chrome : on capture beforeinstallprompt et on propose un bouton Installer.
const DISMISS_KEY = 'coop.install.dismissed';
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
    show(`<strong>Ajouter à l'écran d'accueil</strong><br>
      Appuyez sur <span class="ios-share" aria-label="Partager">⎙</span> en bas de Safari, puis « Sur l'écran d'accueil ».`);
  } else {
    show(`<strong>Ajouter à l'écran d'accueil</strong><br>
      Ouvrez cette page dans Safari, puis Partager → « Sur l'écran d'accueil ».`);
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
