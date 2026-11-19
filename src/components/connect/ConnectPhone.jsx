"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { hostSession } from "@/lib/connect/hostSession";
import styles from "./ConnectPhone.module.css";

const SERVER_SNAPSHOT = { status: "idle", roomId: null, joinOrigins: [], joinOrigin: null, maxControllers: 1, peers: [], error: null };
const noopSubscribe = () => () => {};

export function useHostSession() {
  return useSyncExternalStore(
    hostSession?.subscribe ?? noopSubscribe,
    hostSession?.getSnapshot ?? (() => SERVER_SNAPSHOT),
    () => SERVER_SNAPSHOT,
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2.5 9.5a4 4 0 0 1 0 5M21.5 9.5a4 4 0 0 0 0 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function QrImage({ url }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(url, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0f19", light: "#efe8d6" },
    }).then((svg) => alive && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`));
    return () => {
      alive = false;
    };
  }, [url]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- generated data URI
    <img className={styles.qr} src={src} alt={`QR code for ${url}`} width={208} height={208} />
  ) : (
    <div className={styles.qr} />
  );
}

function PeerRow({ peer }) {
  const rtt = peer.rtt == null ? "…" : `${Math.round(peer.rtt)} ms`;
  return (
    <li className={styles.peer}>
      <span className={styles.dot} data-on="true" aria-hidden="true" />
      <span className={styles.peerName}>{peer.name}</span>
      <span
        className={styles.badge}
        data-kind={peer.transport}
        title={
          peer.transport === "p2p"
            ? "WebRTC DataChannel: input goes straight from the phone to this browser"
            : "Relayed through the server's WebSocket (WebRTC not up yet or blocked)"
        }
      >
        {peer.transport === "p2p" ? "P2P" : "Relay"}
      </span>
      <span className={styles.rtt}>{rtt}</span>
      <button type="button" className={styles.kick} aria-label={`Disconnect ${peer.name}`} onClick={() => hostSession.kick(peer.id)}>
        ×
      </button>
    </li>
  );
}

function Panel({ state, onClose }) {
  const url = state.joinOrigin && state.roomId ? `${state.joinOrigin}/controller?room=${state.roomId}` : null;
  const [copied, setCopied] = useState(false);
  const full = state.peers.length >= state.maxControllers;
  const originHost = state.joinOrigin ? new URL(state.joinOrigin).hostname : "";
  const unreachable = originHost === "localhost" || originHost === "127.0.0.1";
  const selfSigned = state.joinOrigin?.startsWith("https://") && /^\d+\.\d+\.\d+\.\d+$/.test(originHost);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the URL is selectable anyway
    }
  };

  return (
    <div className={styles.panel} role="dialog" aria-label="Connect your phone">
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Phone controller</p>
          <p className={styles.code} aria-label="Room code">
            {state.roomId ?? "····"}
          </p>
        </div>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      {state.status === "open" && url ? (
        <>
          <div className={styles.qrWrap} data-dim={full}>
            <QrImage url={url} />
            {full && <span className={styles.qrFull}>Room full</span>}
          </div>
          <p className={styles.lead}>Scan with your phone camera. Joystick to walk, point the phone to aim the torch.</p>
          <div className={styles.urlRow}>
            <code className={styles.url}>{url}</code>
            <button type="button" className={styles.small} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {state.joinOrigins.length > 1 && (
            <label className={styles.select}>
              <span>Network</span>
              <select value={state.joinOrigin ?? ""} onChange={(e) => hostSession.setJoinOrigin(e.target.value)}>
                {state.joinOrigins.map((o) => (
                  <option key={o} value={o}>
                    {o.replace(/^https?:\/\//, "")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {unreachable && <p className={styles.warn}>A phone can&apos;t open localhost. Open this page via your computer&apos;s LAN IP.</p>}
          {selfSigned && (
            <p className={styles.note}>
              First visit: the phone warns about the dev certificate. Tap <b>Advanced → Proceed</b>. HTTPS is required for gyroscope access.
            </p>
          )}
        </>
      ) : (
        <div className={styles.waiting}>
          {state.status === "error" || state.status === "offline" ? state.error ?? "Disconnected, retrying…" : "Opening a room…"}
        </div>
      )}

      <section className={styles.peers}>
        <p className={styles.kicker}>
          Phones {state.peers.length}/{state.maxControllers}
        </p>
        {state.peers.length ? (
          <ul>
            {state.peers.map((p) => (
              <PeerRow key={p.id} peer={p} />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Waiting for a phone…</p>
        )}
      </section>

      <footer className={styles.foot}>
        <button type="button" className={styles.small} onClick={() => hostSession.newRoom()}>
          New code
        </button>
      </footer>
    </div>
  );
}

/** Toolbar button + popover. `chipClass` keeps it styled like the other toolbar chips. */
export default function ConnectPhone({ chipClass, labelClass }) {
  const state = useHostSession();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const connected = state.peers.length > 0;

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

  const toggle = () => {
    if (!open) hostSession?.start();
    setOpen((v) => !v);
  };

  return (
    <div className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={`${chipClass} ${connected ? styles.chipOn : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Use your phone as a controller"
        onClick={toggle}
        data-connect-toggle=""
      >
        <PhoneIcon />
        <span className={labelClass}>{connected ? "Phone connected" : "Connect phone"}</span>
        {state.status !== "idle" && <span className={styles.dot} data-on={connected} aria-hidden="true" />}
      </button>
      {open && <Panel state={state} onClose={() => setOpen(false)} />}
    </div>
  );
}
