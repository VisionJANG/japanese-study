/* 한 칸에 이어 쓴 손글씨를 글자 단위로 나눠 채점합니다.
   - 획이 쓰인 순서와 위치로 "글자 경계 후보"를 찾고
   - 정답 글자 수만큼 나누는 모든 경우를 정답 글자의 획수로 걸러가며 확인합니다. */
(function (g) {
  var SMALL = {"ぁ":"あ","ぃ":"い","ぅ":"う","ぇ":"え","ぉ":"お","っ":"つ","ゃ":"や","ゅ":"ゆ","ょ":"よ","ゎ":"わ","ゕ":"か","ゖ":"け"};
  function norm(c) {
    if (c >= "ァ" && c <= "ヶ") c = String.fromCharCode(c.charCodeAt(0) - 0x60);
    if (SMALL[c]) c = SMALL[c];
    if ("ー一－―‐-".indexOf(c) >= 0) c = "ー";
    return c;
  }
  g.TANGO_NORM = norm;

  var strokeMap = null;            // 정규화 글자 → [최소 획수, 최대 획수]
  function counts() {
    if (strokeMap) return strokeMap;
    var refs = (g.KanjiCanvas && KanjiCanvas.refPatterns) || [];
    if (!refs.length) return {};
    strokeMap = {};
    for (var i = 0; i < refs.length; i++) {
      var c = norm(refs[i][0]), n = refs[i][1], m = strokeMap[c];
      if (!m) strokeMap[c] = [n, n]; else { m[0] = Math.min(m[0], n); m[1] = Math.max(m[1], n); }
    }
    return strokeMap;
  }
  // KanjiCanvas가 후보로 고려하는 획수 범위와 동일 (inputLength < ref+2 && inputLength > ref-3)
  function fits(ch, m) {
    var r = counts()[ch]; if (!r) return false;
    return m < r[1] + 2 && m > r[0] - 3;
  }

  function box(s) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < s.length; i++) {
      var p = s[i]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return {x0: x0, y0: y0, x1: x1, y1: y1};
  }

  function match(strokes, answers) {
    var n = strokes.length;
    if (!n) return {ok: false, guess: ""};
    var B = strokes.map(box);
    var ext = B.map(function (b) { return Math.max(b.x1 - b.x0, b.y1 - b.y0); });
    var sorted = ext.slice().sort(function (a, b) { return a - b; });
    var h = Math.max(sorted[n - 1], sorted[n >> 1] * 1.6, 12);   // 대략적인 글자 크기

    // 글자 경계 후보: k번째 획 앞에서 끊을 수 있는가
    var cut = [], line = {x1: B[0].x1, y0: B[0].y0, y1: B[0].y1}, gap = [];
    cut[0] = true;
    for (var k = 1; k < n; k++) {
      var b = B[k];
      var newLine = b.x0 < line.x1 - 1.2 * h && b.y0 > (line.y0 + line.y1) / 2;
      var right = b.x0 > line.x1 - 0.3 * h;
      cut[k] = newLine || right;
      gap[k] = newLine || b.x0 > line.x1 + 0.05 * h;    // 분명한 띄움 (인식 표시용)
      if (newLine) line = {x1: b.x1, y0: b.y0, y1: b.y1};
      else { line.x1 = Math.max(line.x1, b.x1); line.y0 = Math.min(line.y0, b.y0); line.y1 = Math.max(line.y1, b.y1); }
    }
    cut[n] = true;
    var pos = []; for (k = 0; k <= n; k++) if (cut[k]) pos.push(k);

    var memo = {};
    function recog(i, j) {          // i..j-1번째 획 = 한 글자
      var key = i + "," + j;
      if (memo[key]) return memo[key];
      var seg = strokes.slice(i, j), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (var a = i; a < j; a++) { x0 = Math.min(x0, B[a].x0); y0 = Math.min(y0, B[a].y0); x1 = Math.max(x1, B[a].x1); y1 = Math.max(y1, B[a].y1); }
      var s = Math.max(x1 - x0, y1 - y0, h * 0.35), ox = (s - (x1 - x0)) / 2, oy = (s - (y1 - y0)) / 2;
      var unit = seg.map(function (st) { return st.map(function (p) { return [(p[0] - x0 + ox) / s, (p[1] - y0 + oy) / s]; }); });
      return (memo[key] = HW.recognize(unit).slice(0, 10).map(norm));
    }

    // 정답 하나에 대해 나누는 방법이 있는지 (pos 인덱스 기준)
    function solve(ans) {
      var L = ans.length, dead = {};
      function go(pi, c) {
        if (c === L) return pi === pos.length - 1 ? [] : null;
        var key = pi + "," + c;
        if (dead[key]) return null;
        for (var pj = pi + 1; pj < pos.length; pj++) {
          if (pos.length - 1 - pj < L - c - 1) break;        // 남은 획이 모자람
          var m = pos[pj] - pos[pi];
          if (!fits(ans[c], m)) { if (m > (counts()[ans[c]] || [0, 0])[1] + 1) break; continue; }
          if (recog(pos[pi], pos[pj]).indexOf(ans[c]) < 0) continue;
          var rest = go(pj, c + 1);
          if (rest) return [pos[pj]].concat(rest);
        }
        dead[key] = true; return null;
      }
      return go(0, 0);
    }

    for (var a = 0; a < answers.length; a++) {
      if (answers[a].length > pos.length - 1) continue;
      if (solve(answers[a])) return {ok: true, guess: answers[a].join("")};
    }

    // 오답: 띄워 쓴 곳을 기준으로 나눠 1순위 글자를 보여줌
    var out = "", st = 0;
    for (k = 1; k <= n; k++) {
      if (k === n || gap[k]) { out += recog(st, k)[0] || "？"; st = k; }
    }
    return {ok: false, guess: out};
  }

  g.HWSEG = {match: match, norm: norm};
})(typeof window !== "undefined" ? window : this);
