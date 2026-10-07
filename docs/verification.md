# 0.1.0 검증 기록

- 일자: 2026-10-07.
- 구현 commit: `94acf7fea6edef18cd07c40adcd77bd21360040b` (`v0.1.0`). 문서 기록은 이후 commit으로 추가한다.
- [릴리스 검증 실행](https://github.com/luftaquila/qollab/actions/runs/37622140147): 전체 성공.
- 실제 Google 계정 로그인은 OAuth 설정이 없어 **미검증**이다. 운영 이미지에 로그인 우회 경로는 없다.
- 특정 서버에는 배포하지 않았다. 아래 실행은 임시 로컬 환경과 GitHub Actions 환경에서 수행했다.

## 자동화 검증

| 범위 | 결과와 검증 내용 |
|---|---|
| TypeScript / Vue | `npm run check` 통과 |
| Vitest | 32개 통과: Codec, API/권한, OIDC, 장애 복구 |
| Playwright | Chromium 4개 통과: 한국어/영어, 두 브라우저 협업, 이미지, 성능 측정 |
| 원문 | YAML·미지원 인라인·중첩 div·실행 셀·Raw TeX·이미지 속성 왕복 보존, 무수정 열기/저장, 반복 저장 안정성, 동일 문단의 서로 다른 원문 표기 유지 |
| 공동편집 | 두 클라이언트 수정 병합, 커서, 개인 undo/redo, 한글 composition 이벤트와 원격 수정, 재접속 및 저장 ACK 뒤 서버 SIGKILL/재시작 |
| 권한 | CSRF/Origin, Viewer 쓰기 차단, 기존 소켓 권한 회수, 마지막 Owner 보호, 만료·단일 사용·대상 이메일 초대 |
| 복원 | 문서·이미지 전체 복원, 멤버 유지, 새 세대/이전 세대 거부, DB commit 직후 프로세스를 종료한 복원의 재시작 완료 |
| 이미지/파일 | 업로드 ID 재시도 중복 방지, PNG/JPEG 검증, 상대 경로, 붙여넣기·드롭·선택·교체·재사용, 실패 시 참조 미삽입, 참조 중 삭제 차단, ZIP 경로/심볼릭 링크 거부 |
| 빌드 상태 | 오래된 결과의 최신 PDF 덮어쓰기 방지, 실패 시 마지막 정상 PDF 유지, 복원 세대 경계를 넘는 결과 거부 |
| 인증 | 서명된 로컬 OIDC 제공자: code+PKCE, nonce, audience, 잘못된 서명, state 재사용 검증 |
| 의존성/로딩 | Vue·Yjs 각 1개, 초기 로그인에서 Editor/PDF/KaTeX/worker 요청 없음, 수식과 CodeMirror 함께 포함, Crepe 기본 history 제외, 이미지 blob URL 미저장 |

IME 검증은 Chromium의 composition 이벤트 자동화다. 모든 OS의 실제 키보드 입력기와 모바일 브라우저를 검증했다는 뜻은 아니다.

## 컨테이너와 PDF

- Docker: GitHub Actions의 네이티브 Linux AMD64 및 ARM64 실행기. 에뮬레이션을 사용하지 않았다.
- rootless Podman: macOS ARM64의 Podman machine, VM 메모리 6GiB. 처음의 2GiB VM에서는 호스트 메모리 부족으로 LuaLaTeX가 종료되어 메모리를 늘렸다. 작업 컨테이너 제한은 계속 2GiB다.
- 실제 Quarto/LuaLaTeX로 한글·표·수식·PNG를 포함한 PDF를 생성했다. 추출 텍스트, 내장 이미지와 페이지 렌더링을 확인했다.
- 작업 UID 10001, 읽기 전용 루트, 외부 네트워크 차단, 앱/DB/Google 비밀정보 부재, 엔진 소켓·프로젝트 볼륨 부재를 검사했다. CPU/메모리/PID/tmpfs/capability 제한은 실제 작업과 같은 실행 옵션을 사용한다.
- 1초 제한을 주어 `RENDER_TIMEOUT`과 일회성 컨테이너 종료를 확인했다.
- 앱 → 영구 작업 큐 → 관리자 → 일회성 컨테이너 → PDF 다운로드 전체 경로를 검증했다.
- 백업 후 원본을 변경하고 복원하여 문서·이미지·멤버·이력의 동일성을 비교했다. PDF 생성·다운로드도 검사했다. 백업에는 협업 상태·권한·이력이 함께 포함된다.

## 발행 이미지

앱과 렌더러 모두 공개 GHCR 이미지다. 아래는 `linux/amd64`, `linux/arm64`를 포함한 OCI index digest이며 익명 manifest 조회를 검증했다. 릴리스 태그는 `0.1.0`, commit 태그는 `sha-94acf7fea6edef18cd07c40adcd77bd21360040b`다.

| 이미지 | OCI index digest |
|---|---|
| `ghcr.io/luftaquila/qollab:0.1.0` | `sha256:22837d912bf6e81dafe9cf1bddaf3d6d0438c18e3649e6bcad112f1c5c2a795f` |
| `ghcr.io/luftaquila/qollab-renderer:0.1.0` | `sha256:d64562242bcff3fd4a67109fe20a05e1dfa6114edaceb1d9377193393b639fdc` |

[고정 이미지 환경 파일](versions.env), [플랫폼/익명 접근 기록](evidence/images.json).

```sh
cp .env.example .env
cat docs/versions.env >> .env
# .env에서 비밀값, Google 설정과 승인 계정을 지정한다.
docker compose up -d
```

Podman은 [운영 문서](operations.md)의 소켓·Compose 설정 후 같은 `.env`의 고정 이미지를 사용한다.

Docker 전체 실행/백업·복원 기록: [AMD64](evidence/deployment-docker-amd64.json), [ARM64](evidence/deployment-docker-arm64.json). 각각 65초·56초는 PDF 생성부터 백업·복원까지의 전체 시간이며 순수 렌더링 성능 수치가 아니다.

- rootless Podman에서도 위 digest를 인증 정보 없이 내려받아 전체 실행·백업·복원을 다시 통과했다: [44초 실행 기록](evidence/deployment-podman-arm64.json).
- 복원된 PDF의 바이트 일치, 실행 중 작업 취소 후 11.8초 내 컨테이너 제거, 마지막 정상 PDF 유지, 관리자 재시작 시 잔여 컨테이너 제거: [수명주기 기록](evidence/lifecycle-podman-arm64.json).
- 공개 앱 이미지의 실제 PDF.js 렌더링: canvas 1개, 브라우저 오류 0개. [브라우저 기록](evidence/preview-podman.json), [화면](evidence/preview-podman.png).
- 직접 실행한 한 페이지 PDF fixture는 네이티브 Docker AMD64 56.67초, ARM64 50.16초였다. 초기 TeX 캐시가 없는 일회성 작업이며 CPU 1개 제한이다.

## 번들 크기

`npm run build` 후 Node.js 24.15.0으로 파일을 압축한 바이트 수다. CSS가 있는 항목은 JS+CSS 합계다. 폰트, 지연 로딩 이력 diff와 전송 헤더는 제외한다.

| 묶음 | 원본 | gzip | Brotli |
|---|---:|---:|---:|
| 앱 셸 | 110,176 | 40,644 | 36,347 |
| 편집기 | 1,516,195 | 457,961 | 372,408 |
| PDF.js | 432,395 | 129,055 | 106,972 |
| PDF worker | 1,264,342 | 376,488 | 307,591 |

[번들 측정 원본](evidence/bundle.json). 앱 셸은 편집기와 PDF worker를 선행 로드하지 않는다.

## 브라우저 측정

Chromium `145.0.7632.6`, 단일 클라이언트, loopback, 문서 19,795 bytes. 키 입력부터 다음 animation frame까지의 p95와 여섯 번 문서 전환을 측정했다. 힙은 명시적 GC 후 값이다.

| 환경 | 입력→frame p95 | 문서 전환 6회 범위 | 전환 전/후 힙 |
|---|---:|---:|---:|
| macOS ARM64 | 15.7ms | 120.6–152.4ms | 9,819,152 / 11,761,980 bytes |
| Linux AMD64 CI | 16.4ms | 89.7–193.5ms | 9,687,344 / 11,563,996 bytes |

원본: [macOS](evidence/performance-macos-arm64.json), [Linux](evidence/performance-linux-amd64.json). 짧은 단일 환경 측정이며 장시간 메모리 안정성, 대용량 문서, 다중 사용자 부하의 보증이 아니다. 다른 프레임워크 대비 개선율은 측정하지 않았다.

## 제한

- 실제 Google 로그인, 모바일 브라우저, 장시간·다중 프로젝트 부하 시험은 미검증이다.
- Visual 지원 경계가 불확실한 문법은 원문 복구 모드로 전환한다. 전용 UI가 없는 Quarto 구문은 Raw 노드로 보존한다. 모든 Quarto 확장 문법의 시각 편집을 제공하지 않는다.
- 댓글·제안, 완전한 오프라인 편집, Visual/Source 동시 편집, 사용자 코드 실행, 고급 페이지 배치는 후속 범위다.
- 초기 서버는 프로젝트 JSONB 스냅샷과 이미지 원본을 DB에 보관한다. 대규모 asset 스토리지와 수평 확장은 이번 검증 범위가 아니다.
- `npm audit`: 낮음 5건, 중간/높음/치명적 0건. Milkdown 하위 KaTeX 의존성과 개발용 esbuild의 Windows 개발 서버 관련 권고가 남아 있다. 의존성 호환성을 유지한 상태이며 KaTeX `trust`는 활성화하지 않는다.
- 자동 검증은 독립적인 보안 감사나 컨테이너 커널 취약점 검증을 대체하지 않는다.
