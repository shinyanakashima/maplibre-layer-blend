import * as maplibregl from 'maplibre-gl';
import type {Map as MlMap, StyleSpecification} from 'maplibre-gl';
import type {AppState} from './state';
import {blendProp, getOverlay, opacityProp} from './layers';
import {NDVI_ATTRIBUTION} from './layers';

export type Side = 'left' | 'right';

export interface CompareView {
  left: MlMap;
  right: MlMap;
  /** true の間は左右の視点同期を止める（ベンチマーク用） */
  syncPaused: boolean;
  setMode(mode: 'split' | 'swipe', swipe: number): void;
  apply(state: AppState): void;
  ready: Promise<void>;
}

function createMap(container: HTMLElement, style: StyleSpecification, view: {center: [number, number]; zoom: number}, attribution: boolean): MlMap {
  return new maplibregl.Map({
    container,
    style,
    center: view.center,
    zoom: view.zoom,
    maxPitch: 75,
    attributionControl: attribution ? {compact: true, customAttribution: NDVI_ATTRIBUTION} : false,
    canvasContextAttributes: {antialias: false}
  });
}

export function createCompare(root: HTMLElement, style: StyleSpecification, view: {center: [number, number]; zoom: number}): CompareView {
  const leftEl = root.querySelector<HTMLElement>('#map-left')!;
  const rightEl = root.querySelector<HTMLElement>('#map-right')!;
  const handle = root.querySelector<HTMLElement>('#swipe-handle')!;

  const left = createMap(leftEl, style, view, false);
  const right = createMap(rightEl, style, view, true);
  right.addControl(new maplibregl.NavigationControl({visualizePitch: true}), 'top-right');
  right.addControl(new maplibregl.ScaleControl({unit: 'metric'}), 'bottom-left');

  const cv: CompareView = {
    left,
    right,
    syncPaused: false,
    ready: Promise.all([left.once('load'), right.once('load')]).then(() => undefined),
    setMode,
    apply
  };

  // ---- 視点の同期 ----------------------------------------------------------
  let syncing = false;
  const sync = (from: MlMap, to: MlMap) => () => {
    if (syncing || cv.syncPaused) return;
    syncing = true;
    to.jumpTo({center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch()});
    syncing = false;
  };
  left.on('move', sync(left, right));
  right.on('move', sync(right, left));

  // ---- 分割 / スワイプ -------------------------------------------------------
  let mode: 'split' | 'swipe' = 'split';
  let swipe = 0.5;

  function layout() {
    root.dataset.mode = mode;
    if (mode === 'split') {
      leftEl.style.clipPath = '';
      handle.hidden = true;
    } else {
      leftEl.style.clipPath = `inset(0 ${(1 - swipe) * 100}% 0 0)`;
      handle.hidden = false;
      handle.style.left = `${swipe * 100}%`;
    }
    left.resize();
    right.resize();
  }

  function setMode(m: 'split' | 'swipe', s: number) {
    mode = m;
    swipe = s;
    layout();
  }

  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = root.getBoundingClientRect();
    swipe = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width));
    leftEl.style.clipPath = `inset(0 ${(1 - swipe) * 100}% 0 0)`;
    handle.style.left = `${swipe * 100}%`;
    root.dispatchEvent(new CustomEvent('swipe', {detail: swipe}));
  });
  handle.addEventListener('pointerup', () => (dragging = false));

  // スワイプ時は左マップが上に重なるので、操作は左マップで受けて右へ同期させる
  window.addEventListener('resize', () => layout());

  // ---- 状態の反映 ------------------------------------------------------------
  function applyTo(map: MlMap, side: Side, state: AppState) {
    for (const b of ['photo', 'pale', 'std', 'dark']) {
      map.setLayoutProperty(`base-${b}`, 'visibility', state.base === b ? 'visible' : 'none');
    }
    map.setPaintProperty('bg', 'background-color', state.base === 'white' ? '#ffffff' : state.base === 'black' ? '#000000' : '#0b0f14');

    for (const id of state.order) {
      const def = getOverlay(id);
      const ls = state.layers[id];
      map.setLayoutProperty(id, 'visibility', ls.visible ? 'visible' : 'none');
      map.setPaintProperty(id, opacityProp(def.kind), side === 'left' ? ls.opacityLeft : ls.opacityRight);
      map.setPaintProperty(id, blendProp(def.kind), side === 'left' ? 'normal' : ls.blend);
    }
    // 下から順に最前面へ移動すれば、配列順＝描画順になる
    for (const id of state.order) map.moveLayer(id);
  }

  function apply(state: AppState) {
    applyTo(left, 'left', state);
    applyTo(right, 'right', state);
  }

  layout();
  return cv;
}
