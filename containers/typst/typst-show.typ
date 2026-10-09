// qollab: maps document settings onto qollab-article (Pandoc template syntax).
#let qollab-xcolor = (
  red: "#FF0000", green: "#00FF00", blue: "#0000FF", cyan: "#00FFFF",
  magenta: "#FF00FF", yellow: "#FFFF00", black: "#000000", white: "#FFFFFF",
  gray: "#808080", darkgray: "#404040", lightgray: "#BFBFBF", brown: "#BF8040",
  lime: "#BFFF00", olive: "#808000", orange: "#FF8000", pink: "#FFBFBF",
  purple: "#BF0040", teal: "#008080", violet: "#800080",
)
#let qollab-color(c) = if c == "none" { none } else if c.starts-with("#") { rgb(c) } else {
  rgb(qollab-xcolor.at(c, default: "#0000FF"))
}

#show: doc => qollab-article(
$if(title)$
  title: [$title$],
$endif$
$if(subtitle)$
  subtitle: [$subtitle$],
$endif$
$if(author)$
  authors: (
$for(author)$
    (name: [$author$],),
$endfor$
  ),
$endif$
$if(date)$
  date: [$date$],
$endif$
$if(abstract)$
  abstract: [$abstract$],
  abstract-title: [$abstract-title$],
$endif$
$if(lang)$
  lang: "$lang$",
$endif$
$if(region)$
  region: "$region$",
$endif$
  font: ($if(mainfont)$"$mainfont$", $endif$$if(CJKmainfont)$"$CJKmainfont$", $endif$"Noto Serif CJK KR"),
  heading-font: ($if(sansfont)$"$sansfont$", $endif$$if(CJKmainfont)$"$CJKmainfont$", $endif$"Noto Sans CJK KR"),
  code-font: ($if(monofont)$"$monofont$", $endif$"DejaVu Sans Mono", "Noto Sans Mono CJK KR"),
  math-font: ($if(mathfont)$"$mathfont$", $endif$"Latin Modern Math", "Noto Serif CJK KR"),
$if(fontsize)$
  fontsize: $fontsize$,
$endif$
$if(linestretch)$
  linestretch: $linestretch$,
$endif$
$if(indent)$
  indent: true,
$endif$
$if(section-numbering)$
  sectionnumbering: "$section-numbering$",
$endif$
$if(linkcolor)$
  linkcolor: qollab-color("$linkcolor$"),
$endif$
$if(toc)$
  toc: true,
$endif$
$if(toc-title)$
  toc_title: [$toc-title$],
$endif$
$if(toc-depth)$
  toc_depth: $toc-depth$,
$endif$
  doc,
)
