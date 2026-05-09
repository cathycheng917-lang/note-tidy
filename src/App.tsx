import React, { useMemo, useRef, useState } from "react";
import { extractDocxContent, type ExtractedDocxImage } from "./docx/extractDocxText";
import { runOcrOnImages } from "./ocr/runOcr";
import type { OcrImageResult } from "./ocr/runOcr";
import {
  buildDocumentModelFromMammothHtml,
  type ImportedDocxDocument,
} from "./model/documentModel";
import { classifyImportedDocxDocument } from "./model/classifyDocument";
import { classifiedDocumentToPlainText } from "./organize/fromClassified";
import { organizeNote } from "./organize/organizeNote";
import {
  buildDocumentBlocksFromMammothHtml,
  documentBlocksToMergedText,
  documentBlocksToTextWithImageMarkers,
  applyTextEditsToBlocks,
  type DocumentBlock,
} from "./model/documentBlocks";
import { buildOcrReplacedDocxBlob } from "./docx/exportOcrReplacedDocx";
import { buildOrganizedDocxBlob } from "./docx/exportOrganizedDocx";
import { downloadBlob } from "./docx/download";

function countChars(text: string) {
  return text.length;
}

type ImageWithOcr = ExtractedDocxImage & {
  ocrText?: string;
  ocrError?: string;
  ocrProgress?: number; // 0..1
  ocrStatus?: "pending" | "running" | "done" | "error";
};

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [rawText, setRawText] = useState<string>("");
  const [extractedText, setExtractedText] = useState<string>("");
  const [extractedImages, setExtractedImages] = useState<ImageWithOcr[]>([]);
  const [statusText, setStatusText] = useState<string>("就绪");
  const [mergedDocument, setMergedDocument] = useState<ImportedDocxDocument | null>(null);
  const [organizedText, setOrganizedText] = useState<string>("");
  const [outputSource, setOutputSource] = useState<"docx" | "text">("docx");
  const [docxOrganizeInput, setDocxOrganizeInput] = useState<string>("");
  const [documentBlocks, setDocumentBlocks] = useState<DocumentBlock[]>([]);
  const [mergedText, setMergedText] = useState<string>("");
  const [ocrResultsDebug, setOcrResultsDebug] = useState<OcrImageResult[]>([]);
  const [textModeInputDebug, setTextModeInputDebug] = useState<string>("");
  const [originalDocx, setOriginalDocx] = useState<{ filename: string; arrayBuffer: ArrayBuffer } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [step, setStep] = useState<
    | "idle"
    | "picked"
    | "parsing"
    | "text_extracted"
    | "images_extracted"
    | "ocr_running"
    | "ocr_done"
    | "organized"
    | "failed"
  >("idle");

  function setStepStatus(next: typeof step, message: string) {
    console.log("[flow]", next, message);
    setStep(next);
    setStatusText(message);
  }

  const counts = useMemo(() => {
    return {
      raw: countChars(rawText),
      extracted: countChars(extractedText),
      organized: countChars(organizedText),
    };
  }, [rawText, extractedText, organizedText]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setStepStatus("picked", `已选择文件：${file.name}`);
    setIsLoading(true);

    try {
      setStepStatus("parsing", "正在解析 Word…");
      const { text, images, html, arrayBuffer } = await extractDocxContent(file);
      setOriginalDocx({ filename: file.name, arrayBuffer });
      console.log("[flow] extractDocxContent ok", {
        textLen: text.length,
        imageCount: images.length,
        htmlLen: html.length,
      });
      setExtractedText(text);
      setExtractedImages(
        images.map((img) => ({
          ...img,
          ocrText: "",
          ocrError: "",
          ocrProgress: 0,
          ocrStatus: "pending",
        }))
      );
      setRawText(text);
      setStepStatus("text_extracted", `已提取文字（${text.length} 字）`);
      setStepStatus("images_extracted", `已提取图片（${images.length} 张）`);

      const ocrBySrc = new Map<string, string>();
      const ocrErrorBySrc = new Map<string, string>();

      // 先生成“按原文顺序”的 blocks（OCR 为空占位），用于调试和后续回填
      const initialBlocks = buildDocumentBlocksFromMammothHtml({
        html,
        images,
        ocrBySrc,
        ocrErrorBySrc,
      });
      setDocumentBlocks(initialBlocks);
      const initialMerged = documentBlocksToMergedText(initialBlocks);
      setMergedText(initialMerged);

      // OCR：逐张识别并回填结果
      if (images.length > 0) {
        setStepStatus("ocr_running", "正在 OCR…（调用本地后端 /api/ocr）");

        // 明确检查后端是否可访问，避免“卡住但无报错”
        try {
          const health = await fetch("/api/health");
          if (!health.ok) {
            throw new Error(`后端不可用：/api/health HTTP ${health.status}`);
          }
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : "后端不可用：无法访问 /api/health。";
          throw new Error(
            `${msg}\n请在项目目录执行：npm run dev（需同时启动 server 与 client）。`
          );
        }

        setExtractedImages((prev) =>
          prev.map((img) => ({ ...img, ocrStatus: "running", ocrProgress: 0 }))
        );

        const ocrResults = await runOcrOnImages(images, {
          // 笔记场景优先中英混合
          lang: "chi_sim+eng",
          timeoutMs: 60000,
          onProgress: ({ index, progress }) => {
            setExtractedImages((prev) =>
              prev.map((img, i) =>
                i === index ? { ...img, ocrProgress: progress, ocrStatus: "running" } : img
              )
            );
          },
        });
        setOcrResultsDebug(ocrResults);

        setExtractedImages((prev) =>
          prev.map((img, i) => {
            const r = ocrResults[i];
            if (!r) return img;
            if (r.error) {
              ocrErrorBySrc.set(img.src, r.error);
              return { ...img, ocrError: r.error, ocrStatus: "error", ocrProgress: 1 };
            }
            ocrBySrc.set(img.src, r.text);
            const cleaned = (r.text ?? "").trim();
            return {
              ...img,
              ocrText: cleaned ? r.text : "（未识别到文字）\n",
              ocrStatus: "done",
              ocrProgress: 1,
            };
          })
        );
        setStepStatus("ocr_done", "OCR 完成");

        // 关键：把 OCR 结果“写回 image block”，不依赖 src 是否完全一致，按图片出现顺序回填。
        // 这能确保最终 mergedText 一定能读到 imageBlock.ocrText。
        setDocumentBlocks((prevBlocks) => {
          const imgBlocks = prevBlocks.filter((b) => b.type === "image");
          const byId = new Map(prevBlocks.map((b) => [b.id, b] as const));
          imgBlocks.forEach((b, idx) => {
            const r = ocrResults[idx];
            if (!r) return;
            const next: DocumentBlock =
              r.error
                ? { ...b, ocrText: "", ocrError: r.error }
                : { ...b, ocrText: r.text, ocrError: "" };
            byId.set(b.id, next);
          });
          const nextBlocks = prevBlocks.map((b) => byId.get(b.id) ?? b);
          const nextMerged = documentBlocksToMergedText(nextBlocks);
          setMergedText(nextMerged);
          setDocxOrganizeInput(nextMerged);
          // 实时刷新 finalNote：docx 用 mergedText；text 用 rawText + OCR 追加
          if (outputSource !== "text") setOrganizedText(organizeNote(nextMerged));
          return nextBlocks;
        });
      }

      setStepStatus("organized", "正在按原文顺序整合 OCR 并整理输出…");

      // 关键：不要在这里重新 build blocks（会生成新的 id，导致 text 模式 marker 无法匹配）。
      // 我们只在 OCR 阶段把结果写回已有的 image blocks，并据此生成 mergedText -> finalNote。
      //
      // 这里用“最新 blocks”生成最终 mergedText：优先取 state（已在 OCR 回填时更新），兜底用 initialBlocks。
      const finalBlocks = documentBlocks.length ? documentBlocks : initialBlocks;
      const mergedTextNext = documentBlocksToMergedText(finalBlocks);
      setMergedText(mergedTextNext);
      setDocxOrganizeInput(mergedTextNext);
      setOutputSource("docx");
      setOrganizedText(organizeNote(mergedTextNext));

      // 保留旧的结构化对象（兼容原逻辑），但最终整理输入以 mergedText 为准
      const merged = buildDocumentModelFromMammothHtml({
        html,
        filename: file.name,
        images,
        ocrBySrc,
      });
      setMergedDocument(merged);

      setStepStatus("organized", `整理完成：${file.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "导入失败：未知错误。";
      console.error("[flow] failed", err);
      setError(message);
      setStepStatus("failed", "失败（请查看错误提示/Console）");
      setExtractedText("");
      setExtractedImages([]);
      setMergedDocument(null);
      setOrganizedText("");
      setDocxOrganizeInput("");
      setDocumentBlocks([]);
      setMergedText("");
      setOcrResultsDebug([]);
    } finally {
      setIsLoading(false);
      // 允许重复选择同一个文件也触发 change
      e.target.value = "";
    }
  }

  function onClickUpload() {
    fileInputRef.current?.click();
  }

  function onClear() {
    if (isLoading) return;
    setError("");
    setStepStatus("idle", "就绪");
    setRawText("");
    setExtractedText("");
    setExtractedImages([]);
    setMergedDocument(null);
    setOrganizedText("");
    setDocxOrganizeInput("");
    setDocumentBlocks([]);
    setMergedText("");
    setOcrResultsDebug([]);
    setTextModeInputDebug("");
    setOriginalDocx(null);
  }

  function setAndRunOutputSource(next: "docx" | "text") {
    setOutputSource(next);
    if (next === "text") {
      // text 模式：把用户编辑后的文本（含 IMAGE marker）应用回 blocks，然后按原顺序生成 mergedText
      const markerText = documentBlocksToTextWithImageMarkers(documentBlocks);
      const hasMarker = rawText.includes("[[[IMAGE:");
      const editedText = hasMarker ? rawText : markerText;
      // 第一次进入 text 模式时，自动把文字区切换到“带图片占位符”的可编辑文本，确保能保持原位置
      if (!hasMarker) setRawText(markerText);
      const editedBlocks = applyTextEditsToBlocks({ blocks: documentBlocks, editedText });
      setDocumentBlocks(editedBlocks);
      const nextMerged = documentBlocksToMergedText(editedBlocks);
      setMergedText(nextMerged);
      setTextModeInputDebug(nextMerged);
      setOrganizedText(organizeNote(nextMerged));
      return;
    }
    const input = docxOrganizeInput;
    setOrganizedText(organizeNote(input));
  }

  function onEditOcrText(index: number, nextText: string) {
    // UI 允许用户手动修正 OCR；不改变流程，只更新已有数据并重新计算 mergedText/finalNote
    setExtractedImages((prev) => prev.map((img, i) => (i === index ? { ...img, ocrText: nextText } : img)));

    setDocumentBlocks((prevBlocks) => {
      const imageBlocks = prevBlocks.filter((b) => b.type === "image");
      const target = imageBlocks[index];
      if (!target) return prevBlocks;

      const nextBlocks = prevBlocks.map((b) =>
        b.id === target.id ? { ...b, ocrText: nextText, ocrError: "" } : b
      );

      const nextMerged = documentBlocksToMergedText(nextBlocks);
      setMergedText(nextMerged);
      setDocxOrganizeInput(nextMerged);
      if (outputSource !== "text") setOrganizedText(organizeNote(nextMerged));
      return nextBlocks;
    });
  }

  const isOcrFinished = useMemo(() => {
    if (!originalDocx) return false;
    if (extractedImages.length === 0) return true;
    return extractedImages.every((img) => img.ocrStatus === "done" || img.ocrStatus === "error");
  }, [extractedImages, originalDocx]);

  async function onDownloadOcrReplacedDocx() {
    if (!originalDocx) return;
    if (!isOcrFinished) return;
    setError("");
    setIsDownloading(true);
    try {
      const blob = await buildOcrReplacedDocxBlob({
        originalArrayBuffer: originalDocx.arrayBuffer,
        imagesInOrder: extractedImages.map((img) => ({ ocrText: img.ocrText, ocrError: img.ocrError })),
      });
      const base = originalDocx.filename.replace(/\.docx$/i, "");
      downloadBlob(`${base}-ocr替换版.docx`, blob);
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成 Word 失败：未知错误。";
      console.error("[download] ocr-replaced failed", err);
      setError(message);
    } finally {
      setIsDownloading(false);
    }
  }

  async function onDownloadOrganizedDocx() {
    if (!originalDocx) return;
    if (!isOcrFinished) return;
    setError("");
    setIsDownloading(true);
    try {
      const blob = await buildOrganizedDocxBlob(organizedText);
      const base = originalDocx.filename.replace(/\.docx$/i, "");
      downloadBlob(`${base}-自动整理版.docx`, blob);
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成 Word 失败：未知错误。";
      console.error("[download] organized failed", err);
      setError(message);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <h1 className="title">Word 笔记整理</h1>
        </div>
        <div className="actions">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={onPickFile}
            disabled={isLoading}
          />
          <button
            className="btn btn-primary"
            type="button"
            onClick={onClickUpload}
            disabled={isLoading}
            data-loading={isLoading ? "true" : "false"}
          >
            上传 .docx
          </button>
          <button className="btn" type="button" onClick={onClear} disabled={isLoading}>
            清空
          </button>
        </div>
      </header>

      <main className="page">
        <section className="card">
          <div className="cardHeader">
            <div>
              <h2 className="cardTitle">上传区域</h2>
            </div>
            <div className="pillRow">
              <span className="pill">{isLoading ? "处理中…" : "就绪"}</span>
              <span className="pill">步骤 {step}</span>
              <span className="pill">图片 {extractedImages.length} 张</span>
              <span className="pill">原文 {counts.raw} 字</span>
              <span className="pill">输出 {counts.organized} 字</span>
            </div>
          </div>
          <div className="notice" data-visible={error ? "true" : "false"} role="status">
            {error}
          </div>
          <div className="statusLine">
            <span className="statusLabel">状态：</span>
            <span className="statusValue">{statusText}</span>
          </div>
        </section>

        <section className="twoCol">
          <section className="card">
            <div className="cardHeader">
              <div>
                <h2 className="cardTitle">文字提取区域</h2>
              </div>
              <div className="pillRow">
                <span className="pill">{counts.raw} 字</span>
              </div>
            </div>
            <label className="sr-only" htmlFor="raw">
              原始文字
            </label>
            <textarea
              id="raw"
              className="textarea"
              value={rawText}
              onChange={(e) => {
                const v = e.target.value;
                setRawText(v);
                if (outputSource === "text") return;
              }}
              placeholder="上传 .docx 后这里会出现原始文字，也可以手动粘贴。"
              spellCheck={false}
            />
          </section>

          <section className="card">
            <div className="cardHeader">
              <div>
                <h2 className="cardTitle">图片提取区域</h2>
              </div>
              <div className="pillRow">
                <span className="pill">{extractedImages.length} 张</span>
              </div>
            </div>
            {extractedImages.length === 0 ? (
              <div className="empty">暂无图片（或文档未嵌入图片）。</div>
            ) : (
              <div className="imagesPanel">
                {extractedImages.map((img, idx) => (
                  <figure className="imgRow" key={`${img.contentType}-${idx}`}>
                    <img className="imgThumb" src={img.src} alt={`图片 ${idx + 1}`} />
                    <div className="imgMeta">
                      <div className="imgMetaTop">
                        <div className="imgMetaTitle">
                          图片 #{idx + 1}
                          <span className="imgMetaType">{img.contentType}</span>
                        </div>
                        <div className="imgMetaRight">
                          {img.ocrStatus === "running" ? (
                            <span className="pill">{Math.round((img.ocrProgress ?? 0) * 100)}%</span>
                          ) : img.ocrStatus === "done" ? (
                            <span className="pill">OCR 完成</span>
                          ) : img.ocrStatus === "error" ? (
                            <span className="pill pillError">OCR 失败</span>
                          ) : (
                            <span className="pill">等待</span>
                          )}
                        </div>
                      </div>

                      {img.ocrError ? (
                        <div className="ocrError">{img.ocrError}</div>
                      ) : (
                        <textarea
                          className="ocrText"
                          value={img.ocrText ?? ""}
                          onChange={(e) => onEditOcrText(idx, e.target.value)}
                          placeholder="OCR 结果（可编辑修正）…"
                          spellCheck={false}
                        />
                      )}
                    </div>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="card">
          <div className="cardHeader">
            <div>
              <h2 className="cardTitle">输出界面</h2>
            </div>
            <div className="pillRow">
              <button className="btn" type="button" onClick={() => setAndRunOutputSource("text")} disabled={isLoading}>
                用文字区域
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={onDownloadOcrReplacedDocx}
                disabled={!originalDocx || !isOcrFinished || isLoading || isDownloading}
              >
                下载 OCR 替换版 Word
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={onDownloadOrganizedDocx}
                disabled={!originalDocx || !isOcrFinished || isLoading || isDownloading}
              >
                下载自动整理版 Word
              </button>
              <span className="pill">输出 {counts.organized} 字</span>
            </div>
          </div>
          <textarea
            className="finalOutput"
            value={organizedText}
            readOnly
            placeholder="上传并处理完成后，这里会显示最终整理结果。"
            spellCheck={false}
          />
        </section>
        <section className="card">
          <div className="cardHeader">
            <div>
              <h2 className="cardTitle">调试区（顺序整合）</h2>
              <p className="cardHint">
                用于核对：blocks 顺序、每张图片 order/OCR、mergedText、finalNote。若顺序不准，属于“尽力还原”的近似结果。
              </p>
            </div>
          </div>
          <details>
            <summary>展开查看</summary>
            <pre className="debugPre">{JSON.stringify(documentBlocks, null, 2)}</pre>
            <h3 className="debugTitle">ocrResults</h3>
            <pre className="debugPre">{JSON.stringify(ocrResultsDebug, null, 2)}</pre>
            <h3 className="debugTitle">图片 order / OCR</h3>
            <pre className="debugPre">
              {JSON.stringify(
                documentBlocks
                  .filter((b) => b.type === "image")
                  .map((b) => ({
                    order: b.order,
                    imageSrcPrefix: (b.imageSrc ?? "").slice(0, 48) + "...",
                    ocrTextPreview: (b.ocrText ?? "").slice(0, 80),
                    ocrError: b.ocrError ?? "",
                  })),
                null,
                2
              )}
            </pre>
            <h3 className="debugTitle">mergedText</h3>
            <pre className="debugPre">{mergedText}</pre>
            <h3 className="debugTitle">textModeInput</h3>
            <pre className="debugPre">{textModeInputDebug}</pre>
            <h3 className="debugTitle">finalNote</h3>
            <pre className="debugPre">{organizedText}</pre>
          </details>
        </section>
      </main>
    </>
  );
}
