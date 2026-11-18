# 単語帳 JLPT — 웹앱

단어 데이터는 들어 있지 않습니다. 앱을 처음 열 때 `words_personal.json`을 불러오면 iPhone 안에만 저장됩니다.

## 파일
- index.html, app.js — 앱 본체
- recognizer.js, patterns.js — 손글씨 인식 (Kanji Canvas, MIT 라이선스: KANJICANVAS-LICENSE.txt)
- sw.js, manifest.webmanifest, icon-*.png — 홈 화면 추가·오프라인 동작

## 올리는 법 (GitHub Pages, 무료)
1. GitHub에서 새 저장소 만들기 (Public)
2. Add file → Upload files → 이 폴더의 파일 전부 끌어다 놓기 → Commit
3. Settings → Pages → Branch: main, 폴더: / (root) → Save
4. 1~2분 뒤 https://아이디.github.io/저장소이름/ 으로 접속

## 고친 버전 올릴 때
파일을 다시 업로드하고 sw.js 맨 위의 VERSION 값을 바꾸세요 (예: tango-v2).
앱을 두 번 껐다 켜면 새 버전으로 바뀝니다.
