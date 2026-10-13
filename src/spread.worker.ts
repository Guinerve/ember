/// <reference lib="webworker" />
import { computeSpread, type SpreadInput } from "./spread";

self.onmessage = (e: MessageEvent<{ id: number; input: SpreadInput }>) => {
  const r = computeSpread(e.data.input);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: e.data.id, result: r }, [r.arrival.buffer]);
};
