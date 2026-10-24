import type { Sheets } from "../../apps/apply/server/sheets";
import { columnIndex } from "../../apps/apply/server/model";
export class FixtureSheets implements Sheets {
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
}
