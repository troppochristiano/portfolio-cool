import { useEffect } from "react";
import { applyTexture } from "./avatarState.js";

// Resolve the blink variant the auto-blink loop flashes on top of a base expression.
// Convention: "neutral" → "blink", any other "<name>" → "<name>Blink". Returns the
// variant only if it's actually loaded, so adding a new expression + its blink grid
// (e.g. "angry" + "angryBlink") just works with no code change here.
const blinkVariantOf = (base, expr) => {
  const variant = base === "neutral" ? "blink" : `${base}Blink`;
  return expr[variant] ? variant : null;
};
// Auto-blink timing (ms). Random gap between blinks, how long the eyes stay shut,
// and the odds of an immediate second blink.
const BLINK_MIN_GAP = 2800;
const BLINK_MAX_GAP = 6000;
const BLINK_DURATION = 120;
const DOUBLE_BLINK_CHANCE = 0.15;

/** Flash the current base's blink variant on a random cadence. */
export function useAutoBlink(threeRef, autoBlink, activeKey) {
  useEffect(() => {
    if (!autoBlink) return;
    let timer;
    const reapply = (h) => {
      if (h.steps.length) applyTexture(h, h.steps[h.yIndex][h.xIndex]);
    };
    const eyesOpen = (h) => {
      h.blinking = false;
      h.displayExpression = h.baseExpression;
      reapply(h);
    };
    const eyesShut = (h, after) => {
      const variant = blinkVariantOf(h.baseExpression, h.expr);
      // Skip if this base has no (loaded) blink variant — just stay open.
      if (variant) {
        h.blinking = true;
        h.displayExpression = variant;
        reapply(h);
      }
      timer = setTimeout(after, BLINK_DURATION);
    };
    const schedule = () => {
      const gap =
        BLINK_MIN_GAP + Math.random() * (BLINK_MAX_GAP - BLINK_MIN_GAP);
      timer = setTimeout(() => {
        const h = threeRef.current;
        if (!h) return schedule();
        eyesShut(h, () => {
          eyesOpen(h);
          if (Math.random() < DOUBLE_BLINK_CHANCE) {
            timer = setTimeout(() => {
              const h2 = threeRef.current;
              if (!h2) return schedule();
              eyesShut(h2, () => {
                eyesOpen(h2);
                schedule();
              });
            }, 140);
          } else {
            schedule();
          }
        });
      }, gap);
    };
    schedule();
    return () => {
      clearTimeout(timer);
      const h = threeRef.current;
      if (h && h.blinking) eyesOpen(h); // don't leave the eyes stuck shut
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBlink, activeKey]);
}
