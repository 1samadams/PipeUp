/* Pipe Up — Socket client + render-from-state.
 *
 * The server is the source of truth: it broadcasts the full (redacted) room
 * state on every change and this file just draws it. Local-only UI state (the
 * composer text, the reveal stepper, a pending vote) lives in `ui` and survives
 * re-renders. Game decisions are never made here. */

// ── static content (the question deck + accent emoji, lifted from the design) ──
const PROMPTS = [
  "What's the most useless talent you have?",
  "Describe your job to a 5-year-old, badly.",
  "What's a hill you'll die on at work?",
  "Most chaotic thing in your camera roll right now?",
  "If our team was a snack, what snack are we?",
  "Worst advice you've ever given with full confidence?",
  "What would your villain origin story be?",
  "Pitch a terrible app idea in one line.",
];
const ACCENTS = ["😂", "🔥", "💯", "🤔", "🫠", "😎", "🎯", "🤡"];
const PALETTE = ["#FF5A36", "#1FB8A6", "#FFC53D", "#9B5DE5"];
const RANK_TITLES = [
  "🏆 Top of the Pile", "🥈 Comedy Silver", "🥉 Reliably Funny",
  "📈 Solid Mid", "🦗 Crickets",
];

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
             vote: null, pickIdx: 0, custom: '' };
let lastPhase = null;
let state = null;

// ── socket ──
const socket = io();
const rawCode = decodeURIComponent(location.pathname.split('/r/')[1] || '').toUpperCase();
let mode = (sessionStorage.getItem('pu_intent') === 'create' && rawCode === '_NEW') ? 'create' : 'join';
let code = rawCode === '_NEW' ? null : rawCode;

function enter() {
  if (mode === 'create') {
    socket.emit('create_room', { clientId: CID, name: getName() });
  } else if (code && getName()) {
    socket.emit('join_room', { clientId: CID, name: getName(), code });
  } else {
    renderNameGate();
  }
}
socket.on('connect', enter);
socket.on('room_state', (s) => {
  if (!code) { code = s.code; history.replaceState(null, '', '/r/' + code); }
  mode = 'join'; // after the first state we always rejoin (never re-create) on reconnect
  state = s;
  render();
});
socket.on('error', (e) => toast(e && e.message ? e.message : 'Something went wrong.'));

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

// ── the question picker (shared by lobby + scoreboard, host only) ──
function picker(lockLabel) {
  const customInput = h('input', { class: 'pu-input pu-input-lg', placeholder: 'Ask the team something…',
    maxlength: 120, value: ui.custom });
  customInput.addEventListener('input', () => { ui.custom = customInput.value; paintOpts(); });

  const opts = PROMPTS.slice(0, 6).map((p, i) =>
    h('button', { class: 'pu-prompt-opt', onclick: () => { ui.pickIdx = i; ui.custom = ''; customInput.value = ''; paintOpts(); } }, p));
  function paintOpts() {
    opts.forEach((b, i) => b.className = 'pu-prompt-opt' + (i === ui.pickIdx && !ui.custom ? ' on' : ''));
  }
  paintOpts();

  const shuffle = h('button', { class: 'pu-btn pu-btn-ghost pu-btn-sm',
    onclick: () => { ui.pickIdx = Math.floor(Math.random() * 6); ui.custom = ''; customInput.value = ''; paintOpts(); } }, '🎲 Shuffle');

  const lock = h('button', { class: 'pu-btn pu-btn-coral pu-btn-block pu-cta',
    onclick: () => {
      const text = ui.custom.trim() || PROMPTS[ui.pickIdx];
      socket.emit('set_question', { text });
    } }, lockLabel);

  return [
    h('div', { class: 'pu-prompt-list' }, opts),
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
      copy.textContent = 'Copied! Send it 📲';
      setTimeout(() => (copy.textContent = 'Copy invite link'), 1600);
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

    const accents = ACCENTS.map((em) => h('button', {
      class: 'pu-accent' + (ui.writeAccent === em ? ' on' : ''),
      onclick: (e) => {
        ui.writeAccent = ui.writeAccent === em ? null : em;
        [...e.currentTarget.parentNode.children].forEach((b) =>
          b.className = 'pu-accent' + (b.textContent === ui.writeAccent ? ' on' : ''));
      } }, em));

    const submit = h('button', { class: 'pu-btn pu-btn-mint pu-btn-block pu-cta',
      onclick: () => {
        if (!ui.writeText.trim() && !ui.writeAccent) { toast('Write something first.'); return; }
        socket.emit('submit_answer', { text: ui.writeText.trim(), emoji: ui.writeAccent });
      } }, 'Lock it in 🔒');

    kids.push(
      h('div', { class: 'pu-card pu-composer' }, ta, h('div', { class: 'pu-accentrow' }, accents), count),
      submit,
      h('p', { class: 'pu-hint pu-center' }, 'No takebacks. Make it count.'));
  } else {
    const done = new Set(r.answeredIds);
    kids.push(
      h('h2', { class: 'pu-h2 pu-center' }, `${r.answerCount} of ${state.players.length} piped up`),
      h('p', { class: 'pu-sub-2 pu-center' }, 'Locked in. Waiting on the slow typers 👀'),
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
      h('h2', { class: 'pu-h2 pu-center' }, 'No answers this round 🦗'),
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
      a.emoji ? h('div', { class: 'pu-flip-emoji' }, a.emoji) : false,
      h('div', { class: 'pu-flip-answer' }, a.text || a.emoji || '…'),
      h('div', { class: 'pu-flip-author' }, a.isOwn ? '— you!' : '— anonymous')));

  function advance() {
    if (!ui.flipped) { ui.flipped = true; render(); return; }
    if (last) { if (state.isHost) socket.emit('start_vote'); return; }
    ui.flipped = false; ui.revealIdx = idx + 1; render();
  }

  const label = !ui.flipped ? 'Reveal 👀'
    : last ? (state.isHost ? 'On to voting →' : 'Waiting for the host…')
    : 'Next answer →';
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
      h('div', { class: 'pu-megaemoji pu-bob' }, '🗳️'),
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
        a.emoji ? h('span', { class: 'pu-vote-emoji' }, a.emoji) : false,
        a.text || a.emoji || '…'));
    return card;
  });

  const cast = h('button', {
    class: 'pu-btn pu-btn-mint pu-btn-block pu-cta',
    disabled: !ui.vote,
    onclick: () => socket.emit('cast_vote', { answerPlayerId: ui.vote }),
  }, ui.vote ? 'Lock in my vote 🗳️' : 'Pick one to vote');

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
    kids.push(h('div', { class: 'pu-winner-wrap' },
      h('div', { class: 'pu-winner-crown' }, '👑'),
      h('div', { class: 'pu-lbl pu-center' }, 'Top of the Pile'),
      h('div', { class: 'pu-card pu-winner-card', style: `background:${colorFor(winner.name)}` },
        h('div', { class: 'pu-winner-answer' },
          winner.emoji ? h('span', { class: 'pu-vote-emoji' }, winner.emoji) : false,
          winner.text || winner.emoji || '…'),
        h('div', { class: 'pu-winner-by' },
          `${winner.isOwn ? winner.name + ' 🎉' : winner.name} · ${winner.votes} vote${winner.votes === 1 ? '' : 's'}`))));
  }

  kids.push(h('div', { class: 'pu-section-lbl' }, 'This round'),
    h('div', { class: 'pu-roundlist' }, ranked.map((a, i) =>
      h('div', { class: 'pu-round-row' },
        h('span', { class: 'pu-round-rank' }, rankTitle(i, ranked.length)),
        h('span', { class: 'pu-round-name' }, a.isOwn ? 'you' : a.name),
        h('span', { class: 'pu-round-pts' }, `+${points[a.playerId] || 0}`)))));

  const totals = [...state.players].sort((a, b) => b.score - a.score);
  kids.push(h('div', { class: 'pu-section-lbl' }, '🏅 Pile Points · all-time'),
    h('div', { class: 'pu-leaderboard' }, totals.map((p, i) =>
      h('div', { class: 'pu-lb-row' + (i === 0 ? ' lead' : '') },
        h('span', { class: 'pu-lb-medal' }, ['🥇', '🥈', '🥉'][i] || `#${i + 1}`),
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
    if (state.phase === 'lobby' || state.phase === 'score') { ui.pickIdx = 0; ui.custom = ''; }
    if (state.phase === 'score') fireConfetti();
    lastPhase = state.phase;
  }
  ({ lobby: screenLobby, write: screenWrite, reveal: screenReveal,
     vote: screenVote, score: screenScore }[state.phase] || screenLobby)();
}
