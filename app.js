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
const MODES = {
  jp:  {lead:"뜻을 보고 일본어로 써보세요",       sub:"한자, 히라가나 모두 정답으로 인정돼요", title:null},
  ko:  {lead:"일본어를 보고 뜻을 한국어로 써보세요", sub:"뜻이 여러 개면 하나만 맞게 써도 정답이에요", title:"뜻 쓰기"},
  book:{lead:"레벨별 단어장",                   sub:"카드를 누르면 뜻과 예문 해석이 나와요", title:"단어장"},
  test:{lead:"JLPT 문제처럼 풀어보세요",          sub:"읽는 법 · 한자 표기 · 빈칸 채우기, 4개 중 하나를 고르세요", title:"시험"}
};
const S = {qm:"jp", noteMode:null, mode:"vertical", tab:"homeView", level:null, title:"", deck:[], idx:0, marks:[], phase:"answer",
           review:new Set(), isRetry:false, strokes:[], base:null, recog:"", words:[], byId:{}, bank:{}};

/* ================= 저장소 ================= */
const DB = {
  open(){ return new Promise((ok, ng) => { const r = indexedDB.open("jlpt-tango", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); }); },
  async get(k){ const db = await this.open(); return new Promise((ok, ng) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ng(q.error); }); },
  async set(k, v){ const db = await this.open(); return new Promise((ok, ng) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => ok(); t.onerror = () => ng(t.error); }); }
};
const REC_KEY = "jlpt-rec-v1";
const lvMap = v => ({N5:v(),N4:v(),N3:v(),N2:v(),N1:v()});
const emptyRec = () => ({learned:lvMap(() => []), wrong:[], learnedKo:lvMap(() => []), wrongKo:[], learnedTest:lvMap(() => []), wrongTest:[], bookPos:lvMap(() => 0),
                         mode:"jp", ok:0, total:0, days:{}, lastLevel:"N5"});
let REC = emptyRec();
function loadRec(d){
  const e = emptyRec(), r = Object.assign(e, d || {});
  ["learned","learnedKo","learnedTest","bookPos"].forEach(k => r[k] = Object.assign(emptyRec()[k], (d || {})[k] || {}));
  if (!MODES[r.mode]) r.mode = "jp";
  return r;
}
try { REC = loadRec(JSON.parse(localStorage.getItem(REC_KEY) || "{}")); } catch(e) {}
const learnedOf = qm => qm === "ko" ? REC.learnedKo : qm === "test" ? REC.learnedTest : REC.learned;
const wrongKey  = qm => qm === "ko" ? "wrongKo" : qm === "test" ? "wrongTest" : "wrong";
const NOTE_MODES = {jp:"일본어 쓰기", ko:"뜻 쓰기", test:"시험"};
const saveRec = () => { try { localStorage.setItem(REC_KEY, JSON.stringify(REC)); } catch(e) {} };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

function useWords(words){
  KUN = null;
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
  if (S.phase === "answer") requestAnimationFrame(fitFront);
}
addEventListener("resize", applyMode);
addEventListener("orientationchange", () => setTimeout(applyMode, 200));

/* ================= 탭 / 화면 전환 ================= */
function show(view){
  ["setupView","homeView","noteView","statsView","quizView"].forEach(v => $(v).classList.toggle("active", v === view));
  $("screen").classList.toggle("in-quiz", view === "quizView" || view === "setupView");
  $("tabbar").style.display = view === "setupView" ? "none" : "";
  if (view === "quizView" || view === "setupView") return requestAnimationFrame(() => { resizeCanvas(); if (S.phase === "answer") fitFront(); });
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
  const m = REC.mode;
  $("homeLead").textContent = MODES[m].lead; $("homeSub").textContent = MODES[m].sub;
  document.querySelectorAll("#modeSeg button").forEach(b => b.classList.toggle("on", b.dataset.m === m));
  $("decks").innerHTML = "";
  LEVELS.forEach(lv => {
    const total = S.bank[lv].length; if (!total) return;
    const n = m === "book" ? Math.min(REC.bookPos[lv], total) : Math.min(learnedOf(m)[lv].length, total), pct = Math.round(n / total * 100);
    const b = document.createElement("button");
    b.className = "deck";
    b.style.setProperty("--lv", LV[lv].c); b.style.setProperty("--lv-strong", LV[lv].s); b.style.setProperty("--lv-d", LV[lv].d);
    b.innerHTML = `<span class="ring"></span><div class="lvname">${lv}<i></i></div>
      <div class="t">${LV[lv].t}<small>${total.toLocaleString()}단어</small></div>
      <div class="pct"><small>${n.toLocaleString()}개 ${m === "book" ? "봄" : "학습"}</small>${pct}%</div>
      <div class="meter"><i style="width:${Math.max(pct, n ? 2 : 0)}%"></i></div>`;
    b.onclick = () => m === "book" ? startBook(lv) : start(lv, null, "", m);
    $("decks").appendChild(b);
  });
  const nw = Object.keys(NOTE_MODES).reduce((a, k) => a + wrongWords(k).length, 0);
  $("noteDot").textContent = nw; $("noteDot").style.display = nw ? "" : "none";
}

document.querySelectorAll("#modeSeg button").forEach(b => b.onclick = () => {
  REC.mode = b.dataset.m; saveRec(); S.noteMode = null; renderHome(); renderNote();
});

/* ================= 오답노트 (일본어 쓰기 / 뜻 쓰기 따로) ================= */
const wrongWords = (qm = "jp") => REC[wrongKey(qm)].map(id => S.byId[id]).filter(Boolean);
const lvChip = lv => `style="background:${LV[lv].c};color:${LV[lv].d}"`;
function rowHTML(w){
  return `<div class="rv"><div class="kw"><span class="k">${esc(w.word)}</span><span class="r">${w.reading === w.word ? "" : esc(w.reading)}</span></div>
    <div class="m">${esc(w.meaning_ko)}<small>${esc(w.pos || "")}</small></div></div>`;
}
function renderNote(){
  const nm = S.noteMode || (NOTE_MODES[REC.mode] ? REC.mode : "jp");
  const ws = wrongWords(nm);
  let h = `<div class="page-title">오답노트</div>
    <div class="seg note-seg">${Object.keys(NOTE_MODES).map(k => `<button data-n="${k}" class="${k === nm ? "on" : ""}">${NOTE_MODES[k]}<small>${wrongWords(k).length}</small></button>`).join("")}</div>`;
  const bindSeg = () => document.querySelectorAll(".note-seg button").forEach(b => b.onclick = () => { S.noteMode = b.dataset.n; renderNote(); });
  if (!ws.length){
    $("noteView").innerHTML = h + `<div class="panel empty">틀린 단어가 여기에 모여요.<br>다시 맞히면 자동으로 빠져요.</div>`;
    return bindSeg();
  }
  h += `<div class="note-cta"><div class="n">${ws.length}</div><div class="l">다시 맞힐 때까지<br>남아 있는 단어</div><button id="noteGo">오답만 풀기</button></div>
    <p class="note-tip">레벨 학습에도 오답이 한 번에 최대 ${REVIEW_MAX}개씩 섞여 나와요. 맞히면 여기서 빠져요.</p>`;
  LEVELS.forEach(lv => {
    const list = ws.filter(w => w.level === lv);
    if (!list.length) return;
    h += `<div class="panel"><h3><span class="chip-lv" ${lvChip(lv)}>${lv}</span>${LV[lv].t}<small style="color:var(--ink-3);font-weight:500">${list.length}개</small></h3>${list.map(rowHTML).join("")}</div>`;
  });
  $("noteView").innerHTML = h; bindSeg();
  $("noteGo").onclick = () => start(null, wrongWords(nm), "오답노트", nm);
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
    REC = loadRec(d.rec); saveRec(); show(S.tab);
  } catch(_) { alertBox("백업 파일을 읽지 못했어요."); }
};
function alertBox(t){ const m = document.createElement("div"); m.className = "toast"; m.textContent = t; $("screen").appendChild(m); setTimeout(() => m.remove(), 2600); }

/* ================= 문제 구성 ================= */
function shuffle(a){ a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function setQM(qm){
  S.qm = qm;
  ["qm-jp","qm-ko","qm-book","qm-test"].forEach(c => $("screen").classList.toggle(c, c === "qm-" + qm));
}
function start(lv, words, title, qm = "jp"){
  if (lv){ REC.lastLevel = lv; saveRec(); }
  setQM(qm);
  S.level = lv; S.title = title || ""; S.idx = 0; S.marks = []; S.isRetry = !!words; S.review = new Set();
  if (words){
    S.deck = shuffle(qm === "test" ? words.filter(canExam) : words).slice(0, ROUND);
  } else {
    // 1) 이 레벨의 오답 최대 4개  2) 아직 안 맞힌 새 단어  3) 모자라면 이미 맞힌 단어
    const rv = shuffle(wrongWords(qm).filter(w => w.level === lv)).slice(0, REVIEW_MAX);
    rv.forEach(w => S.review.add(w.id));
    const learned = new Set(learnedOf(qm)[lv]);
    const pool = S.bank[lv].filter(w => !S.review.has(w.id) && (qm !== "test" || canExam(w)));
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
  $("hint").textContent = S.qm === "ko" ? "뜻을 한국어로 쓰세요" : "여기에 쓰세요";
  S.q = S.qm === "test" ? makeExam(S.deck[S.idx]) : null;
  redraw(); syncTools(); updateUI(); fitFront();
  if (S.qm === "test"){ document.querySelector(".q-card").scrollTop = 0; $("exam").scrollTop = 0; }
}

/* ================= 시험: JLPT 문자·어휘 형식 4지선다 =================
   ① 한자 읽기  ② 한자 표기  ③ 빈칸 채우기 — 예문 속 표제어로 문제를 만듦 */
const HAS_KANJI = /[\u3400-\u9fff々]/;
const exText = w => (w.ex || []).map(t => t[0]).join("");
const canExam = w => { const t = exText(w); return !!t && t.includes(w.word); };
const kanaOnly = s => !HAS_KANJI.test(s);
const DAK = {}; ["かが","きぎ","くぐ","けげ","こご","さざ","しじ","すず","せぜ","そぞ","ただ","ちぢ","つづ","てで","とど","はば","ひび","ふぶ","へべ","ほぼ"]
  .forEach(([a, b]) => { DAK[a] = b; DAK[b] = a; });
["はぱ","ひぴ","ふぷ","へぺ","ほぽ"].forEach(([a, b]) => { DAK[b] = a; });
const O_ROW = "おこごそぞとどのほぼぽもよろょ", E_ROW = "えけげせぜてでねへべぺめれ";
const SMALL2 = {"ゃ":"や","ゅ":"ゆ","ょ":"よ"}, LARGE2 = {"や":"ゃ","ゆ":"ゅ","よ":"ょ"};
function readingFakes(r){        // 실제 시험처럼 탁음·장음·촉음·요음을 살짝 바꾼 오답
  const out = new Set(), a = [...r];
  a.forEach((c, i) => {
    if (DAK[c] && a[i - 1] !== "っ") out.add(a.slice(0, i).join("") + DAK[c] + a.slice(i + 1).join(""));
    if (c === "は" || c === "ひ" || c === "ふ" || c === "へ" || c === "ほ") out.add(a.slice(0, i).join("") + String.fromCharCode(c.charCodeAt(0) + 2) + a.slice(i + 1).join(""));
    if (SMALL2[c]) out.add(a.slice(0, i).join("") + SMALL2[c] + a.slice(i + 1).join(""));
    if (LARGE2[c] && i > 0 && "きぎしじちにひびぴみり".includes(a[i - 1])) out.add(a.slice(0, i).join("") + LARGE2[c] + a.slice(i + 1).join(""));
    if (c === "っ") out.add(a.slice(0, i).join("") + a.slice(i + 1).join(""));
    if (c === "う" && i > 0 && O_ROW.includes(a[i - 1])) out.add(a.slice(0, i).join("") + a.slice(i + 1).join(""));
    if (c === "い" && i > 0 && E_ROW.includes(a[i - 1])) out.add(a.slice(0, i).join("") + a.slice(i + 1).join(""));
    if (i < a.length - 1 && O_ROW.includes(c) && !"うっんゃゅょ".includes(a[i + 1])) out.add(a.slice(0, i + 1).join("") + "う" + a.slice(i + 1).join(""));
    if (i > 0 && i < a.length - 1 && !"っんーゃゅょぁぃぅぇぉ".includes(a[i - 1]) && "かきくけこさしすせそたちつてとぱぴぷぺぽ".includes(c)) out.add(a.slice(0, i).join("") + "っ" + a.slice(i).join(""));
    if (c === "ん" && i > 0) out.add(a.slice(0, i).join("") + a.slice(i + 1).join(""));
  });
  out.delete(r); out.delete("");
  return shuffle([...out]);
}
let KUN = null, KLV = null;
const lvNum = lv => 6 - +String(lv).slice(1);      // N5→1 … N1→5 (어려울수록 큼)
function kunMap(){     // 한자 한 글자 단어에서 「한자 → 읽는 소리」 모음 (+ 그 한자가 처음 나오는 레벨)
  if (KUN) return KUN;
  KUN = {}; KLV = {};
  S.words.forEach(x => [...x.word].forEach(c => { if (HAS_KANJI.test(c)) KLV[c] = Math.min(KLV[c] || 9, lvNum(x.level)); }));
  S.words.forEach(x => { const m = x.word.match(/^(.)([ぁ-ん]*)$/);
    if (m && HAS_KANJI.test(m[1]) && x.reading.endsWith(m[2]) && x.reading.length > m[2].length)
      (KUN[m[1]] = KUN[m[1]] || new Set()).add(x.reading.slice(0, x.reading.length - m[2].length)); });
  return KUN;
}
const firstPos = w => String(w.pos || "").split(/[·・,\s]/)[0];
function pickOthers(list, n, ok){ const r = []; for (const x of shuffle(list)) { if (r.length >= n) break; if (ok(x) && !r.includes(x)) r.push(x); } return r; }
function makeExam(w){
  const text = exText(w), at = text.indexOf(w.word);
  const before = esc(text.slice(0, at)), after = esc(text.slice(at + w.word.length));
  const hasK = HAS_KANJI.test(w.word) && w.reading && w.reading !== w.word;
  const formal = w.level === "N1" || w.level === "N2" || w.level === "N3";
  const types = hasK ? ["read", "write", "blank"] : ["blank"];
  let type = types[Math.random() * types.length | 0], correct, others = [], ins, sent;

  if (type === "read"){
    correct = w.reading;
    others = readingFakes(w.reading).slice(0, 3);
    if (others.length < 3) others = others.concat(pickOthers(S.words.map(x => x.reading), 3 - others.length,
      r => r !== correct && !others.includes(r) && Math.abs(r.length - correct.length) <= 1 && r[0] === correct[0]));
    if (others.length < 3) type = "blank";
    else {
      ins = formal ? "＿＿＿の言葉の読み方として最もよいものを、1・2・3・4から一つえらびなさい。" : "＿＿＿の ことばは ひらがなで どう かきますか。";
      sent = `${before}<u>${esc(w.word)}</u>${after}`;
    }
  }
  if (type === "write"){
    correct = w.word;
    const len = [...w.word].length, ks = [...w.word].filter(c => HAS_KANJI.test(c));
    const same = x => x.word !== w.word && x.reading !== w.reading && [...x.word].length === len && HAS_KANJI.test(x.word);
    others = pickOthers(S.words, 3, x => same(x) && [...x.word].some(c => ks.includes(c))).map(x => x.word);
    // 한 글자 + 오쿠리가나 단어: 읽는 소리가 같은(또는 비슷한) 다른 한자로 바꾼 가짜 표기 (例: 濡れる → 塗れる)
    const m1 = w.word.match(/^(.)([ぁ-ん]*)$/);
    if (m1 && HAS_KANJI.test(m1[1]) && w.reading.endsWith(m1[2])){
      const kr = w.reading.slice(0, w.reading.length - m1[2].length), km = kunMap();
      const easy = k => KLV[k] <= lvNum(w.level) + 1;      // 문제 레벨보다 너무 어려운 한자는 빼기
      const sameR = Object.keys(km).filter(k => k !== m1[1] && easy(k) && km[k].has(kr));
      const nearR = Object.keys(km).filter(k => k !== m1[1] && easy(k) && [...km[k]].some(r => r[0] === kr[0] && r.length === kr.length));
      for (const k of [...shuffle(sameR), ...shuffle(nearR)]){
        if (others.length >= 3) break;
        const f = k + m1[2];
        if (!others.includes(f) && !S.words.some(x => x.word === f && x.reading === w.reading)) others.push(f);
      }
    }
    // 그래도 모자라면 한자 한 글자를 다른 단어의 한자로 바꾼 가짜 표기
    const kpool = S.bank[w.level].flatMap(x => [...x.word].filter(c => HAS_KANJI.test(c)));
    for (let t = 0; others.length < 3 && t < 40; t++){
      const a = [...w.word], idx = a.map((c, i) => HAS_KANJI.test(c) ? i : -1).filter(i => i >= 0);
      a[idx[Math.random() * idx.length | 0]] = kpool[Math.random() * kpool.length | 0];
      const f = a.join("");
      if (f !== w.word && !others.includes(f) && !S.words.some(x => x.word === f && x.reading === w.reading)) others.push(f);
    }
    ins = formal ? "＿＿＿の言葉を漢字で書くとき、最もよいものを、1・2・3・4から一つえらびなさい。" : "＿＿＿の ことばは どう かきますか。";
    sent = `${before}<u>${esc(w.reading)}</u>${after}`;
  }
  if (type === "blank"){
    correct = w.word;
    const pos = firstPos(w), len = [...w.word].length;
    const ok = x => x.word !== w.word && x.meaning_ko !== w.meaning_ko && !text.includes(x.word) && x.reading !== w.reading;
    others = pickOthers(S.bank[w.level], 3, x => ok(x) && firstPos(x) === pos && Math.abs([...x.word].length - len) <= 1).map(x => x.word);
    if (others.length < 3) others = others.concat(pickOthers(S.bank[w.level], 3 - others.length, x => ok(x) && firstPos(x) === pos && !others.includes(x.word)).map(x => x.word));
    if (others.length < 3) others = others.concat(pickOthers(S.words, 3 - others.length, x => ok(x) && !others.includes(x.word)).map(x => x.word));
    ins = formal ? "（　　）に入れるのに最もよいものを、1・2・3・4から一つえらびなさい。" : "（　　）に なにを いれますか。";
    sent = `${before}<span class="blank">（　　）</span>${after}`;
  }
  const opts = shuffle([correct, ...others.slice(0, 3)]);
  return {type, ins, sent, opts, answer: opts.indexOf(correct), picked: -1};
}
function renderExam(w){
  const q = S.q, done = S.phase !== "answer";
  const no = {read:1, write:2, blank:3}[q.type];
  $("qIns").innerHTML = `<b>もんだい${no}</b>${esc(q.ins)}`;
  $("qSent").innerHTML = done && q.type === "blank"
    ? q.sent.replace('<span class="blank">（　　）</span>', `<u>${esc(w.word)}</u>`) : q.sent;
  $("qKo").textContent = w.example_ko || ""; $("qKo").classList.toggle("show", done && !!w.example_ko);
  $("chipQ").textContent = w.level; $("rvTagQ").classList.toggle("on", S.review.has(w.id));
  const gloss = t => { if (!done || q.type === "read") return ""; const x = S.words.find(v => v.word === t); return x ? esc(x.meaning_ko) : ""; };
  $("qOpts").innerHTML = q.opts.map((t, i) => {
    const cls = !done ? "" : i === q.answer ? "right" : i === q.picked ? "wrong" : "dim";
    return `<button class="opt ${cls}" data-i="${i}" ${done ? "disabled" : ""}><span class="no">${i + 1}</span><span class="tx"><span class="w">${esc(t)}</span><span class="gl">${gloss(t)}</span></span></button>`;
  }).join("");
  if (!done) $("qOpts").querySelectorAll(".opt").forEach(b => b.onclick = () => pickOption(+b.dataset.i));
  $("exam").classList.toggle("done", done);
  if (done && S.mode === "vertical") requestAnimationFrame(() => {   // 보기와 뜻이 다 보이도록 아래로
    const ex = $("exam"); ex.scrollTo({top: ex.scrollHeight, behavior: "smooth"}); });
}
function pickOption(i){
  if (S.phase !== "answer") return;
  const w = S.deck[S.idx];
  S.q.picked = i;
  S.recog = S.q.opts[i];
  finishGrade(w, i === S.q.answer);
}

/* ================= 단어장 ================= */
function startBook(lv){
  REC.lastLevel = lv; saveRec();
  setQM("book");
  S.level = lv; S.title = ""; S.deck = S.bank[lv]; S.marks = []; S.review = new Set(); S.isRetry = false;
  S.idx = Math.min(REC.bookPos[lv] || 0, S.deck.length - 1);
  S.phase = "book"; clearStamp(); $("flash").classList.remove("flipped");
  updateUI(); show("quizView");
}
function bookGo(d){
  const n = S.deck.length;
  S.idx = d > 0 && S.idx >= n - 1 ? 0 : Math.max(0, Math.min(n - 1, S.idx + d));
  REC.bookPos[S.level] = S.idx; saveRec();
  const wasFlipped = $("flash").classList.contains("flipped");
  $("flash").classList.remove("flipped");
  if (wasFlipped){ fillFront(S.deck[S.idx]); updateBookBar(); setTimeout(updateUI, 320); }
  else updateUI();
}
$("flash").addEventListener("click", () => { if (S.phase === "book") $("flash").classList.toggle("flipped"); });
$("prevBtn").onclick = () => bookGo(-1);

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
  drawing = [pt(e)]; drawing.t = [Date.now()]; S.strokes.push(drawing); redraw(); syncTools();
});
cv.addEventListener("pointermove", e => { if (!drawing) return; e.preventDefault(); drawing.push(pt(e)); drawing.t.push(Date.now()); redraw(); });
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
/* 1순위: Google 손글씨 인식 (여러 글자를 통째로 인식)
   2순위: 기기 안 인식 (인터넷이 없거나 Google 응답이 없을 때만) */
const GOOGLE_HW = [
  ["https://inputtools.google.com/request?itc=ja-t-i0-handwrit&app=translate", "text/plain;charset=UTF-8"],
  ["https://inputtools.google.com/request?itc=ja-t-i0-handwrit&app=translate", "application/json; charset=UTF-8"],
  ["https://www.google.com/inputtools/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8", "text/plain;charset=UTF-8"],
  ["https://www.google.com/inputtools/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8", "application/json; charset=UTF-8"],
];
async function googleRecognize(strokes, lang = "ja"){
  const ink = strokes.map(s => [s.map(p => Math.round(p[0])), s.map(p => Math.round(p[1])), s.t ? s.t.map(t => t - s.t[0]) : s.map((_, i) => i * 16)]);
  const body = JSON.stringify({app_version:0.4, api_level:"537.36", device:navigator.userAgent, input_type:0, options:"enable_pre_space",
    requests:[{writing_guide:{writing_area_width:Math.round(S.base[0]), writing_area_height:Math.round(S.base[1])},
               pre_context:"", max_num_results:10, max_completions:0, language:lang, ink}]});
  // 지난번에 성공한 방식부터 시도
  let first = 0; try { first = +(localStorage.getItem("jlpt-hw-ep") || 0); } catch(_) {}
  const order = [first, ...GOOGLE_HW.keys()].filter((v, i, a) => a.indexOf(v) === i && GOOGLE_HW[v]);
  for (const k of order){
    const [url, type] = GOOGLE_HW[k];
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 3500);
    try {
      const res = await fetch(url, {method:"POST", mode:"cors", credentials:"omit", signal:ctl.signal, headers:{"Content-Type":type}, body});
      const j = await res.json();
      if (j[0] === "SUCCESS" && j[1] && j[1][0] && Array.isArray(j[1][0][1])){
        localStorage.setItem("jlpt-hw-ep", k);
        return j[1][0][1];
      }
    } catch(e) {
      if (e.name === "AbortError" && !navigator.onLine) break;
    } finally { clearTimeout(timer); }
  }
  return null;
}
async function waitLocal(){
  if (window.KanjiCanvas && KanjiCanvas.refPatterns.length) return;
  await new Promise(r => { const t = setInterval(() => { if (window.KanjiCanvas && KanjiCanvas.refPatterns.length){ clearInterval(t); r(); } }, 100); });
}
async function gradeHandwriting(w){
  const ans = answers(w), key = a => a.join("");
  const keys = new Set(ans.map(key));
  const cands = await googleRecognize(S.strokes);
  if (cands && cands.length){
    const hit = cands.find(c => keys.has(key(normStr(c))));
    S.recog = hit ? w.word : cands[0];
    return !!hit;
  }
  alertBox(navigator.onLine ? "온라인 인식에 연결하지 못해 기기 안 인식으로 채점했어요" : "인터넷이 없어 기기 안 인식으로 채점했어요");
  await waitLocal();
  const r = HWSEG.match(S.strokes, ans);
  S.recog = r.ok ? w.word : (r.guess || "？");
  return r.ok;
}

/* 뜻 쓰기: 한국어 뜻 비교 — 「/ , ·」로 나눈 뜻 중 하나와 같으면 정답. 괄호 속 설명은 있어도 없어도 됨, 「~하다」 유무도 허용 */
const normKo = t => String(t).replace(/[^가-힣a-zA-Z0-9]/g, "");
const koVariants = t => { const a = normKo(t); const v = new Set([a]); const m = a.match(/^(.+?)(하다|되다)$/); if (m) v.add(m[1]); return v; };
function koAnswers(w){
  const set = new Set();
  String(w.meaning_ko).split(/[\/,;·、]|\s~\s/).forEach(part => {
    [part.replace(/[(（〔\[][^)）〕\]]*[)）〕\]]/g, ""), part].forEach(p => { if (normKo(p)) koVariants(p).forEach(x => set.add(x)); });
  });
  return set;
}
async function gradeKorean(w){
  const cands = await googleRecognize(S.strokes, "ko");
  if (!cands || !cands.length) return null;        // 인식 불가 → 직접 채점
  const ans = koAnswers(w);
  const hit = cands.find(c => [...koVariants(c)].some(x => x && ans.has(x)));
  S.recog = hit ? w.meaning_ko : cands[0];
  return !!hit;
}

function recordResult(w, ok){
  const L = learnedOf(S.qm), K = wrongKey(S.qm);
  REC.total++; if (ok) REC.ok++;
  const d = today(); REC.days[d] = (REC.days[d] || 0) + 1;
  if (ok){
    if (!L[w.level].includes(w.id)) L[w.level].push(w.id);
    REC[K] = REC[K].filter(x => x !== w.id);
  } else if (!REC[K].includes(w.id)) REC[K].push(w.id);
  saveRec();
}
function undoWrong(w){   // 「맞게 썼어요」: 인식 오류 바로잡기
  const L = learnedOf(S.qm), K = wrongKey(S.qm);
  REC.ok++;
  if (!L[w.level].includes(w.id)) L[w.level].push(w.id);
  REC[K] = REC[K].filter(x => x !== w.id);
  saveRec();
}

async function submit(){
  const w = S.deck[S.idx];
  S.phase = "grading"; syncTools(); $("action").disabled = true; $("action").textContent = "채점 중…";
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const ok = S.qm === "ko" ? await gradeKorean(w) : await gradeHandwriting(w);
  $("flash").classList.add("flipped");
  if (ok === null){   // 인터넷이 없어 한국어를 인식할 수 없음 → 정답을 보고 직접 채점
    S.phase = "self"; updateUI(); fitBack(); return;
  }
  finishGrade(w, ok);
}
function finishGrade(w, ok){
  S.marks[S.idx] = ok; S.phase = "checked";
  recordResult(w, ok);
  updateUI();
  if (S.qm !== "test"){ fitBack(); stamp(ok); }
}
$("action").onclick = () => {
  if (S.phase === "book") return bookGo(1);
  if (S.phase === "answer") submit(); else if (S.phase === "checked") next();
};
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

function fitFront(){
  const flash = $("flash"), front = document.querySelector(".front");
  if (S.mode !== "vertical" || S.qm !== "ko") { flash.style.removeProperty("--front-h"); return; }
  const fj = front.querySelector(".f-jp"), prev = front.style.cssText, prevJ = fj.style.cssText;
  front.style.cssText = "position:static; visibility:hidden; overflow:visible; height:auto";
  fj.style.cssText = "height:auto";
  const need = front.offsetHeight;
  front.style.cssText = prev; fj.style.cssText = prevJ;
  const mh = $("main").clientHeight;
  if (!mh) return;      // 화면이 아직 안 보일 때는 나중에 다시 계산
  flash.style.setProperty("--front-h", Math.min(Math.max(need, mh * 0.34), mh * 0.6) + "px");
}

/* ================= 화면 갱신 ================= */
const esc = t => String(t).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);

function updateUI(){
  const fin = S.phase === "finished";
  const cur = S.deck[Math.min(S.idx, S.deck.length - 1)];
  const lv = (cur && cur.level) || S.level || "N5";
  const scr = $("screen");
  scr.style.setProperty("--lv", LV[lv].c); scr.style.setProperty("--lv-strong", LV[lv].s); scr.style.setProperty("--lv-d", LV[lv].d);

  const sub = S.isRetry ? "틀린 단어" : (MODES[S.qm].title || LV[S.level].t);
  $("qtitle").innerHTML = S.title ? esc(S.title) + (S.qm === "ko" ? `<span>뜻 쓰기</span>` : "") : `${S.level}<span>${sub}</span>`;
  const nOk = S.marks.filter(m => m === true).length, nNg = S.marks.filter(m => m === false).length;
  $("tally").innerHTML = `<span class="t-ok"><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>${nOk}</span>
    <span class="t-ng"><svg viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>${nNg}</span>`;
  updateBookBar(fin);

  $("main").style.display = fin ? "none" : "";
  $("bottom").style.display = fin ? "none" : "";
  $("result").classList.toggle("show", fin);
  if (fin) return renderResult();

  const w = cur;
  fillFront(w);
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
  if (S.qm === "test") renderExam(w);
  if (S.phase === "book"){
    $("prevBtn").disabled = S.idx === 0;
    $("action").disabled = false;
    $("action").textContent = S.idx >= S.deck.length - 1 ? "처음부터" : "다음";
    return;
  }
  syncTools();

  const v = $("verdict"), act = $("action");
  // 시험: 보기마다 뜻이 붙으므로 결과 칸에는 읽기 문제일 때만 뜻을 덧붙임
  const ansHTML = S.qm === "test" ? `<span class="jp">${esc(S.q.opts[S.q.answer])}</span>` + (S.q.type === "read" ? ` · ${esc(w.word)} · ${esc(w.meaning_ko)}` : w.reading === w.word ? "" : ` (${esc(w.reading)})`)
    : S.qm === "ko" ? esc(w.meaning_ko)
    : `<span class="jp">${esc(w.word)}</span>` + (w.reading === w.word ? "" : ` (${esc(w.reading)})`);
  if (S.phase === "self"){
    v.className = "verdict show";
    v.innerHTML = `<div class="txt"><div class="h">직접 채점</div><div class="s">인터넷이 없어 인식하지 못했어요</div></div>
      <div class="self-btns"><button class="fix-btn" id="selfOk">맞았어요</button><button class="fix-btn" id="selfNg">틀렸어요</button></div>`;
    $("selfOk").onclick = () => finishGrade(w, true);
    $("selfNg").onclick = () => { S.recog = "—"; finishGrade(w, false); };
    act.textContent = "채점하고 넘어가기"; act.disabled = true;
    return;
  }
  if (S.phase === "answer"){
    v.className = "verdict";
    act.textContent = S.qm === "test" ? "보기를 고르세요" : "제출"; act.disabled = S.qm === "test" || !S.strokes.length;
  } else {
    const ok = S.marks[S.idx];
    v.className = "verdict show " + (ok ? "ok" : "ng");
    v.innerHTML = `${ok ? MARK_OK : MARK_NG}<div class="txt"><div class="h">${ok ? "정답" : "오답"}</div>
      <div class="s">${ok ? "정답 " : `${S.qm === "test" ? "고른 답" : "인식"} <span class="jp">${esc(S.recog)}</span> · 정답 `}${ok && S.qm === "jp" ? `<span class="jp">${esc(w.word)}</span>` : ansHTML}</div></div>
      ${ok || S.qm === "test" ? "" : `<button class="fix-btn" id="fixBtn">맞게 썼어요</button>`}`;
    if (!ok && S.qm !== "test") $("fixBtn").onclick = () => { S.marks[S.idx] = true; undoWrong(w); stamp(true); updateUI(); };
    act.textContent = S.idx + 1 < S.deck.length ? (S.qm === "test" ? "다음 문제" : "다음 단어") : "결과 보기";
    act.disabled = false;
  }
}

function updateBookBar(fin){
  $("bar").style.width = (fin ? 100 : S.phase === "book" ? (S.idx + 1) / S.deck.length * 100 : (S.idx / S.deck.length) * 100) + "%";
}
/* 앞면: 일본어 쓰기는 뜻, 뜻 쓰기·단어장은 단어 + 예문 */
function fillFront(w){
  $("fReading").textContent = w.reading === w.word ? "" : w.reading;
  $("fKanji").textContent = w.word;
  $("flash").style.setProperty("--len", Math.max(2, [...w.word].length));
  const hasEx = w.ex && w.ex.length;
  $("fEx").innerHTML = hasEx ? renderExample(w.ex, w.word, w.reading) : "";
  $("fExBox").style.display = hasEx ? "" : "none";
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
  const qm = S.qm;
  if (wrong.length) add("틀린 단어만 다시 풀기", "primary", () => start(S.level, wrong, S.title, qm));
  add(S.level ? "새 단어로 계속하기" : "오답노트 다시 풀기", wrong.length ? "ghost" : "primary",
      () => S.level ? start(S.level, null, "", qm) : start(null, wrongWords(qm), "오답노트", qm));
  add("홈으로", "ghost", () => show(S.tab));
}

/* ================= 시작 ================= */
(async function boot(){
  applyMode();
  if ("serviceWorker" in navigator){
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && !window.__reloaded){ window.__reloaded = true; location.reload(); } });
    navigator.serviceWorker.register("sw.js", {updateViaCache:"none"}).then(r => r.update()).catch(() => {});
  }
  let words = null;
  try { words = await DB.get("words"); } catch(_) {}
  if (words && words.length){ useWords(words); show("homeView"); }
  else show("setupView");
})();
