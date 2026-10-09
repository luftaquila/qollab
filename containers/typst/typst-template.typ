// qollab default document style (a partial of template.typ).
// A plain report look: serif body with a Hangul fallback, bold sans headings,
// numbered sections when requested, coloured links. Documents and projects can
// replace it with their own partials (format: typst: template-partials).

#let qollab-article(
  title: none,
  subtitle: none,
  authors: none,
  date: none,
  abstract: none,
  abstract-title: none,
  lang: "en",
  region: none,
  font: ("Noto Serif CJK KR",),
  heading-font: ("Noto Sans CJK KR",),
  code-font: ("DejaVu Sans Mono",),
  math-font: ("Latin Modern Math",),
  fontsize: 11pt,
  linestretch: 1,
  indent: false,
  sectionnumbering: none,
  linkcolor: rgb("#0000FF"),
  toc: false,
  toc_title: none,
  toc_depth: 3,
  doc,
) = {
  set document(title: title) if title != none
  set text(lang: lang, size: fontsize, font: font)
  set text(region: region) if region != none
  set par(justify: true, leading: 0.65em * linestretch, spacing: 1.2em * linestretch)
  set par(first-line-indent: (amount: 1.5em, all: false)) if indent
  show raw: set text(font: code-font)
  show math.equation: set text(font: math-font)

  set heading(numbering: sectionnumbering)
  show heading: set text(font: heading-font, weight: "bold")
  show heading.where(level: 1): set text(size: 1.3em)
  show heading.where(level: 2): set text(size: 1.1em)
  show heading: set block(above: 1.6em, below: 0.9em)

  show link: set text(fill: linkcolor) if linkcolor != none
  show ref: set text(fill: linkcolor) if linkcolor != none
  // \ref to a LaTeX-style \label: the list item's number, or else the number
  // of the section the label is in (the qollab filter makes labels metadata).
  show ref: it => {
    let el = it.element
    if el == none or el.func() != metadata { return it }
    let number = if type(el.value) == dictionary { el.value.at("qollab-ref", default: none) }
    link(el.location(), if number != none { number } else {
      context {
        let before = query(heading.before(el.location()))
        if before.len() > 0 and before.last().numbering != none {
          numbering(before.last().numbering, ..counter(heading).at(el.location()))
        } else { "??" }
      }
    })
  }

  set table(inset: 6pt, stroke: none)
  show table: it => block(stroke: (top: 0.8pt, bottom: 0.8pt), it)

  if title != none or authors != none or date != none {
    align(center, {
      v(1em)
      if title != none { text(font: heading-font, weight: "bold", size: 1.8em, title) }
      if subtitle != none { parbreak(); text(font: heading-font, size: 1.25em, subtitle) }
      if authors != none and authors != () {
        parbreak()
        authors.map(a => a.name).join(", ")
      }
      if date != none { parbreak(); date }
      v(1em)
    })
  }
  if abstract != none {
    block(inset: (x: 2em), [#text(weight: "bold")[#abstract-title] #h(0.5em) #abstract])
  }
  if toc {
    outline(title: toc_title, depth: toc_depth)
  }
  doc
}
