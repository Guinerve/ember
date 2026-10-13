import type { Flame, Vec3 } from "./physics/radiation";

/** What the radiation lab is showing, shared with the sections that build on it. */
export interface RadiationState {
  flame: Flame;
  receiver: Vec3;
  receiverNormal: Vec3;
  receiverTiltRad: number;
  /** radiant flux on the leaf, W m⁻² */
  flux: number;
}

type Listener = (s: RadiationState) => void;
const listeners: Listener[] = [];
let current: RadiationState | null = null;

export const radiationState = {
  get: () => current,
  set(s: RadiationState) { current = s; for (const l of listeners) l(s); },
  subscribe(l: Listener) { listeners.push(l); if (current) l(current); },
};
