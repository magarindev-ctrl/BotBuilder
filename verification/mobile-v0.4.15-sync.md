# 모바일 v0.4.15 기반 소스 동기화

기준 소스: 8ea3af7 (v0.4.6). 입력은 사용자가 모바일 ChatGPT에서 수정한 dist/risu_story_workshop.js이며, 변경 전 artifacts/mobile-v0.4.15-original.js로 보존했다. 입력 SHA-256: 5c20727facdb745bccc2d5eda2481a9088e85077171e61c9becc08ecdecbf4d2 (801,842 bytes).

## 이관 범위

- src/core.js: 요청 이미지 검증·읽기·멀티모달 조립·전송 크기 계산, 첨부 복원 검사, 저장 충돌 선택, JSON 문법 예시, 새 캐릭터 로어북 기본값.
- src/ui.js 및 src/style.js: 모바일 메뉴와 요청 설정, visualViewport와 입력 높이, 파일·클립보드 첨부, 이미지 기록·재첨부, 전송 후 입력 비우기, 저장 충돌 비교, CHARX 참조 안내.
- src/charx.js: 로컬 CCv3 에셋 파일 포함, HTTP(S)·ccdefault:·누락 embeded:// URI 보존, 참조 안내. 이미지 파일을 확보하지 못한 URI는 정상 표시된다고 보장하지 않는다.
- 패키지·런타임·배포 버전과 라이선스 변경 고지를 0.4.15로 맞췄다. 그 사이의 개별 버전 변경 이력은 추측하지 않았다.

## API 근거

RisuAI f50b5942ec6aa59aa3c56049ac687ca09667fec7의 [API v3](https://github.com/kwaroran/RisuAI/blob/f50b5942ec6aa59aa3c56049ac687ca09667fec7/src/ts/plugins/apiV3/v3.svelte.ts)는 runLLMModel의 messages를 requestChatDataMain의 formated로 전달한다. [OpenAIChat/MultiModal 정의](https://github.com/kwaroran/RisuAI/blob/f50b5942ec6aa59aa3c56049ac687ca09667fec7/src/ts/process/index.svelte.ts)는 multimodals 배열과 type, base64, width, height 필드를 정의한다. 이관한 이미지 메시지는 해당 계약을 따른다. 실제 설치된 RisuBard 버전이나 선택 모델이 이미지 입력을 지원하는지는 이 확인으로 보장하지 않는다.

## 검증

- node --test tests/*.test.mjs: 142개 통과. 결과 implementation-results.tap. 기존 129개에 이미지·복원·크기·직접/프리셋 요청, 저장 충돌 선택·취소·검토 중 변경 보호, JSON 예시, CHARX 참조 관련 13개를 추가했다.
- node tools/verify-browser.mjs: Edge headless에서 실제 배포 번들을 sandbox/CSP iframe 및 모의 API로 실행, 26개 검사·19개 배치 조건 통과, 화면 캡처 21개, 페이지 오류 0개. PNG 파일과 클립보드의 실제 브라우저 디코딩, 모바일 설정·작업별 첨부·전송·재첨부·임시 저장도 포함한다. 결과 browser-results.json.
- node tools/verify-mobile-v0415-sync.mjs: 모바일 원본과 재빌드본의 변경 함수·메서드·CSS·상수 35개를 컴파일러 정규화 후 비교하여 일치를 확인했다. 공백·유니코드 표기·컴파일러의 api2 지역 변수명만 정규화하며 동작을 바꾸는 대체 규칙은 쓰지 않는다. 결과 mobile-v0.4.15-source-sync-results.json에 두 파일의 SHA-256을 기록했다.
- 이전 v0.4.3 비교 도구·결과는 역사 기록으로 유지했다. 원본 빌드는 artifacts/에 보존되어 Git에는 포함되지 않으므로 다른 체크아웃에서는 보존한 원본 경로를 비교 도구에 전달해야 한다.

실제 RisuAI/RisuBard, 삼성 브라우저, 실제 LLM 이미지 응답, Realm 업로드는 검증하지 않았다.
