# 프로젝트 웹 서식

프로젝트 루트의 `_qollab-web.yml`에 사용자 정의 Typst 함수의 웹 표시를 지정한다. 파일 패널에서 YAML 파일로 생성·편집하며 저장하면 편집자의 웹 미리보기와 해당 프로젝트의 VitePress 발행물에 적용된다. 공동 편집자는 프로젝트 변경 이벤트로 새 정의를 받는다. 발행물은 저장 후 재빌드되며, 프로젝트 ZIP에도 이 파일이 포함된다.

```yaml
version: 1
variables:
  gap: 2.5pt
functions:
  document-header:
    tag: header
    style:
      text-align: center
      margin-block: 2rem
  revision-note:
    tag: span
    style:
      color: "#0000ff"
  section-title:
    tag: h2
    style:
      text-align: center
  writing-field:
    tag: span
    style:
      display: inline-block
      border-bottom: 1px solid currentColor
      min-width: 4em
```

함수 이름은 프로젝트에서 정한다. 위 예제는 `#revision-note[내용]`을 파란색 인라인 글자로 표시한다. 다른 함수 안이나 표 안에 있는 호출도 같은 규칙을 사용한다. 본문은 뒤따르는 `[...]` 또는 괄호 안의 콘텐츠 인수 `([…])`로 전달할 수 있다. 정의하지 않은 함수는 내용을 보존하고 미지원 경고를 표시한다. 잘못된 YAML이나 허용하지 않는 설정은 파일 경로가 포함된 경고로 표시한다.

`tag`는 `span`, `strong`, `em`, `u`, `small`, `div`, `p`, `section`, `header`, `footer`, `aside`, `blockquote`, `h1`~`h6`를 지원한다. 문장 안에서 사용하는 함수는 인라인 태그를 선택한다. 제목 태그는 고유한 앵커를 받아 웹 목차와 검색에 포함된다. 장별 페이지 경계는 기존 Markdown 제목을 유지한다.

`style`은 요소 자체에 적용하는 선언이다. 색상, 글꼴 크기·굵기·스타일·종류, 자간·줄 높이, 정렬·장식·공백 처리, `display`, 수직 정렬, 너비·높이와 최솟값·최댓값, 여백·안쪽 여백, 테두리·모서리 반경을 지원한다. 지원하는 정확한 속성은 `packages/codec/src/web-format.ts`의 스키마에 있다. 숫자는 문자열과 숫자 형식 모두 사용할 수 있다. 임의 HTML, JavaScript, CSS 선택자, URL과 추가 CSS 선언은 받지 않는다.

기본 Typst 요소는 별도 함수 등록 없이 처리한다.

- `text`: `weight`, `size`, `tracking`, `fill`, `style`의 리터럴 값을 웹 스타일로 옮긴다.
- `align`: `left`, `center`, `right`, `justify`를 정렬로 옮긴다.
- `h`, `v`: 고정 길이와 `2 * gap` 형태의 곱셈을 공백으로 옮긴다. `variables`에는 해당 계산에 사용할 값을 명시한다. `1fr` 같은 지면 채우기 간격과 페이지 나눔은 웹 페이지에 강제하지 않는다.
- 중첩된 표·강조·밑줄·참조·프로젝트 번호 설정도 기존 변환기를 사용한다.

이 기능은 Typst 코드를 실행하지 않는다. 반복문, 조건문, 프로젝트 함수 내부 계산이나 외부 모듈을 자동 해석하지 않으며, 웹 정의에 없는 스타일도 자동 추론하지 않는다. 웹용 정의는 PDF 입력을 바꾸지 않는다. PDF용 함수는 기존 Typst 템플릿에서 관리하고, 번호·참조 표시는 기존 공통 번호 설정을 계속 사용한다.
