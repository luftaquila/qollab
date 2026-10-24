import { parse } from "csv-parse/sync";
import { ApplyError } from "./model.js";
export interface Sheets {
  read(id: string, range: string): Promise<unknown[][]>;
}
/** Public link access only. No user tokens and no spreadsheet writes. */
export class GoogleSheets implements Sheets {
  constructor(private fetcher: typeof fetch = fetch) {}
  async read(id: string, range: string): Promise<unknown[][]> {
    const match = /^'((?:[^']|'')+)'!(A\d+:[A-Z]+\d+)$/.exec(range);
    if (!match || !/^[\w-]{15,150}$/.test(id))
      throw new ApplyError("INVALID_REQUEST");
    const rows = /A(\d+):[A-Z]+(\d+)/.exec(match[2])!;
    const maxRows = Number(rows[2]) - Number(rows[1]) + 1;
    if (maxRows < 1 || maxRows > 10000) throw new ApplyError("INVALID_REQUEST");
    const url = new URL(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq`);
    url.search = new URLSearchParams({
      tqx: "out:csv",
      headers: "0",
      sheet: match[1].replaceAll("''", "'"),
      range: match[2],
      _: String(Date.now()),
    }).toString();
    try {
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(20000),
        headers: { "cache-control": "no-cache" },
      });
      if (
        [401, 403].includes(response.status) ||
        response.url.includes("accounts.google.com")
      )
        throw new ApplyError("SHEET_PERMISSION", 403);
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("csv")
      )
        throw new ApplyError("SHEET_NOT_FOUND", 400);
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16 * 1024 * 1024)
            throw new ApplyError("SHEET_TOO_LARGE", 413);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return parse(Buffer.concat(chunks), {
        bom: true,
        relax_column_count: true,
        max_record_size: 2 * 1024 * 1024,
        to: maxRows,
      });
    } catch (error) {
      if (error instanceof ApplyError) throw error;
      throw new ApplyError("SHEETS_UNAVAILABLE", 502);
    }
  }
}
