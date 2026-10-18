"""Build a lab-only JS instrumentation of the pinned archive; WASM is unchanged."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public/emulator/4.2.3/data/cores/genesis_plus_gx-legacy-wasm.data'
DEST = ROOT / 'public/sync-lab/runtime/genesis_plus_gx-legacy-wasm.data'
checksums = json.loads((ROOT / 'public/emulator/4.2.3/checksums.json').read_text())['sha256']
source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
assert source_hash == checksums['data/cores/genesis_plus_gx-legacy-wasm.data'], 'Pinned archive changed'
anchor = b'preInit();run();moduleRtn=readyPromise;'
hook = b'''Module["genesisLabTick"]=async()=>{if(ABORT||!MainLoop.func||MainLoop.scheduler!==null||Asyncify.currData)throw new Error("Lab tick requires a paused, idle scheduler");const resume=MainLoop.resume;MainLoop.resume=()=>{};try{MainLoop.func();if(Asyncify.currData)await Asyncify.whenDone()}finally{MainLoop.resume=resume}};'''
DEST.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(SOURCE) as source, zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as dest:
    for name in source.namelist():
        data = source.read(name)
        if name == 'genesis_plus_gx_libretro.js':
            assert data.count(anchor) == 1, 'Instrumentation anchor changed'
            data = data.replace(anchor, hook + anchor)
        info = zipfile.ZipInfo(name, date_time=(2025, 6, 14, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        dest.writestr(info, data)
report = {'sourceArchiveSHA256': source_hash, 'instrumentedArchiveSHA256': hashlib.sha256(DEST.read_bytes()).hexdigest(),
          'playerScriptSHA256': {name: hashlib.sha256((ROOT / 'public/player' / name).read_bytes()).hexdigest() for name in ['bridge.js', 'capability-lab.js']},
          'patch': 'Expose an Asyncify-aware paused main-loop callback as genesisLabTick, suppressing automatic resume during the operation; no WASM changes.',
          'scope': 'Experimental frontend iteration, not certified emulated-frame stepping.'}
(DEST.parent / 'provenance.json').write_text(json.dumps(report, indent=2) + '\n')
for name in ['bridge.js', 'capability-lab.js']:
    (DEST.parent / name).write_bytes((ROOT / 'public/player' / name).read_bytes())
html = (ROOT / 'public/player/index.html').read_text()
html = html.replace('/player/bridge.js', '/sync-lab/runtime/bridge.js').replace('/player/capability-lab.js', '/sync-lab/runtime/capability-lab.js')
(DEST.parent / 'player.html').write_text(html)
print(json.dumps(report, indent=2))
