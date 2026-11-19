// A thin WebRTC wrapper for one host <-> controller link.
//
// The host is always the offerer: it creates the DataChannel and the offer;
// the controller answers. Signaling (SDP + ICE) goes through Socket.IO.
//
// The channel is unordered with no retransmits, i.e. UDP-like: a lost input
// packet is useless 16 ms later, so we never wait for it. That is the whole
// reason to use WebRTC here instead of only the WebSocket (TCP, head-of-line
// blocking).

const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export const CHANNEL_LABEL = "input";

export class Peer {
  /**
   * @param {object} o
   * @param {"offer"|"answer"} o.role
   * @param {(data:object)=>void} o.sendSignal  deliver SDP/ICE to the other side
   * @param {(data:ArrayBuffer)=>void} o.onMessage
   * @param {(state:"connecting"|"open"|"closed")=>void} o.onState
   */
  constructor({ role, sendSignal, onMessage, onState }) {
    this.role = role;
    this.sendSignal = sendSignal;
    this.onMessage = onMessage;
    this.onState = onState;
    this.channel = null;
    this.closed = false;
    this.pendingIce = [];

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal({ kind: "ice", candidate: e.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === "failed" || s === "closed") this.#setState("closed");
    };

    if (role === "offer") {
      this.#bindChannel(
        this.pc.createDataChannel(CHANNEL_LABEL, { ordered: false, maxRetransmits: 0 }),
      );
    } else {
      this.pc.ondatachannel = (e) => this.#bindChannel(e.channel);
    }
  }

  #bindChannel(ch) {
    this.channel = ch;
    ch.binaryType = "arraybuffer";
    ch.onopen = () => this.#setState("open");
    ch.onclose = () => this.#setState("closed");
    ch.onerror = () => this.#setState("closed");
    ch.onmessage = (e) => this.onMessage(e.data);
  }

  #state = "connecting"; // initial state, not reported (the caller knows)
  #setState(s) {
    if (this.#state === s || (this.#state === "closed" && s !== "closed")) return;
    this.#state = s;
    this.onState(s);
  }

  get isOpen() {
    return this.channel?.readyState === "open";
  }

  async start() {
    if (this.role !== "offer") return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ kind: "sdp", description: this.pc.localDescription.toJSON() });
  }

  async handleSignal(data) {
    if (this.closed || !data) return;
    try {
      if (data.kind === "sdp") {
        await this.pc.setRemoteDescription(data.description);
        for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c);
        if (data.description.type === "offer") {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.sendSignal({ kind: "sdp", description: this.pc.localDescription.toJSON() });
        }
      } else if (data.kind === "ice") {
        // ICE can arrive before the SDP it belongs to; hold it until then.
        if (!this.pc.remoteDescription) this.pendingIce.push(data.candidate);
        else await this.pc.addIceCandidate(data.candidate);
      }
    } catch (err) {
      console.warn("[peer] signaling error", err);
    }
  }

  /** Returns false if the channel isn't open (caller falls back to the relay). */
  send(buf) {
    const ch = this.channel;
    if (!ch || ch.readyState !== "open") return false;
    // Don't queue up stale input behind a congested link.
    if (ch.bufferedAmount > 4096) return true;
    try {
      ch.send(buf);
      return true;
    } catch {
      return false;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.channel?.close();
      this.pc.close();
    } catch {
      // already gone
    }
    this.#setState("closed");
  }
}
