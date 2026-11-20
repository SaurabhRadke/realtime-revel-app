"use client";

import { useEffect, useState } from "react";
import Typewriter from "@/components/ui/Typewriter";
import { MODES, TOWNSFOLK } from "@/components/scene/missions";
import { NPCS } from "@/components/scene/npcs";
import { beginCountdown, setReady } from "@/components/scene/game";
import { ItemIcon, Portrait } from "./Icons";
import styles from "./Briefing.module.css";

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The mission briefing before a round, on the big screen: the story types
 * out, then each goal in turn, then the townsfolk. Every player presses Ready
 * (phones: their Ready button; keyboard: Enter); the round starts when all
 * are ready, when "Start now" is pressed, or after a minute.
 */
export default function Briefing({ g, players, now }) {
  const mode = MODES[g.mode];
  // Typing order: 0 story, 1..n goals, n+1 the win line, then everything shows.
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => s + 1);
  const local = players.find((p) => !p.peerId);
  const all = step > mode.goals.length + 1;

  useEffect(() => {
    // Opening a new briefing (round or mode changed): type it from the top.
    const id = setTimeout(() => setStep(0), 0);
    return () => clearTimeout(id);
  }, [g.mode, g.briefingEndsAt]);

  const readyCount = players.filter((p) => g.ready[p.id]).length;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="brief-title">
      <article className={styles.card}>
        <div className={styles.main}>
          <p className={styles.kicker}>
            Mission · {mode.kind} · {mode.minutes} min
          </p>
          <h2 id="brief-title" className={styles.title}>
            {mode.title}
          </h2>
          <p className={styles.story} onClick={() => step === 0 && next()}>
            <Typewriter text={mode.story} cps={70} onDone={() => step === 0 && next()} />
          </p>

          <ol className={styles.goals}>
            {mode.goals.map((goal, i) => (
              <li key={goal.text} className={styles.goal} data-shown={step > i}>
                <span className={styles.goalIcon}>
                  <ItemIcon name={goal.icon} size={34} />
                </span>
                <span className={styles.goalText}>
                  {step === i + 1 ? <Typewriter text={goal.text} cps={80} onDone={next} /> : step > i + 1 ? goal.text : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className={styles.win} data-shown={step > mode.goals.length}>
            {step === mode.goals.length + 1 ? <Typewriter text={mode.win} cps={70} onDone={next} /> : step > mode.goals.length + 1 ? mode.win : ""}
          </p>
        </div>

        <aside className={styles.side} data-shown={all}>
          <h3 className={styles.sideTitle}>Townsfolk who can help</h3>
          <ul className={styles.folk}>
            {TOWNSFOLK.map((t) => (
              <li key={t.id} className={styles.person} style={{ "--c": NPCS[t.id].color }}>
                <Portrait src={NPCS[t.id].portrait} color={NPCS[t.id].color} size={58} />
                <span>
                  <b className={styles.personName}>{t.name}</b>
                  <span className={styles.personWhere}>{t.where}</span>
                  <span className={styles.personDoes}>{t.does}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.howTalk}>Walk up to them and press Talk on your phone (or E on the keyboard).</p>
        </aside>

        <footer className={styles.foot}>
          <ul className={styles.ready} aria-label={`${readyCount} of ${players.length} ready`}>
            {players.map((p) => (
              <li key={p.id} className={styles.readyChip} data-on={!!g.ready[p.id]} style={{ "--c": p.color }}>
                <span className={styles.readyDot} />
                {p.name}
                <span className={styles.readyMark}>{g.ready[p.id] ? "Ready" : "…"}</span>
              </li>
            ))}
          </ul>
          <span className={styles.auto}>{now ? `Starts in ${fmt(g.briefingEndsAt - now)} or when everyone is ready` : ""}</span>
          <div className={styles.actions}>
            {local && !g.ready[local.id] && (
              <button type="button" className={styles.primary} onClick={() => setReady(local.id, true)}>
                Ready <kbd>Enter</kbd>
              </button>
            )}
            <button type="button" className={styles.secondary} onClick={beginCountdown}>
              Start now
            </button>
          </div>
        </footer>
      </article>
    </div>
  );
}
