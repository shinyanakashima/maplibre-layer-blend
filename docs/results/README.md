# 検証結果（自動生成）

`node scripts/verify.mjs` の出力。

## 実行環境

- MapLibre GL JS: 6.19.0
- UA: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.8103.78 Safari/537.36
- WebGL renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
- viewport: 1440x900 / DPR 1

## ピクセル照合（実測 vs W3C 式）

右画面で対象レイヤーが不透明に覆う 12 点（アンチエイリアスの縁を除く）について「下地」「対象レイヤー単体」を読み、`src/blendModes.ts` の式で計算した理論値と実測値の差（0〜255、RGB の最大値）を取った。

| データ | 対象 | モード | opacity | 点数 | 最大差 | 平均差 |
|---|---|---|---:|---:|---:|---:|
| demo1 | hillshade | normal | 1 | 12 | 0 | 0 |
| demo1 | hillshade | normal | 0.5 | 12 | 1 | 0.42 |
| demo1 | hillshade | multiply | 1 | 12 | 0 | 0 |
| demo1 | hillshade | multiply | 0.5 | 12 | 1 | 0.5 |
| demo1 | hillshade | screen | 1 | 12 | 0 | 0 |
| demo1 | hillshade | screen | 0.5 | 12 | 1 | 0.25 |
| demo1 | hillshade | overlay | 1 | 12 | 0 | 0 |
| demo1 | hillshade | overlay | 0.5 | 12 | 1 | 0.25 |
| demo1 | hillshade | plus-lighter | 1 | 12 | 0 | 0 |
| demo1 | hillshade | plus-lighter | 0.5 | 12 | 1 | 0.17 |
| demo1 | hillshade | color | 1 | 12 | 0 | 0 |
| demo1 | hillshade | color | 0.5 | 12 | 0 | 0 |
| demo1 | hillshade | luminosity | 1 | 12 | 0 | 0 |
| demo1 | hillshade | luminosity | 0.5 | 12 | 1 | 0.67 |
| demo2 | ndvi | normal | 1 | 12 | 0 | 0 |
| demo2 | ndvi | normal | 0.5 | 12 | 1 | 0.5 |
| demo2 | ndvi | multiply | 1 | 12 | 0 | 0 |
| demo2 | ndvi | multiply | 0.5 | 12 | 1 | 0.33 |
| demo2 | ndvi | screen | 1 | 12 | 0 | 0 |
| demo2 | ndvi | screen | 0.5 | 12 | 1 | 0.33 |
| demo2 | ndvi | overlay | 1 | 12 | 0 | 0 |
| demo2 | ndvi | overlay | 0.5 | 12 | 1 | 0.25 |
| demo2 | ndvi | plus-lighter | 1 | 12 | 0 | 0 |
| demo2 | ndvi | plus-lighter | 0.5 | 12 | 1 | 0.5 |
| demo2 | ndvi | color | 1 | 12 | 0 | 0 |
| demo2 | ndvi | color | 0.5 | 12 | 1 | 0.67 |
| demo2 | ndvi | luminosity | 1 | 12 | 0 | 0 |
| demo2 | ndvi | luminosity | 0.5 | 12 | 1 | 0.17 |
| demo3 | water | normal | 1 | 12 | 0 | 0 |
| demo3 | water | normal | 0.5 | 12 | 1 | 0.17 |
| demo3 | water | multiply | 1 | 12 | 0 | 0 |
| demo3 | water | multiply | 0.5 | 12 | 0 | 0 |
| demo3 | water | screen | 1 | 12 | 0 | 0 |
| demo3 | water | screen | 0.5 | 12 | 0 | 0 |
| demo3 | water | overlay | 1 | 12 | 0 | 0 |
| demo3 | water | overlay | 0.5 | 12 | 0 | 0 |
| demo3 | water | plus-lighter | 1 | 12 | 0 | 0 |
| demo3 | water | plus-lighter | 0.5 | 12 | 1 | 0.25 |
| demo3 | water | color | 1 | 12 | 0 | 0 |
| demo3 | water | color | 0.5 | 12 | 1 | 0.08 |
| demo3 | water | luminosity | 1 | 12 | 0 | 0 |
| demo3 | water | luminosity | 0.5 | 12 | 0 | 0 |
| demo3 | roads | normal | 1 | 12 | 0 | 0 |
| demo3 | roads | normal | 0.5 | 12 | 1 | 0.33 |
| demo3 | roads | multiply | 1 | 12 | 0 | 0 |
| demo3 | roads | multiply | 0.5 | 12 | 0 | 0 |
| demo3 | roads | screen | 1 | 12 | 0 | 0 |
| demo3 | roads | screen | 0.5 | 12 | 1 | 0.17 |
| demo3 | roads | overlay | 1 | 12 | 0 | 0 |
| demo3 | roads | overlay | 0.5 | 12 | 1 | 0.08 |
| demo3 | roads | plus-lighter | 1 | 12 | 0 | 0 |
| demo3 | roads | plus-lighter | 0.5 | 12 | 0 | 0 |
| demo3 | roads | color | 1 | 12 | 0 | 0 |
| demo3 | roads | color | 0.5 | 12 | 0 | 0 |
| demo3 | roads | luminosity | 1 | 12 | 0 | 0 |
| demo3 | roads | luminosity | 0.5 | 12 | 0 | 0 |

## 描画順序の影響

色別標高図（relief）と陰影起伏図（hillshade）を航空写真の上に重ね、順序だけを入れ替えたときの画素差（24 点）。

| relief のモード | hillshade のモード | 最大差 | 平均差 |
|---|---|---:|---:|
| multiply | multiply | 1 | 0.42 |
| screen | screen | 1 | 0.38 |
| multiply | screen | 154 | 145.58 |
| overlay | normal | 67 | 50.92 |
| overlay | multiply | 44 | 5.13 |
| color | luminosity | 55 | 13.46 |

## 性能計測

同期描画（`map.redraw()`）＋ 1px `readPixels` の所要時間。SwiftShader（CPU によるソフトウェア描画）での値で、実 GPU の性能を示すものではない。

### demo1 / hillshade

- GPU: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
- キャンバス: 539×844px

| ブレンド | opacity | レイヤー数 | 平均 ms | p95 ms | normal比 |
|---|---:|---:|---:|---:|---:|
| normal | 1 | 1 | 26.81 | 32.4 | 1.00 |
| multiply | 1 | 1 | 33.22 | 45.2 | 1.24 |
| screen | 1 | 1 | 28.53 | 36.4 | 1.06 |
| overlay | 1 | 1 | 33.22 | 43.5 | 1.24 |
| plus-lighter | 1 | 1 | 32.83 | 44.6 | 1.22 |
| color | 1 | 1 | 33.02 | 39.5 | 1.23 |
| luminosity | 1 | 1 | 33.64 | 46 | 1.25 |
| normal | 1 | 4 | 51.05 | 65.3 | 1.00 |
| multiply | 1 | 4 | 71.75 | 92 | 1.41 |
| screen | 1 | 4 | 74.14 | 90.7 | 1.45 |
| overlay | 1 | 4 | 72.5 | 99.5 | 1.42 |
| plus-lighter | 1 | 4 | 64.02 | 85.4 | 1.25 |
| color | 1 | 4 | 70.85 | 80.4 | 1.39 |
| luminosity | 1 | 4 | 68.67 | 81.7 | 1.35 |
| normal | 1 | 8 | 86.34 | 110.1 | 1.00 |
| multiply | 1 | 8 | 129.44 | 177.4 | 1.50 |
| screen | 1 | 8 | 106.42 | 130.3 | 1.23 |
| overlay | 1 | 8 | 133.45 | 170.8 | 1.55 |
| plus-lighter | 1 | 8 | 114.33 | 140.2 | 1.32 |
| color | 1 | 8 | 135.75 | 175.9 | 1.57 |
| luminosity | 1 | 8 | 138.39 | 163 | 1.60 |

### demo3 / roads

- GPU: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
- キャンバス: 539×844px

| ブレンド | opacity | レイヤー数 | 平均 ms | p95 ms | normal比 |
|---|---:|---:|---:|---:|---:|
| normal | 1 | 1 | 38.83 | 51.6 | 1.00 |
| normal | 0.8 | 1 | 43.21 | 56.4 | 1.11 |
| multiply | 1 | 1 | 43.71 | 56.2 | 1.13 |
| screen | 1 | 1 | 42.81 | 55.7 | 1.10 |
| overlay | 1 | 1 | 43.32 | 53.3 | 1.12 |
| plus-lighter | 1 | 1 | 42.98 | 57.2 | 1.11 |
| color | 1 | 1 | 45.32 | 58.3 | 1.17 |
| luminosity | 1 | 1 | 48.34 | 61.6 | 1.24 |
| normal | 1 | 4 | 40.59 | 53.1 | 1.00 |
| normal | 0.8 | 4 | 48.05 | 61.6 | 1.18 |
| multiply | 1 | 4 | 88.4 | 113.9 | 2.18 |
| screen | 1 | 4 | 82.01 | 101.6 | 2.02 |
| overlay | 1 | 4 | 92.7 | 123.4 | 2.28 |
| plus-lighter | 1 | 4 | 85.44 | 114.5 | 2.10 |
| color | 1 | 4 | 86.85 | 98.6 | 2.14 |
| luminosity | 1 | 4 | 97.77 | 122.4 | 2.41 |
| normal | 1 | 8 | 69.72 | 86.9 | 1.00 |
| normal | 0.8 | 8 | 132.69 | 181.8 | 1.90 |
| multiply | 1 | 8 | 133.19 | 161.1 | 1.91 |
| screen | 1 | 8 | 136.8 | 164.2 | 1.96 |
| overlay | 1 | 8 | 149.14 | 176.4 | 2.14 |
| plus-lighter | 1 | 8 | 140.72 | 162.5 | 2.02 |
| color | 1 | 8 | 157.19 | 193.9 | 2.25 |
| luminosity | 1 | 8 | 158.25 | 191.3 | 2.27 |

