/**
 * MapLibre GL JS v6.18+ が受け付ける `{raster,fill,line}-layer-blend` の値。
 * 値の一覧は @maplibre/maplibre-gl-style-spec の v8.json（paint_raster / paint_fill / paint_line）に準拠。
 */
export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'plus-lighter',
  'color',
  'luminosity'
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export interface BlendModeInfo {
  id: BlendMode;
  ja: string;
  /** ボタン用の短い表記 */
  short: string;
  formula: string;
  effect: string;
  gisUse: string;
  /** maplibre-gl の実装（src/webgl/draw/draw_layer_composite.ts）での処理経路 */
  gpuPath: 'alpha' | 'fixed' | 'shader';
}

export const BLEND_INFO: Record<BlendMode, BlendModeInfo> = {
  normal: {
    id: 'normal',
    short: '通常',
    ja: '通常',
    formula: 'Cs',
    effect: '通常のアルファ合成。上のレイヤーが下を覆い、Opacityで透かす従来の方式。',
    gisUse: '比較の基準。透過させるほど上下の色が混ざり、両方のコントラストが下がる。',
    gpuPath: 'alpha'
  },
  multiply: {
    id: 'multiply',
    short: '乗算',
    ja: '乗算',
    formula: 'Cs × Cb',
    effect: '上下の色を掛け合わせる。結果は必ず暗くなり、白は「変化なし」、黒は黒になる。',
    gisUse: '陰影起伏図・傾斜量図を航空写真や色別標高図に重ねる定番。白い平地は下地の色をそのまま残す。',
    gpuPath: 'shader'
  },
  screen: {
    id: 'screen',
    short: 'スクリーン',
    ja: 'スクリーン',
    formula: 'Cs + Cb − Cs × Cb',
    effect: '反転して乗算し、再反転する。結果は必ず明るくなり、黒は「変化なし」になる。',
    gisUse: '暗い背景上の道路・河川を光らせる表現。暗部を持つ写真の上でも線が沈みにくい。',
    gpuPath: 'fixed'
  },
  overlay: {
    id: 'overlay',
    short: 'オーバーレイ',
    ja: 'オーバーレイ',
    formula: 'Cb ≤ 0.5 : 2·Cs·Cb ／ Cb > 0.5 : 1 − 2(1−Cs)(1−Cb)',
    effect: '下地の暗部は乗算、明部はスクリーン。下地の明暗を保ちながらコントラストを強める。',
    gisUse: '主題図の色を下地の質感を残したまま載せる。下地と上の順序を入れ替えると結果が変わる。',
    gpuPath: 'shader'
  },
  'plus-lighter': {
    id: 'plus-lighter',
    short: '加算',
    ja: '加算（plus-lighter）',
    formula: 'min(1, Cs + Cb)',
    effect: '色をそのまま足し合わせる。1で飽和（白飛び）する。',
    gisUse: '発光・密度の積み上げ表現。明るい下地の上ではすぐ白飛びするため暗い背景向き。',
    gpuPath: 'fixed'
  },
  color: {
    id: 'color',
    short: 'カラー',
    ja: 'カラー',
    formula: 'SetLum(Cs, Lum(Cb))',
    effect: '上の色相・彩度と、下の輝度を組み合わせる（非分離型）。下地の明暗は保たれる。',
    gisUse: '陰影や航空写真の明暗を残したまま着色する。凡例の色と表示色が一致しなくなる点に注意。',
    gpuPath: 'shader'
  },
  luminosity: {
    id: 'luminosity',
    short: '輝度',
    ja: '輝度',
    formula: 'SetLum(Cb, Lum(Cs))',
    effect: '上の輝度と、下の色相・彩度を組み合わせる（非分離型）。カラーの逆。',
    gisUse: '陰影起伏図の明暗を、下地（色別標高図など）の色に移す。',
    gpuPath: 'shader'
  }
};

export const GPU_PATH_LABEL: Record<BlendModeInfo['gpuPath'], string> = {
  alpha: '通常のアルファブレンド',
  fixed: '固定機能ブレンド（背景コピー不要）',
  shader: 'シェーダ合成（背景をテクスチャにコピー）'
};

// ---------------------------------------------------------------------------
// 参照実装（W3C Compositing and Blending Level 1 / premultiplied alpha）
// MapLibre の layer_composite.fragment.glsl と同じ式を JS で書き下したもの。
// ピクセル検査で「実測値」と「理論値」を突き合わせるために使う。
// ---------------------------------------------------------------------------

/** premultiplied RGBA (0..1) */
export type RGBA = [number, number, number, number];

const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColor(c: number[]): number[] {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let r = c.slice();
  if (n < 0) r = r.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) r = r.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return r;
}

function setLum(c: number[], l: number): number[] {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

/** src を dst の上に合成した結果（どちらも premultiplied）を返す */
export function composite(mode: BlendMode, src: RGBA, dst: RGBA): RGBA {
  const [sr, sg, sb, sa] = src;
  const [dr, dg, db, da] = dst;
  const s = [sr, sg, sb];
  const d = [dr, dg, db];
  const outA = sa + da * (1 - sa);

  switch (mode) {
    case 'normal':
      return [sr + dr * (1 - sa), sg + dg * (1 - sa), sb + db * (1 - sa), outA];
    case 'multiply':
      return [0, 1, 2].map((i) => (1 - da) * s[i] + (1 - sa) * d[i] + s[i] * d[i]).concat(outA) as RGBA;
    case 'screen':
      return [0, 1, 2].map((i) => s[i] + d[i] - s[i] * d[i]).concat(outA) as RGBA;
    case 'plus-lighter':
      return [Math.min(1, sr + dr), Math.min(1, sg + dg), Math.min(1, sb + db), Math.min(1, sa + da)];
    case 'overlay':
      return [0, 1, 2]
        .map((i) => {
          if (2 * d[i] < da) return (1 - da) * s[i] + (1 - sa) * d[i] + 2 * s[i] * d[i];
          return s[i] + d[i] + da * s[i] + sa * d[i] - sa * da - 2 * d[i] * s[i];
        })
        .concat(outA) as RGBA;
    case 'color':
    case 'luminosity': {
      const cs = sa > 0 ? s.map((v) => v / sa) : [0, 0, 0];
      const cb = da > 0 ? d.map((v) => v / da) : [0, 0, 0];
      const blended = mode === 'color' ? setLum(cs, lum(cb)) : setLum(cb, lum(cs));
      return [0, 1, 2].map((i) => (1 - da) * s[i] + (1 - sa) * d[i] + sa * da * blended[i]).concat(outA) as RGBA;
    }
  }
}
