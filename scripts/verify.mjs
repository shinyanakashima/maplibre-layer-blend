// 検証スクリプト：スクリーンショット、ピクセル照合、描画順序の影響、性能計測を docs/ に出力する。
// 使い方: npm run build && npx vite preview --port 4173 & node scripts/verify.mjs [URL]
// Playwright（Chromium）が必要。GPU のない環境では SwiftShader（ソフトウェア描画）で動く。
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.argv[2] ?? 'http://localhost:4173/';
const SHOTS = join(ROOT, 'docs/screenshots');
const RESULTS = join(ROOT, 'docs/results');
const SKIP_BENCH = process.env.SKIP_BENCH === '1';
mkdirSync(join(SHOTS, 'modes'), {recursive: true});
mkdirSync(RESULTS, {recursive: true});

const MODES = ['normal', 'multiply', 'screen', 'overlay', 'plus-lighter', 'color', 'luminosity'];

const browser = await chromium.launch({args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(URL);
await page.waitForSelector('body[data-ready=true]', {timeout: 60000});

const idle = async () => {
  await page.evaluate(() => window.__lab.idle());
  await page.waitForTimeout(400);
};
const scenario = async (id) => {
  await page.evaluate((id) => window.__lab.loadScenario(id), id);
  await idle();
};
const set = async (fn, arg, opts) => {
  await page.evaluate(([fnSrc, arg, opts]) => window.__lab.set((s) => new Function('s', 'arg', fnSrc)(s, arg), opts), [fn, arg, opts]);
  await idle();
};
const rightClip = async () => page.evaluate(() => {
  const r = document.querySelector('#map-right').getBoundingClientRect();
  return {x: r.x, y: r.y, width: r.width, height: r.height};
});

// ---------------------------------------------------------------------------
// 1. 各デモの全体スクリーンショット
// ---------------------------------------------------------------------------
const env = await page.evaluate(() => {
  const gl = window.__lab.cv.right.getCanvas().getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    userAgent: navigator.userAgent,
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maplibre: window.__lab.maplibregl.getVersion(),
    viewport: `${innerWidth}x${innerHeight}`,
    dpr: devicePixelRatio
  };
});
console.log('env', env);

for (const id of ['demo1', 'demo2', 'demo3']) {
  await scenario(id);
  await page.screenshot({type: 'jpeg', quality: 85, path: join(SHOTS, `${id}.jpg`)});
  console.log('shot', id);
}
await scenario('demo3');
await page.click('[data-compare="swipe"]');
await idle();
await page.screenshot({type: 'jpeg', quality: 85, path: join(SHOTS, 'demo3-swipe.jpg')});
await page.click('[data-compare="split"]');
await idle();
await set(`s.base = 'dark';`, {});
await page.screenshot({type: 'jpeg', quality: 85, path: join(SHOTS, 'demo3-dark.jpg')});

// ピクセル検査 UI
await scenario('demo1');
await page.check('#inspect-toggle');
{
  const c = await rightClip();
  await page.mouse.click(c.x + c.width * 0.55, c.y + c.height * 0.45);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#inspect-result').scrollIntoView({block: 'center'}));
  await page.screenshot({type: 'jpeg', quality: 85, path: join(SHOTS, 'pixel-inspector.jpg')});
}
await page.uncheck('#inspect-toggle');

// モード一覧
await page.click('#btn-modes');
await page.waitForTimeout(300);
await page.screenshot({type: 'jpeg', quality: 85, path: join(SHOTS, 'modes-table.jpg')});
await page.keyboard.press('Escape');

// ---------------------------------------------------------------------------
// 2. モード別の切り抜き（右画面）
// ---------------------------------------------------------------------------
const modeShots = {demo1: 'hillshade', demo2: 'ndvi', demo3: 'roads'};
for (const [demo, target] of Object.entries(modeShots)) {
  await scenario(demo);
  for (const mode of MODES) {
    await set(
      `s.layers[arg.t].blend = arg.m; if (arg.d === 'demo3') s.layers.rivers.blend = arg.m;`,
      {t: target, m: mode, d: demo}
    );
    const c = await rightClip();
    await page.screenshot({type: 'jpeg', quality: 85, path: join(SHOTS, 'modes', `${demo}-${mode}.jpg`), clip: {x: c.x + c.width / 2 - 240, y: c.y + c.height / 2 - 160, width: 480, height: 320}});
  }
  // 左画面（通常合成 Opacity）の同じ範囲
  const l = await page.evaluate(() => {
    const r = document.querySelector('#map-left').getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height};
  });
  await page.screenshot({type: 'jpeg', quality: 85, path: join(SHOTS, 'modes', `${demo}-opacity.jpg`), clip: {x: l.x + l.width / 2 - 240, y: l.y + l.height / 2 - 160, width: 480, height: 320}});
  console.log('modes', demo);
}

// ---------------------------------------------------------------------------
// 3. ピクセル照合：実測値 と W3C 式による理論値
// ---------------------------------------------------------------------------
const pixel = [];
const cases = [
  {demo: 'demo1', target: 'hillshade'},
  {demo: 'demo2', target: 'ndvi'},
  {demo: 'demo3', target: 'water'},
  {demo: 'demo3', target: 'roads'}
];
const coveredPoints = (target, n) => page.evaluate(([t, n]) => window.__lab.coveredPoints(t, n), [target, n]);
for (const c of cases) {
  await scenario(c.demo);
  await set(`s.target = arg.t; s.layers[arg.t].visible = true;`, {t: c.target});
  const pts = await coveredPoints(c.target, 12);
  for (const mode of MODES) {
    for (const op of [1, 0.5]) {
      await set(`s.layers[arg.t].blend = arg.m; s.layers[arg.t].opacityRight = arg.op; s.layers[arg.t].visible = true; s.target = arg.t;`, {t: c.target, m: mode, op});
      const reps = [];
      for (const [x, y] of pts) reps.push(await page.evaluate(([x, y]) => window.__lab.inspect(x, y), [x, y]));
      const covered = reps.filter((r) => r.source[3] > 0);
      const diffs = covered.map((r) => r.maxDiffBlend);
      pixel.push({
        demo: c.demo,
        target: c.target,
        mode,
        opacity: op,
        points: covered.length,
        maxDiff: diffs.length ? Math.max(...diffs) : null,
        meanDiff: diffs.length ? +(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2) : null,
        sample: covered[0] ? {backdrop: covered[0].backdrop, source: covered[0].source, actual: covered[0].actualBlend, expected: covered[0].expectedBlend} : null
      });
    }
  }
  console.log('pixel', c.demo, c.target, pts.length);
}
writeFileSync(join(RESULTS, 'pixel-check.json'), JSON.stringify({env, pixel}, null, 2));

// ---------------------------------------------------------------------------
// 4. 描画順序の影響：ラスター 2 枚の順序を入れ替え、同じ画素の差を測る
// ---------------------------------------------------------------------------
const orderTests = [
  ['multiply', 'multiply'],
  ['screen', 'screen'],
  ['multiply', 'screen'],
  ['overlay', 'normal'],
  ['overlay', 'multiply'],
  ['color', 'luminosity']
];
const order = [];
await scenario('free');
await set(`for (const k in s.layers) s.layers[k].visible = false; s.base = 'photo';`, {});
const size = await rightClip();
const grid = [];
for (let i = 1; i <= 6; i++) for (let j = 1; j <= 4; j++) grid.push([Math.round((size.width * i) / 7), Math.round((size.height * j) / 5)]);
for (const [a, b] of orderTests) {
  const read = async (orderArr) => {
    await set(
      `s.order = arg.order; s.layers.relief.visible = true; s.layers.hillshade.visible = true; s.layers.relief.blend = arg.a; s.layers.hillshade.blend = arg.b; s.layers.relief.opacityRight = 1; s.layers.hillshade.opacityRight = 1;`,
      {order: orderArr, a, b}
    );
    return page.evaluate((pts) => pts.map(([x, y]) => window.__lab.readPixel(x, y)), grid);
  };
  const others = ['slope', 'ndvi', 'water', 'buildings', 'rivers', 'roads'];
  const p1 = await read([...others, 'hillshade', 'relief']); // relief が手前
  const p2 = await read([...others, 'relief', 'hillshade']); // hillshade が手前
  const diffs = p1.map((p, k) => Math.max(...[0, 1, 2].map((ch) => Math.abs(p[ch] - p2[k][ch]))));
  order.push({relief: a, hillshade: b, maxDiff: Math.max(...diffs), meanDiff: +(diffs.reduce((x, y) => x + y, 0) / diffs.length).toFixed(2)});
  console.log('order', a, b);
}
writeFileSync(join(RESULTS, 'order-check.json'), JSON.stringify({env, order}, null, 2));

// ---------------------------------------------------------------------------
// 5. 性能計測
// ---------------------------------------------------------------------------
let bench = [];
if (!SKIP_BENCH) {
  for (const [demo, target] of [['demo1', 'hillshade'], ['demo3', 'roads']]) {
    await scenario(demo);
    const r = await page.evaluate((t) => window.__lab.bench(t, 60), target);
    bench.push({demo, target, ...r});
    console.log('bench', demo);
  }
  writeFileSync(join(RESULTS, 'bench.json'), JSON.stringify(bench, null, 2));
}

// ---------------------------------------------------------------------------
// 6. スマートフォン表示
// ---------------------------------------------------------------------------
{
  const {devices} = require('playwright');
  const ctx = await browser.newContext({...devices['iPhone 13']});
  const mp = await ctx.newPage();
  await mp.goto(URL);
  await mp.waitForSelector('body[data-ready=true]', {timeout: 60000});
  await mp.evaluate(() => window.__lab.loadScenario('demo2'));
  await mp.evaluate(() => window.__lab.idle());
  await mp.waitForTimeout(800);
  await mp.screenshot({type: 'jpeg', quality: 85, path: join(SHOTS, 'mobile.jpg')});
  await mp.click('#sheet-toggle');
  await mp.evaluate(() => window.__lab.idle());
  await mp.waitForTimeout(500);
  await mp.screenshot({type: 'jpeg', quality: 85, path: join(SHOTS, 'mobile-collapsed.jpg')});
  await ctx.close();
  console.log('mobile');
}

// ---------------------------------------------------------------------------
// 7. Markdown まとめ
// ---------------------------------------------------------------------------
const md = [];
md.push('# 検証結果（自動生成）', '', '`node scripts/verify.mjs` の出力。', '');
md.push('## 実行環境', '', `- MapLibre GL JS: ${env.maplibre}`, `- UA: ${env.userAgent}`, `- WebGL renderer: ${env.renderer}`, `- viewport: ${env.viewport} / DPR ${env.dpr}`, '');
md.push('## ピクセル照合（実測 vs W3C 式）', '', '右画面で対象レイヤーが不透明に覆う 12 点（アンチエイリアスの縁を除く）について「下地」「対象レイヤー単体」を読み、`src/blendModes.ts` の式で計算した理論値と実測値の差（0〜255、RGB の最大値）を取った。', '');
md.push('| データ | 対象 | モード | opacity | 点数 | 最大差 | 平均差 |', '|---|---|---|---:|---:|---:|---:|');
for (const p of pixel) md.push(`| ${p.demo} | ${p.target} | ${p.mode} | ${p.opacity} | ${p.points} | ${p.maxDiff ?? '-'} | ${p.meanDiff ?? '-'} |`);
md.push('', '## 描画順序の影響', '', '色別標高図（relief）と陰影起伏図（hillshade）を航空写真の上に重ね、順序だけを入れ替えたときの画素差（24 点）。', '');
md.push('| relief のモード | hillshade のモード | 最大差 | 平均差 |', '|---|---|---:|---:|');
for (const o of order) md.push(`| ${o.relief} | ${o.hillshade} | ${o.maxDiff} | ${o.meanDiff} |`);
if (bench.length) {
  md.push('', '## 性能計測', '', '同期描画（`map.redraw()`）＋ 1px `readPixels` の所要時間。SwiftShader（CPU によるソフトウェア描画）での値で、実 GPU の性能を示すものではない。', '');
  for (const b of bench) {
    md.push(`### ${b.demo} / ${b.target}`, '', `- GPU: ${b.env.renderer}`, `- キャンバス: ${b.env.canvas}`, '');
    md.push('| ブレンド | opacity | レイヤー数 | 平均 ms | p95 ms | normal比 |', '|---|---:|---:|---:|---:|---:|');
    for (const r of b.rows) {
      const base = b.rows.find((x) => x.layers === r.layers && x.mode === 'normal' && x.opacity === 1);
      md.push(`| ${r.mode} | ${r.opacity} | ${r.layers} | ${r.avgMs} | ${r.p95Ms} | ${(r.avgMs / base.avgMs).toFixed(2)} |`);
    }
    md.push('');
  }
}
writeFileSync(join(RESULTS, 'README.md'), md.join('\n') + '\n');
console.log('done');
await browser.close();
