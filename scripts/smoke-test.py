#!/usr/bin/env python3
"""Exercise the deployed local application using temporary accounts and media."""
import argparse
import json
import secrets
import struct
import uuid
import zlib
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://localhost:3000')
args = parser.parse_args()
origin = args.url.rstrip('/')
api = origin + '/api/backend'
checks = []


def request(path, *, method='GET', data=None, token=None, content_type='application/json'):
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if data is not None:
        headers['Content-Type'] = content_type
        if not isinstance(data, bytes):
            data = json.dumps(data).encode()
    req = Request(api + path, data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=30) as response:
            return response.status, response.read(), response.headers
    except HTTPError as error:
        return error.code, error.read(), error.headers


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def png():
    def chunk(kind, content):
        return struct.pack('!I', len(content)) + kind + content + struct.pack('!I', zlib.crc32(kind + content))
    pixels = b''.join(b'\x00' + bytes((55, 109, 92)) * 16 for _ in range(16))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 16, 16, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


def account(prefix):
    user = {'username': prefix + uuid.uuid4().hex[:12], 'password': secrets.token_urlsafe(20)}
    status, _, _ = request('/signup', method='POST', data=user)
    check(status == 200, prefix + ': registration')
    status, body, _ = request('/signin', method='POST', data=user)
    check(status == 200 and len(body) > 20, prefix + ': sign in')
    return user['username'], body.decode().strip()


status, _, _ = request('/healthz')
check(status == 200, 'backend health through the frontend proxy')
status, _, _ = request('/posts/search')
check(status == 401, 'anonymous post search is rejected')
username, token = account('smoke')
other, other_token = account('other')
marker = 'networkailocal' + uuid.uuid4().hex
boundary = 'networkai' + uuid.uuid4().hex
image = png()
body = (
    f'--{boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\n{marker}\r\n'.encode()
    + f'--{boundary}\r\nContent-Disposition: form-data; name="media_file"; filename="local-test.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
    + image + f'\r\n--{boundary}--\r\n'.encode()
)
post_id = None
try:
    status, payload, _ = request('/posts', method='POST', data=body, token=token, content_type='multipart/form-data; boundary=' + boundary)
    check(status == 200, 'authenticated media upload')
    post = json.loads(payload)
    post_id = post['id']
    check(post['user'] == username and post['type'] == 'image', 'server assigns the authenticated author and media type')
    check(post['url'].startswith('/api/backend/media/'), 'media uses the local same-origin route')
    with urlopen(origin + post['url'], timeout=15) as response:
        check(response.status == 200 and response.read() == image, 'uploaded media is retrievable')
    status, payload, _ = request('/posts/search?' + urlencode({'keywords': marker}), token=token)
    check(status == 200 and any(item['id'] == post_id for item in json.loads(payload)), 'Elasticsearch keyword search finds the uploaded post')
    status, payload, _ = request('/posts/search?' + urlencode({'user': username}), token=token)
    check(status == 200 and all(item['user'] == username for item in json.loads(payload)), 'author search returns only the requested author')
    status, _, _ = request('/posts/' + post_id, method='DELETE', token=other_token)
    check(status == 404, 'another user cannot delete the post')
    status, _, _ = request('/posts/' + post_id, method='DELETE', token=token)
    check(status == 200, 'the author can delete the post')
    status, payload, _ = request('/posts/search?' + urlencode({'keywords': marker}), token=token)
    check(status == 200 and json.loads(payload) == [], 'deleted post is absent from search')
    try:
        with urlopen(origin + post['url'], timeout=15) as response:
            media_status = response.status
    except HTTPError as error:
        media_status = error.code
    check(media_status == 404, 'deleted local media is removed')
    post_id = None
finally:
    if post_id:
        request('/posts/' + post_id, method='DELETE', token=token)

print(json.dumps({'result': 'passed', 'checks': len(checks), 'details': checks}, indent=2))
