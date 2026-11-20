import type {LayerSpecification, Map as MlMap} from 'maplibre-gl';
import {BLEND_MODES, type BlendMode} from './blendModes';
import {blendProp, getOverlay, opacityProp} from './layers';

export interface EnvInfo {
  userAgent: string;
  renderer: string;
  vendor: string;
  canvas: string;
  devicePixelRatio: number;
  maplibre: string;
  date: string;
}

export function envInfo(map: MlMap, version: string): EnvInfo {
  const canvas = map.getCanvas();
  const gl = canvas.getContext('webgl2')!;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    userAgent: navigator.userAgent,
    renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
    vendor: ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
    canvas: `${canvas.width}×${canvas.height}px`,
    devicePixelRatio: window.devicePixelRatio,
    maplibre: version,
    date: new Date().toISOString()
  };
}

export interface BenchRow {
  mode: BlendMode;
  /** 対象レイヤーの不透明度（raster-opacity / *-layer-opacity） */
  opacity: number;
  layers: number;
  frames: number;
  avgMs: number;
  p95Ms: number;
  /** 1000 / avgMs。垂直同期に縛られない理論値で、実際の画面 FPS ではない */
  equivFps: number;
}

/**
 * 同期描画（map.redraw）＋ 1px readPixels で GPU 完了を待ち、1 フレームの所要時間を測る。
 * 対象レイヤーを n 枚に複製し、同じブレンドモードを全てに設定する。
 */
export async function runBenchmark(
  map: MlMap,
  targetId: string,
  opts: {modes?: BlendMode[]; layerCounts?: number[]; frames?: number; onProgress?: (msg: string) => void}
): Promise<BenchRow[]> {
  const modes = opts.modes ?? [...BLEND_MODES];
  const counts = opts.layerCounts ?? [1, 4, 8];
  const frames = opts.frames ?? 40;
  const def = getOverlay(targetId);
  const gl = map.getCanvas().getContext('webgl2')!;
  const px = new Uint8Array(4);
  const original = {
    bearing: map.getBearing(),
    blend: map.getPaintProperty(targetId, blendProp(def.kind)),
    opacity: map.getPaintProperty(targetId, opacityProp(def.kind)),
    visibility: map.getLayoutProperty(targetId, 'visibility')
  };
  map.setLayoutProperty(targetId, 'visibility', 'visible');

  const dupIds: string[] = [];
  const rows: BenchRow[] = [];
  try {
    for (const n of counts) {
      while (dupIds.length < n - 1) {
        const id = `bench-dup-${dupIds.length}`;
        const spec = {...map.getLayer(targetId)!.serialize(), id} as LayerSpecification;
        map.addLayer(spec);
        dupIds.push(id);
      }
      // 基準は不透明度 1。fill/line は *-layer-opacity < 1 だけでもオフスクリーン合成になるため、その比較行も加える
      const cases: [BlendMode, number][] = modes.map((m) => [m, 1]);
      if (def.kind !== 'raster') cases.splice(1, 0, ['normal', 0.8]);
      for (const [mode, opacity] of cases) {
        opts.onProgress?.(`${n}枚 × ${mode} (opacity ${opacity})`);
        for (const id of [targetId, ...dupIds]) {
          map.setPaintProperty(id, blendProp(def.kind), mode);
          map.setPaintProperty(id, opacityProp(def.kind), opacity);
        }
        // ウォームアップ（シェーダのコンパイルを計測から外す）
        for (let i = 0; i < 5; i++) {
          map.jumpTo({bearing: original.bearing + i * 0.01});
          map.redraw();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        const times: number[] = [];
        for (let i = 0; i < frames; i++) {
          map.jumpTo({bearing: original.bearing + (i % 2 ? 0.02 : -0.02)});
          const t0 = performance.now();
          map.redraw();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        rows.push({
          mode,
          opacity,
          layers: n,
          frames,
          avgMs: +avg.toFixed(2),
          p95Ms: +times[Math.floor(times.length * 0.95) - 1].toFixed(2),
          equivFps: +(1000 / avg).toFixed(1)
        });
        await new Promise((r) => setTimeout(r, 0)); // UI を更新させる
      }
    }
  } finally {
    for (const id of dupIds) map.removeLayer(id);
    map.setPaintProperty(targetId, blendProp(def.kind), original.blend);
    map.setPaintProperty(targetId, opacityProp(def.kind), original.opacity);
    map.setLayoutProperty(targetId, 'visibility', original.visibility ?? 'visible');
    map.jumpTo({bearing: original.bearing});
  }
  return rows;
}

export function benchMarkdown(env: EnvInfo, rows: BenchRow[]): string {
  const lines = [
    `- 日時: ${env.date}`,
    `- MapLibre GL JS: ${env.maplibre}`,
    `- UA: ${env.userAgent}`,
    `- GPU: ${env.vendor} / ${env.renderer}`,
    `- キャンバス: ${env.canvas}（devicePixelRatio ${env.devicePixelRatio}）`,
    '',
    '| ブレンド | opacity | レイヤー数 | 平均 ms | p95 ms | 換算FPS | normal比 |',
    '|---|---:|---:|---:|---:|---:|---:|'
  ];
  for (const r of rows) {
    const base = rows.find((x) => x.layers === r.layers && x.mode === 'normal' && x.opacity === 1);
    const ratio = base ? (r.avgMs / base.avgMs).toFixed(2) : '-';
    lines.push(`| ${r.mode} | ${r.opacity} | ${r.layers} | ${r.avgMs} | ${r.p95Ms} | ${r.equivFps} | ${ratio} |`);
  }
  return lines.join('\n');
}

/** 実際の画面更新レート（requestAnimationFrame の間隔から算出） */
export function startFpsMeter(el: HTMLElement, maps: MlMap[]) {
  let frames = 0;
  let last = performance.now();
  for (const m of maps) m.on('render', () => frames++);
  setInterval(() => {
    const now = performance.now();
    const fps = (frames / maps.length / (now - last)) * 1000;
    el.textContent = `${fps.toFixed(0)} fps`;
    el.title = '地図の render イベント回数（左右平均）。操作していないときは再描画されないため 0 になる';
    frames = 0;
    last = now;
  }, 1000);
}
