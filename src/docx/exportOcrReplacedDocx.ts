import JSZip from "jszip";

type ImageOcrInput = {
  ocrText?: string;
  ocrError?: string;
};

function getReplacementText(img?: ImageOcrInput): string {
  if (!img) return "[图片无可识别文字]";
  const err = String(img.ocrError ?? "").trim();
  if (err) return "[图片文字识别失败]";
  const t = String(img.ocrText ?? "").trim();
  if (!t) return "[图片无可识别文字]";
  return t;
}

function isImageNodeTag(tagName: string) {
  return tagName === "w:drawing" || tagName === "w:pict";
}

function findAncestor(el: Element, tagName: string): Element | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur.tagName === tagName) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function replaceImageNodeWithTextRun(args: { xmlDoc: XMLDocument; imageNode: Element; text: string }) {
  const { xmlDoc, imageNode, text } = args;
  const run = findAncestor(imageNode, "w:r");
  if (!run) return;

  // 保留 run 的样式（w:rPr），删除其他内容（包含 drawing/pict）
  const children = Array.from(run.childNodes);
  for (const c of children) {
    if (c.nodeType === Node.ELEMENT_NODE && (c as Element).tagName === "w:rPr") continue;
    run.removeChild(c);
  }

  const lines = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0) {
      const br = xmlDoc.createElement("w:br");
      run.appendChild(br);
    }
    const tEl = xmlDoc.createElement("w:t");
    // 保留空格
    tEl.setAttribute("xml:space", "preserve");
    tEl.textContent = line;
    run.appendChild(tEl);
  }
}

/**
 * 功能一：原格式替换版 Word 下载（尽力保留格式）
 *
 * 实现说明（限制）：
 * - 我们直接修改 docx 的 `word/document.xml`，按 XML 中图片节点出现顺序替换为 OCR 文本。
 * - 仅替换图片节点所在的 run 内容，保留段落/样式/编号等其余结构。
 * - 不清理 media/rels：图片文件仍会留在包里但不再被引用（不影响 Word 打开）。
 * - 对于复杂排版（浮动锚点/文本框/页眉页脚/表格内图片），顺序可能存在偏差，但不会把 OCR 统一追加到文末。
 */
export async function buildOcrReplacedDocxBlob(args: {
  originalArrayBuffer: ArrayBuffer;
  imagesInOrder: ImageOcrInput[];
}): Promise<Blob> {
  const { originalArrayBuffer, imagesInOrder } = args;

  const zip = await JSZip.loadAsync(originalArrayBuffer);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("生成失败：未找到 word/document.xml（不是标准 .docx？）");

  const xml = await docXmlFile.async("string");
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xml, "application/xml");

  // 尽力按出现顺序遍历所有图片节点（drawing / pict）
  const walker = xmlDoc.createTreeWalker(xmlDoc, NodeFilter.SHOW_ELEMENT);
  const imageNodes: Element[] = [];
  let n = walker.nextNode();
  while (n) {
    const el = n as Element;
    if (isImageNodeTag(el.tagName)) imageNodes.push(el);
    n = walker.nextNode();
  }

  for (let i = 0; i < imageNodes.length; i++) {
    const text = getReplacementText(imagesInOrder[i]);
    replaceImageNodeWithTextRun({ xmlDoc, imageNode: imageNodes[i], text });
  }

  const outXml = new XMLSerializer().serializeToString(xmlDoc);
  zip.file("word/document.xml", outXml);
  return zip.generateAsync({ type: "blob" });
}

