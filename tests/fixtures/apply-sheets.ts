import type { Sheets } from "../../apps/apply/server/sheets";
import { columnIndex, reviewHeaders } from "../../apps/apply/server/model";
export class FixtureSheets implements Sheets {
  configured = true;
  values: Record<string, unknown[][]> = {
    Source: [
      ["Key", "Reference", "Existing", "Note", "Decision", "Timing"],
      [
        "Rule one",
        "New condition",
        "old condition",
        "Reviewed wording",
        "Replace",
        "2027",
      ],
      ["", "Additional detail"],
      ["Rule two", "Future proposal", "", "Discuss later", "Hold", "2028"],
    ],
  };
  failWrites = false;
  async metadata(_id: string) {
    return {
      sheets: Object.keys(this.values).map((title, sheetId) => ({
        title,
        sheetId,
      })),
    };
  }
  parse(range: string) {
    const m = /^'((?:[^']|'')+)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
    if (!m) throw new Error("Invalid fixture range " + range);
    return {
      sheet: m[1].replaceAll("''", "'"),
      col: columnIndex(m[2]),
      row: Number(m[3]) - 1,
      endCol: columnIndex(m[4] || m[2]),
      endRow: Number(m[5] || m[3]) - 1,
    };
  }
  async read(_id: string, range: string) {
    const p = this.parse(range),
      values = this.values[p.sheet] || [];
    return structuredClone(
      values
        .slice(p.row, p.endRow + 1)
        .map((row) => row.slice(p.col, p.endCol + 1)),
    );
  }
  async write(_id: string, data: { range: string; values: unknown[][] }[]) {
    if (this.failWrites) throw new Error("Sheets unavailable");
    for (const d of data) {
      const p = this.parse(d.range);
      this.values[p.sheet] ||= [];
      for (let r = 0; r < d.values.length; r++) {
        const rows = this.values[p.sheet];
        rows[p.row + r] ||= [];
        for (let c = 0; c < d.values[r].length; c++)
          rows[p.row + r][p.col + c] = d.values[r][c];
      }
    }
  }
  async createReview(_id: string, name: string) {
    this.values[name] ||= [[...reviewHeaders]];
  }
}
