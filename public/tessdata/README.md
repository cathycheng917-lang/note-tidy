# 本地 OCR 语言包（traineddata）

把以下文件放到本目录（最终会以 `/tessdata/...` 的路径被浏览器访问）：

- `eng.traineddata`
- `chi_sim.traineddata`

注意：
- 文件名必须严格匹配以上名字（包含 `.traineddata`）
- 这套方案不使用 `.gz`，避免部分静态托管对 gzip/二进制处理不一致导致加载失败
