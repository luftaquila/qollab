# 0.1.4 반복 PDF 빌드 개선

- 일자: 2026-10-08. 구현 `96ef67a`, 태그 `v0.1.4`.
- [커밋 이미지 검증](https://github.com/luftaquila/qollab/actions/runs/37640810860): 전체 성공. 아래 CI 측정은 이 실행의 산출물이다.
- [릴리스 이미지 검증](https://github.com/luftaquila/qollab/actions/runs/37642433295): 전체 성공. 첫 태그 실행은 이미지 작업 시작 전에 실패했고 재실행 API가 500을 반환하여 같은 태그에서 새 workflow 실행으로 완료했다. 커밋 이미지와 릴리스 이미지의 digest는 같다.

## 변경

- 관리자 메모리에 같은 프로젝트·문서 경로·복원/문서 세대의 TeX 참조 정보를 제한적으로 보관한다. 새 TeX의 preamble이 같을 때 첫 조판에만 복원한다.
- 한 글자를 고친 뒤 참조가 그대로면 XeTeX가 한 번 실행된다. 목차·페이지 번호 등이 바뀌면 Quarto가 필요한 재조판을 수행한다. 잘못된 캐시로 실패하면 같은 작업 시간 제한 안에서 캐시 없이 다시 빌드한다.
- 문서가 없는 작업 컨테이너 하나를 최대 30초 미리 준비한다. 문서는 컨테이너당 한 번만 전달하며, 작업 후·대기 만료·관리자 종료 시 삭제한다.
- 이미지에는 신뢰된 fixture로 만든 Deno 코드 캐시를 포함한다. 사용자 문서, TeX 참조 상태, Quarto localStorage는 이미지에 포함하지 않는다.
- 캐시 전체 16MiB, 작업별 참조 파일 1MiB, 재사용 기한 5분. DB·Git에는 저장하지 않는다. 설정과 경계는 [운영 문서](operations.md), [상세설계](../DESIGN.md)에 기록했다.

## 실제 브라우저 측정

같은 Linux ARM64 서버, CPU 1개·메모리 2GiB, 자동 빌드 대기 750ms에서 같은 시험 프로젝트를 편집했다. 한글·수식·표·PNG가 있는 한 페이지 문서다. 한 글자 입력부터 새 build ID의 PDF 응답과 실제 canvas 표시까지 측정했다.

| 입력 → PDF 표시 | 0.1.3 | 0.1.4 연속 수정 |
|---|---:|---:|
| 1회 | 11.768초 | 6.181초 |
| 2회 | 10.831초 | 6.316초 |
| 3회 | 11.431초 | 6.232초 |
| 중앙값 | 11.431초 | 6.232초 |

- 연속 수정의 중앙값은 약 45% 감소했다. 저장 확인은 127–129ms, Quarto 처리는 4.770–4.829초였다. XeTeX는 각각 한 번 실행됐다.
- 관리자 재시작 후 캐시와 대기 컨테이너가 없는 첫 수정은 **13.020초**였다. 위 세 번은 그 다음 수정이다. 처음부터 빠르거나 모든 문서에 같은 개선율이 적용된다는 뜻은 아니다.
- 브라우저 오류 0개. PDF 텍스트에서도 입력한 글자를 확인하고 페이지를 이미지로 렌더해 한글·수식·표·그림을 확인했다.
- 원본: [변경 전](evidence/0.1.4/latency-before.json), [첫 수정 및 연속 수정](evidence/0.1.4/latency-after.json), [작업 단계](evidence/0.1.4/worker-timings.json), [화면](evidence/0.1.4/preview.png).
- 별도 시험 계정·세션·프로젝트는 삭제했다. 실제 Google 로그인 재검증은 아니다.

## 정확성과 수명주기

- TypeScript/Vue, 빌드, Vitest 35개, Python 3개, Chromium 5개 통과.
- 네이티브 Docker AMD64·ARM64에서 각각 새 컨테이너로 한 글자를 수정해 참조 복원과 조판 1회를 확인했다.
- 한글·PNG·표·수식·그림/표/수식 참조·목차·문헌·페이지 참조를 포함한 문서에 페이지를 추가했다. 캐시를 사용해도 추가 조판으로 참조 페이지가 3으로 갱신됐다. 캐시 없이 만든 결과와 텍스트가 같고, Poppler로 렌더한 세 페이지 PNG도 각각 바이트가 같았다. 페이지를 직접 열어 확인했다.
- 고의로 잘못된 TeX 명령을 캐시에 넣었을 때 캐시 없는 재시도로 복구했다. preamble 변경·경로 이탈·크기 초과·symlink, 프로젝트 및 문서/복원 세대 분리도 검사했다.
- 두 아키텍처에서 네트워크·자격증명·호스트 경로 격리, 1초 timeout, 전체 앱 실행과 백업 복원을 통과했다. 로컬 Podman 런타임은 다시 시작하지 않았다.
- 실제 서버에서 대기 컨테이너의 문서 부재·UID 10001·서비스 계정 토큰 부재를 확인했다. 진행 중 빌드 취소 후 사용한 Pod가 6.243초 내 사라졌고 마지막 정상 PDF가 유지됐다. 빈 대기 Pod도 만료 후 사라져 잔여 작업 0개였다. [수명주기 기록](evidence/0.1.4/lifecycle.json).

| CI 단일 페이지 fixture | 첫 빌드 | 참조 캐시로 한 글자 수정 |
|---|---:|---:|
| AMD64 | 4.18초 | 2.43초 |
| ARM64 | 5.31초 | 3.26초 |

각 CI 실행기의 단일 측정이며 실제 서비스 브라우저 시간과는 다른 범위다. 원본: 첫 빌드 [AMD64](evidence/0.1.4/render-amd64.json)·[ARM64](evidence/0.1.4/render-arm64.json), 반복 빌드 [AMD64](evidence/0.1.4/incremental-amd64.json)·[ARM64](evidence/0.1.4/incremental-arm64.json), 앱·백업 복원 [AMD64](evidence/0.1.4/deployment-amd64.json)·[ARM64](evidence/0.1.4/deployment-arm64.json).

## 실행과 제한

앱과 렌더러의 `0.1.4` 태그는 `linux/amd64`, `linux/arm64`를 포함한다. 익명 manifest 조회를 확인했으며 실제 서버에서 측정한 이미지와 같은 digest다. [발행 기록](evidence/0.1.4/images.json).

| 공개 OCI 이미지 | index digest |
|---|---|
| `ghcr.io/luftaquila/qollab:0.1.4` | `sha256:48aefde026874202bfb47460d322ab1baa3ecae2c7ebff6c82246e39171be2b9` |
| `ghcr.io/luftaquila/qollab-renderer:0.1.4` | `sha256:81b6e81e398537f472905d5044999c6adfa30ee2487b3b726e696d5660863aff` |

[고정 이미지 환경](versions.env)과 [Docker/Podman 운영 문서](operations.md)를 사용한다.

```sh
cp .env.example .env
cat docs/versions.env >> .env
# .env에서 Google 설정, 승인 계정과 비밀값을 지정한다.
docker compose up -d
```

첫 빌드, 캐시 만료·관리자 재시작·문서 세대 변경, 목차나 참조가 바뀌는 수정은 더 걸릴 수 있다. Quarto는 계속 문서 전체를 처리하므로 긴 문서나 서버 부하에 따라 시간이 늘어난다. 대기 중인 다른 프로젝트의 빌드 시간도 포함될 수 있다. 즉시 미리보기나 대규모 동시 편집 부하를 검증한 것은 아니다.
