import type { ClassifiedDocument } from "../model/documentModel";

export function classifiedDocumentToPlainText(doc: ClassifiedDocument) {
  const chunks: string[] = [];

  for (const b of doc.blocks) {
    if (b.type === "title") {
      chunks.push(String(b.text ?? "").trimEnd());
      chunks.push("");
      continue;
    }
    if (b.type === "text") {
      chunks.push(String(b.text ?? "").trimEnd());
      chunks.push("");
      continue;
    }
    if (b.type === "list") {
      for (const item of b.items ?? []) chunks.push(String(item ?? "").trimEnd());
      chunks.push("");
      continue;
    }
    if (b.type === "ocr") {
      const t = String(b.text ?? "").trim();
      if (t) {
        chunks.push(t);
        chunks.push("");
      }
      continue;
    }
    // image/unknown：不转成文本（避免插入占位符改变原意）
  }

  const text = chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? text + "\n" : "";
}

