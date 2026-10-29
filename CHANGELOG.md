# Changelog

## 1.0.0 — 2026-10-29

- 首个公开版本「气泡提示音」：任务完成提示音（root 会话 `running → idle` 触发，子代理静音，700 ms 去重）。
- 原创气泡提示音：1.05 s，mono 44.1 kHz / 16-bit，峰值 −1.0 dBFS（numpy 确定性合成）。
- 输入框下方小气泡静音按钮（localStorage 持久化）。
- Web Audio 解码播放 + `<audio>` 兜底 + 首次手势解锁。
- `scripts/build.mjs`（WAV → data URI → `lib/client.js`）与 `scripts/verify.mjs`（结构 + 行为自检）。
- 中英文插件元数据、原创气泡图标、README 与 CI。
