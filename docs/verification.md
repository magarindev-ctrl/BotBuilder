# 지원 범위와 검증

## 현재 검증 범위

정식 출시 버전은 **1.1.5**입니다. 1.1.5는 블록 누락 끊김 분류와 저장본 복원 시 전역 설정 보존을 추가했습니다(자동 검증 184개, 브라우저 검증 26개). 1.1.3은 모듈별 조건 완화 스위치를 추가했으며 자동 검증 180개를 통과했습니다. 1.1.2 기준으로는 1.1.2는 원문 블록(JSON 밖 코드 블록)과 JSON 문법 오류 위치 안내·자동 재요청을 추가했으며 자동 검증 178개를 통과했습니다. 1.1.1 기준으로는 1.1.1은 Lua 변수 값이 객체·배열·숫자일 때의 오류 문구와 프롬프트 규칙을 고친 패치이며 자동 검증 172개를 통과했습니다. 1.1.0 기준으로는 분할 작업은 모의 모델로 3구간 체인, 계획만 있는 첫 응답, 중간 취소, 끊김 재시도, 끔 설정, 최대 구간 수, 로어북 ref 연쇄를 검증했습니다. 자동 검증 170개 통과. 이전 1.0.4 기준으로는 자동 검증 162개, 브라우저 검증 26개를 통과했습니다. Dusk Atelier 연동은 모의 플러그인 저장소로 등록·요청·만료·오류 경로를 검증했으며, 실제 Dusk Atelier와의 왕복은 아직 확인하지 않았습니다. 모바일 수정 빌드를 기반 소스로 역동기화했습니다. 이전 1.0.0 기준으로는 자동 검증 148개, 실제 브라우저에서 모의 API를 연결한 UI 검증 26개, v0.4.15 역동기화 시 모바일 원본과 변경 구현 정규화 비교 35개를 통과했습니다. 숨겨진 `srcdoc` iframe·투명 body·CSP, 19개 본문 배치 조건, 재열기와 프롬프트·모듈 선택창, 바이너리 프리셋 가져오기·설치 모듈 선택·토글·로어북·실제 전달 메시지를 확인했습니다. 출력 규칙의 단계 구분, `user_input` 조건문, JSON 출력 예시와 OOC·코드 펜스·앞뒤 설명 제거를 검증했습니다. JSON 문자열 안의 코드·줄바꿈·중괄호 보존, 복수 응답·손상된 JSON 거부, 프리필 유지, 기존 제안 검토·명시적 적용 흐름도 확인했습니다. 전체 사용자 프리셋·실제 설치 모듈은 아직 검증하지 않았습니다. 기준 소스는 RisuAI `f50b5942…`, RisuBard `e5412a48…`이며, 사용자의 실제 설치 버전과 동일하다고 가정하지 않습니다.

**실제 RisuBard의 LLM 호출, Lua·상황 선택 단추 실행, 강제 종료 후 복구는 아직 확인하지 못했습니다.** 저장 API 완료와 디스크·동기화 반영 시점은 다를 수 있습니다. 설치 후 실제 환경에서 확인해야 합니다.

## 소스와 배포 파일

v0.3.3~v0.3.5에서 배포 JS에 직접 적용된 용량 확대·모바일 목록·로어북 부분 수정 변경을 소스로 동기화했습니다. v0.3.6은 JSON 형식·예시 표시를 복원하고, 설명이나 코드 펜스로 둘러싼 배열 응답도 거부합니다. 저장한 프롬프트와 프리셋 프리필은 유지합니다.

수정은 src/에서 하고 npm run build로 dist/risu_story_workshop.js를 생성합니다. 빌드 헤더 버전은 package.json에서 가져오며 런타임 버전과 다르면 빌드를 중단합니다. 재배포에는 같은 버전의 소스·빌드 파일·라이선스를 함께 제공하세요.

## 개발

```powershell
npm ci
npm run build
npm test
node tools/verify-browser.mjs
```

브라우저 검증은 Windows의 설치된 Edge를 기본으로 사용합니다. 다른 실행 파일은 `WORKSHOP_BROWSER` 환경 변수로 지정합니다(예: Playwright가 설치한 Chromium 경로). GitHub Actions의 `ci.yml`은 테스트·빌드·dist 일치 검사를 필수로 돌리고, 브라우저 검증은 참고용으로 돌립니다. 결과와 소스 검증은 `verification/`, 화면 캡처는 `artifacts/`에 있습니다.

유지보수용 소스는 `src/`에 나뉘어 있고 배포 시 하나의 JS로 합쳐집니다. DUSK는 편집 편의성을 검토하는 참고 자료로 사용했으며 소스와 화면을 복제하지 않았습니다. 포함한 외부 라이브러리의 고지는 `THIRD_PARTY_NOTICES.txt`와 배포 JS에 있습니다.

프리셋 어댑터는 RisuBard의 [파일 입출력](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/storage/database.svelte.ts), [v2 조건·토글](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/promptV2.ts), [프롬프트 조립](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/process/index.svelte.ts)을 대조했습니다. 순수 조건·토글 함수를 수정해 사용하고 UI는 본체 저장소에 의존하지 않도록 작성했습니다. 해당 코드의 GPL 조건에 따라 프로젝트와 배포물은 **GPL-3.0-only**로 제공하며 전문은 `LICENSE`와 배포 JS에 포함합니다. 배포 JS를 재배포할 때 대응 소스·빌드 파일과 라이선스도 함께 제공하세요.

CBS 호환성 보완은 [블록 파서](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/parser/parser.svelte.ts)와 [RPN 계산](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/process/infunctions.ts)을 대조·수정해 사용합니다. 테스트의 공식 함수 발췌본은 `tests/fixtures/risubard-cbs-reference.ts`이며 배포 JS에는 들어가지 않습니다.

설치 모듈은 [모듈 데이터·ID/namespace 조회](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/process/modules.ts), [DB 조회 허용 항목](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/plugins/plugins.svelte.ts), [API v3 조회](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/plugins/apiV3/v3.svelte.ts)를 확인했습니다. 네이티브 모듈의 전체 실행 파이프라인 이식은 포함하지 않습니다.

단계 구분은 [정규식 모드](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/process/scripts.ts), [트리거 실행 시점](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/process/triggers.ts), [Lua 편집 콜백](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/process/scriptings.ts)을 대조했습니다. `user_input`의 정의 여부는 [공식 CBS 목록](https://github.com/rpaddict/RisuBard/blob/e5412a4878ae3a0073ffce8e06aed8f288dd9c53/src/ts/cbs.ts)과 블록 파서의 미정의 표기 처리에 근거합니다.
