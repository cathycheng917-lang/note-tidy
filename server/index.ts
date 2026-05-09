import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOcr } from "./ocr.js";

process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection:", reason);
});

process.on("uncaughtException", (err) => {
  // 不静默：打印完整堆栈，但不要立刻退出进程（避免出现 curl: Empty reply from server）
  // 进程可能处于不稳定状态；此时建议手动重启服务以恢复。
  console.error("[server] uncaughtException:", err?.stack ?? err);
});

const app = express();
const upload = multer({ limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "20mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === "production";

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// POST /api/ocr
// - multipart/form-data: field "file"
// - or JSON: { imageBase64: "data:image/png;base64,..." | "<base64>", lang?: "eng"|"chi_sim"|"eng+chi_sim"|"chi_sim+eng" }
app.post("/api/ocr", upload.single("file"), async (req, res) => {
  console.log("[API] /api/ocr request", {
    hasFile: Boolean(req.file),
    hasBase64: Boolean((req.body as any)?.imageBase64),
    lang: (req.body as any)?.lang,
  });
  // 避免空响应：确保异常情况下也能返回 JSON
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const langRaw = String((req.body as any)?.lang ?? "eng+chi_sim");
    const lang =
      langRaw === "eng" || langRaw === "chi_sim" || langRaw === "eng+chi_sim" || langRaw === "chi_sim+eng"
        ? langRaw
        : "eng+chi_sim";

    let imageBuffer: Buffer | null = null;

    if (req.file?.buffer?.length) {
      imageBuffer = req.file.buffer;
    } else if ((req.body as any)?.imageBase64) {
      const raw = String((req.body as any).imageBase64);
      const base64 = raw.includes("base64,") ? raw.slice(raw.indexOf("base64,") + "base64,".length) : raw;
      imageBuffer = Buffer.from(base64, "base64");
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "缺少图片：请用 multipart(file) 或 JSON(imageBase64) 传入。" });
    }

    const text = await runOcr(imageBuffer, { lang });
    console.log("[API] /api/ocr done", { textLen: text.length });
    res.json({ success: true, text });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "OCR 失败：未知错误。";
    console.error("[API] /api/ocr failed:", err instanceof Error ? err.stack : err);
    if (!res.headersSent) res.status(500).json({ success: false, error: `OCR 失败：${message}` });
  }
});

const port = Number(process.env.PORT ?? 5174);
const host = process.env.HOST ?? (isProd ? "0.0.0.0" : "127.0.0.1");

// Production: serve built frontend from /dist (Vite build output).
// This keeps a single service that serves both UI and /api/* on Render.
if (isProd) {
  const distDir = path.resolve(__dirname, "../dist");
  console.log("[server] serving static dist from", distDir);
  app.use(express.static(distDir));
  // SPA fallback: for non-API routes, return index.html
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

const server = app.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
});

server.on("error", (err: any) => {
  // 不允许静默失败：必须打印完整堆栈
  console.error("[server] listen error:", err?.stack ?? err);
  process.exit(1);
});
