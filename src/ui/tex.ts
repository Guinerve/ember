import katex from "katex";

/** Render a labelled equation, with an optional live line of substituted numbers underneath. */
export function equation(el: HTMLElement, label: string, tex: string, live?: string): void {
  const math = katex.renderToString(tex, { displayMode: true, throwOnError: false, output: "htmlAndMathml" });
  el.innerHTML = `<span class="eq-label">${label}</span>${math}${live ? `<span class="eq-live">${live}</span>` : ""}`;
}

/** Update only the live line of an equation block. */
export function equationLive(el: HTMLElement, live: string): void {
  let span = el.querySelector<HTMLSpanElement>(".eq-live");
  if (!span) { span = document.createElement("span"); span.className = "eq-live"; el.append(span); }
  span.innerHTML = live;
}

export function inlineTex(tex: string): string {
  return katex.renderToString(tex, { throwOnError: false, output: "htmlAndMathml" });
}
