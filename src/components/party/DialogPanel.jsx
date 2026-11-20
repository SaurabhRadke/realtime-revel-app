"use client";

import { useState } from "react";
import Typewriter from "@/components/ui/Typewriter";
import { NPCS, choose, closeDialog } from "@/components/scene/npcs";
import { ItemIcon, Portrait } from "./Icons";
import styles from "./DialogPanel.module.css";

/**
 * The keyboard player's conversation with a townsfolk (phones show their
 * own). The line types out; the answers appear once it's done (or straight
 * away if clicked). Keys 1-4 pick an answer, Esc walks off (HomeScene).
 */
export default function DialogPanel({ playerId, dialog }) {
  const npc = NPCS[dialog.npc];
  // Answers show once the line has finished typing (per line: keyed on `dialog.key`).
  const [doneKey, setDoneKey] = useState(null);
  const typed = doneKey === dialog.key;

  return (
    <section className={styles.panel} style={{ "--c": npc.color }} aria-label={`Talking with ${npc.name}`}>
      <Portrait src={npc.portrait} color={npc.color} size={88} className={styles.portrait} />
      <div className={styles.body}>
        <header className={styles.head}>
          <span className={styles.name}>{npc.name}</span>
          <span className={styles.role}>{npc.role}</span>
          <button type="button" className={styles.close} onClick={() => closeDialog(playerId)} aria-label="Leave">
            Esc
          </button>
        </header>
        <p className={styles.text} onClick={() => setDoneKey(dialog.key)}>
          <Typewriter key={dialog.key} text={dialog.text} cps={55} onDone={() => setDoneKey(dialog.key)} />
        </p>
        <ol className={styles.options} data-shown={typed}>
          {dialog.options.map((o, i) => (
            <li key={o.id}>
              <button type="button" className={styles.option} disabled={o.disabled} onClick={() => choose(playerId, o.id)}>
                <span className={styles.num}>{i + 1}</span>
                <span className={styles.label}>{o.label}</span>
                {o.cost != null && (
                  <span className={styles.cost}>
                    <ItemIcon name="coin" size={18} /> {o.cost}
                  </span>
                )}
                {o.note && <span className={styles.note}>{o.note}</span>}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
