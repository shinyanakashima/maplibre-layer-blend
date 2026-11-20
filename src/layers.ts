import type {LayerSpecification, Map as MlMap, StyleSpecification} from 'maplibre-gl';

export type PaintKey = Parameters<MlMap['setPaintProperty']>[1];
import {NDVI_BOUNDS} from './ndvi';

export type OverlayKind = 'raster' | 'fill' | 'line';

export interface OverlayDef {
  id: string;
  label: string;
  kind: OverlayKind;
  note: string;
  /** 疑似データ・加工データの場合に明示する */
  dataNote?: string;
  layer: LayerSpecification;
}

export interface BaseDef {
  id: string;
  label: string;
}

const GSI = 'https://cyberjapandata.gsi.go.jp/xyz';
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>';
const S2_ATTR =
  'NDVI: <a href="https://dataspace.copernicus.eu/" target="_blank">Contains modified Copernicus Sentinel data 2025</a>';

export const BASES: BaseDef[] = [
  {id: 'photo', label: '航空写真（地理院 シームレス写真）'},
  {id: 'pale', label: '淡色地図（地理院）'},
  {id: 'std', label: '標準地図（地理院）'},
  {id: 'dark', label: 'ダーク（淡色地図を明度反転）'},
  {id: 'white', label: '単色：白（検証用）'},
  {id: 'black', label: '単色：黒（検証用）'}
];

/** 不透明度スライダーが操作するプロパティ。fill/line はレイヤー全体に効く *-layer-opacity を使う */
export function opacityProp(kind: OverlayKind): PaintKey {
  return (kind === 'raster' ? 'raster-opacity' : `${kind}-layer-opacity`) as PaintKey;
}

export function blendProp(kind: OverlayKind): PaintKey {
  return `${kind}-layer-blend` as PaintKey;
}

const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'];

export const OVERLAYS: OverlayDef[] = [
  {
    id: 'hillshade',
    label: '陰影起伏図',
    kind: 'raster',
    note: '地理院タイル hillshademap（グレースケールPNG）',
    layer: {
      id: 'hillshade',
      type: 'raster',
      source: 'gsi-hillshade',
      paint: {'raster-fade-duration': 0}
    }
  },
  {
    id: 'slope',
    label: '傾斜量図',
    kind: 'raster',
    note: '地理院タイル slopemap（グレースケールPNG）',
    layer: {
      id: 'slope',
      type: 'raster',
      source: 'gsi-slope',
      paint: {'raster-fade-duration': 0}
    }
  },
  {
    id: 'relief',
    label: '色別標高図',
    kind: 'raster',
    note: '地理院タイル relief（標高を段彩表現）',
    layer: {
      id: 'relief',
      type: 'raster',
      source: 'gsi-relief',
      paint: {'raster-fade-duration': 0}
    }
  },
  {
    id: 'ndvi',
    label: 'NDVI（Sentinel-2）',
    kind: 'raster',
    note: 'Sentinel-2 L2A 2025-06-24 から算出した NDVI を、ブラウザ側でカラーマップ着色した画像',
    dataNote: '実データ（筆者が B04/B08 から算出・約20mに再サンプリング）',
    layer: {
      id: 'ndvi',
      type: 'raster',
      source: 'ndvi',
      paint: {'raster-fade-duration': 0, 'raster-resampling': 'nearest'}
    }
  },
  {
    id: 'water',
    label: '水域（ポリゴン）',
    kind: 'fill',
    note: 'OpenFreeMap / OpenMapTiles water',
    layer: {
      id: 'water',
      type: 'fill',
      source: 'ofm',
      'source-layer': 'water',
      paint: {'fill-color': '#1e6fd9'}
    }
  },
  {
    id: 'rivers',
    label: '河川（ライン）',
    kind: 'line',
    note: 'OpenFreeMap / OpenMapTiles waterway',
    layer: {
      id: 'rivers',
      type: 'line',
      source: 'ofm',
      'source-layer': 'waterway',
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {
        'line-color': '#2fb8ff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['match', ['get', 'class'], 'river', 2, 0.6], 15, ['match', ['get', 'class'], 'river', 9, 3]]
      }
    }
  },
  {
    id: 'roads',
    label: '道路（ライン）',
    kind: 'line',
    note: 'OpenFreeMap / OpenMapTiles transportation',
    layer: {
      id: 'roads',
      type: 'line',
      source: 'ofm',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ROAD_CLASSES]],
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {
        'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#ff7a1a', ['primary', 'secondary'], '#ffb000', '#ffe08a'],
        'line-width': [
          'interpolate', ['exponential', 1.6], ['zoom'],
          9, ['match', ['get', 'class'], ['motorway', 'trunk'], 2, ['primary', 'secondary'], 1.2, 0],
          12, ['match', ['get', 'class'], ['motorway', 'trunk'], 3.5, ['primary', 'secondary'], 2.2, 0.2],
          16, ['match', ['get', 'class'], ['motorway', 'trunk'], 16, ['primary', 'secondary'], 11, 5]
        ]
      }
    }
  },
  {
    id: 'buildings',
    label: '建物（ポリゴン）',
    kind: 'fill',
    note: 'OpenFreeMap / OpenMapTiles building（z13以上）',
    layer: {
      id: 'buildings',
      type: 'fill',
      source: 'ofm',
      'source-layer': 'building',
      minzoom: 13,
      paint: {'fill-color': '#e04fd0'}
    }
  }
];

export function getOverlay(id: string): OverlayDef {
  const d = OVERLAYS.find((o) => o.id === id);
  if (!d) throw new Error(`unknown overlay ${id}`);
  return d;
}

function gsiRaster(path: string, ext: string, minzoom: number, maxzoom: number, title: string) {
  return {
    type: 'raster' as const,
    tiles: [`${GSI}/${path}/{z}/{x}/{y}.${ext}`],
    tileSize: 256,
    minzoom,
    maxzoom,
    attribution: `${GSI_ATTR}（${title}）`
  };
}

/** 2画面とも同じスタイルから開始し、以後は setPaintProperty / moveLayer で同期する */
export function buildStyle(ndviDataUrl: string): StyleSpecification {
  const baseLayers: LayerSpecification[] = [
    {id: 'bg', type: 'background', paint: {'background-color': '#0b0f14'}},
    {id: 'base-photo', type: 'raster', source: 'gsi-photo', paint: {'raster-fade-duration': 0}},
    {id: 'base-pale', type: 'raster', source: 'gsi-pale', layout: {visibility: 'none'}, paint: {'raster-fade-duration': 0}},
    {id: 'base-std', type: 'raster', source: 'gsi-std', layout: {visibility: 'none'}, paint: {'raster-fade-duration': 0}},
    {
      id: 'base-dark',
      type: 'raster',
      source: 'gsi-pale',
      layout: {visibility: 'none'},
      paint: {
        'raster-fade-duration': 0,
        'raster-brightness-min': 1,
        'raster-brightness-max': 0,
        'raster-saturation': -0.6,
        'raster-contrast': 0.15
      }
    }
  ];

  return {
    version: 8,
    name: 'GIS Blend Laboratory',
    // 比較・ピクセル検査で途中経過を読まないよう、paint プロパティのトランジションを無効にする
    transition: {duration: 0, delay: 0},
    sources: {
      'gsi-photo': gsiRaster('seamlessphoto', 'jpg', 2, 18, '全国最新写真（シームレス）'),
      'gsi-pale': gsiRaster('pale', 'png', 2, 18, '淡色地図'),
      'gsi-std': gsiRaster('std', 'png', 2, 18, '標準地図'),
      'gsi-hillshade': gsiRaster('hillshademap', 'png', 2, 16, '陰影起伏図'),
      'gsi-slope': gsiRaster('slopemap', 'png', 3, 15, '傾斜量図'),
      'gsi-relief': gsiRaster('relief', 'png', 5, 15, '色別標高図'),
      ndvi: {
        type: 'image',
        url: ndviDataUrl,
        coordinates: [
          [NDVI_BOUNDS[0], NDVI_BOUNDS[3]],
          [NDVI_BOUNDS[2], NDVI_BOUNDS[3]],
          [NDVI_BOUNDS[2], NDVI_BOUNDS[1]],
          [NDVI_BOUNDS[0], NDVI_BOUNDS[1]]
        ]
      },
      ofm: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution:
          '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
      }
    },
    layers: [
      ...baseLayers,
      ...OVERLAYS.map((o) => ({...o.layer, layout: {...(o.layer as {layout?: object}).layout, visibility: 'none'}}) as LayerSpecification)
    ]
  };
}

export const NDVI_ATTRIBUTION = S2_ATTR;
