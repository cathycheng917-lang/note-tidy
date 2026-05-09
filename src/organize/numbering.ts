const CIRCLED_NUM_MAP = new Map<string, number>([
  ["①", 1],
  ["②", 2],
  ["③", 3],
  ["④", 4],
  ["⑤", 5],
  ["⑥", 6],
  ["⑦", 7],
  ["⑧", 8],
  ["⑨", 9],
  ["⑩", 10],
  ["⑪", 11],
  ["⑫", 12],
  ["⑬", 13],
  ["⑭", 14],
  ["⑮", 15],
  ["⑯", 16],
  ["⑰", 17],
  ["⑱", 18],
  ["⑲", 19],
  ["⑳", 20],
]);

const NUM_TO_CIRCLED = new Map<number, string>(
  Array.from(CIRCLED_NUM_MAP.entries()).map(([k, v]) => [v, k])
);

function toChineseNumber(n: number) {
  if (!Number.isInteger(n) || n <= 0 || n >= 100) return null;
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n < 10) return digits[n];
  if (n === 10) return "十";
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensPart = tens === 1 ? "十" : `${digits[tens]}十`;
  return ones === 0 ? tensPart : `${tensPart}${digits[ones]}`;
}

function fromChineseNumber(s: string) {
  const map = new Map<string, number>([
    ["一", 1],
    ["二", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9],
  ]);

  if (!s) return null;
  if (map.has(s)) return map.get(s)!;
  if (s === "十") return 10;
  if (s.startsWith("十") && s.length === 2 && map.has(s[1])) return 10 + map.get(s[1])!;
  if (s.length === 2 && s[1] === "十" && map.has(s[0])) return map.get(s[0])! * 10;
  if (s.length === 3 && s[1] === "十" && map.has(s[0]) && map.has(s[2]))
    return map.get(s[0])! * 10 + map.get(s[2])!;
  return null;
}

function hasDigitImmediatelyAfterMarker(line: string, markerEndIndex: number) {
  const next = line.slice(markerEndIndex, markerEndIndex + 1);
  return /^[0-9]$/.test(next);
}

function isLikelyChapterOrDateLine(trimmed: string) {
  if (/^第[一二三四五六七八九十0-9]+[章节篇部分]\b/.test(trimmed)) return true;
  if (/^\d{4}\s*年/.test(trimmed)) return true;
  if (/^\d{1,2}\s*月\s*\d{1,2}\s*日/.test(trimmed)) return true;
  if (/^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(trimmed)) return true;
  return false;
}

export type NumberingDetection =
  | {
      family: "arabic";
      style: "arabic-dot" | "arabic-rparen" | "arabic-paren";
      indent: string;
      index: number;
      rest: string;
    }
  | {
      family: "chinese";
      style: "chinese-comma";
      indent: string;
      index: number;
      rest: string;
    }
  | {
      family: "circled";
      style: "circled";
      indent: string;
      index: number;
      rest: string;
    };

function parseArabic(line: string): NumberingDetection | null {
  const mDot = line.match(/^(\s*)(\d{1,3})\.(\s*)(.*)$/);
  if (mDot) {
    const indent = mDot[1] ?? "";
    const idx = Number(mDot[2]);
    const ws = mDot[3] ?? "";
    const rest = mDot[4] ?? "";
    const markerEndIndex = (indent + mDot[2] + ".").length;
    if (!ws && hasDigitImmediatelyAfterMarker(line, markerEndIndex)) return null;
    if (mDot[2].length === 3 && idx >= 100 && !ws && /^[0-9]/.test(rest)) return null;
    return { family: "arabic", style: "arabic-dot", indent, index: idx, rest };
  }

  const mRParen = line.match(/^(\s*)(\d{1,3})\)(\s*)(.*)$/);
  if (mRParen) {
    const indent = mRParen[1] ?? "";
    const idx = Number(mRParen[2]);
    const ws = mRParen[3] ?? "";
    const rest = mRParen[4] ?? "";
    const markerEndIndex = (indent + mRParen[2] + ")").length;
    if (!ws && hasDigitImmediatelyAfterMarker(line, markerEndIndex)) return null;
    return { family: "arabic", style: "arabic-rparen", indent, index: idx, rest };
  }

  const mParen = line.match(/^(\s*)\((\d{1,3})\)(\s*)(.*)$/);
  if (mParen) {
    const indent = mParen[1] ?? "";
    const idx = Number(mParen[2]);
    const ws = mParen[3] ?? "";
    const rest = mParen[4] ?? "";
    const markerEndIndex = (indent + "(" + mParen[2] + ")").length;
    if (!ws && hasDigitImmediatelyAfterMarker(line, markerEndIndex)) return null;
    return { family: "arabic", style: "arabic-paren", indent, index: idx, rest };
  }

  return null;
}

function parseChinese(line: string): NumberingDetection | null {
  const m = line.match(/^(\s*)([一二三四五六七八九十]{1,3})、(\s*)(.*)$/);
  if (!m) return null;
  const indent = m[1] ?? "";
  const raw = m[2] ?? "";
  const idx = fromChineseNumber(raw);
  if (idx == null) return null;
  const rest = m[4] ?? "";
  return { family: "chinese", style: "chinese-comma", indent, index: idx, rest };
}

function parseCircled(line: string): NumberingDetection | null {
  const m = line.match(/^(\s*)([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])(\s*)(.*)$/);
  if (!m) return null;
  const indent = m[1] ?? "";
  const raw = m[2] ?? "";
  const idx = CIRCLED_NUM_MAP.get(raw);
  if (!idx) return null;
  const rest = m[4] ?? "";
  return { family: "circled", style: "circled", indent, index: idx, rest };
}

export function detectNumbering(line: string): NumberingDetection | null {
  const rawLine = String(line ?? "");
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isLikelyChapterOrDateLine(trimmed)) return null;
  return parseArabic(rawLine) ?? parseChinese(rawLine) ?? parseCircled(rawLine);
}

function markerFor(style: NumberingDetection["style"], n: number) {
  if (style === "arabic-dot") return `${n}.`;
  if (style === "arabic-rparen") return `${n})`;
  if (style === "arabic-paren") return `(${n})`;
  if (style === "chinese-comma") {
    const cn = toChineseNumber(n);
    return cn ? `${cn}、` : null;
  }
  if (style === "circled") return NUM_TO_CIRCLED.get(n) ?? null;
  return null;
}

function renderLine(det: NumberingDetection, newIndex: number) {
  const marker = markerFor(det.style, newIndex);
  if (!marker) return null;
  const rest = String(det.rest ?? "").trimStart();
  return det.indent + marker + (rest ? " " + rest : "");
}

function shouldRepair(indices: number[]) {
  if (indices.length < 2) return false;
  const hasAdjacentSequential = indices.some((v, i) => i > 0 && v === indices[i - 1] + 1);
  if (!hasAdjacentSequential) return false;
  const start = indices[0];
  let mismatch = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] !== start + i) mismatch++;
  if (mismatch === 0) return false;
  return mismatch / indices.length <= 0.5;
}

export function repairNumberingInText(text: string) {
  const lines = String(text ?? "").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; ) {
    const det0 = detectNumbering(lines[i]);
    if (!det0) {
      out.push(lines[i]);
      i++;
      continue;
    }

    const block: string[] = [];
    const dets: NumberingDetection[] = [];
    let j = i;
    while (j < lines.length) {
      const det = detectNumbering(lines[j]);
      if (!det) break;
      if (det.family !== det0.family) break;
      if (det.family !== "arabic" && det.style !== det0.style) break;
      if (det.family === "circled" && (det.index < 1 || det.index > 20)) break;
      block.push(lines[j]);
      dets.push(det.family === "arabic" ? ({ ...det, style: det0.style } as NumberingDetection) : det);
      j++;
    }

    if (block.length < 2) {
      out.push(lines[i]);
      i++;
      continue;
    }

    const indices = dets.map((d) => d.index);
    if (!shouldRepair(indices)) {
      out.push(...block);
      i = j;
      continue;
    }

    const start = indices[0];
    const repaired: string[] = [];
    let ok = true;
    for (let k = 0; k < dets.length; k++) {
      const line = renderLine(dets[k], start + k);
      if (line == null) {
        ok = false;
        break;
      }
      repaired.push(line);
    }

    out.push(...(ok ? repaired : block));
    i = j;
  }

  return out.join("\n");
}

