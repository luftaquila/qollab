# API 계약

모든 사용자 API는 `/api` 아래에 있으며 자체 세션 cookie `qollab`을 사용한다. 읽기도 프로젝트 멤버 권한을 검사한다. 변경 요청에는 정확한 `Origin: ${PUBLIC_ORIGIN}`, `/session` 응답의 `x-csrf-token`, JSON 본문이 필요하다.

## 공통

- 오류: `{ "code": "REVISION_CONFLICT", "params": { "revision": 42 } }`.
- 변경 성공: `{ "result": ..., "revision": 43 }`. 클라이언트는 이전 revision을 이후 요청에 재사용하지 않는다.
- 401 세션 없음/만료, 403 권한/Origin/CSRF, 404 접근 가능한 대상 없음, 409 revision·세대·잠금 충돌, 413 크기 제한, 503 백업 쓰기 정지.
- UUID는 문서·프로젝트·체크포인트·빌드·수정 메시지 ID로 사용한다. 경로는 ID와 분리된다.

## 사용자 REST

| Method / path | 요청·응답 | 최소 권한 |
|---|---|---|
| GET /session | user, csrf, oauthConfigured | 로그인 전 허용 |
| GET /auth/google, /auth/callback | OIDC redirect·callback | 로그인 전 허용 |
| POST /logout | 세션 폐기, 기존 연결 종료 | 로그인 |
| GET /projects | 접근 가능한 목록 | 로그인 |
| POST /projects | name → id | 로그인 |
| GET /projects/:pid | 프로젝트 revision, 역할, 파일·원문 목록 | Viewer |
| PATCH /projects/:pid | revision, name 또는 target | Owner |
| DELETE /projects/:pid | revision | Owner |
| POST /projects/:pid/files | revision, path, source | Editor (설정 파일은 Owner) |
| GET /projects/:pid/files/:fid | 원문 metadata 또는 이미지 bytes | Viewer |
| PATCH /projects/:pid/files/:fid | revision, path | Editor |
| DELETE /projects/:pid/files/:fid | revision, 참조 중 삭제 거부 | Editor |
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
| GET /projects/:pid/members | 이름·이메일·역할 | Viewer |
| POST /projects/:pid/invites | revision, email, role(editor/viewer) → 7일 일회용 링크 | Owner |
| POST /invites/accept | token; 로그인 계정 이메일 일치 | 로그인 |
| PATCH /projects/:pid/members/:uid | revision, role(null=삭제), transfer? | Owner |
| GET /projects/:pid/export | 일관된 현재 ZIP | Viewer |
| POST /import | name, bytes(base64); 새 프로젝트 | 로그인 |
| GET/POST /projects/:pid/builds | 빌드 이력 / revision으로 수동 빌드 | Viewer/Editor |
| POST /projects/:pid/builds/:bid/cancel | revision | Editor |
| GET /projects/:pid/pdf | 마지막 정상 PDF; X-Qollab-Revision | Viewer |

이미지 응답은 저장된 파일 metadata와 요청 문서 기준 `relative` 경로다. `uploadId`는 재시도 동안 유지한다. 다른 콘텐츠에 같은 ID를 사용하면 거부한다. revision 충돌은 쓰기가 수행되지 않은 결과이며 브라우저는 최신 revision으로 최대 3회 재시도한다.

파일 이름 변경은 알려진 Markdown 링크·이미지 상대 참조를 갱신한다. 모호한 Raw/YAML 참조는 먼저 원문을 수정하도록 거부한다. 원문이 변경되는 문서는 새 세대로 전환해 기존 연결에 재접속을 요구한다.

## WebSocket

`/projects/:pid/documents/:fid/ws?epoch=1&schema=1&clientId=<Yjs clientID>`

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

- `Authorization: Bearer ${RENDERER_TOKEN}`: POST `/renderer/lease`, GET `/renderer/builds/:bid/input`, GET `/renderer/builds/:bid/status`, POST `/renderer/builds/:bid/result`.
- 같은 렌더러 인증으로 GET `/renderer/activity`: `{editing:boolean}`. 인증·편집 권한을 재확인한 열린 문서 연결이 있는지만 반환한다. 사용자·프로젝트·문서 ID는 반환하지 않는다. 관리자는 빈 작업 컨테이너 준비 여부에 사용한다.
- input/status에는 `x-render-lease`. result는 lease, pdf(base64, 선택), log, image.
- 만료·취소된 lease의 결과는 거부한다. 이전 project epoch 또는 이전 성공 revision의 PDF는 공개하지 않는다.
- `Authorization: Bearer ${ADMIN_TOKEN}`: POST `/admin/freeze`, `{frozen, backupId?}`.
- 관리 API는 사용자 세션 경로와 별도이며 renderer/admin token을 브라우저에 전달하지 않는다.
