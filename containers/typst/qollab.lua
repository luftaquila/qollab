-- Pandoc filter for Typst output: qollab documents keep the LaTeX inline
-- syntax the editor writes (\textcolor, \ul, \ref, \label, \newpage, \char
-- escapes…). Pandoc's Typst writer would drop it, so it is translated here.
-- Anything without a Typst equivalent is left out and reported on stderr.

local xcolor = {
  red = 'FF0000', green = '00FF00', blue = '0000FF', cyan = '00FFFF',
  magenta = 'FF00FF', yellow = 'FFFF00', black = '000000', white = 'FFFFFF',
  gray = '808080', darkgray = '404040', lightgray = 'BFBFBF', brown = 'BF8040',
  lime = 'BFFF00', olive = '808000', orange = 'FF8000', pink = 'FFBFBF',
  purple = 'BF0040', teal = '008080', violet = '800080',
}
local symbols = {
  textquoteright = '\u{2019}', textquoteleft = '\u{2018}',
  textquotedblright = '\u{201D}', textquotedblleft = '\u{201C}',
  textendash = '\u{2013}', textemdash = '\u{2014}', textellipsis = '\u{2026}',
  ldots = '\u{2026}', textbullet = '\u{2022}', textperiodcentered = '\u{00B7}',
  textdegree = '\u{00B0}', textasciitilde = '~', textbackslash = '\\',
  copyright = '\u{00A9}', textregistered = '\u{00AE}', texttrademark = '\u{2122}',
  S = '\u{00A7}', P = '\u{00B6}',
}
-- \ref prints the number only, like LaTeX; \cref and \autoref add the name.
local refs = { ref = 'none', eqref = 'none', nameref = 'none', cref = 'auto', Cref = 'auto', autoref = 'auto' }
local breaks = { newpage = true, clearpage = true, cleardoublepage = true, pagebreak = true }

local reported = {}
local function report(what)
  if not reported[what] then
    reported[what] = true
    io.stderr:write('WARNING (qollab): ' .. what .. ' is not supported by Typst and was left out\n')
  end
end

-- Typst markup escapes for plain text.
local function text(s)
  return (s:gsub('[\\#$*_`<>@%[%]~]', '\\%0'):gsub('^([-+=/])', '\\%1'))
end

-- Plain text of a LaTeX argument (escapes decoded, commands dropped).
local function plain(s)
  s = s:gsub('\\char(%d+){}', function(code) return utf8.char(tonumber(code)) end)
  s = s:gsub('\\textbackslash{}', '\\'):gsub('\\([%%&#$_{}])', '%1'):gsub('\\[a-zA-Z]+', '')
  return (s:gsub('[{}]', ''))
end

-- A LaTeX label becomes a labelled metadata element (labels on plain text
-- cannot be referenced in Typst). Inside a numbered list it carries the item's
-- number, which \ref prints, as in LaTeX.
local function ref_label(id, number)
  local value = number and ('(qollab-ref: "' .. number .. '")') or 'none'
  return '#metadata(' .. value .. ')<' .. id .. '>'
end

-- Reads a {…} group starting at position i (which holds '{'); returns its
-- contents and the position after the closing brace.
local function group(s, i)
  local depth, j = 0, i
  while j <= #s do
    local c = s:sub(j, j)
    if c == '\\' then j = j + 1
    elseif c == '{' then depth = depth + 1
    elseif c == '}' then
      depth = depth - 1
      if depth == 0 then return s:sub(i + 1, j - 1), j + 1 end
    end
    j = j + 1
  end
  return nil, i
end

-- LaTeX inline subset → Typst markup.
local function convert(s)
  local out, i = {}, 1
  while i <= #s do
    local c = s:sub(i, i)
    if c == '\\' then
      local name = s:match('^\\([a-zA-Z]+)', i)
      if not name then
        local ch = s:sub(i + 1, i + 1)
        if ch == '\\' then table.insert(out, '#linebreak()'); i = i + 2
        elseif ch:match('[%%&#$_{} ]') then table.insert(out, text(ch)); i = i + 2
        else table.insert(out, text(ch)); i = i + 2 end
      else
        i = i + 1 + #name
        local code = name == 'char' and s:match('^(%d+)', i)
        if code then
          i = i + #code
          if s:sub(i, i + 1) == '{}' then i = i + 2 end
          table.insert(out, text(utf8.char(tonumber(code))))
        elseif symbols[name] then
          if s:sub(i, i + 1) == '{}' then i = i + 2 end
          table.insert(out, text(symbols[name]))
        elseif breaks[name] then
          if s:sub(i, i + 1) == '{}' then i = i + 2 end
          table.insert(out, '#pagebreak(weak: true)')
        elseif name == 'textcolor' then
          local fill
          local hex, after = s:match('^%[HTML%]{(%x%x%x%x%x%x)}()', i)
          if hex then fill = hex; i = after
          else
            local cname; cname, i = group(s, i)
            fill = cname and xcolor[cname]
            if not fill then report('colour ' .. tostring(cname)); fill = '000000' end
          end
          local body; body, i = group(s, i)
          table.insert(out, '#text(fill: rgb("#' .. fill .. '"))[' .. convert(body or '') .. ']')
        elseif name == 'textbf' or name == 'textit' or name == 'emph' or name == 'ul'
            or name == 'underline' or name == 'texttt' then
          local body; body, i = group(s, i)
          local wrap = ({ textbf = 'strong', textit = 'emph', emph = 'emph',
                          ul = 'underline', underline = 'underline', texttt = 'raw' })[name]
          if wrap == 'raw' then
            local code = plain(body or ''):gsub('[\\"]', '\\%0')
            table.insert(out, '#raw("' .. code .. '")')
          else
            table.insert(out, '#' .. wrap .. '[' .. convert(body or '') .. ']')
          end
        elseif name == 'label' then
          local id; id, i = group(s, i)
          table.insert(out, ref_label(id or '', nil))
        elseif refs[name] then
          local id; id, i = group(s, i)
          table.insert(out, refs[name] == 'none' and ('#ref(<' .. (id or '') .. '>, supplement: none)')
            or ('#ref(<' .. (id or '') .. '>)'))
        elseif name == 'pageref' then
          local id; id, i = group(s, i)
          table.insert(out, '#context counter(page).at(<' .. (id or '') .. '>).first()')
        else
          report('\\' .. name)
          if s:sub(i, i + 1) == '{}' then i = i + 2 end
        end
      end
    else
      local j = s:find('\\', i, true) or (#s + 1)
      table.insert(out, text(s:sub(i, j - 1)))
      i = j
    end
  end
  return table.concat(out)
end

local function is_tex(el) return el.format == 'tex' or el.format == 'latex' end

local function bare_label(el)
  return el.t == 'RawInline' and is_tex(el) and el.text:match('^\\label{([^}]+)}%s*$')
end

function Inlines(inlines)
  for i, el in ipairs(inlines) do
    -- Labels on their own wait for OrderedList (item numbers) and Pandoc.
    if el.t == 'RawInline' and is_tex(el) and not bare_label(el) then
      local out = convert(el.text)
      -- An embedded call followed by . ( [ would continue the expression.
      local nxt = inlines[i + 1]
      -- (an escaped bracket, \], is text and needs nothing)
      if out:match('[^\\][%])]$') and nxt and nxt.t == 'Str' and nxt.text:match('^[%.%(%[]') then
        out = out .. ';'
      end
      inlines[i] = pandoc.RawInline('typst', out)
    end
  end
  return inlines
end

local function item_number(attrs, n)
  local style = attrs.style
  if style == 'LowerAlpha' or style == 'UpperAlpha' then
    local c = string.char(96 + ((n - 1) % 26) + 1)
    return style == 'UpperAlpha' and c:upper() or c
  elseif style == 'LowerRoman' or style == 'UpperRoman' then
    local values, digits, out = { 10, 9, 5, 4, 1 }, { 'x', 'ix', 'v', 'iv', 'i' }, ''
    for k, v in ipairs(values) do while n >= v do out = out .. digits[k]; n = n - v end end
    return style == 'UpperRoman' and out:upper() or out
  end
  return tostring(n)
end

-- Nested lists are handled first, so the walk only meets this list's labels.
function OrderedList(el)
  for k, item in ipairs(el.content) do
    local number = item_number(el.listAttributes, el.listAttributes.start + k - 1)
    el.content[k] = pandoc.Div(item):walk({
      RawInline = function(raw)
        local id = bare_label(raw)
        if id then return pandoc.RawInline('typst', ref_label(id, number)) end
      end,
    }).content
  end
  return el
end

function Pandoc(doc)
  return doc:walk({
    RawInline = function(raw)
      local id = bare_label(raw)
      if id then return pandoc.RawInline('typst', ref_label(id, nil)) end
    end,
  })
end

function RawBlock(el)
  if not is_tex(el) then return nil end
  local body = el.text:gsub('^%s+', ''):gsub('%s+$', '')
  local name = body:match('^\\([a-zA-Z]+)%s*{?}?$')
  if name and breaks[name] then return pandoc.RawBlock('typst', '#pagebreak(weak: true)') end
  report('raw LaTeX block')
  return {}
end

-- Typst decides the image format from the extension; some uploads are PNG data
-- named .jpg, which would stop the build.
function Image(img)
  local src = img.src
  if not src:match('%.[jJ][pP][eE]?[gG]$') then return nil end
  local f = io.open(src, 'rb')
  if not f then return nil end
  local data = f:read('a'); f:close()
  if data:sub(1, 4) ~= '\137PNG' then return nil end
  local fixed = src .. '.png'
  local out = io.open(fixed, 'wb')
  if not out then return nil end
  out:write(data); out:close()
  img.src = fixed
  return img
end
