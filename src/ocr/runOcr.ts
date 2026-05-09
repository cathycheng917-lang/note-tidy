export type OcrLanguage = "eng" | "chi_sim" | "eng+chi_sim" | "chi_sim+eng";

export type OcrImageResult = {
  text: string;
  error?: string;
};

export type RunOcrOptions = {
  lang?: OcrLanguage;
  onProgress?: (p: { index: number; progress: number; status?: string }) => void;
  timeoutMs?: number;
};

async function ocrViaApi(imageBase64: string, lang: OcrLanguage, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, lang }),
    signal: controller.signal,
  });
  clearTimeout(t);

  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok || !data?.success) {
    const msg = String(data?.error ?? `HTTP ${res.status}`);
    console.error("[OCR API] failed:", { status: res.status, body: data });
    throw new Error(msg);
  }
  return String(data.text ?? "");
}

export async function runOcrOnImages(
  images: Array<{ src: string }>,
  options?: RunOcrOptions
): Promise<OcrImageResult[]> {
  const lang: OcrLanguage = options?.lang ?? "eng+chi_sim";
  const timeoutMs = options?.timeoutMs ?? 30000;
  const results: OcrImageResult[] = images.map(() => ({ text: "" }));

  for (let i = 0; i < images.length; i++) {
    options?.onProgress?.({ index: i, progress: 0, status: "starting" });
    try {
      options?.onProgress?.({ index: i, progress: 0.2, status: "uploading" });
      console.log("[OCR] request start", { index: i, lang, timeoutMs });
      const text = await ocrViaApi(images[i].src, lang, timeoutMs);
      console.log("[OCR] request done", { index: i, textLen: String(text ?? "").length });
      const cleaned = String(text ?? "").trim();
      results[i] = { text: cleaned ? String(text) : "" };
      options?.onProgress?.({ index: i, progress: 1, status: "done" });
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "AbortError"
          ? `请求超时（>${Math.round(timeoutMs / 1000)}s），请确认后端已启动且可访问 /api/ocr`
          : err instanceof Error
            ? err.message
            : "OCR 失败：未知错误。";
      results[i] = { text: "", error: `OCR 失败：${message}` };
      options?.onProgress?.({ index: i, progress: 1, status: "error" });
    }
  }

  return results;
}
