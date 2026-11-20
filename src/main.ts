import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import {BLEND_INFO, BLEND_MODES, GPU_PATH_LABEL, type BlendMode} from './blendModes';
import {BASES, OVERLAYS, blendProp, buildStyle, getOverlay, opacityProp} from './layers';
import {COLORMAPS, legendGradient, loadNdvi, renderNdvi, sampleNdvi, colorAt, type ColormapId, type NdviRaster} from './ndvi';
import {SCENARIOS, scenarioState, type AppState} from './state';
import {createCompare, type CompareView} from './compare';
import {coveredPoints, inspectPixel, readPixel, type PixelReport} from './pixel';
import {benchMarkdown, envInfo, runBenchmark, startFpsMeter, type BenchRow} from './bench';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);
const LAYER_IDS = OVERLAYS.map((o) => o.id);

let state: AppState;
let cv: CompareView;
let ndvi: NdviRaster;
let lastReport: PixelReport | null = null;
let linkOpacity = false;

// ---------------------------------------------------------------------------
// 状態更新
// ---------------------------------------------------------------------------
function commit(opts: {ndvi?: boolean} = {}) {
  if (opts.ndvi) {
    const url = renderNdvi(ndvi, state.colormap);
    for (const m of [cv.left, cv.right]) (m.getSource('ndvi') as maplibregl.ImageSource).updateImage({url});
  }
  cv.apply(state);
  render();
}

function loadScenario(id: string) {
  const s = SCENARIOS.find((x) => x.id === id)!;
  const colormapChanged = s.colormap && s.colormap !== state?.colormap;
  state = scenarioState(s, LAYER_IDS, state);
  cv.right.jumpTo({...s.view, bearing: s.view.bearing ?? 0, pitch: s.view.pitch ?? 0});
  lastReport = null;
  commit({ndvi: !!colormapChanged});
}

// ---------------------------------------------------------------------------
// 描画（パネル）
// ---------------------------------------------------------------------------
function render() {
  const s = SCENARIOS.find((x) => x.id === state.scenarioId)!;

  $('#tabs').innerHTML = SCENARIOS.map(
    (x) => `<button type="button" data-scenario="${x.id}" aria-selected="${x.id === state.scenarioId}">${x.tab}<small>${esc(x.title)}</small></button>`
  ).join('');

  const dataNotes = state.order.filter((id) => state.layers[id].visible && getOverlay(id).dataNote).map((id) => `${getOverlay(id).label}：${getOverlay(id).dataNote}`);
  $('#scenario').innerHTML = `
    <h3>${esc(s.title)}</h3>
    <p>${esc(s.lead)}</p>
    <ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    ${dataNotes.map((n) => `<span class="data-note">${esc(n)}</span>`).join('')}`;

  $<HTMLSelectElement>('#base-select').value = state.base;

  // レイヤー一覧（上＝手前）
  const top = [...state.order].reverse();
  $('#layer-list').innerHTML = top
    .map((id, i) => {
      const d = getOverlay(id);
      const ls = state.layers[id];
      return `<li data-layer="${id}" class="${id === state.target ? 'selected' : ''} ${ls.visible ? '' : 'hidden-layer'}">
        <input type="checkbox" data-vis="${id}" ${ls.visible ? 'checked' : ''} aria-label="${esc(d.label)}を表示" />
        <span class="lname">${esc(d.label)}<em>${d.kind}</em></span>
        <span class="badge ${ls.blend !== 'normal' ? 'on' : ''}">${ls.blend}</span>
        <span class="order-btns">
          <button type="button" data-up="${id}" ${i === 0 ? 'disabled' : ''} aria-label="手前へ">▲</button>
          <button type="button" data-down="${id}" ${i === top.length - 1 ? 'disabled' : ''} aria-label="奥へ">▼</button>
        </span>
      </li>`;
    })
    .join('');

  renderTarget();

  // NDVI
  const ndviVisible = state.layers.ndvi.visible;
  $('#ndvi-card').hidden = !ndviVisible;
  $<HTMLSelectElement>('#cmap-select').value = state.colormap;
  const cm = COLORMAPS[state.colormap];
  $('#legend-bar').style.background = legendGradient(state.colormap);
  $('#legend-ticks').innerHTML = [0, 0.25, 0.5, 0.75, 1].map((t) => `<span>${(cm.min + (cm.max - cm.min) * t).toFixed(2)}</span>`).join('');

  // ラベル
  const t = state.layers[state.target];
  const td = getOverlay(state.target);
  $('#lbl-left').textContent = `${td.label}: normal / opacity ${t.opacityLeft.toFixed(2)}`;
  $('#lbl-right').textContent = `${td.label}: ${t.blend} / opacity ${t.opacityRight.toFixed(2)}`;

  document.querySelectorAll<HTMLButtonElement>('[data-compare]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.compare === state.compareMode)));

  renderCode();
  renderInspect();
}

function renderTarget() {
  const id = state.target;
  const d = getOverlay(id);
  const ls = state.layers[id];
  const info = BLEND_INFO[ls.blend];
  $('#target-card').innerHTML = `
    <h2>操作対象</h2>
    <div class="target-name">${esc(d.label)}${ls.visible ? '' : ' <small style="color:var(--warn)">（非表示）</small>'}</div>
    <div class="target-props">${blendProp(d.kind)} / ${opacityProp(d.kind)}</div>
    <div class="mode-grid">
      ${BLEND_MODES.map((m) => `<button type="button" data-mode="${m}" aria-pressed="${m === ls.blend}"><span>${BLEND_INFO[m].short}</span><code>${m}</code></button>`).join('')}
    </div>
    <div class="mode-desc">
      <div class="formula">${esc(info.formula)}</div>
      <div>${esc(info.effect)}</div>
      <div class="path">GPU処理：${GPU_PATH_LABEL[info.gpuPath]}</div>
    </div>
    <div class="slider left">
      <label for="op-left"><span>左：通常合成の Opacity</span><span>${ls.opacityLeft.toFixed(2)}</span></label>
      <input id="op-left" type="range" min="0" max="1" step="0.01" value="${ls.opacityLeft}" />
    </div>
    <div class="slider">
      <label for="op-right"><span>右：Layer Blend 側の Opacity</span><span>${ls.opacityRight.toFixed(2)}</span></label>
      <input id="op-right" type="range" min="0" max="1" step="0.01" value="${ls.opacityRight}" />
    </div>
    <label class="switch" style="margin-top:8px"><input type="checkbox" id="op-link" ${linkOpacity ? 'checked' : ''}/><span>左右の Opacity を連動</span></label>
    <p class="note">${esc(d.note)}</p>`;
}

function renderCode() {
  const lines = state.order
    .filter((id) => state.layers[id].visible)
    .reverse()
    .map((id) => {
      const d = getOverlay(id);
      const ls = state.layers[id];
      return `map.setPaintProperty('${id}', '${blendProp(d.kind)}', '${ls.blend}');\nmap.setPaintProperty('${id}', '${opacityProp(d.kind)}', ${ls.opacityRight});`;
    });
  $('#code-view').textContent = lines.length ? `// 手前のレイヤーから\n${lines.join('\n')}` : '// 表示中のオーバーレイはありません';
}

const rgb = (p: number[]) => `rgb(${p[0]},${p[1]},${p[2]})`;
const sw = (p: number[]) => `<span class="swatch" style="background:${rgb(p)}"></span>`;

function renderInspect() {
  const el = $('#inspect-result');
  if (!lastReport) {
    el.innerHTML = $<HTMLInputElement>('#inspect-toggle').checked ? '<p class="note">地図をクリックしてください。</p>' : '';
    return;
  }
  const r = lastReport;
  const tol = 3;
  const row = (label: string, p: number[]) => `<tr><th>${label}</th><td>${sw(p)} ${p.slice(0, 3).join(', ')}</td></tr>`;
  el.innerHTML = `
    <table>
      ${row('下地 Cb', r.backdrop)}
      <tr><th>対象 Cs（α=${r.source[3]}）</th><td>${sw(r.source)} ${r.source.slice(0, 3).join(', ')}</td></tr>
      ${row(`右 実測（${r.mode}）`, r.actualBlend)}
      ${row('右 理論値', r.expectedBlend)}
      ${row('左 実測（normal）', r.actualNormal)}
      ${row('左 理論値', r.expectedNormal)}
    </table>
    <p class="verdict ${r.maxDiffBlend <= tol ? 'ok' : 'ng'}">右：最大差 ${r.maxDiffBlend}（許容 ±${tol}）${r.maxDiffBlend <= tol ? '式と一致' : '差あり（タイル境界・アンチエイリアス・読み込み途中の可能性）'}</p>
    <p class="verdict ${r.maxDiffNormal <= tol ? 'ok' : 'ng'}">左：最大差 ${r.maxDiffNormal}</p>
    ${r.hiddenAbove.length ? `<p class="note">検査中は上位レイヤー（${r.hiddenAbove.map((id) => getOverlay(id).label).join('、')}）を一時的に非表示にしています。</p>` : ''}`;
}

// ---------------------------------------------------------------------------
// モード一覧・性能計測ダイアログ
// ---------------------------------------------------------------------------
function chip(mode: BlendMode, s: [number, number, number], b: [number, number, number]) {
  // 一覧用の小さなサンプル（CSS mix-blend-mode で描く。plus-lighter も CSS で同名の値がある）
  return `<span class="chip" style="background:rgb(${b.join(',')});position:relative;overflow:hidden;isolation:isolate">
    <span style="position:absolute;inset:6px 6px 6px 18px;border-radius:3px;background:rgb(${s.join(',')});mix-blend-mode:${mode}"></span></span>`;
}

function renderModesTable() {
  $('#modes-table').innerHTML = `
    <p class="note" style="margin:0 0 10px">出典：MapLibre Style Specification（<code>raster-layer-blend</code> / <code>fill-layer-blend</code> / <code>line-layer-blend</code>）、
    W3C Compositing and Blending Level 1。Cs＝上のレイヤー、Cb＝下地。GPU 処理経路は maplibre-gl ${maplibregl.getVersion()} の実装を確認したもの。見本はブラウザの CSS mix-blend-mode で描画しています。</p>
    <table class="dtable">
      <thead><tr><th>値</th><th>名称</th><th>見本</th><th>式（分離型は各チャンネル）</th><th>効果</th><th>GIS での使いどころ</th><th>GPU処理</th></tr></thead>
      <tbody>${BLEND_MODES.map((m) => {
        const i = BLEND_INFO[m];
        return `<tr><td><code>${m}</code></td><td>${esc(i.ja)}</td><td>${chip(m, [255, 140, 40], [40, 120, 200])}</td><td><code>${esc(i.formula)}</code></td><td>${esc(i.effect)}</td><td>${esc(i.gisUse)}</td><td>${GPU_PATH_LABEL[i.gpuPath]}</td></tr>`;
      }).join('')}</tbody>
    </table>`;
}

let benchMd = '';
function renderBenchRows(rows: BenchRow[]) {
  const max = Math.max(...rows.map((r) => r.avgMs));
  $('#bench-result').innerHTML = `<table class="dtable"><thead><tr><th>ブレンド</th><th>opacity</th><th>レイヤー数</th><th>平均 ms</th><th>p95 ms</th><th>換算FPS</th><th>normal比</th></tr></thead><tbody>
    ${rows
      .map((r) => {
        const base = rows.find((x) => x.layers === r.layers && x.mode === 'normal' && x.opacity === 1);
        return `<tr><td><code>${r.mode}</code></td><td class="num">${r.opacity}</td><td class="num">${r.layers}</td><td class="num"><span class="bar" style="width:${(r.avgMs / max) * 80}px"></span>${r.avgMs}</td><td class="num">${r.p95Ms}</td><td class="num">${r.equivFps}</td><td class="num">${base ? (r.avgMs / base.avgMs).toFixed(2) : '-'}</td></tr>`;
      })
      .join('')}</tbody></table>`;
}

async function doBench(target: string, frames: number) {
  const status = $('#bench-status');
  cv.syncPaused = true;
  try {
    const rows = await runBenchmark(cv.right, target, {frames, onProgress: (m) => (status.textContent = `計測中… ${m}`)});
    const env = envInfo(cv.right, maplibregl.getVersion());
    benchMd = benchMarkdown(env, rows);
    status.textContent = `完了：${env.renderer} / ${env.canvas} / DPR ${env.devicePixelRatio}`;
    renderBenchRows(rows);
    $<HTMLButtonElement>('#bench-copy').disabled = false;
    return {env, rows};
  } finally {
    cv.syncPaused = false;
    cv.left.jumpTo({center: cv.right.getCenter(), zoom: cv.right.getZoom(), bearing: cv.right.getBearing(), pitch: cv.right.getPitch()});
  }
}

// ---------------------------------------------------------------------------
// イベント
// ---------------------------------------------------------------------------
function bindEvents() {
  $('#tabs').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-scenario]');
    if (b) loadScenario(b.dataset.scenario!);
  });

  $('#base-select').innerHTML = BASES.map((b) => `<option value="${b.id}">${esc(b.label)}</option>`).join('');
  $('#base-select').addEventListener('change', (e) => {
    state.base = (e.target as HTMLSelectElement).value;
    commit();
  });

  $('#layer-list').addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.dataset.vis) {
      state.layers[el.dataset.vis].visible = (el as HTMLInputElement).checked;
      commit();
      return;
    }
    const up = el.dataset.up;
    const down = el.dataset.down;
    if (up || down) {
      const id = (up ?? down)!;
      const i = state.order.indexOf(id);
      const j = up ? i + 1 : i - 1; // order は下→上
      if (j >= 0 && j < state.order.length) {
        [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
        lastReport = null;
        commit();
      }
      return;
    }
    const li = el.closest<HTMLElement>('[data-layer]');
    if (li) {
      state.target = li.dataset.layer!;
      lastReport = null;
      render();
    }
  });

  $('#target-card').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
    if (!b) return;
    const ls = state.layers[state.target];
    ls.blend = b.dataset.mode as BlendMode;
    ls.visible = true;
    lastReport = null;
    commit();
  });

  $('#target-card').addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const ls = state.layers[state.target];
    if (el.id === 'op-left' || el.id === 'op-right') {
      const v = parseFloat(el.value);
      if (el.id === 'op-left' || linkOpacity) ls.opacityLeft = v;
      if (el.id === 'op-right' || linkOpacity) ls.opacityRight = v;
      cv.apply(state);
      // スライダー操作中に DOM を作り直すとドラッグが切れるので、数値とラベルだけ更新する
      document.querySelectorAll<HTMLElement>('#target-card .slider label span:last-child')[0].textContent = ls.opacityLeft.toFixed(2);
      document.querySelectorAll<HTMLElement>('#target-card .slider label span:last-child')[1].textContent = ls.opacityRight.toFixed(2);
      if (linkOpacity) {
        $<HTMLInputElement>(el.id === 'op-left' ? '#op-right' : '#op-left').value = String(v);
      }
      const td = getOverlay(state.target);
      $('#lbl-left').textContent = `${td.label}: normal / opacity ${ls.opacityLeft.toFixed(2)}`;
      $('#lbl-right').textContent = `${td.label}: ${ls.blend} / opacity ${ls.opacityRight.toFixed(2)}`;
      renderCode();
    } else if (el.id === 'op-link') {
      linkOpacity = el.checked;
    }
  });

  $('#btn-reset').addEventListener('click', () => loadScenario(state.scenarioId));

  $('#cmap-select').innerHTML = (Object.keys(COLORMAPS) as ColormapId[]).map((k) => `<option value="${k}">${COLORMAPS[k].label}</option>`).join('');
  $('#cmap-select').addEventListener('change', (e) => {
    state.colormap = (e.target as HTMLSelectElement).value as ColormapId;
    commit({ndvi: true});
  });

  document.querySelectorAll<HTMLButtonElement>('[data-compare]').forEach((b) =>
    b.addEventListener('click', () => {
      state.compareMode = b.dataset.compare as 'split' | 'swipe';
      cv.setMode(state.compareMode, state.swipe);
      render();
    })
  );
  $('#compare').addEventListener('swipe', (e) => (state.swipe = (e as CustomEvent<number>).detail));

  $('#sheet-toggle').addEventListener('click', () => {
    const p = $('#panel');
    p.classList.toggle('collapsed');
    $('#sheet-toggle').setAttribute('aria-expanded', String(!p.classList.contains('collapsed')));
  });

  // ピクセル検査
  $('#inspect-toggle').addEventListener('change', (e) => {
    $('#compare').classList.toggle('inspecting', (e.target as HTMLInputElement).checked);
    renderInspect();
  });
  for (const m of [cv.left, cv.right]) {
    m.on('click', (e) => {
      if (!$<HTMLInputElement>('#inspect-toggle').checked) return;
      lastReport = inspectPixel(cv.left, cv.right, state, e.point.x, e.point.y);
      renderInspect();
      $('#panel').classList.remove('collapsed');
      $('#inspect-result').scrollIntoView({block: 'nearest', behavior: 'smooth'});
    });
    // 読み取り欄
    m.on('mousemove', (e) => {
      const ro = $('#readout');
      ro.hidden = false;
      const {lng, lat} = e.lngLat;
      let html = `<span>${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`;
      if (state.layers.ndvi.visible) {
        const v = sampleNdvi(ndvi, lng, lat);
        if (v !== null) {
          const c = colorAt(COLORMAPS[state.colormap], v);
          html += `<span>NDVI <b>${v.toFixed(3)}</b></span><span>凡例色 ${sw(c)} ${c.join(',')}</span>`;
        }
      }
      ro.innerHTML = html;
    });
    m.on('mouseout', () => ($('#readout').hidden = true));
  }

  // ダイアログ
  $('#btn-modes').addEventListener('click', () => {
    renderModesTable();
    $<HTMLDialogElement>('#dlg-modes').showModal();
  });
  $('#btn-bench').addEventListener('click', () => {
    $('#bench-target').innerHTML = OVERLAYS.map((o) => `<option value="${o.id}" ${o.id === state.target ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    $<HTMLDialogElement>('#dlg-bench').showModal();
  });
  $('#bench-run').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('#bench-run');
    btn.disabled = true;
    try {
      await doBench($<HTMLSelectElement>('#bench-target').value, parseInt($<HTMLInputElement>('#bench-frames').value, 10) || 40);
    } finally {
      btn.disabled = false;
    }
  });
  $('#bench-copy').addEventListener('click', () => navigator.clipboard.writeText(benchMd));
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
async function main() {
  // v6 は Worker を別ファイル（ESM）で読み込む。バンドル後は既定の相対パスが解決できないため明示する
  maplibregl.setWorkerUrl(workerUrl);
  $('#ml-version').textContent = `v${maplibregl.getVersion()}`;
  ndvi = await loadNdvi();
  const first = SCENARIOS[0];
  state = scenarioState(first, LAYER_IDS);
  const style = buildStyle(renderNdvi(ndvi, state.colormap));
  cv = createCompare($('#compare'), style, first.view);
  cv.setMode(state.compareMode, state.swipe);
  await cv.ready;
  bindEvents();
  startFpsMeter($('#fps'), [cv.left, cv.right]);
  commit();

  // 検証スクリプト（scripts/verify.mjs）から操作するための口
  Object.assign(window, {
    __lab: {
      maplibregl,
      get state() {
        return state;
      },
      cv,
      loadScenario,
      set(mut: (s: AppState) => void, opts?: {ndvi?: boolean}) {
        mut(state);
        commit(opts);
      },
      inspect: (x: number, y: number) => inspectPixel(cv.left, cv.right, state, x, y),
      readPixel: (x: number, y: number) => readPixel(cv.right, x, y),
      coveredPoints: (target: string, n: number) => coveredPoints(cv.right, target, n),
      bench: doBench,
      idle: () => Promise.all([cv.left, cv.right].map((m) => (m.loaded() && m.areTilesLoaded() ? Promise.resolve() : m.once('idle'))))
    }
  });
  document.body.dataset.ready = 'true';
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;inset:auto 10px 10px;color:#f87171">初期化に失敗しました: ${esc(String(err))}</p>`);
});
