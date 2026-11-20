"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Typewriter.module.css";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Types `text` out a few characters at a time, like someone speaking it.
 * Restarts whenever `text` (or `restartKey`) changes. Clicking finishes it.
 *
 *   cps     characters per second
 *   delay   ms before the first character
 *   onDone  called once the whole text shows
 *   caret   show a blinking caret while typing
 *
 * The full text is always in the DOM for screen readers; the hidden rest only
 * reserves its space, so the layout doesn't jump while it types.
 */
export default function Typewriter({ text = "", cps = 48, delay = 0, onDone, caret = true, className, restartKey, as: Tag = "span" }) {
  const [shown, setShown] = useState(0);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (reducedMotion() || !text) {
      const id = setTimeout(() => {
        setShown(text.length);
        done.current?.();
      }, 0);
      return () => clearTimeout(id);
    }
    let raf = 0;
    let start = 0;
    let finished = false;
    const step = (now) => {
      if (!start) start = now + delay;
      const n = Math.max(0, Math.min(text.length, Math.floor(((now - start) / 1000) * cps)));
      setShown(n);
      if (n >= text.length) {
        if (!finished) {
          finished = true;
          done.current?.();
        }
        return;
      }
      raf = requestAnimationFrame(step);
    };
    const reset = setTimeout(() => setShown(0), 0);
    raf = requestAnimationFrame(step);
    return () => {
      clearTimeout(reset);
      cancelAnimationFrame(raf);
    };
  }, [text, cps, delay, restartKey]);

  const typing = shown < text.length;
  return (
    <Tag className={`${styles.tw} ${className ?? ""}`} onClick={() => typing && setShown(text.length)} aria-label={text}>
      <span aria-hidden="true">{text.slice(0, shown)}</span>
      {caret && typing && <span className={styles.caret} aria-hidden="true" />}
      <span className={styles.rest} aria-hidden="true">
        {text.slice(shown)}
      </span>
    </Tag>
  );
}
