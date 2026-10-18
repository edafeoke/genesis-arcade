import { z } from 'zod';

export const ADAPTER_VERSION = 'genesis-adapter-v1' as const;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const adapterIdentitySchema = z.object({
  adapter: z.literal(ADAPTER_VERSION), rom: sha256, core: sha256, runtime: sha256, settings: sha256,
}).strict();
export type AdapterIdentity = Readonly<z.infer<typeof adapterIdentitySchema>>;
export type ControllerMasks = readonly [number, number];
export const controllerMaskSchema = z.number().int().min(0).max(0xffff);
const auxiliarySchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.number().finite())
  .refine(value => Object.keys(value).length <= 64);
const snapshotSchema = z.object({
  format: z.literal(ADAPTER_VERSION), identity: adapterIdentitySchema,
  frame: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength > 0 && bytes.byteLength <= 16 * 1024 * 1024),
  auxiliary: auxiliarySchema, checksum: sha256,
}).strict();
export type AdapterSnapshot = Readonly<z.infer<typeof snapshotSchema>>;

/** Implementations must own their execution loop. Returning from restore means it finished. */
export interface EmulatorBackend {
  readonly capabilities: {
    verification: 'verified' | 'fixture-only' | 'unverified';
    singleVideoFrame: boolean;
    completeState: boolean;
  };
  /** Return the measured number of emulated video frames, not frontend-loop iterations. */
  step(inputs: ControllerMasks): Promise<number>;
  capture(): Promise<{ bytes: Uint8Array; auxiliary: Record<string, number> }>;
  restore(state: { bytes: Uint8Array; auxiliary: Record<string, number> }): Promise<void>;
  releaseInputs(): Promise<void>;
}

export interface FrameAdapter {
  step(frame: number, inputs: ControllerMasks): Promise<void>;
  releaseInputs(): Promise<void>;
}

const identityKey = (identity: AdapterIdentity) => JSON.stringify([
  identity.adapter, identity.rom, identity.core, identity.runtime, identity.settings,
]);

async function checksum(snapshot: Omit<AdapterSnapshot, 'checksum'>): Promise<string> {
  const auxiliary = Object.fromEntries(Object.entries(snapshot.auxiliary).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const header = new TextEncoder().encode(JSON.stringify([snapshot.format, identityKey(snapshot.identity), snapshot.frame, auxiliary]));
  const payload = new Uint8Array(header.length + 1 + snapshot.bytes.length);
  payload.set(header); // A zero delimiter separates JSON metadata from opaque core bytes.
  payload.set(snapshot.bytes, header.length + 1);
  const hash = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Versioned orchestration, not a claim that an arbitrary emulator backend is verified. */
export class VersionedEmulatorAdapter implements FrameAdapter {
  readonly identity: AdapterIdentity;
  private tail: Promise<unknown> = Promise.resolve();
  private frame = 0;
  private faulted = false;

  constructor(identity: AdapterIdentity, private backend: EmulatorBackend, options: { allowFixtureOnly?: boolean } = {}) {
    this.identity = Object.freeze(adapterIdentitySchema.parse(identity));
    const capabilities = backend.capabilities;
    if (!capabilities.singleVideoFrame || !capabilities.completeState || capabilities.verification === 'unverified' ||
      (capabilities.verification === 'fixture-only' && !options.allowFixtureOnly)) {
      throw new Error('This emulator backend has not passed the required frame/state verification.');
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private assertHealthy() { if (this.faulted) throw new Error('The emulator adapter failed. Create a fresh instance.'); }
  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    this.assertHealthy();
    try { return await operation(); }
    catch (error) {
      this.faulted = true;
      try { await this.backend.releaseInputs(); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }

  step(frame: number, inputs: ControllerMasks): Promise<void> {
    const masks: ControllerMasks = [controllerMaskSchema.parse(inputs[0]), controllerMaskSchema.parse(inputs[1])];
    return this.serial(async () => {
      if (!Number.isSafeInteger(frame) || frame >= Number.MAX_SAFE_INTEGER || frame !== this.frame) throw new Error('Unexpected emulation frame.');
      await this.guarded(async () => {
        const advanced = await this.backend.step(masks);
        if (advanced !== 1) throw new Error('The backend did not advance exactly one emulated video frame.');
        this.frame++;
      });
    });
  }

  capture(): Promise<AdapterSnapshot> {
    return this.serial(() => this.guarded(async () => {
      const state = await this.backend.capture();
      const clean = snapshotSchema.omit({ checksum: true }).parse({ format: ADAPTER_VERSION, identity: this.identity,
        frame: this.frame, bytes: state.bytes, auxiliary: state.auxiliary });
      const copy = { ...clean, bytes: clean.bytes.slice(), auxiliary: Object.freeze({ ...clean.auxiliary }) };
      return Object.freeze({ ...copy, checksum: await checksum(copy) });
    }));
  }

  restore(snapshot: AdapterSnapshot): Promise<void> {
    // Copy before queueing: a caller cannot change state while a frame operation is pending.
    const parsed = snapshotSchema.parse(snapshot);
    const copy = { ...parsed, bytes: parsed.bytes.slice(), auxiliary: { ...parsed.auxiliary } };
    return this.serial(async () => {
      this.assertHealthy();
      if (identityKey(copy.identity) !== identityKey(this.identity)) throw new Error('Snapshot ROM, core, runtime or settings differ.');
      if (await checksum(copy) !== copy.checksum) throw new Error('Snapshot checksum failed.');
      await this.guarded(async () => {
        await this.backend.restore({ bytes: copy.bytes, auxiliary: copy.auxiliary });
        this.frame = copy.frame;
      });
    });
  }

  releaseInputs(): Promise<void> {
    return this.serial(async () => {
      try { await this.backend.releaseInputs(); }
      catch (error) { this.faulted = true; throw error; }
    });
  }
}
