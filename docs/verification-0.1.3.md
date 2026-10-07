# 0.1.3 PDF 빌드 지연 개선

- 일자: 2026-10-07. 구현 `553eeb9`, 태그 `v0.1.3`.
- [릴리스 CI](https://github.com/luftaquila/qollab/actions/runs/37634092215): 전체 성공.
- 0.1.2는 발행 전 빌드 후보였다. fontconfig 도구를 명시적으로 추가한 0.1.3을 발행·검증했다.

## 원인

0.1.1은 폰트 DB 재생성만 제거했다. 한 글자를 바꿔도 Quarto와 LuaLaTeX가 문서 전체를 다시 처리했고, 짧은 문서에서도 LuaLaTeX가 약 7.2초씩 두 번 실행됐다. 자동 빌드 대기 2초, 작업 준비와 앞선 빌드의 대기도 더해졌다. 실제 서버의 편집 저장은 0.13초 안팎이었으므로 저장·협업 통신이 주 병목은 아니었다.

## 변경

- PDF 엔진을 XeLaTeX로 바꾸고 이미지 빌드 때 fontconfig 인덱스를 준비한다. 대형 Lua 폰트 캐시 복사와 매 조판 시 역직렬화를 제거한다.
- Quarto의 참조 수렴을 위한 재실행을 유지한다. 조판 횟수를 무조건 한 번으로 제한하지 않는다.
- 작업마다 새로운 격리 컨테이너를 사용하는 경계를 유지한다. 네트워크 차단, shell escape 비활성, 비특권 UID와 자원 제한도 유지한다.
- 관리자 로그의 `render-timing`에 작업 생성·실행 및 worker의 준비·Quarto 처리 시간을 기록한다. 문서 내용과 인증정보는 기록하지 않는다.
- 검증한 실제 설치의 `BUILD_DEBOUNCE_MS`는 750ms로 조정했다. 제품 기본값은 계속 2000ms이며 설치별로 설정한다.

[Quarto의 공식 PDF 엔진 설정](https://quarto.org/docs/output-formats/pdf-engine)을 사용한다.

## 실제 브라우저 측정

같은 Linux ARM64 서버, CPU 1개·메모리 2GiB 제한, 같은 시험 프로젝트에서 한글 한 글자를 추가하고 새 PDF 응답과 실제 canvas 표시까지 측정했다. 한글·수식·표·PNG를 포함한 한 페이지 문서다. 변경 전후 각각 3회이며, 기존 PDF 표시를 새 결과로 오인하지 않도록 build ID 변경을 확인했다.

| 입력 → PDF 표시 | 0.1.1 / 대기 2000ms | 0.1.3 / 대기 750ms |
|---|---:|---:|
| 1회 | 22.205초 | 13.273초 |
| 2회 | 23.830초 | 11.428초 |
| 3회 | 23.166초 | 11.215초 |
| 중앙값 | 23.166초 | 11.428초 |

- 저장: 변경 전 128–131ms, 변경 후 138–155ms.
- 양쪽 모두 브라우저 오류 0개. [완료 화면](evidence/0.1.3/preview.png).
- 독립된 시험 계정·프로젝트·세션은 삭제했다. 사용자 문서를 수정하지 않았다. 실제 Google 로그인 재검증은 아니다.
- 작은 문서의 단기 측정이다. 긴 문서, 복잡한 수식, 서버 부하와 앞선 작업에 따라 더 걸린다. 전체 PDF 재조판 구조는 유지되며 즉시 반영을 보장하지 않는다.

원본: [변경 전](evidence/0.1.3/latency-before.json), [변경 후](evidence/0.1.3/latency-after.json).

## 단계별 측정

같은 서버의 별도 짧은 한글 문서로 실제 엔진 호출을 감싸 측정했다. 위의 이미지·수식 포함 브라우저 시험과는 다른 fixture다.

| 단계 | LuaLaTeX | XeLaTeX |
|---|---:|---:|
| TeX 두 번 합계 | 14.45–14.54초 | 3.91–4.18초 |
| Quarto 전체 | 16.74–17.99초 | 6.19–7.90초 |
| 작업 준비 | 2.42초 | 1.75초 |

Quarto 전체 시간에는 TeX 시간이 포함된다. 작업 준비 시간의 차이는 한 번씩 측정한 변동이며 그 부분의 구조를 바꾸지는 않았다. [변경 전](evidence/0.1.3/stages-before.json), [변경 후](evidence/0.1.3/stages-after.json).

## 검증과 발행

- TypeScript/Vue 및 빌드, Vitest 32개·Chromium 5개 통과.
- 네이티브 Docker AMD64/ARM64: 한글·표·수식·PNG, 목차·문헌·그림/표/수식 참조와 두 번째 페이지의 `pageref`가 실제로 해결되는지 검사했다. 두 페이지를 이미지로 렌더하여 확인했다.
- 격리·1초 timeout·앱 전체 실행·백업 복원을 양쪽 아키텍처에서 통과했다. 로컬 Podman은 재설치·재실행하지 않았다.
- 같은 CI 단일 페이지 fixture: AMD64 14.12→5.33초, ARM64 11.90→5.78초. 각각 별도 CI 실행기의 단일 측정이다.
- [AMD64 렌더](evidence/0.1.3/render-amd64.json), [ARM64 렌더](evidence/0.1.3/render-arm64.json), 전체 실행·백업·복원 [AMD64](evidence/0.1.3/deployment-amd64.json), [ARM64](evidence/0.1.3/deployment-arm64.json).

| 공개 OCI 이미지 | index digest |
|---|---|
| `ghcr.io/luftaquila/qollab:0.1.3` | `sha256:abced1c9e78183df5538d6a6c314eb35f3a5375b6be47d4aa58b92f1d46aa69a` |
| `ghcr.io/luftaquila/qollab-renderer:0.1.3` | `sha256:b6ad68e03d8d1ee99673c006667f8ef4910a4bfce7db6f6b7a0ec018056120e4` |

두 이미지에 `linux/amd64`, `linux/arm64`가 포함되며 익명 manifest 조회를 검증했다. [발행 기록](evidence/0.1.3/images.json). 실행은 [운영 문서](operations.md)와 [고정 이미지 환경](versions.env)을 따른다.
