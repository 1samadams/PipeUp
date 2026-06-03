/* Pipe Up — Socket client + render-from-state.
 *
 * The server is the source of truth: it broadcasts the full (redacted) room
 * state on every change and this file just draws it. Local-only UI state (the
 * composer text, the reveal stepper, a pending vote) lives in `ui` and survives
 * re-renders. Game decisions are never made here. */

// ── static content ──
// The question deck is loaded from /questions.json at runtime (see DECK below);
// the host picks one and only the chosen text is sent to the server.
const ACCENTS = ["😂", "🔥", "💯", "🤔", "🫠", "😎", "🎯", "🤡"];
const PALETTE = ["#FF5A36", "#1FB8A6", "#FFC53D", "#9B5DE5"];
const CATEGORY_LABELS = { all: 'All', icebreaker: 'Icebreaker', confession: 'Confession',
  hot_take: 'Hot Take', chaos: 'Chaos', favorites: 'Favorites' };
const RANK_TITLES = [
  { emoji: '🏆', label: 'Top of the Pile' },
  { emoji: '🥈', label: 'Comedy Silver' },
  { emoji: '🥉', label: 'Reliably Funny' },
  { emoji: '📈', label: 'Solid Mid' },
  { emoji: '🦗', label: 'Crickets' },
];

// Fluent 3D emoji graphics (vendored in /assets/emoji, keyed by codepoint) so
// icons render identically on every device instead of each OS's emoji font.
const EMOJI = {
  '😂': '1f602', '🔥': '1f525', '💯': '1f4af', '🤔': '1f914', '🫠': '1fae0',
  '😎': '1f60e', '🎯': '1f3af', '🤡': '1f921', '🏆': '1f3c6', '🥇': '1f947',
  '🥈': '1f948', '🥉': '1f949', '📈': '1f4c8', '🦗': '1f997', '🎲': '1f3b2',
  '📲': '1f4f2', '🔒': '1f512', '👀': '1f440', '🗳': '1f5f3', '👑': '1f451',
  '🎉': '1f389', '🏅': '1f3c5',
};

// ── small helpers ──
function colorFor(name) {
  const sum = [...(name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0);
  return PALETTE[sum % PALETTE.length];
}
const initialOf = (name) => (name || "?").trim().charAt(0).toUpperCase() || "?";
function rankTitle(rank, total) {
  if (rank === 0) return RANK_TITLES[0];
  if (rank === total - 1 && total > 2) return RANK_TITLES[4];
  return RANK_TITLES[Math.min(rank, RANK_TITLES.length - 2)];
}

// hyperscript: h('div', {class:'x', onclick:fn}, child, child)
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function avatar(name, size = 34) {
  return h('div', {
    class: 'pu-avatar',
    style: `width:${size}px;height:${size}px;font-size:${size * 0.42}px;background:${colorFor(name)}`,
  }, initialOf(name));
}
// Render a Fluent emoji graphic sized to `px`; falls back to the raw glyph for
// any codepoint we didn't vendor (e.g. the ✓ dingbat stays text).
function icon(ch, px) {
  const key = [...(ch || '')].filter((c) => c.codePointAt(0) !== 0xFE0F).join('');
  const cp = EMOJI[key];
  if (!cp) return document.createTextNode(ch || '');
  return h('img', { class: 'pu-emoji', src: `/assets/emoji/${cp}.png`, alt: ch,
    style: px ? `width:${px}px;height:${px}px` : '' });
}

// ── identity / session ──
function clientId() {
  let id = sessionStorage.getItem('pu_clientId');
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
         (Date.now().toString(36) + Math.random().toString(36).slice(2));
    sessionStorage.setItem('pu_clientId', id);
  }
  return id;
}
const CID = clientId();
const getName = () => (sessionStorage.getItem('pu_name') || '').trim();

// ── transient local UI state ──
const ui = { writeText: '', writeAccent: null, revealIdx: 0, flipped: false,
             vote: null, pickId: null, category: 'all', custom: '' };
let lastPhase = null;
let state = null;

// ── question deck (loaded once; client-side only — the host sends chosen text) ──
let DECK = { categories: [], questions: [] };
fetch('/questions.json')
  .then((r) => r.json())
  .then((d) => {
    DECK = d;
    // If the host is already looking at a picker, redraw with the real deck.
    if (state && state.isHost && (state.phase === 'lobby' || state.phase === 'score')) render();
  })
  .catch(() => {});

// ── socket ──
const socket = io();
const rawCode = decodeURIComponent(location.pathname.split('/r/')[1] || '').toUpperCase();
let mode = (sessionStorage.getItem('pu_intent') === 'create' && rawCode === '_NEW') ? 'create' : 'join';
let code = rawCode === '_NEW' ? null : rawCode;
// Visiting /r/_new without a create intent (e.g. a stale forward-nav) has
// nothing to create — send them home.
if (rawCode === '_NEW' && mode !== 'create') location.replace('/');

let joined = false;        // have we ever received room_state?
let awaitingJoin = false;  // is a create/join in flight (so an error = room missing)?

function enter() {
  if (mode === 'create') {
    awaitingJoin = true;
    socket.emit('create_room', { clientId: CID, name: getName() });
  } else if (code && getName()) {
    awaitingJoin = true;
    socket.emit('join_room', { clientId: CID, name: getName(), code });
  } else {
    renderNameGate();
  }
}
socket.on('connect', enter);
socket.on('room_state', (s) => {
  if (!code) { code = s.code; history.replaceState(null, '', '/r/' + code); }
  if (mode === 'create') sessionStorage.removeItem('pu_intent'); // created once; never re-create
  mode = 'join'; // after the first state we always rejoin (never re-create) on reconnect
  joined = true;
  awaitingJoin = false;
  sessionStorage.setItem('pu_lastRoom', s.code); // for the landing "rejoin" button
  state = s;
  render();
});
socket.on('error', (e) => {
  const msg = e && e.message ? e.message : 'Something went wrong.';
  // If our own create/join just failed, the room is gone — show a real screen
  // instead of a blank frame (covers reconnects after a Railway restart too).
  if (awaitingJoin) { awaitingJoin = false; renderRoomGone(); return; }
  toast(msg);
});

// ── toast ──
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ── mount helpers ──
const scroll = () => document.getElementById('scroll');
function mount(screen) {
  const s = scroll();
  s.innerHTML = '';
  s.appendChild(screen);
}
function topbar() {
  return h('div', { class: 'pu-topbar' },
    h('div', { class: 'pu-room' }, h('span', { class: 'pu-room-dot' }), `PILE · ${state.code}`),
    h('div', { class: 'pu-round' }, state.roundNumber ? `Round ${state.roundNumber}` : 'Lobby'));
}
function roster() {
  return h('div', { class: 'pu-players' },
    state.players.map((p) => h('div', { class: 'pu-player-chip' + (p.connected ? '' : ' off') },
      avatar(p.name, 28),
      h('span', {}, p.id === state.you ? `${p.name} (you)` : p.name))));
}
function waitNote(text) {
  return h('div', { class: 'pu-waitnote' }, text);
}

// ── name gate (a visitor who opened a shared link without a name yet) ──
function renderNameGate() {
  const input = h('input', { class: 'pu-input pu-input-lg', placeholder: 'type your name',
    maxlength: 18, value: getName() });
  const go = () => {
    const n = input.value.trim();
    if (!n) { input.focus(); return; }
    sessionStorage.setItem('pu_name', n);
    enter();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  mount(h('div', { class: 'pu-screen' },
    h('div', { class: 'pu-logo' }, 'PIPE', h('span', {}, ' UP')),
    h('p', { class: 'pu-sub' }, `joining room ${code || ''}`),
    h('div', { class: 'pu-card pu-namecard' },
      h('div', { class: 'pu-lbl' }, "you're playing as"), input),
    h('button', { class: 'pu-btn pu-btn-mint pu-btn-block pu-cta', onclick: go }, 'Join the room →')));
}

// ── room gone (the room isn't on the server anymore — e.g. it restarted) ──
function renderRoomGone() {
  const fresh = () => {
    sessionStorage.setItem('pu_intent', 'create');
    sessionStorage.removeItem('pu_lastRoom');
    location.href = '/r/_new';
  };
  mount(h('div', { class: 'pu-screen pu-screen-center' },
    h('div', { class: 'pu-logo' }, 'PIPE', h('span', {}, ' UP')),
    h('div', { class: 'pu-megaemoji pu-bob' }, icon('🦗', 56)),
    h('h2', { class: 'pu-h2 pu-center' }, 'This room has ended'),
    h('p', { class: 'pu-sub-2 pu-center' },
      'Rooms are temporary — they vanish when the server restarts. Start a fresh one and share the new link.'),
    h('button', { class: 'pu-btn pu-btn-coral pu-btn-block pu-cta', onclick: fresh }, 'Start a new room →'),
    h('button', { class: 'pu-btn pu-btn-ghost pu-btn-block', onclick: () => (location.href = '/') }, 'Back to home')));
}

// ── the question picker (shared by lobby + scoreboard, host only) ──
function picker(lockLabel) {
  const filtered = () =>
    ui.category === 'all' ? DECK.questions : DECK.questions.filter((q) => q.category === ui.category);

  const customInput = h('input', { class: 'pu-input pu-input-lg', placeholder: 'Ask the team something…',
    maxlength: 120, value: ui.custom });
  customInput.addEventListener('input', () => { ui.custom = customInput.value; paintOpts(); });

  // Category filter chips. Switching category fully redraws the picker.
  const cats = ['all', ...(DECK.categories || [])];
  const catRow = h('div', { class: 'pu-cat-row' }, cats.map((c) =>
    h('button', { class: 'pu-cat' + (ui.category === c ? ' on' : ''),
      onclick: () => { ui.category = c; ui.pickId = null; render(); } }, CATEGORY_LABELS[c] || c)));

  const list = h('div', { class: 'pu-prompt-list' },
    filtered().map((q) => h('button', {
      class: 'pu-prompt-opt' + (ui.pickId === q.id && !ui.custom ? ' on' : ''),
      onclick: () => { ui.pickId = q.id; ui.custom = ''; customInput.value = ''; paintOpts(); },
    }, q.text)));
  function paintOpts() {
    const f = filtered();
    [...list.children].forEach((b, i) =>
      b.className = 'pu-prompt-opt' + (f[i] && ui.pickId === f[i].id && !ui.custom ? ' on' : ''));
  }

  const shuffle = h('button', { class: 'pu-btn pu-btn-ghost pu-btn-sm',
    onclick: () => {
      const f = filtered();
      if (!f.length) return;
      ui.pickId = f[Math.floor(Math.random() * f.length)].id;
      ui.custom = ''; customInput.value = ''; paintOpts();
    } }, icon('🎲', 16), ' Shuffle');

  const lock = h('button', { class: 'pu-btn pu-btn-coral pu-btn-block pu-cta',
    onclick: () => {
      const sel = DECK.questions.find((q) => q.id === ui.pickId);
      const text = ui.custom.trim() || (sel && sel.text) || '';
      if (!text) { toast('Pick a question or write your own.'); return; }
      socket.emit('set_question', { text });
    } }, lockLabel);

  // Deck not loaded (or failed): still allow a custom question.
  if (!DECK.questions || !DECK.questions.length) {
    return [h('div', { class: 'pu-hint pu-center' }, 'Loading questions…'), customInput, lock];
  }
  return [
    catRow,
    list,
    h('div', { class: 'pu-row pu-row-gap' }, shuffle, h('span', { class: 'pu-or' }, 'or write your own')),
    customInput,
    lock,
  ];
}

// ── phase screens ──
function screenLobby() {
  const url = `${location.host}/r/${state.code}`;
  const copy = h('button', { class: 'pu-btn pu-btn-coral pu-btn-block',
    onclick: () => {
      if (navigator.clipboard) navigator.clipboard.writeText(location.origin + '/r/' + state.code).catch(() => {});
      copy.replaceChildren('Copied! Send it ', icon('📲', 18));
      setTimeout(() => copy.replaceChildren('Copy invite link'), 1600);
    } }, 'Copy invite link');

  const kids = [
    topbar(),
    h('div', { class: 'pu-logo' }, 'PIPE', h('span', {}, ' UP')),
    h('p', { class: 'pu-sub' }, 'one question · everyone answers · loudest laugh wins'),
    h('div', { class: 'pu-card pu-share' },
      h('div', { class: 'pu-lbl' }, 'share this room'),
      h('div', { class: 'pu-link' }, url),
      copy,
      h('div', { class: 'pu-hint' }, 'No login. No app. Just open the link.')),
    h('div', { class: 'pu-section-lbl' }, `In the room · ${state.players.length}`),
    roster(),
  ];
  if (state.isHost) {
    kids.push(h('div', { class: 'pu-section-lbl' }, 'Pick the question'),
              ...picker('Lock the question →'));
  } else {
    kids.push(waitNote('Waiting for the host to start the round…'));
  }
  mount(h('div', { class: 'pu-screen' }, kids));
}

function screenWrite() {
  const r = state.round;
  const kids = [
    topbar(),
    h('div', { class: 'pu-prompt-banner' },
      h('div', { class: 'pu-lbl' }, 'the question'),
      h('div', { class: 'pu-prompt-text' }, r.question)),
  ];

  if (!r.youSubmitted) {
    const ta = h('textarea', { class: 'pu-textarea', placeholder: "Pipe up… what's your answer?",
      maxlength: 180, value: ui.writeText });
    const count = h('div', { class: 'pu-charcount' }, `${ui.writeText.length}/180`);
    ta.addEventListener('input', () => { ui.writeText = ta.value; count.textContent = `${ta.value.length}/180`; });

    const accentRow = h('div', { class: 'pu-accentrow' });
    ACCENTS.forEach((em) => {
      const b = h('button', {
        class: 'pu-accent' + (ui.writeAccent === em ? ' on' : ''),
        onclick: () => {
          ui.writeAccent = ui.writeAccent === em ? null : em;
          [...accentRow.children].forEach((c) =>
            c.className = 'pu-accent' + (c.dataset.em === ui.writeAccent ? ' on' : ''));
        } }, icon(em, 26));
      b.dataset.em = em;
      accentRow.appendChild(b);
    });

    const submit = h('button', { class: 'pu-btn pu-btn-mint pu-btn-block pu-cta',
      onclick: () => {
        if (!ui.writeText.trim() && !ui.writeAccent) { toast('Write something first.'); return; }
        socket.emit('submit_answer', { text: ui.writeText.trim(), emoji: ui.writeAccent });
      } }, 'Lock it in ', icon('🔒', 18));

    kids.push(
      h('div', { class: 'pu-card pu-composer' }, ta, accentRow, count),
      submit,
      h('p', { class: 'pu-hint pu-center' }, 'No takebacks. Make it count.'));
  } else {
    const done = new Set(r.answeredIds);
    kids.push(
      h('h2', { class: 'pu-h2 pu-center' }, `${r.answerCount} of ${state.players.length} piped up`),
      h('p', { class: 'pu-sub-2 pu-center' }, 'Locked in. Waiting on the slow typers ', icon('👀', 16)),
      h('div', { class: 'pu-waitlist' },
        state.players.map((p) => h('div', { class: 'pu-wait-chip' + (done.has(p.id) ? ' done' : '') },
          avatar(p.name, 26),
          h('span', {}, p.id === state.you ? `${p.name} (you)` : p.name),
          h('span', { class: 'pu-wait-status' }, done.has(p.id) ? '✓ locked in' : 'typing…')))));
  }

  if (state.isHost) {
    kids.push(h('button', { class: 'pu-btn pu-btn-coral pu-btn-block' + (r.youSubmitted ? '' : ' pu-cta'),
      onclick: () => socket.emit('start_reveal'), disabled: r.answerCount === 0 },
      `Reveal answers → (${r.answerCount}/${state.players.length} in)`));
  } else if (r.youSubmitted) {
    kids.push(waitNote('Waiting for the host to reveal…'));
  }
  mount(h('div', { class: 'pu-screen' }, kids));
}

function screenReveal() {
  const answers = state.round.answers || [];
  if (!answers.length) {
    return mount(h('div', { class: 'pu-screen' }, topbar(),
      h('h2', { class: 'pu-h2 pu-center' }, 'No answers this round ', icon('🦗', 28)),
      state.isHost
        ? h('button', { class: 'pu-btn pu-btn-coral pu-btn-block pu-cta', onclick: () => socket.emit('start_vote') }, 'On to voting →')
        : waitNote('Waiting for the host…')));
  }
  ui.revealIdx = Math.min(ui.revealIdx, answers.length - 1);
  const idx = ui.revealIdx;
  const a = answers[idx];
  const last = idx >= answers.length - 1;

  const card = h('div', { class: 'pu-revealcard',
    style: `background:${ui.flipped ? colorFor('a' + idx) : 'var(--card)'}`,
    onclick: advance },
    h('div', { class: 'pu-rc-face pu-rc-front', style: `opacity:${ui.flipped ? 0 : 1}` },
      h('div', { class: 'pu-flip-q' }, '?'),
      h('div', { class: 'pu-flip-tap' }, 'tap to reveal')),
    h('div', { class: 'pu-rc-face pu-rc-back', style: `opacity:${ui.flipped ? 1 : 0}` },
      a.emoji ? h('div', { class: 'pu-flip-emoji' }, icon(a.emoji, 46)) : false,
      h('div', { class: 'pu-flip-answer' }, a.text || (a.emoji ? '' : '…')),
      h('div', { class: 'pu-flip-author' }, a.isOwn ? '— you!' : '— anonymous')));

  function advance() {
    if (!ui.flipped) { ui.flipped = true; render(); return; }
    if (last) { if (state.isHost) socket.emit('start_vote'); return; }
    ui.flipped = false; ui.revealIdx = idx + 1; render();
  }

  const label = !ui.flipped ? ['Reveal ', icon('👀', 18)]
    : last ? [state.isHost ? 'On to voting →' : 'Waiting for the host…']
    : ['Next answer →'];
  const btn = h('button', {
    class: 'pu-btn pu-btn-coral pu-btn-block pu-cta',
    onclick: advance,
    disabled: ui.flipped && last && !state.isHost,
  }, label);

  mount(h('div', { class: 'pu-screen pu-screen-center' },
    topbar(),
    h('div', { class: 'pu-reveal-head' },
      h('div', { class: 'pu-lbl' }, `the answers · ${idx + 1}/${answers.length}`),
      h('div', { class: 'pu-dots' }, answers.map((_, i) =>
        h('span', { class: 'pu-dot' + (i <= idx ? ' on' : '') })))),
    card,
    btn));
}

function screenVote() {
  const r = state.round;
  const answers = r.answers || [];

  if (r.youVoted) {
    const kids = [
      topbar(),
      h('div', { class: 'pu-megaemoji pu-bob' }, icon('🗳️', 64)),
      h('h2', { class: 'pu-h2 pu-center' }, `${r.votedCount} of ${state.players.length} voted`),
      h('p', { class: 'pu-sub-2 pu-center' }, 'Vote locked. Sit tight…'),
    ];
    kids.push(state.isHost
      ? h('button', { class: 'pu-btn pu-btn-mint pu-btn-block pu-cta', onclick: () => socket.emit('show_scores') },
          `Show scores → (${r.votedCount}/${state.players.length})`)
      : waitNote('Waiting for the host to reveal scores…'));
    return mount(h('div', { class: 'pu-screen pu-screen-center' }, kids));
  }

  const cards = answers.map((a) => {
    const sel = ui.vote === a.answerId;
    const card = h('button', {
      class: 'pu-vote-card' + (sel ? ' sel' : '') + (a.isOwn ? ' own' : ''),
      disabled: a.isOwn,
      onclick: () => { if (a.isOwn) return; ui.vote = a.answerId; render(); },
    },
      h('div', { class: 'pu-vote-top' },
        h('span', { class: 'pu-vote-name' }, a.isOwn ? 'your answer' : 'anonymous'),
        sel ? h('span', { class: 'pu-vote-check' }, '✓') : false,
        a.isOwn ? h('span', { class: 'pu-vote-own-tag' }, 'no self-votes') : false),
      h('div', { class: 'pu-vote-text' },
        a.emoji ? h('span', { class: 'pu-vote-emoji' }, icon(a.emoji, 20)) : false,
        a.text || (a.emoji ? '' : '…')));
    return card;
  });

  const cast = h('button', {
    class: 'pu-btn pu-btn-mint pu-btn-block pu-cta',
    disabled: !ui.vote,
    onclick: () => socket.emit('cast_vote', { answerPlayerId: ui.vote }),
  }, ui.vote ? ['Lock in my vote ', icon('🗳️', 18)] : ['Pick one to vote']);

  mount(h('div', { class: 'pu-screen' },
    topbar(),
    h('h2', { class: 'pu-h2' }, 'Vote the funniest'),
    h('p', { class: 'pu-sub-2' }, "One vote. Can't pick your own (nice try)."),
    h('div', { class: 'pu-vote-list' }, cards),
    cast));
}

function screenScore() {
  const answers = (state.round && state.round.answers) || [];
  const points = (state.results && state.results.points) || {};
  const ranked = [...answers].sort((a, b) => b.votes - a.votes);
  const winner = ranked[0];

  const kids = [topbar()];

  if (winner) {
    const byParts = winner.isOwn
      ? [winner.name + ' ', icon('🎉', 16), ` · ${winner.votes} vote${winner.votes === 1 ? '' : 's'}`]
      : [`${winner.name} · ${winner.votes} vote${winner.votes === 1 ? '' : 's'}`];
    kids.push(h('div', { class: 'pu-winner-wrap' },
      h('div', { class: 'pu-winner-crown' }, icon('👑', 42)),
      h('div', { class: 'pu-lbl pu-center' }, 'Top of the Pile'),
      h('div', { class: 'pu-card pu-winner-card', style: `background:${colorFor(winner.name)}` },
        h('div', { class: 'pu-winner-answer' },
          winner.emoji ? h('span', { class: 'pu-vote-emoji' }, icon(winner.emoji, 22)) : false,
          winner.text || (winner.emoji ? '' : '…')),
        h('div', { class: 'pu-winner-by' }, byParts))));
  }

  kids.push(h('div', { class: 'pu-section-lbl' }, 'This round'),
    h('div', { class: 'pu-roundlist' }, ranked.map((a, i) => {
      const rt = rankTitle(i, ranked.length);
      return h('div', { class: 'pu-round-row' },
        h('span', { class: 'pu-round-rank' }, icon(rt.emoji, 15), ' ', rt.label),
        h('span', { class: 'pu-round-name' }, a.isOwn ? 'you' : a.name),
        h('span', { class: 'pu-round-pts' }, `+${points[a.playerId] || 0}`));
    })));

  const totals = [...state.players].sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉'];
  kids.push(h('div', { class: 'pu-section-lbl' }, icon('🏅', 14), ' Pile Points · all-time'),
    h('div', { class: 'pu-leaderboard' }, totals.map((p, i) =>
      h('div', { class: 'pu-lb-row' + (i === 0 ? ' lead' : '') },
        h('span', { class: 'pu-lb-medal' }, medals[i] ? icon(medals[i], 18) : `#${i + 1}`),
        h('span', { class: 'pu-lb-name' }, p.id === state.you ? `${p.name} (you)` : p.name),
        h('span', { class: 'pu-lb-pts' }, p.score.toLocaleString())))));

  if (state.isHost) {
    kids.push(h('div', { class: 'pu-section-lbl' }, 'Next question'),
      ...picker('Lock next question →'),
      h('button', { class: 'pu-btn pu-btn-ghost pu-btn-block', onclick: () => socket.emit('next_round') }, 'Back to lobby'));
  } else {
    kids.push(waitNote('Waiting for the host to start the next round…'));
  }
  mount(h('div', { class: 'pu-screen' }, kids));
}

// ── confetti (lightweight, no CDN) ──
function fireConfetti() {
  const layer = h('div', { style: 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden' });
  document.body.appendChild(layer);
  for (let i = 0; i < 90; i++) {
    const size = 7 + Math.random() * 9;
    const rot = Math.random() * 360;
    const p = h('div', { style:
      `position:absolute;top:-20px;left:${Math.random() * 100}vw;width:${size}px;height:${size * (0.5 + Math.random())}px;` +
      `background:${PALETTE[i % PALETTE.length]};border:1.5px solid #241A12;` +
      `border-radius:${Math.random() > 0.5 ? '50%' : '2px'};transform:rotate(${rot}deg);opacity:0;` });
    layer.appendChild(p);
    p.animate(
      [{ transform: `translateY(0) rotate(${rot}deg)`, opacity: 1 },
       { transform: `translateY(105vh) rotate(${rot + 360 + Math.random() * 360}deg)`, opacity: 1 }],
      { duration: 1400 + Math.random() * 1200, delay: Math.random() * 250, easing: 'cubic-bezier(.3,.6,.5,1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), 3200);
}

// ── render dispatch ──
function render() {
  if (!state) return;
  // Reset transient UI when the phase changes so stale composer/vote/reveal
  // state doesn't leak across phases.
  if (state.phase !== lastPhase) {
    if (state.phase === 'write') { ui.writeText = ''; ui.writeAccent = null; }
    if (state.phase === 'reveal') { ui.revealIdx = 0; ui.flipped = false; }
    if (state.phase === 'vote') { ui.vote = null; }
    if (state.phase === 'lobby' || state.phase === 'score') { ui.pickId = null; ui.category = 'all'; ui.custom = ''; }
    if (state.phase === 'score') fireConfetti();
    lastPhase = state.phase;
  }
  ({ lobby: screenLobby, write: screenWrite, reveal: screenReveal,
     vote: screenVote, score: screenScore }[state.phase] || screenLobby)();
}
