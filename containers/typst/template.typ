// qollab's Pandoc template for Typst. The document style is in two partials a
// project can replace (format: typst: template-partials): typst-template.typ
// defines it, typst-show.typ applies it with the document's settings.
// render.py fills in the defaults of every variable used here.

#let horizontalrule = line(start: (25%,0%), end: (75%,0%))

#show terms.item: it => block(breakable: false)[
  #text(weight: "bold")[#it.term]
  #block(inset: (left: 1.5em, top: -0.4em))[#it.description]
]

#show raw.where(block: true): set block(fill: luma(230), width: 100%, inset: 8pt, radius: 2pt)

#set table(inset: 6pt, stroke: none)

$if(highlighting-definitions)$
$highlighting-definitions$

$endif$
// ::: {.callout-note} … (qmd.lua writes the title).
#let qollab-callout(color, title, body) = block(
  width: 100%, breakable: false, radius: 2pt, stroke: 0.5pt + color, clip: true,
  stack(
    block(width: 100%, fill: color.lighten(85%), inset: 8pt, text(weight: "bold", title)),
    block(width: 100%, inset: 8pt, body),
  ),
)

$typst-template.typ()$

$for(header-includes)$
$header-includes$

$endfor$
#set page(
  paper: "$papersize$",
$if(margin)$
  margin: ($for(margin/pairs)$$margin.key$: $margin.value$,$endfor$),
$else$
  margin: (x: 1.25in, y: 1.25in),
$endif$
  numbering: $if(page-numbering)$"$page-numbering$"$else$none$endif$,
  columns: $columns$,
)

// Caption names and positions (document settings).
#show figure.where(kind: image): set figure(supplement: [$crossref.fig-title$])
#show figure.where(kind: table): set figure(supplement: [$crossref.tbl-title$])
#show figure.where(kind: image): set figure.caption(position: $fig-cap-location$)
#show figure.where(kind: table): set figure.caption(position: $tbl-cap-location$)

$typst-show.typ()$

$for(include-before)$
$include-before$

$endfor$
$body$
$if(citations)$
$if(csl)$

#set bibliography(style: "$csl$")
$endif$
$if(bibliography)$

#bibliography(($for(bibliography)$"$bibliography$"$sep$,$endfor$))
$endif$
$endif$
$for(include-after)$

$include-after$
$endfor$
