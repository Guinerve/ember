export const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export interface SliderSpec {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
}

/** Build labelled range inputs into `root`; returns a getter for current values. */
export function sliders(root: HTMLElement, specs: SliderSpec[], onInput: () => void): (id: string) => number {
  for (const s of specs) {
    const label = document.createElement("label");
    label.className = "ctl";
    label.innerHTML = `<span>${s.label} <output></output></span><input type="range" id="${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">`;
    const input = label.querySelector("input")!, out = label.querySelector("output")!;
    const show = () => { out.textContent = s.format(Number(input.value)); };
    show();
    input.addEventListener("input", () => { show(); onInput(); });
    root.append(label);
  }
  return (id: string) => Number((document.getElementById(id) as HTMLInputElement).value);
}

export function setSlider(id: string, v: number): void {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = String(v);
  el.dispatchEvent(new Event("input"));
}

export function toggle(root: HTMLElement, id: string, label: string, checked: boolean, onChange: () => void): () => boolean {
  const l = document.createElement("label");
  l.className = "toggle";
  l.innerHTML = `<input type="checkbox" id="${id}" ${checked ? "checked" : ""}> ${label}`;
  l.querySelector("input")!.addEventListener("change", onChange);
  root.append(l);
  return () => (document.getElementById(id) as HTMLInputElement).checked;
}

export function group(root: HTMLElement, title: string): HTMLElement {
  const g = document.createElement("div");
  g.className = "ctl-group";
  g.innerHTML = `<p>${title}</p>`;
  root.append(g);
  return g;
}

/** Wire an ARIA radiogroup of buttons; calls back with the chosen data attribute value. */
export function segmented(root: HTMLElement, attr: string, onPick: (v: string) => void): void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")];
  const pick = (b: HTMLButtonElement) => {
    for (const o of buttons) o.setAttribute("aria-checked", String(o === b));
    onPick(b.dataset[attr]!);
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => pick(b));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]!;
      n.focus(); pick(n);
    });
  });
}

export function readouts(root: HTMLElement, items: [string, string, string?, string?][]): void {
  root.innerHTML = items
    .map(([dt, dd, unit, cls]) => `<div${cls ? ` class="${cls}"` : ""}><dt>${dt}</dt><dd>${dd}${unit ? `<small>${unit}</small>` : ""}</dd></div>`)
    .join("");
}

export const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toLocaleString("en-AU", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
export const kw = (w: number, d = 1) => fmt(w / 1000, d);
export const deg = (rad: number) => (rad * 180) / Math.PI;

/** Run `fn` at most once per animation frame. */
export function frameThrottle(fn: () => void): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(); });
  };
}

/** Call `fn` when `el` first comes near the viewport, and report visibility changes. */
export function whenVisible(el: Element, fn: (visible: boolean) => void): void {
  new IntersectionObserver((entries) => { for (const e of entries) fn(e.isIntersecting); }, { rootMargin: "200px" }).observe(el);
}
