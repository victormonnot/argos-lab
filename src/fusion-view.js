import './fusion-view.css';
import { createWorkshopDrone, setWorkshopDrone, createWorkshopStage, addWorkshopCameraUI } from './workshop-scene.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#446e91', '#947658', '#617e78'];
const TRUTH_COLOR = '#34434b';
function element(name, attributes = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function releaseGroup(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse((node) => {
    node.shadow?.dispose();
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); group.clear();
}

// Move annotations, never estimates. Leader lines retain the identity of each
// estimate when several means converge to the same point. Units may be SVG
// units or CSS pixels; the positions and uncertainty geometry are unchanged.
function placeLabels(items, width, top, bottom, unit = 1) {
  const occupied = items.map(({ x, y }) => ({ x: x - 9 * unit, y: y - 9 * unit, w: 18 * unit, h: 18 * unit }));
  const overlap = (box) => occupied.reduce((sum, other) => sum + Math.max(0, Math.min(box.x + box.w + 4 * unit, other.x + other.w) - Math.max(box.x - 4 * unit, other.x)) * Math.max(0, Math.min(box.y + box.h + 4 * unit, other.y + other.h) - Math.max(box.y - 4 * unit, other.y)), 0);
  return items.map((item) => {
    const w = (item.text.length * 6.6 + 12) * unit, h = 21 * unit, gap = 11 * unit;
    const offsets = [[-w - gap, -h - gap], [gap, -h - gap], [gap, gap], [-w - gap, gap]];
    const preferred = item.side ?? 0;
    const candidates = [...offsets.slice(preferred), ...offsets.slice(0, preferred)];
    for (const distance of [2, 3, 4]) {
      candidates.push([-w / 2, -h - gap * distance], [-w / 2, gap * distance], [-w - gap * distance, -h / 2], [gap * distance, -h / 2]);
    }
    const boxes = candidates.map(([dx, dy]) => ({ x: Math.max(8 * unit, Math.min(width - w - 8 * unit, item.x + dx)), y: Math.max(top, Math.min(bottom - h, item.y + dy)), w, h }));
    let box = boxes.reduce((best, candidate) => overlap(candidate) < overlap(best) ? candidate : best);
    if (overlap(box) > 0) {
      // A narrow screen may not have a free quadrant near a converged group.
      // Search the remaining annotation area, preferring the nearest free slot.
      const free = [];
      for (let y = top; y <= bottom - h; y += h + 6 * unit) {
        for (let x = 8 * unit; x <= width - w - 8 * unit; x += 12 * unit) {
          const candidate = { x, y, w, h };
          if (overlap(candidate) === 0) free.push(candidate);
        }
      }
      const distance = (candidate) => Math.hypot(candidate.x + w / 2 - item.x, candidate.y + h / 2 - item.y);
      if (free.length) box = free.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best);
    }
    occupied.push(box);
    return { item, box };
  });
}

/** Both views observe one supplied fusion snapshot. Marker positions are target
 * estimates, never agent positions. The stationary observer layout is illustrative,
 * not sensing geometry. Heights are decorative; model y maps to -z.
 * Truth is displayed for the learner but is never fed to a fusion update. */
export function createFusionView(container) {
  let run, selected = 0, mode = '2d', world, loading = false, failed = false, disposed = false, following = false;
  const svg = element('svg', { viewBox: '0 0 760 600', class: 'fusion-svg', role: 'img', 'aria-label': 'Three target estimates and reported uncertainty contours. A1 is a circle, A2 a diamond, A3 a square; T is evaluator-only target truth. Trails are estimate revisions, not robot motion.' });
  const layer = document.createElement('div'); layer.className = 'fusion-three'; layer.hidden = true; container.append(svg, layer);
  function bounds() {
    const points = [...run.readings.map((record) => record.mean), run.truth];
    const low = [0, 1].map((axis) => Math.floor(Math.min(...points.map((point) => point[axis])) - 2));
    const high = [0, 1].map((axis) => Math.ceil(Math.max(...points.map((point) => point[axis])) + 2));
    return { low, high, width: high[0] - low[0], height: high[1] - low[1] };
  }
  function drawSvg() {
    if (!run || disposed) return;
    const { low, high, width, height } = bounds(), size = Math.min(640 / width, 480 / height);
    const scale = Math.min(Math.max(1, container.clientWidth) / 760, Math.max(1, container.clientHeight) / 600);
    const px = (value) => value / scale;
    const left = (760 - size * width) / 2, top = (550 - size * height) / 2;
    const X = (x) => left + (x - low[0]) * size, Y = (y) => top + (high[1] - y) * size;
    svg.replaceChildren(element('rect', { x: left, y: top, width: width * size, height: height * size, fill: '#f7f9f5', stroke: '#bcc9c3', 'stroke-width': px(.8) }));
    for (let x = low[0]; x <= high[0]; x += 1) {
      svg.append(element('path', { d: `M${X(x)} ${Y(low[1])}V${Y(high[1])}`, stroke: '#d5ded8', 'stroke-width': px(.65) }));
      svg.append(element('text', { x: X(x), y: Y(low[1]) + px(17), fill: '#617077', 'font-size': px(10), 'text-anchor': 'middle' }, x));
    }
    for (let y = low[1]; y <= high[1]; y += 1) {
      svg.append(element('path', { d: `M${X(low[0])} ${Y(y)}H${X(high[0])}`, stroke: '#d5ded8', 'stroke-width': px(.65) }));
      svg.append(element('text', { x: left - px(9), y: Y(y) + px(3.5), fill: '#617077', 'font-size': px(10), 'text-anchor': 'end' }, y));
    }
    for (const agent of run.agents) {
      const id = agent.id, cx = X(agent.mean[0]), cy = Y(agent.mean[1]);
      svg.append(element('ellipse', { 'data-fusion-contour': id, 'data-variance': agent.covariance[0], cx, cy, rx: 2 * Math.sqrt(agent.covariance[0]) * size, ry: 2 * Math.sqrt(agent.covariance[1]) * size, fill: COLORS[id], 'fill-opacity': selected === id ? .06 : .015, stroke: COLORS[id], 'stroke-width': px(selected === id ? 1.6 : 1.1), 'stroke-dasharray': ['none', `${px(6)} ${px(4)}`, `${px(2)} ${px(3)}`][id], opacity: selected === id ? 1 : .72 }));
      if (run.history.length > 1) svg.append(element('polyline', { 'data-fusion-trail': id, points: run.history.map((sample) => `${X(sample.means[id][0])},${Y(sample.means[id][1])}`).join(' '), fill: 'none', stroke: COLORS[id], 'stroke-width': px(1.3), 'stroke-dasharray': ['none', `${px(6)} ${px(3)}`, `${px(2)} ${px(3)}`][id], opacity: .75 }));
    }
    const tx = X(run.truth[0]), ty = Y(run.truth[1]);
    svg.append(element('path', { 'data-fusion-truth': '', d: `M${tx - px(6)},${ty}H${tx + px(6)}M${tx},${ty - px(6)}V${ty + px(6)}`, stroke: TRUTH_COLOR, 'stroke-width': px(1.6), fill: 'none' }));
    const annotations = [];
    for (const agent of run.agents) {
      const id = agent.id, cx = X(agent.mean[0]), cy = Y(agent.mean[1]);
      const group = element('g', { 'data-fusion-estimate': id, 'data-x': agent.mean[0], 'data-y': agent.mean[1], 'data-selected': String(id === selected), fill: 'none', stroke: COLORS[id], 'stroke-width': px(1.6) });
      if (id === 0) group.append(element('circle', { cx, cy, r: px(4.5) }));
      if (id === 1) group.append(element('path', { d: `M${cx},${cy - px(8)}L${cx + px(8)},${cy}L${cx},${cy + px(8)}L${cx - px(8)},${cy}Z` }));
      if (id === 2) group.append(element('rect', { x: cx - px(9), y: cy - px(9), width: px(18), height: px(18) }));
      group.append(element('title', {}, `A${id + 1} target estimate; selected ${id === selected}.`));
      annotations.push({ key: id, text: `A${id + 1}`, x: cx, y: cy, color: COLORS[id], side: id });
      svg.append(group);
    }
    annotations.push({ key: 'truth', text: 'T', x: tx, y: ty, color: TRUTH_COLOR, side: 3 });
    for (const { item, box } of placeLabels(annotations, 760, 0, 535, 1 / scale)) {
      const label = element('g', { 'data-fusion-label': item.key, 'aria-hidden': 'true' });
      label.append(element('line', { x1: item.x, y1: item.y, x2: Math.max(box.x, Math.min(box.x + box.w, item.x)), y2: Math.max(box.y, Math.min(box.y + box.h, item.y)), stroke: item.color, 'stroke-width': px(.7) }));
      label.append(element('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: px(2), fill: '#fbfcfa', stroke: '#dbe1dd', 'stroke-width': px(.7) }));
      label.append(element('text', { x: box.x + px(5), y: box.y + px(14), fill: item.color, 'font-size': px(11), 'font-weight': item.key === selected ? 600 : 400 }, item.text));
      svg.append(label);
    }
    svg.append(element('text', { x: 380, y: Math.min(590, Y(low[1]) + px(38)), fill: '#617077', 'font-size': px(10), 'text-anchor': 'middle' }, 'Target estimates (m) · y increases upward'));
  }
  function disposeWorld() {
    if (!world) return;
    const previous = world; world = undefined;
    previous.controls.removeEventListener('change', drawThree); previous.controls.dispose(); releaseGroup(previous.scene); previous.renderer.dispose();
  }
  function unavailable(message) {
    failed = true; disposeWorld();
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'fusion-webgl-message', textContent: message }));
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.textContent = 'Loading 3D…';
    let renderer, scene, controls;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.setAttribute('aria-label', 'Stationary observer drones on illustrative pads, with separate planar target estimates and uncertainty contours. The pads are not measured agent locations. Drag to orbit, scroll to zoom, or use arrow keys to pan.');
      renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); if (!disposed) unavailable('3D context lost. Continue the same fusion run in 2D.'); });
      scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(46, 1, .1, 150);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.minDistance = 2; controls.maxDistance = 55; controls.maxPolarAngle = Math.PI / 2 - .12;
      controls.listenToKeyEvents(renderer.domElement);
      const content = new THREE.Group(), yard = new THREE.Group(); scene.add(yard, content);
      const overlay = document.createElement('div'); overlay.className = 'fusion-labels'; overlay.setAttribute('aria-hidden', 'true');
      const labels = run.agents.map((agent) => {
        const node = document.createElement('span'); node.textContent = `A${agent.id + 1} estimate`; node.dataset.agent = agent.id; node.className = 'fusion-agent-label'; node.style.color = COLORS[agent.id]; overlay.append(node); return node;
      });
      const observerLabels = run.agents.map((agent) => {
        const node = document.createElement('span'); node.textContent = `A${agent.id + 1} observer`; node.className = 'fusion-observer-label'; node.style.color = COLORS[agent.id]; overlay.append(node); return node;
      });
      const truthLabel = document.createElement('span'); truthLabel.textContent = 'T'; truthLabel.className = 'fusion-truth-label'; truthLabel.style.color = TRUTH_COLOR; overlay.append(truthLabel);
      const leaderLayer = element('svg', { class: 'fusion-label-leaders', 'aria-hidden': 'true' });
      const leaders = [...labels, ...observerLabels, truthLabel].map((label) => {
        const line = element('line', { stroke: label.style.color, 'stroke-width': .7 });
        leaderLayer.append(line); return line;
      });
      overlay.prepend(leaderLayer);
      layer.replaceChildren(renderer.domElement, overlay);
      const cameraUI = addWorkshopCameraUI(layer, { prefix: 'fusion',
        caption: 'Observers stay still. Shapes mark target estimates; trails show revisions. Heights are for display.',
        onWhole: () => frameCamera(false), onFollow: () => frameCamera(true) });
      world = { THREE, renderer, scene, camera, controls, cameraUI, content, yard, labels, observerLabels, truthLabel, leaders,
        layoutKey: null, anchors: [], observers: [], truthAnchor: null, selected };
      controls.addEventListener('change', drawThree); updateThree(); resize();
    } catch {
      controls?.dispose(); if (scene) releaseGroup(scene); renderer?.dispose(); world = undefined;
      if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2; the 2D view and fusion controls remain available.');
    } finally { loading = false; }
  }
  function updateThree() {
    if (!world || !run || failed || disposed) return;
    const { THREE } = world, { low, high, width, height } = bounds();
    const layoutKey = `${low}/${high}`;
    if (layoutKey !== world.layoutKey) {
      releaseGroup(world.yard);
      createWorkshopStage(THREE, world.yard, world.renderer, {
        center: [(low[0] + high[0]) / 2, -(low[1] + high[1]) / 2 + 1.2], size: [width + 1, height + 3.4], grid: 1,
        palette: { floor: '#e2e6e0', edge: '#a2ada7', trim: '#c6cec7', metal: '#8a999c', grid: '#617780', lamp: '#e3ebed', lampEmissive: '#94acb8', sky: '#f4f6f4', ground: '#8b9189', sun: '#fff6e9' },
      });
      // Fusion has no agent poses. These pads only identify the three observers,
      // remain fixed during all rounds, and are never used in an update.
      world.observers = run.agents.map(({ id }) => {
        const x = low[0] + width * (.18 + id * .32), z = -low[1] + 1.6;
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(.65, .7, .1, 32), new THREE.MeshStandardMaterial({ color: '#c6d0c8', roughness: .8 }));
        pad.position.set(x, .045, z); pad.receiveShadow = true; pad.castShadow = true; world.yard.add(pad);
        const ring = new THREE.Mesh(new THREE.RingGeometry(.48, .52, 40), new THREE.MeshBasicMaterial({ color: COLORS[id], side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(x, .101, z); world.yard.add(ring);
        const drone = createWorkshopDrone(THREE, { color: COLORS[id], size: 1.1, id: `A${id + 1}` });
        setWorkshopDrone(drone, { position: [x, .29, z], heading: Math.PI / 2, phase: 0, active: false });
        drone.userData.bodyMaterial.color.set(COLORS[id]);
        world.yard.add(drone); return drone;
      });
      world.layoutKey = layoutKey; frameCamera(following);
    }
    releaseGroup(world.content);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ color: '#f7f9f5', roughness: 1, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((low[0] + high[0]) / 2, .01, -(low[1] + high[1]) / 2); floor.receiveShadow = true; world.content.add(floor);
    const grid = [];
    for (let x = low[0]; x <= high[0]; x += 1) grid.push(new THREE.Vector3(x, .018, -low[1]), new THREE.Vector3(x, .018, -high[1]));
    for (let y = low[1]; y <= high[1]; y += 1) grid.push(new THREE.Vector3(low[0], .018, -y), new THREE.Vector3(high[0], .018, -y));
    world.content.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(grid), new THREE.LineBasicMaterial({ color: '#c5d1ca' })));
    const line = (points, color, { loop = false, opacity = 1 } = {}) => {
      const result = new THREE[loop ? 'LineLoop' : 'Line'](new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
      world.content.add(result); return result;
    };
    world.anchors = run.agents.map((agent) => {
      const id = agent.id, [x, y] = agent.mean, altitude = .08 + id * .025;
      const circle = (rx, ry, z) => Array.from({ length: 72 }, (_, index) => { const angle = index * Math.PI * 2 / 72; return new THREE.Vector3(x + Math.cos(angle) * rx, z, -y - Math.sin(angle) * ry); });
      line(circle(2 * Math.sqrt(agent.covariance[0]), 2 * Math.sqrt(agent.covariance[1]), .035 + id * .01), COLORS[id], { loop: true, opacity: id === selected ? 1 : .55 });
      if (run.history.length > 1) line(run.history.map((sample) => new THREE.Vector3(sample.means[id][0], .045 + id * .01, -sample.means[id][1])), COLORS[id], { opacity: .65 });
      if (id === 0) line(circle(.09, .09, altitude), COLORS[id], { loop: true });
      else {
        const points = id === 1 ? [[0, -.16], [.16, 0], [0, .16], [-.16, 0]] : [[-.18, -.18], [.18, -.18], [.18, .18], [-.18, .18]];
        line(points.map(([dx, dy]) => new THREE.Vector3(x + dx, altitude, -y - dy)), COLORS[id], { loop: true });
      }
      return new THREE.Vector3(x, altitude, -y);
    });
    const [tx, ty] = run.truth;
    line([new THREE.Vector3(tx - .15, .14, -ty), new THREE.Vector3(tx + .15, .14, -ty)], TRUTH_COLOR);
    line([new THREE.Vector3(tx, .14, -ty - .15), new THREE.Vector3(tx, .14, -ty + .15)], TRUTH_COLOR);
    world.truthAnchor = new THREE.Vector3(tx, .14, -ty);
    world.cameraUI.setFollowLabel(`Inspect A${selected + 1}`);
    if (following && world.selected !== selected) frameCamera(true);
    world.selected = selected;
    drawThree();
  }
  function frameCamera(follow) {
    if (!world || !run) return;
    following = follow; world.cameraUI.setFollowing(follow);
    if (follow && world.observers[selected]) {
      world.controls.target.copy(world.observers[selected].position);
      world.camera.position.copy(world.controls.target).add(new world.THREE.Vector3(2.4, 2.2, 2.8));
    } else {
      const { low, high, width, height } = bounds(), span = Math.max(width + 1, height + 3.4), fit = Math.max(1.18, 1.08 / world.camera.aspect);
      world.controls.target.set((low[0] + high[0]) / 2, -.8, -(low[1] + high[1]) / 2 + 1.2);
      world.camera.position.copy(world.controls.target).add(new world.THREE.Vector3(span * .12, span * 1.12, span * .9).multiplyScalar(fit));
    }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    world.renderer.render(world.scene, world.camera);
    const width = container.clientWidth, height = container.clientHeight;
    const items = [];
    const project = (anchor, label, line, side) => {
      if (!anchor) { label.hidden = true; line.style.display = 'none'; return; }
      const point = anchor.clone().project(world.camera);
      label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      line.style.display = label.hidden ? 'none' : '';
      if (!label.hidden) items.push({ x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, text: label.textContent, label, line, side });
    };
    world.anchors.forEach((anchor, id) => { world.labels[id].style.fontWeight = id === selected ? '600' : '400'; project(anchor, world.labels[id], world.leaders[id], id); });
    project(world.truthAnchor, world.truthLabel, world.leaders[6], 3);
    world.observers.forEach((drone, id) => project(drone.position, world.observerLabels[id], world.leaders[id + 3], 2));
    const controlsBottom = world.cameraUI.wholeButton.parentElement.offsetTop + world.cameraUI.wholeButton.parentElement.offsetHeight;
    const caption = layer.querySelector('.workshop-scene-caption');
    const bottom = caption ? caption.offsetTop - 8 : height - 70;
    for (const { item, box } of placeLabels(items, width, controlsBottom + 10, bottom)) {
      item.label.style.left = `${box.x}px`; item.label.style.top = `${box.y}px`;
      item.line.setAttribute('x1', item.x); item.line.setAttribute('y1', item.y);
      item.line.setAttribute('x2', Math.max(box.x, Math.min(box.x + box.w, item.x)));
      item.line.setAttribute('y2', Math.max(box.y, Math.min(box.y + box.h, item.y)));
    }
  }
  function resize() {
    drawSvg();
    if (!world || failed || disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    const changed = world.viewportWidth !== width || world.viewportHeight !== height;
    world.viewportWidth = width; world.viewportHeight = height;
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix();
    if (changed && !following) frameCamera(false); else drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(state, observer = 0) { if (disposed) return; run = state; selected = observer; drawSvg(); updateThree(); },
    setMode(nextMode) {
      if (!['2d', '3d'].includes(nextMode)) throw new Error('Unknown fusion view.');
      if (disposed) return;
      mode = nextMode; svg.style.display = mode === '2d' ? '' : 'none'; layer.hidden = mode !== '3d';
      if (mode === '3d') void prepareThree();
      if (world) world.controls.enabled = mode === '3d' && !failed; resize();
    },
    dispose() { disposed = true; observer.disconnect(); disposeWorld(); container.replaceChildren(); },
  };
}
