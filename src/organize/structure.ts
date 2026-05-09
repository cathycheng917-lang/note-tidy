import { detectNumbering } from "./numbering";

function isUnorderedListLine(trimmed: string) {
  return /^[-*•·]\s+/.test(trimmed);
}

function normalizeIndent(indent: string) {
  const s = String(indent ?? "").replace(/\t/g, " ");
  return s.length > 2 ? "  " : s;
}

function normalizeUnorderedListLine(line: string) {
  const m = String(line ?? "").match(/^(\s*)[-*•·]\s+(.*)$/);
  if (!m) return null;
  const indent = normalizeIndent(m[1] ?? "");
  const rest = String(m[2] ?? "").trimStart();
  return indent + "- " + rest;
}

function extractOrderedMarker(line: string, det: ReturnType<typeof detectNumbering>) {
  const s = String(line ?? "");
  if (!det) return null;

  if (det.style === "arabic-dot") {
    const m = s.match(/^(\s*)(\d{1,3})\.(\s*)(.*)$/);
    if (!m) return null;
    return { indent: m[1] ?? "", marker: `${m[2]}.`, rest: m[4] ?? "" };
  }
  if (det.style === "arabic-rparen") {
    const m = s.match(/^(\s*)(\d{1,3})\)(\s*)(.*)$/);
    if (!m) return null;
    return { indent: m[1] ?? "", marker: `${m[2]})`, rest: m[4] ?? "" };
  }
  if (det.style === "arabic-paren") {
    const m = s.match(/^(\s*)\((\d{1,3})\)(\s*)(.*)$/);
    if (!m) return null;
    return { indent: m[1] ?? "", marker: `(${m[2]})`, rest: m[4] ?? "" };
  }
  if (det.style === "chinese-comma") {
    const m = s.match(/^(\s*)([一二三四五六七八九十]{1,3})、(\s*)(.*)$/);
    if (!m) return null;
    return { indent: m[1] ?? "", marker: `${m[2]}、`, rest: m[4] ?? "" };
  }
  if (det.style === "circled") {
    const m = s.match(/^(\s*)([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])(\s*)(.*)$/);
    if (!m) return null;
    return { indent: m[1] ?? "", marker: m[2], rest: m[4] ?? "" };
  }

  return null;
}

function normalizeOrderedListLine(line: string) {
  const det = detectNumbering(line);
  if (!det) return null;
  const parts = extractOrderedMarker(line, det);
  if (!parts) return null;
  const indent = normalizeIndent(parts.indent);
  const rest = String(parts.rest ?? "").trimStart();
  return indent + parts.marker + (rest ? " " + rest : "");
}

function looksLikeHeadingLine(line: string, prevTrimmed: string, nextTrimmed: string) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^第[一二三四五六七八九十0-9]+[章节篇部分]\b/.test(trimmed)) return true;
  if (/^[^：:]{1,24}[：:]\s*\S/.test(trimmed)) return true;

  const len = trimmed.length;
  if (len > 2 && len <= 18) {
    if (/[。！？；;]$/.test(trimmed)) return false;
    if (/[，,]/.test(trimmed)) return false;
    if (isUnorderedListLine(trimmed)) return false;
    if (detectNumbering(trimmed)) return false;

    if (nextTrimmed) {
      if (!prevTrimmed) return true;
      if (/[。！？；;]$/.test(prevTrimmed)) return true;
      if (prevTrimmed.length >= 24) return true;
    }
  }

  return false;
}

function isListLine(line: string) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return false;
  if (isUnorderedListLine(trimmed)) return true;
  if (detectNumbering(trimmed)) return true;
  return false;
}

export function enhanceStructure(text: string) {
  const lines = String(text ?? "").split("\n");

  const normalized = lines.map((line) => {
    const unordered = normalizeUnorderedListLine(line);
    if (unordered != null) return unordered;
    const ordered = normalizeOrderedListLine(line);
    if (ordered != null) return ordered;
    return line;
  });

  const out: string[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const cur = normalized[i] ?? "";
    const prevTrimmed = (out[out.length - 1] ?? "").trim();
    const nextTrimmed = (normalized[i + 1] ?? "").trim();

    const heading = looksLikeHeadingLine(cur, prevTrimmed, nextTrimmed);
    const list = isListLine(cur);
    const prevIsList = out.length ? isListLine(out[out.length - 1] ?? "") : false;

    if (heading && out.length && prevTrimmed) out.push("");
    if (list && out.length && prevTrimmed && !prevIsList) out.push("");

    out.push(cur);

    if (heading && nextTrimmed) out.push("");
  }

  return out.join("\n");
}

