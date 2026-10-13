/**
 * A small SVG line chart: thin lines, recessive grid, direct end labels, a legend for two or more
 * series, and a crosshair tooltip. Colours are CSS custom properties so light and dark modes both work.
 */
export interface Series {
  name: string;
  /** CSS colour, usually var(--series-…) */
  color: string;
  points: [number, number][];
  dash?: string;
  /** label at the line's end (default true) */
  endLabel?: boolean;
  /** draw as a step-free filled band down to the baseline */
  area?: boolean;
}

export interface Marker {
  x: number;
  y: number;
  label: string;
  color: string;
  /** text shown in the tooltip */
  detail?: string;
}

export interface Axis {
  min: number;
  max: number;
  log?: boolean;
  title: string;
  format?: (v: number) => string;
  ticks?: number[];
}

export interface ChartSpec {
  series: Series[];
  x: Axis;
  y: Axis;
  markers?: Marker[];
  hlines?: { y: number; label: string; dash?: string }[];
  vlines?: { x: number; label: string }[];
  bands?: { x0: number; x1: number; label: string }[];
  /** how tooltip values print */
  tipFormat?: (v: number) => string;
  xTipFormat?: (v: number) => string;
  legend?: boolean;
}

const NS = "http://www.w3.org/2000/svg";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function niceTicks(a: Axis): number[] {
  if (a.ticks) return a.ticks;
  if (a.log) {
    const out: number[] = [];
    for (let e = Math.floor(Math.log10(a.min)); e <= Math.ceil(Math.log10(a.max)); e++) {
      const v = 10 ** e;
      if (v >= a.min * 0.999 && v <= a.max * 1.001) out.push(v);
    }
    return out;
  }
  const span = a.max - a.min;
  const raw = span / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 6)!;
  const out: number[] = [];
  for (let v = Math.ceil(a.min / step) * step; v <= a.max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const defaultFmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString("en-AU", { maximumFractionDigits: 0 });
  if (a >= 10 || v === 0) return v.toFixed(0);
  if (a >= 1) return v.toFixed(v % 1 === 0 ? 0 : 1);
  return v.toPrecision(1);
};

export class LineChart {
  private spec: ChartSpec | null = null;
  private ro: ResizeObserver;
  private tip: HTMLDivElement;
  private legendEl: HTMLDivElement | null = null;

  constructor(private el: HTMLElement) {
    this.tip = document.createElement("div");
    this.tip.className = "tip";
    this.tip.hidden = true;
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(el);
  }

  set(spec: ChartSpec): void {
    this.spec = spec;
    this.render();
  }

  private render(): void {
    const spec = this.spec;
    if (!spec) return;
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (W < 10 || H < 10) return;
    const showLegend = (spec.legend ?? true) && spec.series.length >= 2;
    const m = { l: 46, r: 14, t: showLegend ? 30 : 22, b: 36 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const sx = (v: number) => {
      const { min, max, log } = spec.x;
      const f = log ? (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (v - min) / (max - min);
      return m.l + f * pw;
    };
    const sy = (v: number) => {
      const { min, max, log } = spec.y;
      const c = Math.min(max, Math.max(min, v));
      const f = log ? (Math.log(c) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (c - min) / (max - min);
      return m.t + ph - f * ph;
    };
    const ok = (p: [number, number]) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!spec.x.log || p[0] > 0) && (!spec.y.log || p[1] > 0);
    const xf = spec.x.format ?? defaultFmt, yf = spec.y.format ?? defaultFmt;

    let svg = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.series.map((s) => s.name).join(", "))} against ${esc(spec.x.title)}">`;
    // bands
    for (const b of spec.bands ?? []) {
      const x0 = sx(Math.max(spec.x.min, b.x0)), x1 = sx(Math.min(spec.x.max, b.x1));
      if (x1 <= x0) continue;
      svg += `<rect x="${x0}" y="${m.t}" width="${x1 - x0}" height="${ph}" fill="var(--paper-3)" opacity=".7"/>`;
      if (x1 - x0 > 46) svg += `<text class="lbl" x="${(x0 + x1) / 2}" y="${m.t + 12}" text-anchor="middle">${esc(b.label)}</text>`;
    }
    // grid + axes
    svg += `<g class="grid">`;
    for (const t of niceTicks(spec.y)) svg += `<line x1="${m.l}" x2="${m.l + pw}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    svg += `</g><g class="axis">`;
    for (const t of niceTicks(spec.y)) svg += `<text x="${m.l - 6}" y="${sy(t) + 3.5}" text-anchor="end">${yf(t)}</text>`;
    for (const t of niceTicks(spec.x)) svg += `<text x="${sx(t)}" y="${m.t + ph + 15}" text-anchor="middle">${xf(t)}</text>`;
    svg += `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="var(--ink-3)"/>`;
    svg += `</g>`;
    svg += `<text class="axis-title" x="${m.l + pw}" y="${H - 4}" text-anchor="end">${esc(spec.x.title)}</text>`;
    if (!showLegend) svg += `<text class="axis-title" x="${m.l - 40}" y="${m.t - 10}" text-anchor="start">${esc(spec.y.title)}</text>`;
    // reference lines
    for (const h of spec.hlines ?? []) {
      if (h.y < spec.y.min || h.y > spec.y.max) continue;
      svg += `<line x1="${m.l}" x2="${m.l + pw}" y1="${sy(h.y)}" y2="${sy(h.y)}" stroke="var(--ink-3)" stroke-dasharray="${h.dash ?? "4 4"}"/>`;
      svg += `<text class="lbl" x="${m.l + 4}" y="${sy(h.y) - 4}">${esc(h.label)}</text>`;
    }
    for (const v of spec.vlines ?? []) {
      if (v.x < spec.x.min || v.x > spec.x.max) continue;
      svg += `<line x1="${sx(v.x)}" x2="${sx(v.x)}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--ink-3)" stroke-dasharray="2 3"/>`;
      svg += `<text class="lbl" x="${sx(v.x) + 4}" y="${m.t + ph - 6}">${esc(v.label)}</text>`;
    }
    // series
    const ends: { x: number; y: number; s: Series }[] = [];
    for (const s of spec.series) {
      const pts = s.points.filter(ok);
      if (pts.length < 2) continue;
      const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
      if (s.area) svg += `<path d="${d}L${sx(pts[pts.length - 1]![0])},${m.t + ph}L${sx(pts[0]![0])},${m.t + ph}Z" fill="${s.color}" opacity=".12"/>`;
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`;
      if (s.endLabel !== false) ends.push({ x: sx(pts[pts.length - 1]![0]), y: sy(pts[pts.length - 1]![1]), s });
    }
    // direct end labels for up to four series, nudged apart
    if (spec.series.length <= 4 && pw > 260) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) {
        const a = ends[i - 1]!, b = ends[i]!;
        if (Math.abs(a.x - b.x) < 140 && b.y - a.y < 13) b.y = a.y + 13;
      }
      for (const e of ends) {
        // label sits at the line's own end: to its left near the right edge, otherwise just past it
        const atEdge = e.x > m.l + pw - 120;
        svg += `<text class="series-label" x="${atEdge ? e.x - 2 : e.x + 6}" y="${atEdge ? e.y - 7 : e.y + 4}" text-anchor="${atEdge ? "end" : "start"}" fill="${e.s.color}">${esc(e.s.name)}</text>`;
      }
    }
    // markers
    for (const mk of spec.markers ?? []) {
      if (!ok([mk.x, mk.y])) continue;
      svg += `<circle cx="${sx(mk.x)}" cy="${sy(mk.y)}" r="5.5" fill="${mk.color}" stroke="var(--paper-2)" stroke-width="2"/>`;
      svg += `<text class="lbl" x="${sx(mk.x) + 9}" y="${sy(mk.y) + 4}" style="fill:var(--ink)">${esc(mk.label)}</text>`;
    }
    svg += `<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/>`;
    svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
    svg += `</svg>`;
    this.el.innerHTML = svg;
    this.el.append(this.tip);

    if (showLegend) {
      this.legendEl = document.createElement("div");
      this.legendEl.style.cssText = "position:absolute;left:46px;top:0;display:flex;flex-wrap:wrap;gap:2px 14px;font:500 11.5px var(--sans);color:var(--ink-2)";
      this.legendEl.innerHTML = spec.series
        .map((s) => `<span><i style="display:inline-block;width:14px;height:0;border-top:2px ${s.dash ? "dashed" : "solid"} ${s.color};vertical-align:middle;margin-right:5px"></i>${esc(s.name)}</span>`)
        .join("") + `<span style="color:var(--ink-3)">${esc(spec.y.title)}</span>`;
      this.el.append(this.legendEl);
    }

    // crosshair tooltip
    const svgEl = this.el.querySelector("svg")!;
    const hit = svgEl.querySelector<SVGRectElement>(".hit")!;
    const xhair = svgEl.querySelector<SVGLineElement>(".xhair")!;
    const invX = (px: number) => {
      const f = (px - m.l) / pw;
      const { min, max, log } = spec.x;
      return log ? Math.exp(Math.log(min) + f * (Math.log(max) - Math.log(min))) : min + f * (max - min);
    };
    const valueAt = (pts: [number, number][], x: number) => {
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
        if ((x - x0) * (x - x1) <= 0 && x1 !== x0) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
      return NaN;
    };
    const tf = spec.tipFormat ?? ((v: number) => yf(v));
    const xtf = spec.xTipFormat ?? ((v: number) => xf(v));
    const move = (clientX: number, clientY: number) => {
      const r = svgEl.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const py = ((clientY - r.top) / r.height) * H;
      const x = invX(px);
      const near = (spec.markers ?? []).find((mk) => Math.hypot(sx(mk.x) - px, sy(mk.y) - py) < 14);
      let rows: string;
      if (near) {
        rows = `<b>${esc(near.label)}</b><br>${esc(near.detail ?? `${xtf(near.x)}, ${tf(near.y)}`)}`;
      } else {
        rows = `<b>${esc(spec.x.title)}: ${xtf(x)}</b>` + spec.series
          .map((s) => { const v = valueAt(s.points.filter(ok), x); return Number.isFinite(v) ? `<br><i style="background:${s.color}"></i>${esc(s.name)}: ${tf(v)}` : ""; })
          .join("");
      }
      xhair.setAttribute("x1", String(px)); xhair.setAttribute("x2", String(px)); xhair.setAttribute("visibility", "visible");
      this.tip.innerHTML = rows;
      this.tip.hidden = false;
      this.tip.style.left = `${Math.min(W - 70, Math.max(70, (px / W) * this.el.clientWidth))}px`;
      this.tip.style.top = `${(Math.max(m.t + 30, py) / H) * this.el.clientHeight}px`;
    };
    const leave = () => { this.tip.hidden = true; xhair.setAttribute("visibility", "hidden"); };
    hit.addEventListener("pointermove", (e) => move(e.clientX, e.clientY));
    hit.addEventListener("pointerdown", (e) => move(e.clientX, e.clientY));
    hit.addEventListener("pointerleave", leave);
  }
}
