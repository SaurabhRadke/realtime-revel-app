// Phone side of the link.
//
//   - joins the room from the QR code over Socket.IO
//   - answers the host's WebRTC offer; sends input over the DataChannel when
//     it is open, otherwise over the socket relay (same bytes either way)
//   - streams input at up to 60 Hz while something changes (a change is sent
//     right away when the last packet is old enough, so there is no wait for
//     the next tick), a 5 Hz keep-alive otherwise, so an idle phone is quiet
//   - echoes the host's pings so the host can measure latency

import { io } from "socket.io-client";
import { Peer } from "./peer";
import { LOOK_UNIT, PKT_PING, PKT_PONG, decode, encodeInput, encodePing } from "./protocol";

const SEND_MS = 1000 / 60;
const KEEPALIVE_MS = 200;

export class ControllerSession {
  #socket = null;
  #peer = null;
  #roomId = null;
  #name = "Phone";
  #timer = null;
  #seq = 0;
  #lastSent = 0;
  #dirty = true;
  #listeners = new Set();
  #msgListeners = new Set();
  #snapshot = {
    status: "idle", // idle | connecting | joined | error | closed
    error: null,
    hostOnline: false,
    transport: "relay", // relay | p2p
    rtt: null,
  };

  /** Live input, written by the UI (joystick, look pad, buttons), read by the send loop. */
  input = { lookX: 0, lookY: 0, flags: 0, joyX: 0, joyY: 0 };

  subscribe = (fn) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };
  getSnapshot = () => this.#snapshot;
  #set(patch) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const fn of this.#listeners) fn();
  }

  /** Messages from the host: {type:"state"|"game"|...}. */
  onMessage(fn) {
    this.#msgListeners.add(fn);
    return () => this.#msgListeners.delete(fn);
  }

  markDirty() {
    this.#dirty = true;
  }

  setFlags(flags) {
    this.input.flags = flags;
    this.#changed();
  }

  setJoystick(x, y) {
    this.input.joyX = x;
    this.input.joyY = y;
    this.#changed();
  }

  // Send now if the last packet is a frame old; otherwise the timer picks it up.
  #changed() {
    this.#dirty = true;
    if (performance.now() - this.#lastSent >= SEND_MS - 1) this.#tick();
  }

  /** Swipe on the look pad: radians to turn right (dx) and to look up (dy). */
  look(dx, dy) {
    // Running totals in LOOK_UNITs, kept small (the packet wraps them anyway).
    this.input.lookX = (this.input.lookX + dx / LOOK_UNIT) % 65536;
    this.input.lookY = (this.input.lookY + dy / LOOK_UNIT) % 65536;
    this.#changed();
  }

  join(roomId, name) {
    this.leave();
    this.#roomId = roomId;
    this.#name = name;
    this.#set({ status: "connecting", error: null });

    const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
    this.#socket = socket;

    // Fires on the first connect and after every automatic reconnect.
    socket.on("connect", () => {
      socket.emit("controller:join", { roomId: this.#roomId, name: this.#name }, (res) => {
        if (!res?.ok) {
          this.#set({ status: "error", error: res?.error ?? "join_failed" });
          socket.disconnect();
          return;
        }
        this.#set({ status: "joined", hostOnline: res.hostOnline, error: null });
      });
    });
    socket.on("disconnect", (reason) => {
      this.#closePeer();
      if (this.#snapshot.status === "joined") this.#set({ status: "connecting" });
      if (reason === "io server disconnect" && this.#snapshot.status !== "error") socket.connect();
    });
    socket.on("host:online", () => this.#set({ hostOnline: true }));
    socket.on("host:offline", () => {
      this.#closePeer();
      this.#set({ hostOnline: false });
    });
    socket.on("room:closed", ({ reason }) => {
      this.#closePeer();
      this.#set({ status: "closed", error: reason });
      socket.disconnect();
    });

    socket.on("signal", ({ data }) => {
      // A new offer means the host (re)started the P2P link: replace ours.
      if (data?.kind === "sdp" && data.description?.type === "offer") this.#newPeer();
      this.#peer?.handleSignal(data);
    });
    socket.on("pkt", (_from, buf) => this.#onPacket(buf));
    socket.on("msg", (_from, obj) => {
      if (obj?.type === "status") {
        this.#set({ rtt: obj.rtt, hostOnline: true });
      }
      for (const fn of this.#msgListeners) fn(obj);
    });

    this.#timer = setInterval(() => this.#tick(), SEND_MS);
  }

  leave() {
    clearInterval(this.#timer);
    this.#closePeer();
    this.#socket?.removeAllListeners();
    this.#socket?.disconnect();
    this.#socket = null;
  }

  /** Reliable button press (lights, view, character...), with an optional short argument. */
  action(name, arg) {
    this.#socket?.emit("msg", arg === undefined ? { type: "action", name } : { type: "action", name, arg: String(arg) });
  }

  /** Say something to whoever is near your character. */
  chat(text) {
    this.#socket?.emit("msg", { type: "chat", text });
  }

  rename(name) {
    this.#name = name;
    this.#socket?.emit("msg", { type: "rename", text: name });
  }

  #newPeer() {
    this.#closePeer();
    if (typeof RTCPeerConnection === "undefined") return;
    const peer = new Peer({
      role: "answer",
      sendSignal: (data) => this.#socket?.emit("signal", { data }),
      onMessage: (buf) => this.#onPacket(buf),
      onState: (s) => {
        if (this.#peer !== peer) return;
        this.#set({ transport: s === "open" ? "p2p" : "relay" });
      },
    });
    this.#peer = peer;
  }

  #closePeer() {
    const p = this.#peer;
    this.#peer = null;
    p?.close();
    if (this.#snapshot.transport !== "relay") this.#set({ transport: "relay" });
  }

  #send(buf) {
    if (this.#peer?.send(buf)) return;
    this.#socket?.volatile.emit("pkt", buf);
  }

  #onPacket(buf) {
    const pkt = decode(buf);
    if (pkt?.type === PKT_PING) this.#send(encodePing(PKT_PONG, pkt.id, pkt.time));
  }

  #tick() {
    if (this.#snapshot.status !== "joined" || !this.#snapshot.hostOnline) return;
    const now = performance.now();
    if (!this.#dirty && now - this.#lastSent < KEEPALIVE_MS) return;
    this.#dirty = false;
    this.#lastSent = now;
    this.#seq = (this.#seq + 1) & 0xffff;
    this.#send(encodeInput({ seq: this.#seq, ...this.input }));
  }
}
