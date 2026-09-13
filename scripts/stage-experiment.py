#!/usr/bin/env python3
"""Stage the experimental player snapshot for the existing main-branch Pages site.
Run in a main checkout, review the diff, then commit/push main to publish.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REF = 'refs/remotes/origin/experiment/moving-resonators'
DEST = ROOT / 'experiments' / 'moving-resonators'
FILES = ('index.html', 'player.html', 'style.css', 'player.js', 'wav-worker.js')

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True)

sha = git('rev-parse', '--verify', REF).strip()
# Resolve one commit before reading files so every asset comes from the same version.
assets = {name: git('show', f'{sha}:{name}') for name in FILES}
assets['index.html'] = assets['index.html'].replace('<title>Open</title>', '<title>Open — Experimental</title>').replace('"open_player",', '"open_player_experiment",')
assets['player.html'] = assets['player.html'].replace('<title>Open — Player</title>', '<title>Open — Experimental Player</title>')
old_key = 'const STATE_KEY = "open_player_settings";'
if old_key not in assets['player.js']:
    raise SystemExit('Settings key changed; review preview isolation before publishing.')
assets['player.js'] = assets['player.js'].replace(old_key, 'const STATE_KEY = "open_player_settings:experiment/moving-resonators";')
DEST.mkdir(parents=True, exist_ok=True)
for name, content in assets.items():
    (DEST / name).write_text(content)
(DEST / 'version.json').write_text(json.dumps({'branch': 'experiment/moving-resonators', 'commit': sha}, indent=2) + '\n')
print(f'Staged {sha} at {DEST}')
