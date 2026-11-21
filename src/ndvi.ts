import {fromArrayBuffer} from 'geotiff';

/** GeoTIFF の範囲（EPSG:4326, west, south, east, north）。public/data のファイルと一致させる */
export const NDVI_BOUNDS: [number, number, number, number] = [143.0, 42.84, 143.32, 43.02];
export const NDVI_URL = `${import.meta.env.BASE_URL}data/ndvi_obihiro_20250624.tif`;
const NODATA = -32768;
const SCALE = 1e-4;

export type ColormapId = 'rdylgn' | 'viridis' | 'gray';

interface Colormap {
  label: string;
  min: number;
  max: number;
  stops: [number, [number, number, number]][];
}

/** 停止点は 0..1。ColorBrewer RdYlGn / matplotlib viridis を間引いたもの */
export const COLORMAPS: Record<ColormapId, Colormap> = {
  rdylgn: {
    label: 'RdYlGn（-0.1〜0.9）',
    min: -0.1,
    max: 0.9,
    stops: [
      [0, [165, 0, 38]],
      [0.2, [244, 109, 67]],
      [0.4, [254, 224, 139]],
      [0.6, [217, 239, 139]],
      [0.8, [102, 189, 99]],
      [1, [0, 104, 55]]
    ]
  },
  viridis: {
    label: 'Viridis（0〜0.9）',
    min: 0,
    max: 0.9,
    stops: [
      [0, [68, 1, 84]],
      [0.25, [59, 82, 139]],
      [0.5, [33, 145, 140]],
      [0.75, [94, 201, 98]],
      [1, [253, 231, 37]]
    ]
  },
  gray: {
    label: 'グレースケール（0〜0.9）',
    min: 0,
    max: 0.9,
    stops: [
      [0, [0, 0, 0]],
      [1, [255, 255, 255]]
    ]
  }
};

export function colorAt(cm: Colormap, v: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, (v - cm.min) / (cm.max - cm.min)));
  for (let i = 1; i < cm.stops.length; i++) {
    const [t1, c1] = cm.stops[i];
    const [t0, c0] = cm.stops[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as [number, number, number];
    }
  }
  return cm.stops[cm.stops.length - 1][1];
}

export interface NdviRaster {
  width: number;
  height: number;
  data: Int16Array;
}

export async function loadNdvi(): Promise<NdviRaster> {
  // fromUrl は HTTP Range を前提にするが、配信先によっては Range に応答せず全体を返す（wrangler pages dev で確認）。
  // ファイルは約 2MB で全画素を使うため、まとめて取得してから解析する
  const res = await fetch(NDVI_URL);
  if (!res.ok) throw new Error(`NDVI の取得に失敗しました: ${res.status}`);
  const tiff = await fromArrayBuffer(await res.arrayBuffer());
  const image = await tiff.getImage();
  const rasters = await image.readRasters({interleave: false});
  const band = rasters[0] as Int16Array;
  return {width: image.getWidth(), height: image.getHeight(), data: band};
}

/** 生の NDVI 値を指定カラーマップで着色し、image ソース用の data URL を作る */
export function renderNdvi(r: NdviRaster, cmId: ColormapId): string {
  const cm = COLORMAPS[cmId];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = cm.min + ((cm.max - cm.min) * i) / 255;
    lut.set(colorAt(cm, v), i * 3);
  }
  const canvas = document.createElement('canvas');
  canvas.width = r.width;
  canvas.height = r.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(r.width, r.height);
  const px = img.data;
  for (let i = 0; i < r.data.length; i++) {
    const raw = r.data[i];
    if (raw === NODATA) continue; // alpha 0
    const v = raw * SCALE;
    const idx = Math.round(Math.min(1, Math.max(0, (v - cm.min) / (cm.max - cm.min))) * 255) * 3;
    px[i * 4] = lut[idx];
    px[i * 4 + 1] = lut[idx + 1];
    px[i * 4 + 2] = lut[idx + 2];
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** 経緯度位置の NDVI 値（範囲外・欠測は null） */
export function sampleNdvi(r: NdviRaster, lng: number, lat: number): number | null {
  const [w, s, e, n] = NDVI_BOUNDS;
  if (lng < w || lng >= e || lat <= s || lat > n) return null;
  const x = Math.floor(((lng - w) / (e - w)) * r.width);
  const y = Math.floor(((n - lat) / (n - s)) * r.height);
  const raw = r.data[y * r.width + x];
  return raw === NODATA ? null : raw * SCALE;
}

export function legendGradient(cmId: ColormapId): string {
  const cm = COLORMAPS[cmId];
  return `linear-gradient(90deg, ${cm.stops.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ')})`;
}
