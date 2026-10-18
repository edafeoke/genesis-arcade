# Vendored EmulatorJS 4.2.3

Upstream source: https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3
Source archive: https://codeload.github.com/EmulatorJS/EmulatorJS/tar.gz/refs/tags/v4.2.3
EmulatorJS license: GPL-3.0, included as LICENSE. Original source files are shipped unminified in data/src. Embedded libraries retain their upstream notices.

Genesis Plus GX core version 2.0.2, build 2025-06-14. Core binaries originate from the versioned official CDN. CORE-PROVENANCE.json records their original archive hashes. Extracted core bytes are unchanged; archives are repacked from 7z to ZIP to avoid slow 7z decoding on WebKit. Both normal and legacy files are included; the player selects the single-thread legacy build for consistent browser support. The embedded core license is CORE-LICENSE.txt; GENESIS-PLUS-GX-LICENSE.txt is an additional copy of upstream licensing information.

Core source: https://github.com/EmulatorJS/Genesis-Plus-GX
Core build tooling: https://github.com/EmulatorJS/build
The release report does not record a source commit SHA; this build is pinned by binary SHA-256 and is not claimed to be reproducible from these links alone. Respect the core's redistribution and noncommercial conditions; see the included license before distributing this project commercially.

Local source changes in data/src/emulator.js:
- Disabled constructor update probes to the remote CDN.
- Replaced remote core fallback with a local failure message.

No runtime CDN dependency is used. The player page's Content Security Policy blocks external network connections. checksums.json records the exact vendored files including these changes. ROMs are not included.
