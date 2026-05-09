import { repairNumberingInText } from "./numbering";
import { enhanceStructure } from "./structure";

function normalizeNewlines(text: string) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function trimAndCollapseSpacesPerLine(text: string) {
  const lines = text.split("\n");
  const cleaned = lines.map((line) => {
    let out = line.replace(/[ \t]+$/g, "");
    out = out.replace(/\t/g, " ");

    const match = out.match(/^(\s*)(.*)$/);
    if (!match) return out;
    let indent = match[1] ?? "";
    const body = match[2] ?? "";

    indent = indent.replace(/[ \t]/g, " ");
    indent = indent.length > 2 ? "  " : indent;

    const collapsedBody = body.replace(/[ ]{2,}/g, " ");
    return indent + collapsedBody;
  });
  return cleaned.join("\n");
}

function collapseEmptyLines(text: string) {
  let out = text.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/^\n+/, "").replace(/\n+$/, "");
  return out;
}

function isListOrStructureLine(line: string) {
  const s = line.trim();
  if (!s) return true;
  if (/^[-*•·]\s+/.test(s)) return true;
  if (/^(\d+|[一二三四五六七八九十]+)[.)）．。、]\s+/.test(s)) return true;
  if (/^#{1,6}\s+/.test(s)) return true;
  if (/^>/.test(s)) return true;
  if (/^```/.test(s)) return true;
  return false;
}

function looksLikeHeadingLine(line: string) {
  const s = line.trim();
  if (!s) return false;
  if (/^#{1,6}\s+/.test(s)) return true;
  if (/^第[一二三四五六七八九十0-9]+[章节]\b/.test(s)) return true;
  if (/^[^：:]{1,24}[：:]\s*$/.test(s)) return true;
  return false;
}

function endsWithSentencePunctuation(line: string) {
  const s = line.trim();
  if (!s) return true;
  return /[。！？；;:：.!?)]$/.test(s);
}

function chooseJoiner(a: string, b: string) {
  const left = a.slice(-1);
  const right = b.slice(0, 1);

  const isCJK = (ch: string) => /[\u4e00-\u9fff]/.test(ch);
  const isWord = (ch: string) => /[A-Za-z0-9]/.test(ch);

  if (isCJK(left) && isCJK(right)) return "";
  if (isWord(left) && isWord(right)) return " ";
  if (isWord(left) && isCJK(right)) return " ";
  if (isCJK(left) && isWord(right)) return " ";
  return " ";
}

function mergeBrokenLines(text: string) {
  const lines = text.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i] ?? "";
    const next = lines[i + 1];

    if (next === undefined) {
      out.push(cur);
      continue;
    }

    if (!cur.trim() || !next.trim()) {
      out.push(cur);
      continue;
    }
    if (isListOrStructureLine(cur) || isListOrStructureLine(next)) {
      out.push(cur);
      continue;
    }
    if (looksLikeHeadingLine(cur)) {
      out.push(cur);
      continue;
    }
    if (endsWithSentencePunctuation(cur)) {
      out.push(cur);
      continue;
    }

    const curTrim = cur.trimEnd();
    const nextTrim = next.trimStart();

    const hyphenWrap = /[A-Za-z]-$/.test(curTrim) && /^[A-Za-z]/.test(nextTrim);
    if (hyphenWrap) {
      lines[i + 1] = curTrim.slice(0, -1) + nextTrim;
      continue;
    }

    const joiner = chooseJoiner(curTrim, nextTrim);
    lines[i + 1] = curTrim + joiner + nextTrim;
  }

  if (out.length === 0) return lines.join("\n");
  if (out[out.length - 1] !== lines[lines.length - 1]) out.push(lines[lines.length - 1] ?? "");
  return out.join("\n");
}

export function cleanText(raw: string) {
  let text = normalizeNewlines(raw);
  text = trimAndCollapseSpacesPerLine(text);
  text = collapseEmptyLines(text);
  text = mergeBrokenLines(text);
  text = collapseEmptyLines(text);
  return text;
}

export function organizeNote(raw: string) {
  const pipeline: Array<(t: string) => string> = [
    cleanText,
    repairNumberingInText,
    enhanceStructure,
    collapseEmptyLines,
  ];

  let text = raw;
  for (const step of pipeline) text = step(text);
  return text ? text + "\n" : "";
}

