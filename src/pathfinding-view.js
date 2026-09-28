import './pathfinding-view.css';
import { cellCenter, cellXY } from './pathfinding-model.js';
import { createWorkshopDrone, setWorkshopDrone, createWorkshopStage, addWorkshopCameraUI } from './workshop-scene.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = { floor: '#f7f9f5', wall: '#c2cac6', open: '#e1ebf1', closed: '#ebefe8', current: '#eee4d6', route: '#94714f', trail: '#446e91', ink: '#273438', collision: '#a15e50' };
const DISPLAY_HEIGHT = .8, WALL_HEIGHT = 1.65;

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
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  group.clear();
}

/** Render a supplied search snapshot and executor history. Camera and selection
 * changes never run search or advance the point agent. Both views use x, y in
 * the same planar world; positive model y maps to negative Three.js z. */
export function createPathfindingView(container, { selectCell = () => {} } = {}) {
  let run, mode = '2d', world, loading = false, failed = false, disposed = false, following = false;
  let options = { traceIndex: 0, selectedCell: null, showSearch: true };
  const svg = element('svg', { viewBox: '0 0 760 650', class: 'path-svg', role: 'group', 'aria-label': 'Pathfinding grid. Select a cell to inspect it; arrow keys move between cells. The positive y direction is upward.' });
  const layer = document.createElement('div'); layer.className = 'path-three'; layer.hidden = true;
  container.append(svg, layer);

  function selectionValid() { return Number.isInteger(options.selectedCell) && options.selectedCell >= 0 && options.selectedCell < run.grid.width * run.grid.height; }
  function searchSnapshot() {
    if (!options.showSearch || !run.plan.trace.length) return null;
    const index = Math.max(0, Math.min(run.plan.trace.length - 1, Math.trunc(options.traceIndex) || 0));
    return run.plan.trace[index];
  }
  function searchCells() {
    const snapshot = searchSnapshot();
    return { current: snapshot?.current ?? null, open: new Set(snapshot?.open), closed: new Set(snapshot?.closed) };
  }
  function searchState(id, search) { return search.current === id ? 'current' : search.open.has(id) ? 'open' : search.closed.has(id) ? 'closed' : 'none'; }
  function routePoints() {
    return run.plan.method === 'direct'
      ? [cellCenter(run.grid.start, run.grid.width), cellCenter(run.grid.goal, run.grid.width)]
      : run.plan.path.map((id) => cellCenter(id, run.grid.width));
  }

  function drawSvg() {
    if (!run || disposed) return;
    const focusedCell = svg.contains(document.activeElement) ? document.activeElement.dataset.pathCell : null;
    const { width, height } = run.grid, size = Math.min(660 / width, 495 / height);
    // Keep map coordinates (and route points) fixed while sizing annotations
    // in screen pixels, so the same grid remains readable on narrow screens.
    const scale = Math.min(Math.max(1, container.clientWidth) / 760, Math.max(1, container.clientHeight) / 650);
    const px = (value) => value / scale;
    const left = (760 - size * width) / 2, top = (555 - size * height) / 2;
    const X = (x) => left + x * size, Y = (y) => top + (height - y) * size;
    const blocked = new Set(run.grid.blocked), search = searchCells();
    const activeCell = selectionValid() ? options.selectedCell : run.grid.start;
    svg.replaceChildren();
    for (let id = 0; id < width * height; id += 1) {
      const [x, y] = cellXY(id, width), state = searchState(id, search), wall = blocked.has(id);
      const description = [`Cell (${x}, ${y})`, wall ? 'wall' : 'free', id === run.grid.start ? 'start' : '', id === run.grid.goal ? 'goal' : '', state === 'none' ? '' : state === 'open' ? 'open frontier' : state === 'closed' ? 'closed settled' : 'current expansion'].filter(Boolean).join(', ');
      const group = element('g', { role: 'button', tabindex: id === activeCell ? 0 : -1, 'data-path-cell': id, 'data-search': state, 'aria-label': description, 'aria-pressed': String(id === options.selectedCell) });
      group.append(element('rect', { x: X(x), y: Y(y + 1), width: size, height: size, fill: wall ? COLORS.wall : COLORS[state] ?? COLORS.floor, stroke: '#cdd7d2', 'stroke-width': px(.7) }));
      if (wall) group.append(element('path', { d: `M${X(x + .23)},${Y(y + .23)}L${X(x + .77)},${Y(y + .77)}M${X(x + .23)},${Y(y + .77)}L${X(x + .77)},${Y(y + .23)}`, stroke: '#7b8888', 'stroke-width': px(.8), 'pointer-events': 'none' }));
      if (!wall && state !== 'none') group.append(element('text', { x: X(x + .79), y: Y(y + 1) + px(12), fill: state === 'open' ? '#446e91' : '#6f7e79', 'font-size': px(11), 'font-weight': 600, 'text-anchor': 'middle', 'pointer-events': 'none' }, search.open.has(id) ? 'O' : '×'));
      if (state === 'current') group.append(element('rect', { x: X(x) + 4, y: Y(y + 1) + 4, width: size - 8, height: size - 8, fill: 'none', stroke: COLORS.route, 'stroke-width': px(1.2), 'stroke-dasharray': `${px(3)} ${px(2)}`, 'pointer-events': 'none' }));
      if (id === options.selectedCell) group.append(element('rect', { x: X(x) + 1.8, y: Y(y + 1) + 1.8, width: size - 3.6, height: size - 3.6, fill: 'none', stroke: COLORS.ink, 'stroke-width': px(1.6), 'pointer-events': 'none' }));
      group.addEventListener('click', () => selectCell(id));
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCell(id); return; }
        const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] };
        if (!offsets[event.key]) return;
        event.preventDefault();
        const [dx, dy] = offsets[event.key], nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        const next = ny * width + nx;
        svg.querySelector(`[data-path-cell="${next}"]`)?.focus({ preventScroll: true });
        selectCell(next);
      });
      svg.append(group);
    }
    const markings = element('g', { 'pointer-events': 'none', 'aria-hidden': 'true' });
    const route = routePoints();
    if (route.length > 1) markings.append(element('polyline', { 'data-path-route': run.plan.method === 'direct' ? 'unchecked' : 'grid', points: route.map(([x, y]) => `${X(x)},${Y(y)}`).join(' '), fill: 'none', stroke: COLORS.route, 'stroke-width': px(1.6), 'stroke-dasharray': `${px(5)} ${px(4)}`, 'stroke-linejoin': 'round' }));
    if (run.history.length > 1) markings.append(element('polyline', { 'data-path-trail': '', points: run.history.map(({ position: [x, y] }) => `${X(x)},${Y(y)}`).join(' '), fill: 'none', stroke: COLORS.trail, 'stroke-width': px(2.3), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const start = cellCenter(run.grid.start, width), goal = cellCenter(run.grid.goal, width);
    markings.append(element('circle', { cx: X(start[0]), cy: Y(start[1]), r: px(6.5), fill: 'none', stroke: '#788a92', 'stroke-width': px(1.2) }));
    markings.append(element('text', { x: X(start[0]) - px(10), y: Y(start[1]) + px(17), fill: COLORS.ink, 'font-size': px(11), 'font-weight': 600, stroke: '#fbfcfa', 'stroke-width': px(3), 'paint-order': 'stroke' }, 'S'));
    const gx = X(goal[0]), gy = Y(goal[1]), goalRadius = px(6.5);
    markings.append(element('path', { d: `M${gx},${gy - goalRadius}L${gx + goalRadius},${gy}L${gx},${gy + goalRadius}L${gx - goalRadius},${gy}Z`, fill: '#fbfcfa', stroke: COLORS.route, 'stroke-width': px(1.4) }));
    markings.append(element('text', { x: gx + px(9), y: gy + px(17), fill: COLORS.route, 'font-size': px(11), 'font-weight': 600, stroke: '#fbfcfa', 'stroke-width': px(3), 'paint-order': 'stroke' }, 'G'));
    const waypoint = run.plan.waypoints[run.waypointIndex];
    if (waypoint) markings.append(element('circle', { 'data-path-waypoint': run.waypointIndex, cx: X(waypoint[0]), cy: Y(waypoint[1]), r: px(3.7), fill: '#fbfcfa', stroke: COLORS.ink, 'stroke-width': px(1.1) }));
    const ax = X(run.position[0]), ay = Y(run.position[1]), agentColor = run.status === 'collision' ? COLORS.collision : COLORS.trail;
    markings.append(element('circle', { 'data-path-agent': '', cx: ax, cy: ay, r: px(4.8), fill: agentColor, stroke: '#fbfcfa', 'stroke-width': px(1.3) }));
    markings.append(element('text', { x: ax - px(8), y: ay - px(9), fill: agentColor, 'font-size': px(11), 'font-weight': 600, 'text-anchor': 'end', stroke: '#fbfcfa', 'stroke-width': px(3), 'paint-order': 'stroke' }, run.status === 'collision' ? 'A ×' : 'A'));
    svg.append(markings);
    for (let x = 0; x < width; x += 1) svg.append(element('text', { x: X(x + .5), y: Y(0) + px(17), fill: '#617077', 'font-size': px(10), 'text-anchor': 'middle' }, x));
    for (let y = 0; y < height; y += 1) svg.append(element('text', { x: left - px(10), y: Y(y + .5) + px(3.5), fill: '#617077', 'font-size': px(10), 'text-anchor': 'end' }, y));
    svg.append(element('text', { x: 380, y: Y(0) + px(38), fill: '#617077', 'font-size': px(10), 'text-anchor': 'middle' }, '1 m cells · y increases upward'));
    if (focusedCell !== null) svg.querySelector(`[data-path-cell="${focusedCell}"]`)?.focus({ preventScroll: true });
  }

  function disposeWorld() {
    if (!world) return;
    const previous = world; world = undefined;
    previous.controls.removeEventListener('change', drawThree);
    previous.controls.dispose(); releaseGroup(previous.scene); previous.renderer.dispose();
  }
  function unavailable(message) {
    failed = true; disposeWorld();
    layer.replaceChildren(Object.assign(document.createElement('p'), { className: 'path-webgl-message', textContent: message }));
  }
  async function prepareThree() {
    if (world || loading || failed || disposed) return;
    loading = true; layer.textContent = 'Loading 3D…';
    let renderer, scene, controls;
    try {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed || mode !== '3d') return;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.setAttribute('aria-label', 'Detailed drone in the same planar pathfinding run at fixed display height. Exact blocked-cell footprints form the walls. Drag to orbit, scroll to zoom, or use arrow keys to pan.');
      renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); if (!disposed) unavailable('3D context lost. Continue the same search and run in 2D.'); });
      scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(46, 1, .1, 150);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.minDistance = 2; controls.maxDistance = 52; controls.maxPolarAngle = Math.PI / 2 - .12;
      controls.listenToKeyEvents(renderer.domElement);
      createWorkshopStage(THREE, scene, renderer, {
        center: [run.grid.width / 2, -run.grid.height / 2], size: [run.grid.width, run.grid.height], grid: 1,
        palette: {
          floor: '#e2e6e0', edge: '#a2ada7', trim: '#c6cec7', metal: '#8a999c', grid: '#617780',
          lamp: '#e3ebed', lampEmissive: '#94acb8', sky: '#f4f6f4', ground: '#8b9189', sun: '#fff6e9',
        },
      });
      const grid = new THREE.Group(), paths = new THREE.Group(); scene.add(grid, paths);
      const agent = createWorkshopDrone(THREE, { color: COLORS.trail, size: .65, id: 'A' }); scene.add(agent);
      const projection = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineDashedMaterial({ color: COLORS.trail, dashSize: .06, gapSize: .04, transparent: true, opacity: .6 }));
      projection.frustumCulled = false; scene.add(projection);
      const makeRing = (inner, outer, color) => {
        const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; scene.add(ring); return ring;
      };
      const start = makeRing(.2, .24, '#788a92'), goal = makeRing(.2, .25, COLORS.route), waypoint = makeRing(.085, .12, COLORS.ink);
      const makeOutline = (inset, color) => {
        const points = [[inset, inset], [1 - inset, inset], [1 - inset, 1 - inset], [inset, 1 - inset]].map(([x, y]) => new THREE.Vector3(x, .065, -y));
        const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })); scene.add(outline); return outline;
      };
      const selectedOutline = makeOutline(.03, COLORS.ink), currentOutline = makeOutline(.1, COLORS.route);
      const overlay = document.createElement('div'); overlay.className = 'path-labels'; overlay.setAttribute('aria-hidden', 'true');
      const label = (text, color, className) => {
        const span = document.createElement('span'); span.className = className; span.textContent = text; span.style.color = color; overlay.append(span); return span;
      };
      const labels = { agent: label('A', COLORS.trail, 'path-agent-label'), start: label('S', COLORS.ink, 'path-site-label'), goal: label('G', COLORS.route, 'path-site-label'), waypoint: label('W', COLORS.ink, 'path-waypoint-label') };
      layer.replaceChildren(renderer.domElement, overlay);
      const cameraUI = addWorkshopCameraUI(layer, { prefix: 'path',
        caption: 'Planar point model · 0.8 m display height · occluding walls fade; their footprints stay blocked',
        onWhole: () => frameCamera(false), onFollow: () => frameCamera(true) });
      cameraUI.setFollowLabel('Follow drone');
      world = { THREE, renderer, scene, camera, controls, cameraUI, grid, paths, agent, projection, start, goal, waypoint, selectedOutline, currentOutline, overlay, labels, cells: [], walls: [], gridKey: null, history: null, plan: null };
      controls.addEventListener('change', drawThree);
      updateThree(); resize();
    } catch {
      if (world) disposeWorld();
      else {
        controls?.removeEventListener('change', drawThree); controls?.dispose();
        if (scene) releaseGroup(scene);
        renderer?.dispose();
      }
      if (!disposed) unavailable('3D is unavailable. This view needs WebGL 2; the 2D map, search trace and run controls remain available.');
    } finally { loading = false; }
  }
  function buildThreeGrid() {
    const { width, height, blocked, start, goal } = run.grid;
    const key = `${width}/${height}/${blocked.join(',')}/${start}/${goal}`;
    if (key === world.gridKey) return;
    const { THREE } = world;
    releaseGroup(world.grid);
    world.cells.forEach((cell) => cell.label.remove()); world.cells = []; world.walls = [];
    const floorGeometry = new THREE.PlaneGeometry(.97, .97), wallGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT, 1), walls = new Set(blocked);
    for (let id = 0; id < width * height; id += 1) {
      const [x, y] = cellCenter(id, width), wall = walls.has(id);
      const mesh = new THREE.Mesh(wall ? wallGeometry : floorGeometry, new THREE.MeshStandardMaterial({ color: wall ? COLORS.wall : COLORS.floor, roughness: 1, side: THREE.DoubleSide }));
      if (!wall) mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, wall ? WALL_HEIGHT / 2 : .016, -y); mesh.castShadow = wall; mesh.receiveShadow = true; world.grid.add(mesh);
      if (wall) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeometry), new THREE.LineBasicMaterial({ color: '#788a8d', transparent: true, opacity: .6 }));
        edges.position.copy(mesh.position); world.grid.add(edges);
        // Expand only the sightline test by the illustrative drone's extent.
        // The displayed wall geometry and the model's blocked cell stay exact.
        world.walls.push({ mesh, bounds: new THREE.Box3(new THREE.Vector3(x - .5, 0, -y - .5), new THREE.Vector3(x + .5, WALL_HEIGHT, -y + .5))
          .expandByVector(new THREE.Vector3(.34, .15, .34)) });
      }
      const label = document.createElement('span'); label.className = 'path-search-label'; label.hidden = true; world.overlay.append(label);
      world.cells.push({ mesh, label, wall, anchor: new THREE.Vector3(x + .28, .055, -y - .28) });
    }
    // A map can contain no walls: dispose its unused shared geometry as well.
    if (!walls.size) wallGeometry.dispose();
    const points = [];
    for (let x = 0; x <= width; x += 1) points.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, -height));
    for (let y = 0; y <= height; y += 1) points.push(new THREE.Vector3(0, 0, -y), new THREE.Vector3(width, 0, -y));
    world.grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#b8c6c1' })));
    const origin = cellCenter(start, width), destination = cellCenter(goal, width);
    world.start.position.set(origin[0], .04, -origin[1]); world.goal.position.set(destination[0], .04, -destination[1]);
    if (world.gridKey === null) frameCamera(false);
    world.gridKey = key; world.history = null; world.plan = null;
  }
  function updateThree() {
    if (!world || !run || failed || disposed) return;
    buildThreeGrid();
    const search = searchCells();
    world.cells.forEach((cell, id) => {
      const state = searchState(id, search);
      cell.mesh.material.color.set(cell.wall ? COLORS.wall : COLORS[state] ?? COLORS.floor);
      cell.label.hidden = cell.wall || state === 'none';
      cell.label.textContent = search.open.has(id) ? 'O' : '×';
      cell.label.style.color = state === 'open' ? '#446e91' : '#6f7e79';
      cell.visibleLabel = !cell.label.hidden;
    });
    const agentColor = run.status === 'collision' ? COLORS.collision : COLORS.trail;
    const previous = run.history.slice(0, -1).reverse().find(row => Math.hypot(row.position[0] - run.position[0], row.position[1] - run.position[1]) > 1e-8);
    const next = run.plan.waypoints[run.waypointIndex] ?? cellCenter(run.grid.goal, run.grid.width);
    const direction = previous ? run.position.map((value, axis) => value - previous.position[axis]) : next.map((value, axis) => value - run.position[axis]);
    setWorkshopDrone(world.agent, { position: [run.position[0], DISPLAY_HEIGHT, -run.position[1]],
      heading: Math.atan2(direction[1], direction[0]), phase: run.step * .1, active: run.status === 'following' });
    world.agent.userData.bodyMaterial?.color.set(agentColor);
    world.agent.userData.modelPosition = [...run.position];
    const projection = world.projection.geometry.attributes.position;
    projection.setXYZ(0, run.position[0], .025, -run.position[1]); projection.setXYZ(1, run.position[0], DISPLAY_HEIGHT, -run.position[1]);
    projection.needsUpdate = true; world.projection.computeLineDistances();
    if (following) {
      const target = world.agent.position.clone(); world.camera.position.add(target.clone().sub(world.controls.target));
      world.controls.target.copy(target); world.controls.update();
    }
    world.labels.agent.textContent = run.status === 'collision' ? 'A ×' : 'A'; world.labels.agent.style.color = agentColor;
    world.selectedOutline.visible = selectionValid();
    if (selectionValid()) {
      const [x, y] = cellXY(options.selectedCell, run.grid.width);
      world.selectedOutline.position.set(x, world.cells[options.selectedCell].wall ? WALL_HEIGHT : 0, -y);
    }
    world.currentOutline.visible = search.current !== null;
    if (search.current !== null) { const [x, y] = cellXY(search.current, run.grid.width); world.currentOutline.position.set(x, 0, -y); }
    const waypoint = run.plan.waypoints[run.waypointIndex];
    world.waypoint.visible = Boolean(waypoint); world.labels.waypoint.hidden = !waypoint;
    if (waypoint) world.waypoint.position.set(waypoint[0], .06, -waypoint[1]);
    if (world.history !== run.history || world.plan !== run.plan) {
      releaseGroup(world.paths);
      const { THREE } = world, route = routePoints();
      if (route.length > 1) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(route.map(([x, y]) => new THREE.Vector3(x, .075, -y))), new THREE.LineDashedMaterial({ color: COLORS.route, dashSize: .16, gapSize: .12 }));
        line.computeLineDistances(); world.paths.add(line);
      }
      if (run.history.length > 1) world.paths.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(run.history.map(({ position: [x, y] }) => new THREE.Vector3(x, .095, -y))), new THREE.LineBasicMaterial({ color: COLORS.trail })));
      world.history = run.history; world.plan = run.plan;
    }
    drawThree();
  }
  function frameCamera(follow) {
    if (!world || !run) return;
    following = follow; world.cameraUI.setFollowing(follow);
    if (follow) {
      world.controls.target.set(run.position[0], DISPLAY_HEIGHT, -run.position[1]);
      world.camera.position.copy(world.controls.target).add(new world.THREE.Vector3(-3.6, 4.1, 1.8));
    } else {
      // Fit the actual yard from its western opening, reserving room for
      // the camera controls and model caption on desktop and narrow screens.
      const direction = new world.THREE.Vector3(-.85, .95, .8).normalize();
      const right = new world.THREE.Vector3(0, 1, 0).cross(direction).normalize();
      const up = direction.clone().cross(right).normalize();
      const tangent = Math.tan(world.camera.fov * Math.PI / 360);
      const verticalRoom = Math.max(.35, 1 - 144 / Math.max(1, container.clientHeight));
      world.controls.target.set(run.grid.width / 2, .35, -run.grid.height / 2);
      let distance = 0;
      for (const x of [-.6, run.grid.width + .6]) for (const y of [-.4, WALL_HEIGHT]) for (const z of [.6, -run.grid.height - .6]) {
        const corner = new world.THREE.Vector3(x, y, z).sub(world.controls.target);
        distance = Math.max(distance, corner.dot(direction) + Math.abs(corner.dot(right)) / (tangent * world.camera.aspect * .88), corner.dot(direction) + Math.abs(corner.dot(up)) / (tangent * verticalRoom));
      }
      world.camera.position.copy(world.controls.target).add(direction.multiplyScalar(distance));
    }
    world.controls.update(); drawThree();
  }
  function drawThree() {
    if (!world || mode !== '3d' || failed || disposed) return;
    // A camera cutaway reveals the whole drone while retaining the occupied
    // cells' edges and shadows. Recompute after orbiting as well as motion.
    const direction = world.agent.position.clone().sub(world.camera.position), distance = direction.length();
    const ray = new world.THREE.Ray(world.camera.position, direction.normalize()), hit = new world.THREE.Vector3();
    let faded = 0;
    for (const { mesh, bounds } of world.walls) {
      const occludes = bounds.containsPoint(world.agent.position) || Boolean(ray.intersectBox(bounds, hit) && world.camera.position.distanceTo(hit) < distance);
      const material = mesh.material;
      if (material.transparent !== occludes) { material.transparent = occludes; material.depthWrite = !occludes; material.needsUpdate = true; }
      material.opacity = occludes ? .14 : 1;
      if (occludes) faded += 1;
    }
    layer.dataset.occludedWalls = String(faded);
    world.renderer.render(world.scene, world.camera);
    const place = (anchor, label, visible = true) => {
      const point = anchor.clone().project(world.camera);
      const x = (point.x + 1) * container.clientWidth / 2, y = (1 - point.y) * container.clientHeight / 2;
      label.style.left = `${Math.max(30, Math.min(container.clientWidth - 30, x))}px`;
      label.style.top = `${Math.max(65, Math.min(container.clientHeight - 54, y))}px`;
      label.hidden = !visible || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
    };
    place(world.agent.position, world.labels.agent); place(world.start.position, world.labels.start); place(world.goal.position, world.labels.goal);
    place(world.waypoint.position, world.labels.waypoint, world.waypoint.visible);
    world.cells.forEach((cell) => place(cell.anchor, cell.label, cell.visibleLabel));
  }
  function resize() {
    if (disposed) return;
    drawSvg();
    if (!world || failed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    const changed = world.viewportWidth !== width || world.viewportHeight !== height;
    world.viewportWidth = width; world.viewportHeight = height;
    world.renderer.setSize(width, height, false); world.camera.aspect = width / height; world.camera.updateProjectionMatrix();
    if (changed && !following) frameCamera(false); else drawThree();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  return {
    update(state, nextOptions = {}) {
      if (disposed) return;
      run = state; options = { ...options, ...nextOptions }; drawSvg(); updateThree();
    },
    setMode(nextMode) {
      if (!['2d', '3d'].includes(nextMode)) throw new Error('Unknown pathfinding view.');
      if (disposed) return;
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
