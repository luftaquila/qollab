/** Only local application destinations may survive an authentication round trip. */
export function returnDestination(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return "/";
  const url = new URL(value, "https://qollab.invalid");
  if (
    url.origin !== "https://qollab.invalid" ||
    !/^\/(?:$|(?:projects|docs|apply)(?:\/|$))/.test(url.pathname)
  )
    return "/";
  return url.pathname + url.search + url.hash;
}
