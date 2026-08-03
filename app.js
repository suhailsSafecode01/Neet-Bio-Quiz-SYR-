// ---------- CONFIG ----------
const QUIZ_SIZE = 10;
const STORAGE_KEY = "neetBioQuiz_v1";

// ---------- SEEDED RANDOM ----------
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(array, rand) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- DATE HELPERS ----------
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateStringToDayIndex(dateStr) {
  const EPOCH = new Date("2025-01-01T00:00:00");
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((d - EPOCH) / 86400000);
}
function prettyDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function isYesterday(dateStr, refStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const y = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return y === refStr;
}

// ---------- BUILD TODAY'S QUIZ (deterministic, same for everyone) ----------
const FIXED_PERMUTATION_SEED = 90210; // constant across all users/days
const PERM = seededShuffle(QUESTION_BANK.map((_, i) => i), mulberry32(FIXED_PERMUTATION_SEED));

function buildDailyQuiz(dateStr) {
  const N = PERM.length;
  const dayIdx = dateStringToDayIndex(dateStr);
  const start = ((dayIdx * QUIZ_SIZE) % N + N) % N;
  const picked = [];
  for (let i = 0; i < QUIZ_SIZE; i++) {
    picked.push(PERM[(start + i) % N]);
  }
  const dayRand = hashSeed(dateStr + "::order");
  const ordered = seededShuffle(picked, dayRand);

  return ordered.map((qIdx, position) => {
    const original = QUESTION_BANK[qIdx];
    const optRand = hashSeed(dateStr + "::opt::" + qIdx);
    const optOrder = seededShuffle(original.options.map((_, i) => i), optRand);
    const newCorrect = optOrder.indexOf(original.correct);
    return {
      topic: original.topic,
      q: original.q,
      options: optOrder.map((i) => original.options[i]),
      correct: newCorrect,
      exp: original.exp,
    };
  });
}

// ---------- STATE ----------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { streak: 0, lastCompletedDate: null, history: {} };
  } catch (e) {
    return { streak: 0, lastCompletedDate: null, history: {} };
  }
}
function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

const TODAY = todayString();
const dailyQuiz = buildDailyQuiz(TODAY);
let state = loadState();
let current = 0;
let score = 0;
let answers = []; // { chosen, correctIdx, isCorrect }

// ---------- DOM ----------
const introScreen = document.getElementById("introScreen");
const quizScreen = document.getElementById("quizScreen");
const resultsScreen = document.getElementById("resultsScreen");
const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const reviewBtn = document.getElementById("reviewBtn");
const optionsList = document.getElementById("optionsList");
const questionText = document.getElementById("questionText");
const qIndexTag = document.getElementById("qIndexTag");
const qTopicTag = document.getElementById("qTopicTag");
const explainBox = document.getElementById("explainBox");
const progressRow = document.getElementById("progressRow");
const resultsScore = document.getElementById("resultsScore");
const resultsCopy = document.getElementById("resultsCopy");
const reviewList = document.getElementById("reviewList");
const dateStamp = document.getElementById("dateStamp");
const dayCounter = document.getElementById("dayCounter");

function initHeader() {
  dateStamp.textContent = prettyDate(TODAY);
  dayCounter.textContent = `Day ${dateStringToDayIndex(TODAY) + 1}`;
  renderStreak();
}

function renderStreak() {
  const ringsEl = document.getElementById("streakRings");
  ringsEl.innerHTML = "";
  const filled = Math.min(state.streak, 7);
  for (let i = 0; i < 7; i++) {
    const r = document.createElement("span");
    r.className = "ring" + (i < filled ? " filled" : "");
    ringsEl.appendChild(r);
  }
  document.getElementById("streakCount").textContent = `${state.streak} day${state.streak === 1 ? "" : "s"}`;
}

function buildProgressDots() {
  progressRow.innerHTML = "";
  for (let i = 0; i < dailyQuiz.length; i++) {
    const dot = document.createElement("div");
    dot.className = "progress-dot";
    progressRow.appendChild(dot);
  }
}
function updateProgressDots() {
  const dots = progressRow.children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].className = "progress-dot" + (i < current ? " done" : i === current ? " current" : "");
  }
}

function showScreen(name) {
  introScreen.classList.toggle("hidden", name !== "intro");
  quizScreen.classList.toggle("hidden", name !== "quiz");
  resultsScreen.classList.toggle("hidden", name !== "results");
}

function renderQuestion() {
  const item = dailyQuiz[current];
  updateProgressDots();
  qIndexTag.textContent = `Q ${String(current + 1).padStart(2, "0")}/${dailyQuiz.length}`;
  qTopicTag.textContent = item.topic;
  questionText.textContent = item.q;
  explainBox.classList.remove("show");
  explainBox.textContent = "";
  nextBtn.classList.add("hidden");

  optionsList.innerHTML = "";
  const letters = ["A", "B", "C", "D"];
  item.options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.innerHTML = `<span class="option-letter">${letters[idx]}</span><span>${opt}</span>`;
    btn.addEventListener("click", () => selectAnswer(idx));
    optionsList.appendChild(btn);
  });
}

function selectAnswer(idx) {
  const item = dailyQuiz[current];
  const buttons = optionsList.querySelectorAll(".option-btn");
  buttons.forEach((b) => (b.disabled = true));

  const isCorrect = idx === item.correct;
  if (isCorrect) score++;
  buttons[idx].classList.add(isCorrect ? "correct" : "wrong");
  if (!isCorrect) buttons[item.correct].classList.add("correct");

  explainBox.textContent = item.exp;
  explainBox.classList.add("show");
  nextBtn.classList.remove("hidden");
  nextBtn.textContent = current === dailyQuiz.length - 1 ? "See results →" : "Next specimen →";

  answers.push({ chosen: idx, correctIdx: item.correct, isCorrect });
}

function goNext() {
  current++;
  if (current >= dailyQuiz.length) {
    finishQuiz();
  } else {
    renderQuestion();
  }
}

function finishQuiz() {
  if (state.lastCompletedDate !== TODAY) {
    if (state.lastCompletedDate && isYesterday(state.lastCompletedDate, TODAY)) {
      state.streak += 1;
    } else {
      state.streak = 1;
    }
    state.lastCompletedDate = TODAY;
    state.history[TODAY] = { score, answers: answers.map((a) => a.chosen) };
    saveState(state);
  }
  renderStreak();

  resultsScore.textContent = `${score} / ${dailyQuiz.length}`;
  resultsCopy.textContent = scoreMessage(score, dailyQuiz.length);
  reviewList.innerHTML = "";
  reviewList.classList.add("hidden");
  showScreen("results");
}

function scoreMessage(s, total) {
  const pct = s / total;
  if (pct === 1) return "Perfect log. Every specimen correctly identified — come back tomorrow for a new set.";
  if (pct >= 0.7) return "Strong showing. Review the ones you missed below, then return tomorrow.";
  if (pct >= 0.4) return "Solid start. Go through the explanations below before tomorrow's set.";
  return "Every wrong answer is a flagged topic to revisit. Check the review below.";
}

function renderReview() {
  reviewList.innerHTML = "";
  dailyQuiz.forEach((item, i) => {
    const a = answers[i];
    const div = document.createElement("div");
    div.className = "review-item";
    const letters = ["A", "B", "C", "D"];
    div.innerHTML = `
      <div class="rq">${i + 1}. ${item.q}</div>
      <div class="ra ${a.isCorrect ? "correct-line" : "wrong-line"}">Your answer: ${letters[a.chosen]}. ${item.options[a.chosen]}</div>
      ${!a.isCorrect ? `<div class="ra correct-line">Correct answer: ${letters[item.correct]}. ${item.options[item.correct]}</div>` : ""}
      <div class="rexp">${item.exp}</div>
    `;
    reviewList.appendChild(div);
  });
  reviewList.classList.remove("hidden");
}

// ---------- CERTIFICATE ----------
function drawCertificate(name) {
  const canvas = document.createElement("canvas");
  const W = 1400, H = 990;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // background
  ctx.fillStyle = "#F7F3E8";
  ctx.fillRect(0, 0, W, H);

  // outer border
  ctx.strokeStyle = "#1F3A2E";
  ctx.lineWidth = 10;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  // inner gold border
  ctx.strokeStyle = "#C9A24B";
  ctx.lineWidth = 3;
  ctx.strokeRect(55, 55, W - 110, H - 110);

  // corner motifs (two overlapping circles, echoing the site's icon)
  function motif(cx, cy, r) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#4C7A54";
    ctx.beginPath(); ctx.arc(cx - r * 0.4, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#C1443C";
    ctx.beginPath(); ctx.arc(cx + r * 0.4, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  motif(150, 150, 34);
  motif(W - 150, 150, 34);

  ctx.textAlign = "center";

  // eyebrow
  ctx.fillStyle = "#4C7A54";
  ctx.font = "600 22px 'IBM Plex Mono', monospace";
  ctx.fillText("@ AIMERS BY SYR", W / 2, 160);

  // title
  ctx.fillStyle = "#1F3A2E";
  ctx.font = "700 64px Fraunces, serif";
  ctx.fillText("Certificate of Participation", W / 2, 250);

  // divider
  ctx.strokeStyle = "#C9A24B";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W / 2 - 120, 285); ctx.lineTo(W / 2 + 120, 285); ctx.stroke();

  // "this certifies that"
  ctx.fillStyle = "#5B554A";
  ctx.font = "400 26px 'Source Sans 3', sans-serif";
  ctx.fillText("This certifies that", W / 2, 350);

  // participant name
  ctx.fillStyle = "#1F3A2E";
  ctx.font = "700 56px Fraunces, serif";
  let displayName = name && name.trim() ? name.trim() : "Participant";
  ctx.fillText(displayName, W / 2, 430);

  // underline beneath name
  const nameWidth = ctx.measureText(displayName).width;
  ctx.strokeStyle = "#D8CDB6";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - nameWidth / 2 - 20, 452);
  ctx.lineTo(W / 2 + nameWidth / 2 + 20, 452);
  ctx.stroke();

  // body text
  ctx.fillStyle = "#5B554A";
  ctx.font = "400 26px 'Source Sans 3', sans-serif";
  const bodyLine1 = "has successfully completed a daily NEET Biology practice quiz,";
  const bodyLine2 = `scoring ${score} out of ${dailyQuiz.length} on ${prettyDate(TODAY)}.`;
  ctx.fillText(bodyLine1, W / 2, 505);
  ctx.fillText(bodyLine2, W / 2, 540);

  // signatures
  ctx.textAlign = "left";
  const sigY = H - 165;
  const leftX = 200;
  const rightX = W - 200;

  // left signature (CEO)
  ctx.fillStyle = "#1F3A2E";
  ctx.font = "700 42px 'Dancing Script', cursive";
  ctx.textAlign = "center";
  ctx.fillText("Suhail Yousuf", leftX, sigY);
  ctx.strokeStyle = "#2B2620";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(leftX - 130, sigY + 20); ctx.lineTo(leftX + 130, sigY + 20); ctx.stroke();
  ctx.fillStyle = "#5B554A";
  ctx.font = "600 20px 'Source Sans 3', sans-serif";
  ctx.fillText("Suhail Yousuf — Founder & CEO", leftX, sigY + 50);

  // right signature (AI Curriculum Lead)
  ctx.fillStyle = "#1F3A2E";
  ctx.font = "700 42px 'Dancing Script', cursive";
  ctx.fillText("A. Rai", rightX, sigY);
  ctx.beginPath(); ctx.moveTo(rightX - 130, sigY + 20); ctx.lineTo(rightX + 130, sigY + 20); ctx.stroke();
  ctx.fillStyle = "#5B554A";
  ctx.font = "600 20px 'Source Sans 3', sans-serif";
  ctx.fillText("A. Rai — AI Curriculum Lead", rightX, sigY + 50);

  // footer
  ctx.fillStyle = "#4C7A54";
  ctx.font = "500 18px 'IBM Plex Mono', monospace";
  ctx.fillText(`Issued ${prettyDate(TODAY)} · Day ${dateStringToDayIndex(TODAY) + 1}`, W / 2, H - 60);

  return canvas;
}

function ensureFontsReady(callback) {
  if (document.fonts && document.fonts.ready) {
    document.fonts.load("700 42px 'Dancing Script'").then(() => {
      document.fonts.load("700 64px Fraunces").then(callback).catch(callback);
    }).catch(callback);
  } else {
    setTimeout(callback, 300);
  }
}

function renderCertificate() {
  const name = document.getElementById("certNameInput").value;
  const wrap = document.getElementById("certPreviewWrap");
  wrap.innerHTML = "";
  ensureFontsReady(() => {
    const canvas = drawCertificate(name);
    wrap.appendChild(canvas);

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "btn-secondary cert-download-btn";
    downloadBtn.textContent = "Download Certificate";
    downloadBtn.addEventListener("click", () => {
      const link = document.createElement("a");
      link.download = `NEET-Biology-Certificate-${(name || "participant").trim().replace(/\s+/g, "-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
    wrap.appendChild(downloadBtn);
  });
}

// ---------- EVENTS ----------
startBtn.addEventListener("click", () => {
  buildProgressDots();
  current = 0;
  score = 0;
  answers = [];
  showScreen("quiz");
  renderQuestion();
});
nextBtn.addEventListener("click", goNext);
reviewBtn.addEventListener("click", () => {
  renderReview();
  reviewBtn.classList.add("hidden");
});
document.getElementById("certBtn").addEventListener("click", renderCertificate);

// ---------- INIT ----------
initHeader();
if (state.lastCompletedDate === TODAY && state.history[TODAY]) {
  // Already completed today — restore real answers so review still works
  const saved = state.history[TODAY];
  score = saved.score;
  answers = dailyQuiz.map((item, i) => {
    const chosen = saved.answers[i];
    return { chosen, correctIdx: item.correct, isCorrect: chosen === item.correct };
  });
  resultsScore.textContent = `${score} / ${dailyQuiz.length}`;
  resultsCopy.textContent = "You've already logged today's specimens. New set unlocks after midnight.";
  showScreen("results");
} else {
  showScreen("intro");
}
