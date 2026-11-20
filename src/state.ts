import type {BlendMode} from './blendModes';
import type {ColormapId} from './ndvi';

export interface LayerState {
  visible: boolean;
  /** 左画面（通常合成）の不透明度 */
  opacityLeft: number;
  /** 右画面（Layer Blend）の不透明度 */
  opacityRight: number;
  /** 右画面のブレンドモード（左画面は常に normal） */
  blend: BlendMode;
}

export interface View {
  center: [number, number];
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface Scenario {
  id: string;
  tab: string;
  title: string;
  base: string;
  /** 下から上への描画順 */
  order: string[];
  target: string;
  layers: Record<string, Partial<LayerState>>;
  colormap?: ColormapId;
  view: View;
  lead: string;
  points: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'demo1',
    tab: 'デモ1',
    title: '航空写真 × 陰影起伏図',
    base: 'photo',
    order: ['relief', 'slope', 'hillshade'],
    target: 'hillshade',
    layers: {
      hillshade: {visible: true, opacityLeft: 0.5, opacityRight: 1, blend: 'multiply'}
    },
    view: {center: [142.93, 42.87], zoom: 11.4},
    lead: '日高山脈の東麓から十勝平野へ。グレースケールの陰影起伏図を航空写真に重ねます。',
    points: [
      '左：Opacity 0.5 の通常合成。陰影の灰色が写真全体に乗り、畑や森林の色がくすむ。',
      '右：乗算。陰影起伏図の白い部分（平坦地・日向斜面）は写真の色をそのまま残し、影になる斜面だけが沈む。',
      '「輝度」は陰影の明暗に写真の色を乗せる。「カラー」は上のレイヤーの色相を使うため、灰色の陰影を上に置くと写真がモノクロになる。',
      '色別標高図を表示し、陰影起伏図より手前に移して「カラー」にすると、陰影の明暗に段彩が乗る（順序で意味が変わる例）。'
    ]
  },
  {
    id: 'demo2',
    tab: 'デモ2',
    title: '航空写真 × NDVI',
    base: 'photo',
    order: ['ndvi'],
    target: 'ndvi',
    colormap: 'rdylgn',
    layers: {
      ndvi: {visible: true, opacityLeft: 0.6, opacityRight: 1, blend: 'color'}
    },
    view: {center: [143.13, 42.93], zoom: 12.4},
    lead: '帯広市周辺の畑作地帯。Sentinel-2（2025-06-24）から算出した NDVI を色付きラスターとして重ねます。',
    points: [
      '右：カラー。NDVI の色相を写真の明暗に乗せるため、圃場の区画や防風林の質感が残る。',
      '注意：ブレンド後の表示色は凡例と一致しない。カーソル位置の NDVI 値は地図左下の読み取り欄で確認する。',
      '「乗算」は暗い圃場ほど区別しづらく、「スクリーン」は凡例の赤〜緑が白っぽく転ぶ。'
    ]
  },
  {
    id: 'demo3',
    tab: 'デモ3',
    title: '背景地図 × 道路・河川',
    base: 'photo',
    order: ['water', 'rivers', 'roads'],
    target: 'roads',
    layers: {
      water: {visible: true, opacityLeft: 0.6, opacityRight: 0.6, blend: 'normal'},
      rivers: {visible: true, opacityLeft: 0.8, opacityRight: 1, blend: 'screen'},
      roads: {visible: true, opacityLeft: 0.8, opacityRight: 1, blend: 'screen'}
    },
    view: {center: [143.2, 42.925], zoom: 13.2},
    lead: '帯広市街と十勝川。OpenStreetMap 由来の道路・河川ラインを航空写真やダーク地図に重ねます。',
    points: [
      '右：スクリーン。線は必ず下地より明るくなるため、暗い樹林や河川敷の上では線が浮く。',
      '一方、明るい市街地や屋根の上では線が白っぽく転び、道路種別の色の差は通常合成より読み取りにくい。',
      '背景を「ダーク」に切り替えると、スクリーンでも線の色がほぼそのまま出る（黒はスクリーンで変化しない）。',
      '河川を「オーバーレイ」にして道路と順序を入れ替えると交差部の色が変わる。スクリーン同士・乗算同士は順序に依存しない。'
    ]
  },
  {
    id: 'free',
    tab: '自由',
    title: 'フリー実験',
    base: 'photo',
    order: ['relief', 'slope', 'hillshade', 'ndvi', 'water', 'buildings', 'rivers', 'roads'],
    target: 'hillshade',
    colormap: 'rdylgn',
    layers: {},
    view: {center: [143.05, 42.92], zoom: 10.5},
    lead: 'すべてのレイヤーを自由に組み合わせられます。',
    points: ['レイヤー名をクリックして操作対象を選び、ブレンドモード・Opacity・順序を変えてください。']
  }
];

export const DEFAULT_LAYER: LayerState = {visible: false, opacityLeft: 1, opacityRight: 1, blend: 'normal'};

export interface AppState {
  scenarioId: string;
  base: string;
  order: string[];
  target: string;
  layers: Record<string, LayerState>;
  colormap: ColormapId;
  compareMode: 'split' | 'swipe';
  swipe: number;
}

export function scenarioState(s: Scenario, ids: string[], prev?: AppState): AppState {
  const layers: Record<string, LayerState> = {};
  for (const id of ids) layers[id] = {...DEFAULT_LAYER, ...s.layers[id]};
  const order = [...s.order, ...ids.filter((id) => !s.order.includes(id))];
  return {
    scenarioId: s.id,
    base: s.base,
    order,
    target: s.target,
    layers,
    colormap: s.colormap ?? prev?.colormap ?? 'rdylgn',
    compareMode: prev?.compareMode ?? (window.matchMedia('(max-width: 760px)').matches ? 'swipe' : 'split'),
    swipe: prev?.swipe ?? 0.5
  };
}
