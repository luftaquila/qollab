// Fonts in the renderer image that Typst can use (checked with `typst fonts`).
// The render policy accepts only these names so a typo fails visibly.
export const fonts = {
  korean: [
    "Noto Serif CJK KR",
    "Noto Sans CJK KR",
    "Pretendard",
    "UnBatang",
    "UnDotum",
    "UnGraphic",
    "UnPilgi",
    "UnGungseo",
    "Baekmuk Batang",
    "Baekmuk Dotum",
    "Baekmuk Gulim",
  ],
  latin: [
    "Latin Modern Roman",
    "Latin Modern Sans",
    "DejaVu Serif",
    "DejaVu Sans",
  ],
  mono: [
    "DejaVu Sans Mono",
    "Latin Modern Mono",
    "Noto Sans Mono CJK KR",
  ],
  math: ["Latin Modern Math"],
} as const;
export const installedFonts = new Set<string>(Object.values(fonts).flat());
export const fontKeys = [
  "mainfont",
  "sansfont",
  "monofont",
  "mathfont",
  "CJKmainfont",
  "CJKsansfont",
  "CJKmonofont",
];
/** The qollab style's defaults (containers/typst/typst-show.typ). */
export const defaultFonts = {
  mainfont: "Noto Serif CJK KR",
  sansfont: "Noto Sans CJK KR",
  monofont: "DejaVu Sans Mono",
};
// LaTeX document classes of older documents; the Typst renderer ignores them.
export const documentClasses = ["scrartcl", "article", "scrreprt", "report", "scrbook", "book"];
/** xcolor's standard colors, used to show `\textcolor` names on screen. */
export const xcolorHex: Record<string, string> = {
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  yellow: "#FFFF00",
  black: "#000000",
  white: "#FFFFFF",
  gray: "#808080",
  darkgray: "#404040",
  lightgray: "#BFBFBF",
  brown: "#BF8040",
  lime: "#BFFF00",
  olive: "#808000",
  orange: "#FF8000",
  pink: "#FFBFBF",
  purple: "#BF0040",
  teal: "#008080",
  violet: "#800080",
};
export const cssColor = (color: string) =>
  /^#[0-9A-Fa-f]{6}$/.test(color) ? color : xcolorHex[color.toLowerCase()] || "inherit";
/** Text colors offered in the editor; all print well on white paper. */
export const textColors: { value: string; label: [string, string] }[] = [
  { value: "red", label: ["빨강", "Red"] },
  { value: "orange", label: ["주황", "Orange"] },
  { value: "brown", label: ["갈색", "Brown"] },
  { value: "olive", label: ["올리브", "Olive"] },
  { value: "#2E7D32", label: ["초록", "Green"] },
  { value: "teal", label: ["청록", "Teal"] },
  { value: "blue", label: ["파랑", "Blue"] },
  { value: "violet", label: ["보라", "Violet"] },
  { value: "magenta", label: ["자홍", "Magenta"] },
  { value: "gray", label: ["회색", "Gray"] },
];
