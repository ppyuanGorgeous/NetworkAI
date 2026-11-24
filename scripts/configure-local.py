#!/usr/bin/env python3
"""Create private, local-only deployment settings without overwriting existing values."""
from pathlib import Path
import os
import secrets

root = Path(__file__).resolve().parent.parent
target = root / '.env'
if not target.exists():
    content = (
        'WEB_PORT=3000\n'
        f'ES_PASSWORD={secrets.token_hex(24)}\n'
        f'JWT_SECRET={secrets.token_hex(32)}\n'
        'ENABLE_PAID_AI=false\n'
        'OPENAI_API_KEY=\n'
        'OPENAI_IMAGE_MODEL=gpt-image-2\n'
        'OPENAI_AGENT_MODEL=gpt-4.1-mini\n'
    )
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)
    print('Created private .env with random local database and session secrets.')
else:
    print('Kept the existing private .env settings.')
os.chmod(target, 0o600)
for command in root.glob('*.command'):
    command.chmod(0o755)
print('Paid AI remains controlled by ENABLE_PAID_AI. Never commit .env.')
