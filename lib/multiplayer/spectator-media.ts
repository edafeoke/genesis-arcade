/** Reserve media slots in the first offer, even when the host has not started yet.
 * Attaching or restarting the emulator then needs replaceTrack, not renegotiation.
 */
export class SpectatorMediaSender {
  private senders: RTCRtpSender[];
  private pending = Promise.resolve();
  constructor(pc: RTCPeerConnection) {
    this.senders = ['video', 'audio'].map(kind => pc.addTransceiver(kind, {direction:'sendonly'}).sender);
  }
  sync(stream: MediaStream | null): Promise<void> {
    this.pending = this.pending.catch(() => {}).then(async () => {
      const tracks = stream?.getTracks().filter(track => track.readyState === 'live') || [];
      for (const [index, kind] of ['video', 'audio'].entries()) {
        const sender = this.senders[index];
        const track = tracks.find(track => track.kind === kind) || null;
        if (sender.track !== track) await sender.replaceTrack(track);
      }
    });
    return this.pending;
  }
}

/** Trickle ICE may arrive before the offer that creates its connection. */
export class EarlyRoomCandidates {
  private pending = new Map<string, RTCIceCandidateInit[]>();
  add(connection: string, candidate: RTCIceCandidateInit) {
    if (!this.pending.has(connection)) {
      if (this.pending.size >= 4) this.pending.delete(this.pending.keys().next().value!);
      this.pending.set(connection, []);
    }
    const candidates = this.pending.get(connection)!;
    if (candidates.length < 100) candidates.push(candidate);
  }
  take(connection: string): RTCIceCandidateInit[] {
    const candidates = this.pending.get(connection) || [];
    this.pending.delete(connection);
    return candidates;
  }
}
