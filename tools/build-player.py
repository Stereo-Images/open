"""Publish the approved g29 engine using the site's existing external WAV worker."""
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / 'studies/g29/deliverables/Open-g29-Sixteen-New-Studies.html').read_text()
start = html.index('// --- START OF SCRIPT ---')
end = html.index('// --- END OF SCRIPT ---') + len('// --- END OF SCRIPT ---')
source = html[start:end] + '\n'
pattern = r'      const workerUrl = URL\.createObjectURL\(new Blob\(\[("(?:\\.|[^"\\])*")\], \{ type: "text/javascript" \}\)\);\n      const worker = new Worker\(workerUrl\);'
match = re.search(pattern, source)
assert match, 'Expected the approved embedded WAV encoder'
assert json.loads(match.group(1)).rstrip() == (ROOT / 'wav-worker.js').read_text().rstrip(), 'WAV encoder changed'
source = source[:match.start()] + '      const worker = new Worker("wav-worker.js?v=1.0");' + source[match.end():]
source = source.replace('        URL.revokeObjectURL(workerUrl);\n', '')
target = ROOT / 'player.js'
if '--check' in sys.argv:
    assert target.read_text() == source, 'Run python3 tools/build-player.py'
    print('Published engine matches approved g29; only the WAV worker transport differs.')
else:
    target.write_text(source)
