"use client";

import { useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { getPlayerState } from "./player";
import { chat } from "./chat";
import { game, isRunning, scoreOf } from "./game";
import styles from "./NameTag.module.css";

// Floating label over a character's head: the player's name, or what they
// just said (in place of the name) while their speech bubble lasts.
export default function NameTag({ entry }) {
  const p = getPlayerState(entry.id, entry.slot);
  const group = useRef(null);
  const label = useRef(null);
  const bubble = useSyncExternalStore(chat.subscribe, () => chat.getSnapshot().bubbles[entry.id], () => undefined);
  const g = useSyncExternalStore(game.subscribe, game.getSnapshot, game.getSnapshot);
  const gold = isRunning(g) || g.phase === "ended" ? scoreOf(entry.id, g).gold : null;

  useFrame(() => {
    const el = group.current;
    if (!el) return;
    el.position.set(p.position.x, p.height + 0.32, p.position.z);
    const vis = p.firstPerson ? "hidden" : "visible";
    // Only touch the DOM when it actually changes (avoids a style write per frame).
    if (label.current && label.current.style.visibility !== vis) label.current.style.visibility = vis;
  });

  return (
    <group ref={group}>
      <Html center zIndexRange={[2, 1]} pointerEvents="none">
        <div ref={label} className={styles.tag} style={{ "--c": entry.color }}>
          {bubble ? (
            <div className={styles.bubble} key={bubble.until}>
              <span className={styles.bubbleText}>{bubble.text}</span>
            </div>
          ) : (
            <div className={styles.name}>
              <span className={styles.dot} aria-hidden="true" />
              <span>{entry.name}</span>
              {gold != null && <span className={styles.gold}>{gold}</span>}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}
