"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { CHARACTERS } from "./scene/characters";
import { setInput } from "./scene/controls";
import { roster, cyclePlayerCharacter, setPlayerCharacter } from "./scene/roster";
import { game, getGame, setReady, startRound } from "./scene/game";
import { choose, closeDialog, dialogOf, npcs, talk } from "./scene/npcs";
import DialogPanel from "./party/DialogPanel";
import ConnectPhone, { useHostSession } from "./connect/ConnectPhone";
import GameHud from "./party/GameHud";
import ChatBox from "./party/ChatBox";
import { startPartyHost } from "./party/partyHost";
import { hostSession } from "@/lib/connect/hostSession";
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

// Character picker (solo): shows who you are; opens a menu of everyone else.
function CharacterPicker({ index, onPick }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const current = CHARACTERS[index];

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.pickerWrap} ref={wrap}>
      <button
        type="button"
        className={styles.chip}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change character (C)"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.swatch} style={{ "--accent": current.accent }} aria-hidden="true" />
        <span className={styles.chipLabel}>{current.name}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className={styles.chevron}>
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className={styles.menu} role="menu" aria-label="Characters">
          {CHARACTERS.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              aria-checked={i === index}
              className={`${styles.menuItem} ${i === index ? styles.menuItemActive : ""}`}
              style={{ "--accent": c.accent }}
              onClick={() => {
                onPick(i);
                setOpen(false);
              }}
            >
              <span className={styles.swatch} aria-hidden="true" />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// First-person / third-person switch (solo).
function ViewToggle({ thirdPerson, onChange }) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label="Camera view" title="Switch view (V)">
      {[
        [false, "FPP", "First person"],
        [true, "TPP", "Third person"],
      ].map(([value, label, full]) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={thirdPerson === value}
          aria-label={full}
          className={`${styles.segment} ${thirdPerson === value ? styles.segmentOn : ""}`}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Street lamp switch. Lit by default; off leaves only the moon, stars and torches.
function LightSwitch({ on, onToggle }) {
  return (
    <button
      type="button"
      className={`${styles.chip} ${on ? styles.lit : ""}`}
      aria-pressed={on}
      aria-label={on ? "Turn street lights off" : "Turn street lights on"}
      title={`${on ? "Lights off" : "Lights on"} (L)`}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"
          fill={on ? "currentColor" : "none"}
          fillOpacity={on ? 0.35 : 0}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.chipLabel}>{on ? "Lights off" : "Lights on"}</span>
    </button>
  );
}

export default function HomeScene() {
  const [lampsOn, setLampsOn] = useState(true);
  const [thirdPerson, setThirdPerson] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const players = useSyncExternalStore(roster.subscribe, roster.getSnapshot, roster.getSnapshot);
  const phase = useSyncExternalStore(game.subscribe, () => game.getSnapshot().phase, () => "lobby");
  const party = players.length > 1;
  const lead = players[0];
  const localId = lead && !lead.peerId && !party ? lead.id : null;
  const dialog = useSyncExternalStore(npcs.subscribe, () => (localId ? dialogOf(localId) : null), () => null);

  // Shortcuts (solo only: with several players the keyboard types in the chat).
  // L lights, C next character, V switch view, Enter start the hunt.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (roster.getSnapshot().length > 1) return;
      const me = roster.getSnapshot()[0];
      // Talking to the townsfolk: E starts, 1-4 answers, Esc walks off.
      const d = dialogOf(me.id);
      if (d) {
        const n = Number(e.key);
        if (n >= 1 && n <= d.options.length) {
          choose(me.id, d.options[n - 1].id);
          e.preventDefault();
          return;
        }
        if (e.code === "Escape") {
          closeDialog(me.id);
          return;
        }
      }
      if (e.code === "KeyE") {
        talk(me.id);
        return;
      }
      if (e.code === "KeyL") setLampsOn((v) => !v);
      else if (e.code === "KeyC") cyclePlayerCharacter(me.id);
      else if (e.code === "KeyV") setThirdPerson((v) => !v);
      else if (e.code === "Enter") {
        if (getGame().phase === "briefing") setReady(me.id, true);
        else startRound();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Phones: resume this tab's room after a reload, wire players/chat/game to
  // them, and handle the shared buttons like the keyboard shortcuts.
  useEffect(() => {
    if (!hostSession) return undefined;
    hostSession.resumeIfRemembered();
    const stopParty = startPartyHost(hostSession);
    const offAction = hostSession.onAction(({ name }) => {
      if (name === "lights") setLampsOn((v) => !v);
      else if (name === "view") setThirdPerson((v) => !v);
    });
    return () => {
      stopParty();
      offAction();
    };
  }, []);

  // Mirror scene state to the phones so their toggles show the truth.
  const phoneCount = useHostSession().peers.length;
  useEffect(() => {
    if (phoneCount) hostSession?.broadcast({ type: "state", lampsOn, thirdPerson, party });
  }, [lampsOn, thirdPerson, party, phoneCount]);

  // The controls hint fades away after a while.
  useEffect(() => {
    const id = setTimeout(() => setHintVisible(false), 14000);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className={styles.stage}>
      <Scene lampsOn={lampsOn} thirdPerson={thirdPerson} />
      <GameHud />
      {dialog && <DialogPanel playerId={localId} dialog={dialog} />}
      <div className={styles.toolbar}>
        <ConnectPhone chipClass={styles.chip} labelClass={styles.chipLabel} />
        {!party && lead && <CharacterPicker index={lead.character} onPick={(i) => setPlayerCharacter(lead.id, i)} />}
        {!party && <ViewToggle thirdPerson={thirdPerson} onChange={setThirdPerson} />}
        <LightSwitch on={lampsOn} onToggle={() => setLampsOn((v) => !v)} />
      </div>
      {party ? (
        <ChatBox />
      ) : (
        <>
          <p className={`${styles.hint} ${hintVisible && phase === "lobby" ? "" : styles.hintHidden}`} aria-hidden={!hintVisible}>
            <kbd>W</kbd>
            <kbd>S</kbd> / <kbd>↑</kbd>
            <kbd>↓</kbd> walk · <kbd>←</kbd>
            <kbd>→</kbd> turn · <kbd>A</kbd>
            <kbd>D</kbd> side-step · <kbd>Shift</kbd> run · drag to look (the torch follows) · <kbd>V</kbd> view · <kbd>C</kbd>{" "}
            character · <kbd>E</kbd> talk · <kbd>L</kbd> lights · <kbd>Enter</kbd> start
          </p>
          <div className={styles.pad}>
            <ArrowButton dir="forward" label="Move forward" className={styles.up}>
              ▲
            </ArrowButton>
            <ArrowButton dir="left" label="Turn left" className={styles.left}>
              ◀
            </ArrowButton>
            <ArrowButton dir="right" label="Turn right" className={styles.right}>
              ▶
            </ArrowButton>
            <ArrowButton dir="backward" label="Move backward" className={styles.down}>
              ▼
            </ArrowButton>
          </div>
        </>
      )}
    </div>
  );
}
