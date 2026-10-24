import { parse } from "yaml";
import { z } from "zod";

export const webFormatPath = "_qollab-web.yml";
const name = z
  .string()
  .regex(/^[A-Za-z_][\w.-]*$/)
  .max(100);
const value = z
  .union([z.string(), z.number().finite()])
  .transform(String)
  .pipe(
    z
      .string()
      .max(200)
      .refine(
        (s) =>
          !/[;{}<>\\\r\n]/.test(s) && !/url\s*\(|expression\s*\(|@/i.test(s),
        "Use a literal CSS value without URLs or declarations",
      ),
  );
const property = z.enum([
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-decoration",
  "white-space",
  "vertical-align",
  "display",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "margin",
  "margin-block",
  "margin-inline",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "padding",
  "padding-block",
  "padding-inline",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "border",
  "border-top",
  "border-bottom",
  "border-left",
  "border-right",
  "border-radius",
]);
export const webFormatSchema = z
  .object({
    version: z.literal(1),
    variables: z
      .record(name, value)
      .default({})
      .refine((v) => Object.keys(v).length <= 64),
    functions: z
      .record(
        name,
        z
          .object({
            tag: z.enum([
              "span",
              "strong",
              "em",
              "u",
              "small",
              "div",
              "p",
              "section",
              "header",
              "footer",
              "aside",
              "blockquote",
              "h1",
              "h2",
              "h3",
              "h4",
              "h5",
              "h6",
            ]),
            style: z.partialRecord(property, value).default({}),
          })
          .strict(),
      )
      .refine((v) => Object.keys(v).length <= 128),
  })
  .strict();
export type WebFormat = z.infer<typeof webFormatSchema>;

/** Project-owned declarative formatting; never executes Typst, HTML, or JS. */
export function readWebFormat(source?: string): {
  format?: WebFormat;
  warning?: string;
} {
  if (source === undefined) return {};
  try {
    if (source.length > 65536) throw new Error("File exceeds 64 KiB");
    return {
      format: webFormatSchema.parse(parse(source, { maxAliasCount: 0 })),
    };
  } catch (e) {
    const detail =
      e instanceof z.ZodError
        ? e.issues
            .map((i) => i.path.join(".") || "version/functions")
            .slice(0, 3)
            .join(", ")
        : "YAML";
    return { warning: `웹 서식 정의 오류: ${webFormatPath} (${detail})` };
  }
}

export function webFormatSource(files: { path: string; source?: string }[]) {
  return files.find((f) => f.path === webFormatPath)?.source;
}
