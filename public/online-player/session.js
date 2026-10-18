/* Host-authoritative casual multiplayer. No ROM or save-state bytes cross the network. */
(() => {
  const CHANNEL = 'genesis-stream-v1';
  const audioOutputs = new Map();
  // Mirror only emulator output already connected to its speakers. No microphone or screen permission.
  const nativeConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (destination, ...args) {
    const result = nativeConnect.call(this, destination, ...args);
    if (destination === this.context.destination) {
      let output = audioOutputs.get(this.context);
      if (!output) { output = this.context.createMediaStreamDestination(); audioOutputs.set(this.context, output); }
      nativeConnect.call(this, output);
    }
    return result;
  };
  let config, pc, data, manager, media, closed = false, sequence = 0, lastRemote = 0, remoteAt = 0;
  let lastSend = 0, lastMask = -1, localMask = 0, remoteMask = 0, keys = 0, secondKeys = 0, secondMask = -1, touch = 0, inputTimer;
  let signalTail = Promise.resolve();
  const candidates = [];
  const status = document.querySelector('#online-status');
  const video = document.querySelector('#remote-video');
  const device = document.querySelector('#input-device');
  const sharedKeyboard = () => config?.host && device.value === 'shared';
  const send = (type, value = {}) => parent.postMessage({ channel: CHANNEL, type, ...value }, location.origin);
  const show = text => { status.textContent = text; send('status', { message: text }); };
  const desiredMasks = [0, 0], heldMasks = [0, 0];
  const pressedFrames = [Array(16).fill(-1), Array(16).fill(-1)];
  const apply = (slot, mask, force = false) => {
    if (!manager) return;
    const port = slot - 1, frame = manager.functions.getFrameNum();
    desiredMasks[port] = mask;
    let actual = 0;
    for (let button = 0; button < 16; button++) {
      const bit = 1 << button, was = !!(heldMasks[port] & bit), wanted = !!(mask & bit);
      if (wanted && !was) pressedFrames[port][button] = frame;
      // A press/release received between two core ticks must still be sampled once.
      const pressed = wanted || (!force && was && pressedFrames[port][button] === frame);
      if (pressed) actual |= bit;
      manager.functions.simulateInput(port, button, pressed ? 1 : 0);
    }
    heldMasks[port] = actual;
  };
  function close(message, notify = true) {
    if (closed) return;
    closed = true; keys = secondKeys = touch = 0;
    clearInterval(inputTimer); clearInterval(watchdog); clearTimeout(connectTimeout);
    if (manager) { apply(1, 0, true); apply(2, 0, true); window.EJS_emulator.pause(); }
    data?.close(); pc?.close(); media?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    show(message);
    if (notify) send('ended', { message });
  }
  const watchdog = setInterval(() => {
    if (manager && !sharedKeyboard() && remoteMask && Date.now() - remoteAt > 750) { remoteMask = 0; apply(config.hostSlot === 1 ? 2 : 1, 0, true); }
    if (data?.readyState === 'open' && remoteAt && Date.now() - remoteAt > 5000) close('The peer stopped responding. Return to the room and start again.');
  }, 100);
  let connectTimeout;
  function transmit(mask) {
    if (data?.readyState !== 'open' || data.bufferedAmount > 4096) return;
    if (config.host) return;
    data.send(JSON.stringify({ epoch: config.epoch, sequence: ++sequence, buttons: mask, sent: performance.now() }));
    lastSend = performance.now(); lastMask = mask;
  }
  const keyMap = { ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyA: 1, KeyS: 0, KeyD: 8, KeyQ: 10, KeyW: 9, KeyE: 11, Enter: 3, ShiftRight: 2 };
  const firstSharedMap = { ArrowUp:4, ArrowDown:5, ArrowLeft:6, ArrowRight:7, KeyJ:1, KeyK:0, KeyL:8, KeyU:10, KeyI:9, KeyO:11, Enter:3, ShiftRight:2 };
  const secondSharedMap = { KeyW:4, KeyS:5, KeyA:6, KeyD:7, KeyF:1, KeyG:0, KeyH:8, KeyR:10, KeyT:9, KeyY:11, Space:3, ShiftLeft:2 };
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
    if (sharedKeyboard() && secondSharedMap[event.code] !== undefined && !(event.target instanceof HTMLSelectElement)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const bit = 1 << secondSharedMap[event.code];
      if (type === 'keydown') secondKeys |= bit; else secondKeys &= ~bit;
      poll(); return;
    }
    const button = (sharedKeyboard() ? firstSharedMap : keyMap)[event.code];
    if (button === undefined || !config || closed || (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (type === 'keydown') keys |= 1 << button; else keys &= ~(1 << button);
    poll();
  }, true);
  const release = () => { keys = secondKeys = touch = localMask = 0; secondMask = -1; if (config?.host) { if (sharedKeyboard()) { apply(1, 0, true); apply(2, 0, true); } else apply(config.hostSlot, 0, true); } else transmit(0); };
  device.addEventListener('change', () => { release(); apply(1, 0, true); apply(2, 0, true); lastMask = -1; document.querySelector('#keyboard-help').textContent = sharedKeyboard() ? 'P1: Arrows + J/K/L, Enter Start. P2: WASD + F/G/H, Space Start. Keep this host window focused.' : 'Arrows move. A/S/D = A/B/C. Enter = Start. Click the game to focus.'; });
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  window.addEventListener('pagehide', () => close('Session closed.', false));
  document.querySelectorAll('[data-button]').forEach(button => {
    const bit = 1 << Number(button.dataset.button);
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touch |= bit; poll(); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => { touch &= ~bit; poll(); });
  });
  document.querySelector('#sound').addEventListener('click', async () => {
    video.muted = false;
    try { await video.play(); document.querySelector('#sound').textContent = 'Sound enabled'; }
    catch { show('Click the picture to resume video and sound.'); }
  });
  function poll() {
    if (closed || !config) return;
    let mask = keys | touch;
    if (device.value.startsWith('gamepad-') && !document.hidden) {
      const pad = (navigator.getGamepads?.() || [])[Number(device.value.slice(8))];
      if (pad?.connected && pad.mapping === 'standard') {
        for (const [index, button] of [[0,0],[1,8],[2,1],[3,9],[4,10],[5,11],[8,2],[9,3],[12,4],[13,5],[14,6],[15,7]]) if (pad.buttons[index]?.pressed) mask |= 1 << button;
        if (pad.axes[0] < -0.5) mask |= 1 << 6; if (pad.axes[0] > 0.5) mask |= 1 << 7;
        if (pad.axes[1] < -0.5) mask |= 1 << 4; if (pad.axes[1] > 0.5) mask |= 1 << 5;
      }
    }
    if (mask !== localMask) { localMask = mask; if (config.host) apply(sharedKeyboard() ? 1 : config.hostSlot, mask); }
    if (!config.host && (mask !== lastMask || performance.now() - lastSend > 100)) transmit(mask);
    if (sharedKeyboard() && secondKeys !== secondMask) { secondMask = secondKeys; apply(2, secondKeys); }
    if (config.host && manager) { apply(1, desiredMasks[0]); apply(2, desiredMasks[1]); }
  }
  function channelReady(channel) {
    if (data || channel.label !== 'genesis-controller-v1') { channel.close(); return; }
    data = channel;
    data.onopen = () => {
      remoteAt = Date.now();
      if (config.host) window.EJS_emulator.play();
      show(`Connected · Player ${config.host ? config.hostSlot : (config.hostSlot === 1 ? 2 : 1)} · host streaming`);
      send('connected');
    };
    let trafficStart = Date.now(), traffic = 0;
    data.onmessage = event => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 256) throw new Error('Invalid controller message.');
        if (Date.now() - trafficStart > 1000) { trafficStart = Date.now(); traffic = 0; }
        if (++traffic > 180) throw new Error('Controller traffic exceeded its limit.');
        const packet = JSON.parse(event.data);
        if (packet.epoch !== config.epoch) return;
        if (!config.host) {
          if (Object.keys(packet).sort().join() !== 'epoch,frame,sent,sequence' || !Number.isSafeInteger(packet.sequence) || !Number.isFinite(packet.sent) || !Number.isSafeInteger(packet.frame)) throw new Error('Invalid input acknowledgement.');
          remoteAt = Date.now();
          send('latency', { milliseconds: Math.max(0, Math.round(performance.now() - packet.sent)), frame: packet.frame });
          return;
        }
        if (Object.keys(packet).sort().join() !== 'buttons,epoch,sent,sequence' || !Number.isSafeInteger(packet.sequence) || packet.sequence < 1 || !Number.isInteger(packet.buttons) || packet.buttons < 0 || packet.buttons > 65535 || !Number.isFinite(packet.sent)) throw new Error('Invalid controller input.');
        if (packet.sequence <= lastRemote) return;
        lastRemote = packet.sequence; remoteAt = Date.now(); remoteMask = packet.buttons;
        if (!sharedKeyboard()) apply(config.hostSlot === 1 ? 2 : 1, remoteMask);
        if (data.bufferedAmount < 4096) data.send(JSON.stringify({ epoch: config.epoch, sequence: packet.sequence, sent: packet.sent, frame: manager?.functions.getFrameNum() ?? 0 }));
      } catch { close('Invalid or excessive peer input. Session stopped.'); }
    };
    data.onclose = () => close('Peer connection closed. Return to the room to reconnect.');
    data.onerror = () => close('The controller connection failed.');
  }
  async function receive(signal) {
    if (signal.type === 'candidate') {
      const candidate = { candidate: signal.candidate, sdpMid: signal.sdpMid, sdpMLineIndex: signal.sdpMLineIndex };
      if (!pc.remoteDescription) { if (candidates.length >= 100) throw new Error('Too many queued ICE candidates.'); candidates.push(candidate); } else await pc.addIceCandidate(candidate);
      return;
    }
    if ((config.host && signal.type !== 'answer') || (!config.host && signal.type !== 'offer')) throw new Error('Unexpected peer description.');
    await pc.setRemoteDescription(signal);
    for (const candidate of candidates.splice(0)) await pc.addIceCandidate(candidate);
    if (!config.host) {
      await pc.setLocalDescription(await pc.createAnswer());
      send('signal', { signal: { type: 'answer', sdp: pc.localDescription.sdp } });
    }
  }
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== CHANNEL) return;
    if (event.data.type === 'ping') { send('ready'); return; }
    if (event.data.type === 'stop') { close('Session ended.', false); return; }
    if (event.data.type === 'signal' && pc && !closed) {
      signalTail = signalTail.then(() => receive(event.data.signal)).catch(() => close('Could not negotiate the peer connection.'));
    }
    if (event.data.type !== 'init' || config) return;
    const value = event.data.config;
    if (!value || !/^[a-f0-9-]{36}$/.test(value.epoch) || ![1,2].includes(value.hostSlot) || typeof value.host !== 'boolean') return;
    config = value;
    try {
      pc = new RTCPeerConnection({ iceServers: value.iceServers, bundlePolicy: 'max-bundle' });
      pc.onicecandidate = event => { if (event.candidate) send('signal', { signal: { type: 'candidate', candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid, sdpMLineIndex: event.candidate.sdpMLineIndex } }); };
      pc.onconnectionstatechange = () => { if (['failed','disconnected','closed'].includes(pc.connectionState)) close('Peer connection lost. Start a new session from the room.'); };
      pc.ondatachannel = event => channelReady(event.channel);
      pc.ontrack = event => {
        if (!video.srcObject) video.srcObject = new MediaStream();
        video.srcObject.addTrack(event.track);
        if (event.track.kind === 'audio') { document.querySelector('#sound').disabled = false; document.querySelector('#sound').textContent = 'Enable sound'; video.dataset.audio = 'received'; }
        if (event.track.kind === 'video') video.dataset.video = 'received';
        video.play().catch(() => show('Click Enable sound to start playback.'));
      };
      if (!config.host) {
        document.querySelector('#game').hidden = true; document.querySelector('#loading').hidden = true;
        document.querySelector('#remote-view').hidden = false;
        show('Waiting for the host to start the emulator…');
      } else show('Select Start game in the emulator to connect your friend.');
      connectTimeout = setTimeout(() => { if (data?.readyState !== 'open') close('Connection timed out. Check both players are online. Some networks require a configured TURN relay.'); }, 90000);
      device.value = config.host ? 'keyboard' : 'gamepad-0';
      document.querySelector('#shared-keyboard-option').hidden = !config.host;
      inputTimer = setInterval(poll, 16);
      send('initialized');
    } catch { close('This browser cannot establish a WebRTC session.'); }
  });
  window.addEventListener('genesis-started', async () => {
    if (!config?.host || closed || manager) return;
    try {
      manager = window.EJS_emulator.gameManager;
      manager.functions.setKeyboardEnabled(0);
      manager.simulateInput = () => {}; // Isolate built-in gamepad/hotkey routing from both owned ports.
      localMask = -1;
      apply(1, 0); apply(2, 0);
      window.EJS_emulator.pause();
      const canvas = document.querySelector('#game canvas');
      if (!canvas?.captureStream) throw new Error('Canvas streaming unavailable.');
      media = canvas.captureStream(60);
      for (const output of audioOutputs.values()) for (const track of output.stream.getAudioTracks()) media.addTrack(track);
      for (const track of media.getTracks()) pc.addTrack(track, media);
      channelReady(pc.createDataChannel('genesis-controller-v1', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      send('signal', { signal: { type: 'offer', sdp: pc.localDescription.sdp } });
      show(`Connecting picture${media.getAudioTracks().length ? ' and sound' : ' (audio unavailable)'}…`);
    } catch { close('The emulator could not start its video stream. Try a current Chrome or Edge browser.'); }
  });
  send('ready');
})();
