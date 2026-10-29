# 气泡提示音完成音效 / Bubble Chime Sound Design

约 1 秒的原创合成完成提示音，用于整个 Agent 任务结束、输出停止时播放。全部由 numpy 合成，无任何外部采样。

## 声音动机 / Motif

1. 圆润低鸣「咕噜」：130 → 78 Hz 正弦 + 0.26 的二次谐波，约 0.3 s 指数衰减，5 Hz 缓慢振幅摆动（水下的咕噜）。
2. 轻微水花：700–2400 Hz 带通白噪，65 ms，低电平。
3. 两枚上浮气泡「blub」：480 → 760 Hz、620 → 980 Hz，各 90 ms，6 Hz 轻微颤音。
4. 水润三音琶音：C5 523.25 → E5 659.25 → G5 783.99 Hz，间隔 90 ms，正弦 + 0.16 二次谐波，±3 音分 / 6.5 Hz 颤音，约 0.45 s 衰减。
5. 收尾高音水花：1046 → 1568 Hz，70 ms，很轻。

## 合成参数 / Synthesis parameters

- 单声道 44100 Hz、16-bit PCM；12 ms 升余弦淡入、35 ms 淡出；峰值归一化到 −1.0 dBFS，无削波、无 DC。
- 固定随机种子 `20261029`，脚本 `synthesize.py`，不含时间戳。

## 测量事实 / Measured facts

| 项目 / Item | 值 / Value |
| --- | --- |
| 格式 / Format | mono, 44100 Hz, 16-bit PCM |
| 时长 / Duration | 1.0500 s (46305 frames) |
| 峰值 / Peak | −1.0002 dBFS (29204 / 32768) |
| RMS | −13.37 dBFS |
| DC 偏移 / DC offset | ~1.3e-7 (0.004 LSB) |
| 大小 / Size | 92,654 bytes (90.5 KiB) |
| SHA-256 | `f95c11f3aea73bf3b0ea05774007273d5d239015f25f273f2106060955302068` |

A 计权 RMS ≈ −18.2 dBFS；能量 51% 在 80–200 Hz、44% 在 500–1200 Hz、3 kHz 以上几乎为 0 → 温暖厚实、不刺耳。1.00–1.05 s 尾段 RMS ≈ −49.6 dBFS，无长尾。

## 复现 / Reproduce

```
python synthesize.py    # 重新写出 bubble-chime.wav，SHA-256 应保持不变
```

## 一行描述 / One-line description

- 中文：圆润的水下「咕噜」+ 两枚上浮气泡 + 水润的 C5–E5–G5 琶音，尾部一点轻水花，温暖可爱，约 1 秒。
- English: A round underwater "glub", two rising bubbles, then a liquid C5–E5–G5 water arpeggio with a faint sparkle — warm, watery, ~1 s.
