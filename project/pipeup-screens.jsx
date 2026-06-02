/* ============================================================
   PIPE UP — phase screens
   Each screen receives the game object `g` + action callbacks.
   ============================================================ */
const { useState, useEffect, useRef } = React;

/* ---------- shared bits ---------- */

function Avatar({ name, palette, size = 34 }) {
  return (
    <div
      className="pu-avatar"
      style={{
        width: size, height: size, fontSize: size * 0.42,
        background: colorFor(name, palette),
      }}
    >
      {initialOf(name)}
    </div>
  );
}

function TopBar({ g }) {
  return (
    <div className="pu-topbar">
      <div className="pu-room">
        <span className="pu-room-dot" />
        PILE · {g.roomCode}
      </div>
      <div className="pu-round">Round {g.round}</div>
    </div>
  );
}

/* ---------- 1. LOBBY ---------- */

function Lobby({ g, actions }) {
  const [copied, setCopied] = useState(false);
  const players = [{ name: g.name || "you", isYou: true }, ...BOTS];

  const copyLink = () => {
    const url = `pipeup.live/${g.roomCode}`;
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="pu-screen">
      <TopBar g={g} />
      <div className="pu-logo">PIPE<span> UP</span></div>
      <p className="pu-sub">one question · everyone answers · loudest laugh wins</p>

      <div className="pu-card pu-share">
        <div className="pu-lbl">share this room</div>
        <div className="pu-link">pipeup.live/{g.roomCode}</div>
        <button className="pu-btn pu-btn-coral pu-btn-block" onClick={copyLink}>
          {copied ? "Copied! send it 📲" : "Copy invite link"}
        </button>
        <div className="pu-hint">No login. No app. Just open the link.</div>
      </div>

      <div className="pu-section-lbl">In the room · {players.length}</div>
      <div className="pu-players">
        {players.map((p, i) => (
          <div className="pu-player-chip" key={i}>
            <Avatar name={p.name} palette={g.palette} size={28} />
            <span>{p.isYou ? (g.name || "you") + " (you)" : p.name}</span>
          </div>
        ))}
      </div>

      <div className="pu-card pu-namecard">
        <div className="pu-lbl">you're playing as</div>
        <input
          className="pu-input"
          placeholder="type your name"
          maxLength={18}
          value={g.name}
          onChange={(e) => actions.setName(e.target.value)}
        />
      </div>

      <button className="pu-btn pu-btn-mint pu-btn-block pu-cta" onClick={actions.toPrompt}>
        Start the round →
      </button>
    </div>
  );
}

/* ---------- 2. PICK PROMPT ---------- */

function PickPrompt({ g, actions }) {
  const [custom, setCustom] = useState("");
  const [picked, setPicked] = useState(g.promptIndex ?? 0);
  const shuffle = () => setPicked(Math.floor(Math.random() * PROMPTS.length));

  const go = () => {
    const text = custom.trim() || PROMPTS[picked];
    actions.startWriting(text);
  };

  return (
    <div className="pu-screen">
      <TopBar g={g} />
      <h2 className="pu-h2">Pick the question</h2>
      <p className="pu-sub-2">Everyone answers this one. Choose wisely 😏</p>

      <div className="pu-prompt-list">
        {PROMPTS.slice(0, 6).map((p, i) => (
          <button
            key={i}
            className={"pu-prompt-opt" + (i === picked && !custom ? " on" : "")}
            onClick={() => { setPicked(i); setCustom(""); }}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="pu-row pu-row-gap">
        <button className="pu-btn pu-btn-ghost pu-btn-sm" onClick={shuffle}>🎲 Shuffle</button>
        <span className="pu-or">or write your own</span>
      </div>
      <input
        className="pu-input pu-input-lg"
        placeholder="Ask the team something…"
        maxLength={120}
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
      />

      <button className="pu-btn pu-btn-coral pu-btn-block pu-cta" onClick={go}>
        Lock the question →
      </button>
    </div>
  );
}

/* ---------- 3. WRITE ---------- */

const ACCENTS = ["😂", "🔥", "💯", "🤔", "🫠", "😎", "🎯", "🤡"];

function Write({ g, actions }) {
  const [text, setText] = useState("");
  const [accent, setAccent] = useState(null);

  const submit = () => {
    if (!text.trim() && !accent) return;
    actions.submitAnswer(text.trim(), accent);
  };

  return (
    <div className="pu-screen">
      <TopBar g={g} />
      <div className="pu-prompt-banner">
        <div className="pu-lbl">the question</div>
        <div className="pu-prompt-text">{g.promptText}</div>
      </div>

      <div className="pu-card pu-composer">
        <textarea
          className="pu-textarea"
          placeholder="Pipe up… what's your answer?"
          maxLength={180}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="pu-accentrow">
          {ACCENTS.map((em) => (
            <button
              key={em}
              className={"pu-accent" + (accent === em ? " on" : "")}
              onClick={() => setAccent(accent === em ? null : em)}
            >
              {em}
            </button>
          ))}
        </div>
        <div className="pu-charcount">{text.length}/180</div>
      </div>

      <button
        className="pu-btn pu-btn-mint pu-btn-block pu-cta"
        onClick={submit}
      >
        Lock it in 🔒
      </button>
      <p className="pu-hint pu-center">No takebacks. Make it count.</p>
    </div>
  );
}

/* ---------- 4. WAITING ---------- */

function Waiting({ g, actions }) {
  // bots "arrive" one by one
  const players = [{ name: g.name || "you", isYou: true, done: true }, ...BOTS.map((b) => ({ ...b }))];
  const [doneCount, setDoneCount] = useState(1);

  useEffect(() => {
    if (doneCount >= players.length) {
      const t = setTimeout(() => actions.toReveal(), 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDoneCount((c) => c + 1), 700 + Math.random() * 700);
    return () => clearTimeout(t);
  }, [doneCount]);

  const allIn = doneCount >= players.length;

  return (
    <div className="pu-screen pu-screen-center">
      <TopBar g={g} />
      <div className="pu-megaemoji pu-bob">🎺</div>
      <h2 className="pu-h2 pu-center">
        {allIn ? "Everyone's in!" : `${doneCount} of ${players.length} piped up`}
      </h2>
      <p className="pu-sub-2 pu-center">
        {allIn ? "Get ready to laugh…" : "Waiting on the slow typers 👀"}
      </p>

      <div className="pu-waitlist">
        {players.map((p, i) => {
          const done = i < doneCount;
          return (
            <div className={"pu-wait-chip" + (done ? " done" : "")} key={i}>
              <Avatar name={p.name} palette={g.palette} size={26} />
              <span>{p.isYou ? (g.name || "you") + " (you)" : p.name}</span>
              <span className="pu-wait-status">{done ? "✓ locked in" : "typing…"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- 5. REVEAL ---------- */

function Reveal({ g, actions }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const last = idx >= g.answers.length - 1;
  const a = g.answers[idx];
  if (!a) return null;

  const next = () => {
    if (!flipped) { setFlipped(true); return; }
    if (last) { actions.toVote(); return; }
    setFlipped(false);
    setTimeout(
      () => setIdx((i) => Math.min(i + 1, g.answers.length - 1)),
      g.revealSpeed === "fast" ? 80 : 220
    );
  };

  return (
    <div className="pu-screen pu-screen-center">
      <TopBar g={g} />
      <div className="pu-reveal-head">
        <div className="pu-lbl">the answers · {idx + 1}/{g.answers.length}</div>
        <div className="pu-dots">
          {g.answers.map((_, i) => (
            <span key={i} className={"pu-dot" + (i <= idx ? " on" : "")} />
          ))}
        </div>
      </div>

      <div
        className="pu-revealcard"
        onClick={next}
        style={{ background: flipped ? colorFor(a.name, g.palette) : "var(--card)" }}
      >
        <div className="pu-rc-face pu-rc-front" style={{ opacity: flipped ? 0 : 1 }}>
          <div className="pu-flip-q">?</div>
          <div className="pu-flip-tap">tap to reveal</div>
        </div>
        <div className="pu-rc-face pu-rc-back" style={{ opacity: flipped ? 1 : 0 }}>
          {a.emoji && <div className="pu-flip-emoji">{a.emoji}</div>}
          <div className="pu-flip-answer">{a.text || a.emoji}</div>
          <div className="pu-flip-author">
            — {a.isYou ? (g.name || "you") + " (you!)" : a.name}
          </div>
        </div>
      </div>

      <button className="pu-btn pu-btn-coral pu-btn-block pu-cta" onClick={next}>
        {!flipped ? "Reveal 👀" : last ? "On to voting →" : "Next answer →"}
      </button>
    </div>
  );
}

/* ---------- 6. VOTE ---------- */

function Vote({ g, actions }) {
  const [choice, setChoice] = useState(null);
  const votable = g.answers.filter((a) => !a.isYou);

  return (
    <div className="pu-screen">
      <TopBar g={g} />
      <h2 className="pu-h2">Vote the funniest</h2>
      <p className="pu-sub-2">One vote. Can't pick your own (nice try).</p>

      <div className="pu-vote-list">
        {g.answers.map((a) => {
          const isOwn = a.isYou;
          const sel = choice === a.id;
          return (
            <button
              key={a.id}
              disabled={isOwn}
              className={"pu-vote-card" + (sel ? " sel" : "") + (isOwn ? " own" : "")}
              onClick={() => !isOwn && setChoice(a.id)}
            >
              <div className="pu-vote-top">
                <Avatar name={a.name} palette={g.palette} size={26} />
                <span className="pu-vote-name">
                  {isOwn ? (g.name || "you") + " (you)" : a.name}
                </span>
                {sel && <span className="pu-vote-check">✓</span>}
                {isOwn && <span className="pu-vote-own-tag">your answer</span>}
              </div>
              <div className="pu-vote-text">
                {a.emoji && <span className="pu-vote-emoji">{a.emoji}</span>}
                {a.text || a.emoji}
              </div>
            </button>
          );
        })}
      </div>

      <button
        className="pu-btn pu-btn-mint pu-btn-block pu-cta"
        disabled={!choice}
        onClick={() => actions.castVote(choice)}
      >
        {choice ? "Lock in my vote 🗳️" : "Pick one to vote"}
      </button>
    </div>
  );
}

/* ---------- 7. SCOREBOARD ---------- */

function Scoreboard({ g, actions }) {
  useEffect(() => {
    if (g.motion) fireConfetti(g.palette);
  }, []);

  // rank this round's answers by votes
  const ranked = [...g.answers].sort((a, b) => b.votes - a.votes);
  const winner = ranked[0];

  // running totals (sorted desc)
  const totals = Object.entries(g.scores)
    .map(([name, pts]) => ({ name, pts }))
    .sort((a, b) => b.pts - a.pts);

  return (
    <div className="pu-screen">
      <TopBar g={g} />
      <div className="pu-winner-wrap">
        <div className="pu-winner-crown">👑</div>
        <div className="pu-lbl pu-center">Top of the Pile</div>
        <div className="pu-card pu-winner-card" style={{ background: colorFor(winner.name, g.palette) }}>
          <div className="pu-winner-answer">
            {winner.emoji && <span className="pu-vote-emoji">{winner.emoji}</span>}
            {winner.text || winner.emoji}
          </div>
          <div className="pu-winner-by">
            {winner.isYou ? (g.name || "you") + " 🎉" : winner.name} · {winner.votes} vote{winner.votes === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="pu-section-lbl">This round</div>
      <div className="pu-roundlist">
        {ranked.map((a, i) => (
          <div className="pu-round-row" key={a.id}>
            <span className="pu-round-rank">{rankTitle(i, ranked.length)}</span>
            <span className="pu-round-name">{a.isYou ? "you" : a.name}</span>
            <span className="pu-round-pts">+{a.votes * 100 + (i === 0 ? 250 : 0)}</span>
          </div>
        ))}
      </div>

      <div className="pu-section-lbl">🏅 Pile Points · all-time</div>
      <div className="pu-leaderboard">
        {totals.map((t, i) => (
          <div className={"pu-lb-row" + (i === 0 ? " lead" : "")} key={t.name}>
            <span className="pu-lb-medal">{["🥇", "🥈", "🥉"][i] || `#${i + 1}`}</span>
            <span className="pu-lb-name">{t.name === (g.name || "you") ? t.name + " (you)" : t.name}</span>
            <span className="pu-lb-pts">{t.pts.toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="pu-row pu-row-gap pu-cta">
        <button className="pu-btn pu-btn-ghost pu-btn-block" onClick={actions.newQuestion}>
          New question
        </button>
        <button className="pu-btn pu-btn-coral pu-btn-block" onClick={actions.nextRound}>
          Next round →
        </button>
      </div>
    </div>
  );
}

Object.assign(window, {
  Avatar, TopBar, Lobby, PickPrompt, Write, Waiting, Reveal, Vote, Scoreboard,
});
