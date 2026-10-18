import { z } from 'zod';
import { controllerMaskSchema, type ControllerMasks, type FrameAdapter } from '../emulation/adapter';

export const FRAME_INPUT_VERSION = 1 as const;
export const frameInputSchema = z.object({
  version: z.literal(FRAME_INPUT_VERSION), epoch: z.string().uuid(),
  sequence: z.number().int().min(1).max(0x7fffffff),
  frame: z.number().int().min(0).max(0x7fffffff), buttons: controllerMaskSchema,
}).strict();
export type FrameInput = Readonly<z.infer<typeof frameInputSchema>>;

/** Transport-independent delay lockstep. Slot ownership comes from the trusted session binding. */
export class InputLockstep {
  private local = new Map<number, FrameInput>();
  private remote = new Map<number, FrameInput>();
  private history = new Map<number, FrameInput>();
  private nextLocal = 0;
  private nextFrame = 0;
  private stopped: string | null = null;
  private inFlight: Promise<number> | null = null;
  private release: Promise<void> | null = null;
  readonly epoch: string;
  readonly localSlot: 1 | 2;
  readonly delay: number;
  readonly window: number;

  constructor(private adapter: FrameAdapter, options: {
    epoch: string; localSlot: 1 | 2; inputDelay: number; maxAhead?: number;
    send: (packet: FrameInput) => void;
  }) {
    this.epoch = z.string().uuid().parse(options.epoch);
    this.localSlot = z.union([z.literal(1), z.literal(2)]).parse(options.localSlot);
    this.delay = z.number().int().min(0).max(12).parse(options.inputDelay);
    this.window = z.number().int().min(this.delay + 1).max(240).parse(options.maxAhead ?? 120);
    this.send = options.send;
    // Both peers agree to neutral startup frames as part of the session configuration.
    for (let frame = 0; frame < this.delay; frame++) {
      const neutral = Object.freeze({ version: FRAME_INPUT_VERSION, epoch: this.epoch, sequence: 0, frame, buttons: 0 });
      this.local.set(frame, neutral); this.remote.set(frame, neutral);
    }
  }
  private send: (packet: FrameInput) => void;
  get status() {
    return { frame: this.nextFrame, stopped: this.stopped, localBuffered: this.local.size, remoteBuffered: this.remote.size,
      waiting: !this.stopped && (!this.local.has(this.nextFrame) || !this.remote.has(this.nextFrame)) };
  }
  private assertRunning() { if (this.stopped) throw new Error(this.stopped); }

  submitLocal(sampleFrame: number, buttons: number): FrameInput {
    this.assertRunning();
    if (!Number.isSafeInteger(sampleFrame) || sampleFrame !== this.nextLocal) throw new Error('Local samples must be consecutive.');
    const packet = Object.freeze(frameInputSchema.parse({ version: FRAME_INPUT_VERSION, epoch: this.epoch,
      sequence: sampleFrame + 1, frame: sampleFrame + this.delay, buttons }));
    if (packet.frame > this.nextFrame + this.window) throw new Error('Local input is too far ahead.');
    this.local.set(packet.frame, packet);
    this.nextLocal++;
    try { this.send(packet); }
    catch (error) { void this.stop('Input transport failed.'); throw error; }
    return packet;
  }

  receiveRemote(value: unknown): 'accepted' | 'duplicate' | 'stale' {
    this.assertRunning();
    const packet = frameInputSchema.parse(value);
    if (packet.epoch !== this.epoch) return 'stale';
    if (packet.sequence + this.delay - 1 !== packet.frame) throw new Error('Input sequence does not match its frame.');
    if (packet.frame > this.nextFrame + this.window) throw new Error('Remote input is too far ahead.');
    const existing = this.remote.get(packet.frame) ?? this.history.get(packet.frame);
    if (existing) {
      if (existing.buttons !== packet.buttons || existing.sequence !== packet.sequence) {
        void this.stop('Conflicting input for the same frame.');
        throw new Error('Conflicting input for the same frame.');
      }
      return 'duplicate';
    }
    if (packet.frame < this.nextFrame) return 'stale';
    this.remote.set(packet.frame, Object.freeze(packet));
    return 'accepted';
  }

  advance(limit = 1): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > this.window) return Promise.reject(new Error('Invalid frame budget.'));
    if (this.stopped) return Promise.resolve(0);
    if (this.inFlight) return this.inFlight;
    const operation = async () => {
      let advanced = 0;
      while (!this.stopped && advanced < limit) {
        const local = this.local.get(this.nextFrame), remote = this.remote.get(this.nextFrame);
        if (!local || !remote) break; // Never predict or skip missing input.
        const inputs: ControllerMasks = this.localSlot === 1 ? [local.buttons, remote.buttons] : [remote.buttons, local.buttons];
        try { await this.adapter.step(this.nextFrame, inputs); }
        catch (error) { await this.stop('Emulator frame failed.'); throw error; }
        if (this.stopped) break;
        this.history.set(this.nextFrame, remote);
        this.local.delete(this.nextFrame); this.remote.delete(this.nextFrame);
        this.nextFrame++; advanced++;
        this.history.delete(this.nextFrame - this.window - 1);
      }
      return advanced;
    };
    this.inFlight = operation().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /** Disconnects terminate this epoch. A new epoch requires a fresh shared checkpoint. */
  stop(reason = 'Session stopped.'): Promise<void> {
    if (!this.stopped) {
      this.stopped = reason || 'Session stopped.'; this.local.clear(); this.remote.clear(); this.history.clear();
      this.release = this.adapter.releaseInputs();
      // Callers may use stop synchronously; still observe any release failure.
      void this.release.catch(() => undefined);
    }
    return this.release ?? Promise.resolve();
  }
}
