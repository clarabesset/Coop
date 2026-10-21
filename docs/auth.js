(() => {
// Déverrouillage de l'app : le mot de passe dérive une clé (PBKDF2) qui déchiffre
// window.COOP_CONFIG (AES-GCM) pour obtenir l'identifiant du Sheet.
// Un mauvais mot de passe fait échouer le déchiffrement : aucune comparaison en clair.
const STORE_KEY = 'coop.key';
const enc = new TextEncoder(), dec = new TextDecoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function config() {
  if (!window.COOP_CONFIG) throw new Error('config.js manquant : lancez scripts/make-config.mjs');
  return window.COOP_CONFIG;
}

async function deriveKey(password) {
  const cfg = config();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(cfg.salt), iterations: cfg.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

async function decryptConfig(key) {
  const cfg = config();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(cfg.iv) }, key, fromB64(cfg.data));
  return JSON.parse(dec.decode(plain));
}

// Renvoie { config, keyB64 } ou lève une erreur si le mot de passe est faux.
async function unlock(password) {
  const key = await deriveKey(password);
  const cfg = await decryptConfig(key);
  return { config: cfg, keyB64: toB64(await crypto.subtle.exportKey('raw', key)) };
}

function storage(persistent) { return persistent ? localStorage : sessionStorage; }
function readStored() {
  try { return localStorage.getItem(STORE_KEY) || sessionStorage.getItem(STORE_KEY); } catch { return null; }
}
function remember(keyB64, persistent) {
  try { forget(); storage(persistent).setItem(STORE_KEY, keyB64); } catch { /* stockage indisponible : session seulement */ }
}
function forget() {
  try { localStorage.removeItem(STORE_KEY); } catch {}
  try { sessionStorage.removeItem(STORE_KEY); } catch {}
}

// Reprend une session mémorisée ; null si absente ou invalide (config regénérée).
async function unlockStored() {
  const k = readStored();
  if (!k) return null;
  try {
    const key = await crypto.subtle.importKey('raw', fromB64(k), 'AES-GCM', false, ['decrypt']);
    return await decryptConfig(key);
  } catch { forget(); return null; }
}

// Affiche un formulaire de mot de passe dans `container` et appelle onReady(config).
function requireLogin(container, onReady) {
  container.innerHTML = `
    <form class="login">
      <label for="password">Mot de passe de l'app</label>
      <input id="password" type="password" autocomplete="current-password" required autofocus>
      <label class="check"><input id="remember" type="checkbox" checked> Se souvenir sur cet appareil</label>
      <button type="submit">Entrer</button>
      <p class="login-error" aria-live="polite"></p>
    </form>`;
  const form = container.querySelector('form'), err = container.querySelector('.login-error');
  const btn = form.querySelector('button');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Vérification…';
    try {
      const { config: cfg, keyB64 } = await unlock(form.password.value);
      remember(keyB64, form.remember.checked);
      container.innerHTML = '';
      onReady(cfg);
    } catch (e2) {
      err.textContent = /config\.js/.test(e2.message) ? e2.message : 'Mot de passe incorrect';
      btn.disabled = false; btn.textContent = 'Entrer';
      form.password.select();
    }
  });
}

window.CoopAuth = { unlock, unlockStored, remember, forget, requireLogin };
})();
