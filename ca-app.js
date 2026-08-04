// ---------- CONFIG ----------
const QUIZ_SIZE = 10;
const STORAGE_KEY = "caFoundationQuiz_v1";

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
const PERM = seededShuffle(CA_QUESTION_BANK.map((_, i) => i), mulberry32(FIXED_PERMUTATION_SEED));

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
    const original = CA_QUESTION_BANK[qIdx];
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
const CERT_QR_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANIAAADSCAYAAAA/mZ5CAAAE8UlEQVR4nO3dwW1dNxCGUSdwH+kgBaR/uIB04EqShbOlAQYfzaF0ztYy731P+kFgMOR8+QIAAAAAzPLb6h/++OvPf37li/xf37/9vfwMhep72H3P1XNX67zynrvrTLP6XL//6heBj0iQICBIEBAkCAgSBL7u/ofTVbKVqqozrbq1u/7pdar1K6/8vdmRICBIEBAkCAgSBAQJAttVu5Vb1bCVV3q3Vqpeu1vfQ9WDt7v+rup97EgQECQICBIEBAkCggSBrGrHD6erSdOqkdPe5xY7EgQECQKCBAFBgoAgQUDV7j+3Trzurr9bzTv98/xgR4KAIEFAkCAgSBAQJAhkVbtb94+dNq06Vz13931OP3fXtL83OxIEBAkCggQBQYKAIEFgu2r3es/Vrd6zab1zK7c+7+4609iRICBIEBAkCAgSBAQJAqP6lUrTZraunH7PaSdzPyo7EgQECQKCBAFBgoAgQWBZWXnl3rNpJ0OnfQ/Tet5e+d522ZEgIEgQECQICBIEBAkCx6dRnO5he6W6uHL6RGr187tO99qd/v3u/l3ZkSAgSBAQJAgIEgQECQLblZVXqmTTTmie7lXbdWvqxLSTvCu772NHgoAgQUCQICBIEBAkCGSVrVv3oU2rhu06fS/crerWtPsAd5+r1w4uECQICBIEBAkCggSBUf1oPzOtyrdyqxdu5daM2mn3BJ5+TzsSBAQJAoIEAUGCgCBBYHmv3bSqkRO4P3/u6fvcdn9+9z1fn0VrR4KAIEFAkCAgSBAQJAiMq4i8ckJz1yvv8/r3cOvEtB0JAoIEAUGCgCBBQJAgcG0axbQeqtenM1Trv3KydeXW79GOBAFBgoAgQUCQICBIEMiqdivT7iv7bL1k0+7ZW5nWM2kaBVwgSBAQJAgIEgQECQLHe+2mrb/73F23qmSv3Pv3ynQJVTu4QJAgIEgQECQICBIElhWmz3bC8fSM2tdPku4+d9r9hKerwXYkCAgSBAQJAoIEAUGCwHKG7OnqxyvVmNNVxGknfE97pWdSrx1cIEgQECQICBIEBAkC271206p5lepzvXJf37TPtTLt5PKKHQkCggQBQYKAIEFAkCCw7LXbdbpqtLvOrtO9bbeqah/1ubvr7NJrBxcIEgQECQKCBAFBgkBWtTvdI/dKz9W0Wai7bp3wvTVNo6oW2pEgIEgQECQICBIEBAkCx3vtqqrI6Z6rV3rGXrkXrlr/9MllM2RhEEGCgCBBQJAgIEgQyKp2K9PuMbt1AnRX1Xs27eTsrmmzblfsSBAQJAgIEgQECQKCBIHtGbKn3Zr9+sr6VbWtOsG669bv93TV0Y4EAUGCgCBBQJAgIEgQWFbtbs1y3XW6yrRrWg/btPepnltxrx0MIkgQECQICBIEBAkC2ydkb1XDqt6qaW7NZt11+vt8pcdyxY4EAUGCgCBBQJAgIEgQGDdD9pX74k47PZt1V9WDd+t7dq8dPECQICBIEBAkCAgSBI5Po5jm9AzT0ydYT5+cvdXTeKuHcHd9M2ThIEGCgCBBQJAgIEgQ+HRVu5WqerbrVpVv17RZsbfu/VuxI0FAkCAgSBAQJAgIEgSWFYtb0wFWTr/PKydkd92adnG6B2/aiWw7EgQECQKCBAFBgoAgQWC7ajfNK1WdlVszW6edSJ02lcMMWbhAkCAgSBAQJAgIEgAAAAAAH9C/IOepcL4xtrYAAAAASUVORK5CYII=";

function certVerificationCode(name, dateStr, scoreVal) {
  // Short deterministic-looking code so each certificate looks uniquely stamped
  const raw = `${name}::${dateStr}::${scoreVal}::aimersbySYR`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  const code = Math.abs(h).toString(36).toUpperCase().padStart(8, "0").slice(0, 8);
  return `AIM-${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

function drawBarcode(ctx, x, y, w, h, seedStr) {
  // Decorative but deterministic barcode pattern (not a real symbology,
  // purely visual — the QR code above is the actual verification link)
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = mulberry32(seed);
  let cx = x;
  ctx.fillStyle = "#1F3A2E";
  while (cx < x + w) {
    const barW = 1 + Math.floor(rand() * 4);
    if (rand() > 0.42) {
      ctx.fillRect(cx, y, barW, h);
    }
    cx += barW + 1;
  }
}

function drawCertificate(name) {
  const canvas = document.createElement("canvas");
  const W = 1500, H = 1060;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // background
  ctx.fillStyle = "#F7F3E8";
  ctx.fillRect(0, 0, W, H);

  // faint watermark text, repeated diagonally, for texture + authenticity feel
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = "#1F3A2E";
  ctx.font = "700 40px Fraunces, serif";
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 10);
  for (let i = -3; i <= 3; i++) {
    ctx.textAlign = "center";
    ctx.fillText("AIMERS BY SYR", 0, i * 130);
  }
  ctx.restore();

  // outer border
  ctx.strokeStyle = "#1F3A2E";
  ctx.lineWidth = 12;
  ctx.strokeRect(28, 28, W - 56, H - 56);

  // inner gold border
  ctx.strokeStyle = "#C9A24B";
  ctx.lineWidth = 3;
  ctx.strokeRect(54, 54, W - 108, H - 108);

  // corner motifs
  function motif(cx, cy, r) {
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#4C7A54";
    ctx.beginPath(); ctx.arc(cx - r * 0.4, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#C1443C";
    ctx.beginPath(); ctx.arc(cx + r * 0.4, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  motif(150, 145, 32);
  motif(W - 150, 145, 32);

  ctx.textAlign = "center";

  // eyebrow
  ctx.fillStyle = "#4C7A54";
  ctx.font = "600 24px 'IBM Plex Mono', monospace";
  ctx.fillText("@ AIMERS BY SYR", W / 2, 155);

  // title
  ctx.fillStyle = "#1F3A2E";
  ctx.font = "700 68px Fraunces, serif";
  ctx.fillText("Certificate of Participation", W / 2, 245);

  // divider
  ctx.strokeStyle = "#C9A24B";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W / 2 - 130, 280); ctx.lineTo(W / 2 + 130, 280); ctx.stroke();

  // "this certifies that"
  ctx.fillStyle = "#5B554A";
  ctx.font = "400 28px 'Source Sans 3', sans-serif";
  ctx.fillText("This certifies that", W / 2, 345);

  // participant name
  ctx.fillStyle = "#1F3A2E";
  ctx.font = "700 62px Fraunces, serif";
  let displayName = name && name.trim() ? name.trim() : "Participant";
  ctx.fillText(displayName, W / 2, 430);

  const nameWidth = ctx.measureText(displayName).width;
  ctx.strokeStyle = "#C9A24B";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - nameWidth / 2 - 24, 452);
  ctx.lineTo(W / 2 + nameWidth / 2 + 24, 452);
  ctx.stroke();

  // body text
  ctx.fillStyle = "#3D382E";
  ctx.font = "400 28px 'Source Sans 3', sans-serif";
  const bodyLine1 = "has successfully completed a daily CA Foundation practice quiz,";
  const bodyLine2 = `scoring ${score} out of ${dailyQuiz.length} on ${prettyDate(TODAY)}.`;
  ctx.fillText(bodyLine1, W / 2, 505);
  ctx.fillText(bodyLine2, W / 2, 542);

  // scored-well badge ribbon (only if strong score, adds visual richness)
  if (score / dailyQuiz.length >= 0.7) {
    ctx.save();
    ctx.translate(W - 195, 350);
    ctx.rotate(Math.PI / 8);
    ctx.fillStyle = "#C1443C";
    ctx.fillRect(-90, -28, 180, 56);
    ctx.fillStyle = "#F7F3E8";
    ctx.font = "700 20px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("HIGH SCORE", 0, 7);
    ctx.restore();
  }

  // signatures
  ctx.textAlign = "center";
  const sigY = H - 240;
  const leftX = 265;
  const rightX = W - 265;

  ctx.fillStyle = "#1F3A2E";
  ctx.font = "700 46px 'Dancing Script', cursive";
  ctx.fillText("Suhail Yousuf", leftX, sigY);
  ctx.strokeStyle = "#2B2620";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(leftX - 150, sigY + 22); ctx.lineTo(leftX + 150, sigY + 22); ctx.stroke();
  ctx.fillStyle = "#3D382E";
  ctx.font = "600 21px 'Source Sans 3', sans-serif";
  ctx.fillText("Suhail Yousuf — Founder & CEO", leftX, sigY + 54);

  ctx.fillStyle = "#1F3A2E";
  ctx.font = "700 46px 'Dancing Script', cursive";
  ctx.fillText("Mohd Ibrahim", rightX, sigY);
  ctx.beginPath(); ctx.moveTo(rightX - 150, sigY + 22); ctx.lineTo(rightX + 150, sigY + 22); ctx.stroke();
  ctx.fillStyle = "#3D382E";
  ctx.font = "600 21px 'Source Sans 3', sans-serif";
  ctx.fillText("Mohd Ibrahim — Co-Founder", rightX, sigY + 54);

  // verification block: QR + barcode + code, centered at bottom
  const vBoxY = H - 150;
  const qrSize = 108;
  const qrX = W / 2 - 250;

  return new Promise((resolve) => {
    const qrImg = new Image();
    qrImg.onload = () => {
      ctx.drawImage(qrImg, qrX, vBoxY - qrSize / 2, qrSize, qrSize);
      finishVerificationBlock();
      resolve(canvas);
    };
    qrImg.onerror = () => {
      finishVerificationBlock();
      resolve(canvas);
    };
    qrImg.src = CERT_QR_DATA_URI;

    function finishVerificationBlock() {
      const barcodeX = qrX + qrSize + 40;
      const barcodeW = 260;
      drawBarcode(ctx, barcodeX, vBoxY - 30, barcodeW, 60, displayName + TODAY + score);

      const code = certVerificationCode(displayName, TODAY, score);
      ctx.textAlign = "left";
      ctx.fillStyle = "#3D382E";
      ctx.font = "600 18px 'IBM Plex Mono', monospace";
      ctx.fillText("SCAN TO VERIFY", barcodeX, vBoxY - 42);
      ctx.font = "700 22px 'IBM Plex Mono', monospace";
      ctx.fillText(code, barcodeX, vBoxY + 52);

      // footer
      ctx.textAlign = "center";
      ctx.fillStyle = "#4C7A54";
      ctx.font = "500 19px 'IBM Plex Mono', monospace";
      ctx.fillText(`Issued ${prettyDate(TODAY)} · Day ${dateStringToDayIndex(TODAY) + 1}`, W / 2, H - 55);
    }
  });
}

function ensureFontsReady(callback) {
  if (document.fonts && document.fonts.ready) {
    Promise.all([
      document.fonts.load("700 46px 'Dancing Script'"),
      document.fonts.load("700 68px Fraunces"),
      document.fonts.load("600 24px 'IBM Plex Mono'"),
      document.fonts.ready,
    ]).then(callback).catch(callback);
  } else {
    setTimeout(callback, 400);
  }
}

function renderCertificate() {
  const name = document.getElementById("certNameInput").value;
  const wrap = document.getElementById("certPreviewWrap");
  const btn = document.getElementById("certBtn");
  wrap.innerHTML = "<p class=\"cert-loading\">Generating certificate…</p>";
  btn.disabled = true;
  ensureFontsReady(() => {
    drawCertificate(name).then((canvas) => {
      wrap.innerHTML = "";
      wrap.appendChild(canvas);
      btn.disabled = false;

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

// ---------- SHARE & INSTALL ----------
const SITE_URL = "https://suhailssafecode01.github.io/Neet-Bio-Quiz-SYR-/ca.html";
const SITE_QR_DATA_URI = "data:image/png;base64,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";

function initQRCode() {
  const wrap = document.getElementById("shareQrWrap");
  if (!wrap) return;
  const img = document.createElement("img");
  img.src = SITE_QR_DATA_URI;
  img.alt = "QR code to open this quiz";
  wrap.appendChild(img);
}

function showShareNote(msg) {
  const note = document.getElementById("shareNote");
  if (!note) return;
  note.textContent = msg;
  setTimeout(() => { if (note.textContent === msg) note.textContent = ""; }, 3000);
}

function initInstallButton() {
  const installBtn = document.getElementById("installBtn");
  if (!installBtn) return;
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove("hidden");
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) {
      showShareNote("Use your browser menu → \"Install app\" to add this to your home screen.");
      return;
    }
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice && choice.outcome === "accepted") {
      showShareNote("Installed! Check your home screen.");
    }
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    installBtn.classList.add("hidden");
    showShareNote("Installed! Check your home screen.");
  });
}

function initShareButtons() {
  const shareBtn = document.getElementById("shareBtn");
  const copyBtn = document.getElementById("copyLinkBtn");

  if (shareBtn) {
    if (navigator.share) {
      shareBtn.classList.remove("hidden");
      shareBtn.addEventListener("click", async () => {
        try {
          await navigator.share({
            title: "Ledger Log — CA Foundation Daily Quiz",
            text: "A fresh 10-question CA Foundation quiz, every day. Free!",
            url: SITE_URL,
          });
        } catch (e) {
          // user cancelled share — no action needed
        }
      });
    }
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(SITE_URL);
        showShareNote("Link copied — paste it anywhere.");
      } catch (e) {
        showShareNote(SITE_URL);
      }
    });
  }
}

// ---------- INIT ----------
initHeader();
initQRCode();
initInstallButton();
initShareButtons();
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
