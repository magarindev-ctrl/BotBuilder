# 릴리스 절차

배포 JS는 `dist/risu_story_workshop.js` 하나이며, 플러그인 헤더의 업데이트 주소가 `main` 브랜치의 이 파일을 직접 가리킵니다. 따라서 **main에 dist를 올리는 순간이 배포**입니다. 아래 순서를 지키면 소스와 배포본이 어긋나지 않습니다.

1. `src/`와 테스트를 수정하고 `npm test`를 통과시킵니다.
2. 사용자에게 보이는 변경이면 `package.json`의 `version`과 `src/core.js`의 `VERSION`을 함께 올립니다. 두 값이 다르면 빌드가 중단됩니다. 리스의 플러그인 업데이트 버튼은 헤더 버전이 올라갔을 때만 새 버전을 알립니다.
3. `THIRD_PARTY_NOTICES.txt` 맨 위에 `Modified YYYY-MM-DD: vX.Y.Z …` 한 줄을 추가합니다. 이 줄은 배포 JS 헤더에 포함됩니다.
4. `CHANGELOG.md`에 같은 버전 항목을 적습니다.
5. `npm run build`로 dist를 다시 만들고, 출력된 SHA-256을 기록합니다. `node tools/verify-browser.mjs`로 브라우저 검증을 돌립니다.
6. 소스·테스트·dist·`verification/` 결과를 한 커밋으로 남깁니다. CI는 dist가 소스에서 다시 빌드한 결과와 같은지 확인합니다.
7. main에 병합한 뒤 `git tag vX.Y.Z && git push origin vX.Y.Z`로 태그를 올리고, GitHub Release에 dist 파일과 SHA-256을 첨부합니다. 사용자는 Release의 해시로 내려받은 파일을 확인할 수 있습니다.
8. 재배포할 때는 같은 버전의 소스·빌드 파일·라이선스(GPL-3.0-only)를 함께 제공합니다.

버전을 올리지 않고 dist만 바꾸면 이미 설치한 사용자에게 업데이트 알림이 가지 않습니다. 공개 전 보완처럼 의도적으로 버전을 유지하는 경우가 아니면 반드시 버전을 올리세요.
