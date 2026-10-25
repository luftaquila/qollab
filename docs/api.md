# API 계약

모든 사용자 API는 `/api` 아래에 있으며 자체 세션 cookie `qollab`을 사용한다. 읽기도 프로젝트 멤버 권한을 검사한다. 변경 요청에는 정확한 `Origin: ${PUBLIC_ORIGIN}`, `/session` 응답의 `x-csrf-token`, JSON 본문이 필요하다.

## 공통

번호 표시와 변경 기록:

- `PATCH /projects/:pid/numbering`: 소유자, `{ expected: Numbering | null, numbering: Numbering }`. 원문과 협업 문서 세대는 유지한다. `expected`가 저장된 설정과 다르면 `409 REVISION_CONFLICT`로 거절한다.
- `Numbering`은 version 2이며 `headings`, `lists`, `figures`, `bullets`, `counters`, `pdf` 설정을 갖는다. 이전 version 2 설정에서 생략된 필드는 기본값으로 채운다. 모든 표시 재정의는 기본적으로 꺼져 있다. 필드와 템플릿 연결 방식은 아래 설명을 따른다.
- `GET /projects/:pid/changes?before=<revision>`: 최신 편집 작업 100개의 작성자 이름·시작/종료 시각·파일·절 제목·변경 문구. `before`로 이전 변경을 조회한다.
- `GET /projects/:pid/changes/:cid`: 해당 작업 시작/종료 사이의 파일별 unified patch. 같은 작성자의 같은 파일 연속 편집은 90초 간격과 최대 5분 범위로 묶는다. 다른 작성자가 끼어들면 새 작업으로 나눈다. 개별 내용 저장의 원본 로그는 그대로 보존한다. 작성자는 클라이언트 입력 대신 서버가 확인한 세션에서 기록하며 내용 저장과 같은 트랜잭션으로 확정한다.
- `PATCH /session/name`: 익명 세션의 표시 이름 변경, `{ name }`. 해당 세션의 이후 편집에만 적용한다. 로그인 사용자는 인증 공급자의 이름을 사용한다.
- 기존 `/history`는 자동·수동 저장 지점과 복원용 스냅샷이다. 새 변경 기록과 별도로 유지한다.
- 규정 검토·시트 가져오기 API는 제거했다. 새 번호 설정은 ZIP의 `_qollab.yml` version 2에 저장한다. 기존 `_qollab-regulations.yml`은 해석하지 않는 과거 메타데이터의 호환 형식으로만 보존하며 표시 설정으로 적용하지 않는다.
- `PATCH /projects/:pid`의 `autoBuild: false`는 서버 PDF 자동 생성을 끈다. 수동 `POST /projects/:pid/builds`는 계속 사용할 수 있다.

웹 배포:

- `GET /projects/:pid/website`: 멤버, 발행 상태·revision·URL.
- `POST /projects/:pid/website`: 소유자, 현재 프로젝트를 독립 VitePress 사이트로 발행한다. 발행한 사이트는 로그인한 해당 프로젝트 멤버만 읽을 수 있다. 이후 첫 저장에서 200ms 뒤 재빌드를 예약하며 추가 입력·조회가 예약 시간을 미루지 않는다. 빌드 중 변경은 완료 후 최신 스냅샷으로 다시 발행한다. 웹은 정적 `site-version.json`을 500ms마다 확인하고 탭으로 돌아올 때도 즉시 확인한다. 빌드 시간은 별도로 필요하다. 생성물은 최근 세 버전을 유지하여 열린 탭의 이전 청크 요청을 지원한다.
- `GET /projects/:pid/website/export`: 멤버, 루트 경로(`/`) 배포용 정적 사이트 ZIP. HTML·검색 색인·폰트·이미지가 포함되며 편집 서버 API나 프로젝트 목록은 포함하지 않는다.
- `DOCS_PROJECT`가 지정되면 `/docs/`는 그 프로젝트만 제공한다. 설정하지 않으면 404이며 프로젝트 목록은 제공하지 않는다. 다른 발행물은 `/docs/p/:pid/`에 있다.
- HTML·검색 색인·이미지·폰트·이전 버전 청크를 포함한 모든 `/docs/*` 요청에서 현재 세션과 프로젝트 멤버십을 확인한다. 응답은 `Cache-Control: private, no-store`, `Vary: Cookie`다. 비로그인 HTML 탐색은 로그인 화면으로 이동하고 인증 후 원래 경로로 돌아온다. 파일 요청은 401, 비멤버 요청은 403이다. 열린 문서는 버전 확인에서 권한 상실을 감지하면 내용을 비우고 다시 접근 권한을 확인한다. 내려받은 정적 ZIP을 별도 호스팅할 때는 그 호스팅의 접근 제어가 별도로 필요하다.

- 오류: `{ "code": "REVISION_CONFLICT", "params": { "revision": 42 } }`.
- 변경 성공: `{ "result": ..., "revision": 43 }`. 클라이언트는 이전 revision을 이후 요청에 재사용하지 않는다.
- 401 세션 없음/만료, 403 권한/Origin/CSRF, 404 접근 가능한 대상 없음, 409 revision·세대·잠금 충돌, 413 크기 제한, 503 백업 쓰기 정지.
- UUID는 문서·프로젝트·체크포인트·빌드·수정 메시지 ID로 사용한다. 경로는 ID와 분리된다.

## 문서 표시와 Typst 템플릿

- 프로젝트 파일 `_qollab-web.yml`은 사용자 정의 함수의 웹 태그·스타일을 선언한다. 일반 텍스트 파일 API로 생성·수정하며, 저장한 정의를 웹 미리보기와 VitePress 발행에 함께 사용한다. PDF 입력은 변경하지 않는다. 문법과 지원 범위는 [프로젝트 웹 서식](web-format.md)을 참고한다.

- `headings: { enabled, levels, rules }`, `lists: { enabled, levels }`. 레벨의 `style`, `format`, `symbols`가 숫자 모양을 정한다. `format`은 임의 문자열과 현재 숫자 `{n}`, 상위 숫자 `{1}`~`{8}`을 지원한다. 제목의 `title`은 `{label}`, `{title}`, `{h1}`~`{h6}`를 지원한다. 제목의 `reset: "parent" | "document"`로 상위 제목에서 초기화할지 문서 전체에서 이어 셀지 정한다.
- 레벨의 `reference`는 본문 참조 문구이며 `{label}`, `{n}`, `{1}`~`{8}`, `{h1}`~`{h6}`를 지원한다. `referenceStyle`은 참조의 숫자 모양을 정한다. 따라서 목록에는 원문자를, 참조에는 십진 숫자와 임의 접미사를 쓸 수 있다. `headings.rules`는 레벨 설정에 `match`를 추가한 배열이며 지정한 문자 접두사와 숫자만 비교한다. 사전 정의된 코드나 규칙은 없다.
- `figures: { enabled, label, caption }`: `label`은 번호 레벨 설정, `caption`은 `{label}`과 `{caption}`을 포함한 자유 형식이다. Markdown의 독립 이미지와 해당 라벨 참조에 적용한다. `bullets: { enabled, symbols }`는 깊이별 글머리표다.
- `counters`는 `{ name, style, format, symbols, ... }` 배열이다. 웹의 raw Typst 블록에 있는 해당 이름의 함수 호출과 연결한다. PDF 템플릿의 함수는 자체 Typst counter 값으로 `document-format.counter-label(name, n)`을 호출한다. 함수 이름은 프로젝트 설정에서 명시하며 애플리케이션이 추측하지 않는다.
- `pdf.mode: "automatic" | "template"`. 자동 모드는 기본 show 규칙으로 번호를 적용한다. 사용자 템플릿의 자체 목록 배치·제목 디자인을 보존하려면 템플릿을 명시적으로 연결한 뒤 `template` 모드를 선택한다. 모드만 변경하면 기존 템플릿의 하드코딩된 번호가 자동 변환되지는 않는다.
- 기본 진입 템플릿은 `/.qollab/document-format.typ`을 `document-format` 모듈로 import한다. 프로젝트 partial에서 `heading-title(it, selector: heading)`, `list-label(numbers)`, `bullet-label(depth)`, `figure-caption(it)`, `reference(it)`, `counter-label(name, n)`을 호출할 수 있다. 자체 show 규칙이 원본 제목과 출력 제목을 각각 생성한다면 `heading-title`에 원본 제목만 선택하는 selector를 전달한다. `reference`는 해석된 표기 또는 `none`을 반환한다.
- `/.qollab/document-numbering.json`에는 현재 원문으로 해석한 `settings`, `headings`, `figures`, `references`가 들어간다. 웹과 브라우저 PDF가 같은 모듈로 계산하며, 서버 PDF는 빌드 요청 시점의 결과를 입력 스냅샷에 보관한다. 내부 두 파일은 프로젝트 파일에서 덮어쓸 수 없다. 임의의 Typst 코드 실행 결과 전체를 HTML로 변환하는 기능은 아니다.

## 사용자 REST

`ACCOUNT_POLICY=approval`의 로그인 승인 조건은 `APPROVED_EMAILS`, 프로젝트에 추가된 이메일, 기존 프로젝트 멤버십 중 하나다. 멤버를 추가하면 즉시 권한이 생기며 수락 링크는 없다. 계정이 아직 없으면 이메일 권한을 저장하고, 해당 이메일이 검증된 Google 계정의 첫 로그인 때 멤버십에 연결한다. 이미 로그인한 계정의 기존 초대도 다음 요청에서 연결한다. 이메일 권한은 자동 만료되지 않으며 Owner가 역할을 바꾸거나 삭제할 수 있다. `GET /auth/google?returnTo=...`는 원래 문서·프로젝트·반영 도구 경로를 로그인 후 복원한다. 외부 주소와 API 경로는 복귀 대상으로 허용하지 않는다. 익명 접근을 끄면 기존 게스트 쿠키도 거부하며 서버 시작 시 게스트 세션을 폐기한다.

| Method / path | 요청·응답 | 최소 권한 |
|---|---|---|
| GET /session | user, csrf, oauthConfigured, anonymous. `ANONYMOUS_ACCESS`이면 세션 없는 방문자에게 게스트 세션 발급 | 로그인 전 허용 |
| GET /auth/google, /auth/callback | OIDC redirect·callback | 로그인 전 허용 |
| POST /logout | 세션 폐기, 기존 연결 종료 | 로그인 |
| GET /projects | 접근 가능한 목록: id, name, revision, role, updated(마지막 내용 변경 시각). 최근 수정 순 | 로그인 |
| POST /projects | name → id | 로그인 |
| GET /projects/:pid | 프로젝트 revision, 역할, 파일·원문 목록 | Viewer |
| PATCH /projects/:pid | revision, name 또는 target | Owner |
| DELETE /projects/:pid | revision | Owner |
| POST /projects/:pid/files | revision, path, source | Editor (설정 파일은 Owner) |
| GET /projects/:pid/files/:fid | 원문 metadata 또는 이미지 bytes | Viewer |
| PATCH /projects/:pid/files/:fid | revision, path | Editor |
| DELETE /projects/:pid/files/:fid | revision, 참조 중 삭제 거부 | Editor |
| POST /projects/:pid/folders | revision, path; 빈 폴더 추가(`data.folders`) | Editor |
| PATCH /projects/:pid/folders | revision, from, to; 안의 파일을 한 트랜잭션으로 이동하고 상대 참조 갱신 | Editor |
| DELETE /projects/:pid/folders | revision, path; 밖에서 참조하는 파일이 있으면 거부 | Editor |
| PUT /projects/:pid/files/:fid/text | revision, source; 비협업 텍스트 파일 | Editor |
| POST /projects/:pid/files/:fid/raw | revision; 새 epoch와 15분 복구 잠금 | Editor |
| PUT /projects/:pid/files/:fid/raw | revision, epoch, rawVersion, source, visual | 잠금 소유 Editor |
| POST /projects/:pid/images | revision, uploadId, name, bytes(base64), documentId? | Editor |
| GET /projects/:pid/resource?path=... | 상대 경로의 인증된 이미지·텍스트 | Viewer |
| GET /projects/:pid/history | 체크포인트 목록·Git hash | Viewer |
| POST /projects/:pid/history | revision, label | Editor |
| GET /projects/:pid/history/:cid | 버전 원문과 파일 매핑 | Viewer |
| GET /projects/:pid/history/:cid/export | 해당 버전 ZIP·이미지 | Viewer |
| POST /projects/:pid/history/:cid/restore | revision; 프로젝트 전체 복원 | Owner |
| GET /projects/:pid/members | 이름·이메일·역할, pending(첫 로그인 전 이메일 권한), mail(id/status/error) | Viewer |
| POST /projects/:pid/invites | revision, email, name?, role(editor/viewer) → 즉시 권한 부여, 프로젝트 URL과 mail 발송 상태 | Owner |
| PATCH /projects/:pid/invites/:uid | revision, role(editor/viewer/null=삭제); 첫 로그인 전 이메일 권한 변경 | Owner |
| POST /projects/:pid/mail/:uid/retry | 실패한 안내 메일 재발송; 성공한 메일은 다시 보내지 않음 | Owner |
| PATCH /projects/:pid/members/:uid | revision, role(null=삭제), transfer? | Owner |
| GET /projects/:pid/export | 일관된 현재 ZIP | Viewer |
| POST /import | name, bytes(base64); 새 프로젝트 | 로그인 |
| GET/POST /projects/:pid/builds | 빌드 이력 / revision으로 수동 빌드 | Viewer/Editor |
| POST /projects/:pid/builds/:bid/cancel | revision | Editor |
| GET /projects/:pid/pdf | 마지막 정상 PDF; X-Qollab-Revision | Viewer |

멤버 추가와 안내 메일은 DB에 함께 기록한다. SMTP 발송에 실패해도 부여한 권한은 유지되며 `mail.status=failed`로 반환한다. 발송 오류에는 진단 코드만 저장한다. Owner가 실패한 메일을 재시도할 수 있고, 권한을 삭제한 대상의 미발송 메일은 취소한다. 수락 API `/invites/accept`는 사용하지 않는다.

이미지 응답은 저장된 파일 metadata와 요청 문서 기준 `relative` 경로다. 프로젝트·파일·업로드 응답의 이미지 `contentHash`는 원본 bytes의 SHA-256이며 PDF 캐시가 이미지 변경을 판별할 때 사용한다. `uploadId`는 재시도 동안 유지한다. 다른 콘텐츠에 같은 ID를 사용하면 거부한다. revision 충돌은 쓰기가 수행되지 않은 결과이며 브라우저는 최신 revision으로 최대 3회 재시도한다.

파일 이름 변경은 알려진 Markdown 링크·이미지 상대 참조를 갱신한다. 모호한 Raw/YAML 참조는 먼저 원문을 수정하도록 거부한다. 원문이 변경되는 문서는 새 세대로 전환해 기존 연결에 재접속을 요구한다.

## WebSocket

`/projects/:pid/documents/:fid/ws?epoch=1&schema=4&clientId=<Yjs clientID>`

- 업그레이드 시 세션·Origin·읽기 권한·세대·스키마 확인.
- 서버 → `sync`: 영구 Yjs snapshot, 원문 보존 metadata, revision, role.
- 클라이언트 → `update`: `{type:"update", id:<UUID>, update:<base64 Yjs update>}`.
- 서버는 DB snapshot을 복제해 변경 적용 → 스키마·원문·크기 검사 → 프로젝트 행 잠금 트랜잭션에서 snapshot/원문/update 기록 → COMMIT → 파일 반영 → `ack` → 원격 broadcast.
- `ack`: 메시지 ID와 revision. ACK 이전 연결 단절은 미저장/미확인 상태다.
- `presence`: 커서 위치와 접속 상태. 이름은 세션의 검증된 사용자 이름으로 대체한다. 장기 보관하지 않는다.
- `error`: code/params. 세대·권한 오류는 연결을 종료한다. 이전 세대의 미확인 변경은 자동 병합하지 않는다.
- 일반 연결 단절은 최대 15초 간격으로 재접속. 같은 세대에서 outbox를 다시 전송한다.
- Yjs snapshot은 각 수락된 변경과 같은 트랜잭션에 저장한다. 체크포인트에서 이전 update payload를 비우고 메시지 ID는 중복 확인용으로 유지한다.

## 프로젝트 이벤트

`GET /projects/:pid/events`: 인증된 SSE. `document`(revision만), `changed`, `files`, `build`, `restored`, `permissions`, `file-error`, `heartbeat`. 연결 동안 세션·멤버 권한을 다시 검사한다. 본문 변경 이벤트는 Vue에 문서 전체를 복사하지 않는다.

## 렌더러와 운영 API

- `Authorization: Bearer ${RENDERER_TOKEN}`: POST `/renderer/lease`(빌드 id·lease·project·target·revision·epoch·timeout), GET `/renderer/builds/:bid/input`(파일 path와 source, 이미지는 blob id), GET `/renderer/builds/:bid/blobs/:blob`(그 빌드 입력에 있는 이미지 bytes), GET `/renderer/builds/:bid/status`, POST `/renderer/builds/:bid/result`.
- 같은 렌더러 인증으로 GET `/renderer/activity`: `{editing:boolean}`. 인증·편집 권한을 재확인한 열린 문서 연결이 있는지만 반환한다. 사용자·프로젝트·문서 ID는 반환하지 않는다. 관리자는 빈 작업 컨테이너 준비 여부에 사용한다.
- input/blobs/status에는 `x-render-lease`. result는 lease, pdf(base64, 선택), log, image.
- 만료·취소된 lease의 결과는 거부한다. 이전 project epoch 또는 이전 성공 revision의 PDF는 공개하지 않는다.
- `Authorization: Bearer ${ADMIN_TOKEN}`: POST `/admin/freeze`, `{frozen, backupId?}`.
- 관리 API는 사용자 세션 경로와 별도이며 renderer/admin token을 브라우저에 전달하지 않는다.
