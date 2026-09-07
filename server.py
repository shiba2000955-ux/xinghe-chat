import asyncio
import hashlib
import json
import os
import secrets
import sqlite3
from pathlib import Path

from aiohttp import web, WSMsgType

ROOT = Path(__file__).parent
DB_PATH = Path(os.environ.get('NOVA_DB_PATH', ROOT / 'nova.db'))
PORT = int(os.environ.get('PORT', '5173'))
CLIENTS = {}


def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA journal_mode=WAL')
    connection.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            recipient TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    return connection


def password_hash(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


def public_user(row):
    return {'id': row['id'], 'username': row['username'], 'name': row['display_name']}


def token_for(user):
    token = secrets.token_urlsafe(32)
    CLIENTS[token] = {'user': public_user(user), 'socket': None}
    return token


async def json_response(data, status=200):
    return web.json_response(data, status=status)


async def register(request):
    payload = await request.json()
    username = str(payload.get('username', '')).strip().lower()
    password = str(payload.get('password', ''))
    display_name = str(payload.get('name', '')).strip() or username
    if len(username) < 3 or len(password) < 6:
        return await json_response({'error': '用户名至少 3 位，密码至少 6 位'}, 400)
    connection = db()
    try:
        cursor = connection.execute('INSERT INTO users(username, password_hash, display_name) VALUES (?, ?, ?)', (username, password_hash(password), display_name))
        connection.commit()
        user = connection.execute('SELECT * FROM users WHERE id = ?', (cursor.lastrowid,)).fetchone()
    except sqlite3.IntegrityError:
        connection.close()
        return await json_response({'error': '用户名已经存在'}, 409)
    connection.close()
    return await json_response({'token': token_for(user), 'user': public_user(user)})


async def login(request):
    payload = await request.json()
    username = str(payload.get('username', '')).strip().lower()
    connection = db()
    user = connection.execute('SELECT * FROM users WHERE username = ? AND password_hash = ?', (username, password_hash(str(payload.get('password', ''))))).fetchone()
    connection.close()
    if not user:
        return await json_response({'error': '用户名或密码错误'}, 401)
    return await json_response({'token': token_for(user), 'user': public_user(user)})


async def history(request):
    token = request.headers.get('X-Auth-Token')
    session = CLIENTS.get(token)
    if not session:
        return await json_response({'error': '未登录'}, 401)
    connection = db()
    rows = connection.execute('SELECT sender, recipient, body, created_at FROM messages ORDER BY id DESC LIMIT 100').fetchall()
    connection.close()
    return await json_response({'messages': [dict(row) for row in reversed(rows)]})


async def broadcast(payload):
    dead = []
    for token, session in CLIENTS.items():
        socket = session.get('socket')
        if socket and not socket.closed:
            try:
                await socket.send_json(payload)
            except Exception:
                dead.append(token)
    for token in dead:
        CLIENTS.pop(token, None)


async def websocket(request):
    token = request.query.get('token')
    session = CLIENTS.get(token)
    if not session:
        return web.Response(status=401, text='登录已失效')
    socket = web.WebSocketResponse(heartbeat=25)
    await socket.prepare(request)
    session['socket'] = socket
    await socket.send_json({'type': 'connected', 'user': session['user']})
    async for message in socket:
        if message.type == WSMsgType.TEXT:
            try:
                payload = json.loads(message.data)
            except json.JSONDecodeError:
                continue
            if payload.get('type') != 'message' or not str(payload.get('body', '')).strip():
                continue
            body = str(payload['body']).strip()[:4000]
            recipient = str(payload.get('recipient', '')).strip()
            sender = session['user']['username']
            connection = db()
            connection.execute('INSERT INTO messages(sender, recipient, body) VALUES (?, ?, ?)', (sender, recipient, body))
            connection.commit()
            connection.close()
            await broadcast({'type': 'message', 'sender': sender, 'recipient': recipient, 'body': body})
        elif message.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
            break
    if session.get('socket') is socket:
        session['socket'] = None
    return socket


async def health(request):
    return await json_response({'ok': True, 'service': 'nova-messenger'})


async def index(request):
    return web.FileResponse(ROOT / 'index.html')


app = web.Application(client_max_size=8 * 1024 * 1024)
app.router.add_post('/api/register', register)
app.router.add_post('/api/login', login)
app.router.add_get('/api/history', history)
app.router.add_get('/ws', websocket)
app.router.add_get('/health', health)
app.router.add_get('/', index)
app.router.add_static('/', ROOT, show_index=True)

if __name__ == '__main__':
    web.run_app(app, host='0.0.0.0', port=PORT)
