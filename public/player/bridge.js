/* This page owns one emulator lifetime. Removing the frame tears it down. */
(() => {
  const channel = 'genesis-player-v1';
  let initialized = false;
  let gameUrl;
  let failed = false;
  const send = (type, message) => parent.postMessage({ channel, type, message }, location.origin);
  const fail = (message) => {
    if (failed) return;
    failed = true;
    document.querySelector('#loading').hidden = true;
    send('error', message);
  };
  window.addEventListener('error', () => fail('The emulator could not load. Retry, or check that this is an uncompressed Genesis ROM.'));
  window.addEventListener('unhandledrejection', () => fail('The emulator encountered an error. Try restarting the game.'));
  // EmulatorJS 4.2.3 reports core/ROM failures through this element, not a public error event.
  new MutationObserver(() => {
    const error = document.querySelector('.ejs_error_text');
    if (error) fail(error.textContent || 'The Genesis core could not start.');
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== channel || !['load', 'ping'].includes(event.data.type)) return;
    if (event.data.type === 'ping') { send('bridge-ready'); return; }
    if (initialized) return;
    const { rom, id } = event.data;
    if (!(rom instanceof Blob) || !rom.size || rom.size > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(id)) {
      fail('This local ROM could not be opened.');
      return;
    }
    initialized = true;
    gameUrl = URL.createObjectURL(rom);
    // The instrumented core is opt-in and never used by the ordinary player.
    if (new URLSearchParams(location.search).get('adapter') === '1') {
      window.EJS_paths = { 'genesis_plus_gx-legacy-wasm.data': '/sync-lab/runtime/genesis_plus_gx-legacy-wasm.data' };
    }
    Object.assign(window, {
      EJS_player: '#game',
      EJS_core: 'genesis_plus_gx',
      EJS_controlScheme: 'segaMD',
      EJS_gameUrl: gameUrl,
      // Content identity prevents same-named ROMs sharing SRAM or state files.
      EJS_gameName: id,
      EJS_pathtodata: '/emulator/4.2.3/data/',
      EJS_DEBUG_XX: true,
      EJS_language: 'en-US',
      EJS_disableAutoLang: false,
      EJS_threads: false,
      EJS_forceLegacyCores: true,
      EJS_disableDatabases: true,
      EJS_startOnLoaded: false,
      EJS_startButtonName: 'Start game',
      EJS_color: '#367bfa',
      EJS_backgroundColor: '#05080e',
      EJS_Buttons: { netplay: false, cheat: false, cacheManager: false, exitEmulation: false },
      EJS_hideSettings: ['retroarch_core', 'ejs_threads'],
      EJS_defaultOptions: { 'save-state-location': 'browser', retroarch_core: 'genesis_plus_gx', ejs_threads: 'disabled' },
      EJS_ready: () => {
        document.querySelector('#loading').hidden = true;
        send('ready');
      },
      EJS_onGameStart: () => { send('started'); window.dispatchEvent(new Event('genesis-started')); },
    });
    const script = document.createElement('script');
    script.src = '/emulator/4.2.3/data/loader.js';
    script.onerror = () => fail('Emulator files are unavailable. Reconnect and prepare the offline download again.');
    document.head.appendChild(script);
  });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.ejs_start_button')) send('starting');
  }, true);
  window.addEventListener('pagehide', () => { if (gameUrl) URL.revokeObjectURL(gameUrl); });
  send('bridge-ready');
})();
