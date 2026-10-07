export function chooseLanguage(languages: readonly string[]) {
  for (const lang of languages) {
    const base = lang.toLowerCase().split("-")[0];
    if (base === "ko" || base === "en") return base;
  }
  return "en";
}
export const lang = chooseLanguage(
  navigator.languages?.length ? navigator.languages : [navigator.language],
);
const words = {
  imageProperties: ["그림 속성", "Figure properties"],
  replaceImage: ["이미지 교체", "Replace image"],
  selectImage: ["그림을 먼저 선택하세요.", "Select an image first."],
  tagline: [
    "함께 쓰고, 문서로 완성하세요.",
    "Write together. Make it a document.",
  ],
  intro: [
    "Quarto 문서 공동 편집과 PDF 작업 공간",
    "A shared workspace for Quarto documents and PDFs",
  ],
  google: ["Google로 로그인", "Continue with Google"],
  unconfigured: [
    "Google 로그인 설정이 필요합니다. 배포 관리자가 OAuth 설정을 완료하면 로그인할 수 있습니다.",
    "Google sign-in is not configured. Your administrator needs to configure OAuth before you can sign in.",
  ],
  projects: ["프로젝트", "Projects"],
  newProject: ["새 프로젝트", "New project"],
  import: ["ZIP 가져오기", "Import ZIP"],
  logout: ["로그아웃", "Sign out"],
  empty: ["첫 번째 문서를 시작하세요.", "Start your first document."],
  open: ["열기", "Open"],
  name: ["이름", "Name"],
  create: ["만들기", "Create"],
  cancel: ["취소", "Cancel"],
  files: ["파일", "Files"],
  history: ["이력", "History"],
  images: ["이미지", "Images"],
  members: ["멤버", "Members"],
  newFile: ["새 파일", "New file"],
  rename: ["이름 변경", "Rename"],
  delete: ["삭제", "Delete"],
  export: ["ZIP 내보내기", "Export ZIP"],
  build: ["PDF 생성", "Build PDF"],
  pdf: ["PDF 미리보기", "PDF preview"],
  source: ["원문", "Source"],
  raw: ["원문 복구 편집", "Source recovery"],
  rawHelp: [
    "복구 편집은 한 사용자에게 15분 동안 잠깁니다. 저장하면 잠금 시간이 연장됩니다.",
    "Recovery editing is locked to one user for 15 minutes. Saving renews the lease.",
  ],
  visual: ["Visual 편집으로 전환", "Switch to visual editing"],
  save: ["저장", "Save"],
  saved: ["서버 저장 완료", "Saved to server"],
  saving: ["전송 대기", "Saving"],
  offline: ["연결 끊김 · 수정 보관 중", "Offline · changes retained"],
  stale: [
    "문서 세대 또는 권한이 변경되었습니다. 미전송 내용을 내려받은 후 다시 여세요.",
    "The document generation or permission changed. Download unsent work before reopening.",
  ],
  downloadPending: ["미전송 원문 다운로드", "Download unsent source"],
  reopen: ["다시 열기", "Reopen"],
  checkpoint: ["체크포인트 만들기", "Create checkpoint"],
  restore: ["프로젝트 전체 복원", "Restore entire project"],
  restoreConfirm: [
    "프로젝트 전체를 이 버전으로 복원할까요? 현재 내용은 체크포인트로 남습니다.",
    "Restore the entire project to this version? Current work will be checkpointed.",
  ],
  deleteConfirm: ["이 파일을 삭제할까요?", "Delete this file?"],
  upload: ["이미지 업로드", "Upload image"],
  insert: ["삽입", "Insert"],
  caption: ["캡션", "Caption"],
  alt: ["대체 텍스트", "Alt text"],
  width: ["너비 (예: 80%)", "Width (e.g. 80%)"],
  align: ["정렬", "Alignment"],
  identifier: ["그림 ID (fig-)", "Figure ID (fig-)"],
  invite: ["초대 링크 만들기", "Create invitation link"],
  email: ["이메일", "Email"],
  owner: ["소유자", "Owner"],
  editor: ["편집자", "Editor"],
  viewer: ["열람자", "Viewer"],
  transfer: ["소유권 이전", "Transfer ownership"],
  remove: ["멤버 삭제", "Remove member"],
  loading: ["불러오는 중…", "Loading…"],
  noPdf: [
    "문서를 편집하면 PDF가 자동으로 생성됩니다.",
    "Your PDF will build automatically as you write.",
  ],
  firstPdf: [
    "완료되면 여기에 자동으로 표시됩니다. 계속 편집할 수 있습니다.",
    "The preview will appear here when ready. You can keep editing.",
  ],
  failed: [
    "PDF 생성 실패 · 마지막 정상 결과를 유지합니다.",
    "Build failed · keeping the last successful PDF.",
  ],
  queued: ["PDF 생성 대기", "PDF queued"],
  running: ["PDF 생성 중", "Building PDF"],
  succeeded: ["PDF 생성 완료", "PDF ready"],
  cancelled: ["PDF 생성 취소", "PDF cancelled"],
  revision: ["버전", "Revision"],
  placeholder: ["문서를 작성하세요…", "Start writing…"],
  text: ["본문", "Text"],
  heading: ["제목", "Heading"],
  search: ["검색", "Search"],
  copy: ["복사", "Copy"],
  edit: ["편집", "Edit"],
  hide: ["숨기기", "Hide"],
  noResult: ["결과 없음", "No results"],
  link: ["링크 주소", "Link URL"],
  code: ["코드", "Code"],
  table: ["표", "Table"],
  math: ["수식", "Math"],
  quote: ["인용문", "Quote"],
  list: ["목록", "List"],
  bullet: ["글머리 목록", "Bullet list"],
  ordered: ["번호 목록", "Numbered list"],
  task: ["체크 목록", "Task list"],
  advanced: ["삽입", "Insert"],
  divider: ["구분선", "Divider"],
  undo: ["실행 취소", "Undo"],
  redo: ["다시 실행", "Redo"],
  close: ["닫기", "Close"],
  sourceDiff: ["현재 원문과 비교", "Compare with current source"],
  current: ["현재", "Current"],
  previous: ["선택한 버전", "Selected version"],
  download: ["다운로드", "Download"],
  target: ["PDF 대상으로 설정", "Set as PDF target"],
  readOnly: ["읽기 전용", "Read only"],
  resizeImage: ["이미지 너비 조절", "Resize image width"],
  refresh: ["새로고침", "Refresh"],
  outline: ["문서 개요", "Outline"],
  refs: ["참조", "References"],
  pending: ["현재 수정 미반영", "New changes pending"],
  welcomeTitle: [
    "당신의 문서, 하나의 작업 공간.",
    "Your document. One shared space.",
  ],
  back: ["프로젝트 목록", "All projects"],
} as const;
export type Word = keyof typeof words;
export const t = (key: Word) => words[key][lang === "ko" ? 0 : 1];
const errors: Record<string, [string, string]> = {
  IMAGE_SELECT: ["그림을 먼저 선택하세요.", "Select an image first."],
  FORBIDDEN: ["이 작업의 권한이 없습니다.", "You do not have permission."],
  REVISION_CONFLICT: [
    "다른 변경이 저장되었습니다. 새로고침 후 다시 시도하세요.",
    "Another change was saved. Refresh and retry.",
  ],
  REFERENCED_FILE: [
    "현재 문서가 참조하는 파일입니다. 참조를 먼저 수정하세요.",
    "This file is referenced. Update its references first.",
  ],
  OAUTH_UNCONFIGURED: [
    "Google 로그인 설정이 필요합니다.",
    "Google sign-in is not configured.",
  ],
  UNSAFE_BOUNDARY: [
    "문법 경계를 확인할 수 없습니다. 원문을 복구하세요.",
    "The syntax boundary is uncertain. Repair the source first.",
  ],
  RAW_LOCKED: [
    "다른 사용자가 복구 편집 중이거나 잠금이 만료되었습니다.",
    "Recovery is locked by another user or your lease expired.",
  ],
  STALE_DOCUMENT: [
    "문서가 변경되었습니다. 미전송 내용을 내려받고 다시 여세요.",
    "The document changed. Download unsent work and reopen.",
  ],
  LAST_OWNER: [
    "마지막 소유자는 제거할 수 없습니다.",
    "The last owner cannot be removed.",
  ],
  INVALID_IMAGE: [
    "PNG 또는 JPEG 이미지가 아니거나 이미지 제한을 초과했습니다.",
    "Invalid PNG/JPEG or image limits exceeded.",
  ],
  RENDER_POLICY: [
    "허용하지 않는 실행 설정이 있습니다.",
    "The document contains disallowed render settings.",
  ],
  PDF_UNAVAILABLE: [
    "아직 생성된 PDF가 없습니다.",
    "No PDF has been generated yet.",
  ],
  MAINTENANCE: [
    "백업 작업 중입니다. 잠시 후 다시 시도하세요.",
    "Backup in progress. Please retry shortly.",
  ],
};
export const errorText = (code: string) =>
  errors[code]?.[lang === "ko" ? 0 : 1] ||
  (lang === "ko"
    ? `요청을 완료하지 못했습니다 (${code}).`
    : `The request failed (${code}).`);
