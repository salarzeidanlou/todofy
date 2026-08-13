import * as chrono from "chrono-node";
import type { Label } from "../types";
import { toLocalDate } from "./dates";

export interface ParsedQuickAdd {
  /** Title with recognized date/priority/label tokens stripped out. */
  title: string;
  dueDate: string | null; // YYYY-MM-DD
  time: string | null; // HH:mm, only when a clock time was stated
  priority: number | null; // 1..4
  labelIds: number[];
  labelNames: string[];
}

/** Priority written as `p1`..`p4` or `!1`..`!4`, as a standalone token. */
const PRIORITY_RE = /(^|\s)(?:p([1-4])|!([1-4]))(?=\s|$)/i;

/** A label reference: `#label` or `@label` (letters, digits, _ and -). */
const LABEL_RE = /(^|\s)[@#]([\p{L}\p{N}_-]+)/gu;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Collapse the whitespace left behind after cutting tokens out of the text. */
function tidy(s: string): string {
  return s.replace(/\s{2,}/g, " ").trim();
}

/**
 * Parse a quick-add string like "pay rent friday 5pm #home p1" into a title
 * plus structured fields. Tokens that are recognized are removed from the
 * title; anything unrecognized (including a `#tag` with no matching label) is
 * left untouched. Date/time parsing is delegated to chrono-node.
 */
export function parseQuickAdd(input: string, labels: Label[]): ParsedQuickAdd {
  let text = input;
  let priority: number | null = null;
  const labelIds: number[] = [];
  const labelNames: string[] = [];

  // Priority first, so chrono never sees `p1` etc.
  const pm = text.match(PRIORITY_RE);
  if (pm) {
    priority = Number(pm[2] ?? pm[3]);
    text = text.slice(0, pm.index!) + (pm[1] ? " " : "") + text.slice(pm.index! + pm[0].length);
  }

  // Labels: only strip a token if it names a label that actually exists.
  const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l]));
  text = text.replace(LABEL_RE, (whole, lead: string, name: string) => {
    const label = byName.get(name.toLowerCase());
    if (!label) return whole; // leave unknown #tags in the title
    if (!labelIds.includes(label.id)) {
      labelIds.push(label.id);
      labelNames.push(label.name);
    }
    return lead ? " " : "";
  });

  // Date / time via chrono; forwardDate makes bare weekdays mean "next".
  let dueDate: string | null = null;
  let time: string | null = null;
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  if (results.length) {
    const r = results[0];
    const d = r.start.date();
    dueDate = toLocalDate(d);
    if (r.start.isCertain("hour")) time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    text = text.slice(0, r.index) + " " + text.slice(r.index + r.text.length);
    // chrono leaves the connector behind ("taxes on <april 15>" → "taxes on").
    text = text.replace(/\s+(on|at|by|due|for)\s*$/i, "");
  }

  return {
    title: tidy(text),
    dueDate,
    time,
    priority,
    labelIds,
    labelNames,
  };
}
