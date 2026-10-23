// 文房具の 3D モデル（GLB）を three.js で描く（model3d.js から遅れて読み込む）。
// GLB の材質・写真の質感はそのまま使い、部屋の環境光と弱い光を当てるだけ。
// WebGL の描画は 1 つだけ作り（コンテキストの数に上限があるため）、描いた結果を各表示の canvas に写す。
// モデルは「ペン先が左・クリップが上」に向け、長さ 1 にそろえる（stationery.js の絵と同じ向き）
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const api = window.daigaku;
let renderer = null;
let envMap = null;
const models = new Map(); // model id → Promise<{scene, group}>

function gl() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  envMap = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  return renderer;
}

async function loadNow(id) {
  const r = await api['stationery.model']({model: id});
  if (r?.error) throw new Error(r.error);
  const b = r.bytes;
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  gl(); // 環境光を先に用意する
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const obj = gltf.scene;
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // GLB の軸：ペン先が y=0、クリップが +z。→ Z で −90°（y→x）、X で −90°（z→y）の順に回す
  const inner = new THREE.Group();
  obj.position.set(-c.x, -c.y, -c.z);
  inner.add(obj);
  inner.rotation.set(-Math.PI / 2, 0, -Math.PI / 2, 'XYZ');
  inner.scale.setScalar(1 / size.y);
  const group = new THREE.Group();
  group.add(inner);
  const scene = new THREE.Scene();
  scene.add(group);
  scene.environment = envMap;
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(-1, 2, 2.5);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  return {scene, group};
}

function load(id) {
  if (!models.has(id)) {
    const p = loadNow(id);
    p.catch(() => models.delete(id));
    models.set(id, p);
  }
  return models.get(id);
}

/** 横から描いた画像（data URL の PNG）。stationery.js の絵の viewBox（200×28）と同じ比率 */
export async function snapshot(id, {w = 1600, h = 224} = {}) {
  const m = await load(id);
  const g = gl();
  g.setSize(w, h, false);
  const viewW = 1.04;
  const viewH = (viewW * h) / w;
  const cam = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 0.01, 10);
  cam.position.set(0, 0, 3);
  cam.lookAt(0, 0, 0);
  m.group.rotation.set(0, 0, 0);
  g.render(m.scene, cam);
  return g.domElement.toDataURL('image/png');
}

/** el の中に、ドラッグで回せる 3D 表示を作る。見えている間だけ描き、el が画面から消えたらやめる */
export function mount(el, id) {
  const canvas = document.createElement('canvas');
  canvas.className = 'model-view__canvas';
  el.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  const cam = new THREE.PerspectiveCamera(26, 1, 0.01, 20);
  cam.position.set(0.08, 0.4, 1.75);
  const controls = new OrbitControls(cam, canvas);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  let dragging = false;
  controls.addEventListener('start', () => (dragging = true));
  controls.addEventListener('end', () => (dragging = false));
  let model = null;
  let visible = true;
  let raf = 0;
  let last = 0;
  const size = () => {
    const r = el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    cam.aspect = Math.max(0.1, r.width / Math.max(1, r.height));
    cam.updateProjectionMatrix();
  };
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) tick();
  });
  const ro = new ResizeObserver(size);
  const stop = () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    controls.dispose();
  };
  const tick = (t = 0) => {
    cancelAnimationFrame(raf);
    if (!canvas.isConnected) return stop();
    if (!visible || !model) return;
    // ペンを軸のまわりにゆっくり転がす（ドラッグ中は止める）
    if (!dragging) model.group.rotation.x += Math.min(0.05, (t - last) / 1000) * 0.6;
    last = t;
    controls.update();
    const g = gl();
    if (g.domElement.width !== canvas.width || g.domElement.height !== canvas.height)
      g.setSize(canvas.width, canvas.height, false);
    g.render(model.scene, cam);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(g.domElement, 0, 0);
    raf = requestAnimationFrame(tick);
  };
  size();
  io.observe(el);
  ro.observe(el);
  load(id).then(
    (m) => {
      model = m;
      el.classList.add('is-ready');
      tick();
    },
    (e) => {
      stop();
      throw e;
    }
  );
}
