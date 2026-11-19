"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { hostSession } from "@/lib/connect/hostSession";
import { roster } from "@/components/scene/roster";
import styles from "./ConnectPhone.module.css";

const SERVER_SNAPSHOT = { status: "idle", roomId: null, joinOrigins: [], joinOrigin: null, maxControllers: 4, peers: [], error: null };
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
      color: { dark: "#120d06", light: "#f3ead6" },
    }).then((svg) => alive && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`));
    return () => {
      alive = false;
    };
  }, [url]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- generated data URI
    <img className={styles.qr} src={src} alt={`QR code for ${url}`} width={240} height={240} />
  ) : (
    <div className={styles.qr} />
  );
}

function PeerRow({ peer, player }) {
  const rtt = peer.rtt == null ? "…" : `${Math.round(peer.rtt)} ms`;
  return (
    <li className={styles.peer} style={{ "--c": player?.color ?? "#8a93a6" }}>
      <span className={styles.dot} data-on="true" aria-hidden="true" />
      <span className={styles.peerName}>{player?.name ?? peer.name}</span>
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
      <button type="button" className={styles.kick} aria-label={`Disconnect ${player?.name ?? peer.name}`} onClick={() => hostSession.kick(peer.id)}>
        ×
      </button>
    </li>
  );
}

function Overlay({ state, onClose }) {
  const players = useSyncExternalStore(roster.subscribe, roster.getSnapshot, roster.getSnapshot);
  const url = state.joinOrigin && state.roomId ? `${state.joinOrigin}/controller?room=${state.roomId}` : null;
  const [copied, setCopied] = useState(false);
  const full = state.peers.length >= state.maxControllers;
  const originHost = state.joinOrigin ? new URL(state.joinOrigin).hostname : "";
  const unreachable = originHost === "localhost" || originHost === "127.0.0.1";
  const selfSigned = state.joinOrigin?.startsWith("https://") && /^\d+\.\d+\.\d+\.\d+$/.test(originHost);
  const closeBtn = useRef(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div className={styles.backdrop} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <button ref={closeBtn} type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className={styles.left}>
          <p className={styles.kicker}>Join the hunt</p>
          <h2 id="connect-title" className={styles.title}>
            Scan to play
          </h2>
          {state.status === "open" && url ? (
            <>
              <div className={styles.qrWrap} data-dim={full}>
                <QrImage url={url} />
                {full && <span className={styles.qrFull}>Room full</span>}
              </div>
              <p className={styles.codeLine}>
                or enter code <span className={styles.code}>{state.roomId}</span>
              </p>
            </>
          ) : (
            <div className={styles.waiting}>
              {state.status === "error" || state.status === "offline" ? (state.error ?? "Disconnected, retrying…") : "Opening a room…"}
            </div>
          )}
        </div>

        <div className={styles.right}>
          <ol className={styles.steps}>
            <li>Open your phone camera and scan the code (iPhone or Android).</li>
            <li>Allow motion access: your phone becomes a torch.</li>
            <li>Up to {state.maxControllers} players. Everyone gets a character and a name tag.</li>
          </ol>

          {url && (
            <div className={styles.urlRow}>
              <code className={styles.url}>{url}</code>
              <button type="button" className={styles.small} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
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
              First visit: the phone warns about the dev certificate. Tap <b>Advanced → Proceed</b>. HTTPS is required for the gyroscope.
            </p>
          )}

          <section className={styles.peers}>
            <p className={styles.kicker}>
              Players {state.peers.length}/{state.maxControllers}
            </p>
            {state.peers.length ? (
              <ul>
                {state.peers.map((p) => (
                  <PeerRow key={p.id} peer={p} player={players.find((e) => e.peerId === p.id)} />
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Waiting for the first phone…</p>
            )}
          </section>

          <footer className={styles.foot}>
            <button type="button" className={styles.small} onClick={() => hostSession.newRoom()}>
              New code
            </button>
            <button type="button" className={styles.primary} onClick={onClose}>
              Done
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Toolbar button + full-screen QR overlay. `chipClass` keeps it styled like the other chips. */
export default function ConnectPhone({ chipClass, labelClass }) {
  const state = useHostSession();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const count = state.peers.length;

  const toggle = () => {
    if (!open) hostSession?.start();
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        type="button"
        className={`${chipClass} ${count ? styles.chipOn : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Use your phone as a controller"
        onClick={toggle}
      >
        <PhoneIcon />
        <span className={labelClass}>{count ? `${count}/${state.maxControllers} phones` : "Connect phones"}</span>
        {state.status !== "idle" && <span className={styles.dot} data-on={count > 0} aria-hidden="true" />}
      </button>
      {open && <Overlay state={state} onClose={close} />}
    </>
  );
}
