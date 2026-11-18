"use client";

import dynamic from "next/dynamic";
import { setInput } from "./scene/controls";
import styles from "./HomeScene.module.css";

// three.js needs the browser (WebGL, canvas). Loading it client-only also keeps
// it out of the initial HTML/JS, so the page shell paints instantly.
const Scene = dynamic(() => import("./scene/Scene"), {
  ssr: false,
  loading: () => <div className={styles.loader} />,
});

// Hold-to-move on-screen arrow: works with mouse and touch.
function ArrowButton({ dir, label, className, children }) {
  const press = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setInput(dir, true);
  };
  const release = () => setInput(dir, false);
  return (
    <button
      type="button"
      aria-label={label}
      className={`${styles.arrow} ${className}`}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

export default function HomeScene() {
  return (
    <div className={styles.stage}>
      <Scene />
      <div className={styles.pad}>
        <ArrowButton dir="forward" label="Move forward" className={styles.up}>▲</ArrowButton>
        <ArrowButton dir="left" label="Move left" className={styles.left}>◀</ArrowButton>
        <ArrowButton dir="right" label="Move right" className={styles.right}>▶</ArrowButton>
        <ArrowButton dir="backward" label="Move backward" className={styles.down}>▼</ArrowButton>
      </div>
    </div>
  );
}
