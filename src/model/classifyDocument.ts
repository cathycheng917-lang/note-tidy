import type { ClassifiedBlock, ClassifiedDocument, ImportedDocxDocument } from "./documentModel";

function normalizeNewlines(text: string) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function trimForClassification(text: string) {
  return normalizeNewlines(text).trim();
}

function endsWithSentencePunctuation(line: string) {
  const s = line.trim();
  if (!s) return false;
  return /[。！？；;.!?]$/.test(s);
}

function looksLikeHeading(line: string) {
  const s = line.trim();
  if (!s) return false;

  // markdown 标题
  if (/^#{1,6}\s+\S/.test(s)) return true;

  // 章节类标题（避免把“第4章”当作序号列表）
  if (/^第[一二三四五六七八九十0-9]+[章节篇部分]\b/.test(s)) return true;

  // 像“定义：xxx”“标题：xxx”
  if (/^[^：:]{1,24}[：:]\s*\S/.test(s)) return true;

  // 短行标题（非常保守）
  if (s.length >= 2 && s.length <= 18) {
    if (endsWithSentencePunctuation(s)) return false;
    if (/[，,]/.test(s)) return false;
    if (looksLikeListLine(s)) return false;
    return true;
  }

  return false;
}

function looksLikeOrderedListLine(s: string) {
  // 1. / 1) / (1) / 一、 / ①
  return (
    /^(\d{1,3})\.\s+\S/.test(s) ||
    /^(\d{1,3})\)\s+\S/.test(s) ||
    /^\((\d{1,3})\)\s+\S/.test(s) ||
    /^([一二三四五六七八九十]{1,3})、\s*\S/.test(s) ||
    /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*\S/.test(s)
  );
}

function looksLikeUnorderedListLine(s: string) {
  return /^[-*•·]\s+\S/.test(s);
}

function looksLikeListLine(line: string) {
  const s = line.trim();
  if (!s) return false;

  // 避免误判日期/年份
  if (/^\d{4}\s*年/.test(s)) return false;
  if (/^\d{1,2}\s*月\s*\d{1,2}\s*日/.test(s)) return false;
  if (/^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(s)) return false;

  return looksLikeUnorderedListLine(s) || looksLikeOrderedListLine(s);
}

function classifyTextBlock(text: string): { kind: "title" | "list" | "text" | "unknown"; data: any } {
  const t = trimForClassification(text);
  if (!t) return { kind: "unknown", data: { raw: "" } };

  const lines = t.split("\n").map((l) => l.trimEnd());
  const nonEmpty = lines.filter((l) => l.trim());

  // 单行：优先标题
  if (nonEmpty.length === 1) {
    const line = nonEmpty[0];
    if (looksLikeHeading(line)) return { kind: "title", data: { text: line + "\n" } };
    return { kind: "text", data: { text: line + "\n" } };
  }

  // 多行：判断是否是列表块（至少 2 行是列表项，且占比足够高）
  const listLines = nonEmpty.filter((l) => looksLikeListLine(l)).length;
  if (nonEmpty.length >= 2 && listLines >= 2 && listLines / nonEmpty.length >= 0.6) {
    // 保留原行（不改内容），只做 items 拆分
    return { kind: "list", data: { items: nonEmpty.map((l) => l + "\n") } };
  }

  return { kind: "text", data: { text: t + "\n" } };
}

export function classifyImportedDocxDocument(doc: ImportedDocxDocument): ClassifiedDocument {
  const blocks: ClassifiedBlock[] = [];
  let order = 0;

  for (const b of doc.blocks) {
    if (b.type === "text") {
      const { kind, data } = classifyTextBlock(b.text);
      if (kind === "title") blocks.push({ type: "title", order: order++, text: data.text });
      else if (kind === "list") blocks.push({ type: "list", order: order++, items: data.items });
      else if (kind === "text") blocks.push({ type: "text", order: order++, text: data.text });
      else blocks.push({ type: "unknown", order: order++, raw: data.raw ?? b.text });
      continue;
    }

    if (b.type === "image") {
      blocks.push({
        type: "image",
        order: order++,
        src: b.src,
        contentType: b.contentType,
      });
      const ocrText = trimForClassification(b.ocrText ?? "");
      blocks.push({
        type: "ocr",
        order: order++,
        text: ocrText ? ocrText + "\n" : "",
      });
      continue;
    }

    // 理论上不会到这里，兜底
    blocks.push({ type: "unknown", order: order++, raw: JSON.stringify(b) });
  }

  return {
    source: doc.source,
    filename: doc.filename,
    extractedAt: doc.extractedAt,
    blocks,
  };
}

