import { copyFile } from 'node:fs/promises';
// Isolated online runtime avoids stale files from an already installed offline package.
await copyFile('public/player/bridge.js', 'public/online-player/bridge.js');
