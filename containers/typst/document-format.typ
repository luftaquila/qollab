// Public formatting interface for project templates. The application resolves
// heading counters and references from the same document model used by HTML.
#let data = json("/.qollab/document-numbering.json")
#let settings = data.at("settings", default: (:))
#let enabled(kind) = settings.at(kind, default: (:)).at("enabled", default: false)
#let level-at(levels, depth) = levels.at(calc.min(depth - 1, levels.len() - 1))
#let symbol(n, spec) = {
  if spec.style == "circled" and (n < 1 or n > 20) { return "(" + str(n) + ")" }
  if n < 1 or (spec.style == "lower-roman" and n >= 4000) { return str(n) }
  let alphabet = if spec.style == "custom" { spec.symbols }
    else if spec.style == "korean" { "가나다라마바사아자차카타파하".clusters() } else { () }
  if alphabet.len() > 0 {
    let out = ""
    let k = n
    while k > 0 {
      k -= 1
      out = alphabet.at(calc.rem(k, alphabet.len())) + out
      k = calc.floor(k / alphabet.len())
    }
    out
  } else {
    let pattern = (decimal: "1", circled: "①", lower-alpha: "a", upper-alpha: "A", lower-roman: "i").at(spec.style, default: "1")
    numbering(pattern, n)
  }
}
#let number-text(nums, levels) = {
  let spec = level-at(levels, nums.len())
  spec.format.replace(regex("\\{(n|[1-8])\\}"), m => {
    let key = m.text.slice(1, -1)
    let i = if key == "n" { nums.len() - 1 } else { int(key) - 1 }
    symbol(nums.at(i, default: 0), if key == "n" { spec } else { level-at(levels, i + 1) })
  })
}
// Keep rich heading/caption content intact while substituting literal formats.
#let compose(pattern, values) = {
  // Literal spaces must be space elements so they collapse with the leading
  // whitespace Pandoc puts inside multiline caption bodies.
  let literal(s) = s.split(" ").map(part => text(part)).join([ ])
  let result = ()
  let start = 0
  for m in pattern.matches(regex("\\{[a-zA-Z0-9]+\\}")) {
    result.push(literal(pattern.slice(start, m.start)))
    result.push(values.at(m.text.slice(1, -1), default: m.text))
    start = m.end
  }
  result.push(literal(pattern.slice(start)))
  result.join()
}
#let heading-info(el, selector: heading) = {
  // Outline and abstract titles belong to the template, not the source counters.
  let selected = selector.before(el.location())
  if query(<qollab-numbering-start>).len() > 0 {
    selected = selected.after(<qollab-numbering-start>)
  }
  let index = query(selected).len() - 1
  if index < 0 { none } else { data.headings.at(index, default: none) }
}
// Remove only the matched literal source prefix, preserving styled title parts.
#let without-prefix(body, prefix) = {
  let sequence = [#h(0pt)#h(0pt)].func()
  let walk(part, remaining) = {
    if remaining == 0 { return (part, 0) }
    if part.func() == sequence {
      let result = ()
      for child in part.children {
        let (tail, rest) = walk(child, remaining)
        result.push(tail)
        remaining = rest
      }
      return (result.join(), remaining)
    }
    if part.func() == text {
      let count = calc.min(remaining, part.text.len())
      return (text(part.text.slice(count)), remaining - count)
    }
    if part.func() == [ ].func() { return ([], remaining - 1) }
    (part, remaining)
  }
  walk(body, prefix.len()).first()
}
#let heading-title(el, selector: heading) = {
  let info = heading-info(el, selector: selector)
  if not enabled("headings") or info == none or info.label == "" { return el.body }
  let values = (label: info.label, title: without-prefix(el.body, info.prefix))
  for (i, label) in info.labels.enumerate() { values.insert("h" + str(i + 1), label) }
  compose(info.titlePattern, values)
}
#let list-label(nums) = if enabled("lists") {
  number-text(nums, settings.lists.levels)
} else { str(nums.last()) + "." }
#let bullet-label(depth) = {
  let symbols = settings.at("bullets", default: (:)).at("symbols", default: ("•",))
  symbols.at(calc.min(depth - 1, symbols.len() - 1))
}
#let caption-spec(kind) = if kind == image { settings.at("figures", default: (:)) } else { (:) }
#let trim-content(body) = {
  let sequence = [#h(0pt)#h(0pt)].func()
  if body.func() != sequence { return body }
  let parts = body.children
  let space = [ ].func()
  while parts.len() > 0 and parts.first().func() == space { parts = parts.slice(1) }
  while parts.len() > 0 and parts.last().func() == space { parts = parts.slice(0, -1) }
  parts.join()
}
#let figure-caption(it) = {
  let spec = caption-spec(it.kind)
  if not spec.at("enabled", default: false) or it.numbering == none { return it.body }
  context {
    let n = it.counter.get().first()
    let label = number-text((n,), (spec.label,)).replace(" ", "\u{a0}")
    compose(spec.caption, (label: label, caption: trim-content(it.body)))
  }
}
#let reference(it) = data.at("references", default: (:)).at(str(it.target), default: none)
#let counter-label(name, n) = {
  let specs = settings.at("counters", default: ()).filter(s => s.name == name)
  if specs.len() == 0 { return str(n) }
  number-text((n,), (specs.first(),))
}
#let parents = state("qollab-document-list-parents", ())
#let apply(body) = {
  let body = [#metadata(none)<qollab-numbering-start>#body]
  if settings.at("pdf", default: (:)).at("mode", default: "automatic") == "template" { return body }
  set heading(numbering: none, outlined: false, bookmarked: false) if enabled("headings")
  show heading: it => if not enabled("headings") or it.outlined { it } else {
    let title = context heading-title(it, selector: heading.where(outlined: false))
    heading(level: it.level, numbering: none, outlined: true, bookmarked: true, title)
  }
  show enum: it => if not enabled("lists") { it } else { context {
    let outer = parents.get()
    let n = if type(it.start) == int { it.start } else { 1 }
    let cells = ()
    for item in it.children {
      if type(item.number) == int { n = item.number }
      let nums = outer + (n,)
      cells.push(list-label(nums))
      cells.push([#parents.update(nums)#item.body#parents.update(outer)])
      n += 1
    }
    grid(columns: (auto, 1fr), column-gutter: 0.6em, row-gutter: 0.4em, ..cells)
  } }
  set list(marker: depth => bullet-label(depth + 1)) if enabled("bullets")
  show figure.caption: it => if caption-spec(it.kind).at("enabled", default: false) { figure-caption(it) } else { it }
  show ref: it => {
    let text = if enabled("headings") or enabled("lists") or enabled("figures") { reference(it) }
    if text == none { it } else { link(it.target, text) }
  }
  body
}
