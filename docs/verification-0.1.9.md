# 0.1.9 디바운스와 중간 PDF 교체 수정

- 일자: 2026-10-08. 구현 `03d08dc22f9dc78603ea96c12972bbff36b17340`, 태그 `v0.1.9`.
- [릴리스 검사](https://github.com/luftaquila/qollab/actions/runs/37718302317): 전체 성공. 같은 소스의 중복 main 실행은 취소했다.

## 원인과 변경

- 이전 25ms 디바운스는 입력 도중 여러 빌드를 시작할 수 있었다. 완료 결과는 표시 중인 PDF보다 최신인지만 확인했으므로, 이미 추가 수정이 저장된 경우에도 중간 문서 PDF가 미리보기를 교체했다.
- 기본 설정·Compose 예제·운영 설정을 **마지막 수정 후 2초**로 복원했다. 실행 중 추가된 요청은 대기 중인 최신 스냅샷 하나로 합친다. 연속 입력의 최대 대기 10초는 유지한다.
- 빌드 결과의 프로젝트 세대·대상 문서가 일치하고 최신 내용 revision 이상일 때만 PDF 포인터를 갱신한다. 중간 결과는 빌드 이력에 보관하고 표시 중인 마지막 정상 PDF를 유지한다. 체크포인트·멤버 변경처럼 내용을 바꾸지 않는 revision 증가는 완료 PDF를 막지 않는다.
- 브라우저에서도 미저장 수정·최신 내용 revision을 확인한다. 늦게 도착한 프로젝트 조회 응답이 내용 revision을 되돌리거나 중간 PDF를 표시하지 않게 했다. 같은 완료 이벤트가 반복되어도 같은 build ID로 다시 요청하지 않는다.
- Quarto/Pandoc/XeLaTeX와 기존 준비 작업 최적화는 유지한다. 이번 2초는 의도한 입력 대기 시간이므로 [0.1.8의 25ms 설정 측정](verification-0.1.8.md)과 입력→표시 시간을 직접 비교하지 않는다.

## 회귀 검사

- TypeScript/Vue·빌드, Vitest **39개**, Chromium **7개** 로컬 통과. 전용 임시 PostgreSQL을 사용하고 검사 후 DB와 SSH 터널을 제거했다.
- 서버: 연속 수정의 스냅샷이 하나로 합쳐지고 2초 전에는 임대되지 않으며 이후 마지막 내용으로 임대되는지 확인했다.
- 서버: 중간 결과 두 개와 늦은 이전 결과가 마지막 정상 PDF를 교체하지 않고 최신 내용 결과만 채택되는지 확인했다. 대상 문서·세대 불일치와 내용 변경 없는 체크포인트도 검사했다.
- 브라우저: 중간 완료 이벤트 두 개, 요청 중 새 편집 이벤트, 뒤늦은 조회 응답, 최종 완료 이벤트 중복을 전달했다. PDF 요청은 **기존 PDF 1회 + 최종 PDF 1회**, 중간 PDF 요청 **0회**였다.
- CI에서도 Vitest 39개·Python 7개·Chromium 7개를 통과했다. 네이티브 AMD64·ARM64에서 실제 PDF·격리·timeout·운영 Compose 실행·백업 복원 검사를 통과했다. 기존 빠른 경로의 5가지 표본과 전체 Quarto 출력의 모든 페이지 픽셀도 일치했다.
- [로컬 검사](evidence/0.1.9/local-checks.json), [AMD64 복원](evidence/0.1.9/deployment-amd64.json), [ARM64 복원](evidence/0.1.9/deployment-arm64.json), [AMD64 출력 비교](evidence/0.1.9/fidelity-amd64.json), [ARM64 출력 비교](evidence/0.1.9/fidelity-arm64.json).

## 실제 운영 브라우저 확인

실제 사용자 문서와 분리된 임시 계정·프로젝트에서 Chromium으로 확인했다. 운영 앱과 렌더러의 교체 완료, `BUILD_DEBOUNCE_MS=2000`, 배포 저장소 반영 상태를 확인했다.

| 경우 | 결과 |
|---|---|
| 세 글자를 350ms 간격으로 입력 | 빌드 1개, 새 PDF 요청 1회. 마지막 입력 후 2.062초에 running 상태를 관찰했다. |
| revision 8 빌드 중 revision 9 저장 | revision 8 완료 후에도 기존 PDF를 유지했다. 중간 PDF 요청 0회, revision 9 PDF 요청 1회. |
| 최종 파일 확인 | 다운로드 PDF 텍스트에 마지막 `FIRST FINAL` 입력이 포함됐다. |

- [측정 원본](evidence/0.1.9/refresh-live.json), [최종 편집 화면](evidence/0.1.9/preview.png). 두 시나리오를 독립된 페이지에서 실행한 검사에서는 브라우저 오류가 0개였다.
- 문서 전환을 포함한 첫 검사에서는 PDF 관련 검증은 통과했으나 `Context "editorState" not found` 오류가 1회 발생했다. 발생시킨 콜백은 수집하지 못해 원인은 확정하지 않았다. 이번 릴리스에서 편집기 수명주기 코드는 수정하지 않았으며 이 오류의 해결을 주장하지 않는다. [별도 관찰 기록](evidence/0.1.9/navigation-observation.json).
- 배포 전 DB·파일 백업을 완료했다. 확인 후 임시 프로젝트·업데이트·문서 세대·사용자·세션·파일 미러를 제거했다. 삭제 감사 기록과 백업은 보존한다.

## 실행

고정 공개 이미지는 [versions.env](versions.env)에 기록한다. [익명 GHCR 조회](evidence/0.1.9/images.json)에서 AMD64·ARM64를 확인했다. [운영에서 확인한 ARM64 manifest](evidence/0.1.9/images-arm64.json)는 같은 공개 index에 포함된다. 기존 `.env`에서도 `BUILD_DEBOUNCE_MS=2000`으로 설정하고 이미지 값을 갱신한다.

```sh
docker compose pull
docker compose up -d
# Rootless Podman: 운영 문서의 엔진 소켓 설정 필요
podman compose -f compose.yaml -f compose.podman.yaml up -d
```

브라우저를 새로고침해 새 클라이언트 코드를 불러온다. 최신 빌드가 실패하면 이전 정상 PDF를 계속 표시한다. rootless Podman과 실제 Google 로그인을 이번 수정에서 재시험하지 않았다.
