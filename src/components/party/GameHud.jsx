"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { roster } from "@/components/scene/roster";
import { CHARACTERS } from "@/components/scene/characters";
import { KEYS_TOTAL, game, isRunning, objective, ranking, startRound } from "@/components/scene/game";
import styles from "./GameHud.module.css";

const useGame = () => useSyncExternalStore(game.subscribe, game.getSnapshot, game.getSnapshot);
const usePlayers = () => useSyncExternalStore(roster.subscribe, roster.getSnapshot, roster.getSnapshot);

// Re-render every `ms` while `on`; returns Date.now().
// (Starts at 0: the page is prerendered, where the clock must not be read.)
function useNow(on, ms = 250) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, ms);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [on, ms]);
  return now;
}

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function KeyIcon({ on }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className={styles.keyIcon} data-on={on}>
      <circle cx="7" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M11 12h10M17 12v4M20 12v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Countdown({ g, now }) {
  if (!now) return null;
  const left = g.startsAt - now;
  if (g.phase !== "countdown" && !(g.phase === "hunt" && now - g.startsAt < 900)) return null;
  const n = Math.ceil(left / 1000);
  const label = n > 0 ? String(n) : "Go!";
  return (
    <div className={styles.countdown} aria-live="assertive">
      <span key={label} className={styles.countNum}>
        {label}
      </span>
    </div>
  );
}

// Remounted per toast (keyed), so each one gets its own few seconds.
function Toast({ toast }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setVisible(false), 3800);
    return () => clearTimeout(id);
  }, []);
  if (!toast || !visible) return null;
  return (
    <div className={styles.toast} style={{ "--c": toast.color }} role="status">
      {toast.text}
    </div>
  );
}

function Results({ g, onClose }) {
  const rank = g.result?.ranking ?? [];
  const opener = rank.find((r) => r.id === g.result?.openerId);
  return (
    <div className={styles.resultsBackdrop}>
      <div className={styles.results} role="dialog" aria-modal="true" aria-labelledby="results-title">
        <button type="button" className={styles.close} aria-label="Close results" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <p className={styles.kicker}>{g.result?.reason === "chest" ? "The chest is open" : "The moon has set"}</p>
        <h2 id="results-title" className={styles.resultsTitle}>
          {rank[0] ? `${rank[0].name} wins!` : "Hunt over"}
        </h2>
        {opener && <p className={styles.resultsSub}>{opener.name} opened the treasure chest (+10 gold)</p>}
        <ol className={styles.podium}>
          {rank.map((r, i) => (
            <li key={r.id} className={styles.podiumRow} style={{ "--c": r.color }} data-first={i === 0}>
              <span className={styles.place}>{i === 0 ? "♛" : i + 1}</span>
              <span className={styles.podiumName}>{r.name}</span>
              <span className={styles.podiumKeys}>
                {Array.from({ length: r.keys }, (_, k) => (
                  <KeyIcon key={k} on />
                ))}
              </span>
              <span className={styles.podiumGold}>{r.gold}</span>
            </li>
          ))}
        </ol>
        <button type="button" className={styles.primary} onClick={startRound}>
          Play again
        </button>
      </div>
    </div>
  );
}

export default function GameHud() {
  const g = useGame();
  const players = usePlayers();
  const running = isRunning(g);
  const now = useNow(running || g.phase === "countdown");
  const [resultsClosed, setResultsClosed] = useState(0);
  const rank = ranking(g);
  const solo = players.length === 1 && !players[0].peerId;
  const low = running && g.endsAt - now < 30_000;

  return (
    <>
      <section className={styles.hud} aria-label="Treasure hunt">
        <header className={styles.head}>
          <h1 className={styles.title}>Lanterns &amp; Keys</h1>
          {running && now > 0 && (
            <span className={styles.timer} data-low={low} aria-label="Time left">
              ☾ {fmt(g.endsAt - now)}
            </span>
          )}
        </header>
        <p className={styles.objective}>{objective(g)}</p>

        {(running || g.phase === "countdown" || g.phase === "ended") && (
          <div className={styles.keys} aria-label={`${g.keysFound} of ${KEYS_TOTAL} keys found`}>
            {Array.from({ length: KEYS_TOTAL }, (_, i) => (
              <KeyIcon key={i} on={i < g.keysFound} />
            ))}
            <span className={styles.chestState} data-open={g.phase === "unlocked"}>
              {g.phase === "unlocked" ? "Chest unlocked" : g.phase === "ended" ? "" : "Chest locked"}
            </span>
          </div>
        )}

        <ul className={styles.board}>
          {rank.map((r) => {
            const e = players.find((p) => p.id === r.id);
            return (
              <li key={r.id} className={styles.row} style={{ "--c": r.color }}>
                <span className={styles.dot} aria-hidden="true" />
                <span className={styles.name}>{r.name}</span>
                <span className={styles.char}>{e ? CHARACTERS[e.character].name : ""}</span>
                {g.phase !== "lobby" && <span className={styles.gold}>{r.gold}</span>}
              </li>
            );
          })}
        </ul>

        {(g.phase === "lobby" || g.phase === "ended") && (
          <button type="button" className={styles.primary} onClick={startRound}>
            {g.phase === "ended" ? "Play again" : "Start the hunt"}
          </button>
        )}
        {g.phase === "lobby" && (
          <p className={styles.help}>
            {solo
              ? "Scan the QR (Connect phones) so friends can join, or play here: Enter starts."
              : "Anyone can press Start on their phone."}
          </p>
        )}
      </section>

      <Countdown g={g} now={now} />
      <Toast key={g.toast?.key ?? 0} toast={g.toast} />
      {g.phase === "ended" && resultsClosed !== g.round && <Results g={g} onClose={() => setResultsClosed(g.round)} />}
    </>
  );
}
