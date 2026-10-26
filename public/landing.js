// Landing page: identity, rejoin, create/join. External file (not inline) so
// the page works under a strict script-src 'self' Content-Security-Policy.

// Persist a stable clientId so a refresh re-seats the same player.
function clientId() {
  let id = sessionStorage.getItem('pu_clientId');
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
         (Date.now().toString(36) + Math.random().toString(36).slice(2));
    sessionStorage.setItem('pu_clientId', id);
  }
  return id;
}
clientId();

const nameEl = document.getElementById('name');
const codeEl = document.getElementById('code');
nameEl.value = sessionStorage.getItem('pu_name') || '';

// Offer a one-tap rejoin for the most recent room (if any).
const lastRoom = sessionStorage.getItem('pu_lastRoom');
if (lastRoom) {
  const wrap = document.getElementById('rejoin');
  const btn = document.createElement('button');
  btn.className = 'pu-btn pu-btn-mint pu-btn-block';
  btn.textContent = 'Rejoin room ' + lastRoom + ' →';
  btn.onclick = () => {
    sessionStorage.setItem('pu_intent', 'join');
    location.href = '/r/' + lastRoom;
  };
  wrap.appendChild(btn);
  wrap.hidden = false;
}

function saveName() {
  sessionStorage.setItem('pu_name', nameEl.value.trim());
}

document.getElementById('create').onclick = () => {
  saveName();
  sessionStorage.setItem('pu_intent', 'create');
  location.href = '/r/_new';
};

function doJoin() {
  const code = codeEl.value.trim().toUpperCase();
  if (code.length < 4) { codeEl.focus(); return; }
  saveName();
  sessionStorage.setItem('pu_intent', 'join');
  location.href = '/r/' + code;
}
document.getElementById('join').onclick = doJoin;
codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
