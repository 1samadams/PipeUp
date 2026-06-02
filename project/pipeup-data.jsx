/* ============================================================
   PIPE UP — demo data + helpers
   Mock multiplayer: "you" + bots. Real app would sync over a
   session URL (see SPEC note in Pipe Up.html).
   ============================================================ */

// ---- prompt deck -------------------------------------------------
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

// ---- the bots (you join as the 5th player) -----------------------
const BOTS = [
  { id: "b1", name: "Dev",   emoji: "😎" },
  { id: "b2", name: "Sam",   emoji: "🫠" },
  { id: "b3", name: "Priya", emoji: "🔥" },
  { id: "b4", name: "Marco", emoji: "🤡" },
];

// canned bot answers keyed loosely by prompt index; falls back to GENERIC
const BOT_ANSWERS = {
  0: [
    "I can name every Friends episode but forget my own phone number.",
    "Folding a fitted sheet. Took me 31 years.",
    "I can guess the runtime of a movie within 2 minutes. Useless. Reliable.",
    "Making the printer jam by simply walking past it.",
  ],
  1: [
    "I make the computer say yes to the other computers.",
    "I move boxes on a screen until a grown-up says good job.",
    "I yell at spreadsheets and sometimes they listen.",
    "I send emails that say 'circling back' for money.",
  ],
  2: [
    "A hot dog is a taco. I will not be elaborating.",
    "Replying-all should be a fireable offense.",
    "The office plant has feelings and we ignore them.",
    "Cereal is a soup. Cold soup. Breakfast soup.",
  ],
  generic: [
    "I'm choosing to keep this one a mystery 🤐",
    "Pass. But emotionally.",
    "Whatever Dev said but funnier.",
    "Drawing a blank, posting anyway.",
    "Ask me after coffee ☕",
  ],
};

function botAnswerFor(promptIndex, botIndex) {
  const bank = BOT_ANSWERS[promptIndex] || BOT_ANSWERS.generic;
  return bank[botIndex % bank.length];
}

// ---- helpers -----------------------------------------------------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const PALETTES = {
  Original: ["#FF5A36", "#1FB8A6", "#FFC53D", "#9B5DE5"],
  Bubblegum: ["#FF4D9D", "#3A86FF", "#FFD23F", "#22C55E"],
  Sunset:    ["#F94144", "#F3722C", "#F9C74F", "#43AA8B"],
};

// stable per-name color from a palette
function colorFor(name, palette) {
  const p = palette || PALETTES.Original;
  const sum = [...(name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0);
  return p[sum % p.length];
}

const initialOf = (name) => (name || "?").trim().charAt(0).toUpperCase() || "?";

// silly rank titles based on standing
const RANK_TITLES = [
  "🏆 Top of the Pile",
  "🥈 Comedy Silver",
  "🥉 Reliably Funny",
  "📈 Solid Mid",
  "🦗 Crickets, Respectfully",
];
function rankTitle(rank, total) {
  if (rank === 0) return RANK_TITLES[0];
  if (rank === total - 1 && total > 2) return RANK_TITLES[4];
  return RANK_TITLES[Math.min(rank, RANK_TITLES.length - 2)];
}

// ---- lightweight confetti ---------------------------------------
function fireConfetti(colors) {
  const C = colors || PALETTES.Original;
  const layer = document.createElement("div");
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden";
  document.body.appendChild(layer);
  const N = 90;
  for (let i = 0; i < N; i++) {
    const p = document.createElement("div");
    const size = 7 + Math.random() * 9;
    const left = Math.random() * 100;
    const rot = Math.random() * 360;
    const dur = 1400 + Math.random() * 1200;
    const delay = Math.random() * 250;
    p.style.cssText = `position:absolute;top:-20px;left:${left}vw;width:${size}px;height:${
      size * (0.5 + Math.random())
    }px;background:${C[i % C.length]};border:1.5px solid #241A12;border-radius:${
      Math.random() > 0.5 ? "50%" : "2px"
    };transform:rotate(${rot}deg);opacity:0;`;
    layer.appendChild(p);
    p.animate(
      [
        { transform: `translateY(0) rotate(${rot}deg)`, opacity: 1 },
        {
          transform: `translateY(105vh) rotate(${rot + 360 + Math.random() * 360}deg)`,
          opacity: 1,
        },
      ],
      { duration: dur, delay, easing: "cubic-bezier(.3,.6,.5,1)", fill: "forwards" }
    );
  }
  setTimeout(() => layer.remove(), 3200);
}

Object.assign(window, {
  PROMPTS, BOTS, BOT_ANSWERS, botAnswerFor,
  uid, PALETTES, colorFor, initialOf, RANK_TITLES, rankTitle, fireConfetti,
});
