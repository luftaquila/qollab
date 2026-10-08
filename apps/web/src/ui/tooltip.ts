// One floating tooltip for every [data-tip] element. Unlike title attributes it
// appears on keyboard focus, shows shortcuts and is not clipped by scroll areas.
let element: HTMLDivElement | undefined;
let target: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
function hide() {
  clearTimeout(timer);
  target = undefined;
  element?.remove();
}
function show(anchor: HTMLElement) {
  const text = anchor.dataset.tip;
  if (!text || !anchor.isConnected) return;
  element ||= Object.assign(document.createElement("div"), {
    className: "tooltip",
    role: "presentation",
  });
  element.textContent = text;
  if (anchor.dataset.kbd) {
    const kbd = document.createElement("kbd");
    kbd.textContent = anchor.dataset.kbd;
    element.append(kbd);
  }
  document.body.append(element);
  const rect = anchor.getBoundingClientRect(),
    tip = element.getBoundingClientRect();
  const below = rect.bottom + 6 + tip.height < innerHeight;
  const top = below ? rect.bottom + 6 : rect.top - tip.height - 6;
  const left = Math.min(
    Math.max(6, rect.left + rect.width / 2 - tip.width / 2),
    innerWidth - tip.width - 6,
  );
  const side = anchor.dataset.tipSide;
  if (side === "right") {
    element.style.top = `${rect.top + rect.height / 2 - tip.height / 2}px`;
    element.style.left = `${rect.right + 8}px`;
  } else {
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
  }
}
function schedule(anchor: HTMLElement, delay: number) {
  if (anchor === target) return;
  hide();
  target = anchor;
  timer = setTimeout(() => show(anchor), delay);
}
export function installTooltips() {
  document.addEventListener("pointerover", (e) => {
    const anchor = (e.target as Element).closest?.<HTMLElement>("[data-tip]");
    // Editor marks (labels, references) name themselves at once.
    if (anchor && e.pointerType !== "touch")
      schedule(anchor, Number(anchor.dataset.tipDelay ?? 450));
    else if (!anchor) hide();
  });
  document.addEventListener("focusin", (e) => {
    const anchor = (e.target as Element).closest?.<HTMLElement>("[data-tip]");
    if (anchor?.matches(":focus-visible")) schedule(anchor, 0);
    else hide();
  });
  for (const type of ["pointerdown", "focusout", "scroll", "keydown"])
    document.addEventListener(type, hide, true);
}
