# 0.1.1 PDF 미리보기 수정

후속 빌드 속도 개선과 최신 이미지: [0.1.3 검증](verification-0.1.3.md). 아래는 0.1.1 당시의 기록이다.

- 일자: 2026-10-07.
- 구현: `ddd46bfd48d6468f14c7179b3856377c6bdb3038`, 태그 `v0.1.1`.
- [릴리스 CI](https://github.com/luftaquila/qollab/actions/runs/37630062942): 성공.
- 기존 기능과 제한의 기준 기록: [0.1.0 검증](verification.md).

## 원인과 변경

일회성 작업의 writable TeX 캐시가 비어 있어 LuaLaTeX가 매번 한글 폰트 데이터를 생성했다. 실제 서버의 첫 사용자 PDF는 작업 등록부터 완료까지 83.37초가 걸렸다. 이전 이미지 빌드의 root 계정 캐시는 작업 계정의 캐시 경로와 달라 재사용되지 않았다.

- 각 네이티브 이미지 빌드에서 실제 한글·영문·수식·표 문서를 렌더하여 폰트 캐시를 준비한다.
- 작업 시작 시 신뢰된 이미지의 캐시를 작업 전용 tmpfs에 복사한다. `TEXMFVAR`, `TEXMFCACHE`를 같은 경로로 고정한다. 작업 간 writable 캐시는 공유하지 않는다.
- 첫 PDF가 없을 때 대기/생성 진행 상태를 표시하고, 결과 도착 후 자동으로 미리보기를 연다.
- 이전 PDF 로딩 작업의 완료 콜백이 새로운 작업을 정리하지 않도록 인스턴스를 구분한다. 로딩 중 확대/축소는 비활성화한다.

## 자동화 결과

- TypeScript/Vue 검사와 빌드 통과, Vitest 32개, Chromium Playwright 5개 통과.
- 추가 브라우저 테스트: 문서를 먼저 연 뒤 queued → running → succeeded 상태를 전달하고 PDF.js가 실제 PDF 픽셀을 그리는지 확인한다. 완료 상태와 PDF 응답은 fixture이며 갱신 알림은 실제 프로젝트 이벤트 스트림을 사용한다.
- 네이티브 Docker AMD64/ARM64에서 실제 PDF 생성, 실행 중 폰트 이름 DB 재생성 없음, 격리, 1초 timeout, 앱 전체 실행과 백업·복원을 통과했다.
- 한글·표·수식·이미지가 포함된 결과를 텍스트 추출, 내장 이미지 검사와 페이지 이미지로 확인했다.

| 동일한 한 페이지 PDF fixture, CPU 1개 | 0.1.0 | 0.1.1 |
|---|---:|---:|
| Docker AMD64 | 56.67초 | 14.12초 |
| Docker ARM64 | 50.16초 | 11.90초 |

각 버전의 네이티브 GitHub 실행기에서 한 번씩 측정한 컨테이너 실행 시간이다. 동일한 물리 호스트의 반복 벤치마크나 모든 문서의 성능 보장은 아니다. 결과 PDF는 양쪽 모두 22,157 bytes다.

근거: [CI 측정](evidence/0.1.1/ci.json), 전체 실행·백업·복원 [AMD64](evidence/0.1.1/deployment-docker-amd64.json), [ARM64](evidence/0.1.1/deployment-docker-arm64.json), [번들 크기](evidence/0.1.1/bundle.json).

## 실제 HTTPS 서버 확인

- Linux ARM64 서버에서 새 앱·렌더러 digest로 교체된 것을 확인한 후 독립된 시험 프로젝트를 만들었다.
- 문서를 PDF 생성 전에 열어 진행 표시를 확인했다. 새로고침 없이 실제 PDF가 도착하고 canvas에 한글·표·수식·PNG가 표시됐다. 브라우저 오류는 0개였다.
- 작업 등록부터 완료까지 23.564초, 브라우저의 전체 확인까지 약 24초였다. 이전 버전에서 같은 서버 시험 문서의 전체 확인은 약 84초였다. CI fixture와는 다른 문서이며 Kubernetes 작업 시작 시간을 포함한다.
- 실제 렌더 로그에서도 폰트 DB 재생성이 없었다. 시험 프로젝트·계정·세션은 확인 후 삭제했다. 사용자 문서는 수정하지 않았다.
- 운영 이미지에는 인증 우회 경로가 없다. 이번 브라우저 검사는 독립된 시험 세션을 사용했으며 실제 Google 로그인 자체의 재검증은 아니다.

[실행 기록](evidence/0.1.1/preview-server-arm64.json), [생성 대기 화면](evidence/0.1.1/preview-progress.png), [완료 화면](evidence/0.1.1/preview-server-arm64.png).

## 공개 이미지

`linux/amd64`, `linux/arm64` OCI index이며 익명 다운로드를 확인했다. [manifest 기록](evidence/0.1.1/images.json), [고정 실행 환경](versions.env).

| 이미지 | digest |
|---|---|
| `ghcr.io/luftaquila/qollab:0.1.1` | `sha256:2bbcab935bbe982d1859e59e3e651136154fa16a5aef23ac6974ff8c4141d6b3` |
| `ghcr.io/luftaquila/qollab-renderer:0.1.1` | `sha256:6ee273416163842f9be9ffdce8df4b5601565ca1f38b8ce9b444f0ac3546aa21` |

```sh
cat docs/versions.env >> .env
docker compose pull
docker compose up -d
```

새 설치의 인증정보 설정과 Podman 소켓 설정은 [운영 문서](operations.md)를 따른다. 이번 수정은 로컬 Podman 서비스를 다시 설치하지 않았다. rootless Podman의 전체 경로는 0.1.0 검증이며 0.1.1 재실행으로 표시하지 않는다.
