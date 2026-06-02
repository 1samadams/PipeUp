/* ============================================================
   PIPE UP — app shell, game-loop state machine, scoring
   ============================================================ */

const PHASES = ["lobby", "prompt", "write", "waiting", "reveal", "vote", "scoreboard"];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "Original",
  "motion": true,
  "revealSpeed": "normal",
  "dotgrid": true
}/*EDITMODE-END*/;

function makeRoomCode() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const palette = PALETTES[t.palette] || PALETTES.Original;

  const [phase, setPhase] = useState("lobby");
  const [name, setName] = useState("");
  const [roomCode] = useState(makeRoomCode());
  const [round, setRound] = useState(1);
  const [promptIndex, setPromptIndex] = useState(0);
  const [promptText, setPromptText] = useState("");
  const [answers, setAnswers] = useState([]);
  const [yourAnswerId, setYourAnswerId] = useState(null);
  const [scores, setScores] = useState(null); // {name: pts}

  const youName = () => name.trim() || "you";

  // init running scores once we know everyone
  function ensureScores() {
    if (scores) return scores;
    const init = { [youName()]: 0 };
    BOTS.forEach((b) => (init[b.name] = 0));
    setScores(init);
    return init;
  }

  // build the full answer set: you + bots
  function buildAnswers(text, accent) {
    const yours = { id: uid(), name: youName(), isYou: true, text, emoji: accent, votes: 0 };
    const bots = BOTS.map((b, i) => ({
      id: uid(),
      name: b.name,
      isYou: false,
      text: botAnswerFor(promptIndex, i),
      emoji: Math.random() > 0.5 ? b.emoji : null,
      votes: 0,
    }));
    // shuffle so your card isn't always first in the reveal
    const all = [yours, ...bots].sort(() => Math.random() - 0.5);
    return { all, yoursId: yours.id };
  }

  // bots cast votes (random, never self) + record the player's vote, then score
  function finalizeVotes(playerChoiceId) {
    const tallied = answers.map((a) => ({ ...a, votes: 0 }));
    const byId = Object.fromEntries(tallied.map((a) => [a.id, a]));

    // player's vote
    if (byId[playerChoiceId]) byId[playerChoiceId].votes++;

    // each bot votes for someone other than themselves
    BOTS.forEach((b) => {
      const options = tallied.filter((a) => a.name !== b.name);
      const pick = options[Math.floor(Math.random() * options.length)];
      if (pick) byId[pick.id].votes++;
    });

    const ranked = [...tallied].sort((a, b) => b.votes - a.votes);
    const winnerId = ranked[0].id;

    // award points into running totals
    const base = ensureScores();
    const next = { ...base };
    tallied.forEach((a) => {
      const pts = a.votes * 100 + (a.id === winnerId ? 250 : 0);
      next[a.name] = (next[a.name] || 0) + pts;
    });
    setScores(next);
    setAnswers(tallied);
  }

  const actions = {
    setName,
    toPrompt: () => { ensureScores(); setPhase("prompt"); },
    startWriting: (text) => {
      const idx = PROMPTS.indexOf(text);
      setPromptIndex(idx >= 0 ? idx : 0);
      setPromptText(text);
      setPhase("write");
    },
    submitAnswer: (text, accent) => {
      const { all, yoursId } = buildAnswers(text, accent);
      setAnswers(all);
      setYourAnswerId(yoursId);
      setPhase("waiting");
    },
    toReveal: () => setPhase("reveal"),
    toVote: () => setPhase("vote"),
    castVote: (choiceId) => { finalizeVotes(choiceId); setPhase("scoreboard"); },
    newQuestion: () => { setRound((r) => r + 1); setAnswers([]); setPhase("prompt"); },
    nextRound: () => {
      setRound((r) => r + 1);
      const idx = Math.floor(Math.random() * PROMPTS.length);
      setPromptIndex(idx);
      setPromptText(PROMPTS[idx]);
      setAnswers([]);
      setPhase("write");
    },
  };

  const g = {
    phase, name, roomCode, round, promptIndex, promptText,
    answers, yourAnswerId, scores: scores || {},
    palette, motion: t.motion, revealSpeed: t.revealSpeed,
  };

  const Screen = {
    lobby: Lobby, prompt: PickPrompt, write: Write, waiting: Waiting,
    reveal: Reveal, vote: Vote, scoreboard: Scoreboard,
  }[phase];

  // map tweak palette → CSS theme vars on the frame
  const themeVars = {
    "--coral": palette[0],
    "--mint": palette[1],
    "--sun": palette[2],
  };

  return (
    <div className="pu-stage">
      <div
        className={"pu-phone" + (t.dotgrid ? " dotgrid" : "")}
        style={themeVars}
      >
        <div className="pu-notch" />
        <div className="pu-phone-scroll" key={phase}>
          <Screen g={g} actions={actions} />
        </div>
      </div>

      <TweaksPanel>
        <TweakSection label="Look" />
        <TweakRadio
          label="Palette" value={t.palette}
          options={["Original", "Bubblegum", "Sunset"]}
          onChange={(v) => setTweak("palette", v)}
        />
        <TweakToggle label="Dot-grid background" value={t.dotgrid}
          onChange={(v) => setTweak("dotgrid", v)} />
        <TweakSection label="Motion" />
        <TweakToggle label="Confetti + animations" value={t.motion}
          onChange={(v) => setTweak("motion", v)} />
        <TweakRadio
          label="Reveal speed" value={t.revealSpeed}
          options={["normal", "fast"]}
          onChange={(v) => setTweak("revealSpeed", v)}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
