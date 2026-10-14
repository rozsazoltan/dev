#!/usr/bin/env python3
"""Check repository layout and parse JSONC without external Python packages.

Note: syntactic validation does not prove OpenCode/plugin runtime schema validity.
"""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = [
    'README.md', 'config/opencode/opencode.jsonc', 'config/opencode/dcp.jsonc',
    'config/opencode/oh-my-opencode-slim.jsonc',
    'config/opencode/oh-my-opencode-slim/codex/orchestrator_append.md',
    'config/opencode/prompts/command.md',
    'config/apm/apm.yml', 'docs/monorepo.md', 'docs/setup-windows.md',
    'docs/setup-wsl.md', 'profiles/laravel-app/.opencode/opencode.jsonc',
    'scripts/apply-profile.py', 'scripts/install-windows.ps1',
]

def strip_jsonc(text):
    """Remove // and /* */ comments, then commas before ] or }, keeping string literals."""
    out=[]; i=0; quoted=False; escaped=False
    while i < len(text):
        c=text[i]
        if quoted:
            out.append(c)
            if escaped: escaped=False
            elif c=='\\': escaped=True
            elif c=='"': quoted=False
            i+=1; continue
        if c=='"':
            quoted=True; out.append(c); i+=1; continue
        if c=='/' and i+1<len(text) and text[i+1]=='/':
            i+=2
            while i<len(text) and text[i] not in '\r\n': i+=1
            continue
        if c=='/' and i+1<len(text) and text[i+1]=='*':
            i+=2
            end=text.find('*/',i)
            if end<0: raise ValueError('Unterminated block comment')
            i=end+2; continue
        out.append(c); i+=1
    clean=''.join(out)
    out=[]; quoted=False; escaped=False; i=0
    while i<len(clean):
        c=clean[i]
        if quoted:
            out.append(c)
            if escaped: escaped=False
            elif c=='\\': escaped=True
            elif c=='"': quoted=False
            i+=1; continue
        if c=='"': quoted=True; out.append(c); i+=1; continue
        if c==',':
            j=i+1
            while j<len(clean) and clean[j].isspace(): j+=1
            if j<len(clean) and clean[j] in '}]': i+=1; continue
        out.append(c); i+=1
    return ''.join(out)

errors=[]
for path in EXPECTED:
    if not (ROOT/path).is_file(): errors.append(f'Missing required file: {path}')
parsed=[]
for file in sorted(ROOT.rglob('*.jsonc')):
    try:
        obj=json.loads(strip_jsonc(file.read_text('utf-8')))
        if not isinstance(obj,dict): errors.append(f'Not a JSON object: {file.relative_to(ROOT)}')
        parsed.append(file)
    except (ValueError, json.JSONDecodeError) as exc:
        errors.append(f'Invalid JSONC {file.relative_to(ROOT)}: {exc}')
for file in sorted(ROOT.rglob('*.json')):
    try: json.loads(file.read_text('utf-8'))
    except (ValueError, json.JSONDecodeError) as exc:
        errors.append(f'Invalid JSON {file.relative_to(ROOT)}: {exc}')
main=ROOT/'config/opencode/opencode.jsonc'
if main.exists():
    data=json.loads(strip_jsonc(main.read_text('utf-8')))
    if 'plugin' in data or 'agent' in data or 'permission' in data:
        errors.append('Legacy V1 root key found (plugin/agent/permission)')
    if 'plugins' not in data or 'agents' not in data:
        errors.append('Missing V2 plugins/agents configuration')
for sensitive in ('github-key','unsloth-key','id_rsa','.env'):
    for path in ROOT.rglob('*'):
        if path.is_file() and path.name==sensitive:
            errors.append(f'Possible committed secret: {path.relative_to(ROOT)}')
if errors:
    for error in errors: print('FAIL:',error,file=sys.stderr)
    sys.exit(1)
print(f'PASS: {len(parsed)} JSONC files parse; expected file layout present; no obvious secret filenames.')
print('This is static validation only. Runtime MCP, plugins, models and credentials remain untested.')
