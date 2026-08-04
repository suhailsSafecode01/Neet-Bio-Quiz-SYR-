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
const CERT_QR_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANIAAADSCAYAAAA/mZ5CAAAE6UlEQVR4nO3d7Y1kNRCG0QWRx2ZAAOQvAiADIlkSwEgePV6Xm3P+Ts+9tz9elVQq29++AQAAAACz/LL6w/c/fv/xMx/kq/7+869/fQ+r5999ffU8u155/t3n3L3ONKv39evPfhD4RIIEAUGCgCBBQJAg8NvuP1RdqV1VV2f3Ore6cLv3Pf297H5uVTfvld+bigQBQYKAIEFAkCAgSBDY7tqtTJtVmzaDVzk921Z1EU+b9ntTkSAgSBAQJAgIEgQECQJZ126aajZs5dYM3u51Vm51Kad1/yoqEgQECQKCBAFBgoAgQeBju3bVrN1K1SWbtk/dtOu/QkWCgCBBQJAgIEgQECQIZF27T+3enF5Re2tGrupe3rr+tN+bigQBQYKAIEFAkCAgSBDY7tpN2+dtpeq2TXv9Lae7cLv3nUZFgoAgQUCQICBIEBAkCCy7dtNmmSrTumfTZuRWXr/+aSoSBAQJAoIEAUGCgCBBYNm1O93dsp/b166/+nxOf/639gk8fZ3qc1ORICBIEBAkCAgSBAQJAsdXyJ7u9qxMOxN2976vzPid9ko3T0WCgCBBQJAgIEgQECQIZPNi085mvfU8K6/cd9cr+86ZtYMHCBIEBAkCggQBQYLA9grZXbdm3lZ2u3m3ZgVfMe37utVFVJEgIEgQECQICBIEBAkC2ytkX5ltO+3Wvm1Vt2raGbiv/05UJAgIEgQECQKCBAFBgsD2GbK3zjy9dQrGrZmu093R12cCb53WsaIiQUCQICBIEBAkCAgSBJadiWmnRaxMWyl5qxs27f2+0gWtqEgQECQICBIEBAkCggSBa6dR6Ap+7b67ps0EVtdfubWPoooEAUGCgCBBQJAgIEgQOD4Xdnq/u9dXet7yeldt2hm7KhIEBAkCggQBQYKAIEHg+BmylVe6N7dmDm/tdzetC3f6vqvrqEgQECQICBIEBAkCggSB42fI7rq1svXWysqVW7OFp7twt86iPf15qkgQECQICBIEBAkCggSB7dMoVm7Nhk3bv27aLFll2u9h2oppFQkCggQBQYKAIEFAkCCwnLU7PUO16/UVu7qa//36aiXvrRXTKhIEBAkCggQBQYKAIEEg29duWldnmtNdx9dnAk9/76e7pioSBAQJAoIEAUGCgCBBYHvWbuX0Csdbr7/l1izfK6Z9vyoSBAQJAoIEAUGCgCBBYHuO6ZX9zW45vT/erlsrl2+dRXuLigQBQYKAIEFAkCAgSBDYPo1i2v5s07pPp6//SvfvVjfVaRTwMEGCgCBBQJAgIEgQGDWvVHplf7xb+9HdWll863SS09+7igQBQYKAIEFAkCAgSBDITqO45f82qzbttIjK6bNlT1ORICBIEBAkCAgSBAQJAsuu3cqtrkjVNTrdlXql2zntOW/N4K3sPo+KBAFBgoAgQUCQICBIENju2q3c6pbsXufWytlbM2zT9p175f3u/k5UJAgIEgQECQKCBAFBgkDWtZtm2ikY1QrZ013NXdNO8bi1T6CKBAFBgoAgQUCQICBIEPjYrt3KtFMMTq/MndalvOX0/ngqEgQECQKCBAFBgoAgQSDr2k07m/V0l2naqRbV6185o3bajJ+KBAFBgoAgQUCQICBIENju2k2boVq59Zynu1W799017Tmn7Qe4oiJBQJAgIEgQECQICBIAAAAAAB/oH9UQmX9yjIR/AAAAAElFTkSuQmCC";

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
  const bodyLine1 = "has successfully completed a daily NEET Biology practice quiz,";
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
const SITE_URL = "https://suhailssafecode01.github.io/Neet-Bio-Quiz-SYR-/";
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
            title: "Specimen Log — NEET Biology Daily Quiz",
            text: "A fresh 10-question NEET Biology quiz, every day. Free!",
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
