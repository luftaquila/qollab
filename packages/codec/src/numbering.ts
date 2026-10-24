import { z } from "zod";

export const numberStyles = [
  "decimal",
  "circled",
  "korean",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "custom",
] as const;
export const levelSchema = z.object({
  style: z.enum(numberStyles).default("decimal"),
  format: z.string().max(160).default("{n}"),
  symbols: z.array(z.string().min(1).max(20)).max(100).default([]),
  title: z.string().max(200).default("{label} {title}"),
  reference: z.string().max(200).default("{label}"),
  referenceStyle: z.enum(numberStyles).default("decimal"),
  reset: z.enum(["parent", "document"]).default("parent"),
});
const ruleSchema = levelSchema.extend({ match: z.string().min(1).max(160) });
const captionSchema = z.object({
  enabled: z.boolean().default(false),
  label: levelSchema.default(() => levelSchema.parse({})),
  caption: z.string().max(200).default("{label}. {caption}"),
});
const counterSchema = levelSchema.extend({
  name: z
    .string()
    .regex(/^[A-Za-z][\w.-]*$/)
    .max(80),
});
export const numberingSchema = z
  .object({
    version: z.literal(2).default(2),
    pdf: z
      .object({ mode: z.enum(["automatic", "template"]).default("automatic") })
      .default(() => ({ mode: "automatic" as const })),
    figures: captionSchema.default(() => captionSchema.parse({})),
    bullets: z
      .object({
        enabled: z.boolean().default(false),
        symbols: z
          .array(z.string().min(1).max(20))
          .min(1)
          .max(8)
          .default(["•", "◦", "▪"]),
      })
      .default(() => ({ enabled: false, symbols: ["•", "◦", "▪"] })),
    counters: z.array(counterSchema).max(30).default([]),
    headings: z
      .object({
        enabled: z.boolean().default(false),
        levels: z
          .array(levelSchema)
          .min(1)
          .max(6)
          .default(Array.from({ length: 6 }, () => levelSchema.parse({}))),
        rules: z.array(ruleSchema).max(100).default([]),
      })
      .default(() => ({
        enabled: false,
        levels: Array.from({ length: 6 }, () => levelSchema.parse({})),
        rules: [],
      })),
    lists: z
      .object({
        enabled: z.boolean().default(false),
        levels: z
          .array(levelSchema)
          .min(1)
          .max(8)
          .default(
            Array.from({ length: 4 }, () =>
              levelSchema.parse({ format: "{n}." }),
            ),
          ),
      })
      .default(() => ({
        enabled: false,
        levels: Array.from({ length: 4 }, () =>
          levelSchema.parse({ format: "{n}." }),
        ),
      })),
  })
  .strict();
export type Numbering = z.infer<typeof numberingSchema>;
export type NumberLevel = z.infer<typeof levelSchema>;
export const defaultNumbering = () => numberingSchema.parse({});
export const defaultLevel = (format = "{n}") => levelSchema.parse({ format });
function alphabetic(n: number, alphabet: string[]) {
  if (n < 1 || !alphabet.length) return String(n);
  let out = "";
  while (n > 0) {
    n--;
    out = alphabet[n % alphabet.length] + out;
    n = Math.floor(n / alphabet.length);
  }
  return out;
}
export function numberSymbol(
  n: number,
  level: Pick<NumberLevel, "style" | "symbols">,
): string {
  if (level.style === "circled")
    return n >= 1 && n <= 20 ? String.fromCodePoint(0x245f + n) : `(${n})`;
  if (level.style === "korean")
    return alphabetic(n, [..."가나다라마바사아자차카타파하"]);
  if (level.style === "custom") return alphabetic(n, level.symbols);
  if (level.style === "lower-alpha" || level.style === "upper-alpha")
    return alphabetic(n, [
      ...(level.style === "lower-alpha"
        ? "abcdefghijklmnopqrstuvwxyz"
        : "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    ]);
  if (level.style === "lower-roman" && n > 0 && n < 4000) {
    let out = "";
    for (const [value, symbol] of [
      [1000, "m"],
      [900, "cm"],
      [500, "d"],
      [400, "cd"],
      [100, "c"],
      [90, "xc"],
      [50, "l"],
      [40, "xl"],
      [10, "x"],
      [9, "ix"],
      [5, "v"],
      [4, "iv"],
      [1, "i"],
    ] as const)
      while (n >= value) {
        out += symbol;
        n -= value;
      }
    return out;
  }
  return String(n);
}
export function formatNumber(
  numbers: number[],
  levels: NumberLevel[],
  override?: NumberLevel,
) {
  const depth = numbers.length - 1;
  const level = override || levels[Math.min(depth, levels.length - 1)];
  return level.format.replace(/\{(n|[1-8])\}/g, (_, key: string) => {
    const index = key === "n" ? depth : Number(key) - 1;
    return numberSymbol(
      numbers[index] || 0,
      key === "n" ? level : levels[Math.min(index, levels.length - 1)],
    );
  });
}
/** Prefixes are literal user input plus numeric placeholders, never executable regex. */
function matchPrefix(text: string, pattern: string) {
  const slots = [...pattern.matchAll(/\{(n|[1-8])\}/g)];
  const values: { key: string; n: number }[] = [];
  let sourceAt = 0,
    patternAt = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i],
      literal = pattern.slice(patternAt, slot.index);
    if (!text.startsWith(literal, sourceAt)) return undefined;
    sourceAt += literal.length;
    const start = sourceAt;
    // Consume digits once. User patterns never become a backtracking regex.
    while (
      sourceAt < text.length &&
      text.charCodeAt(sourceAt) >= 48 &&
      text.charCodeAt(sourceAt) <= 57
    )
      sourceAt++;
    const nextLiteral = pattern.slice(
      slot.index! + slot[0].length,
      slots[i + 1]?.index ?? pattern.length,
    );
    if (i + 1 < slots.length && !nextLiteral) return undefined;
    const numericSuffix = /^\d+/.exec(nextLiteral)?.[0];
    if (numericSuffix) {
      if (!text.slice(start, sourceAt).endsWith(numericSuffix))
        return undefined;
      sourceAt -= numericSuffix.length;
    }
    const n = Number(text.slice(start, sourceAt));
    if (sourceAt === start || !Number.isSafeInteger(n)) return undefined;
    values.push({ key: slot[1], n });
    patternAt = slot.index! + slot[0].length;
  }
  const tail = pattern.slice(patternAt);
  if (!text.startsWith(tail, sourceAt)) return undefined;
  sourceAt += tail.length;
  if (sourceAt < text.length && !/[\s.:：()]/u.test(text[sourceAt]))
    return undefined;
  return { length: sourceAt, values };
}
export function fillPattern(pattern: string, values: Record<string, string>) {
  return pattern.replace(
    /\{([\w]+)\}/g,
    (whole, key: string) => values[key] ?? whole,
  );
}
export function listReference(
  numbers: number[],
  settings: Numbering,
  headings: string[],
) {
  const level =
    settings.lists.levels[
      Math.min(numbers.length - 1, settings.lists.levels.length - 1)
    ];
  const referenceLevels = settings.lists.levels.map((l) => ({
    ...l,
    style: l.referenceStyle,
  }));
  return fillPattern(
    formatNumber(numbers, referenceLevels, {
      ...level,
      style: level.referenceStyle,
      format: level.reference,
    }),
    {
      label: formatNumber(numbers, settings.lists.levels),
      ...Object.fromEntries(headings.map((label, i) => ["h" + (i + 1), label])),
    },
  );
}
export function headingCounter(settings: Numbering) {
  const counters = Array(6).fill(0) as number[];
  const labels = Array(6).fill("") as string[];
  return (text: string, depth: number) => {
    counters[depth - 1]++;
    for (let i = depth; i < counters.length; i++) {
      if (
        settings.headings.levels[
          Math.min(i, settings.headings.levels.length - 1)
        ].reset !== "document"
      )
        counters[i] = 0;
      labels[i] = "";
    }
    let body = text;
    let level =
      settings.headings.levels[
        Math.min(depth - 1, settings.headings.levels.length - 1)
      ];
    if (settings.headings.enabled) {
      const candidates = settings.headings.rules
        .map((rule) => ({ rule, match: matchPrefix(text, rule.match) }))
        .filter((candidate) => candidate.match)
        .sort((a, b) => b.match!.length - a.match!.length);
      const candidate = candidates[0];
      if (candidate) {
        level = candidate.rule;
        for (const { key, n } of candidate.match!.values)
          counters[key === "n" ? depth - 1 : Number(key) - 1] = n;
        body = text.slice(candidate.match!.length).trimStart();
      }
    }
    const numbers = counters.slice(0, depth);
    const label = settings.headings.enabled
      ? formatNumber(numbers, settings.headings.levels, level)
      : "";
    labels[depth - 1] = label;
    const values = {
      label,
      title: body,
      ...Object.fromEntries(labels.map((s, i) => ["h" + (i + 1), s])),
    };
    const title = label ? fillPattern(level.title, values) : body;
    const reference = label
      ? fillPattern(
          formatNumber(
            numbers,
            settings.headings.levels.map((l) => ({
              ...l,
              style: l.referenceStyle,
            })),
            {
              ...level,
              style: level.referenceStyle,
              format: level.reference,
            },
          ),
          values,
        )
      : body;
    return {
      label,
      title,
      reference,
      numbers,
      labels: [...labels],
      body,
      prefix: text.slice(0, text.length - body.length),
      titlePattern: level.title,
      level: depth,
    };
  };
}
export function headingNumbering(settings: Numbering) {
  const next = headingCounter(numberingSchema.parse(settings));
  return (text: string, depth: number) => next(text, depth).title;
}
