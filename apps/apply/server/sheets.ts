import { GoogleAuth } from "google-auth-library";
import { existsSync } from "node:fs";
import { ApplyError, quoteSheet, reviewHeaders } from "./model.js";
export interface Sheets {
  configured: boolean;
  metadata(
    id: string,
  ): Promise<{ sheets: { sheetId: number; title: string }[] }>;
  read(id: string, range: string): Promise<unknown[][]>;
  write(
    id: string,
    data: { range: string; values: unknown[][] }[],
  ): Promise<void>;
  createReview(id: string, name: string): Promise<void>;
}
export class GoogleSheets implements Sheets {
  configured =
    !!process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  private auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  private async request(
    id: string,
    suffix: string,
    method = "GET",
    data?: unknown,
  ): Promise<any> {
    if (!this.configured) throw new ApplyError("SHEETS_NOT_CONFIGURED", 503);
    try {
      const client = await this.auth.getClient();
      const response = await client.request({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}${suffix}`,
        method: method as any,
        data,
        timeout: 20000,
      });
      return response.data;
    } catch (error: any) {
      if (error instanceof ApplyError) throw error;
      const status = Number(error.response?.status);
      throw new ApplyError(
        status === 403
          ? "SHEET_PERMISSION"
          : status === 404
            ? "SHEET_NOT_FOUND"
            : "SHEETS_UNAVAILABLE",
        status === 403 ? 403 : 502,
      );
    }
  }
  async metadata(
    id: string,
  ): Promise<{ sheets: { sheetId: number; title: string }[] }> {
    const value = await this.request(id, "?fields=sheets.properties");
    return {
      sheets: value.sheets.map((s: any) => ({
        sheetId: s.properties.sheetId,
        title: s.properties.title,
      })),
    };
  }
  async read(id: string, range: string) {
    const value = await this.request(
      id,
      "/values/" +
        encodeURIComponent(range) +
        "?valueRenderOption=UNFORMATTED_VALUE",
    );
    return value.values || [];
  }
  async write(id: string, data: { range: string; values: unknown[][] }[]) {
    await this.request(id, "/values:batchUpdate", "POST", {
      valueInputOption: "RAW",
      data,
    });
  }
  async createReview(id: string, name: string) {
    const metadata = await this.metadata(id);
    if (metadata.sheets.some((s) => s.title === name)) {
      const rows = await this.read(id, quoteSheet(name) + "!A1:R1");
      if (JSON.stringify(rows[0]) !== JSON.stringify(reviewHeaders))
        throw new ApplyError("REVIEW_SHEET_FORMAT", 409);
      return;
    }
    const made = await this.request(id, ":batchUpdate", "POST", {
      requests: [
        {
          addSheet: {
            properties: {
              title: name,
              gridProperties: {
                rowCount: 10000,
                columnCount: 18,
                frozenRowCount: 1,
              },
            },
          },
        },
      ],
    });
    const sheetId = made.replies[0].addSheet.properties.sheetId;
    await this.write(id, [
      { range: quoteSheet(name) + "!A1:R1", values: [reviewHeaders] },
    ]);
    await this.request(id, ":batchUpdate", "POST", {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 10000,
              startColumnIndex: 9,
              endColumnIndex: 10,
            },
            rule: {
              condition: { type: "BOOLEAN" },
              strict: true,
              showCustomUi: true,
            },
          },
        },
      ],
    });
  }
}
