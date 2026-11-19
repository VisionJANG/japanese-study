/* VOCABOX (JLPT) — 웹앱 본체
   - 단어 데이터: 처음 한 번 파일에서 불러와 IndexedDB에 저장 (웹 페이지에는 단어 데이터 없음)
   - 학습 기록: localStorage
   - 손글씨 채점: KanjiCanvas (iPhone 안에서만 동작) — 한 칸에 한 글자 */
"use strict";

const ROUND = 20;          // 한 회차 문제 수
const REVIEW_MAX = 4;      // 레벨 학습에 섞는 오답 단어 수 (최대)
const TOP_N = 10;          // 글자마다 인식 후보 몇 개까지 정답으로 볼지
const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const LV = {   // c: 옅은 바탕, s: 진행 막대, d: 글자, p: 포스트잇 종이색
  N5:{t:"입문",   c:"#FFF4CF", s:"#F5B400", d:"#9A6B00", p:"#FFEB8A"},
  N4:{t:"초급",   c:"#FFE5E0", s:"#F2624C", d:"#C23D29", p:"#FFCFC6"},
  N3:{t:"중급",   c:"#DBF6EA", s:"#17B07A", d:"#0B7D55", p:"#C8F0D8"},
  N2:{t:"중상급", c:"#E0ECFF", s:"#3A7DF0", d:"#1F5FC8", p:"#CFE2FF"},
  N1:{t:"상급",   c:"#EEE6FF", s:"#8B5CF6", d:"#6A3FD6", p:"#E4D8FF"}
};

const $ = id => document.getElementById(id);
const MODES = {
  book:{desc:"카드를 누르면 뜻과 예문 해석이 나와요", title:"단어장"},
  jp:  {desc:"뜻을 보고 한자나 히라가나로 써보세요", title:null},
  ko:  {desc:"일본어를 보고 뜻을 한국어로 써보세요", title:"뜻 쓰기"},
  test:{desc:"JLPT처럼 4개 중 정답을 고르는 문제예요", title:"시험"}
};
const S = {qm:"jp", noteMode:null, mode:"vertical", tab:"mainView", area:null, level:null, title:"", deck:[], idx:0, marks:[], phase:"answer",
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
                         mode:"book", ok:0, total:0, days:{}, lastLevel:"N5"});
let REC = emptyRec();
function loadRec(d){
  const e = emptyRec(), r = Object.assign(e, d || {});
  ["learned","learnedKo","learnedTest","bookPos"].forEach(k => r[k] = Object.assign(emptyRec()[k], (d || {})[k] || {}));
  if (!MODES[r.mode]) r.mode = "book";
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
const STUDY_VIEWS = ["mainView", "homeView", "secView"];      // 하단 「학습」 탭에 속하는 화면
function show(view){
  ["setupView","mainView","homeView","secView","noteView","statsView","quizView"].forEach(v => $(v).classList.toggle("active", v === view));
  $("screen").classList.toggle("in-quiz", view === "quizView" || view === "setupView");
  $("tabbar").style.display = view === "setupView" || view === "mainView" ? "none" : "";   // 처음 화면에서는 하단 탭 숨김
  if (view === "quizView" || view === "setupView") return requestAnimationFrame(() => { resizeCanvas(); if (S.phase === "answer") fitFront(); });
  S.tab = view;
  if (view === "homeView" || view === "secView") S.lastStudy = view;    // 「학습」 탭을 누르면 마지막으로 보던 영역으로
  const tabOf = STUDY_VIEWS.includes(view) ? "mainView" : view;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === tabOf));
  renderMain(); renderHome(); renderNote(); renderStats();
}
document.querySelectorAll(".tab").forEach(t => t.onclick = () => show(t.dataset.tab === "mainView" ? (S.lastStudy || "homeView") : t.dataset.tab));

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
    setTimeout(() => show("mainView"), 500);
  } catch(err){
    msg.className = "setup-msg err";
    msg.textContent = "단어 파일을 읽지 못했어요. words_personal.json 파일인지 확인해 주세요.";
  }
};

/* ================= 홈 ================= */
const learnedCount = lv => REC.learned[lv].length;
function renderHome(){
  const m = REC.mode;
  $("homeSub").textContent = MODES[m].desc;
  document.querySelectorAll("#modeSeg button").forEach(b => b.classList.toggle("on", b.dataset.m === m));
  $("decks").innerHTML = "";
  LEVELS.forEach(lv => {
    const total = S.bank[lv].length; if (!total) return;
    const n = m === "book" ? Math.min(REC.bookPos[lv], total) : Math.min(learnedOf(m)[lv].length, total), pct = Math.round(n / total * 100);
    const b = document.createElement("button");
    b.className = "deck";
    b.style.setProperty("--lv", LV[lv].c); b.style.setProperty("--lv-strong", LV[lv].s); b.style.setProperty("--lv-d", LV[lv].d); b.style.setProperty("--pi", LV[lv].p);
    b.innerHTML = `<div><div class="lvname">${lv}</div>
      <div class="t">${LV[lv].t}<small>${total.toLocaleString()}단어</small></div></div>
      <div class="foot"><div class="pct"><small>${n.toLocaleString()}개 ${m === "book" ? "봄" : "학습"}</small>${pct}%</div>
      <div class="meter"><i style="width:${Math.max(pct, n ? 2 : 0)}%"></i></div></div>`;
    b.onclick = () => m === "book" ? startBook(lv) : start(lv, null, "", m);
    $("decks").appendChild(b);
  });
  const nw = Object.keys(NOTE_MODES).reduce((a, k) => a + wrongWords(k).length, 0);
  $("noteDot").textContent = nw; $("noteDot").style.display = nw ? "" : "none";
}

document.querySelectorAll("#modeSeg button").forEach(b => b.onclick = () => {
  REC.mode = b.dataset.m; saveRec(); S.noteMode = null; renderHome(); renderNote();
});

/* ================= 처음 화면: 청해 · 단어 · 문법 · 독해 ================= */
const GO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
const AREAS = {
  listen: {ko:"청해", jp:"聴解", c:"#F2624C", cd:"#C23D29", cs:"#FFE5E0", ready:false,
    desc:"대화와 설명을 듣고 알맞은 답을 골라요",
    intro:"음성을 듣고 질문에 답하는 연습이에요. 실제 시험처럼 문제를 한 번만 들려줘요.",
    types:[["課題理解","과제 이해","대화를 듣고 다음에 할 일을 고르기"],["ポイント理解","포인트 이해","이유나 핵심 정보를 골라 듣기"],
           ["概要理解","개요 이해","말하는 사람의 생각이나 주제 파악하기"],["発話表現","발화 표현","그림 상황에 맞는 말 고르기"],
           ["即時応答","즉시 응답","짧은 말을 듣고 바로 알맞은 대답 고르기"],["統合理解","통합 이해","여러 정보를 비교하며 듣기 (N2·N1)"]]},
  vocab:  {ko:"단어", jp:"語彙", c:"#2F5BEA", cd:"#1E44C4", cs:"#E3EAFF", ready:true,
    desc:"단어장 · 일본어 쓰기 · 뜻 쓰기 · 시험"},
  grammar:{ko:"문법", jp:"文法", c:"#17B07A", cd:"#0B7D55", cs:"#DBF6EA", ready:false,
    desc:"문형을 익히고 문장을 완성해요",
    intro:"레벨별 문형을 예문과 함께 익히고, 시험 형식으로 확인해요.",
    types:[["文法形式の判断","문법 형식 판단","문장에 맞는 문형 고르기"],["文の組み立て","문장 만들기","단어를 순서대로 놓아 문장 완성하기 (★ 위치)"],
           ["文章の文法","글의 문법","글의 흐름에 맞는 표현 고르기"]]},
  read:   {ko:"독해", jp:"読解", c:"#8B5CF6", cd:"#6A3FD6", cs:"#EEE6FF", ready:false,
    desc:"지문을 읽고 내용을 파악해요",
    intro:"짧은 글부터 긴 글까지 읽고 내용과 필자의 생각을 파악하는 연습이에요.",
    types:[["内容理解（短文）","내용 이해 · 단문","생활·업무 관련 짧은 글"],["内容理解（中文）","내용 이해 · 중문","설명문·수필 등 중간 길이 글"],
           ["内容理解（長文）","내용 이해 · 장문","긴 글의 요지와 필자의 생각 (N3 이상)"],["統合理解","통합 이해","여러 글을 비교하며 읽기 (N2·N1)"],
           ["主張理解","주장 이해","논리적인 글에서 주장 파악하기 (N2·N1)"],["情報検索","정보 검색","광고·안내문에서 필요한 정보 찾기"]]}
};
const AREA_ORDER = ["listen", "vocab", "grammar", "read"];
function renderMain(){
  $("areas").innerHTML = AREA_ORDER.map(k => { const a = AREAS[k];
    return `<button class="area ${a.ready ? "" : "wait"}" data-a="${k}" style="--c:${a.c}; --cd:${a.cd}; --cs:${a.cs}">
      <span class="jp">${a.jp}</span><h2>${a.ko}</h2><p>${a.desc}</p>
      <div class="ft">${a.ready ? `<span>시작하기</span><span class="go">${GO}</span>` : `<span></span><span class="stamp-wait">準備中</span>`}</div></button>`; }).join("");
  $("areas").querySelectorAll(".area").forEach(b => b.onclick = () => b.dataset.a === "vocab" ? show("homeView") : openArea(b.dataset.a));
}
function openArea(k){
  const a = AREAS[k]; S.area = k;
  $("secView").innerHTML = `
    <div class="page-head"><button class="ph-back" id="secBack" aria-label="처음 화면으로">${BACK}</button>
      <div class="ph-t"><span class="ph-jp">${a.jp}</span><h1>${a.ko}</h1></div></div>
    <p class="sv-desc">${a.intro}</p>
    <div class="memo"><b>준비 중이에요</b><span>문제가 들어오면 이 화면에서 레벨과 유형을 골라 풀 수 있어요.</span></div>
    <div class="sv-lv">${LEVELS.map(lv => `<span style="--p:${LV[lv].p}; --d:${LV[lv].d}">${lv}</span>`).join("")}</div>
    <div class="sv-h">문제 유형</div>
    <div class="types" style="--cs:${a.cs}; --cd:${a.cd}">${a.types.map((t, i) => `
      <div class="type"><span class="no">${i + 1}</span><div class="tx"><i>${t[0]}</i><b>${t[1]}</b><span>${t[2]}</span></div><span class="soon">준비 중</span></div>`).join("")}</div>`;
  $("secBack").onclick = () => show("mainView");
  show("secView"); $("secView").scrollTop = 0;
}
$("vocabBack").onclick = () => show("mainView");

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
/* ---------- 한자 읽기 데이터(kanjiyomi.js)로 글자별 읽기를 나누고, 같은 소리 한자를 찾기 ---------- */
const kata2hira = t => String(t).replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const KY = () => window.KYOMI || {};
const yomiOf = k => { const e = KY()[k]; return e ? [...e[0].split(","), ...e[1].split(",")].filter(Boolean) : []; };
const RENDAKU = {か:"が",き:"ぎ",く:"ぐ",け:"げ",こ:"ご",さ:"ざ",し:"じ",す:"ず",せ:"ぜ",そ:"ぞ",た:"だ",ち:"ぢ",つ:"づ",て:"で",と:"ど",は:"ば",ひ:"び",ふ:"ぶ",へ:"べ",ほ:"ぼ"};
const HANDAKU = {は:"ぱ",ひ:"ぴ",ふ:"ぷ",へ:"ぺ",ほ:"ぽ"};
function yomiVariants(r, first, last){        // 연탁(が행 등)·촉음화(っ) 변형까지
  const v = new Set([r]);
  if (!first){ if (RENDAKU[r[0]]) v.add(RENDAKU[r[0]] + r.slice(1)); if (HANDAKU[r[0]]) v.add(HANDAKU[r[0]] + r.slice(1)); }
  if (!last && /[つくちき]$/.test(r)) v.add(r.slice(0, -1) + "っ");
  return [...v];
}
function splitReading(word, reading){          // 優勝/ゆうしょう → [{ch:優, r:ゆう, base:ゆう}, {ch:勝, r:しょう, base:しょう}]
  const chs = [...word], rd = kata2hira(reading);
  const go = (i, pos) => {
    if (i === chs.length) return pos === rd.length ? [] : null;
    const ch = chs[i];
    if (!HAS_KANJI.test(ch)){ const h = kata2hira(ch); if (!rd.startsWith(h, pos)) return null; const r = go(i + 1, pos + h.length); return r ? [{ch, r:h, base:h}, ...r] : null; }
    for (const base of yomiOf(ch)) for (const v of yomiVariants(base, i === 0, i === chs.length - 1)){
      if (!rd.startsWith(v, pos)) continue;
      const r = go(i + 1, pos + v.length); if (r) return [{ch, r:v, base}, ...r];
    }
    return null;
  };
  return go(0, 0);
}
let READ_IDX = null;
function readIdx(){ if (READ_IDX) return READ_IDX; READ_IDX = {};
  Object.keys(KY()).forEach(k => yomiOf(k).forEach(r => (READ_IDX[r] = READ_IDX[r] || []).push(k))); return READ_IDX; }
const kanjiOk = (k, w) => { const e = KY()[k]; if (!e || !e[2]) return false; return e[2] >= +w.level.slice(1) - 1; };   // 문제 레벨보다 너무 어려운 한자 제외
// 표기 오답: 한 글자를 같은 소리의 다른 한자로 바꾼 가짜 표기 (예: 優勝 → 憂勝, 有勝)
function homophoneFakes(w){
  const seg = splitReading(w.word, w.reading); if (!seg) return [];
  const out = [];
  seg.forEach((t, i) => { if (!HAS_KANJI.test(t.ch)) return;
    shuffle((readIdx()[t.base] || []).filter(k => k !== t.ch && kanjiOk(k, w))).slice(0, 4).forEach(k => {
      const f = seg.map((u, j) => j === i ? k : u.ch).join("");
      if (!out.includes(f) && !S.words.some(x => x.word === f)) out.push(f); }); });
  // 서로 다른 글자를 바꾼 보기가 고루 섞이도록
  const byPos = seg.map((_, i) => out.filter(f => [...f][i] !== seg[i].ch));
  const mixed = []; for (let r = 0; mixed.length < out.length && r < 4; r++) byPos.forEach(l => { if (l[r] && !mixed.includes(l[r])) mixed.push(l[r]); });
  return mixed;
}
// 읽기 오답: 한 글자의 읽기를 그 한자의 다른 읽기로 바꾼 것 (예: 生活 せいかつ → しょうかつ)
function altReadingFakes(w){
  const seg = splitReading(w.word, w.reading); if (!seg) return [];
  const out = [];
  seg.forEach((t, i) => { if (!HAS_KANJI.test(t.ch)) return;
    yomiOf(t.ch).filter(r => r !== t.base && r.length >= 2).slice(0, 3).forEach(r => {
      const f = seg.map((u, j) => j === i ? r : u.r).join("");
      if (f !== kata2hira(w.reading) && !out.includes(f)) out.push(f); }); });
  return shuffle(out);
}
const sharesKanji = (a, b) => [...a].some(c => HAS_KANJI.test(c) && b.includes(c));

/* JLPT 문자·어휘 6유형 — 레벨별 출제 여부는 공식 구성(가이드북 표6)을 따름 */
const EXAM_TYPES = {
  read:  {jp:"漢字読み",     ko:"한자 읽기",    lv:["N1","N2","N3","N4","N5"]},
  write: {jp:"表記",         ko:"한자 표기",    lv:["N2","N3","N4","N5"]},
  form:  {jp:"語形成",       ko:"단어 만들기",  lv:["N2"]},
  blank: {jp:"文脈規定",     ko:"빈칸 채우기",  lv:["N1","N2","N3","N4","N5"]},
  para:  {jp:"言い換え類義", ko:"비슷한 말",    lv:["N1","N2","N3","N4","N5"]},
  usage: {jp:"用法",         ko:"쓰임새",       lv:["N1","N2","N3","N4"]}
};
const INS = {   // [N4·N5 쉬운 안내문, N3 이상 안내문]
  read:  ["＿＿＿の ことばは ひらがなで どう かきますか。", "＿＿＿の言葉の読み方として最もよいものを、1・2・3・4から一つえらびなさい。"],
  write: ["＿＿＿の ことばは どう かきますか。", "＿＿＿の言葉を漢字で書くとき、最もよいものを、1・2・3・4から一つえらびなさい。"],
  form:  ["（　　）に なにを いれますか。", "（　　）に入れるのに最もよいものを、1・2・3・4から一つえらびなさい。"],
  blank: ["（　　）に なにを いれますか。", "（　　）に入れるのに最もよいものを、1・2・3・4から一つえらびなさい。"],
  para:  ["＿＿＿の ことばと だいたい おなじ いみの ことばは どれですか。", "＿＿＿の言葉に意味が最も近いものを、1・2・3・4から一つえらびなさい。"],
  usage: ["つぎの ことばの つかいかたで いちばん いい ものを えらんで ください。", "次の言葉の使い方として最もよいものを、1・2・3・4から一つえらびなさい。"]
};
// 품사 묶음: 같은 묶음끼리만 보기로 섞음
const posGroup = w => { const p = firstPos(w);
  return /동사/.test(p) ? "verb" : p === "형용사" ? "adj" : p === "형용동사" ? "na" : p === "부사" ? "adv" : p === "명사" ? "noun" : p; };
// 한국어 뜻을 낱말 단위로 (괄호 설명·기호 제거)
const koToks = m => new Set(String(m).split(/[\/,;·、]/).map(x => x.replace(/[(（〔\[][^)）〕\]]*[)）〕\]]/g, "").replace(/[^가-힣]/g, "")).filter(x => x.length >= 2));
const overlap = (a, b) => { let n = 0; a.forEach(x => { if (b.has(x)) n++; }); return n; };
const ALLK = /^[㐀-鿿々]+$/;
// 비슷한 말 정답 후보: 뜻이 겹치되, 한자음이 같아 생긴 동음이의(市長·市場 → 시장)는 빼기
function synonymOf(w){
  const tw = koToks(w.meaning_ko), g = posGroup(w);
  const sinoLike = (x, t) => ALLK.test(x.word) && [...x.word].length === t.length;
  const c = S.words.filter(x => {
    if (x.word === w.word || x.reading === w.reading || posGroup(x) !== g || w.word.includes(x.word) || x.word.includes(w.word)) return false;
    const tx = koToks(x.meaning_ko), shared = [...tw].filter(t => tx.has(t));
    if (!shared.length) return false;
    if (shared.every(t => sinoLike(x, t) && sinoLike(w, t))) return false;
    if (g === "noun") return shared.length >= 2 || [...x.word].some(ch => HAS_KANJI.test(ch) && w.word.includes(ch));
    return true;
  });
  const sameLv = c.filter(x => lvNum(x.level) <= lvNum(w.level));
  return (sameLv.length ? sameLv : c)[Math.random() * (sameLv.length || c.length) | 0] || null;
}
// 단어 만들기(語形成): 접두·접미 한 글자를 빈칸으로
const AFFIX_PRE = [["不","無","非","未"], ["再","超","反","副","準"], ["高","低","最","超"], ["新","旧","元","前","初"], ["全","総","各","諸","主"], ["半","真","大","小"]];
const AFFIX_SUF = [["的","性","化","感"], ["者","家","員","手"], ["力","率","度","性"], ["費","料","代","金"], ["界","層","側","面"], ["観","論","法","式"], ["上","下","中","後"], ["製","産","用","風","状","型"]];
const ALL_PRE = [...new Set(AFFIX_PRE.flat())], ALL_SUF = [...new Set(AFFIX_SUF.flat())];
function affixOf(w){
  const wd = w.word, has = t => S.words.some(x => x.word === t);
  if ([...wd].length >= 3 && ALL_PRE.includes(wd[0]) && has(wd.slice(1))) return {side:"pre", a:wd[0], base:wd.slice(1)};
  if ([...wd].length >= 3 && ALL_SUF.includes(wd.slice(-1)) && has(wd.slice(0, -1))) return {side:"suf", a:wd.slice(-1), base:wd.slice(0, -1)};
  return null;
}
function examTypesFor(w){
  const hasK = HAS_KANJI.test(w.word) && w.reading && w.reading !== w.word;
  return Object.keys(EXAM_TYPES).filter(t => EXAM_TYPES[t].lv.includes(w.level) && (
    t === "read" || t === "write" ? hasK : t === "form" ? !!affixOf(w) : true));
}
function makeExam(w, force){
  const text = exText(w), at = text.indexOf(w.word);
  const before = esc(text.slice(0, at)), after = esc(text.slice(at + w.word.length));
  const formal = w.level === "N1" || w.level === "N2" || w.level === "N3";
  let types = examTypesFor(w);
  if (force && types.includes(force)) types = [force];
  for (const type of shuffle(types)){
    let correct, others = [], sent, hl = "";
    if (type === "read"){
      correct = w.reading;
      const alt = altReadingFakes(w).slice(0, 1 + (Math.random() < .5 ? 1 : 0));
      others = [...alt, ...readingFakes(w.reading).filter(r => !alt.includes(r))].slice(0, 3);
      if (others.length < 3) others = others.concat(pickOthers(S.words.map(x => x.reading), 3 - others.length,
        r => r !== correct && !others.includes(r) && Math.abs(r.length - correct.length) <= 1 && r[0] === correct[0]));
      sent = `${before}<u>${esc(w.word)}</u>${after}`;
    }
    if (type === "write"){
      correct = w.word;
      const len = [...w.word].length, ks = [...w.word].filter(c => HAS_KANJI.test(c));
      const same = x => x.word !== w.word && x.reading !== w.reading && [...x.word].length === len && HAS_KANJI.test(x.word);
      others = homophoneFakes(w).slice(0, 3);
      if (others.length < 3) others = others.concat(pickOthers(S.words, 3 - others.length, x => same(x) && !others.includes(x.word) && [...x.word].some(c => ks.includes(c))).map(x => x.word));
      // 한 글자 + 오쿠리가나 단어: 읽는 소리가 같은(또는 비슷한) 다른 한자로 바꾼 가짜 표기 (例: 濡れる → 塗れる)
      const m1 = w.word.match(/^(.)([ぁ-ん]*)$/);
      if (m1 && HAS_KANJI.test(m1[1]) && w.reading.endsWith(m1[2])){
        const kr = w.reading.slice(0, w.reading.length - m1[2].length), km = kunMap();
        const easy = k => KLV[k] <= lvNum(w.level) + 1;
        const sameR = Object.keys(km).filter(k => k !== m1[1] && easy(k) && km[k].has(kr));
        const nearR = Object.keys(km).filter(k => k !== m1[1] && easy(k) && [...km[k]].some(r => r[0] === kr[0] && r.length === kr.length));
        for (const k of [...shuffle(sameR), ...shuffle(nearR)]){
          if (others.length >= 3) break;
          const f = k + m1[2];
          if (!others.includes(f) && !S.words.some(x => x.word === f && x.reading === w.reading)) others.push(f);
        }
      }
      const kpool = S.bank[w.level].flatMap(x => [...x.word].filter(c => HAS_KANJI.test(c)));
      for (let t = 0; others.length < 3 && t < 40; t++){
        const a = [...w.word], idx = a.map((c, i) => HAS_KANJI.test(c) ? i : -1).filter(i => i >= 0);
        a[idx[Math.random() * idx.length | 0]] = kpool[Math.random() * kpool.length | 0];
        const f = a.join("");
        if (f !== w.word && !others.includes(f) && !S.words.some(x => x.word === f && x.reading === w.reading)) others.push(f);
      }
      sent = `${before}<u>${esc(w.reading)}</u>${after}`;
    }
    if (type === "form"){
      const af = affixOf(w); correct = af.a;
      const groups = af.side === "pre" ? AFFIX_PRE : AFFIX_SUF, all = af.side === "pre" ? ALL_PRE : ALL_SUF;
      const make = c => af.side === "pre" ? c + af.base : af.base + c;
      const fine = c => c !== af.a && !others.includes(c) && !S.words.some(x => x.word === make(c));   // 진짜 단어가 되는 보기는 빼기
      const near = groups.filter(g => g.includes(af.a)).flat();
      others = shuffle(near).filter(fine).slice(0, 3);
      if (others.length < 3) others = others.concat(shuffle(all).filter(fine).slice(0, 3 - others.length));
      const blank = `<span class="blank">（　　）</span>`;
      sent = before + (af.side === "pre" ? blank + esc(af.base) : esc(af.base) + blank) + after;
    }
    if (type === "blank"){
      correct = w.word;
      const pos = firstPos(w), len = [...w.word].length;
      const tw = koToks(w.meaning_ko), g = posGroup(w);
      const ok = x => x.word !== w.word && x.meaning_ko !== w.meaning_ko && !text.includes(x.word) && x.reading !== w.reading && !overlap(koToks(x.meaning_ko), tw);
      const near = lvNum(w.level), lvOk = x => Math.abs(lvNum(x.level) - near) <= 1;
      const ending = x => /[ぁ-ん]$/.test(w.word) ? x.word.slice(-1) === w.word.slice(-1) : true;    // 동사·형용사는 끝 글자도 맞추기
      others = pickOthers(S.words, 3, x => ok(x) && lvOk(x) && posGroup(x) === g && sharesKanji(x.word, w.word) && [...x.word].length === len).map(x => x.word);
      if (others.length < 3) others = others.concat(pickOthers(S.bank[w.level], 3 - others.length, x => ok(x) && !others.includes(x.word) && posGroup(x) === g && ending(x) && Math.abs([...x.word].length - len) <= 1).map(x => x.word));
      if (others.length < 3) others = others.concat(pickOthers(S.bank[w.level], 3 - others.length, x => ok(x) && !others.includes(x.word) && firstPos(x) === pos && Math.abs([...x.word].length - len) <= 1).map(x => x.word));
      if (others.length < 3) others = others.concat(pickOthers(S.bank[w.level], 3 - others.length, x => ok(x) && firstPos(x) === pos && !others.includes(x.word)).map(x => x.word));
      if (others.length < 3) others = others.concat(pickOthers(S.words, 3 - others.length, x => ok(x) && !others.includes(x.word)).map(x => x.word));
      sent = `${before}<span class="blank">（　　）</span>${after}`;
    }
    if (type === "para"){
      const syn = synonymOf(w); if (!syn) continue;
      correct = syn.word;
      const tw = koToks(w.meaning_ko), ts = koToks(syn.meaning_ko), g = posGroup(w);
      const ok = x => x.word !== w.word && x.word !== syn.word && posGroup(x) === g && !overlap(koToks(x.meaning_ko), tw) && !overlap(koToks(x.meaning_ko), ts);
      const lvOk = x => Math.abs(lvNum(x.level) - lvNum(w.level)) <= 1;
      others = pickOthers(S.words, 2, x => ok(x) && lvOk(x) && (sharesKanji(x.word, w.word) || sharesKanji(x.word, syn.word))).map(x => x.word);
      if (others.length < 3) others = others.concat(pickOthers(S.bank[w.level], 3 - others.length, x => ok(x) && !others.includes(x.word) && Math.abs([...x.word].length - [...syn.word].length) <= 1).map(x => x.word));
      if (others.length < 3) others = others.concat(pickOthers(S.bank[w.level], 3 - others.length, x => ok(x) && !others.includes(x.word)).map(x => x.word));
      sent = `${before}<u>${esc(w.word)}</u>${after}`;
    }
    if (type === "usage"){
      // 정답: 이 단어의 예문 / 오답: 같은 품사 다른 단어의 예문에 이 단어를 끼워 넣은 문장
      const g = posGroup(w), tw = koToks(w.meaning_ko);
      const nextOf = (t, wd) => t.charAt(t.indexOf(wd) + wd.length);
      const suru = (t, wd) => t.slice(t.indexOf(wd) + wd.length).startsWith("し") || t.slice(t.indexOf(wd) + wd.length).startsWith("する");
      const myNext = nextOf(text, w.word), mySuru = /サ변/.test(w.pos || "");
      const base = x => x.word !== w.word && posGroup(x) === g && firstPos(x) === firstPos(w) && canExam(x)
        && !overlap(koToks(x.meaning_ko), tw) && [...x.word].length >= 2 && !exText(x).includes(w.word)
        && (!suru(exText(x), x.word) || mySuru);                     // 「~する」 자리에는 する가 붙는 말만
      const pool = shuffle(S.bank[w.level].concat(S.words.filter(x => Math.abs(lvNum(x.level) - lvNum(w.level)) <= 1)));
      let src = pickOthers(pool, 3, x => base(x) && nextOf(exText(x), x.word) === myNext);       // 뒤 글자(조사)까지 같은 문장 우선
      if (src.length < 3) src = src.concat(pickOthers(pool, 3 - src.length, x => base(x) && !src.includes(x) && /[はがをにでとのもへ]/.test(nextOf(exText(x), x.word)) === /[はがをにでとのもへ]/.test(myNext)));
      if (src.length < 3) continue;
      correct = text; hl = w.word;
      others = src.map(x => exText(x).replace(x.word, w.word));
      sent = `<span class="target">${esc(w.word)}</span>`;
    }
    if (!correct || others.length < 3) continue;
    const opts = shuffle([correct, ...others.slice(0, 3)]);
    return {type, ins: INS[type][formal ? 1 : 0], sent, opts, answer: opts.indexOf(correct), picked: -1, hl};
  }
  return makeExam(w, "blank");     // 어떤 유형도 못 만들면 빈칸 채우기
}
// 결과 칸 정답 표시: 보기에 뜻이 안 붙는 유형(읽기·단어 만들기·쓰임새)은 뜻을 함께
function examAnswer(w){
  const q = S.q, a = q.opts[q.answer], rd = w.reading === w.word ? "" : ` (${esc(w.reading)})`;
  if (q.type === "read") return `<span class="jp">${esc(a)}</span> · ${esc(w.word)} · ${esc(w.meaning_ko)}`;
  if (q.type === "form") return `<span class="jp">${esc(a)}</span> → ${esc(w.word)}${rd} · ${esc(w.meaning_ko)}`;
  if (q.type === "usage") return `${q.answer + 1}번 문장 · ${esc(w.word)}${rd} · ${esc(w.meaning_ko)}`;
  if (q.type === "para") return `<span class="jp">${esc(a)}</span> ≒ ${esc(w.word)}`;
  return `<span class="jp">${esc(a)}</span>${rd}`;
}
function renderExam(w){
  const q = S.q, done = S.phase !== "answer", T = EXAM_TYPES[q.type];
  $("qIns").innerHTML = `<div class="q-type"><b>${T.jp}</b><span>${T.ko}</span></div>${esc(q.ins)}`;
  let sent = q.sent;
  if (done && (q.type === "blank" || q.type === "form")) sent = sent.replace('<span class="blank">（　　）</span>', `<u>${esc(q.opts[q.answer])}</u>`);
  $("qSent").innerHTML = sent;
  $("qSent").classList.toggle("usage", q.type === "usage");
  $("qKo").textContent = w.example_ko || ""; $("qKo").classList.toggle("show", done && !!w.example_ko);
  $("chipQ").textContent = w.level; $("rvTagQ").classList.toggle("on", S.review.has(w.id));
  const gloss = t => { if (!done || q.type === "read" || q.type === "form" || q.type === "usage") return "";
    const x = S.words.find(v => v.word === t); return x ? esc(x.meaning_ko) : ""; };
  const label = t => q.hl ? esc(t).split(esc(q.hl)).join(`<u>${esc(q.hl)}</u>`) : esc(t);
  $("qOpts").classList.toggle("sent-opts", q.type === "usage");
  $("qOpts").innerHTML = q.opts.map((t, i) => {
    const cls = !done ? "" : i === q.answer ? "right" : i === q.picked ? "wrong" : "dim";
    return `<button class="opt ${cls}" data-i="${i}" ${done ? "disabled" : ""}><span class="no">${i + 1}</span><span class="tx"><span class="w">${label(t)}</span><span class="gl">${gloss(t)}</span></span></button>`;
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
  S.recog = S.q.type === "usage" ? `${i + 1}번 문장` : S.q.opts[i];
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
  const ansHTML = S.qm === "test" ? examAnswer(w)
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
  if (words && words.length){ useWords(words); show("mainView"); }
  else show("setupView");
})();
