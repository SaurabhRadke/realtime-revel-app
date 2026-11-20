"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { roster } from "@/components/scene/roster";
import { CHARACTERS } from "@/components/scene/characters";
import {
  boostLeft,
  game,
  isRunning,
  keySense,
  objective,
  ranking,
  setMode,
  startRound,
  targetsFound,
  targetsTotal,
  teamGold,
} from "@/components/scene/game";
import { MODES, MODE_IDS, SHOP } from "@/components/scene/missions";
import Typewriter from "@/components/ui/Typewriter";
import Briefing from "./Briefing";
import { ItemIcon } from "./Icons";
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

const SENSE = ["Cold", "Cool", "Warm", "Hot", "Burning!"];

// Keyboard player's hot/cold meter (phone players see theirs on the phone).
function SenseLine({ id, lamps }) {
  const level = useSyncExternalStore(keySense.subscribe, () => keySense.get(id), () => 0);
  return (
    <p className={styles.sense} data-level={level}>
      {lamps ? "Oil sense" : "Key sense"}: <b>{SENSE[level]}</b>
    </p>
  );
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
      <Typewriter text={toast.text} cps={70} caret={false} />
    </div>
  );
}

function ModePicker({ mode }) {
  return (
    <div className={styles.modes} role="radiogroup" aria-label="Choose a mission">
      {MODE_IDS.map((id) => {
        const m = MODES[id];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            className={styles.modeCard}
            data-on={mode === id}
            onClick={() => setMode(id)}
          >
            <ItemIcon name={id === "lamps" ? "oil" : "key"} size={40} className={styles.modeIcon} />
            <span className={styles.modeText}>
              <span className={styles.modeTitle}>{m.title}</span>
              <span className={styles.modeKind}>
                {m.kind} · {m.minutes} min
              </span>
              <span className={styles.modeTag}>{m.tagline}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Stars({ n, size = 40 }) {
  return (
    <span className={styles.stars} aria-label={`${n} of 3 stars`} style={{ fontSize: size }}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={styles.star} data-on={i < n} style={{ animationDelay: `${0.25 + i * 0.25}s` }}>
          ★
        </span>
      ))}
    </span>
  );
}

function Results({ g, onClose }) {
  const rank = g.result?.ranking ?? [];
  const opener = rank.find((r) => r.id === g.result?.openerId);
  const lamps = g.result?.mode === "lamps";
  const lit = g.result?.reason === "lit";
  return (
    <div className={styles.resultsBackdrop}>
      <div className={styles.results} role="dialog" aria-modal="true" aria-labelledby="results-title">
        <button type="button" className={styles.close} aria-label="Close results" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        {lamps ? (
          <>
            <p className={styles.kicker}>{lit ? "Lanternfold is lit again" : "The moon has set"}</p>
            <h2 id="results-title" className={styles.resultsTitle}>
              <Typewriter text={lit ? "The town is saved!" : "The dark wins tonight"} cps={30} caret={false} />
            </h2>
            <Stars n={g.result?.stars ?? 0} />
            <p className={styles.resultsSub}>
              {lit
                ? `${opener?.name ?? "The team"} opened the chest with ${fmt(g.result.timeLeft)} to spare. Team gold: ${teamGold(g)}`
                : `${g.oil.delivered} of 5 flasks reached Old Wick. Try again: split up and use the fireflies!`}
            </p>
          </>
        ) : (
          <>
            <p className={styles.kicker}>{g.result?.reason === "chest" ? "The chest is open" : "The moon has set"}</p>
            <h2 id="results-title" className={styles.resultsTitle}>
              <Typewriter text={rank[0] ? `${rank[0].name} wins!` : "Hunt over"} cps={30} caret={false} />
            </h2>
            {opener && <p className={styles.resultsSub}>{opener.name} opened the treasure chest (+10 gold)</p>}
          </>
        )}
        <ol className={styles.podium}>
          {rank.map((r, i) => (
            <li key={r.id} className={styles.podiumRow} style={{ "--c": r.color }} data-first={i === 0 && !lamps}>
              <span className={styles.place}>{lamps ? "•" : i === 0 ? "♛" : i + 1}</span>
              <span className={styles.podiumName}>{r.name}</span>
              <span className={styles.podiumKeys}>
                {lamps
                  ? Array.from({ length: r.oil }, (_, k) => <ItemIcon key={k} name="oil" size={20} />)
                  : Array.from({ length: r.keys }, (_, k) => <KeyIcon key={k} on />)}
              </span>
              <span className={styles.podiumGold}>{r.gold}</span>
            </li>
          ))}
        </ol>
        <ModePicker mode={g.mode} />
        <button type="button" className={styles.primary} onClick={startRound}>
          Play {MODES[g.mode].title}
        </button>
      </div>
    </div>
  );
}

// Lamps Out: how much of the town burns again.
function LampMeter({ g }) {
  const k = g.oil.delivered / 5;
  return (
    <div className={styles.lampMeter} aria-label={`${g.oil.delivered} of 5 flasks delivered`}>
      <span className={styles.lampTrack}>
        <span className={styles.lampFill} style={{ width: `${k * 100}%` }} />
      </span>
      <span className={styles.lampLabel}>{Math.round(k * 100)}% lit</span>
    </div>
  );
}

function Boosts({ id, g, now }) {
  const list = Object.keys(SHOP)
    .map((k) => ({ k, left: boostLeft(id, k, now, g) }))
    .filter((b) => b.left > 0);
  if (!list.length) return null;
  return (
    <div className={styles.boosts}>
      {list.map((b) => (
        <span key={b.k} className={styles.boost} data-low={b.left < 5000}>
          <ItemIcon name={b.k === "oil" ? "torch" : b.k} size={18} />
          {SHOP[b.k].label} <b>{Math.ceil(b.left / 1000)}s</b>
        </span>
      ))}
    </div>
  );
}

export default function GameHud() {
  const g = useGame();
  const players = usePlayers();
  const running = isRunning(g);
  const now = useNow(running || g.phase === "countdown" || g.phase === "briefing");
  const [resultsClosed, setResultsClosed] = useState(0);
  const rank = ranking(g);
  const local = players.find((p) => !p.peerId);
  const solo = players.length === 1 && !players[0].peerId;
  const low = running && g.endsAt - now < 30_000;
  const lamps = g.mode === "lamps";
  const total = targetsTotal(g);
  const found = targetsFound(g);
  const obj = objective(g);

  return (
    <>
      <section className={styles.hud} aria-label="Treasure hunt">
        <header className={styles.head}>
          <h1 className={styles.title}>{g.phase === "lobby" ? "Lanterns & Keys" : MODES[g.mode].title}</h1>
          {running && now > 0 && (
            <span className={styles.timer} data-low={low} aria-label="Time left">
              ☾ {fmt(g.endsAt - now)}
            </span>
          )}
        </header>
        <p className={styles.objective}>
          <Typewriter text={obj} cps={60} />
        </p>
        {solo && g.phase === "hunt" && <SenseLine id={players[0].id} lamps={lamps} />}
        {local && running && <Boosts id={local.id} g={g} now={now} />}

        {(running || g.phase === "countdown" || g.phase === "ended") && (
          <div className={styles.keys} aria-label={`${found} of ${total} found`}>
            {Array.from({ length: total }, (_, i) =>
              lamps ? <ItemIcon key={i} name="oil" size={26} dim={i >= found} /> : <KeyIcon key={i} on={i < found} />,
            )}
            <span className={styles.chestState} data-open={g.phase === "unlocked"}>
              {g.phase === "unlocked" ? "Chest unlocked" : g.phase === "ended" ? "" : "Chest locked"}
            </span>
          </div>
        )}
        {lamps && (running || g.phase === "countdown") && <LampMeter g={g} />}

        {g.phase === "lobby" && <ModePicker mode={g.mode} />}

        <ul className={styles.board}>
          {rank.map((r) => {
            const e = players.find((p) => p.id === r.id);
            const carrying = !!g.oil.carriers[r.id];
            return (
              <li key={r.id} className={styles.row} style={{ "--c": r.color }}>
                <span className={styles.dot} aria-hidden="true" />
                <span className={styles.name}>{r.name}</span>
                {carrying && <ItemIcon name="oil" size={18} />}
                <span className={styles.char}>{e ? CHARACTERS[e.character].name : ""}</span>
                {g.phase !== "lobby" && <span className={styles.gold}>{r.gold}</span>}
              </li>
            );
          })}
        </ul>
        {lamps && g.phase !== "lobby" && <p className={styles.team}>Team gold: {teamGold(g)}</p>}

        {(g.phase === "lobby" || g.phase === "ended") && (
          <button type="button" className={styles.primary} onClick={startRound}>
            {g.phase === "ended" ? "Play again" : "Start the mission"}
          </button>
        )}
        {g.phase === "lobby" && (
          <p className={styles.help}>
            {solo
              ? "Scan the QR (Connect phones) so friends can join, or play here: Enter starts. Walk up to the townsfolk and press E to talk."
              : "Anyone can pick a mission and press Start on their phone."}
          </p>
        )}
      </section>

      {g.phase === "briefing" && <Briefing g={g} players={players} now={now} />}
      <Countdown g={g} now={now} />
      <Toast key={g.toast?.key ?? 0} toast={g.toast} />
      {g.phase === "ended" && resultsClosed !== g.round && <Results g={g} onClose={() => setResultsClosed(g.round)} />}
    </>
  );
}
