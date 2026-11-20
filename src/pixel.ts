import type {Map as MlMap} from 'maplibre-gl';
import {composite, type BlendMode, type RGBA} from './blendModes';
import type {AppState} from './state';
import {blendProp, getOverlay, type PaintKey} from './layers';

/** 描画直後にキャンバスの 1 ピクセルを読む（preserveDrawingBuffer なしでも同期 redraw 直後なら読める） */
export function readPixel(map: MlMap, x: number, y: number): [number, number, number, number] {
  map.redraw();
  const canvas = map.getCanvas();
  const gl = canvas.getContext('webgl2')!;
  const dpr = canvas.width / canvas.clientWidth;
  const px = new Uint8Array(4);
  gl.readPixels(Math.floor(x * dpr), Math.floor(canvas.height - (y + 0.5) * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [px[0], px[1], px[2], px[3]];
}

export interface PixelReport {
  target: string;
  mode: BlendMode;
  /** 対象レイヤーを除いた下地 */
  backdrop: number[];
  /** 対象レイヤー単体（透明キャンバス上・premultiplied） */
  source: number[];
  /** 右画面の実測 */
  actualBlend: number[];
  /** W3C 式による理論値 */
  expectedBlend: number[];
  /** 左画面（normal + opacityLeft）の実測 */
  actualNormal: number[];
  expectedNormal: number[];
  maxDiffBlend: number;
  maxDiffNormal: number;
  /** 検査中に一時的に隠した上位レイヤー */
  hiddenAbove: string[];
}

const to01 = (p: number[]): RGBA => [p[0] / 255, p[1] / 255, p[2] / 255, p[3] / 255];
const to255 = (p: number[]) => p.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
const maxDiff = (a: number[], b: number[]) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

/**
 * 一時的に「消す」には visibility ではなく不透明度 0 を使う。
 * ベクターレイヤーの visibility を切り替えるとタイルの再解析が非同期で走り、
 * 直後の同期描画ではバケットが無い（何も描かれない）状態になるため。
 */
function opacityKey(map: MlMap, id: string): PaintKey {
  const type = map.getLayer(id)!.type;
  if (type === 'background') return 'background-opacity' as PaintKey;
  if (type === 'raster') return 'raster-opacity' as PaintKey;
  return `${type}-layer-opacity` as PaintKey;
}

/** 指定レイヤーの不透明度を一時的に変え、元に戻す関数を返す */
function override(map: MlMap, ids: string[], value: number): () => void {
  const saved = ids.map((id) => [id, map.getPaintProperty(id, opacityKey(map, id))] as const);
  for (const id of ids) map.setPaintProperty(id, opacityKey(map, id), value);
  return () => {
    for (const [id, v] of saved) map.setPaintProperty(id, opacityKey(map, id), v ?? 1);
  };
}

const drawnLayers = (map: MlMap) => map.getStyle().layers.map((l) => l.id).filter((id) => map.getLayoutProperty(id, 'visibility') !== 'none');

/**
 * 画面座標 (x, y) について、対象レイヤーの「下地」「単体」「合成結果」を読み、式と比較する。
 * 下地・単体は不透明度を一時的に切り替えて同期描画し、読み取り後に元へ戻す。
 */
export function inspectPixel(left: MlMap, right: MlMap, state: AppState, x: number, y: number): PixelReport {
  const target = state.target;
  const def = getOverlay(target);
  const ls = state.layers[target];
  const idx = state.order.indexOf(target);
  const drawn = drawnLayers(right);
  // 対象より上のレイヤーは検査中だけ両画面で消す（下地＝対象より下だけ、にするため）
  const visibleAbove = state.order.slice(idx + 1).filter((id) => state.layers[id].visible);
  const restoreAboveL = override(left, visibleAbove, 0);
  const restoreAboveR = override(right, visibleAbove, 0);

  const actualBlend = readPixel(right, x, y);
  const actualNormal = readPixel(left, x, y);

  // 下地：対象だけ消す
  const restoreTarget = override(right, [target], 0);
  const backdrop = readPixel(right, x, y);
  restoreTarget();

  // 単体：対象以外（背景を含む）を消し、透明キャンバス上に normal・不透明度 1 で描画
  const restoreOthers = override(right, drawn.filter((id) => id !== target && !visibleAbove.includes(id)), 0);
  right.setPaintProperty(target, blendProp(def.kind), 'normal');
  const restoreSelf = override(right, [target], 1);
  const sourceFull = readPixel(right, x, y);

  // 元に戻す
  restoreSelf();
  right.setPaintProperty(target, blendProp(def.kind), ls.blend);
  restoreOthers();
  restoreAboveL();
  restoreAboveR();
  right.redraw();
  left.redraw();
  const b = to01(backdrop);
  const sFull = to01(sourceFull);
  const sRight = sFull.map((v) => v * ls.opacityRight) as RGBA;
  const sLeft = sFull.map((v) => v * ls.opacityLeft) as RGBA;
  const expectedBlend = to255(composite(ls.blend, sRight, b));
  const expectedNormal = to255(composite('normal', sLeft, b));

  return {
    target,
    mode: ls.blend,
    backdrop,
    source: sourceFull,
    actualBlend,
    expectedBlend,
    actualNormal,
    expectedNormal,
    maxDiffBlend: maxDiff(actualBlend, expectedBlend),
    maxDiffNormal: maxDiff(actualNormal, expectedNormal),
    hiddenAbove: visibleAbove
  };
}

/**
 * 対象レイヤーが不透明に覆う画素（周囲 2px も不透明＝アンチエイリアスの縁を除く）を n 点、画面全体から等間隔に選ぶ。
 * 検証スクリプトで、ラインやポリゴンの上に検査点を置くために使う。
 */
export function coveredPoints(map: MlMap, target: string, n: number): [number, number][] {
  const restoreOthers = override(map, drawnLayers(map).filter((id) => id !== target), 0);
  const restoreSelf = override(map, [target], 1);
  map.redraw();
  const c = map.getCanvas();
  const gl = c.getContext('webgl2')!;
  const buf = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  restoreSelf();
  restoreOthers();
  map.redraw();
  const dpr = c.width / c.clientWidth;
  const alpha = (x: number, y: number) => buf[((c.height - 1 - y) * c.width + x) * 4 + 3];
  const pts: [number, number][] = [];
  for (let y = 20; y < c.height - 20; y += 7)
    for (let x = 20; x < c.width - 20; x += 7) {
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) if (alpha(x + dx, y + dy) !== 255) ok = false;
      if (ok) pts.push([Math.round(x / dpr), Math.round(y / dpr)]);
    }
  const out: [number, number][] = [];
  for (let i = 0; i < n && pts.length; i++) out.push(pts[Math.floor((i * pts.length) / n)]);
  return out;
}
