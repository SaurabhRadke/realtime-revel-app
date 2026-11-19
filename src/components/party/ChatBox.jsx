"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { roster } from "@/components/scene/roster";
import { chat } from "@/components/scene/chat";
import { MAX_CHAT } from "@/lib/connect/protocol";
import { hostSession } from "@/lib/connect/hostSession";
import { sendChat } from "./partyHost";
import styles from "./ChatBox.module.css";

const LINE_MS = 25_000; // log lines fade after this long

// Bottom-centre chat for the shared screen. Phones drive the characters, so
// the keyboard is free: just start typing and the letters land here. Messages
// go out as one of the players standing close to someone (Tab picks who).
export default function ChatBox() {
  const players = useSyncExternalStore(roster.subscribe, roster.getSnapshot, roster.getSnapshot);
  const { near, log } = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState(null);
  const [hint, setHint] = useState(null);
  const [now, setNow] = useState(0); // 0 until mounted: no clock reads while prerendering
  const input = useRef(null);

  const speakers = players.filter((p) => near[p.id]?.length);
  const speaker = speakers.find((p) => p.id === picked) ?? speakers[0] ?? null;
  const canSend = !!speaker;

  // Age the log so old lines fade away.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 2000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // Type anywhere: printable keys focus the box and go in.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector("[aria-modal='true']")) return; // a dialog is open
      if (e.key.length !== 1) return;
      e.preventDefault();
      setText((v) => (v + e.key).slice(0, MAX_CHAT));
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cycleSpeaker = () => {
    if (speakers.length < 2) return;
    const i = speakers.findIndex((p) => p.id === speaker?.id);
    setPicked(speakers[(i + 1) % speakers.length].id);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (!speaker) {
      setHint("Walk two characters close together first");
      return;
    }
    const res = sendChat(hostSession, speaker, text);
    if (res.error === "alone") setHint(`${speaker.name} has nobody near enough to hear`);
    else if (res.error === "slow") setHint("Easy, one message at a time");
    else {
      setText("");
      setHint(null);
    }
  };

  const lines = log.filter((l) => !now || now - l.at < LINE_MS).slice(-5);

  return (
    <div className={styles.wrap}>
      {lines.length > 0 && (
        <ol className={styles.log} aria-live="polite">
          {lines.map((l) => (
            <li key={l.key} className={styles.line} style={{ "--c": l.color }} data-old={now - l.at > LINE_MS - 6000}>
              <span className={styles.from}>{l.name}</span>
              <span className={styles.msg}>{l.text}</span>
            </li>
          ))}
        </ol>
      )}
      <form className={styles.box} onSubmit={submit} data-on={canSend}>
        <button
          type="button"
          className={styles.speaker}
          style={{ "--c": speaker?.color ?? "#8a93a6" }}
          onClick={cycleSpeaker}
          title={speakers.length > 1 ? "Who is speaking (Tab to switch)" : "Who is speaking"}
          disabled={!canSend}
        >
          <span className={styles.speakerDot} aria-hidden="true" />
          {speaker ? speaker.name : "Nobody near"}
        </button>
        <input
          ref={input}
          className={styles.input}
          value={text}
          maxLength={MAX_CHAT}
          onChange={(e) => {
            setText(e.target.value);
            setHint(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              cycleSpeaker();
            } else if (e.key === "Escape") {
              setText("");
              e.currentTarget.blur();
            }
          }}
          placeholder={canSend ? `Say something as ${speaker.name}… (Enter)` : "Get two characters close together to chat"}
          aria-label="Chat message"
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" className={styles.send} disabled={!text.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M4 12l16-8-6 16-2-6-8-2z" fill="currentColor" />
          </svg>
        </button>
      </form>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}
