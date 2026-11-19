"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ControllerSession } from "@/lib/connect/controllerSession";
import { FLAG_GYRO, FLAG_RUN, FLAG_TORCH, ROOM_CODE_RE } from "@/lib/connect/protocol";
import { orientationToQuaternion, requestOrientationPermission, topEdgeAim } from "@/lib/connect/orientation";
import styles from "./Controller.module.css";

const SERVER_SNAP = { status: "idle", error: null, hostOnline: false, transport: "relay", rtt: null };
const noopSubscribe = () => () => {};

const ERRORS = {
  not_found: "That room doesn't exist any more. Scan the QR code on the screen again.",
  full: "This room already has a phone connected.",
  kicked: "The screen disconnected this phone.",
  host_gone: "The screen went away.",
  host_closed: "The screen closed the room.",
  join_failed: "Couldn't join the room.",
};

const R2D = 180 / Math.PI;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const buzz = (ms = 8) => navigator.vibrate?.(ms);

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  const m = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/);
  return m ? m[1].trim().slice(0, 24) : /Android/.test(ua) ? "Android" : "Phone";
}

// ---------- Joystick ----------
const DEADZONE = 0.12;

function Joystick({ onChange }) {
  const base = useRef(null);
  const knob = useRef(null);
  const active = useRef(null);

  const update = (e) => {
    const r = base.current.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    const travel = radius * 0.62;
    knob.current.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;
    // Rescale past the deadzone so output still starts from 0 and reaches 1.
    const m = Math.min(1, len); // (dx, dy) now has this length
    const k = m < DEADZONE ? 0 : (m - DEADZONE) / (1 - DEADZONE) / m;
    onChange(dx * k, -dy * k);
  };

  const release = (e) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    knob.current.style.transform = "";
    base.current.dataset.active = "false";
    onChange(0, 0);
  };

  return (
    <div
      ref={base}
      className={styles.stick}
      data-active="false"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        base.current.dataset.active = "true";
        buzz(6);
        update(e);
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      role="application"
      aria-label="Movement joystick"
    >
      <div className={styles.stickRing} />
      <div ref={knob} className={styles.knob} />
    </div>
  );
}

// ---------- Screens ----------
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
      <p className={styles.kicker}>Phone controller</p>
      <h1 className={styles.title}>Enter the room code</h1>
      <input
        className={styles.codeInput}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
        placeholder="ABCD"
        autoCapitalize="characters"
        autoComplete="off"
        inputMode="text"
        aria-label="Room code"
      />
      <button className={styles.primary} disabled={!ok}>
        Continue
      </button>
    </form>
  );
}

function StartScreen({ room, onStart, insecure }) {
  return (
    <div className={styles.center}>
      <p className={styles.kicker}>Room</p>
      <p className={styles.bigCode}>{room}</p>
      <div className={styles.howto}>
        <p>
          <b>Left thumb:</b> joystick to walk.
        </p>
        <p>
          <b>Point the phone</b> like a torch. The top edge aims the light.
        </p>
      </div>
      {insecure && (
        <p className={styles.warn}>This page isn&apos;t on HTTPS, so the gyroscope is blocked. The joystick still works.</p>
      )}
      <button className={styles.primary} onClick={onStart}>
        Start
      </button>
    </div>
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

function ActionButton({ label, on, onPress, children }) {
  return (
    <button
      type="button"
      className={styles.action}
      data-on={on ? "true" : "false"}
      aria-pressed={on === undefined ? undefined : on}
      onClick={() => {
        buzz(10);
        onPress();
      }}
    >
      <span className={styles.actionIcon} aria-hidden="true">
        {children}
      </span>
      <span>{label}</span>
    </button>
  );
}

// ---------- Main ----------
export default function Controller() {
  const [session] = useState(() => (typeof window === "undefined" ? null : new ControllerSession()));
  const snap = useSyncExternalStore(session?.subscribe ?? noopSubscribe, session?.getSnapshot ?? (() => SERVER_SNAP), () => SERVER_SNAP);

  // URL + security context are only known in the browser (null on the server).
  const search = useSyncExternalStore(noopSubscribe, () => window.location.search, () => null);
  const insecure = useSyncExternalStore(noopSubscribe, () => !window.isSecureContext, () => false);
  const [typedRoom, setTypedRoom] = useState(null);
  const [ignoreUrl, setIgnoreUrl] = useState(false);
  const [started, setStarted] = useState(false);

  const urlRoom = search == null ? "" : (new URLSearchParams(search).get("room") ?? "").toUpperCase();
  const room = typedRoom ?? (!ignoreUrl && ROOM_CODE_RE.test(urlRoom) ? urlRoom : null);
  const phase = search == null ? "loading" : !room ? "code" : !started ? "ready" : "live";
  const [gyro, setGyro] = useState("pending"); // pending | on | none | denied
  const [torch, setTorch] = useState(true);
  const [run, setRun] = useState(false);
  const [hostState, setHostState] = useState(null);

  const needle = useRef(null);
  const tiltDot = useRef(null);
  const zero = useRef({ heading: null, elevation: 0 });

  useEffect(() => () => session?.leave(), [session]);

  useEffect(() => session?.onMessage((obj) => obj?.type === "state" && setHostState(obj)), [session]);

  // Flags travel in every input packet.
  useEffect(() => {
    if (!session) return;
    session.setFlags((gyro === "on" ? FLAG_GYRO : 0) | (run ? FLAG_RUN : 0) | (torch ? FLAG_TORCH : 0));
  }, [session, gyro, run, torch]);

  // Gyroscope -> quaternion, every sensor event (~60 Hz).
  useEffect(() => {
    if (phase !== "live" || !session || gyro === "denied") return undefined;
    let raf = 0;
    let seen = false;
    const onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      if (!seen) {
        seen = true;
        setGyro("on");
      }
      const q = orientationToQuaternion(e.alpha ?? 0, e.beta, e.gamma);
      session.setAttitude(q);
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          const { heading, elevation } = topEdgeAim(q);
          if (zero.current.heading == null) zero.current = { heading, elevation };
          const h = wrap(heading - zero.current.heading);
          const p = elevation - zero.current.elevation;
          if (needle.current) needle.current.style.transform = `rotate(${h * R2D}deg)`;
          if (tiltDot.current) tiltDot.current.style.transform = `translateY(${Math.max(-1, Math.min(1, -p / 1.2)) * 34}px)`;
        });
      }
    };
    window.addEventListener("deviceorientation", onOrient);
    const noSensor = setTimeout(() => !seen && setGyro("none"), 2000);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      clearTimeout(noSensor);
      cancelAnimationFrame(raf);
    };
  }, [phase, session, gyro]);

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

  const start = async () => {
    buzz(12);
    // Must run inside the tap for iOS to show its motion permission prompt.
    const perm = await requestOrientationPermission();
    setGyro(perm === "granted" ? "pending" : perm === "denied" ? "denied" : "none");
    session.join(room, deviceName());
    setStarted(true);
  };

  const recenter = () => {
    zero.current.heading = null;
    session.action("recenter");
  };

  if (phase === "loading") return <main className={styles.root} />;

  if (phase === "code") {
    return (
      <main className={styles.root}>
        <CodeEntry
          onSubmit={(code) => setTypedRoom(code)}
        />
      </main>
    );
  }

  if (phase === "ready") {
    return (
      <main className={styles.root}>
        <StartScreen room={room} onStart={start} insecure={insecure} />
      </main>
    );
  }

  if (snap.status === "error" || snap.status === "closed") {
    return (
      <main className={styles.root}>
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
              session.join(room, deviceName());
            }
          }}
        />
      </main>
    );
  }

  const live = snap.status === "joined" && snap.hostOnline;
  const statusText =
    snap.status !== "joined" ? "Connecting…" : !snap.hostOnline ? "Waiting for the screen…" : snap.transport === "p2p" ? "P2P" : "Relay";

  return (
    <main className={styles.root}>
      <div className={styles.live}>
        <header className={styles.bar}>
          <span className={styles.roomTag}>{room}</span>
          <span className={styles.status} data-kind={live ? snap.transport : "wait"}>
            <span className={styles.statusDot} />
            {statusText}
            {live && snap.rtt != null && <span className={styles.rtt}>{snap.rtt} ms</span>}
          </span>
        </header>

        <section className={styles.aim}>
          <div className={styles.compass} data-off={gyro !== "on" || !torch ? "true" : "false"}>
            <div ref={needle} className={styles.needle} />
            <div className={styles.tiltTrack}>
              <div ref={tiltDot} className={styles.tiltDot} />
            </div>
          </div>
          <p className={styles.aimText}>
            {gyro === "on"
              ? torch
                ? "Point the top of the phone to aim the torch"
                : "Torch aiming paused"
              : gyro === "denied"
                ? "Motion access denied: aiming is off"
                : gyro === "none"
                  ? insecure
                    ? "Gyro needs HTTPS: aiming is off"
                    : "No gyroscope found: aiming is off"
                  : "Reading the gyroscope…"}
          </p>
          <div className={styles.aimButtons}>
            <ActionButton label={torch ? "Aim on" : "Aim off"} on={torch} onPress={() => setTorch((v) => !v)}>
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M4 10l8-6 8 6M7 13h10l-2 7H9z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </ActionButton>
            <ActionButton label="Recenter" onPress={recenter}>
              <svg viewBox="0 0 24 24" width="20" height="20">
                <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </ActionButton>
          </div>
        </section>

        <section className={styles.actions}>
          <ActionButton label={hostState?.lampsOn === false ? "Lights on" : "Lights off"} on={hostState?.lampsOn} onPress={() => session.action("lights")}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </ActionButton>
          <ActionButton label={hostState?.thirdPerson ? "TPP" : "FPP"} onPress={() => session.action("view")}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </ActionButton>
          <ActionButton label={hostState?.character ?? "Character"} onPress={() => session.action("character")}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M4 21c1-4 4-6 8-6s7 2 8 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </ActionButton>
        </section>

        <section className={styles.controls}>
          <Joystick
            onChange={(x, y) => {
              session.setJoystick(x, y);
            }}
          />
          <button
            type="button"
            className={styles.run}
            data-on={run ? "true" : "false"}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              buzz(8);
              setRun(true);
            }}
            onPointerUp={() => setRun(false)}
            onPointerCancel={() => setRun(false)}
            onLostPointerCapture={() => setRun(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            RUN
          </button>
        </section>
      </div>
    </main>
  );
}
