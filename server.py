import asyncio
import hashlib
import base64
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from aiohttp import web, WSMsgType
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None

ROOT = Path(__file__).parent
DB_PATH = Path(os.environ.get('NOVA_DB_PATH', ROOT / 'nova.db'))
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
PORT = int(os.environ.get('PORT', '5173'))
CLIENTS = {}
TOKEN_SECRET = os.environ.get('NOVA_TOKEN_SECRET', 'nova-development-secret')
ADMIN_KEY = os.environ.get('NOVA_ADMIN_KEY', '').strip()


class PostgresConnection:
    def __init__(self, url):
        self.connection = psycopg2.connect(url, sslmode='require')
        self.connection.autocommit = False

    def execute(self, sql, params=()):
        cursor = self.connection.cursor(cursor_factory=RealDictCursor)
        cursor.execute(sql.replace('?', '%s'), params)
        return cursor

    def executescript(self, script):
        self.connection.cursor().execute(script)

    def commit(self):
        self.connection.commit()

    def close(self):
        self.connection.close()


def db():
    if DATABASE_URL:
        if any(marker in DATABASE_URL.lower() for marker in ('hidden', 'password', '[your-', 'your-password')):
            raise RuntimeError('DATABASE_URL 仍是示例值，请在 Render 中粘贴 Supabase 的完整 URI')
        if psycopg2 is None:
            raise RuntimeError('DATABASE_URL 已配置，但缺少 psycopg2 依赖')
        connection = PostgresConnection(DATABASE_URL)
        connection.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL, display_name TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS messages (
                id BIGSERIAL PRIMARY KEY, sender TEXT NOT NULL,
                recipient TEXT NOT NULL, body TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS friend_requests (
                id BIGSERIAL PRIMARY KEY, sender_id BIGINT NOT NULL,
                recipient_id BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(sender_id, recipient_id)
            );
        ''')
        connection.commit()
        connection.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip TEXT')
        connection.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ')
        connection.commit()
        return connection
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
        CREATE TABLE IF NOT EXISTS friend_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            recipient_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(sender_id, recipient_id)
        );
    ''')
    for statement in (
        'ALTER TABLE users ADD COLUMN last_login_ip TEXT',
        'ALTER TABLE users ADD COLUMN last_login_at TEXT',
    ):
        try:
            connection.execute(statement)
        except sqlite3.OperationalError as error:
            if 'duplicate column name' not in str(error).lower():
                raise
    return connection


def password_hash(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


def public_user(row):
    return {'id': row['id'], 'username': row['username'], 'name': row['display_name']}


def token_for(user):
    raw = str(user['id']).encode('utf-8')
    signature = hmac.new(TOKEN_SECRET.encode('utf-8'), raw, hashlib.sha256).hexdigest()
    token = f'{base64.urlsafe_b64encode(raw).decode().rstrip("=")}.{signature}'
    CLIENTS[token] = {'user': public_user(user), 'socket': None}
    return token


def authenticated_user(token):
    if not token or '.' not in token:
        return None
    encoded_id, signature = token.split('.', 1)
    try:
        raw = base64.urlsafe_b64decode(encoded_id + '=' * (-len(encoded_id) % 4))
        user_id = int(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError, base64.binascii.Error):
        return None
    expected = hmac.new(TOKEN_SECRET.encode('utf-8'), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    connection = db()
    user = connection.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    connection.close()
    return public_user(user) if user else None


def session_user(request):
    return authenticated_user(request.headers.get('X-Auth-Token'))


def user_by_id(connection, user_id):
    return connection.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()


async def json_response(data, status=200):
    return web.json_response(data, status=status, dumps=lambda value: json.dumps(value, ensure_ascii=False, default=str))


async def register(request):
    payload = await request.json()
    username = str(payload.get('username', '')).strip().lower()
    password = str(payload.get('password', ''))
    display_name = str(payload.get('name', '')).strip() or username
    if len(username) < 3 or len(password) < 6:
        return await json_response({'error': '用户名至少 3 位，密码至少 6 位'}, 400)
    try:
        connection = db()
        cursor = connection.execute(
            'INSERT INTO users(username, password_hash, display_name) VALUES (?, ?, ?) '
            'RETURNING id, username, password_hash, display_name',
            (username, password_hash(password), display_name)
        )
        user = cursor.fetchone()
        cursor.close()
        connection.commit()
    except (sqlite3.IntegrityError, psycopg2.IntegrityError if psycopg2 else sqlite3.IntegrityError):
        if 'connection' in locals():
            connection.close()
        return await json_response({'error': '用户名已经存在'}, 409)
    except Exception as error:
        if 'connection' in locals():
            connection.close()
        return await json_response({'error': f'数据库连接失败：{error}'}, 503)
    connection.close()
    return await json_response({'token': token_for(user), 'user': public_user(user)})


async def login(request):
    payload = await request.json()
    username = str(payload.get('username', '')).strip().lower()
    connection = db()
    user = connection.execute('SELECT * FROM users WHERE username = ? AND password_hash = ?', (username, password_hash(str(payload.get('password', ''))))).fetchone()
    if user:
        now = datetime.now(timezone.utc).isoformat()
        ip = request.headers.get('X-Forwarded-For', request.remote or '').split(',')[0].strip()
        connection.execute('UPDATE users SET last_login_ip = ?, last_login_at = ? WHERE id = ?', (ip, now, user['id']))
        connection.commit()
    connection.close()
    if not user:
        return await json_response({'error': '用户名或密码错误'}, 401)
    return await json_response({'token': token_for(user), 'user': public_user(user)})


def admin_allowed(request):
    return bool(ADMIN_KEY) and hmac.compare_digest(request.headers.get('X-Admin-Key', ''), ADMIN_KEY)


async def admin_users(request):
    if not admin_allowed(request):
        return await json_response({'error': '管理员认证失败'}, 401)
    connection = db()
    rows = connection.execute(
        'SELECT id, username, display_name, created_at, last_login_ip, last_login_at '
        'FROM users ORDER BY id DESC'
    ).fetchall()
    connection.close()
    return await json_response({'users': [dict(row) for row in rows], 'passwords': 'never returned'})


async def history(request):
    user = session_user(request)
    if not user:
        return await json_response({'error': '未登录'}, 401)
    connection = db()
    rows = connection.execute(
        'SELECT sender, recipient, body, created_at FROM messages '
        'WHERE sender = ? OR recipient = ? ORDER BY id DESC LIMIT 100',
        (user['username'], user['username'])
    ).fetchall()
    connection.close()
    return await json_response({'messages': [dict(row) for row in reversed(rows)]})


async def find_users(request):
    user = session_user(request)
    if not user:
        return await json_response({'error': '未登录'}, 401)
    query = str(request.query.get('q', '')).strip().lstrip('@').lower()
    if len(query) < 2:
        return await json_response({'users': []})
    connection = db()
    rows = connection.execute(
        'SELECT id, username, display_name FROM users '
        'WHERE id != ? AND (username LIKE ? OR display_name LIKE ?) LIMIT 20',
        (user['id'], f'%{query}%', f'%{query}%')
    ).fetchall()
    connection.close()
    return await json_response({'users': [public_user(row) for row in rows]})


async def list_contacts(request):
    user = session_user(request)
    if not user:
        return await json_response({'error': '未登录'}, 401)
    connection = db()
    rows = connection.execute('''
        SELECT u.id, u.username, u.display_name, fr.id AS request_id, fr.status,
               CASE WHEN fr.sender_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction
        FROM friend_requests fr
        JOIN users u ON u.id = CASE WHEN fr.sender_id = ? THEN fr.recipient_id ELSE fr.sender_id END
        WHERE (fr.sender_id = ? OR fr.recipient_id = ?) AND fr.status IN ('pending', 'accepted')
        ORDER BY fr.id DESC
    ''', (user['id'], user['id'], user['id'], user['id'])).fetchall()
    connection.close()
    contacts = []
    for row in rows:
        contacts.append({
            'id': row['id'], 'username': row['username'], 'name': row['display_name'],
            'requestId': row['request_id'], 'relation': '好友' if row['status'] == 'accepted'
            else ('待处理' if row['direction'] == 'incoming' else '已发送')
        })
    return await json_response({'contacts': contacts})


async def create_friend_request(request):
    user = session_user(request)
    if not user:
        return await json_response({'error': '未登录'}, 401)
    payload = await request.json()
    username = str(payload.get('username', '')).strip().lstrip('@').lower()
    connection = db()
    target = connection.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    if not target or target['id'] == user['id']:
        connection.close()
        return await json_response({'error': '找不到这个账号'}, 404)
    existing = connection.execute(
        'SELECT * FROM friend_requests WHERE (sender_id = ? AND recipient_id = ?) '
        'OR (sender_id = ? AND recipient_id = ?)',
        (user['id'], target['id'], target['id'], user['id'])
    ).fetchone()
    if existing:
        connection.close()
        return await json_response({'error': '好友申请已经存在或你们已经是好友'}, 409)
    connection.execute(
        'INSERT INTO friend_requests(sender_id, recipient_id) VALUES (?, ?)',
        (user['id'], target['id'])
    )
    connection.commit()
    connection.close()
    return await json_response({'ok': True, 'message': '好友申请已发送'})


async def update_friend_request(request):
    user = session_user(request)
    if not user:
        return await json_response({'error': '未登录'}, 401)
    try:
        request_id = int(request.match_info['request_id'])
    except ValueError:
        return await json_response({'error': '申请无效'}, 400)
    action = (await request.json()).get('action')
    if action not in ('accept', 'reject'):
        return await json_response({'error': '操作无效'}, 400)
    connection = db()
    row = connection.execute(
        'SELECT * FROM friend_requests WHERE id = ? AND recipient_id = ? AND status = ?',
        (request_id, user['id'], 'pending')
    ).fetchone()
    if not row:
        connection.close()
        return await json_response({'error': '申请不存在或已处理'}, 404)
    status = 'accepted' if action == 'accept' else 'rejected'
    connection.execute('UPDATE friend_requests SET status = ? WHERE id = ?', (status, request_id))
    connection.commit()
    connection.close()
    return await json_response({'ok': True, 'status': status})


async def broadcast(payload):
    dead = []
    for token, session in CLIENTS.items():
        if session['user']['username'] not in {payload.get('sender'), payload.get('recipient')}:
            continue
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
    user = authenticated_user(token)
    if not user:
        return web.Response(status=401, text='登录已失效')
    session = CLIENTS.setdefault(token, {'user': user, 'socket': None})
    socket = web.WebSocketResponse(heartbeat=25, max_msg_size=8 * 1024 * 1024)
    await socket.prepare(request)
    session['socket'] = socket
    await socket.send_json({'type': 'connected', 'user': session['user']})
    async for message in socket:
        if message.type == WSMsgType.TEXT:
            try:
                payload = json.loads(message.data)
            except json.JSONDecodeError:
                continue
            sender = session['user']['username']
            recipient = str(payload.get('recipient', '')).strip()
            if payload.get('type') in ('retract', 'call-signal'):
                await broadcast({'type': payload['type'], 'sender': sender, 'recipient': recipient, **payload})
                continue
            if payload.get('type') != 'message' or not str(payload.get('body', '')).strip():
                continue
            body = str(payload['body']).strip()[:8_000_000]
            connection = db()
            connection.execute('INSERT INTO messages(sender, recipient, body) VALUES (?, ?, ?)', (sender, recipient, body))
            connection.commit()
            connection.close()
            await broadcast({'type': 'message', 'sender': sender, 'recipient': recipient, 'body': body, 'quote': payload.get('quote')})
        elif message.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
            break
    if session.get('socket') is socket:
        session['socket'] = None
    return socket


async def health(request):
    try:
        connection = db()
        connection.execute('SELECT 1').fetchone()
        connection.close()
        return await json_response({'ok': True, 'service': 'nova-messenger', 'database': 'connected'})
    except Exception as error:
        return await json_response({'ok': False, 'service': 'nova-messenger', 'database': 'error', 'error': str(error)}, 503)


async def index(request):
    return web.FileResponse(ROOT / 'index.html')


async def admin_page(request):
    return web.FileResponse(ROOT / 'admin.html')


@web.middleware
async def json_errors(request, handler):
    try:
        return await handler(request)
    except web.HTTPException:
        raise
    except Exception as error:
        return await json_response({'error': f'服务器内部错误：{error}'}, 503)


app = web.Application(client_max_size=8 * 1024 * 1024, middlewares=[json_errors])
app.router.add_post('/api/register', register)
app.router.add_post('/api/login', login)
app.router.add_get('/admin/api/users', admin_users)
app.router.add_get('/api/history', history)
app.router.add_get('/api/users', find_users)
app.router.add_get('/api/contacts', list_contacts)
app.router.add_post('/api/friend-requests', create_friend_request)
app.router.add_post('/api/friend-requests/{request_id}', update_friend_request)
app.router.add_get('/ws', websocket)
app.router.add_get('/health', health)
app.router.add_get('/admin', admin_page)
app.router.add_get('/', index)
app.router.add_static('/', ROOT, show_index=True)

if __name__ == '__main__':
    web.run_app(app, host='0.0.0.0', port=PORT)
