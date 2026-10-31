"""A small, authenticated office-LAN server. Python standard library only."""
import argparse
from collections import Counter
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).parent
DB = Path(os.environ.get('HUADI_DATA_DIR', str(ROOT / 'data'))) / 'operations.sqlite3'
WRITE_LOCK = threading.RLock()
SESSION_LIFETIME = 12 * 60 * 60
COOKIE_NAME = 'huadi_session'
PASSWORD_ROUNDS = 600000
ROLES = {'admin', 'editor', 'viewer'}


def connect():
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA busy_timeout=15000')
    return c


def backup_database(label='manual'):
    """Call under WRITE_LOCK before changing user state; SQLite creates a consistent copy."""
    folder = DB.parent / 'backups'
    folder.mkdir(parents=True, exist_ok=True)
    filename = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + label + '.sqlite3'
    destination = folder / filename
    with connect() as source, sqlite3.connect(destination) as target:
        source.backup(target)
    return destination


def initial():
 topics=[('视频','寻宝记','寻宝记 01｜一件老物，怎么读懂它的年代？'),('视频','寻宝记','寻宝记 02｜百元预算，在花地湾能找到什么？'),('视频','寻宝记','寻宝记 03｜店主舍不得卖的一件收藏'),('视频','寻宝记','寻宝记 04｜同一种器物，为什么价格不同？'),('视频','人物简谈','票证展览林仕荣｜从一张票证讲起'),('图文','空间美学','在花地湾，逛一家让人慢下来的店'),('图文','空间美学','一角一器｜把东方美学藏进日常'),('图文','招商推广','在白鹅潭附近，发现一个适合做文化活动的空间'),('图文','招商推广','一个聚集古玩、文玩、艺术品商户的商业空间'),('图文','器物分享','低调又有质感的文玩配色，真的很适合秋冬'),('图文','器物分享','温润的东方美学，藏在这些玉器里'),('图文','周末地摊','周末来花地湾，带你逛一圈古玩地摊'),('图文','周末地摊','第一次逛古玩地摊，先看这几个细节')]
 dates=[3,10,17,24,30,5,12,7,19,14,21,8,22]
 return {'items':[dict(id=i+1,kind=k,category=c,title=t,date=f'2026-11-{dates[i]:02}',status='待策划',owner='',notes='Excel 已定方向；标题和日期为建议，待确认' if i not in [4,7,8,9,10] else 'Excel 已定选题；日期为建议，待确认',review='',metrics={}) for i,(k,c,t) in enumerate(topics)],'leads':[],'targets':{'views':10000,'leads':10},'version':1}


def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with WRITE_LOCK:
        with connect() as c:
            old = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='state'").fetchone()
            migrate = old and 'revision' not in {r[1] for r in c.execute('PRAGMA table_info(state)')}
        if migrate:
            backup_database('before-collaboration')
        with connect() as c:
            c.execute('BEGIN IMMEDIATE')
            c.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1)')
            if migrate:
                c.execute('ALTER TABLE state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
            c.execute('INSERT OR IGNORE INTO state(id,body,revision) VALUES(1,?,1)', (json.dumps(initial(), ensure_ascii=False),))
            c.execute('''CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
                disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
                csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY, actor TEXT NOT NULL, time TEXT NOT NULL,
                action TEXT NOT NULL, summary TEXT NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS login_attempts (
                address TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_started INTEGER NOT NULL)''')


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def audit(c, actor, action, summary):
    c.execute('INSERT INTO audit(actor,time,action,summary) VALUES(?,?,?,?)',
              (actor, timestamp(), action, summary))


def public_user(row):
    return {key: row[key] for key in ('id', 'username', 'display_name', 'role')}


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), PASSWORD_ROUNDS).hex()
    return f'pbkdf2_sha256${PASSWORD_ROUNDS}${salt}${digest}'


def verify_password(password, encoded):
    try:
        name, rounds, salt, expected = encoded.split('$')
        if name != 'pbkdf2_sha256':
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def validate_password(password):
    if not isinstance(password, str) or not 10 <= len(password) <= 256:
        raise ValueError('密码请使用 10 至 256 个字符')


def validate_username(username):
    if not isinstance(username, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{3,40}', username):
        raise ValueError('账号请用 3 至 40 位英文字母、数字、点、下划线或短横线')


def validate_display_name(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 60:
        raise ValueError('显示名称请使用 1 至 60 个字符')
    return value.strip()


def current_state(c):
    row = c.execute('SELECT body,revision FROM state WHERE id=1').fetchone()
    value = json.loads(row['body'])
    value['_revision'] = row['revision']
    return value


def validate_state(d):
    if not isinstance(d, dict) or d.get('version') != 1 or not isinstance(d.get('items'), list) or not isinstance(d.get('leads'), list):
        raise ValueError('备份格式无效')
    ids = set()
    for item in d['items']:
        if not isinstance(item, dict) or type(item.get('id')) is not int or item['id'] in ids or not isinstance(item.get('title'), str) or not isinstance(item.get('metrics'), dict):
            raise ValueError('内容格式无效或编号重复')
        if any(not isinstance(item.get(k), str) for k in ['kind', 'category', 'date', 'status', 'owner', 'notes', 'review']):
            raise ValueError('内容字段不完整')
        if item['status'] not in ['待策划', '待拍摄', '制作中', '待发布', '已发布', '已复盘']:
            raise ValueError('进度无效')
        ids.add(item['id'])
        for metric in item['metrics'].values():
            if not isinstance(metric, dict):
                raise ValueError('指标格式无效')
            for k in ['views', 'likes', 'comments', 'saves', 'shares', 'leads']:
                value = metric.get(k, 0)
                if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                    raise ValueError('指标必须是有限的非负数')
    if any(not isinstance(lead, dict) or not isinstance(lead.get('name'), str) for lead in d['leads']):
        raise ValueError('线索格式无效')
    # Reject NaN/Infinity in nested snapshots or extension fields as well.
    json.dumps(d, allow_nan=False)


def state_summary(before, after):
    old = {x['id']: x for x in before.get('items', [])}
    new = {x['id']: x for x in after.get('items', [])}
    added, removed = len(new.keys() - old.keys()), len(old.keys() - new.keys())
    changed = sum(old[k] != new[k] for k in old.keys() & new.keys())
    parts = [f'内容新增 {added} 条、修改 {changed} 条、删除 {removed} 条']
    if before.get('leads') != after.get('leads'):
        parts.append(f"更新线索（当前 {len(after['leads'])} 条）")
    if before.get('ideaMemory') != after.get('ideaMemory'):
        parts.append('更新选题与收藏')
    return '；'.join(parts)


def normal_update_allowed(before, after):
    """A normal save edits one business record; bulk replacement is an admin restore."""
    allowed = {'items', 'leads', 'ideaMemory', '_revision'}
    for key in (before.keys() | after.keys()) - allowed:
        if before.get(key) != after.get(key):
            return False
    old = {x['id']: x for x in before.get('items', [])}
    new = {x['id']: x for x in after.get('items', [])}
    changed_items = sum(old.get(key) != new.get(key) for key in old.keys() | new.keys())
    old_leads = Counter(json.dumps(x, sort_keys=True, ensure_ascii=False) for x in before.get('leads', []))
    new_leads = Counter(json.dumps(x, sort_keys=True, ensure_ascii=False) for x in after.get('leads', []))
    changed_leads = max(sum((old_leads - new_leads).values()), sum((new_leads - old_leads).values()))
    return changed_items + changed_leads <= 1


def allowed_host(value):
    try:
        parsed = urlsplit('//' + value)
        if not value or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            return False
        _ = parsed.port  # Reject invalid port syntax.
        host = parsed.hostname
        if host and host.lower() == 'localhost':
            return True
        address = ipaddress.ip_address(host or '')
        if address.is_loopback:
            return True
        ranges = ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', 'fc00::/7', 'fe80::/10')
        return any(address in ipaddress.ip_network(net) for net in ranges if address.version == ipaddress.ip_network(net).version)
    except ValueError:
        return False


class Handler(SimpleHTTPRequestHandler):
    server_version = 'HuadiOffice/1.0'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'static'), **kwargs)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        super().end_headers()

    def reply(self, data, status=200, cookie=None):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def guard_host(self):
        if not allowed_host(self.headers.get('Host', '')):
            self.reply({'error': '请使用本机或办公室内网 IP 访问'}, 403)
            return False
        return True

    def is_local(self):
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            return False

    def authentication(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
            token = cookie[COOKIE_NAME].value if COOKIE_NAME in cookie else ''
        except Exception:
            return None
        if not token or len(token) > 256:
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with connect() as c:
            row = c.execute('''SELECT u.id,u.username,u.display_name,u.role,s.csrf_token,s.token_hash
                FROM sessions s JOIN users u ON u.id=s.user_id
                WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0''', (digest, int(time.time()))).fetchone()
        return dict(row) if row else None

    def require_user(self, roles=None, csrf=False):
        user = self.authentication()
        if not user:
            self.reply({'error': '请先登录', 'code': 'login_required'}, 401)
            return None
        if roles and user['role'] not in roles:
            self.reply({'error': '当前账号没有此操作权限'}, 403)
            return None
        if csrf and not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), user['csrf_token']):
            self.reply({'error': '登录验证已失效，请刷新后重试'}, 403)
            return None
        return user

    def session_response(self, user=None, cookie=None):
        with connect() as c:
            setup_required = not c.execute('SELECT 1 FROM users LIMIT 1').fetchone()
        result = {'setup_required': setup_required, 'can_setup': setup_required and self.is_local(),
                  'user': public_user(user) if user else None}
        if user:
            result['csrf_token'] = user['csrf_token']
        self.reply(result, cookie=cookie)

    def issue_session(self, c, user):
        token = secrets.token_urlsafe(48)
        csrf = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
        c.execute('DELETE FROM sessions WHERE expires_at<=?', (int(time.time()),))
        c.execute('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',
                  (digest, user['id'], csrf, int(time.time()) + SESSION_LIFETIME))
        cookie = f'{COOKIE_NAME}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_LIFETIME}'
        return {**dict(user), 'csrf_token': csrf}, cookie

    def do_HEAD(self):
        if self.guard_host():
            if self.path.startswith('/api/'):
                self.send_error(405)
            else:
                super().do_HEAD()

    def do_GET(self):
        if not self.guard_host():
            return
        if self.path == '/api/session':
            return self.session_response(self.authentication())
        if not self.path.startswith('/api/'):
            return super().do_GET()
        if self.path == '/api/state':
            if not self.require_user():
                return
            with connect() as c:
                return self.reply(current_state(c))
        if self.path == '/api/users':
            if not self.require_user({'admin'}):
                return
            with connect() as c:
                rows = c.execute('SELECT id,username,display_name,role,disabled,created_at FROM users ORDER BY id').fetchall()
                return self.reply({'users': [dict(r) for r in rows]})
        if self.path == '/api/audit':
            if not self.require_user({'admin', 'editor'}):
                return
            with connect() as c:
                rows = c.execute('SELECT id,actor,time,action,summary FROM audit ORDER BY id DESC LIMIT 100').fetchall()
                return self.reply({'entries': [dict(r) for r in rows]})
        self.reply({'error': 'Not found'}, 404)

    def do_POST(self):
        if not self.guard_host():
            return
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        if origin and origin.lower() not in {'http://' + host.lower(), 'https://' + host.lower()}:
            return self.reply({'error': '不允许跨域写入'}, 403)
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.reply({'error': '不允许跨站写入'}, 403)
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 5000000:
                raise ValueError('数据大小无效')
            data = json.loads(self.rfile.read(size), parse_constant=lambda _: (_ for _ in ()).throw(ValueError('数据不能包含非有限数字')))
            if not isinstance(data, dict):
                raise ValueError('请求格式无效')
            if self.path == '/api/setup':
                return self.setup_admin(data)
            if self.path == '/api/login':
                return self.login(data)
            user = self.require_user(csrf=True)
            if not user:
                return
            if self.path == '/api/logout':
                with connect() as c:
                    c.execute('DELETE FROM sessions WHERE token_hash=?', (user['token_hash'],))
                return self.reply({'ok': True}, cookie=f'{COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
            if self.path == '/api/password':
                return self.change_password(data, user)
            if self.path == '/api/state':
                return self.save_state(data, user)
            if self.path == '/api/users':
                return self.create_user(data, user)
            match = re.fullmatch(r'/api/users/(\d+)', self.path)
            if match:
                return self.update_user(int(match[1]), data, user)
            return self.reply({'error': 'Not found'}, 404)
        except (ValueError, TypeError, KeyError, OverflowError) as error:
            return self.reply({'error': str(error)}, 400)
        except sqlite3.Error:
            return self.reply({'error': '数据库暂时忙，请稍后重试'}, 503)

    def setup_admin(self, data):
        if not self.is_local():
            return self.reply({'error': '首次管理员请在运行服务的电脑上创建'}, 403)
        username = data.get('username')
        validate_username(username)
        validate_password(data.get('password'))
        display_name = validate_display_name(data.get('display_name', username))
        password_hash = hash_password(data['password'])
        with WRITE_LOCK, connect() as c:
            c.execute('BEGIN IMMEDIATE')
            if c.execute('SELECT 1 FROM users LIMIT 1').fetchone():
                return self.reply({'error': '管理员已创建，请登录'}, 409)
            cursor = c.execute('INSERT INTO users(username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)',
                               (username, display_name, password_hash, 'admin', timestamp()))
            user = {'id': cursor.lastrowid, 'username': username, 'display_name': display_name, 'role': 'admin'}
            audit(c, username, 'setup', '创建首个管理员')
            session, cookie = self.issue_session(c, user)
        return self.session_response(session, cookie)

    def login(self, data):
        username, password = data.get('username'), data.get('password')
        if not isinstance(username, str) or not isinstance(password, str) or len(username) > 80 or len(password) > 256:
            raise ValueError('账号或密码格式无效')
        address, now = self.client_address[0], int(time.time())
        with WRITE_LOCK, connect() as c:
            c.execute('BEGIN IMMEDIATE')
            attempt = c.execute('SELECT * FROM login_attempts WHERE address=?', (address,)).fetchone()
            if attempt and now - attempt['window_started'] < 900 and attempt['failures'] >= 20:
                return self.reply({'error': '登录尝试过多，请 15 分钟后重试'}, 429)
            user = c.execute('SELECT * FROM users WHERE username=? COLLATE NOCASE', (username,)).fetchone()
            valid = verify_password(password, user['password_hash']) if user else verify_password(password, f'pbkdf2_sha256${PASSWORD_ROUNDS}$' + '00' * 16 + '$' + '00' * 32)
            if not user or not valid or user['disabled']:
                start = attempt['window_started'] if attempt and now - attempt['window_started'] < 900 else now
                count = attempt['failures'] + 1 if attempt and start == attempt['window_started'] else 1
                c.execute('INSERT OR REPLACE INTO login_attempts(address,failures,window_started) VALUES(?,?,?)', (address, count, start))
                c.commit()
                return self.reply({'error': '账号或密码不正确'}, 401)
            c.execute('DELETE FROM login_attempts WHERE address=?', (address,))
            session, cookie = self.issue_session(c, user)
            audit(c, user['username'], 'login', '登录工作台')
        return self.session_response(session, cookie)

    def save_state(self, data, user):
        if user['role'] not in {'admin', 'editor'}:
            return self.reply({'error': '只读账号不能修改运营数据'}, 403)
        expected = data.get('_revision')
        if type(expected) is not int or expected < 1:
            return self.reply({'error': '缺少有效的数据版本，请刷新后重试', 'code': 'revision_required'}, 428)
        restore = self.headers.get('X-Restore-Backup') == '1'
        if restore and user['role'] != 'admin':
            return self.reply({'error': '仅管理员可恢复备份'}, 403)
        validate_state(data)
        value = {k: v for k, v in data.items() if k != '_revision'}
        with WRITE_LOCK:
            # Snapshot all tables before an administrator replaces business data.
            # The write lock prevents another request from modifying the database in this window.
            with connect() as check:
                before = current_state(check)
                if before['_revision'] != expected:
                    return self.reply({'error': '其他同事已更新数据，请先合并或刷新', 'code': 'conflict', 'state': before}, 409)
                if not restore and not normal_update_allowed(before, value):
                    return self.reply({'error': '普通保存每次只能修改一条内容或线索；批量替换请由管理员使用恢复备份', 'code': 'bulk_restore_required'}, 403)
            if restore:
                backup_database('before-restore')
            with connect() as c:
                c.execute('BEGIN IMMEDIATE')
                active = c.execute('SELECT role,disabled FROM users WHERE id=?', (user['id'],)).fetchone()
                if not active or active['disabled'] or active['role'] not in {'admin', 'editor'} or (restore and active['role'] != 'admin'):
                    return self.reply({'error': '账号权限已变更，请重新登录'}, 403)
                before = current_state(c)
                if before['_revision'] != expected:
                    return self.reply({'error': '其他同事已更新数据，请先合并或刷新', 'code': 'conflict', 'state': before}, 409)
                c.execute('UPDATE state SET body=?,revision=revision+1 WHERE id=1',
                          (json.dumps(value, ensure_ascii=False, allow_nan=False),))
                audit(c, user['username'], 'restore' if restore else 'state_update', state_summary(before, value))
                result = current_state(c)
        return self.reply({'ok': True, 'state': result})

    def create_user(self, data, actor):
        if actor['role'] != 'admin':
            return self.reply({'error': '仅管理员可以管理成员'}, 403)
        username = data.get('username')
        validate_username(username)
        validate_password(data.get('password'))
        display_name = validate_display_name(data.get('display_name', username))
        role = data.get('role', 'editor')
        if role not in ROLES:
            raise ValueError('角色无效')
        password_hash = hash_password(data['password'])
        with WRITE_LOCK, connect() as c:
            c.execute('BEGIN IMMEDIATE')
            if c.execute('SELECT 1 FROM users WHERE username=? COLLATE NOCASE', (username,)).fetchone():
                return self.reply({'error': '账号已存在'}, 409)
            cursor = c.execute('INSERT INTO users(username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)',
                               (username, display_name, password_hash, role, timestamp()))
            audit(c, actor['username'], 'user_create', f'创建成员 {username}，角色 {role}')
            result = {'id': cursor.lastrowid, 'username': username, 'display_name': display_name, 'role': role}
        return self.reply({'ok': True, 'user': result}, 201)

    def update_user(self, identifier, data, actor):
        if actor['role'] != 'admin':
            return self.reply({'error': '仅管理员可以管理成员'}, 403)
        if 'password' in data and data['password']:
            validate_password(data['password'])
        if 'disabled' in data and not isinstance(data['disabled'], bool):
            raise ValueError('停用状态无效')
        with WRITE_LOCK, connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT * FROM users WHERE id=?', (identifier,)).fetchone()
            if not row:
                return self.reply({'error': '成员不存在'}, 404)
            role = data.get('role', row['role'])
            if role not in ROLES:
                raise ValueError('角色无效')
            display_name = validate_display_name(data.get('display_name', row['display_name']))
            disabled = int(data.get('disabled', bool(row['disabled'])))
            if row['role'] == 'admin' and not row['disabled'] and (role != 'admin' or disabled):
                active_admins = c.execute("SELECT count(*) FROM users WHERE role='admin' AND disabled=0").fetchone()[0]
                if active_admins <= 1:
                    return self.reply({'error': '至少保留一位可登录的管理员'}, 409)
            password_hash = hash_password(data['password']) if data.get('password') else row['password_hash']
            c.execute('UPDATE users SET role=?,display_name=?,disabled=?,password_hash=? WHERE id=?',
                      (role, display_name, disabled, password_hash, identifier))
            if disabled or data.get('password'):
                c.execute('DELETE FROM sessions WHERE user_id=?', (identifier,))
            summary = f"更新成员 {row['username']}，角色 {role}，{'停用' if disabled else '启用'}"
            if data.get('password'):
                summary += '，重设密码'
            audit(c, actor['username'], 'user_update', summary)
        return self.reply({'ok': True})

    def change_password(self, data, user):
        current = data.get('current_password')
        if not isinstance(current, str) or len(current) > 256:
            raise ValueError('请输入当前密码')
        validate_password(data.get('password'))
        with WRITE_LOCK, connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT password_hash FROM users WHERE id=?', (user['id'],)).fetchone()
            if not verify_password(current, row['password_hash']):
                return self.reply({'error': '当前密码不正确'}, 403)
            c.execute('UPDATE users SET password_hash=? WHERE id=?', (hash_password(data['password']), user['id']))
            c.execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', (user['id'], user['token_hash']))
            audit(c, user['username'], 'password_change', '修改自己的登录密码')
        return self.reply({'ok': True})


initialize()


def main():
    parser = argparse.ArgumentParser(description='花地湾运营台：本机或办公室协作模式')
    parser.add_argument('--lan', action='store_true', help='允许同一办公室网络访问')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8765')))
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('端口需要在 1 至 65535 之间')
    host = '0.0.0.0' if args.lan else '127.0.0.1'
    http = ThreadingHTTPServer((host, args.port), Handler)
    print(f'花地湾运营台已启动，本机浏览器输入 127.0.0.1:{args.port}', flush=True)
    if args.lan:
        print('办公室协作模式：同事使用这台电脑的内网 IPv4 地址和上述端口访问。', flush=True)
        print('首次管理员只能在这台电脑本机创建。请仅在可信办公内网使用，不要设置公网端口映射。', flush=True)
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        print('\n服务已停止。已保存的数据仍保留。', flush=True)
    finally:
        http.server_close()


if __name__ == '__main__':
    main()
