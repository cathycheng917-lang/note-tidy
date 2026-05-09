import { convertToHtml, extractRawText, images as mammothImages } from "mammoth/mammoth.browser";

export type ExtractedDocxImage = {
  src: string;
  contentType: string;
};

export type ExtractDocxContentResult = {
  text: string;
  html: string;
  images: ExtractedDocxImage[];
  arrayBuffer: ArrayBuffer;
};

export async function extractDocxText(file: File): Promise<string> {
  const { text } = await extractDocxContent(file);
  return text;
}

export async function extractDocxContent(file: File): Promise<ExtractDocxContentResult> {
  const name = file?.name ?? "";
  if (!name.toLowerCase().endsWith(".docx")) {
    throw new Error("文件格式不正确：请上传 .docx 文件。");
  }

  const arrayBuffer = await file.arrayBuffer();
  return extractDocxContentFromArrayBuffer({ arrayBuffer, name });
}

export async function extractDocxContentFromArrayBuffer(input: {
  arrayBuffer: ArrayBuffer;
  name: string;
}): Promise<ExtractDocxContentResult> {
  const { arrayBuffer, name } = input;

  // 1) 提取“原始文字”（不做结构分类）
  const raw = await extractRawText({ arrayBuffer });
  const text = String(raw?.value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const normalizedText = text.trim() ? text.trim() + "\n" : "";

  // 2) 提取图片：用 mammoth 的 convertToHtml + convertImage，把图片读成 base64 data URL
  const collectedImages: ExtractedDocxImage[] = [];
  const htmlResult = await convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammothImages.inline(async (image) => {
        const base64 = await image.read("base64");
        const src = `data:${image.contentType};base64,${base64}`;
        collectedImages.push({ src, contentType: image.contentType });
        return { src };
      }),
    }
  );

  return { text: normalizedText, html: String(htmlResult?.value ?? ""), images: collectedImages, arrayBuffer };
}
