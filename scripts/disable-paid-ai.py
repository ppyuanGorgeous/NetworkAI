#!/usr/bin/env python3
"""Turn off paid routes without revealing or deleting the user's API key."""
from pathlib import Path
import os

path = Path(__file__).resolve().parent.parent / '.env'
if not path.exists():
    raise SystemExit('Run python3 scripts/configure-local.py first.')
lines = path.read_text().splitlines()
found = False
for index, line in enumerate(lines):
    if line.startswith('ENABLE_PAID_AI='):
        lines[index] = 'ENABLE_PAID_AI=false'
        found = True
if not found:
    lines.append('ENABLE_PAID_AI=false')
temporary = path.with_name('.env.disabled.tmp')
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write('\n'.join(lines) + '\n')
os.replace(temporary, path)
print('Paid AI is disabled in .env. Recreate the web service to apply:')
print('docker compose up -d --no-deps --force-recreate web')
