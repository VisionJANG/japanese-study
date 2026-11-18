/* 単語帳 JLPT — 웹앱 본체
   - 단어 데이터: 처음 한 번 파일에서 불러와 IndexedDB에 저장 (웹 페이지에는 단어 데이터 없음)
   - 학습 기록: localStorage
   - 손글씨 채점: KanjiCanvas (iPhone 안에서만 동작) — 한 칸에 한 글자 */
"use strict";

const ROUND = 20;          // 한 회차 문제 수
const REVIEW_MAX = 4;      // 레벨 학습에 섞는 오답 단어 수 (최대)
const TOP_N = 10;          // 글자마다 인식 후보 몇 개까지 정답으로 볼지
const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const LV = {   // c: 옅은 바탕, s: 진행 막대, d: 글자
  N5:{t:"입문",   c:"#FFF4CF", s:"#F5B400", d:"#9A6B00"},
  N4:{t:"초급",   c:"#FFE5E0", s:"#F2624C", d:"#C23D29"},
  N3:{t:"중급",   c:"#DBF6EA", s:"#17B07A", d:"#0B7D55"},
  N2:{t:"중상급", c:"#E0ECFF", s:"#3A7DF0", d:"#1F5FC8"},
  N1:{t:"상급",   c:"#EEE6FF", s:"#8B5CF6", d:"#6A3FD6"}
};

const $ = id => document.getElementById(id);
const S = {mode:"vertical", tab:"homeView", level:null, title:"", deck:[], idx:0, marks:[], phase:"answer",
           review:new Set(), isRetry:false, strokes:[], base:null, recog:"", words:[], byId:{}, bank:{}};

/* ================= 저장소 ================= */
const DB = {
  open(){ return new Promise((ok, ng) => { const r = indexedDB.open("jlpt-tango", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); }); },
  async get(k){ const db = await this.open(); return new Promise((ok, ng) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ng(q.error); }); },
  async set(k, v){ const db = await this.open(); return new Promise((ok, ng) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => ok(); t.onerror = () => ng(t.error); }); }
};
const REC_KEY = "jlpt-rec-v1";
const emptyRec = () => ({learned:{N5:[],N4:[],N3:[],N2:[],N1:[]}, wrong:[], ok:0, total:0, days:{}, lastLevel:"N5"});
let REC = emptyRec();
try { REC = Object.assign(emptyRec(), JSON.parse(localStorage.getItem(REC_KEY) || "{}")); } catch(e) {}
const saveRec = () => { try { localStorage.setItem(REC_KEY, JSON.stringify(REC)); } catch(e) {} };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

function useWords(words){
  S.words = words.filter(w => LV[w.level] && w.word && !w.affix);
  S.byId = {}; S.bank = {N5:[],N4:[],N3:[],N2:[],N1:[]};
  S.words.forEach(w => { S.byId[w.id] = w; S.bank[w.level].push(w); });
}

/* ================= 화면 모드 (iPhone 세로 / 가로 / iPad) ================= */
function applyMode(){
  const w = innerWidth, h = innerHeight;
  const mode = h < 520 && w > h ? "compact" : (w >= 700 ? "wide" : "vertical");
  if (mode !== S.mode){ $("screen").classList.remove(S.mode); S.mode = mode; }
  $("screen").classList.add(mode);
  resizeCanvas();
}
addEventListener("resize", applyMode);
addEventListener("orientationchange", () => setTimeout(applyMode, 200));

/* ================= 탭 / 화면 전환 ================= */
function show(view){
  ["setupView","homeView","noteView","statsView","quizView"].forEach(v => $(v).classList.toggle("active", v === view));
  $("screen").classList.toggle("in-quiz", view === "quizView" || view === "setupView");
  $("tabbar").style.display = view === "setupView" ? "none" : "";
  if (view === "quizView" || view === "setupView") return requestAnimationFrame(resizeCanvas);
  S.tab = view;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === view));
  renderHome(); renderNote(); renderStats();
}
document.querySelectorAll(".tab").forEach(t => t.onclick = () => show(t.dataset.tab));

/* ================= 단어 파일 불러오기 ================= */
$("pickWords").onclick = () => $("fileWords").click();
$("fileWords").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const msg = $("setupMsg"); msg.className = "setup-msg"; msg.textContent = "불러오는 중…";
  try {
    const data = JSON.parse(await f.text());
    const words = Array.isArray(data) ? data : data.words;
    if (!Array.isArray(words) || !words.length || !words[0].word || !words[0].meaning_ko) throw new Error("형식");
    await DB.set("words", words);
    useWords(words);
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch(_) {}
    msg.textContent = `${S.words.length.toLocaleString()}개 단어를 저장했어요`;
    setTimeout(() => show("homeView"), 500);
  } catch(err){
    msg.className = "setup-msg err";
    msg.textContent = "단어 파일을 읽지 못했어요. words_personal.json 파일인지 확인해 주세요.";
  }
};

/* ================= 홈 ================= */
const learnedCount = lv => REC.learned[lv].length;
function renderHome(){
  $("decks").innerHTML = "";
  LEVELS.forEach(lv => {
    const total = S.bank[lv].length; if (!total) return;
    const n = Math.min(learnedCount(lv), total), pct = Math.round(n / total * 100);
    const b = document.createElement("button");
    b.className = "deck";
    b.style.setProperty("--lv", LV[lv].c); b.style.setProperty("--lv-strong", LV[lv].s); b.style.setProperty("--lv-d", LV[lv].d);
    b.innerHTML = `<span class="ring"></span><div class="lvname">${lv}<i></i></div>
      <div class="t">${LV[lv].t}<small>${total.toLocaleString()}단어</small></div>
      <div class="pct"><small>${n.toLocaleString()}개 학습</small>${pct}%</div>
      <div class="meter"><i style="width:${Math.max(pct, n ? 2 : 0)}%"></i></div>`;
    b.onclick = () => start(lv);
    $("decks").appendChild(b);
  });
  const nw = wrongWords().length;
  $("noteDot").textContent = nw; $("noteDot").style.display = nw ? "" : "none";
}

/* ================= 오답노트 ================= */
const wrongWords = () => REC.wrong.map(id => S.byId[id]).filter(Boolean);
const lvChip = lv => `style="background:${LV[lv].c};color:${LV[lv].d}"`;
function rowHTML(w){
  return `<div class="rv"><div class="kw"><span class="k">${esc(w.word)}</span><span class="r">${w.reading === w.word ? "" : esc(w.reading)}</span></div>
    <div class="m">${esc(w.meaning_ko)}<small>${esc(w.pos || "")}</small></div></div>`;
}
function renderNote(){
  const ws = wrongWords();
  let h = `<div class="page-title">오답노트</div>`;
  if (!ws.length){
    $("noteView").innerHTML = h + `<div class="panel empty">틀린 단어가 여기에 모여요.<br>다시 맞히면 자동으로 빠져요.</div>`;
    return;
  }
  h += `<div class="note-cta"><div class="n">${ws.length}</div><div class="l">다시 맞힐 때까지<br>남아 있는 단어</div><button id="noteGo">오답만 풀기</button></div>
    <p class="note-tip">레벨 학습에도 오답이 한 번에 최대 ${REVIEW_MAX}개씩 섞여 나와요. 맞히면 여기서 빠져요.</p>`;
  LEVELS.forEach(lv => {
    const list = ws.filter(w => w.level === lv);
    if (!list.length) return;
    h += `<div class="panel"><h3><span class="chip-lv" ${lvChip(lv)}>${lv}</span>${LV[lv].t}<small style="color:var(--ink-3);font-weight:500">${list.length}개</small></h3>${list.map(rowHTML).join("")}</div>`;
  });
  $("noteView").innerHTML = h;
  $("noteGo").onclick = () => start(null, wrongWords(), "오답노트");
}

/* ================= 기록 ================= */
function renderStats(){
  const learned = LEVELS.reduce((a, lv) => a + learnedCount(lv), 0);
  const acc = REC.total ? Math.round(REC.ok / REC.total * 100) : 0;
  const days = [], names = ["일","월","화","수","목","금","토"];
  for (let i = 6; i >= 0; i--){
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    days.push({n: REC.days[k] || 0, label: i === 0 ? "오늘" : names[d.getDay()]});
  }
  const max = Math.max(ROUND, ...days.map(d => d.n));
  $("statsView").innerHTML = `<div class="page-title">기록</div>
    <div class="tiles">
      <div class="tile"><b>${REC.days[today()] || 0}</b><span>오늘 푼 단어</span></div>
      <div class="tile"><b>${learned.toLocaleString()}</b><span>익힌 단어</span></div>
      <div class="tile"><b>${acc}%</b><span>정답률</span></div>
    </div>
    <div class="panel"><h3>최근 7일</h3><div class="week">${days.map((d, i) =>
      `<div class="${i === 6 ? "now" : ""}"><i style="height:${d.n / max * 100}%"></i><span>${d.label}</span></div>`).join("")}</div></div>
    <div class="panel"><h3>레벨별 진도</h3>${LEVELS.map(lv => { const t = S.bank[lv].length || 1, n = Math.min(learnedCount(lv), t);
      return `<div class="lvrow" style="--lv-strong:${LV[lv].s}"><b>${lv}</b><div class="meter"><i style="width:${n / t * 100}%"></i></div><span>${n.toLocaleString()} / ${t.toLocaleString()}</span></div>`; }).join("")}</div>
    <div class="panel"><h3>데이터</h3>
      <div class="data-row">
        <button class="btn ghost" id="bkSave">학습 기록 백업</button>
        <button class="btn ghost" id="bkLoad">백업 불러오기</button>
      </div>
      <div class="data-row"><button class="btn ghost" id="wordsReload">단어 파일 다시 불러오기</button></div>
      <p class="data-note">단어와 학습 기록은 이 iPhone 안에만 저장돼요. 홈 화면에서 앱을 삭제하면 함께 지워지니, 가끔 백업해 두세요.</p>
    </div>`;
  $("bkSave").onclick = saveBackup;
  $("bkLoad").onclick = () => $("fileBackup").click();
  $("wordsReload").onclick = () => { $("setupMsg").textContent = ""; show("setupView"); };
}
async function saveBackup(){
  const blob = new Blob([JSON.stringify({type:"jlpt-tango-backup", date:today(), rec:REC})], {type:"application/json"});
  const name = `tango-backup-${today()}.json`;
  try {
    const file = new File([blob], name, {type:"application/json"});
    if (navigator.canShare && navigator.canShare({files:[file]})) { await navigator.share({files:[file], title:name}); return; }
  } catch(e) { if (e && e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$("fileBackup").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.type !== "jlpt-tango-backup" || !d.rec) throw 0;
    REC = Object.assign(emptyRec(), d.rec); saveRec(); show(S.tab);
  } catch(_) { alertBox("백업 파일을 읽지 못했어요."); }
};
function alertBox(t){ const m = document.createElement("div"); m.className = "toast"; m.textContent = t; $("screen").appendChild(m); setTimeout(() => m.remove(), 2600); }

/* ================= 문제 구성 ================= */
function shuffle(a){ a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function start(lv, words, title){
  if (lv){ REC.lastLevel = lv; saveRec(); }
  S.level = lv; S.title = title || ""; S.idx = 0; S.marks = []; S.isRetry = !!words; S.review = new Set();
  if (words){
    S.deck = shuffle(words).slice(0, ROUND);
  } else {
    // 1) 이 레벨의 오답 최대 4개  2) 아직 안 맞힌 새 단어  3) 모자라면 이미 맞힌 단어
    const rv = shuffle(wrongWords().filter(w => w.level === lv)).slice(0, REVIEW_MAX);
    rv.forEach(w => S.review.add(w.id));
    const learned = new Set(REC.learned[lv]);
    const pool = S.bank[lv].filter(w => !S.review.has(w.id));
    let fresh = shuffle(pool.filter(w => !learned.has(w.id))).slice(0, ROUND - rv.length);
    if (fresh.length < ROUND - rv.length) fresh = fresh.concat(shuffle(pool.filter(w => learned.has(w.id))).slice(0, ROUND - rv.length - fresh.length));
    S.deck = shuffle([...rv, ...fresh]);
  }
  newWord(); show("quizView");
}
function newWord(){
  S.phase = "answer"; S.recog = "";
  S.strokes = []; S.base = null;
  clearStamp(); $("flash").classList.remove("flipped"); $("flash").style.removeProperty("--back-h");
  redraw(); syncTools(); updateUI();
}

/* ================= 필기 칸 (손글씨 입력) ================= */
const cv = $("canvas"), ctx = cv.getContext("2d");
let drawing = null, view = {s:1, ox:0, oy:0};
function resizeCanvas(){
  const dpr = devicePixelRatio || 1;
  if (!cv.offsetWidth) return;
  cv.width = cv.offsetWidth * dpr; cv.height = cv.offsetHeight * dpr;
  redraw();
}
/* 획은 처음 쓴 크기 기준 좌표로 저장 → 칸 크기가 바뀌면 비율 유지한 채 축소해서 다시 그림 */
function redraw(){
  const cw = cv.offsetWidth, ch = cv.offsetHeight;
  if (!cw || !ch) return;
  if (!S.base || !S.strokes.length) S.base = [cw, ch];
  const sc = Math.min(cw / S.base[0], ch / S.base[1], 1);
  view = {s:sc, ox:(cw - S.base[0] * sc) / 2, oy:(ch - S.base[1] * sc) / 2};
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * view.ox, dpr * view.oy);
  ctx.strokeStyle = "#1D2433"; ctx.lineWidth = 7; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const s of S.strokes){
    ctx.beginPath();
    s.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    if (s.length === 1) ctx.lineTo(s[0][0] + .1, s[0][1]);
    ctx.stroke();
  }
}
function pt(e){
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * cv.offsetWidth, y = (e.clientY - r.top) / r.height * cv.offsetHeight;
  return [(x - view.ox) / view.s, (y - view.oy) / view.s];
}
cv.addEventListener("pointerdown", e => {
  if (S.phase !== "answer") return;
  e.preventDefault(); cv.setPointerCapture(e.pointerId);
  drawing = [pt(e)]; S.strokes.push(drawing); redraw(); syncTools();
});
cv.addEventListener("pointermove", e => { if (!drawing) return; e.preventDefault(); drawing.push(pt(e)); redraw(); });
["pointerup", "pointercancel"].forEach(t => cv.addEventListener(t, () => { drawing = null; }));
function syncTools(){
  const has = S.strokes.length > 0, locked = S.phase !== "answer";
  $("undo").disabled = $("clear").disabled = locked || !has;
  $("sheet").classList.toggle("locked", locked);
  $("hint").style.display = has || locked ? "none" : "grid";
  if (S.phase === "answer") $("action").disabled = !has;
}
$("undo").onclick = () => { S.strokes.pop(); redraw(); syncTools(); };
$("clear").onclick = () => { S.strokes = []; redraw(); syncTools(); };
new ResizeObserver(() => resizeCanvas()).observe($("sheet"));

/* ================= 채점 ================= */
const SMALL = {"ぁ":"あ","ぃ":"い","ぅ":"う","ぇ":"え","ぉ":"お","っ":"つ","ゃ":"や","ゅ":"ゆ","ょ":"よ","ゎ":"わ","ゕ":"か","ゖ":"け"};
function normChar(c){
  if (c >= "ァ" && c <= "ヶ") c = String.fromCharCode(c.charCodeAt(0) - 0x60);   // 가타카나 → 히라가나
  if (SMALL[c]) c = SMALL[c];                                                       // 작은 글자 → 큰 글자 (손글씨로는 크기 구분 불가)
  if ("ー一－―‐-".includes(c)) c = "ー";                                             // 장음 기호와 一 구분 불가
  return c;
}
const normStr = s => [...String(s).replace(/[～〜~\s・]/g, "")].map(normChar);
function answers(w){
  const set = new Set([w.word, w.reading, ...(w.accept || [])].filter(Boolean));
  return [...set].map(normStr).filter(a => a.length);
}
function gradeHandwriting(w){
  const r = HWSEG.match(S.strokes, answers(w));
  S.recog = r.ok ? w.word : (r.guess || "？");
  return r.ok;
}

function recordResult(w, ok){
  REC.total++; if (ok) REC.ok++;
  const d = today(); REC.days[d] = (REC.days[d] || 0) + 1;
  if (ok){
    if (!REC.learned[w.level].includes(w.id)) REC.learned[w.level].push(w.id);
    REC.wrong = REC.wrong.filter(x => x !== w.id);
  } else if (!REC.wrong.includes(w.id)) REC.wrong.push(w.id);
  saveRec();
}
function undoWrong(w){   // 「맞게 썼어요」: 인식 오류 바로잡기
  REC.ok++;
  if (!REC.learned[w.level].includes(w.id)) REC.learned[w.level].push(w.id);
  REC.wrong = REC.wrong.filter(x => x !== w.id);
  saveRec();
}

async function submit(){
  if (!window.KanjiCanvas || !KanjiCanvas.refPatterns.length){
    $("action").disabled = true; $("action").textContent = "인식 준비 중…";
    await new Promise(r => { const t = setInterval(() => { if (KanjiCanvas.refPatterns.length){ clearInterval(t); r(); } }, 100); });
  }
  const w = S.deck[S.idx];
  S.phase = "grading"; syncTools(); $("action").disabled = true; $("action").textContent = "채점 중…";
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const ok = gradeHandwriting(w);
  S.marks[S.idx] = ok; S.phase = "checked";
  recordResult(w, ok);
  $("flash").classList.add("flipped");
  updateUI(); fitBack(); stamp(ok);
}
$("action").onclick = () => { if (S.phase === "answer") submit(); else next(); };
$("back").onclick = () => show(S.tab);

function next(){
  S.idx++;
  if (S.idx >= S.deck.length){ S.phase = "finished"; updateUI(); }
  else newWord();
}

/* ================= 빨간 펜 표시 ================= */
function stamp(ok){
  const svg = $("stamp");
  svg.classList.remove("draw");
  svg.innerHTML = ok
    ? `<path d="M118 34 C 70 22, 26 58, 34 108 C 42 160, 112 178, 152 140 C 188 104, 168 44, 112 38" stroke-width="11"/>`
    : `<path d="M56 50 Q 100 98 146 152" stroke-width="12"/><path d="M148 48 Q 104 98 54 150" stroke-width="12"/>`;
  svg.querySelectorAll("path").forEach(p => { const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; });
  requestAnimationFrame(() => svg.classList.add("draw"));
}
function clearStamp(){ $("stamp").innerHTML = ""; $("stamp").classList.remove("draw"); }

const MARK_OK = `<svg class="mark" viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" fill="none" stroke="#12A15E" stroke-width="4"/></svg>`;
const MARK_NG = `<svg class="mark" viewBox="0 0 40 40"><path d="M10 10 L30 30 M30 10 L10 30" stroke="#EE4B30" stroke-width="4.5" stroke-linecap="round"/></svg>`;

/* 세로 화면: 뒷면(정답+예문) 높이에 맞춰 카드 크기 결정 */
function fitBack(){
  const flash = $("flash"), back = document.querySelector(".back");
  if (S.mode !== "vertical") { flash.style.removeProperty("--back-h"); return; }
  const prev = back.style.cssText;
  back.style.cssText = "position:static; visibility:hidden; transform:none; overflow:visible; height:auto";
  const need = back.offsetHeight;
  back.style.cssText = prev;
  const mh = $("main").clientHeight;
  flash.style.setProperty("--back-h", Math.min(Math.max(need, mh * 0.42), mh * 0.74) + "px");
}

/* ================= 화면 갱신 ================= */
const esc = t => String(t).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);

function updateUI(){
  const fin = S.phase === "finished";
  const cur = S.deck[Math.min(S.idx, S.deck.length - 1)];
  const lv = (cur && cur.level) || S.level || "N5";
  const scr = $("screen");
  scr.style.setProperty("--lv", LV[lv].c); scr.style.setProperty("--lv-strong", LV[lv].s); scr.style.setProperty("--lv-d", LV[lv].d);

  $("qtitle").innerHTML = S.title ? esc(S.title) : `${S.level}<span>${S.isRetry ? "틀린 단어" : LV[S.level].t}</span>`;
  const nOk = S.marks.filter(m => m === true).length, nNg = S.marks.filter(m => m === false).length;
  $("tally").innerHTML = `<span class="t-ok"><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>${nOk}</span>
    <span class="t-ng"><svg viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>${nNg}</span>`;
  $("bar").style.width = (fin ? 100 : (S.idx / S.deck.length) * 100) + "%";

  $("main").style.display = fin ? "none" : "";
  $("bottom").style.display = fin ? "none" : "";
  $("result").classList.toggle("show", fin);
  if (fin) return renderResult();

  const w = cur;
  $("hint2").textContent = w.hint || ""; $("hint2").style.display = w.hint ? "" : "none";
  $("meaning").textContent = w.meaning_ko;
  $("pos").textContent = w.pos || "";
  $("meaningB").textContent = w.meaning_ko;
  $("posB").textContent = w.pos || "";
  $("kanji").textContent = w.word;
  $("reading").textContent = w.reading === w.word ? "" : w.reading;
  $("exJp").innerHTML = renderExample(w.ex || [], w.word, w.reading);
  $("exKo").textContent = w.example_ko || "";
  document.querySelector(".b-ex").style.display = (w.ex && w.ex.length) ? "" : "none";
  $("chipF").textContent = $("chipB").textContent = w.level;
  const isRv = S.review.has(w.id);
  $("rvTagF").classList.toggle("on", isRv); $("rvTagB").classList.toggle("on", isRv);
  syncTools();

  const v = $("verdict"), act = $("action");
  if (S.phase === "answer"){
    v.className = "verdict";
    act.textContent = "제출"; act.disabled = !S.strokes.length;
  } else {
    const ok = S.marks[S.idx];
    v.className = "verdict show " + (ok ? "ok" : "ng");
    v.innerHTML = `${ok ? MARK_OK : MARK_NG}<div class="txt"><div class="h">${ok ? "정답" : "오답"}</div>
      <div class="s">${ok ? "정답 " : `인식 <span class="jp">${esc(S.recog)}</span> · 정답 `}<span class="jp">${esc(w.word)}</span>${ok || w.reading === w.word ? "" : ` (${esc(w.reading)})`}</div></div>
      ${ok ? "" : `<button class="fix-btn" id="fixBtn">맞게 썼어요</button>`}`;
    if (!ok) $("fixBtn").onclick = () => { S.marks[S.idx] = true; undoWrong(w); stamp(true); updateUI(); };
    act.textContent = S.idx + 1 < S.deck.length ? "다음 단어" : "결과 보기";
    act.disabled = false;
  }
}

/* 예문: [본문, 후리가나] 토큰 → <ruby>, 표제어(활용형이면 어간)에 형광펜 */
function renderExample(tokens, word, reading){
  const full = tokens.map(t => t[0]).join("");
  const stem = s => s.replace(/[ぁ-ん]+$/, "");
  let a = -1, b = -1;
  for (const c of [word, stem(word), reading, reading.slice(0, -1)]){
    if (c && full.includes(c)){ a = full.indexOf(c); b = a + c.length; break; }
  }
  let html = "", pos = 0, open = false;
  const toggle = want => { if (want !== open){ html += want ? "<mark>" : "</mark>"; open = want; } };
  for (const [base, rt] of tokens){
    const s0 = pos, s1 = pos + base.length; pos = s1;
    if (rt){ toggle(a >= 0 && s0 < b && s1 > a); html += `<ruby>${esc(base)}<rt>${esc(rt)}</rt></ruby>`; }
    else for (let k = 0; k < base.length; k++){ toggle(a >= 0 && s0 + k >= a && s0 + k < b); html += esc(base[k]); }
  }
  toggle(false);
  return html;
}

function renderResult(){
  const total = S.deck.length, score = S.marks.filter(Boolean).length;
  const wrong = S.deck.filter((_, i) => !S.marks[i]);
  $("scoreNum").innerHTML = `${score}<small> / ${total}</small>`;
  $("scoreMsg").textContent = score === total ? "전부 맞혔어요" : `${wrong.length}개를 틀렸어요`;
  $("review").innerHTML = wrong.length
    ? `<h3>틀린 단어</h3>` + wrong.map(rowHTML).join("")
    : `<div class="perfect">틀린 단어가 없어요.<br>다음 레벨에 도전해 보세요.</div>`;
  const acts = $("actions"); acts.innerHTML = "";
  const add = (label, cls, fn) => { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
  if (wrong.length) add("틀린 단어만 다시 풀기", "primary", () => start(S.level, wrong, S.title));
  add(S.level ? "새 단어로 계속하기" : "오답노트 다시 풀기", wrong.length ? "ghost" : "primary",
      () => S.level ? start(S.level) : start(null, wrongWords(), "오답노트"));
  add("홈으로", "ghost", () => show(S.tab));
}

/* ================= 시작 ================= */
(async function boot(){
  applyMode();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  let words = null;
  try { words = await DB.get("words"); } catch(_) {}
  if (words && words.length){ useWords(words); show("homeView"); }
  else show("setupView");
})();
