-- Quarto Markdown (.qmd) features Pandoc leaves to Quarto, written for Typst:
-- cross references (@fig-…, @tbl-…, @eq-…, @sec-…), numbered equations,
-- callouts, two columns, {{< pagebreak >}} and Quarto's heading levels.
-- Other Quarto blocks keep their content and are reported. Runs after
-- qollab.lua; render.py passes the names (crossref, qollab-callout) as metadata.

local reported = {}
local function report(message)
  if not reported[message] then
    reported[message] = true
    io.stderr:write('WARNING (qollab): ' .. message .. '\n')
  end
end

-- Typst markup escapes for plain text.
local function text(s)
  return (s:gsub('[\\#$*_`<>@%[%]~]', '\\%0'))
end

local function typst(inlines)
  return pandoc.write(pandoc.Pandoc({ pandoc.Plain(inlines) }), 'typst', { wrap_text = 'wrap-none' }):gsub('%s+$', '')
end

local kinds = { fig = true, tbl = true, eq = true, sec = true }
local colors = { note = '#0758E5', tip = '#00A047', warning = '#EB9113', important = '#CC1914', caution = '#FC5300' }

function Pandoc(doc)
  local crossref, callouts = doc.meta.crossref or {}, doc.meta['qollab-callout'] or {}
  -- What render.py found in the source; walks over every paragraph or word
  -- are skipped when they could only find nothing.
  local scan = doc.meta['qollab-scan'] or {}
  local function has(key) return scan[key] ~= false end
  doc.meta['qollab-callout'] = nil
  doc.meta['qollab-scan'] = nil
  local function name(map, key) return pandoc.utils.stringify(map[key] or '') end

  -- As in Quarto, a document without level-one headings has its headings
  -- moved up a level (## is a top-level section).
  local level_one = false
  doc:walk({ Header = function(h) level_one = level_one or h.level == 1 end })

  -- Every label a reference may point to (the LaTeX filter's \label included).
  local labels = {}
  local function label(id) if id and id ~= '' then labels[id] = true end end
  local function raw_labels(raw)
    if raw.format == 'typst' then for id in raw.text:gmatch('<([%w_:%.%-]+)>') do label(id) end end
  end
  if has('references') then
    doc:walk({
      Header = function(el) label(el.identifier) end,
      Figure = function(el) label(el.identifier) end,
      Table = function(el) label(el.identifier) end,
      Span = function(el) label(el.identifier) end,
      Div = function(el) label(el.identifier) end,
      Str = has('equations') and function(el) label(el.text:match('^{#(eq%-[^}%s]+)}$')) end or nil,
      RawInline = raw_labels,
      RawBlock = raw_labels,
    })
  end

  -- @fig-x → #ref(<fig-x>, supplement: [그림]); a section without a number
  -- (no number-sections) gets a link with its title instead.
  local function reference(c)
    local kind = c.id:match('^(%a+)%-')
    local out = pandoc.Inlines({})
    if #c.prefix > 0 then out:extend(c.prefix); out:insert(pandoc.Space()) end
    if not labels[c.id] then
      report('reference to a missing label ' .. c.id)
      out:insert(pandoc.Strong({ pandoc.Str('?@' .. c.id) }))
    else
      local supplement = c.mode == 'SuppressAuthor' and 'none' or ('[' .. text(name(crossref, kind .. '-prefix')) .. ']')
      local ref = '#ref(<' .. c.id .. '>, supplement: ' .. supplement .. ')'
      if kind == 'sec' then
        ref = '#context { let h = query(<' .. c.id .. '>).first(); if h.numbering == none { link(<' .. c.id
          .. '>, h.body) } else { ref(<' .. c.id .. '>, supplement: ' .. supplement .. ') } }'
      end
      out:insert(pandoc.RawInline('typst', ref))
    end
    if #c.suffix > 0 then out:extend(c.suffix) end
    return out
  end

  -- $$ … $$ {#eq-x}: a numbered equation.
  local function equations(block)
    local content, out, changed, i = block.content, pandoc.Inlines({}), false, 1
    while i <= #content do
      local el, space, attr = content[i], content[i + 1], content[i + 2]
      local id = attr and attr.t == 'Str' and attr.text:match('^{#(eq%-[^}%s]+)}$')
      if el.t == 'Math' and el.mathtype == 'DisplayMath' and space and space.t == 'Space' and id then
        out:extend({
          pandoc.RawInline('typst', '#math.equation(block: true, numbering: "(1)", [ '),
          el,
          pandoc.RawInline('typst', ' ])<' .. id .. '>'),
        })
        i, changed = i + 3, true
      else
        out:insert(el)
        i = i + 1
      end
    end
    if changed then
      block.content = out
      return block
    end
  end

  -- {{< pagebreak >}} on its own line; other shortcodes are left out.
  local function shortcode(block)
    local code = pandoc.utils.stringify(block):match('^{{<%s*([%w_%-]+).*>}}$')
    if not code then return nil end
    if code == 'pagebreak' then return pandoc.RawBlock('typst', '#pagebreak(weak: true)') end
    report('Quarto shortcode ' .. code .. ' is not supported and was left out')
    return {}
  end

  local function callout(div, kind)
    local body, title = div.content, div.attributes.title
    local heading = body[1]
    if not title and heading and heading.t == 'Header' then
      title = typst(heading.content)
      body = body:clone()
      body:remove(1)
    elseif title then
      title = text(title)
    else
      title = text(name(callouts, kind))
    end
    local blocks = pandoc.Blocks({ pandoc.RawBlock('typst', '#qollab-callout(rgb("' .. colors[kind] .. '"), [' .. title .. '])[') })
    blocks:extend(body)
    blocks:insert(pandoc.RawBlock('typst', ']'))
    return blocks
  end

  local function columns(div)
    local widths, blocks = {}, pandoc.Blocks({})
    for _, col in ipairs(div.content) do
      if col.t ~= 'Div' or not col.classes:includes('column') then return nil end
      local width = col.attributes.width
      table.insert(widths, width and width:match('^%d+%.?%d*%%$') and width or '1fr')
      blocks:insert(pandoc.RawBlock('typst', '['))
      blocks:extend(col.content)
      blocks:insert(pandoc.RawBlock('typst', '],'))
    end
    blocks:insert(1, pandoc.RawBlock('typst', '#grid(columns: (' .. table.concat(widths, ', ') .. ',), gutter: 1em,'))
    blocks:insert(pandoc.RawBlock('typst', ')'))
    return blocks
  end

  local function paragraph(p)
    return (has('shortcodes') and shortcode(p)) or (has('equations') and equations(p)) or nil
  end
  local paragraphs = (has('shortcodes') or has('equations')) and paragraph or nil
  return doc:walk({
    Header = function(h)
      if not level_one then
        h.level = h.level - 1
        return h
      end
    end,
    Cite = function(cite)
      local out, crossref = pandoc.Inlines({}), false
      for i, c in ipairs(cite.citations) do
        if i > 1 then out:extend({ pandoc.Str(','), pandoc.Space() }) end
        if kinds[c.id:match('^(%a+)%-') or ''] then
          crossref = true
          out:extend(reference(c))
        else
          out:insert(pandoc.Cite({ pandoc.Str('@' .. c.id) }, { c }))
        end
      end
      if crossref then return out end
    end,
    -- A code cell (render.py marks it) without its #| options.
    CodeBlock = function(code)
      if code.classes:includes('cell-code') then
        code.classes = code.classes:filter(function(c) return c ~= 'cell-code' end)
        local body = code.text
        while body:match('^#|') do body = body:gsub('^#|[^\n]*\n?', '', 1) end
        code.text = body
        return code
      end
    end,
    Para = paragraphs,
    Plain = paragraphs,
    -- A table without a caption is a plain table, as Quarto writes it (Pandoc
    -- would make it a numbered figure).
    Table = function(tbl)
      if #tbl.caption.long == 0 then
        local written = pandoc.write(pandoc.Pandoc({ tbl }), 'typst', { wrap_text = 'wrap-none' })
        local plain = written:match('align%(center%)%[(#table%(.*%))%]')
        if plain then return pandoc.RawBlock('typst', plain) end
        return { pandoc.RawBlock('typst', '#[#set figure(numbering: none)'), tbl, pandoc.RawBlock('typst', ']') }
      end
    end,
    Div = function(div)
      local kind = div.classes[1] and div.classes[1]:match('^callout%-(%a+)$')
      if kind and colors[kind] then return callout(div, kind) end
      if div.classes:includes('columns') then
        local grid = columns(div)
        if grid then return grid end
      end
      -- Columns are laid out by their .columns block (walked after them).
      if div.classes:includes('column') then return nil end
      if #div.classes > 0 then
        report('Quarto block .' .. div.classes[1] .. ' is not supported; its content is shown as is')
        if div.identifier == '' then return div.content end
      end
    end,
  })
end
