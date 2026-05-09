import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "tesseract.js";

export type OcrLanguage = "eng" | "chi_sim" | "eng+chi_sim" | "chi_sim+eng";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 语言包放在本地，避免任何 CDN / 网络依赖
// 需要把 eng.traineddata / chi_sim.traineddata 放到 server/tessdata
const LANG_PATH = path.join(__dirname, "tessdata");

function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

type WorkerLike = {
  load?: (jobId?: string) => Promise<any>;
  loadLanguage?: (langs: any, jobId?: string) => Promise<any>;
  initialize?: (langs: any, oem?: any, config?: any, jobId?: string) => Promise<any>;
  reinitialize?: (langs?: any, oem?: any, config?: any, jobId?: string) => Promise<any>;
  recognize: (image: any, opts?: any, output?: any, jobId?: string) => Promise<any>;
  terminate: (jobId?: string) => Promise<any>;
};

async function createFreshWorker(lang: OcrLanguage): Promise<WorkerLike> {
  // tesseract.js v4 与 v5 的 createWorker 签名不同；这里用“最保守”的方式：
  // - 不传 logger / errorHandler（Node structured clone 会因函数报错）
  // - 强制 gzip=false，匹配我们本地非 .gz traineddata 文件
  //
  // v4: createWorker(options)
  // v5: createWorker(langs?, oem?, options?, config?)
  //
  // 这里通过“先尝试 v5 调用形态，再回退 v4 调用形态”的方式兼容。
  let worker: WorkerLike;
  try {
    worker = (await (createWorker as any)("eng", undefined, { langPath: LANG_PATH, gzip: false, logging: false })) as WorkerLike;
  } catch {
    worker = (createWorker as any)({ langPath: LANG_PATH, gzip: false, logger: undefined, errorHandler: undefined }) as WorkerLike;
  }

  // v4 需要显式 load/loadLanguage/initialize；v5 会在 createWorker 内部完成 load，并暴露 reinitialize。
  if (typeof worker.load === "function") {
    await worker.load();
  }
  if (typeof worker.loadLanguage === "function" && typeof worker.initialize === "function") {
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
  } else if (typeof worker.reinitialize === "function") {
    await worker.reinitialize(lang);
  }

  return worker;
}

export async function runOcr(image: Buffer, opts?: { lang?: OcrLanguage }): Promise<string> {
  const lang: OcrLanguage = opts?.lang ?? "eng+chi_sim";
  let worker: WorkerLike | null = null;

  try {
    worker = await createFreshWorker(lang);
    const result = await worker.recognize(image);
    const text = result?.data?.text ?? result?.data?.data?.text ?? result?.text ?? "";
    return String(text ?? "");
  } catch (err) {
    const e = normalizeError(err);
    console.error("[ocr] failed:", e.stack ?? e.message);
    throw e;
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (err) {
        const e = normalizeError(err);
        console.error("[ocr] terminate failed:", e.stack ?? e.message);
      }
    }
  }
}

