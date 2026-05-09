# Word 笔记整理（React + Node OCR）

一个面向大学生的笔记整理工具：
- 上传 `.docx` → 提取文字/图片 → 调用本地 OCR（`/api/ocr`）→ 将图片 OCR 文本按原顺序合并 → `organizeNote` 整理 → 输出结果
- 支持下载：
  - **OCR 替换版 Word**：在原 Word 图片位置替换为 OCR 文本（尽力保留原格式）
  - **自动整理版 Word**：对最终整理文本排版生成新的 `.docx`

## 环境要求（重要）

为避免 `tesseract.js` 在 Node 25 上不稳定，本项目**固定使用 Node 22.x（LTS）**：
- `package.json#engines.node`: `>=20 <=22`
- `.node-version`: `22`

## 本地运行

在项目目录：

```bash
cd /Users/gaolanhuicheng/Documents/notes/note-tidy-react
npm install
npm run dev
```

浏览器打开：
- `http://127.0.0.1:5173`

健康检查：
```bash
curl http://127.0.0.1:5174/api/health
```

## 构建（生产）

```bash
npm run build
```

产物：
- 前端：`dist/`
- 后端：`dist-server/`

## 生产启动（单进程同时提供前端与后端）

`npm start` 会启动 Express：
- 提供静态资源：`dist/`
- 提供 API：`/api/health`、`/api/ocr`

```bash
npm start
```

默认端口来自环境变量 `PORT`（没有则 5174）。

## OCR 语言包（必须）

项目使用本地语言包（无需 CDN）：
- `server/tessdata/eng.traineddata`
- `server/tessdata/chi_sim.traineddata`

仓库中应保留这两个文件；否则 `/api/ocr` 会失败。

## Render 部署

Render 创建一个 **Web Service（Node）**，仓库根目录指向本项目目录。

建议配置：
- **Environment**: Node
- **Node Version**: 22（若 Render 支持选择/填写）

### Build Command

```bash
npm install && npm run build
```

（有些 Render 环境会自动执行 `npm install`，你也可以只填 `npm run build`。）

### Start Command

```bash
npm start
```

### 端口

Render 会注入 `PORT` 环境变量；本项目会读取 `process.env.PORT`。

## 常见问题

### 1) `/api/ocr` 失败
- 确认 Node 版本是 22.x
- 确认 `server/tessdata/eng.traineddata` 与 `server/tessdata/chi_sim.traineddata` 存在

### 2) 为什么 OCR 替换版 Word 不能 100% 保留所有复杂格式？
实现是“尽力保留格式”的方案：直接改写 `.docx` 内部的 `word/document.xml`，将图片节点（`w:drawing`/`w:pict`）按出现顺序替换为文本 run。
对于浮动图片、文本框、页眉页脚、复杂表格等场景，顺序可能会有偏差，但不会把 OCR 统一追加到文末。
