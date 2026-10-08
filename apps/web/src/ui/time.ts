import { lang } from "../i18n";
const relative = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
/** "3분 전", "yesterday" — for timestamps people scan rather than read. */
export function ago(value: string | number | Date) {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size)
      return relative.format(Math.round(seconds / size), unit);
  return relative.format(0, "minute");
}
export const fullTime = (value: string | number | Date) =>
  new Date(value).toLocaleString(lang);
