// Desktop side of the phone link.
//
//   - opens (or resumes, after a reload) a room on the Socket.IO server
//   - for every phone that joins: offers a WebRTC DataChannel; until it opens
//     (or if it never does, e.g. strict NAT) input arrives via the socket relay
//   - decodes each phone's input packets into its own `remotes` entry, which
//     the scene reads for that phone's character
//   - pings each phone every two seconds to measure round-trip latency, and
//     only tells the phone about it when the number actually moved
//
// One module-level instance; React reads it through useSyncExternalStore.

import { io } from "socket.io-client";
import { deleteRemote, getRemote } from "@/components/scene/remote";
import { Peer } from "./peer";
import {
  FLAG_GYRO,
  FLAG_RUN,
  FLAG_TORCH,
  PKT_INPUT,
  PKT_PING,
  PKT_PONG,
  decode,
  encodePing,
  seqNewer,
} from "./protocol";

const STORAGE_KEY = "gyro.hostRoom";
const PING_EVERY_MS = 2000;
const STATUS_REFRESH_MS = 10_000; // resend link status at least this often
const RTC_RETRY_MS = 2500;
const RTC_MAX_RETRIES = 3;

const storage = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      if (v) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // private mode: rooms just won't survive a reload
    }
  },
};

const isLocalHost = (h) => h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");

class HostSession {
  #socket = null;
  #peers = new Map(); // peerId -> { id, name, peer, transport, rtt, lastSeq, retries, retryTimer }
  #listeners = new Set();
  #actionListeners = new Set();
  #pingTimer = null;
  #pingId = 0;
  #snapshot = {
    status: "idle", // idle | connecting | open | offline | error
    roomId: null,
    joinOrigins: [],
    joinOrigin: null,
    maxControllers: 4,
    peers: [],
    error: null,
  };

  // ---------- React plumbing ----------
  subscribe = (fn) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };
  getSnapshot = () => this.#snapshot;
  #set(patch) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const fn of this.#listeners) fn();
  }
  #publishPeers() {
    this.#set({
      peers: [...this.#peers.values()].map(({ id, name, transport, rtt }) => ({ id, name, transport, rtt })),
    });
  }

  /**
   * Everything a phone asks of the screen, for the UI to handle:
   *   {name:"joined"|"left", peerId, text: name}
   *   {name:"lights"|"view"|"character"|"recenter"|"start"|"again", peerId}
   *   {name:"chat"|"rename", peerId, text}
   */
  onAction(fn) {
    this.#actionListeners.add(fn);
    return () => this.#actionListeners.delete(fn);
  }

  get joinUrl() {
    const { joinOrigin, roomId } = this.#snapshot;
    return joinOrigin && roomId ? `${joinOrigin}/controller?room=${roomId}` : null;
  }

  // ---------- Lifecycle ----------
  /** Idempotent: opens the socket and the room on first call. */
  start() {
    if (this.#socket) return;
    this.#set({ status: "connecting", error: null });
    this.#resolveJoinOrigins();

    const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
    this.#socket = socket;

    socket.on("connect", () => this.#openRoom());
    socket.on("disconnect", () => {
      this.#set({ status: "offline" });
      this.#dropAllPeers();
    });
    socket.on("connect_error", () => this.#set({ status: "offline", error: "Can't reach the server" }));

    socket.on("peer:joined", ({ peerId, name }) => this.#addPeer(peerId, name));
    socket.on("peer:left", ({ peerId }) => this.#removePeer(peerId));
    socket.on("signal", ({ from, data }) => this.#peers.get(from)?.peer?.handleSignal(data));
    socket.on("pkt", (from, buf) => this.#onPacket(from, buf, "relay"));
    socket.on("msg", (from, obj) => this.#onMessage(from, obj));
    socket.on("room:closed", ({ reason }) => {
      // Another tab took the room over; start a fresh one here.
      if (reason === "taken_over") {
        storage.set(null);
        this.#dropAllPeers();
        this.#openRoom();
      }
    });

    this.#pingTimer = setInterval(() => this.#pingAll(), PING_EVERY_MS);
  }

  /** Resume this tab's room after a reload, if there was one. */
  resumeIfRemembered() {
    if (storage.get()) this.start();
  }

  /** Close the current room (phones are told) and open a new code. */
  newRoom() {
    if (!this.#socket) return this.start();
    this.#socket.emit("host:close");
    storage.set(null);
    this.#dropAllPeers();
    this.#openRoom();
  }

  kick(peerId) {
    this.#socket?.emit("host:kick", { peerId });
    this.#removePeer(peerId);
  }

  setJoinOrigin(origin) {
    this.#set({ joinOrigin: origin });
  }

  /** Reliable message to every phone (state for their buttons). */
  broadcast(obj) {
    for (const id of this.#peers.keys()) this.#socket?.emit("msg", id, obj);
  }

  /** Reliable message to one phone. */
  send(peerId, obj) {
    if (this.#peers.has(peerId)) this.#socket?.emit("msg", peerId, obj);
  }

  #emitAction(a) {
    for (const fn of this.#actionListeners) fn(a);
  }

  #openRoom() {
    const saved = storage.get();
    this.#set({ status: "connecting" });
    this.#socket.emit("host:open", saved ?? {}, (res) => {
      if (!res?.ok) return this.#set({ status: "error", error: res?.error ?? "Could not open a room" });
      storage.set({ roomId: res.roomId, token: res.token });
      this.#set({ status: "open", roomId: res.roomId, maxControllers: res.maxControllers, error: null });
    });
  }

  // A phone can't open "localhost", so when the desktop itself is on localhost
  // ask the server for this machine's LAN address(es) to put in the QR.
  async #resolveJoinOrigins() {
    const here = window.location.origin;
    let origins = [here];
    if (isLocalHost(window.location.hostname)) {
      try {
        const info = await (await fetch("/api/connect-info", { cache: "no-store" })).json();
        origins = [info.publicUrl, ...(info.lanOrigins ?? [])].filter(Boolean);
        if (!origins.length) origins = [here];
      } catch {
        // keep localhost; the panel shows a hint
      }
    }
    this.#set({ joinOrigins: origins, joinOrigin: this.#snapshot.joinOrigin ?? origins[0] });
  }

  // ---------- Peers ----------
  #addPeer(id, name) {
    this.#peers.get(id)?.peer?.close();
    const known = this.#peers.has(id);
    const entry = this.#peers.get(id) ?? { id, name, peer: null, transport: "relay", rtt: null, lastSeq: -1, retries: 0, sent: null };
    entry.name = name;
    entry.sent = null;
    this.#peers.set(id, entry);
    this.#connectRtc(entry);
    getRemote(id).calibration += 1;
    this.#publishPeers();
    if (!known) this.#emitAction({ name: "joined", peerId: id, text: name });
  }

  #connectRtc(entry) {
    if (typeof RTCPeerConnection === "undefined") return;
    clearTimeout(entry.retryTimer);
    const peer = new Peer({
      role: "offer",
      sendSignal: (data) => this.#socket.emit("signal", { to: entry.id, data }),
      onMessage: (buf) => this.#onPacket(entry.id, buf, "p2p"),
      onState: (s) => {
        if (entry.peer !== peer) return;
        if (s === "open") {
          entry.retries = 0;
          entry.transport = "p2p";
          this.#publishPeers();
        } else if (s === "closed") {
          entry.transport = "relay";
          this.#publishPeers();
          // Retry a few times (Wi-Fi hiccup, phone screen locked and back).
          if (this.#peers.get(entry.id) === entry && entry.retries < RTC_MAX_RETRIES) {
            entry.retries += 1;
            entry.retryTimer = setTimeout(() => {
              if (this.#peers.get(entry.id) === entry) this.#connectRtc(entry);
            }, RTC_RETRY_MS * entry.retries);
          }
        }
      },
    });
    entry.peer = peer;
    peer.start().catch((err) => console.warn("[host] offer failed", err));
  }

  #removePeer(id) {
    const entry = this.#peers.get(id);
    if (!entry) return;
    clearTimeout(entry.retryTimer);
    entry.peer?.close();
    this.#peers.delete(id);
    deleteRemote(id);
    this.#publishPeers();
    this.#emitAction({ name: "left", peerId: id });
  }

  #dropAllPeers() {
    for (const id of [...this.#peers.keys()]) this.#removePeer(id);
  }

  // ---------- Data ----------
  #onPacket(from, buf, path) {
    const entry = this.#peers.get(from);
    if (!entry) return;
    const pkt = decode(buf);
    if (!pkt) return;

    if (pkt.type === PKT_INPUT) {
      // The DataChannel is unordered and both paths may be live during a
      // handover: drop anything older than what we already applied.
      if (entry.lastSeq >= 0 && !seqNewer(pkt.seq, entry.lastSeq)) return;
      entry.lastSeq = pkt.seq;
      if (entry.transport !== path && !(path === "relay" && entry.peer?.isOpen)) {
        entry.transport = path;
        this.#publishPeers();
      }
      const remote = getRemote(from);
      remote.q[0] = pkt.q[0];
      remote.q[1] = pkt.q[1];
      remote.q[2] = pkt.q[2];
      remote.q[3] = pkt.q[3];
      remote.hasGyro = (pkt.flags & FLAG_GYRO) !== 0;
      remote.torchFollow = (pkt.flags & FLAG_TORCH) !== 0;
      remote.run = (pkt.flags & FLAG_RUN) !== 0;
      remote.joyX = Math.max(-1, Math.min(1, pkt.joyX));
      remote.joyY = Math.max(-1, Math.min(1, pkt.joyY));
      remote.lastPacket = performance.now();
    } else if (pkt.type === PKT_PONG) {
      const rtt = Math.max(0, performance.now() - pkt.time);
      const before = entry.rtt;
      entry.rtt = entry.rtt == null ? rtt : entry.rtt * 0.6 + rtt * 0.4;
      if (before == null || Math.abs(before - entry.rtt) >= 3) this.#publishPeers();
    } else if (pkt.type === PKT_PING) {
      this.#sendTo(entry, encodePing(PKT_PONG, pkt.id, pkt.time));
    }
  }

  #onMessage(from, obj) {
    if (!this.#peers.has(from)) return;
    if (obj.type === "action" && typeof obj.name === "string") {
      if (obj.name === "recenter") getRemote(from).calibration += 1;
      this.#emitAction({ name: obj.name, peerId: from });
    } else if ((obj.type === "chat" || obj.type === "rename") && typeof obj.text === "string") {
      this.#emitAction({ name: obj.type, peerId: from, text: obj.text });
    }
  }

  #sendTo(entry, buf) {
    if (entry.peer?.send(buf)) return;
    this.#socket?.emit("pkt", entry.id, buf);
  }

  #pingAll() {
    this.#pingId = (this.#pingId + 1) & 0xffff;
    const now = performance.now();
    for (const entry of this.#peers.values()) {
      this.#sendTo(entry, encodePing(PKT_PING, this.#pingId, now));
      // Tell the phone how its link looks (it shows this in its status bar),
      // but only when that changed: four idle phones then cost ~nothing.
      const rtt = entry.rtt == null ? null : Math.round(entry.rtt);
      const last = entry.sent;
      if (
        !last ||
        last.transport !== entry.transport ||
        (rtt != null && (last.rtt == null || Math.abs(last.rtt - rtt) >= 8)) ||
        now - last.at > STATUS_REFRESH_MS
      ) {
        entry.sent = { rtt, transport: entry.transport, at: now };
        this.#socket?.emit("msg", entry.id, { type: "status", rtt, transport: entry.transport });
      }
    }
  }
}

export const hostSession = typeof window === "undefined" ? null : new HostSession();
