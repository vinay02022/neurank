"use client";

import { useEffect, useRef } from "react";

/**
 * Minimal keyboard shortcut hook.
 *
 * Supports:
 *   - single keys               "?", "k"
 *   - modifier + key            "mod+k" ("mod" maps to meta on mac, ctrl elsewhere)
 *   - sequences (vim style)     "g d"
 *
 * Ignores events originating inside form fields unless `allowInInputs`.
 */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  options: { allowInInputs?: boolean; enabled?: boolean } = {},
) {
  const { allowInInputs = false, enabled = true } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const isMac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    // Parse the spec. Sequences are whitespace-separated: "g d".
    const tokens = combo.trim().toLowerCase().split(/\s+/);
    const isSequence = tokens.length > 1;

    // For combos like "mod+k".
    const parseToken = (t: string) => {
      const parts = t.split("+");
      const key = parts[parts.length - 1]!;
      return {
        key,
        ctrl: parts.includes("ctrl"),
        meta: parts.includes("meta") || (parts.includes("mod") && isMac),
        alt: parts.includes("alt"),
        shift: parts.includes("shift"),
        modCtrl: parts.includes("mod") && !isMac,
      };
    };

    let sequenceIdx = 0;
    let sequenceTimer: ReturnType<typeof setTimeout> | null = null;

    const isFormField = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!allowInInputs && isFormField(e.target)) return;

      if (isSequence) {
        const current = parseToken(tokens[sequenceIdx]!);
        if (
          e.key.toLowerCase() === current.key &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          sequenceIdx += 1;
          if (sequenceIdx >= tokens.length) {
            sequenceIdx = 0;
            if (sequenceTimer) clearTimeout(sequenceTimer);
            handlerRef.current(e);
          } else {
            if (sequenceTimer) clearTimeout(sequenceTimer);
            sequenceTimer = setTimeout(() => {
              sequenceIdx = 0;
            }, 900);
          }
        } else {
          sequenceIdx = 0;
          if (sequenceTimer) clearTimeout(sequenceTimer);
        }
        return;
      }

      const spec = parseToken(tokens[0]!);
      if (e.key.toLowerCase() !== spec.key) return;
      if (spec.ctrl && !e.ctrlKey) return;
      if (spec.meta && !e.metaKey) return;
      if (spec.modCtrl && !e.ctrlKey) return;
      if (spec.alt && !e.altKey) return;
      if (spec.shift && !e.shiftKey) return;
      handlerRef.current(e);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (sequenceTimer) clearTimeout(sequenceTimer);
    };
  }, [combo, enabled, allowInInputs]);
}
