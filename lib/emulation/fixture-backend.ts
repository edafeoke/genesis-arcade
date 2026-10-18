import type { ControllerMasks, EmulatorBackend } from './adapter';

export const FRAME_FIXTURE_SHA256 = 'c12ec5da51b65a46838808ce9a0beadc98ea8308a028197789c9354ef6134a3d';
const STATE_BYTES = 1036312;
const FRAME_CYCLES = 896040;

/** Narrow native surface of the pinned, instrumented EmulatorJS build. */
export interface FixtureManager {
  Module: { HEAPU8: Uint8Array; genesisLabTick(): Promise<void> };
  functions: { simulateInput(player: number, button: number, pressed: number): void };
  getState(): Uint8Array;
  loadState(bytes: Uint8Array): void;
}

function counter(bytes: Uint8Array): number {
  const marker = new TextEncoder().encode('GENESISLABFRAME1');
  const matches: number[] = [];
  for (const swapped of [false, true]) {
    // This backend accepts one pinned serialized layout: work RAM starts at byte 32.
    // Reject a changed layout instead of searching unrelated state on every frame.
    const offset = 32;
    if (bytes.length === STATE_BYTES) {
      if (!marker.every((_, index) => bytes[offset + index] === marker[swapped ? index ^ 1 : index])) continue;
      let value = 0;
      for (let index = 0; index < 4; index++) value = value * 256 + bytes[offset + 16 + (swapped ? index ^ 1 : index)];
      matches.push(value >>> 0);
    }
  }
  if (matches.length !== 1) throw new Error('Expected one diagnostic video-frame counter.');
  return matches[0];
}

function cpu(manager: FixtureManager, state: Uint8Array, knownRefreshIndex?: number): { heap: Int32Array; refreshIndex: number } {
  if (state.length !== STATE_BYTES) throw new Error('Unsupported fixture state size.');
  const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
  const registers = Array.from({ length: 17 }, (_, index) => view.getUint32(144180 + index * 4, true));
  if (registers[15] !== 0x00fffffc || registers[16] < 0x200 || registers[16] >= 0x1000) throw new Error('Unsupported fixture CPU layout.');
  const heap = new Int32Array(manager.Module.HEAPU8.buffer);
  const cycles = view.getInt32(144258, true);
  const matches = (index: number) => heap[index - 3] === cycles && heap[index - 1] === FRAME_CYCLES &&
    Math.abs(heap[index - 2]) <= 2 * FRAME_CYCLES && registers.every((value, offset) => (heap[index + offset] >>> 0) === value);
  // Read-only captures may reuse the discovered address after validating the entire signature.
  // Restoration always performs a fresh uniqueness scan before any memory write.
  if (knownRefreshIndex !== undefined && matches(knownRefreshIndex + 2)) return { heap, refreshIndex: knownRefreshIndex };
  const candidates: number[] = [];
  for (let index = 3; index < Math.min(heap.length - 17, 8 * 1024 * 1024); index++) {
    if (heap[index - 3] !== cycles || heap[index - 1] !== FRAME_CYCLES || Math.abs(heap[index - 2]) > 2 * FRAME_CYCLES) continue;
    if (registers.every((value, offset) => (heap[index + offset] >>> 0) === value)) candidates.push(index - 2);
    if (candidates.length > 1) break;
  }
  if (candidates.length !== 1) throw new Error('Fixture CPU location is missing or ambiguous.');
  return { heap, refreshIndex: candidates[0] };
}

function equal(first: Uint8Array, second: Uint8Array) {
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}

/** Internal diagnostic only. Caller must pause the scheduler and exclusively own input. */
export class FixtureEmulatorBackend implements EmulatorBackend {
  readonly capabilities = { verification: 'fixture-only' as const, singleVideoFrame: true, completeState: true };
  private refreshIndex: number;

  constructor(private manager: FixtureManager, romHash: string) {
    if (romHash !== FRAME_FIXTURE_SHA256 || typeof manager.Module.genesisLabTick !== 'function') {
      throw new Error('This backend requires the exact diagnostic ROM and instrumented runtime.');
    }
    const state = manager.getState();
    counter(state);
    this.refreshIndex = cpu(manager, state).refreshIndex;
  }

  async releaseInputs(): Promise<void> {
    for (let player = 0; player < 2; player++) for (let button = 0; button < 16; button++) {
      this.manager.functions.simulateInput(player, button, 0);
    }
  }

  async step(inputs: ControllerMasks): Promise<number> {
    if (inputs.some(mask => !Number.isInteger(mask) || mask < 0 || mask > 0xffff)) throw new Error('Invalid controller mask.');
    const before = counter(this.manager.getState());
    for (let player = 0; player < 2; player++) for (let button = 0; button < 16; button++) {
      this.manager.functions.simulateInput(player, button, (inputs[player] >>> button) & 1);
    }
    await this.manager.Module.genesisLabTick();
    const advanced = (counter(this.manager.getState()) - before) >>> 0;
    if (advanced !== 1) throw new Error('Diagnostic tick did not advance exactly one video frame.');
    return advanced;
  }

  async capture() {
    const bytes = this.manager.getState().slice();
    counter(bytes);
    const location = cpu(this.manager, bytes, this.refreshIndex);
    this.refreshIndex = location.refreshIndex;
    return { bytes, auxiliary: { refresh_cycles: location.heap[location.refreshIndex] } };
  }

  async restore(state: { bytes: Uint8Array; auxiliary: Record<string, number> }): Promise<void> {
    const refresh = state.auxiliary.refresh_cycles;
    if (Object.keys(state.auxiliary).length !== 1 || !Number.isInteger(refresh) || Math.abs(refresh) > 2 * FRAME_CYCLES || state.bytes.length !== STATE_BYTES) {
      throw new Error('Invalid diagnostic checkpoint.');
    }
    counter(state.bytes);
    await this.releaseInputs();
    const checkpoint = state.bytes.slice();
    this.manager.loadState(checkpoint);
    let restored = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.manager.Module.genesisLabTick();
      if (equal(this.manager.getState(), checkpoint)) { restored = true; break; }
    }
    if (!restored) throw new Error('Queued fixture restoration did not reproduce the complete checkpoint.');
    const location = cpu(this.manager, this.manager.getState());
    this.refreshIndex = location.refreshIndex;
    location.heap[location.refreshIndex] = refresh;
    if (!equal(this.manager.getState(), checkpoint)) throw new Error('Timing restoration changed serialized state.');
  }
}
