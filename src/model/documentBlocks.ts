export type DocumentBlock = {
  id: string;
  type: "text" | "image";
  order: number;
  content?: string;
  imageSrc?: string;
  ocrText?: string;
  ocrError?: string;
};

function makeId(prefix: string) {
  // 浏览器环境：优先用 crypto.randomUUID；否则退化成时间戳+随机数
  try {
    if (typeof globalThis !== "undefined") {
      const c = (globalThis as any).crypto;
      if (c && typeof c.randomUUID === "function") return `${prefix}_${c.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeText(s: string) {
  const text = String(s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // 把多余空白压一下，避免 DOM textContent 产生很碎的空格/换行
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function shouldSkipText(text: string) {
  return !text || !text.trim();
}

/**
 * 基于 mammoth 生成的 HTML 做“尽力还原”的顺序 blocks：
 * - 文字与图片按 DOM 出现顺序交错
 * - 图片位置来自 <img> 标签出现顺序（属于近似定位，但通常能较好反映 Word 阅读顺序）
 *
 * 如果某些 Word 复杂排版（表格、浮动图等）导致顺序不精确，仍保证：
 * - 不会把所有 OCR 统一追加到文末
 * - 图片 OCR 会插入到与该图片相邻的段落位置附近
 */
export function buildDocumentBlocksFromMammothHtml(input: {
  html: string;
  images: Array<{ src: string; contentType: string }>;
  ocrBySrc?: Map<string, string>;
  ocrErrorBySrc?: Map<string, string>;
}): DocumentBlock[] {
  const { html, images, ocrBySrc, ocrErrorBySrc } = input;

  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html ?? ""), "text/html");
  const body = doc.body;

  const knownSrc = new Set(images.map((i) => i.src));
  const imageIndexBySrc = new Map(images.map((img, idx) => [img.src, idx] as const));

  const blocks: DocumentBlock[] = [];
  let order = 1;
  let htmlImgSeen = 0;

  let textBuffer = "";
  const flushText = () => {
    const normalized = normalizeText(textBuffer);
    if (!shouldSkipText(normalized)) {
      blocks.push({
        id: makeId("t"),
        type: "text",
        order: order++,
        content: normalized + "\n",
      });
    }
    textBuffer = "";
  };

  const appendText = (t: string) => {
    const s = String(t ?? "");
    if (!s) return;
    textBuffer += s;
  };

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

      // mammoth 的 convertImage 会把图片转成 data URL；一般会与 images[] 里的 src 一致
      // 如果不一致也照样生成 block（仍可在调试区看到）
      flushText();
      // 优先用 src 精确匹配；如果遇到某些情况下 src 不一致（例如重复 base64 或 mammoth 输出差异），
      // 则退化为按 HTML <img> 出现顺序去匹配 images[]（尽力还原）。
      let ocrText = ocrBySrc?.get(src) ?? "";
      let ocrError = ocrErrorBySrc?.get(src) ?? "";
      if (!ocrText && !ocrError) {
        const idx = imageIndexBySrc.get(src);
        if (typeof idx === "number") {
          const canonicalSrc = images[idx]?.src ?? "";
          ocrText = (canonicalSrc && ocrBySrc?.get(canonicalSrc)) || "";
          ocrError = (canonicalSrc && ocrErrorBySrc?.get(canonicalSrc)) || "";
        } else {
          const fallback = images[htmlImgSeen]?.src ?? "";
          if (fallback) {
            ocrText = ocrBySrc?.get(fallback) ?? "";
            ocrError = ocrErrorBySrc?.get(fallback) ?? "";
          }
        }
      }
      blocks.push({
        id: makeId("i"),
        type: "image",
        order: order++,
        imageSrc: src,
        ocrText,
        ocrError,
      });
      htmlImgSeen++;
      return;
    }

    if (el.tagName === "BR") {
      appendText("\n");
      return;
    }

    const children = Array.from(el.childNodes);
    for (const c of children) walk(c);

    if (BLOCK_END_TAGS.has(el.tagName)) {
      appendText("\n");
    }
  };

  const bodyChildren = Array.from(body.childNodes);
  for (const c of bodyChildren) walk(c);
  flushText();

  // 补充：如果 HTML 里没有 img（或某些图片没被转成 <img>），仍保留 images 供 UI 展示
  // 但不在这里强行追加到文末（避免违背“不要统一追加到文末”的目标）。
  void knownSrc;

  return blocks.sort((a, b) => a.order - b.order);
}

export function documentBlocksToMergedText(blocks: DocumentBlock[]): string {
  const chunks: string[] = [];

  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  for (const b of sorted) {
    if (b.type === "text") {
      const t = String(b.content ?? "").trimEnd();
      if (t) chunks.push(t);
      chunks.push("");
      continue;
    }
    if (b.type === "image") {
      const ocrText = String(b.ocrText ?? "").trim();
      const ocrError = String(b.ocrError ?? "").trim();
      if (ocrError) {
        chunks.push(`[图片文字识别失败：${ocrError}]`);
        chunks.push("");
        continue;
      }
      if (ocrText) {
        chunks.push(ocrText);
        chunks.push("");
      }
      continue;
    }
  }

  const text = chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? text + "\n" : "";
}

export function documentBlocksToTextWithImageMarkers(blocks: DocumentBlock[]): string {
  const parts: string[] = [];
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  for (const b of sorted) {
    if (b.type === "text") {
      parts.push(String(b.content ?? "").trimEnd());
      parts.push("");
      continue;
    }
    if (b.type === "image") {
      parts.push(`[[[IMAGE:${b.id}]]]`);
      parts.push("");
      continue;
    }
  }
  const text = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? text + "\n" : "";
}

export function applyTextEditsToBlocks(args: { blocks: DocumentBlock[]; editedText: string }): DocumentBlock[] {
  const { blocks, editedText } = args;
  const sorted = [...blocks].sort((a, b) => a.order - b.order);

  // Split by markers, keep markers
  const tokens = String(editedText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/(\[\[\[IMAGE:[^\]]+\]\]\])/g);

  const next: DocumentBlock[] = [];
  let order = 1;

  for (const tok of tokens) {
    if (!tok) continue;
    const m = tok.match(/^\[\[\[IMAGE:(.+)\]\]\]$/);
    if (m) {
      const id = m[1];
      const img = sorted.find((b) => b.type === "image" && b.id === id);
      if (img && img.type === "image") {
        next.push({ ...img, order: order++ });
      }
      continue;
    }

    const t = tok.trim();
    if (!t) continue;
    next.push({
      id: `t_edit_${order}`,
      type: "text",
      order: order++,
      content: t + "\n",
    });
  }

  // Fallback: if user removed all markers, keep original image blocks order by appending them at end (least bad)
  const hasAnyImage = next.some((b) => b.type === "image");
  if (!hasAnyImage) {
    for (const b of sorted) {
      if (b.type === "image") next.push({ ...b, order: order++ });
    }
  }

  return next.sort((a, b) => a.order - b.order);
}
