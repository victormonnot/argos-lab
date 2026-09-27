import './mission-view.css';
import { SERVICE_STEPS, MISSION_DT } from './mission-model.js';
import { createWorkshopDrone, setWorkshopDrone, createWorkshopStage, addWorkshopCameraUI } from './workshop-scene.js';

const NS = 'http://www.w3.org/2000/svg';
const X = (value) => 380 + value * 51;
const Y = (value) => 495 - value * 51;
function element(name, attributes = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Display only: both projections consume the same mission snapshot/history. */
export function createMissionView(container, { selectAgent = () => {} } = {}) {
  let run, selected = 0, mode = '2d', world, loading = false, failed = false, disposed = false;
  // Workshop 04 shares this observer; its presentation stays independent.
  const prefix = container.id.startsWith('arch-') ? 'arch' : 'mission';
  const studio = prefix === 'mission';
  const AGENT_COLORS = studio ? ['#446e91', '#947658', '#78818e'] : ['#72dabb', '#f1c17d', '#91adff'];
  const TASK_COLORS = studio
    ? { pending: '#7a868b', assigned: '#446e91', servicing: '#947658', completed: '#446e91' }
    : { pending: '#758982', assigned: '#c7cec1', servicing: '#e7b976', completed: '#74cba4' };
  const svg = element('svg', { viewBox: '0 0 760 570', class: 'mission-map-svg', role: 'group', 'aria-label': 'Mission map in metres. Select an agent to inspect its executor.' });
  const layer = document.createElement('div'); layer.className = 'mission-three'; layer.hidden = true;
  container.append(svg, layer);

  function drawLegacySvg() {
    if (!run) return;
    const focus = svg.contains(document.activeElement) ? document.activeElement.dataset.missionAgent : null;
    svg.replaceChildren();
    for (let x = -6; x <= 6; x += 1) {
      svg.append(element('line', { x1: X(x), x2: X(x), y1: 60, y2: 540, stroke: '#2b443f', 'stroke-width': .6 }));
      if (x % 2 === 0) svg.append(element('text', { x: X(x), y: 560, fill: '#9bb5a8', 'font-size': 14, 'text-anchor': 'middle' }, x));
    }
    for (let y = 0; y <= 8; y += 2) {
      svg.append(element('line', { x1: 55, x2: 710, y1: Y(y), y2: Y(y), stroke: '#2b443f', 'stroke-width': .6 }));
      svg.append(element('text', { x: 35, y: Y(y) + 5, fill: '#9bb5a8', 'font-size': 14 }, y));
    }
    svg.append(element('text', { x: 701, y: 560, fill: '#9bb5a8', 'font-size': 14 }, 'm'));
    for (const agent of run.agents) {
      svg.append(element('polyline', { points: run.history.map((point) => `${X(point.positions[agent.id][0])},${Y(point.positions[agent.id][1])}`).join(' '), fill: 'none', stroke: AGENT_COLORS[agent.id], 'stroke-width': 2, opacity: .55 }));
      if (agent.taskId !== null) {
        const task = run.tasks[agent.taskId];
        svg.append(element('line', { x1: X(agent.position[0]), y1: Y(agent.position[1]), x2: X(task.position[0]), y2: Y(task.position[1]), stroke: AGENT_COLORS[agent.id], 'stroke-width': 1.5, 'stroke-dasharray': '6 6' }));
      }
    }
    for (const task of run.tasks) {
      const x = X(task.position[0]), y = Y(task.position[1]);
      svg.append(element('rect', { x: x - 10, y: y - 10, width: 20, height: 20, rx: 2, fill: task.state === 'completed' ? TASK_COLORS.completed : '#19312c', stroke: TASK_COLORS[task.state], 'stroke-width': 2 }));
      if (task.state === 'completed') svg.append(element('text', { x, y: y + 5, fill: '#14372b', 'font-size': 16, 'text-anchor': 'middle' }, '✓'));
      svg.append(element('text', { x: x + 17, y: y + 5, fill: TASK_COLORS[task.state], 'font-size': 16 }, `T${task.id + 1}`));
    }
    for (const agent of run.agents) {
      const x = X(agent.position[0]), y = Y(agent.position[1]), color = AGENT_COLORS[agent.id];
      const group = element('g', { tabindex: 0, role: 'button', class: 'mission-agent-node', 'data-mission-agent': agent.id,
        'aria-label': `Inspect agent A${agent.id + 1}, ${agent.state}`, 'aria-pressed': String(selected === agent.id) });
      if (selected === agent.id) group.append(element('circle', { cx: x, cy: y, r: 19, fill: 'none', stroke: '#eff7ed', 'stroke-dasharray': '3 3' }));
      group.append(element('circle', { cx: x, cy: y, r: 10, fill: agent.state === 'unavailable' ? '#37463e' : color, stroke: color, 'stroke-width': 2 }));
      if (agent.state === 'unavailable') group.append(element('path', { d: `M${x - 7},${y - 7}L${x + 7},${y + 7}M${x + 7},${y - 7}L${x - 7},${y + 7}`, stroke: color, 'stroke-width': 2 }));
      group.append(element('text', { x: x - 14, y: y - 19, fill: color, 'font-size': 16, 'text-anchor': 'end' }, `A${agent.id + 1}${agent.state === 'unavailable' ? ' ×' : ''}`));
      group.addEventListener('click', () => selectAgent(agent.id));
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAgent(agent.id); } });
      svg.append(group);
    }
    if (focus !== null) svg.querySelector(`[data-mission-agent="${focus}"]`)?.focus({ preventScroll: true });
  }
  function drawSvg() {
    if (!studio) { drawLegacySvg(); return; }
    if (!run || disposed) return;
    // One scale preserves physical distances; text and point symbols use CSS pixels.
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    const scale = Math.max(1, Math.min((width - 80) / 12, (height - 90) / 9));
    const x = (value) => width / 2 + value * scale;
    const y = (value) => height / 2 + (3.5 - value) * scale;
    const focus = svg.contains(document.activeElement) ? document.activeElement.dataset.missionAgent : null;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    for (let column = -6; column <= 6; column += 1) {
      svg.append(element('line', { x1: x(column), x2: x(column), y1: y(8), y2: y(-1), stroke: '#d6dfde', 'stroke-width': .7 }));
      if (column % 2 === 0) svg.append(element('text', { x: x(column), y: y(-1) + 20, fill: '#617077', 'font-size': 11, 'text-anchor': 'middle' }, column));
    }
    for (let row = -1; row <= 8; row += 1) {
      svg.append(element('line', { x1: x(-6), x2: x(6), y1: y(row), y2: y(row), stroke: '#d6dfde', 'stroke-width': .7 }));
      if (row % 2 === 0) svg.append(element('text', { x: x(-6) - 12, y: y(row) + 4, fill: '#617077', 'font-size': 11, 'text-anchor': 'end' }, row));
    }
    svg.append(element('text', { x: x(6), y: y(-1) + 37, fill: '#617077', 'font-size': 11, 'text-anchor': 'end' }, 'x · m'));
    svg.append(element('text', { x: x(-6), y: y(8) - 13, fill: '#617077', 'font-size': 11 }, 'y · m'));
    for (const agent of run.agents) {
      svg.append(element('polyline', { points: run.history.map((point) => `${x(point.positions[agent.id][0])},${y(point.positions[agent.id][1])}`).join(' '), fill: 'none', stroke: AGENT_COLORS[agent.id], 'stroke-width': 1.5, opacity: .6 }));
      if (agent.taskId !== null) {
        const task = run.tasks[agent.taskId];
        svg.append(element('line', { x1: x(agent.position[0]), y1: y(agent.position[1]), x2: x(task.position[0]), y2: y(task.position[1]), stroke: AGENT_COLORS[agent.id], 'stroke-width': 1.3, 'stroke-dasharray': '4 4' }));
      }
    }
    const occupied = run.tasks.concat(run.agents).map(({ position }) => ({ x: x(position[0]) - 8, y: y(position[1]) - 8, w: 16, h: 16 }));
    const labelPosition = (cx, cy, agent = false, labelWidth = 30) => {
      const offsets = agent ? [[-labelWidth - 10, 10], [-labelWidth - 10, -30], [12, 10], [12, -30]] : [[12, -30], [12, 10], [-labelWidth - 10, -30], [-labelWidth - 10, 10]];
      offsets.push([-(labelWidth / 2), -48], [-(labelWidth / 2), 28]);
      const candidates = offsets.map(([dx, dy]) => ({ x: Math.max(8, Math.min(width - labelWidth - 8, cx + dx)), y: Math.max(12, Math.min(height - 32, cy + dy)), w: labelWidth, h: 22 }));
      const box = candidates.find((candidate) => !occupied.some((other) => candidate.x < other.x + other.w + 3 && candidate.x + candidate.w + 3 > other.x && candidate.y < other.y + other.h + 3 && candidate.y + candidate.h + 3 > other.y)) || candidates[0];
      occupied.push(box);
      return box;
    };
    const annotations = [];
    for (const task of run.tasks) {
      const cx = x(task.position[0]), cy = y(task.position[1]), color = TASK_COLORS[task.state];
      const group = element('g', { 'data-mission-task': task.id, 'data-state': task.state });
      group.append(element('title', {}, `T${task.id + 1}: ${task.state}`));
      group.append(element('rect', { x: cx - 6, y: cy - 6, width: 12, height: 12, rx: 1, fill: task.state === 'completed' ? '#e4ecf1' : '#fbfcfa', stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': task.state === 'pending' ? '2 2' : 'none' }));
      if (task.state === 'completed') group.append(element('path', { d: `M${cx - 3},${cy}l2,3l5,-6`, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
      if (task.state === 'servicing') {
        const fraction = (SERVICE_STEPS - task.serviceRemaining) / SERVICE_STEPS;
        group.append(element('circle', { cx, cy, r: 10, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': `${fraction * 20 * Math.PI} ${20 * Math.PI}`, transform: `rotate(-90 ${cx} ${cy})` }));
      }
      svg.append(group);
      const box = labelPosition(cx, cy);
      annotations.push({ box, cx, cy, color, text: `T${task.id + 1}` });
    }
    for (const agent of run.agents) {
      const cx = x(agent.position[0]), cy = y(agent.position[1]), color = AGENT_COLORS[agent.id];
      const group = element('g', { tabindex: 0, role: 'button', class: 'mission-agent-node', 'data-mission-agent': agent.id,
        'aria-label': `Inspect agent A${agent.id + 1}, ${agent.state}`, 'aria-pressed': String(selected === agent.id) });
      group.append(element('circle', { cx, cy, r: 10, fill: 'none', stroke: selected === agent.id ? color : 'transparent', 'stroke-dasharray': '2 3', class: 'mission-node-halo' }));
      group.append(element('circle', { cx, cy, r: 5, fill: agent.state === 'unavailable' ? '#fbfcfa' : color, stroke: color, 'stroke-width': 1.5 }));
      if (agent.state === 'unavailable') group.append(element('path', { d: `M${cx - 3},${cy - 3}L${cx + 3},${cy + 3}M${cx + 3},${cy - 3}L${cx - 3},${cy + 3}`, stroke: color, 'stroke-width': 1.5 }));
      const text = `A${agent.id + 1}${agent.state === 'unavailable' ? ' ×' : ''}`;
      const box = labelPosition(cx, cy, true, agent.state === 'unavailable' ? 43 : 30);
      annotations.push({ box, cx, cy, color, text, group });
      group.addEventListener('click', () => selectAgent(agent.id));
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAgent(agent.id); } });
      svg.append(group);
    }
    for (const { box, cx, cy, color, text, group } of annotations) {
      const label = group || element('g', { 'aria-hidden': 'true' });
      label.append(element('line', { x1: cx, y1: cy, x2: Math.max(box.x, Math.min(box.x + box.w, cx)), y2: Math.max(box.y, Math.min(box.y + box.h, cy)), stroke: color, 'stroke-width': .7, opacity: .6 }));
      label.append(element('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 2, fill: '#fbfcfa', class: 'mission-node-label-box' }));
      label.append(element('text', { x: box.x + box.w / 2, y: box.y + 15, fill: '#273438', 'font-size': 11, 'text-anchor': 'middle' }, text));
      if (!group) svg.append(label);
    }
    if (focus !== null) svg.querySelector(`[data-mission-agent="${focus}"]`)?.focus({ preventScroll: true });
  }
  const displayAltitude = 1.5;
  let following = false, cameraPreset = true;
  function disposeWorld() {
    if (!world) return;
    world.controls.dispose();
    const geometries = new Set(), materials = new Set();
    world.scene.traverse((child) => {
      child.shadow?.dispose();
      if (child.geometry) geometries.add(child.geometry);
      if (Array.isArray(child.material)) child.material.forEach((m) => materials.add(m));
      else if (child.material) materials.add(child.material);
    });
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
    world.renderer.dispose(); world = null;
  }
  function unavailable(message) {
    failed = true; disposeWorld();
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'mission-webgl-message', textContent: message }));
  }
  function frameCamera(reset = false) {
    if (!world) return;
    const { camera, controls, THREE } = world;
    if (following && selected !== null) {
      const agent = run.agents[selected];
      const target = new THREE.Vector3(agent.position[0], displayAltitude * .7, -agent.position[1]);
      if (reset) camera.position.copy(target).add(new THREE.Vector3(4.3, 4.2, 5.5));
      else camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
    } else if (reset || cameraPreset) {
      // Enclose the complete task yard at both wide and portrait aspect ratios.
      const width = 14, depth = 11, fit = Math.max(depth, width / Math.max(.55, camera.aspect));
      let distance = fit / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.12;
      const direction = new THREE.Vector3(.16, .76, .86).normalize();
      controls.target.set(0, .45, -3.5);
      if (studio) {
        // Fit all yard corners in perspective, leaving room for controls and caption.
        const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
        const up = direction.clone().cross(right).normalize();
        const tangent = Math.tan(camera.fov * Math.PI / 360);
        const verticalRoom = Math.max(.4, 1 - 150 / Math.max(1, container.clientHeight));
        distance = 0;
        for (const x of [-7.4, 7.4]) for (const y of [-.15, 2]) for (const z of [-9.3, 2.3]) {
          const corner = new THREE.Vector3(x, y, z).sub(controls.target);
          distance = Math.max(distance, corner.dot(direction) + Math.abs(corner.dot(right)) / (tangent * camera.aspect * .9), corner.dot(direction) + Math.abs(corner.dot(up)) / (tangent * verticalRoom));
        }
      }
      camera.position.copy(controls.target).add(direction.multiplyScalar(distance));
    }
    controls.update();
    world.cameraUI.setFollowing(following && selected !== null);
    world.cameraUI.setFollowLabel(selected === null ? 'Select an agent' : `Follow A${selected + 1}`);
    world.cameraUI.followButton.disabled = selected === null;
    layer.dataset.camera = following && selected !== null ? `follow-A${selected + 1}` : 'whole';
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.textContent = 'Loading 3D…';
    let pendingRenderer;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); pendingRenderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.domElement.setAttribute('aria-label', 'Quadrotors and task stations showing the planar mission at a fixed display altitude of 1.5 metres. Drag to orbit, scroll to zoom.');
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable('3D context lost. Continue the same mission in 2D.'); });
      layer.replaceChildren(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .1, 140);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false; controls.minDistance = 4; controls.maxDistance = 60; controls.maxPolarAngle = Math.PI / 2 - .08;
      controls.addEventListener('start', () => { cameraPreset = false; });
      createWorkshopStage(THREE, scene, renderer, {
        center: [0, -3.5], size: [14, 11], grid: 1,
        ...(studio ? { palette: {
          floor: '#e2e6e0', edge: '#a2ada7', trim: '#c6cec7', metal: '#8a999c', grid: '#617780',
          lamp: '#e3ebed', lampEmissive: '#94acb8', sky: '#f4f6f4', ground: '#8b9189', sun: '#fff6e9',
        } } : {}),
      });
      const agents = run.agents.map((agent) => {
        const drone = createWorkshopDrone(THREE, { color: AGENT_COLORS[agent.id], size: .95, id: `A${agent.id + 1}` });
        scene.add(drone); return drone;
      });
      const tasks = run.tasks.map((task) => {
        const station = new THREE.Group(); station.position.set(task.position[0], 0, -task.position[1]);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(.48, .53, .13, 32), new THREE.MeshStandardMaterial({ color: studio ? '#aab4b0' : '#354b45', roughness: .8 }));
        base.position.y = .08; base.receiveShadow = true; base.castShadow = true; station.add(base);
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(.28, .42, .28), new THREE.MeshStandardMaterial({ color: studio ? '#86999e' : '#778f85', metalness: .25, roughness: .55 }));
        pillar.position.y = .35; pillar.castShadow = true; station.add(pillar);
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(.10, 12, 8), new THREE.MeshStandardMaterial({ color: TASK_COLORS.pending, emissive: TASK_COLORS.pending, emissiveIntensity: .4 }));
        beacon.position.y = .65; station.add(beacon);
        const segments = Array.from({ length: SERVICE_STEPS }, (_, index) => {
          const segment = new THREE.Mesh(new THREE.BoxGeometry(.052, .04, .12), new THREE.MeshStandardMaterial({ color: studio ? '#c8d0c9' : '#43584f', roughness: .8 }));
          const angle = index / SERVICE_STEPS * Math.PI * 2;
          segment.position.set(.39 * Math.cos(angle), .165, .39 * Math.sin(angle)); segment.rotation.y = -angle + Math.PI / 2;
          station.add(segment); return segment;
        });
        station.userData = { base, pillar, beacon, segments }; scene.add(station); return station;
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(.57, .62, 48), new THREE.MeshBasicMaterial({ color: studio ? '#273438' : '#f2eddb', side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; scene.add(ring);
      const paths = new THREE.Group(); scene.add(paths);
      const overlay = document.createElement('div'); overlay.className = 'mission-labels';
      const agentLabels = agents.map((_, id) => {
        const button = document.createElement('button'); button.style.setProperty('--agent-color', AGENT_COLORS[id]); if (!studio) button.style.color = AGENT_COLORS[id]; button.setAttribute('aria-label', `Inspect agent A${id + 1}`);
        button.addEventListener('click', () => selectAgent(id)); overlay.append(button); return button;
      });
      const leaderLayer = element('svg', { class: 'mission-label-leaders', 'aria-hidden': 'true' });
      const leaders = [...agents, ...tasks].map(() => { const line = element('line', { stroke: '#617077', 'stroke-width': .7, opacity: .6 }); leaderLayer.append(line); return line; });
      if (studio) overlay.prepend(leaderLayer);
      const taskLabels = tasks.map(() => { const span = document.createElement('span'); overlay.append(span); return span; });
      layer.append(overlay);
      const cameraUI = addWorkshopCameraUI(layer, { prefix, caption: 'Fixed display altitude 1.5 m · planar model · station rings show service',
        onWhole: () => { following = false; cameraPreset = true; frameCamera(true); drawThree(); },
        onFollow: () => { if (selected === null) return; following = true; cameraPreset = false; frameCamera(true); drawThree(); } });
      const observerNote = Object.assign(document.createElement('p'), { className: 'mission-scene-observer' });
      layer.append(observerNote);
      world = { THREE, renderer, scene, camera, controls, agents, tasks, ring, paths, agentLabels, taskLabels, leaderLayer, leaders, cameraUI, observerNote, history: null, lastSelected: selected };
      controls.addEventListener('change', drawThree); resize(); updateThree();
    } catch { if (!world) pendingRenderer?.dispose(); if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2; the 2D map and mission controls remain available.'); }
    finally { loading = false; }
  }
  function updateThree() {
    if (!world || !run || failed) return;
    const observerId = selected === null ? 0 : selected + 1;
    const knowledge = run.knowledge?.[observerId], observerName = observerId === 0 ? 'C' : `A${observerId}`;
    world.observerNote.hidden = !knowledge;
    world.observerNote.textContent = knowledge ? `Physical state shown · ${observerName} knows ${knowledge.completed.length}/6 completed · ? = completion not learned` : '';
    run.agents.forEach((agent, id) => {
      const previous = run.history.findLast((point) => Math.hypot(point.positions[id][0] - agent.position[0], point.positions[id][1] - agent.position[1]) > 1e-6);
      const target = agent.taskId === null ? null : run.tasks[agent.taskId].position;
      const dx = previous ? agent.position[0] - previous.positions[id][0] : target ? target[0] - agent.position[0] : 0;
      const dy = previous ? agent.position[1] - previous.positions[id][1] : target ? target[1] - agent.position[1] : 1;
      setWorkshopDrone(world.agents[id], { position: [agent.position[0], displayAltitude, -agent.position[1]], heading: Math.atan2(dy, dx), phase: (agent.state === 'unavailable' ? run.history.find((point) => point.states?.[id] === 'unavailable')?.step ?? run.step : run.step) * .8, active: agent.state !== 'unavailable' });
      const report = knowledge?.reports[id];
      const age = report ? (run.step - report.step) * MISSION_DT : null;
      world.agentLabels[id].textContent = `A${id + 1}${agent.state === 'unavailable' ? ' ×' : agent.state === 'servicing' ? ' · service' : ''}${knowledge && (age === null || age > 0) ? age === null ? ' · no report' : ` · report ${age.toFixed(1)}s old` : ''}`;
      world.agentLabels[id].title = `A${id + 1}: physical ${agent.state}${knowledge ? `; ${observerName}'s report ${age === null ? 'missing' : `${age.toFixed(1)} s old`}` : ''}`;
      world.agentLabels[id].setAttribute('aria-pressed', String(id === selected));
      world.agents[id].userData.planarPosition = [...agent.position];
    });
    run.tasks.forEach((task, id) => {
      const { beacon, segments } = world.tasks[id].userData;
      beacon.material.color.set(TASK_COLORS[task.state]); beacon.material.emissive.set(TASK_COLORS[task.state]);
      const progress = task.state === 'completed' ? SERVICE_STEPS : SERVICE_STEPS - task.serviceRemaining;
      segments.forEach((segment, index) => segment.material.color.set(index < progress ? TASK_COLORS.completed : task.state === 'servicing' ? studio ? '#c0ad8f' : '#816e49' : studio ? '#c8d0c9' : '#43584f'));
      const unlearned = knowledge && task.state === 'completed' && !knowledge.completed.includes(task.id);
      world.taskLabels[id].textContent = `T${id + 1}${task.state === 'completed' ? ' ✓' : task.state === 'servicing' ? ` · ${Math.round(progress / SERVICE_STEPS * 100)}%` : ''}${unlearned ? ` · ${observerName} ?` : ''}`;
      world.taskLabels[id].title = `T${id + 1}: physical ${task.state}${knowledge ? `; ${observerName} ${knowledge.completed.includes(task.id) ? 'knows completion' : 'has not learned completion'}` : ''}`;
      world.taskLabels[id].style.color = studio ? '#273438' : unlearned ? '#f0bb83' : TASK_COLORS[task.state];
      if (studio) world.taskLabels[id].style.setProperty('--task-color', TASK_COLORS[task.state]);
      world.taskLabels[id].dataset.state = task.state;
    });
    world.ring.visible = selected !== null;
    if (selected !== null) world.ring.position.set(run.agents[selected].position[0], .012, -run.agents[selected].position[1]);
    if (world.history !== run.history) {
      for (const child of [...world.paths.children]) { child.geometry.dispose(); child.material.dispose(); world.paths.remove(child); }
      run.agents.forEach((agent, id) => {
        const points = run.history.map((point) => new world.THREE.Vector3(point.positions[id][0], displayAltitude, -point.positions[id][1]));
        world.paths.add(new world.THREE.Line(new world.THREE.BufferGeometry().setFromPoints(points), new world.THREE.LineBasicMaterial({ color: AGENT_COLORS[id], transparent: true, opacity: .45 })));
        if (agent.taskId !== null) {
          const target = run.tasks[agent.taskId].position;
          const line = new world.THREE.Line(new world.THREE.BufferGeometry().setFromPoints([new world.THREE.Vector3(agent.position[0], displayAltitude, -agent.position[1]), new world.THREE.Vector3(target[0], displayAltitude, -target[1])]), new world.THREE.LineDashedMaterial({ color: AGENT_COLORS[id], dashSize: .15, gapSize: .13, transparent: true, opacity: .7 }));
          line.computeLineDistances(); world.paths.add(line);
        }
      });
      world.history = run.history;
    }
    if (following && selected === null) { following = false; cameraPreset = true; }
    frameCamera(following && world.lastSelected !== selected);
    world.lastSelected = selected;
    layer.dataset.agents = JSON.stringify(run.agents.map((agent) => ({ id: agent.id, position: [...agent.position], displayAltitude, state: agent.state })));
    layer.dataset.tasks = JSON.stringify(run.tasks.map((task) => ({ id: task.id, state: task.state, serviceRemaining: task.serviceRemaining, knownCompleted: knowledge ? knowledge.completed.includes(task.id) : null })));
    layer.dataset.step = String(run.step);
    drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    world.renderer.render(world.scene, world.camera);
    if (studio) { placeStudioLabels(); return; }
    const width = container.clientWidth, height = container.clientHeight, occupied = [];
    const place = (anchor, label, priority = false) => {
      const point = anchor.clone().project(world.camera), w = Math.min(width - 16, Math.max(30, label.textContent.length * 7.2 + 14)), h = 23;
      label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      if (label.hidden) return;
      const x = Math.max(8, Math.min(width - w - 8, (point.x + 1) * width / 2 - w / 2));
      const baseY = (1 - point.y) * height / 2 - h - 10;
      const candidates = [0, -26, 26, -52, 52].map((offset) => Math.max(80, Math.min(height - (run.knowledge ? 100 : 65), baseY + offset)));
      const y = candidates.find((candidate) => !occupied.some((box) => x < box.x + box.w + 4 && x + w + 4 > box.x && candidate < box.y + box.h + 3 && candidate + h + 3 > box.y));
      if (y === undefined && !priority) { label.hidden = true; return; }
      const top = y ?? candidates[0]; occupied.push({ x, y: top, w, h });
      label.style.left = `${x}px`; label.style.top = `${top}px`;
    };
    const order = run.agents.map((_, id) => id).sort((a, b) => Number(b === selected) - Number(a === selected));
    order.forEach((id) => place(world.agents[id].position.clone().add(new world.THREE.Vector3(0, .28, 0)), world.agentLabels[id], id === selected));
    world.tasks.forEach((station, id) => place(station.position.clone().add(new world.THREE.Vector3(0, .65, 0)), world.taskLabels[id]));
  }
  function placeStudioLabels() {
    const width = container.clientWidth, height = container.clientHeight;
    const controls = layer.querySelector('.workshop-camera-controls');
    const caption = layer.querySelector('.workshop-scene-caption');
    const topLimit = (controls?.offsetTop || 12) + (controls?.offsetHeight || 40) + 12;
    const bottomLimit = height - (caption?.offsetHeight || 36) - 24;
    world.leaderLayer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const items = [
      ...world.agents.map((mesh, id) => ({ anchor: mesh.position.clone().add(new world.THREE.Vector3(0, .28, 0)), label: world.agentLabels[id], leader: world.leaders[id], priority: id === selected ? 0 : 1 })),
      ...world.tasks.map((mesh, id) => ({ anchor: mesh.position.clone().add(new world.THREE.Vector3(0, .65, 0)), label: world.taskLabels[id], leader: world.leaders[id + world.agents.length], priority: 2 })),
    ].map((item) => {
      const point = item.anchor.project(world.camera);
      const hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      item.label.hidden = hidden; item.leader.style.display = hidden ? 'none' : '';
      return { ...item, hidden, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
    });
    const occupied = [];
    for (const item of items.sort((a, b) => a.priority - b.priority || a.y - b.y)) {
      if (item.hidden) continue;
      const w = item.label.offsetWidth, h = item.label.offsetHeight;
      const candidates = [];
      for (const dy of [-h - 12, 12, -h - 42, 42, -h - 72, 72]) {
        for (const dx of [-w / 2, 12, -w - 12]) {
          candidates.push({ x: Math.max(10, Math.min(width - w - 10, item.x + dx)), y: Math.max(topLimit, Math.min(bottomLimit - h, item.y + dy)), w, h });
        }
      }
      const overlap = (a, b) => a.x < b.x + b.w + 4 && a.x + a.w + 4 > b.x && a.y < b.y + b.h + 4 && a.y + a.h + 4 > b.y;
      const candidate = candidates.find((box) => !occupied.some((other) => overlap(box, other)) && !items.some((point) => !point.hidden && overlap(box, { x: point.x - 5, y: point.y - 5, w: 10, h: 10 })))
        || candidates.find((box) => !occupied.some((other) => overlap(box, other))) || candidates[0];
      occupied.push(candidate);
      item.label.style.left = `${candidate.x}px`; item.label.style.top = `${candidate.y}px`;
      item.leader.setAttribute('x1', item.x); item.leader.setAttribute('y1', item.y);
      item.leader.setAttribute('x2', Math.max(candidate.x, Math.min(candidate.x + w, item.x)));
      item.leader.setAttribute('y2', Math.max(candidate.y, Math.min(candidate.y + h, item.y)));
    }
  }
  function resize() {
    if (studio) drawSvg();
    if (!world || failed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix(); frameCamera(cameraPreset); drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(state, agent = selected) { if (disposed) return; run = state; selected = agent; drawSvg(); updateThree(); },
    setMode(nextMode) {
      if (!['2d', '3d'].includes(nextMode)) throw new Error('Unknown mission view.');
      mode = nextMode; svg.style.display = mode === '2d' ? '' : 'none'; layer.hidden = mode !== '3d';
      if (mode === '3d') void prepareThree();
      if (world) world.controls.enabled = mode === '3d' && !failed;
      resize();
    },
    dispose() {
      disposed = true; observer.disconnect();
      disposeWorld();
      container.replaceChildren();
    },
  };
}
