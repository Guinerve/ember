import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { blackbodyRGB, wienPeak } from "../physics/blackbody";
import { contributions, emissivePower, receiverNormal, SIGMA, viewFactor, type Flame, type Vec3 } from "../physics/radiation";
import { radiationState } from "../state";
import { $, deg, fmt, frameThrottle, kw, readouts, reducedMotion, segmented, sliders, whenVisible } from "../ui/dom";
import { equation, equationLive } from "../ui/tex";

/** AS 3959 bushfire attack level flux thresholds, kW/m². */
const BAL = [12.5, 19, 29, 40];
const Q_MIN = 0.5, Q_MAX = 120; // colour ramp range, kW/m² (log)

const GROUND = { x0: -14, x1: 46, y0: -30, y1: 30 };
const GRID = 112, TEX = 512;

/** physics (x ahead, y along the fire line, z up) → three.js (x, y up, z) */
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[2], p[1]);

/** Heat ramp on a dark ground: soot → 1090 K orange → pale yellow-white. */
function ramp(q: number): [number, number, number] {
  if (q <= Q_MIN * 1000) return [24, 29, 26];
  const f = Math.min(1, Math.log(q / 1000 / Q_MIN) / Math.log(Q_MAX / Q_MIN));
  const stops: [number, [number, number, number]][] = [
    [0, [34, 36, 33]], [0.3, [110, 30, 14]], [0.55, [214, 62, 8]], [0.78, [255, 140, 30]], [1, [255, 236, 190]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [f1, c1] = stops[i]!, [f0, c0] = stops[i - 1]!;
    if (f <= f1) {
      const t = (f - f0) / (f1 - f0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[stops.length - 1]![1];
}

const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// Procedural flame sheet: blackbody colour, brightest at the base, ragged tongues at the top.
const FLAME_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uTime; uniform float uMode; uniform float uAspect;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  void main() {
    vec2 p = vec2(vUv.x * uAspect, vUv.y);
    float n = fbm(vec2(p.x * 3.0, p.y * 2.2 - uTime * 1.6));
    float edge = 1.0 - smoothstep(0.55 + 0.4 * n, 1.0, vUv.y);
    float core = 0.55 + 0.45 * (1.0 - vUv.y) + 0.25 * (n - 0.5);
    float a = clamp(edge * core, 0.0, 1.0);
    vec3 c = uColor * (1.0 + 0.9 * core) + vec3(0.25, 0.18, 0.06) * pow(max(0.0, 1.0 - vUv.y), 3.0);
    gl_FragColor = vec4(c, a * 0.92);
  }
`;

export function initRadiationLab(): void {
  const host = $("#rad-gl");
  const labels = $("#rad-labels");

  // ---- controls -------------------------------------------------------------------------------
  const get = sliders($("#rad-controls"), [
    { id: "r-temp", label: "Flame temperature", min: 800, max: 1500, step: 10, value: 1090, format: (v) => `${v} K (${Math.round(v - 273.15)} °C)` },
    { id: "r-eps", label: "Flame emissivity ε", min: 0.2, max: 1, step: 0.01, value: 0.95, format: (v) => v.toFixed(2) },
    { id: "r-len", label: "Flame length", min: 1, max: 30, step: 0.5, value: 9, format: (v) => `${v} m` },
    { id: "r-wid", label: "Fire-line width", min: 4, max: 120, step: 1, value: 24, format: (v) => `${v} m` },
    { id: "r-tilt", label: "Flame lean from vertical", min: 0, max: 70, step: 1, value: 25, format: (v) => `${v}°` },
    { id: "r-dist", label: "Leaf distance ahead", min: 0.5, max: 40, step: 0.5, value: 8, format: (v) => `${v} m` },
    { id: "r-h", label: "Leaf height", min: 0, max: 6, step: 0.1, value: 0.3, format: (v) => `${v.toFixed(1)} m` },
    { id: "r-face", label: "Leaf faces", min: 0, max: 90, step: 1, value: 0, format: (v) => (v === 0 ? "the sky (0°)" : v === 90 ? "the fire (90°)" : `${v}° towards the fire`) },
  ], () => schedule());
  let leafY = 0;
  let mode: "glow" | "contrib" = "glow";
  segmented($("#rad-viewport .seg"), "mode", (v) => { mode = v as typeof mode; schedule(); });

  equation($("#eq-sb"), "Stefan–Boltzmann law: power radiated per square metre of flame", String.raw`E = \varepsilon\,\sigma\,T^4`);
  equation($("#eq-vf"), "View factor from the flame to the leaf", String.raw`F = \int_{\text{flame}} \frac{\cos\theta_1\,\cos\theta_2}{\pi\,r^2}\,dA_1`);
  equation($("#eq-flux"), "Radiant flux arriving at the leaf", String.raw`q = \varepsilon\,\sigma\,T^4 \, F`);

  // ---- three.js scene ---------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setClearColor(0x0f1311);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0f1311, 70, 140);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  camera.position.set(30, 13, 30);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(7, 2.5, 0);
  controls.enableDamping = !reducedMotion();
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 6; controls.maxDistance = 120;

  // ground with a flux texture
  const texCanvas = document.createElement("canvas");
  texCanvas.width = texCanvas.height = TEX;
  const texCtx = texCanvas.getContext("2d")!;
  const groundTex = new THREE.CanvasTexture(texCanvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND.x1 - GROUND.x0, GROUND.y1 - GROUND.y0),
    new THREE.MeshBasicMaterial({ map: groundTex }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((GROUND.x0 + GROUND.x1) / 2, 0, (GROUND.y0 + GROUND.y1) / 2);
  scene.add(ground);

  // burnt ground behind the fire line
  const burnt = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x3a1206, transparent: true, opacity: 0.85 }));
  burnt.rotation.x = -Math.PI / 2;
  burnt.position.y = 0.02;
  scene.add(burnt);

  // flame sheet
  const flameUniforms = { uColor: { value: new THREE.Color(1, 0.25, 0) }, uTime: { value: 0 }, uMode: { value: 0 }, uAspect: { value: 4 } };
  const flameMat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, uniforms: flameUniforms,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const contribMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
  const flameMesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(new THREE.PlaneGeometry(1, 1, 1, 1), flameMat);
  scene.add(flameMesh);
  const flameEdge = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb27a, transparent: true, opacity: 0.5 }));
  scene.add(flameEdge);

  // leaf
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, -0.45); leafShape.quadraticCurveTo(0.32, -0.1, 0, 0.45); leafShape.quadraticCurveTo(-0.32, -0.1, 0, -0.45);
  const leaf = new THREE.Mesh(new THREE.ShapeGeometry(leafShape, 12), new THREE.MeshBasicMaterial({ color: 0x9fb07a, side: THREE.DoubleSide }));
  scene.add(leaf);
  const normalArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 2, 0xdfe5de, 0.35, 0.2);
  scene.add(normalArrow);
  const flameNormalArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 2, 0xffd2b0, 0.35, 0.2);
  scene.add(flameNormalArrow);

  // rays and angle arcs
  const rayGroup = new THREE.Group();
  scene.add(rayGroup);
  const arcMat = new THREE.LineBasicMaterial({ color: 0xffffff });

  const grid = new THREE.GridHelper(60, 12, 0x3a423d, 0x252b27);
  grid.position.set(16, 0.01, 0);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  scene.add(grid);

  let labelItems: { pos: THREE.Vector3; text: string; cls?: string }[] = [];
  const legend = $("#rad-legend");
  {
    const stops = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const q = Q_MIN * Math.pow(Q_MAX / Q_MIN, f) * 1000;
      const [r, g, b] = ramp(q);
      return `rgb(${r | 0} ${g | 0} ${b | 0}) ${f * 100}%`;
    });
    legend.innerHTML = `Radiant flux, kW/m²<div class="ramp" style="background:linear-gradient(90deg, ${stops.join(",")})"></div><div class="ticks"><span>0.5</span><span>5</span><span>40</span><span>120</span></div>`;
  }

  // ---- compute + draw ---------------------------------------------------------------------------
  const read = () => {
    const flame: Flame = { tempK: get("r-temp"), emissivity: get("r-eps"), length: get("r-len"), width: get("r-wid"), tiltRad: (get("r-tilt") * Math.PI) / 180 };
    const tilt = (get("r-face") * Math.PI) / 180;
    return { flame, tilt, normal: receiverNormal(tilt), receiver: [get("r-dist"), leafY, get("r-h")] as Vec3 };
  };

  const fluxGrid = new Float32Array(GRID * GRID);
  let lastFluxKey = "";
  function paintGround(flame: Flame, normal: Vec3, height: number): void {
    const key = JSON.stringify([flame, normal, height]);
    if (key === lastFluxKey) return;
    lastFluxKey = key;
    const E = emissivePower(flame.tempK, flame.emissivity);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const x = GROUND.x0 + ((i + 0.5) / GRID) * (GROUND.x1 - GROUND.x0);
      const y = GROUND.y0 + ((j + 0.5) / GRID) * (GROUND.y1 - GROUND.y0);
      fluxGrid[j * GRID + i] = x < 0 ? 0 : E * viewFactor(flame, [x, y, Math.max(0.02, Math.min(height, 0.5))], normal, { ns: 24 });
    }
    const img = texCtx.createImageData(TEX, TEX);
    const sample = (u: number, v: number) => {
      const fx = u * GRID - 0.5, fy = v * GRID - 0.5;
      const i = Math.max(0, Math.min(GRID - 2, Math.floor(fx))), j = Math.max(0, Math.min(GRID - 2, Math.floor(fy)));
      const a = Math.min(1, Math.max(0, fx - i)), b = Math.min(1, Math.max(0, fy - j));
      const g = (ii: number, jj: number) => fluxGrid[jj * GRID + ii]!;
      return (g(i, j) * (1 - a) + g(i + 1, j) * a) * (1 - b) + (g(i, j + 1) * (1 - a) + g(i + 1, j + 1) * a) * b;
    };
    const band = (q: number) => BAL.filter((t) => q >= t * 1000).length;
    for (let py = 0; py < TEX; py++) for (let px = 0; px < TEX; px++) {
      // texture v runs from y1 (top) to y0; plane is rotated so texture top = −z = +y? keep ground +y at three −z
      const u = (px + 0.5) / TEX, v = (py + 0.5) / TEX;
      const q = sample(u, v);
      let [r, g, b] = ramp(q);
      const bq = band(q);
      if (bq !== band(sample(u + 1 / TEX, v)) || bq !== band(sample(u, v + 1 / TEX))) { r = 245; g = 245; b = 235; }
      const k = (py * TEX + px) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    texCtx.putImageData(img, 0, 0);
    groundTex.needsUpdate = true;
  }

  function update(): void {
    const { flame, tilt, normal, receiver } = read();
    const E = emissivePower(flame.tempK, flame.emissivity);
    const F = viewFactor(flame, receiver, normal);
    const q = E * F;

    paintGround(flame, normal, receiver[2]);

    // flame geometry
    const [r, g, b] = blackbodyRGB(flame.tempK);
    flameUniforms.uColor.value.setRGB(r, g, b, THREE.SRGBColorSpace);
    flameUniforms.uAspect.value = flame.width / Math.max(1, flame.length);
    const segX = Math.max(8, Math.min(48, Math.round(flame.width / 2))), segY = 24;
    const geo = new THREE.PlaneGeometry(flame.width, flame.length, segX, segY);
    flameMesh.geometry.dispose();
    flameMesh.geometry = geo;
    flameMesh.rotation.set(0, Math.PI / 2, 0); // plane normal → +x
    flameMesh.position.set(0, 0, 0);
    // place: rotate about the fire line (three z axis) by the lean, then lift by half-length
    const pivot = new THREE.Matrix4().makeRotationZ(-flame.tiltRad);
    const lift = new THREE.Matrix4().makeTranslation(0, flame.length / 2, 0);
    const face = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    flameMesh.matrixAutoUpdate = false;
    flameMesh.matrix.copy(pivot).multiply(lift).multiply(face);
    if (mode === "contrib") {
      // colour each vertex by its share of the leaf's view factor
      const pos = geo.attributes.position!;
      const colors = new Float32Array(pos.count * 3);
      const tmp = new THREE.Vector3();
      const n1 = new THREE.Vector3(Math.cos(flame.tiltRad), -Math.sin(flame.tiltRad), 0);
      let maxD = 0;
      const dens: number[] = [];
      const rv = v3(receiver), rn = v3(normal);
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(flameMesh.matrix);
        const ray = rv.clone().sub(tmp);
        const d = ray.length();
        const c1 = Math.abs(n1.dot(ray)) / d, c2 = -rn.dot(ray) / d;
        const den = c2 > 0 ? (c1 * c2) / (Math.PI * d * d) : 0;
        dens.push(den); maxD = Math.max(maxD, den);
      }
      for (let i = 0; i < pos.count; i++) {
        const f = maxD > 0 ? Math.sqrt(dens[i]! / maxD) : 0;
        const c = ramp(Q_MIN * 1000 * Math.pow(Q_MAX / Q_MIN, f));
        colors[i * 3] = c[0] / 255; colors[i * 3 + 1] = c[1] / 255; colors[i * 3 + 2] = c[2] / 255;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      flameMesh.material = contribMat;
    } else {
      flameMesh.material = flameMat;
    }
    flameEdge.geometry.dispose();
    flameEdge.geometry = new THREE.EdgesGeometry(geo);
    flameEdge.matrixAutoUpdate = false;
    flameEdge.matrix.copy(flameMesh.matrix);

    burnt.scale.set(Math.min(14, 0.8 * flame.length + 2), flame.width, 1);
    burnt.position.set(-burnt.scale.x / 2, 0.02, 0);

    // leaf + its normal
    const lp = v3(receiver);
    leaf.position.copy(lp).add(new THREE.Vector3(0, 0.03, 0));
    leaf.lookAt(lp.clone().add(v3(normal)));
    normalArrow.position.copy(lp);
    normalArrow.setDirection(v3(normal));

    // rays: a fan weighted by contribution, plus the strongest ray with its angles
    rayGroup.clear();
    const cs = contributions(flame, receiver, normal, 10, Math.max(8, Math.min(24, Math.round(flame.width / 3))));
    const best = cs.reduce((a, c) => (c.density > a.density ? c : a), cs[0]!);
    const maxD = best.density || 1;
    for (const c of cs) {
      if (c.density < maxD * 0.15) continue;
      const geom = new THREE.BufferGeometry().setFromPoints([v3(c.from), lp]);
      const mat = new THREE.LineBasicMaterial({ color: 0xffa060, transparent: true, opacity: 0.08 + 0.4 * (c.density / maxD) });
      rayGroup.add(new THREE.Line(geom, mat));
    }
    const from = v3(best.from);
    rayGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, lp]), new THREE.LineBasicMaterial({ color: 0xffffff })));
    const n1v = new THREE.Vector3(Math.cos(flame.tiltRad), -Math.sin(flame.tiltRad), 0);
    const rayDir = lp.clone().sub(from).normalize();
    const n1Facing = n1v.dot(rayDir) >= 0 ? n1v : n1v.clone().negate();
    flameNormalArrow.position.copy(from);
    flameNormalArrow.setDirection(n1Facing);
    const arc = (center: THREE.Vector3, a: THREE.Vector3, bdir: THREE.Vector3, radius: number) => {
      const pts: THREE.Vector3[] = [];
      const ang = a.angleTo(bdir);
      const axis = a.clone().cross(bdir).normalize();
      for (let i = 0; i <= 24; i++) pts.push(center.clone().add(a.clone().applyAxisAngle(axis, (ang * i) / 24).multiplyScalar(radius)));
      rayGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), arcMat));
      return center.clone().add(a.clone().applyAxisAngle(axis, ang / 2).multiplyScalar(radius * 1.45));
    };
    const arcR = Math.min(1.6, best.r * 0.25);
    const l1 = arc(from, n1Facing, rayDir, arcR);
    const l2 = arc(lp, v3(normal), rayDir.clone().negate(), arcR);
    labelItems = [
      { pos: l1, text: `θ₁ ${fmt(deg(best.theta1), 0)}°` },
      { pos: l2, text: `θ₂ ${fmt(deg(best.theta2), 0)}°` },
      { pos: from.clone().lerp(lp, 0.5).add(new THREE.Vector3(0, 0.6, 0)), text: `r ${fmt(best.r, 1)} m`, cls: "dim" },
    ];
    // BAL contour labels along the fire's axis
    for (const t of BAL) {
      for (let i = 1; i < GRID; i++) {
        const j = GRID >> 1;
        const a = fluxGrid[j * GRID + i - 1]!, b2 = fluxGrid[j * GRID + i]!;
        if (a >= t * 1000 && b2 < t * 1000) {
          const x = GROUND.x0 + ((i + 0.5) / GRID) * (GROUND.x1 - GROUND.x0);
          labelItems.push({ pos: new THREE.Vector3(x, 0.05, -(Math.min(flame.width / 2, 26) + 1.5)), text: `${t}`, cls: "dim" });
          break;
        }
      }
    }

    // readouts + equations
    readouts($("#rad-readouts"), [
      ["Emitted, εσT⁴", kw(E, 1), "kW/m²"],
      ["View factor F", fmt(F, 3)],
      ["Flux at the leaf", kw(q, 1), "kW/m²"],
      ["Exposure band", bandName(q / 1000)],
      ["Strongest ray: θ₁, θ₂", `${fmt(deg(best.theta1), 0)}°, ${fmt(deg(best.theta2), 0)}°`],
      ["Peak wavelength", fmt(wienPeak(flame.tempK) * 1e6, 2), "µm"],
    ]);
    equationLive($("#eq-sb"), `${fmt(flame.emissivity, 2)} × ${SIGMA.toExponential(3)} × ${flame.tempK}⁴ = <b>${kw(E, 1)} kW/m²</b>`);
    equationLive($("#eq-flux"), `${kw(E, 1)} kW/m² × ${fmt(F, 3)} = <b>${kw(q, 1)} kW/m²</b>`);
    $("#wien-out").textContent = `${fmt(wienPeak(1090) * 1e6, 1)} µm`;

    radiationState.set({ flame, receiver, receiverNormal: normal, receiverTiltRad: tilt, flux: q });
    dirty = true;
  }

  function bandName(q: number): string {
    if (q < 12.5) return "below 12.5 kW/m²";
    if (q < 19) return "12.5–19 kW/m²";
    if (q < 29) return "19–29 kW/m²";
    if (q < 40) return "29–40 kW/m²";
    return "above 40 kW/m²";
  }

  // click the ground to move the leaf
  const ray = new THREE.Raycaster();
  let downAt: [number, number] | null = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(ground)[0];
    if (!hit) return;
    const x = Math.max(0.5, Math.min(40, Math.round(hit.point.x * 2) / 2));
    leafY = Math.max(-25, Math.min(25, hit.point.z));
    const d = document.getElementById("r-dist") as HTMLInputElement;
    d.value = String(x);
    d.dispatchEvent(new Event("input"));
  });

  // ---- render loop --------------------------------------------------------------------------------
  let dirty = true, visible = false, raf = 0;
  const schedule = frameThrottle(update);
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    dirty = true;
  };
  new ResizeObserver(resize).observe(host);
  controls.addEventListener("change", () => { dirty = true; });
  const animate = (t: number) => {
    raf = 0;
    if (!visible) return;
    controls.update();
    const flicker = mode === "glow" && !reducedMotion();
    if (flicker) { flameUniforms.uTime.value = t / 1000; dirty = true; }
    if (dirty) {
      renderer.render(scene, camera);
      placeLabels();
      dirty = false;
    }
    raf = requestAnimationFrame(animate);
  };
  function placeLabels(): void {
    const w = host.clientWidth, h = host.clientHeight;
    labels.innerHTML = labelItems.map((l) => {
      const p = l.pos.clone().project(camera);
      if (p.z > 1) return "";
      return `<span class="${l.cls ?? ""}" style="left:${((p.x + 1) / 2) * w}px;top:${((1 - p.y) / 2) * h}px">${l.text}</span>`;
    }).join("");
  }
  whenVisible(host, (v) => { visible = v; if (v && !raf) raf = requestAnimationFrame(animate); });
  resize();
  update();
}
