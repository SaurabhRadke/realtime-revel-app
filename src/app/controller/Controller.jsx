"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ControllerSession } from "@/lib/connect/controllerSession";
import { FLAG_RUN, MAX_CHAT, MAX_NAME, ROOM_CODE_RE, cleanText } from "@/lib/connect/protocol";
import { MODES, MODE_IDS, SHOP, TOWNSFOLK } from "@/components/scene/missions";
import Typewriter from "@/components/ui/Typewriter";
import styles from "./Controller.module.css";

const SERVER_SNAP = { status: "idle", error: null, hostOnline: false, transport: "relay", rtt: null };
const noopSubscribe = () => () => {};
const NAME_KEY = "gyro.playerName";
const SPEED_KEY = "gyro.lookSpeed";

const ERRORS = {
  not_found: "That room doesn't exist any more. Scan the QR code on the screen again.",
  full: "This room is full (4 players). Ask someone to leave, then try again.",
  kicked: "The screen disconnected this phone.",
  host_gone: "The screen went away.",
  host_closed: "The screen closed the room.",
  join_failed: "Couldn't join the room.",
};

const QUICK = ["Over here!", "Found a key!", "Follow me", "Race you!", "Nice!", "👋"];

const PORTRAITS = { wick: "/ui/portraits/wick.webp", hollow: "/ui/portraits/hollow.webp", ember: "/ui/portraits/ember.webp" };
const FOLK_COLOR = { wick: "#ffd36e", hollow: "#c9a4ff", ember: "#ff9a5a" };
const GOAL_ICON = { coin: "/ui/icons/coin.webp", key: "/ui/icons/key.webp", oil: "/ui/icons/oil.webp", chest: "/ui/icons/chest.webp" };

// Look pad: radians per CSS pixel swiped (~0.3 degrees), times the chosen speed.
const LOOK_PER_PX = 0.0062;
const LOOK_Y_SCALE = 0.75; // up/down a bit calmer than turning
const LOOK_SPEEDS = [0.55, 0.75, 1, 1.3, 1.7];

// "Key sense": how close the nearest hidden key is, sent by the screen.
const SENSE = ["Cold", "Cool", "Warm", "Hot", "Burning!"];

const NAME_POOL = ["Wisp", "Moth", "Ember", "Pip", "Rook", "Bramble", "Fable", "Lark", "Quill", "Sable", "Thistle", "Wren"];

function savedName() {
  try {
    const n = cleanText(localStorage.getItem(NAME_KEY), MAX_NAME);
    if (n) return n;
  } catch {
    // private mode
  }
  return NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
}

function savedSpeed() {
  try {
    const raw = localStorage.getItem(SPEED_KEY);
    const v = raw == null ? NaN : Number(raw);
    if (Number.isInteger(v) && v >= 0 && v < LOOK_SPEEDS.length) return v;
  } catch {
    // private mode
  }
  return 2;
}

function storeSpeed(v) {
  try {
    localStorage.setItem(SPEED_KEY, String(v));
  } catch {
    // not remembered
  }
}

function storeName(n) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    // private mode: the name just won't be remembered
  }
}

// Android Chrome can go fullscreen and lock to landscape (needs the tap that
// starts the game). iOS can't: the "turn your phone" prompt covers that.
function goLandscape() {
  const el = document.documentElement;
  if (!el.requestFullscreen || document.fullscreenElement) return;
  el.requestFullscreen({ navigationUI: "hide" })
    .then(() => screen.orientation?.lock?.("landscape"))
    .catch(() => {});
}

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ---------- Icons ----------
const Icon = {
  run: (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <circle cx="14.5" cy="4.5" r="2" fill="currentColor" />
      <path d="M9 21l3-6 3 2v5M6 12l3-4 4 1 3 4 3 1M12 15l-1-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  look: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M5 3l-2 2 2 2M19 3l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  character: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 3l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  lamp: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  pen: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 12l16-8-6 16-2-6-8-2z" fill="currentColor" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="7" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M11 12h10M17 12v4M20 12v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
};

// ---------- Joystick ----------
// Floating stick: the whole left zone is touchable and the stick centres on
// wherever the thumb lands, so there is no reaching for a fixed spot. Full
// speed comes at the edge of the knob's travel (not past it), with a small
// deadzone, so it answers to small thumb movements.
const DEADZONE = 0.08;
const KNOB_TRAVEL = 0.62; // of the base radius

function Joystick({ onChange, accent }) {
  const zone = useRef(null);
  const base = useRef(null);
  const knob = useRef(null);
  const active = useRef(null);
  const origin = useRef({ x: 0, y: 0 });
  const lastOut = useRef({ x: 0, y: 0 });

  const emit = (x, y) => {
    if (Math.abs(x - lastOut.current.x) < 0.004 && Math.abs(y - lastOut.current.y) < 0.004 && (x || y)) return;
    lastOut.current = { x, y };
    onChange(x, y);
  };

  const update = (e) => {
    const pull = (base.current.offsetWidth / 2) * KNOB_TRAVEL;
    let dx = (e.clientX - origin.current.x) / pull;
    let dy = (e.clientY - origin.current.y) / pull;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    knob.current.style.transform = `translate(${dx * pull}px, ${dy * pull}px)`;
    // Rescale past the deadzone so output still starts from 0 and reaches 1.
    const m = Math.min(1, len);
    const k = m < DEADZONE ? 0 : (m - DEADZONE) / (1 - DEADZONE) / m;
    emit(dx * k, -dy * k);
  };

  const release = (e) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    knob.current.style.transform = "";
    base.current.style.left = "";
    base.current.style.top = "";
    zone.current.dataset.active = "false";
    emit(0, 0);
  };

  return (
    <div
      ref={zone}
      className={styles.moveZone}
      style={{ "--accent": accent }}
      data-active="false"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        // Centre the stick under the thumb, kept fully inside the zone.
        const z = zone.current.getBoundingClientRect();
        const r = base.current.offsetWidth / 2;
        const x = Math.max(z.left + r, Math.min(z.right - r, e.clientX));
        const y = Math.max(z.top + r, Math.min(z.bottom - r, e.clientY));
        origin.current = { x, y };
        base.current.style.left = `${x - z.left}px`;
        base.current.style.top = `${y - z.top}px`;
        zone.current.dataset.active = "true";
        update(e);
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="Movement joystick: touch anywhere on the left side"
    >
      <div ref={base} className={styles.stick}>
        <div className={styles.stickRing} />
        <div className={styles.stickRing2} />
        <span className={`${styles.tick} ${styles.tickN}`} />
        <span className={`${styles.tick} ${styles.tickE}`} />
        <span className={`${styles.tick} ${styles.tickS}`} />
        <span className={`${styles.tick} ${styles.tickW}`} />
        <div ref={knob} className={styles.knob}>
          <span className={styles.knobFlame} />
        </div>
      </div>
      <span className={styles.zoneLabel}>Move</span>
    </div>
  );
}

// ---------- Look pad (right half): swipe to turn, like a mobile shooter ----------
// Only the finger's movement counts (not where it lands), so any spot of the
// pad works and lifting + re-swiping keeps turning. Each move event sends its
// delta straight to the session; the screen smooths it.
function LookPad({ onLook, speed }) {
  const pad = useRef(null);
  const dot = useRef(null);
  const active = useRef(null);
  const last = useRef({ x: 0, y: 0 });

  const place = (e) => {
    const r = pad.current.getBoundingClientRect();
    dot.current.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
  };

  const move = (e) => {
    if (active.current !== e.pointerId) return;
    // Coalesced events: every touch sample since the last frame (smoother on 120 Hz screens).
    const list = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const pts = list.length ? list : [e.nativeEvent];
    let dx = 0;
    let dy = 0;
    for (const p of pts) {
      dx += p.clientX - last.current.x;
      dy += p.clientY - last.current.y;
      last.current = { x: p.clientX, y: p.clientY };
    }
    if (dx || dy) {
      const k = LOOK_PER_PX * LOOK_SPEEDS[speed];
      onLook(dx * k, -dy * k * LOOK_Y_SCALE);
    }
    place(e);
  };

  const release = (e) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    pad.current.dataset.active = "false";
  };

  return (
    <div
      ref={pad}
      className={styles.lookPad}
      data-active="false"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = { x: e.clientX, y: e.clientY };
        pad.current.dataset.active = "true";
        place(e);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="Look pad: swipe to look around"
    >
      <span className={styles.lookHint}>
        {Icon.look}
        <span>Swipe to look</span>
      </span>
      <span className={`${styles.lookArrow} ${styles.lookArrowL}`} aria-hidden="true" />
      <span className={`${styles.lookArrow} ${styles.lookArrowR}`} aria-hidden="true" />
      <span className={`${styles.lookArrow} ${styles.lookArrowU}`} aria-hidden="true" />
      <span className={`${styles.lookArrow} ${styles.lookArrowD}`} aria-hidden="true" />
      <span ref={dot} className={styles.lookDot} aria-hidden="true" />
    </div>
  );
}

function SenseMeter({ level, label = "Key sense" }) {
  return (
    <div className={styles.sense} data-level={level} aria-label={`${label}: ${SENSE[level]}`}>
      <span className={styles.senseLabel}>{label}</span>
      <span className={styles.senseBars} aria-hidden="true">
        {SENSE.map((_, i) => (
          <span key={i} className={styles.senseBar} data-on={i <= level} />
        ))}
      </span>
      <span className={styles.senseWord}>{SENSE[level]}</span>
    </div>
  );
}

/* eslint-disable @next/next/no-img-element */

// ---------- Missions, briefing, townsfolk ----------

function ModePicker({ mode, onPick }) {
  return (
    <div className={styles.modes} role="radiogroup" aria-label="Mission">
      {MODE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          className={styles.modeBtn}
          data-on={mode === id}
          onClick={() => onPick(id)}
        >
          <img src={id === "lamps" ? GOAL_ICON.oil : GOAL_ICON.key} alt="" width={30} height={30} />
          <span>
            <b>{MODES[id].title}</b>
            <small>{MODES[id].kind}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function GoalIcon({ icon }) {
  if (GOAL_ICON[icon]) return <img src={GOAL_ICON[icon]} alt="" width={30} height={30} className={styles.goalImg} />;
  return <span className={styles.goalGlyph} data-icon={icon} aria-hidden="true" />;
}

// Full-screen briefing on the phone: typed story, goals, townsfolk, Ready.
function BriefingSheet({ g, deadline, now, onReady }) {
  const mode = MODES[g.mode] ?? MODES.hunt;
  const [step, setStep] = useState(0);
  const next = () => setStep((v) => v + 1);
  const left = deadline && now ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  return (
    <div className={styles.brief} role="dialog" aria-modal="true" aria-labelledby="brief-title">
      <div className={styles.briefScroll}>
        <p className={styles.kicker}>
          Mission · {mode.kind} · {mode.minutes} min
        </p>
        <h2 id="brief-title" className={styles.briefTitle}>
          {mode.title}
        </h2>
        <p className={styles.briefStory} onClick={() => step === 0 && next()}>
          <Typewriter text={mode.story} cps={70} onDone={() => step === 0 && next()} />
        </p>
        <ol className={styles.briefGoals}>
          {mode.goals.map((goal, i) => (
            <li key={goal.text} data-shown={step > i}>
              <GoalIcon icon={goal.icon} />
              <span>{step === i + 1 ? <Typewriter text={goal.text} cps={85} onDone={next} /> : step > i + 1 ? goal.text : ""}</span>
            </li>
          ))}
        </ol>
        <div className={styles.briefFolk} data-shown={step > mode.goals.length}>
          {TOWNSFOLK.map((t) => (
            <div key={t.id} className={styles.folk} style={{ "--c": FOLK_COLOR[t.id] }}>
              <img src={PORTRAITS[t.id]} alt="" width={44} height={44} />
              <span>
                <b>{t.name}</b> {t.where}: {t.does}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.briefFoot}>
        <span className={styles.briefWait}>
          {g.readyCount}/{g.players} ready{left != null ? ` · starts in ${left}s` : ""}
        </span>
        <button type="button" className={`${styles.primary} ${styles.readyBtn}`} data-on={g.ready} disabled={g.ready} onClick={onReady}>
          {g.ready ? "Ready ✓ waiting…" : "I'm ready"}
        </button>
      </div>
    </div>
  );
}

// A conversation with one of the townsfolk: their line types out, then the answers.
function DialogSheet({ dialog, gold, onChoose, onClose }) {
  const [doneKey, setDoneKey] = useState(null);
  const typed = doneKey === dialog.key;
  return (
    <section className={styles.talkSheet} style={{ "--c": dialog.color }} aria-label={`Talking with ${dialog.name}`}>
      <header className={styles.talkHead}>
        <img src={PORTRAITS[dialog.npc]} alt="" width={52} height={52} className={styles.talkPortrait} />
        <span className={styles.talkWho}>
          <b>{dialog.name}</b>
          <small>{dialog.role}</small>
        </span>
        <span className={styles.talkGold}>◉ {gold}</span>
        <button type="button" className={styles.iconBtn} aria-label="Leave" onClick={onClose}>
          {Icon.close}
        </button>
      </header>
      <p className={styles.talkText} onClick={() => setDoneKey(dialog.key)}>
        <Typewriter key={dialog.key} text={dialog.text} cps={55} onDone={() => setDoneKey(dialog.key)} />
      </p>
      <div className={styles.talkOptions} data-shown={typed}>
        {dialog.options.map((o) => (
          <button key={o.id} type="button" className={styles.talkOption} disabled={o.disabled || !typed} onClick={() => onChoose(o.id)}>
            <span>{o.label}</span>
            {o.cost != null && <span className={styles.talkCost}>◉ {o.cost}</span>}
            {o.note && <small>{o.note}</small>}
          </button>
        ))}
      </div>
    </section>
  );
}

function BoostChips({ boosts, base, now, carrying }) {
  const list = Object.entries(boosts ?? {})
    .map(([k, ms]) => ({ k, left: base + ms - now }))
    .filter((b) => b.left > 0);
  if (!list.length && !carrying) return null;
  return (
    <div className={styles.boosts}>
      {carrying && (
        <span className={styles.boost} data-kind="carry">
          <img src={GOAL_ICON.oil} alt="" width={18} height={18} /> Carrying oil: to Old Wick!
        </span>
      )}
      {list.map((b) => (
        <span key={b.k} className={styles.boost} data-low={b.left < 5000}>
          {SHOP[b.k]?.label ?? b.k} {Math.ceil(b.left / 1000)}s
        </span>
      ))}
    </div>
  );
}

// ---------- Screens ----------
function Shell({ children }) {
  return (
    <main className={styles.root}>
      <div className={styles.moon} aria-hidden="true" />
      {children}
    </main>
  );
}

function CodeEntry({ onSubmit }) {
  const [code, setCode] = useState("");
  const ok = ROOM_CODE_RE.test(code);
  return (
    <form
      className={styles.center}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(code);
      }}
    >
      <p className={styles.kicker}>Lanterns &amp; Keys</p>
      <h1 className={styles.title}>Enter the room code</h1>
      <input
        className={styles.codeInput}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
        placeholder="ABCD"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        aria-label="Room code"
      />
      <button className={styles.primary} disabled={!ok}>
        Continue
      </button>
    </form>
  );
}

function StartScreen({ room, name, setName, onStart }) {
  return (
    <form
      className={styles.center}
      onSubmit={(e) => {
        e.preventDefault();
        onStart();
      }}
    >
      <p className={styles.kicker}>Room {room}</p>
      <h1 className={styles.title}>Lanterns &amp; Keys</h1>
      <p className={styles.lead}>A moonlit treasure hunt for up to 4 torches.</p>
      <label className={styles.nameField}>
        <span>Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
          maxLength={MAX_NAME}
          autoComplete="nickname"
          enterKeyHint="go"
          aria-label="Your name"
        />
      </label>
      <ul className={styles.howto}>
        <li>
          Hold your phone <b>sideways</b>. <b>Left thumb</b>: touch anywhere and push to walk. <b>Right thumb</b>: swipe to look and swing your torch.
        </li>
        <li>
          Grab the <b>coins</b>. Follow the <b>fireflies</b> into the dark: hidden keys and oil only show up in torchlight.
        </li>
        <li>
          Walk up to the <b>townsfolk</b> and tap Talk: hints, visions and wares for your gold.
        </li>
      </ul>
      <button className={styles.primary} disabled={!cleanText(name, MAX_NAME)}>
        Join the hunt
      </button>
    </form>
  );
}

function ErrorScreen({ code, onRetry }) {
  return (
    <div className={styles.center}>
      <p className={styles.kicker}>Disconnected</p>
      <p className={styles.message}>{ERRORS[code] ?? "The connection was closed."}</p>
      <button className={styles.primary} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function RoundButton({ label, on, onPress, disabled, children, big, badge }) {
  return (
    <button
      type="button"
      className={`${styles.round} ${big ? styles.roundBig : ""}`}
      data-on={on ? "true" : "false"}
      aria-pressed={on === undefined ? undefined : on}
      disabled={disabled}
      onClick={onPress}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className={styles.roundIcon}>
        {children}
        {badge ? <span className={styles.badge}>{badge}</span> : null}
      </span>
      <span className={styles.roundLabel}>{label}</span>
    </button>
  );
}

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.sheetBackdrop} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.sheetHead}>
          <h2>{title}</h2>
          <button type="button" className={styles.iconBtn} aria-label="Close" onClick={onClose}>
            {Icon.close}
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ChatSheet({ near, messages, onSend, onClose, denied }) {
  const [text, setText] = useState("");
  const list = useRef(null);
  const canTalk = near.length > 0;

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  const send = (t) => {
    const v = cleanText(t, MAX_CHAT);
    if (!v) return;
    onSend(v);
    setText("");
  };

  return (
    <Sheet title="Chat" onClose={onClose}>
      <p className={styles.nearLine} data-on={canTalk}>
        {canTalk ? `Near you: ${near.join(", ")}` : "Nobody is close. Walk up to another player to talk."}
      </p>
      {/* Input sits at the top so the phone keyboard never covers it. */}
      <form
        className={styles.chatForm}
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          className={styles.chatInput}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHAT))}
          placeholder={canTalk ? "Say something…" : "Get closer to someone first"}
          maxLength={MAX_CHAT}
          enterKeyHint="send"
          autoComplete="off"
          aria-label="Message"
        />
        <button type="submit" className={styles.sendBtn} disabled={!canTalk || !cleanText(text, MAX_CHAT)} aria-label="Send">
          {Icon.send}
        </button>
      </form>
      <div className={styles.quick}>
        {QUICK.map((q) => (
          <button key={q} type="button" className={styles.quickBtn} disabled={!canTalk} onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      {denied && <p className={styles.denied}>{denied}</p>}
      <ol className={styles.chatLog} ref={list}>
        {messages.length === 0 && <li className={styles.chatEmpty}>Messages from nearby players show up here and over your character&apos;s head.</li>}
        {messages.map((m) => (
          <li key={m.key} className={styles.chatMsg} data-self={m.self} style={{ "--c": m.color }}>
            <span className={styles.chatFrom}>{m.self ? "You" : m.from}</span>
            <span>{m.text}</span>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

function NameSheet({ name, onSave, onClose }) {
  const [v, setV] = useState(name);
  const ok = !!cleanText(v, MAX_NAME);
  return (
    <Sheet title="Your name" onClose={onClose}>
      <form
        className={styles.chatForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave(cleanText(v, MAX_NAME));
        }}
      >
        <input
          className={styles.chatInput}
          value={v}
          onChange={(e) => setV(e.target.value.slice(0, MAX_NAME))}
          maxLength={MAX_NAME}
          autoFocus
          enterKeyHint="done"
          aria-label="Name"
        />
        <button type="submit" className={styles.saveBtn} disabled={!ok}>
          Save
        </button>
      </form>
      <p className={styles.sheetNote}>This shows over your character&apos;s head on the big screen.</p>
    </Sheet>
  );
}

// ---------- Main ----------
export default function Controller() {
  const [session] = useState(() => (typeof window === "undefined" ? null : new ControllerSession()));
  const snap = useSyncExternalStore(session?.subscribe ?? noopSubscribe, session?.getSnapshot ?? (() => SERVER_SNAP), () => SERVER_SNAP);

  // URL + security context are only known in the browser (null on the server).
  const search = useSyncExternalStore(noopSubscribe, () => window.location.search, () => null);
  const [typedRoom, setTypedRoom] = useState(null);
  const [ignoreUrl, setIgnoreUrl] = useState(false);
  const [started, setStarted] = useState(false);
  // Remembered (or a random) name; only rendered after hydration, so no mismatch.
  const [name, setName] = useState(() => (typeof window === "undefined" ? "" : savedName()));

  const urlRoom = search == null ? "" : (new URLSearchParams(search).get("room") ?? "").toUpperCase();
  const room = typedRoom ?? (!ignoreUrl && ROOM_CODE_RE.test(urlRoom) ? urlRoom : null);
  const phase = search == null ? "loading" : !room ? "code" : !started ? "ready" : "live";
  const [speed, setSpeed] = useState(() => (typeof window === "undefined" ? 2 : savedSpeed()));
  const [sense, setSense] = useState(0);
  const [run, setRun] = useState(false);
  const [hostState, setHostState] = useState(null);
  const [you, setYou] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [now, setNow] = useState(0); // set once mounted (the page is prerendered)
  const [near, setNear] = useState([]);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [sheet, setSheet] = useState(null); // null | "chat" | "name"
  const [denied, setDenied] = useState(null);
  const [upright, setUpright] = useState(false); // played in portrait on purpose
  const [npcNear, setNpcNear] = useState(null); // {id, name, role, color}: who you could talk to
  const [dialog, setDialog] = useState(null); // your conversation with them
  const [boostBase, setBoostBase] = useState(0); // Date.now() the boost timers were sent

  const sheetRef = useRef(sheet);
  const msgKey = useRef(0);

  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);

  const openChat = () => {
    setSheet("chat");
    setUnread(0);
  };

  useEffect(() => () => session?.leave(), [session]);

  // Everything the screen tells this phone.
  useEffect(
    () =>
      session?.onMessage((obj) => {
        if (!obj || typeof obj !== "object") return;
        switch (obj.type) {
          case "state":
            setHostState(obj);
            break;
          case "you":
            setYou(obj);
            break;
          case "game":
            setGameState(obj);
            setDeadline(
              obj.endsIn != null
                ? Date.now() + obj.endsIn
                : obj.startsIn != null
                  ? Date.now() + obj.startsIn
                  : obj.briefingIn != null
                    ? Date.now() + obj.briefingIn
                    : null,
            );
            setBoostBase(Date.now());
            break;
          case "npc":
            setNpcNear(obj.near && typeof obj.near === "object" ? obj.near : null);
            break;
          case "dialog":
            setDialog(obj.npc && Array.isArray(obj.options) ? obj : null);
            break;
          case "sense":
            setSense(Math.max(0, Math.min(SENSE.length - 1, obj.level | 0)));
            break;
          case "near":
            setNear(Array.isArray(obj.names) ? obj.names.slice(0, 4) : []);
            break;
          case "chat":
            setMessages((m) => [...m, { key: ++msgKey.current, from: obj.from, text: obj.text, color: obj.color, self: !!obj.self }].slice(-30));
            if (sheetRef.current !== "chat" && !obj.self) setUnread((n) => n + 1);
            setDenied(null);
            break;
          case "chat:denied":
            setDenied(obj.reason === "slow" ? "One message at a time." : "Nobody is close enough to hear you.");
            break;
          default:
        }
      }),
    [session],
  );

  // Clock for the round timer (the screen sends the deadline once).
  const timed =
    gameState && (gameState.phase === "hunt" || gameState.phase === "unlocked" || gameState.phase === "countdown" || gameState.phase === "briefing");
  useEffect(() => {
    if (!timed) return undefined;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [timed]);

  // Flags travel in every input packet.
  useEffect(() => {
    if (!session) return;
    session.setFlags(run ? FLAG_RUN : 0);
  }, [session, run]);

  // Keep the screen awake while playing.
  useEffect(() => {
    if (phase !== "live" || !("wakeLock" in navigator)) return undefined;
    let lock = null;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch {
        // battery saver etc.
      }
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [phase]);

  const playerName = cleanText(name, MAX_NAME) || "Player";

  const start = () => {
    goLandscape();
    storeName(playerName);
    session.join(room, playerName);
    setStarted(true);
  };

  if (phase === "loading") return <Shell />;

  if (phase === "code") {
    return (
      <Shell>
        <CodeEntry onSubmit={(code) => setTypedRoom(code)} />
      </Shell>
    );
  }

  if (phase === "ready") {
    return (
      <Shell>
        <StartScreen room={room} name={name} setName={setName} onStart={start} />
      </Shell>
    );
  }

  if (snap.status === "error" || snap.status === "closed") {
    return (
      <Shell>
        <ErrorScreen
          code={snap.error}
          onRetry={() => {
            if (snap.error === "not_found" || snap.error === "host_closed" || snap.error === "host_gone") {
              // The code is dead: ask for the new one.
              session.leave();
              setIgnoreUrl(true);
              setTypedRoom(null);
              setStarted(false);
            } else {
              session.join(room, playerName);
            }
          }}
        />
      </Shell>
    );
  }

  const live = snap.status === "joined" && snap.hostOnline;
  const statusText = snap.status !== "joined" ? "Connecting…" : !snap.hostOnline ? "Waiting for screen…" : snap.transport === "p2p" ? "Direct" : "Relay";
  const g = gameState;
  const party = !!hostState?.party;
  const accent = you?.color ?? "#ffd36e";
  const running = g && (g.phase === "hunt" || g.phase === "unlocked");
  const canStart = g && (g.phase === "lobby" || g.phase === "ended");
  const hunting = g?.phase === "hunt";
  const cycleSpeed = () => {
    const v = (speed + 1) % LOOK_SPEEDS.length;
    setSpeed(v);
    storeSpeed(v);
  };

  return (
    <Shell>
      <div className={styles.live} style={{ "--accent": accent }}>
        <header className={styles.top}>
          <div className={styles.bar}>
            <button type="button" className={styles.me} onClick={() => setSheet("name")} aria-label={`Rename (${you?.name ?? playerName})`}>
              <span className={styles.meDot} />
              <span className={styles.meText}>
                <span className={styles.meName}>{you?.name ?? playerName}</span>
                <span className={styles.meChar}>{you?.character ?? "…"}</span>
              </span>
              <span className={styles.pen}>{Icon.pen}</span>
            </button>
            <span className={styles.status} data-kind={live ? snap.transport : "wait"}>
              <span className={styles.statusDot} />
              {statusText}
              {live && snap.rtt != null && <span className={styles.rtt}>{snap.rtt} ms</span>}
            </span>
          </div>

          <p className={styles.objective} data-phase={g?.phase ?? "lobby"}>
            {g?.phase === "countdown" && deadline && now ? (
              `Starting in ${Math.max(1, Math.ceil((deadline - now) / 1000))}…`
            ) : (
              <Typewriter text={g?.objective ?? "Waiting for the screen…"} cps={60} />
            )}
          </p>

          <section className={styles.stats} aria-label="Your hunt">
            <div className={styles.stat}>
              <span className={styles.statVal}>◉ {g?.gold ?? 0}</span>
              <span className={styles.statLabel}>gold</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal}>
                {g?.mode === "lamps" ? <img src={GOAL_ICON.oil} alt="" width={18} height={18} /> : Icon.key} {g?.keysFound ?? 0}/{g?.keysTotal ?? 3}
              </span>
              <span className={styles.statLabel}>{g?.mode === "lamps" ? "lamps lit" : "keys"}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal}>{running && deadline && now ? fmt(deadline - now) : "–:––"}</span>
              <span className={styles.statLabel}>moon sets</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal}>{g?.rank ? `#${g.rank}` : "–"}</span>
              <span className={styles.statLabel}>of {g?.players ?? 1}</span>
            </div>
          </section>
        </header>

        <section className={styles.pads}>
          <Joystick accent={accent} onChange={(x, y) => session.setJoystick(x, y)} />

          <div className={styles.middle}>
            {g?.phase === "ended" && g.result && (
              <div className={styles.result}>
                {g.mode === "lamps"
                  ? g.result.lit
                    ? `Town saved! ${"★".repeat(g.result.stars)}${"☆".repeat(3 - g.result.stars)}`
                    : "The moon set. So close!"
                  : g.result.you === 1
                    ? "You won the hunt! ♛"
                    : `You finished #${g.result.you}. ${g.result.winner} won with ${g.result.winnerGold} gold.`}
              </div>
            )}

            {hunting && !g.carrying && <SenseMeter level={sense} label={g.mode === "lamps" ? "Oil sense" : "Key sense"} />}
            {running && <BoostChips boosts={g.boosts} base={boostBase} now={now} carrying={g.carrying} />}

            {npcNear && !dialog && (
              <button type="button" className={styles.talkBtn} style={{ "--c": npcNear.color }} onClick={() => session.action("talk")}>
                <img src={PORTRAITS[npcNear.id]} alt="" width={34} height={34} />
                <span>
                  Talk to <b>{npcNear.name}</b>
                </span>
              </button>
            )}

            {canStart && <ModePicker mode={g.mode ?? "hunt"} onPick={(id) => session.action("mode", id)} />}
            {canStart && (
              <button type="button" className={`${styles.primary} ${styles.startBtn}`} onClick={() => session.action(g.phase === "ended" ? "again" : "start")}>
                {g.phase === "ended" ? "Play again" : "Start the mission"}
              </button>
            )}

            <div className={styles.bigBtns}>
              <RoundButton label={run ? "Sprinting" : "Sprint"} on={run} big onPress={() => setRun((v) => !v)}>
                {Icon.run}
              </RoundButton>
              <RoundButton label={near.length ? "Talk" : "Chat"} on={near.length > 0} big onPress={openChat} badge={unread || null}>
                {Icon.chat}
              </RoundButton>
            </div>

            <nav className={styles.extras} aria-label="Options">
              <button type="button" className={styles.pill} onClick={() => session.action("character")}>
                {Icon.character} Character
              </button>
              <button type="button" className={styles.pill} data-on={hostState?.lampsOn !== false} onClick={() => session.action("lights")}>
                {Icon.lamp} {hostState?.lampsOn === false ? "Lamps off" : "Lamps on"}
              </button>
              {!party && (
                <button type="button" className={styles.pill} onClick={() => session.action("view")}>
                  {Icon.eye} {hostState?.thirdPerson ? "3rd person" : "1st person"}
                </button>
              )}
              <button type="button" className={styles.pill} onClick={cycleSpeed} aria-label={`Look speed ${speed + 1} of ${LOOK_SPEEDS.length}`}>
                {Icon.look} Look {"●".repeat(speed + 1)}
                <span className={styles.dim}>{"●".repeat(LOOK_SPEEDS.length - speed - 1)}</span>
              </button>
            </nav>
          </div>

          <LookPad speed={speed} onLook={(dx, dy) => session.look(dx, dy)} />
        </section>

        {near.length > 0 && !canStart && sheet !== "chat" && (
          <button type="button" className={styles.nearToast} onClick={openChat}>
            {near.join(", ")} {near.length > 1 ? "are" : "is"} near: tap to talk
          </button>
        )}
      </div>

      {g?.phase === "briefing" && <BriefingSheet key={g.round} g={g} deadline={deadline} now={now} onReady={() => session.action("ready")} />}
      {dialog && g?.phase !== "briefing" && (
        <DialogSheet
          dialog={dialog}
          gold={g?.gold ?? 0}
          onChoose={(id) => session.action("choose", id)}
          onClose={() => session.action("bye")}
        />
      )}

      {!upright && (
        <div className={styles.rotate} role="dialog" aria-label="Turn your phone sideways">
          <span className={styles.rotatePhone} aria-hidden="true" />
          <p className={styles.rotateTitle}>Turn your phone sideways</p>
          <p className={styles.rotateText}>Joystick under your left thumb, look pad under your right.</p>
          <button type="button" className={styles.rotateSkip} onClick={() => setUpright(true)}>
            Keep it upright
          </button>
        </div>
      )}

      {sheet === "chat" && (
        <ChatSheet
          near={near}
          messages={messages}
          denied={denied}
          onSend={(t) => {
            setDenied(null);
            session.chat(t);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "name" && (
        <NameSheet
          name={you?.name ?? playerName}
          onSave={(n) => {
            setName(n);
            storeName(n);
            session.rename(n);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </Shell>
  );
}
