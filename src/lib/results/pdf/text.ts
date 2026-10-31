/* eslint-disable no-irregular-whitespace */
// WinAnsi-safe text for jsPDF's built-in Helvetica. Anything drawn must pass through pdfSafe.

const WIN_ANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""),
);

const REPLACEMENTS: Record<string, string> = {
  "₹": "Rs.",
  "✓": "Correct",
  "✔": "Correct",
  "✗": "Wrong",
  "✘": "Wrong",
  "✕": "Wrong",
  "→": "->",
  "←": "<-",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "′": "'",
  "″": '"',
  "≥": ">=",
  "≤": "<=",
  "×": "x",
};

export function pdfSafe(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = String(input);
  // Exotic spaces (incl. U+202F narrow no-break, U+00A0, U+2000-200A, U+3000) -> plain space
  s = s.replace(/[   -   　]/g, " ");
  // Zero-width / BOM / soft hyphen / bidi marks -> removed
  s = s.replace(/[­​-‏‪-‮⁠⁦-⁩﻿]/g, "");
  s = s.replace(/\t/g, " ");
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff)) {
      out += ch;
    } else if (WIN_ANSI_EXTRA.has(ch)) {
      out += ch;
    } else if (REPLACEMENTS[ch] !== undefined) {
      out += REPLACEMENTS[ch];
    } else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      // control chars dropped
    } else {
      // try stripping diacritics (e.g. decomposed letters), else '?'
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += /^[\x20-\x7e]+$/.test(base) ? base : "?";
    }
  }
  return out;
}
