# 운영

## 실행

- Docker Engine + Compose v2 또는 rootless Podman + Compose 제공자.
- 전체 호스트 메모리 4GiB 이상 권장. 작업 하나에 최대 2GiB, 앱·DB 메모리는 별도.
- 공개 이미지의 검증된 digest: [0.1.9 검증](verification-0.1.9.md), `docs/versions.env`.
- 예제 포트는 `127.0.0.1:3000`에만 공개한다. HTTPS 프록시는 배포자가 설정한다.

```sh
cp .env.example .env
cat docs/versions.env >> .env
# .env의 POSTGRES_PASSWORD, RENDERER_TOKEN, ADMIN_TOKEN을 각각 변경한다.
# openssl rand -hex 32 로 개별 값을 생성할 수 있다.
docker compose pull
docker compose up -d
docker compose logs -f app renderer
```

`POSTGRES_PASSWORD`는 URL에 안전한 영숫자/hex 값을 사용한다. Google 설정이 없으면 로그인 불가 안내 화면을 제공한다.

### 다른 기기에서 접속

`.env`에서 바인딩 주소와 실제 접속 주소를 함께 지정한 뒤 앱을 다시 생성한다.

```dotenv
BIND_ADDRESS=0.0.0.0
PORT=3000
PUBLIC_ORIGIN=http://192.168.1.100:3000
```

```sh
docker compose up -d app
# Podman: podman compose up -d app
```

- `192.168.1.100`을 서버의 실제 LAN 주소로 바꾼다. 다른 기기는 그 주소의 3000번 포트로 접속한다.
- `PUBLIC_ORIGIN`은 브라우저 접속 주소와 일치해야 한다. OAuth callback, 변경 요청의 Origin 검사, WebSocket 연결에 사용한다.
- 인터넷 도메인은 `PUBLIC_ORIGIN=https://docs.example.com`으로 지정하고 HTTPS 프록시를 연결한다. 같은 호스트의 프록시만 앱에 접근하면 `BIND_ADDRESS=127.0.0.1`을 사용할 수 있다.
- `.env`의 실제 주소와 인증정보는 Git에 포함하지 않는다. 방화벽·라우터의 경로는 설치 환경에 맞게 설정한다.

### Google

Google의 [redirect URI 규칙](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)은 HTTPS와 도메인을 요구한다. `localhost`만 예외이며, 다른 기기에서 접속하는 LAN IP는 등록할 수 없다. LAN에서 사용하려면 HTTPS 도메인이 서버의 LAN 주소를 가리키도록 DNS와 인증서를 준비한다. 이 Mac에서만 검증하는 경우에는 `PUBLIC_ORIGIN=http://localhost:3000`을 사용할 수 있다.

1. OAuth 웹 클라이언트 생성. 일반 Gmail 계정은 Audience를 **External**로 설정한다. **Internal**은 같은 Google Workspace 조직 사용자만 허용할 때 사용한다. 승인된 redirect URI는 `${PUBLIC_ORIGIN}/api/auth/callback`.
2. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_ORIGIN` 설정.
3. 기본 `ACCOUNT_POLICY=approval`: `APPROVED_EMAILS`에 쉼표로 구분한 승인 이메일 지정. `all`은 검증된 Google 계정을 허용.
4. Workspace 제한이 필요하면 `GOOGLE_WORKSPACE_DOMAIN` 지정. 검증된 `hd` claim을 확인한다.
5. 외부 서비스는 `PUBLIC_ORIGIN=https://docs.example.com`과 HTTPS 프록시 사용. WebSocket·SSE 프록시 버퍼링과 타임아웃도 설정한다.

Google sub를 사용자 ID로 사용한다. 이메일 변경으로 계정을 합치지 않는다. Google token은 저장하지 않는다. 세션 cookie는 HttpOnly/SameSite=Lax, HTTPS origin에서는 Secure다. 변경 API의 CSRF와 Origin 검사는 항상 활성화된다.

### 로그인 없는 접근

`ANONYMOUS_ACCESS=true`이면 세션이 없는 모든 방문자를 공유 게스트 계정 하나(`anonymous`)로 로그인시킨다. 기본값은 `false`다.

- 서버에 접근할 수 있는 누구나 게스트 계정의 프로젝트를 읽고 수정·삭제할 수 있다. 신뢰하는 로컬 환경이나 시험용 배포에서만 사용한다. 공개 주소에는 사용하지 않는다.
- 방문자마다 세션과 CSRF 토큰은 따로 발급하고, Origin·CSRF 검사는 그대로 적용한다. 공동편집 접속자 이름은 모두 `Guest`로 표시된다.
- Google 로그인과 함께 설정할 수 있지만, 로그인한 사용자와 게스트는 서로 다른 계정이다. 게스트 프로젝트를 공유하려면 Owner인 게스트가 멤버 패널에서 초대한다.
- 옵션을 끄면 게스트 계정으로 로그인할 수 없으므로, 게스트 프로젝트는 끄기 전에 ZIP으로 내보내거나 다른 계정으로 소유권을 넘긴다.
- 시작 시 서버 로그에 경고를 남긴다.

### rootless Podman (Linux)

```sh
systemctl --user enable --now podman.socket
export ENGINE_SOCKET="$XDG_RUNTIME_DIR/podman/podman.sock"
export COMPOSE_ENGINE=podman
export COMPOSE_FILE=compose.yaml:compose.podman.yaml
podman compose up -d
```

- Compose 제공자(예: Docker Compose v2)가 필요하다. 백업·복원 명령에도 위의 `COMPOSE_ENGINE`, `COMPOSE_FILE`, `ENGINE_SOCKET` 환경을 유지한다.
- SELinux 호스트에서는 엔진 소켓 접근을 위한 관리자 정책을 적용한다. 렌더러 관리 서비스에만 `security_opt: [label=disable]`을 추가할 수 있다. 작업 컨테이너의 나머지 격리 옵션은 유지한다.
- 관리 서비스는 rootless 엔진의 소켓을 사용한다. 작업은 UID 10001, network=none, read-only, cap-drop=ALL, no-new-privileges로 실행한다.
- 여러 설치가 같은 엔진을 사용하면 `RENDERER_NAMESPACE`를 각기 다르게 지정한다. 재시작 청소는 해당 namespace의 작업 컨테이너에만 적용한다.
- macOS Podman machine은 VM 내부 소켓 경로를 `ENGINE_SOCKET`으로 지정한다. `podman machine inspect`로 rootless UID와 연결을 확인한다. 호스트의 전달 소켓은 엔진 API 접속용이며 컨테이너 bind mount 원본과 다르다.

## 설정

| 변수 | 기본값 | 의미 |
|---|---|---|
| MAX_DOCUMENT_BYTES | 2097152 | qmd/텍스트 크기 |
| MAX_IMAGE_BYTES | 10485760 | PNG/JPEG 파일 크기 |
| MAX_IMAGE_PIXELS | 40000000 | 이미지 디코딩 픽셀 |
| MAX_PROJECT_BYTES | 262144000 | 현재 프로젝트 전체 원본 크기 |
| MAX_HISTORY_BYTES | 1073741824 | 프로젝트 체크포인트 저장 한도 |
| SESSION_HOURS | 168 | 세션 수명 |
| ANONYMOUS_ACCESS | false | 로그인 없이 공유 게스트 계정으로 접근 ([주의](#로그인-없는-접근)) |
| CHECKPOINT_MS | 300000 | 변경이 있는 프로젝트의 자동 체크포인트 |
| BUILD_DEBOUNCE_MS | 2000 | 마지막 수정 후 자동 빌드 대기 |
| BUILD_MAX_WAIT_MS | 10000 | 연속 입력 중 최대 대기 |
| BUILD_TIMEOUT_SECONDS | 120 | 작업 시간 |
| RENDER_CPUS | 1 | 관리자 서비스의 작업 CPU 제한 |
| RENDER_MEMORY | 2g | 작업 메모리 제한 |
| RENDER_PIDS | 64 | 작업 프로세스 제한 |
| RENDER_TMPFS | 512m | 작업 파일 공간 |
| RENDER_WARM_MS | 30000 | 빈 작업 컨테이너의 대기 시간, 0으로 비활성화; 최대 30000ms |

앱 설정은 app 서비스에, RENDER_* 자원 설정은 renderer 서비스에 전달한다. 전역/프로젝트 동시 빌드는 초기 버전에서 각 1개다. 파일 1000개, 결과 PDF 50MiB, 로그 60KiB 제한을 적용한다. 임시 작업 입력과 출력은 크기 제한 JSON 스트림이며 호스트 프로젝트 볼륨을 작업에 마운트하지 않는다.

편집자의 문서 연결이 열려 있으면 다음 작업을 위한 빈 컨테이너를 최대 하나 미리 시작한다. 각 컨테이너에는 문서를 한 번만 전달하고 작업 후 삭제한다. 대기 시간이 지난 빈 컨테이너는 삭제하고 편집자가 남아 있으면 새로 준비한다. 뷰어 연결만 있는 경우에는 갱신하지 않는다. 앱이 응답하지 않으면 15초 안에 갱신이 멈추고, 남은 빈 컨테이너도 자신의 대기 시간 후 삭제한다. 컨테이너 작업 기한을 별도로 적용하는 엔진 어댑터에서는 빌드 제한 시간에 이 대기 시간과 시작 여유 시간을 더해야 한다.

PDF는 Pandoc(Markdown → Typst)과 Typst로 만든다. 렌더 이미지에 Quarto는 없다. Typst는 한 번의 실행에서 목차·교차참조·쪽 참조를 해결하므로 이전 빌드의 참조 상태를 보관하거나 재사용하지 않는다. 미리보기와 다운로드는 같은 PDF다. 렌더 시간 로그(`render-timing`)의 `worker`에는 입력 준비(`prepareMs`), Pandoc 변환(`pandocMs`), Typst 조판(`typstMs`) 시간이 들어 있다.

### 문서 설정과 글꼴

렌더 이미지의 `/opt/qollab/typst`(저장소의 `containers/typst`)에 Pandoc 템플릿(`template.typ`), 기본 양식의 두 부분(`typst-template.typ`, `typst-show.typ`), Lua 필터(`qollab.lua`: LaTeX 문법, `qmd.lua`: Quarto 문법)가 있다. 프로젝트가 자신의 양식을 쓰려면 같은 이름의 `.typ` 파일을 프로젝트에 두고 문서나 `_quarto.yml`의 `format: typst: template-partials`에 경로를 적는다(문서에 적으면 문서 위치 기준, `_quarto.yml`에 적으면 프로젝트 기준). 렌더 정책은 프로젝트 안의 상대 경로 `.typ` 파일만 받는다. 이때도 두 필터는 적용된다.

Quarto 문법 중 교차참조(`@fig-`·`@tbl-`·`@eq-`·`@sec-`, `-@`로 번호만), 번호 수식(`$$…$$ {#eq-…}`), callout 5종, 2단(`.columns`), `{{< pagebreak >}}`, 각주, 문헌 인용을 지원한다. 문서 설정의 캡션·참조 이름(`crossref`), 캡션 위치(`fig-cap-location`, `tbl-cap-location`), 날짜 형식(`date-format`: long·full·medium·short, 한국어·영어)도 적용한다. 번호 없는 절을 `@sec-`로 참조하면 제목 링크가 되고, 없는 라벨은 `?@라벨`로 표시하고 경고한다. 그 밖의 Quarto 블록(`.panel-tabset` 등)은 내용만 보이고, 다른 shortcode는 빠지며, 코드 셀은 실행하지 않고 코드로만 보인다. 모두 빌드 로그에 경고를 남긴다. 렌더러가 쓰지 않는 설정(예: `keywords`)도 경고로 남는다.

편집기가 쓰는 LaTeX 인라인 문법(`\textcolor`, `\ul`, `\textbf`, `\texttt`, `\char`, `\label`, `\ref`, `\cref`, `\pageref`, `\newpage`)은 필터가 Typst로 옮긴다. 목록 항목 안의 `\label`은 `\ref`에서 항목 번호로, 그 밖의 `\label`은 속한 절 번호로 표시된다. 옮길 수 없는 명령과 Raw LaTeX 블록(쪽 나눔만 있는 블록 제외)은 빼고 빌드 로그 처음에 `WARNING (qollab): …`로 남긴다. Typst 블록(```` ```{=typst} ````)은 그대로 들어간다.

LaTeX PDF 형식(`format: pdf`)으로 쓴 기존 설정은 렌더 시 Typst 설정으로 옮긴다. `geometry`의 여백은 `margin`으로, LaTeX 용지 이름(`letterpaper`, `b5` 등)은 Typst 이름으로, `pagestyle: empty`는 쪽 번호 없음으로, `classoption: twocolumn`은 `columns: 2`로, `colorlinks: false`는 링크 색 없음으로 바꾼다. `documentclass`, `pdf-engine`, `fig-pos` 같은 LaTeX 전용 설정과 LaTeX 명령이 든 `header-includes`는 경고를 남기고 무시한다. 렌더 정책은 기존 문서를 열 수 있도록 이 설정들을 계속 허용한다(`pdf-engine`은 `xelatex`, `lualatex`만). 프로젝트의 `.tex`·`.sty` 파일은 보관만 되며 Typst는 읽지 않는다.

문서 설정 패널에서 고를 수 있는 글꼴은 렌더 이미지에 설치된 글꼴(`packages/codec/src/typesetting.ts`)과 같다. Pretendard(SIL OFL 1.1)는 Regular와 Bold를 고정된 릴리스(1.3.9, SHA-256 확인)에서 설치한다. 다른 글꼴이 필요하면 렌더 이미지에 설치하고 이 목록에 추가한다. 렌더 정책은 목록에 없는 글꼴 이름을 거부한다. `CJKmainfont`(영문 글꼴 + 한글 글꼴)를 쓰면 Typst 글꼴 목록에 영문 글꼴, 한글 글꼴 순으로 넣어 영문 글꼴에 없는 한글을 한글 글꼴로 조판한다. 지정하지 않으면 본문은 Noto Serif CJK KR, 제목은 Noto Sans CJK KR, 수식은 Latin Modern Math다.

## 백업·복원

```sh
# ADMIN_TOKEN은 현재 설치의 값. shell history에 값을 직접 쓰지 않도록 읽는다.
read -r -s ADMIN_TOKEN; export ADMIN_TOKEN
scripts/backup.sh ./backup-20261007
# Podman: COMPOSE_ENGINE=podman scripts/backup.sh ./backup-20261007
```

- 쓰기 정지 → 진행 중 트랜잭션 완료 → Git 미러 반영 → pg_dump + 파일 tar → 쓰기 재개.
- 원본 문서·이미지·Yjs 상태·권한·이력·마지막 정상 PDF를 DB에 함께 보관한다.
- `.env`는 백업 스크립트에 포함하지 않는다. 별도 암호화 보관한다. 백업은 개인정보·문서·세션을 포함하므로 접근을 제한한다.
- `SHA256SUMS`, backup ID와 이미지 목록을 보관한다.
- 새 설치의 빈 볼륨 또는 교체할 설치에 복원한다. 복원 명령은 해당 설치의 DB·프로젝트 볼륨을 교체한다.

```sh
scripts/restore.sh ./backup-20261007
# Podman: COMPOSE_ENGINE=podman scripts/restore.sh ./backup-20261007
```

중단된 freeze는 관리자 API에 `{"frozen":false}`를 전송해 해제한다. 앱 시작 시 DB 상태에서 파일을 재생성하고 미완료 Git 체크포인트를 재생한다. 권한·세션은 프로젝트 History 복원에 포함되지 않으며, 운영 백업에는 포함된다.

## 렌더 실패

- 마지막 정상 PDF와 revision은 실패 시 유지된다.
- 실행 코드 셀, 프로젝트 스크립트, 사용자 filter, 확장은 거부한다. 템플릿은 프로젝트 안의 `.typ` 템플릿 부분만 받는다.
- Raw TeX/HTML은 원문으로 보존하며 PDF에는 넣지 않는다(빌드 로그 경고). 렌더러의 파일 접근은 격리 컨테이너 안에 제한된다.
- 작업에는 네트워크가 없어 Typst 패키지(`@preview/…`)를 내려받지 않는다.
- lease가 만료된 작업은 실패 처리한다. 관리 프로세스 재시작 시 자기 namespace의 잔여 컨테이너를 제거한다.
- 이미지·빌드·프로젝트 이력을 자동 삭제하지 않는다. 초기 버전 운영자는 저장 공간을 감시하고 보존 정책에 맞춰 프로젝트 백업·삭제를 수행한다.
