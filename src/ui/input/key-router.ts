import { createContext, useContext, useEffect, useRef } from "react";
import type { Stroke } from "./keymap.js";

export type KeyOwner = (stroke: Stroke) => boolean;
export interface KeyRouter {
  claim(owner: KeyOwner): () => void;
  route(stroke: Stroke): boolean;
}
/** Text inputs claim keys while focused so App-level chords (Ctrl-C, Ctrl-N…) reach them first. */
export function createKeyRouter(): KeyRouter {
  const owners: KeyOwner[] = [];
  return {
    claim(owner) {
      owners.push(owner);
      return () => {
        const index = owners.lastIndexOf(owner);
        if (index >= 0) owners.splice(index, 1);
      };
    },
    route(stroke) {
      for (let i = owners.length - 1; i >= 0; i--)
        if (owners[i]?.(stroke)) return true;
      return false;
    },
  };
}
export const KeyRouterContext = createContext<KeyRouter | null>(null);
export function useKeyOwner(active: boolean, owner: KeyOwner) {
  const router = useContext(KeyRouterContext);
  const latest = useRef(owner);
  latest.current = owner;
  useEffect(() => {
    if (!active || !router) return;
    return router.claim((stroke) => latest.current(stroke));
  }, [active, router]);
}
