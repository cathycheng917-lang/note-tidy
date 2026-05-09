export type DocumentBlock =
  | {
      type: "text";
      order: number;
      text: string;
    }
  | {
      type: "image";
      order: number;
      src: string;
      contentType?: string;
      ocrText?: string;
    };

export type ImportedDocxDocument = {
  source: "docx";
  filename: string;
  extractedAt: string; // ISO string
  blocks: DocumentBlock[];
};

export type ClassifiedBlock =
  | { type: "title"; order: number; text: string }
  | { type: "text"; order: number; text: string }
  | { type: "list"; order: number; items: string[] }
  | { type: "image"; order: number; src: string; contentType?: string }
  | { type: "ocr"; order: number; text: string }
  | { type: "unknown"; order: number; raw: string };

export type ClassifiedDocument = {
  source: ImportedDocxDocument["source"];
  filename: string;
  extractedAt: string;
  blocks: ClassifiedBlock[];
};

function normalizeText(s: string) {
  const text = String(s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // 把多余空白压一下，避免 DOM textContent 产生很碎的空格/换行
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function shouldSkipText(text: string) {
  return !text || !text.trim();
}

export function buildDocumentModelFromMammothHtml(input: {
  html: string;
  filename: string;
  images: Array<{ src: string; contentType: string }>;
  ocrBySrc: Map<string, string>;
}): ImportedDocxDocument {
  const { html, filename, images, ocrBySrc } = input;

  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html ?? ""), "text/html");
  const body = doc.body;

  const contentTypeBySrc = new Map(images.map((i) => [i.src, i.contentType]));

  const blocks: DocumentBlock[] = [];
  let order = 0;

  let textBuffer = "";
  const flushText = () => {
    const normalized = normalizeText(textBuffer);
    if (!shouldSkipText(normalized)) {
      blocks.push({ type: "text", order: order++, text: normalized + "\n" });
    }
    textBuffer = "";
  };

  const appendText = (t: string) => {
    const s = String(t ?? "");
    if (!s) return;
    textBuffer += s;
  };

  // 目标：保留顺序，且尽量稳妥
  // - 遇到 <img>：flush text，然后输出 image block
  // - 遇到块级元素末尾：加换行，避免段落粘一起
  const BLOCK_END_TAGS = new Set([
    "P",
    "DIV",
    "SECTION",
    "ARTICLE",
    "HEADER",
    "FOOTER",
    "LI",
    "UL",
    "OL",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "TABLE",
    "TR",
    "TD",
    "TH",
    "PRE",
    "BLOCKQUOTE",
  ]);

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText((node as Text).data);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    if (el.tagName === "IMG") {
      const src = el.getAttribute("src") ?? "";
      if (!src) return;
      flushText();
      blocks.push({
        type: "image",
        order: order++,
        src,
        contentType: contentTypeBySrc.get(src),
        ocrText: ocrBySrc.get(src) ?? "",
      });
      return;
    }

    if (el.tagName === "BR") {
      appendText("\n");
      return;
    }

    // 深度优先遍历子节点
    const children = Array.from(el.childNodes);
    for (const c of children) walk(c);

    if (BLOCK_END_TAGS.has(el.tagName)) {
      appendText("\n");
    }
  };

  const bodyChildren = Array.from(body.childNodes);
  for (const c of bodyChildren) walk(c);
  flushText();

  return {
    source: "docx",
    filename,
    extractedAt: new Date().toISOString(),
    blocks,
  };
}
