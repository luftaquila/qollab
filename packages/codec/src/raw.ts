// A raw block (```{=latex} … ```) inside a list decodes as a raw node in the
// list item instead of turning the whole list into raw text. Its text is the
// fence exactly as written, without the list's indentation, so writing the
// list back indents the same lines again.
const RAW_FORMAT = /^\{=[A-Za-z][\w-]*\}$/;
export function rawFence(source: string, node: any): string | null {
  if (node.type !== "code" || !RAW_FORMAT.test(node.lang ?? "") || node.meta || !node.position)
    return null;
  const { start, end } = node.position;
  const indent = " ".repeat(start.column - 1);
  const [first, ...rest] = source.slice(start.offset, end.offset).split("\n");
  const open = /^(`{3,}|~{3,})/.exec(first);
  const close = /^(`{3,}|~{3,})[ \t]*$/.exec(rest[rest.length - 1]?.slice(indent.length) ?? "");
  if (!open || !close || close[1][0] !== open[1][0] || close[1].length < open[1].length)
    return null;
  const lines = [first];
  for (const line of rest) {
    // Blank lines are written without indentation, all others with it.
    if (line === "") lines.push(line);
    else if (line.startsWith(indent) && line.length > indent.length)
      lines.push(line.slice(indent.length));
    else return null;
  }
  return lines.join("\n");
}
/** Source spans of the raw blocks nested in a top-level Markdown node. */
export function nestedRawSpans(node: any, source: string, spans: [number, number][] = []) {
  for (const child of node.children || []) {
    if (rawFence(source, child) !== null)
      spans.push([child.position.start.offset, child.position.end.offset]);
    else nestedRawSpans(child, source, spans);
  }
  return spans;
}
