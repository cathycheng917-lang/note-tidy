import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

function isLikelyTitle(line: string) {
  const s = line.trim();
  if (!s) return false;
  if (/^#{1,6}\s+\S/.test(s)) return true;
  if (/^第[一二三四五六七八九十0-9]+[章节篇部分]\b/.test(s)) return true;
  if (s.length >= 2 && s.length <= 18 && !/[。！？；;.!?]$/.test(s) && !/[，,]/.test(s)) return true;
  return false;
}

function isListLine(line: string) {
  const s = line.trim();
  if (!s) return false;
  return (
    /^[-*•·]\s+\S/.test(s) ||
    /^(\d{1,3})[.)]\s+\S/.test(s) ||
    /^\((\d{1,3})\)\s+\S/.test(s) ||
    /^([一二三四五六七八九十]{1,3})、\s*\S/.test(s) ||
    /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*\S/.test(s)
  );
}

/**
 * 功能二：自动整理版 Word 下载
 * - 不追求保留原 Word 格式
 * - 用简单稳妥的排版：标题明显、段落分明、列表用缩进
 */
export async function buildOrganizedDocxBlob(finalNote: string): Promise<Blob> {
  const lines = String(finalNote ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const children: Paragraph[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      children.push(new Paragraph({}));
      continue;
    }

    if (isLikelyTitle(line)) {
      const title = line.replace(/^#{1,6}\s+/, "");
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: title, bold: true })],
        })
      );
      continue;
    }

    if (isListLine(line)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line })],
          indent: { left: 720 },
        })
      );
      continue;
    }

    children.push(new Paragraph({ children: [new TextRun({ text: line })] }));
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

