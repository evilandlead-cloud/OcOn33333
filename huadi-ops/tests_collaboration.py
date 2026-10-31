"""Office collaboration integration tests, using temporary databases only."""
import concurrent.futures
import copy
import http.cookiejar
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

# Import initialization must never touch an operator's real data directory.
_import_dir = tempfile.TemporaryDirectory(prefix='huadi-test-import-')
_previous_dir = os.environ.get('HUADI_DATA_DIR')
os.environ['HUADI_DATA_DIR'] = _import_dir.name
import server
if _previous_dir is None:
    os.environ.pop('HUADI_DATA_DIR', None)
else:
    os.environ['HUADI_DATA_DIR'] = _previous_dir


class Client:
    def __init__(self, url):
        self.url = url
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.cookies))
        self.csrf = None

    def call(self, path='/api/state', data=None, headers=None):
        h = {'Content-Type': 'application/json'}
        if self.csrf:
            h['X-CSRF-Token'] = self.csrf
        if headers:
            h.update(headers)
        request = urllib.request.Request(self.url + path, data=None if data is None else json.dumps(data).encode(), headers=h)
        try:
            response = self.opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = response.read()
            try:
                result = json.loads(payload)
            except ValueError:
                result = payload.decode()
            return response.code, result

    def setup(self):
        status, result = self.call('/api/setup', {'username': 'manager', 'display_name': '主理人', 'password': 'test-admin-password'})
        if status == 200:
            self.csrf = result['csrf_token']
        return status, result

    def login(self, username='manager', password='test-admin-password'):
        status, result = self.call('/api/login', {'username': username, 'password': password})
        if status == 200:
            self.csrf = result['csrf_token']
        return status, result


class CollaborationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='huadi-office-test-')
        server.DB = Path(self.tmp.name) / 'operations.sqlite3'
        server.initialize()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.http.server_port)
        self.admin = Client(self.url)

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.tmp.cleanup()

    def add_member(self, username='operator', role='editor'):
        self.assertEqual(self.admin.setup()[0], 200)
        status, result = self.admin.call('/api/users', {'username': username, 'display_name': '同事', 'role': role, 'password': 'test-member-password'})
        self.assertEqual(status, 201)
        member = Client(self.url)
        self.assertEqual(member.login(username, 'test-member-password')[0], 200)
        return member, result['user']

    def test_public_static_and_authenticated_data(self):
        status, text = self.admin.call('/')
        self.assertEqual(status, 200)
        self.assertIn('花地湾', text)
        self.assertEqual(self.admin.call()[0], 401)
        status, session = self.admin.call('/api/session')
        self.assertEqual(status, 200)
        self.assertTrue(session['setup_required'])
        self.assertTrue(session['can_setup'])
        self.assertEqual(self.admin.setup()[0], 200)
        status, data = self.admin.call()
        self.assertEqual(status, 200)
        self.assertEqual(len(data['items']), 13)
        self.assertEqual(sum(x['kind'] == '视频' for x in data['items']), 5)
        self.assertEqual(data['_revision'], 1)
        self.assertEqual(Client(self.url).setup()[0], 409)

    def test_setup_only_local_and_host_origin_checks(self):
        with patch.object(server.Handler, 'is_local', return_value=False):
            self.assertFalse(self.admin.call('/api/session')[1]['can_setup'])
            self.assertEqual(self.admin.setup()[0], 403)
        self.assertEqual(self.admin.call('/api/session', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.admin.call('/api/setup', {'username': 'manager', 'password': 'long-password'}, headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertTrue(server.allowed_host('192.168.1.8:8765'))
        self.assertTrue(server.allowed_host('[::1]:8765'))
        self.assertFalse(server.allowed_host('8.8.8.8:8765'))
        self.assertFalse(server.allowed_host('127.0.0.1.evil.example'))

    def test_csrf_roles_and_state_validation(self):
        viewer, _ = self.add_member('reader', 'viewer')
        state = self.admin.call()[1]
        missing = dict(state)
        missing.pop('_revision')
        self.assertEqual(self.admin.call(data=missing)[0], 428)
        self.assertEqual(self.admin.call(data=state, headers={'X-CSRF-Token': 'wrong'})[0], 403)
        self.assertEqual(viewer.call()[0], 200)
        self.assertEqual(viewer.call(data=state)[0], 403)
        self.assertEqual(viewer.call('/api/users')[0], 403)
        self.assertEqual(viewer.call('/api/audit')[0], 403)
        state['items'][0]['metrics']['抖音'] = {'views': -1}
        self.assertEqual(self.admin.call(data=state)[0], 400)
        state['items'][0]['metrics']['抖音']['views'] = float('nan')
        self.assertEqual(self.admin.call(data=state)[0], 400)
        state['items'][0]['metrics']['抖音']['views'] = 10
        state['items'][0]['metrics']['抖音']['history'] = [{'views': float('inf')}]
        self.assertEqual(self.admin.call(data=state)[0], 400)

    def test_two_sessions_atomically_reject_stale_write(self):
        editor, _ = self.add_member()
        first = self.admin.call()[1]
        second = editor.call()[1]
        first['items'][0]['review'] = '管理员复盘'
        second['items'][1]['review'] = '同事复盘'
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda pair: pair[0].call(data=pair[1]), [(self.admin, first), (editor, second)]))
        self.assertEqual(sorted(code for code, _ in results), [200, 409])
        failed = next(body for code, body in results if code == 409)
        self.assertEqual(failed['code'], 'conflict')
        self.assertEqual(failed['state']['_revision'], 2)
        saved = self.admin.call()[1]
        changed = bool(saved['items'][0]['review']) + bool(saved['items'][1]['review'])
        self.assertEqual(changed, 1)
        # Explicitly reapply the colleague's intended change to the returned revision.
        saved['items'][2]['review'] = '刷新后保留双方数据'
        status, result = editor.call(data=saved)
        self.assertEqual(status, 200)
        self.assertEqual(result['state']['_revision'], 3)

    def test_state_and_restore_preserve_accounts_and_audit(self):
        editor, _ = self.add_member()
        original = self.admin.call()[1]
        next_state = copy.deepcopy(original)
        next_state['items'][0]['review'] = '保存测试'
        self.assertEqual(self.admin.call(data=next_state)[0], 200)
        next_state = self.admin.call()[1]
        next_state['leads'].append({'name': '测试商户', 'stage': '已预约'})
        self.assertEqual(self.admin.call(data=next_state)[0], 200)
        original['_revision'] = 3
        self.assertEqual(editor.call(data=original, headers={'X-Restore-Backup': '1'})[0], 403)
        status, restored = self.admin.call(data=original, headers={'X-Restore-Backup': '1'})
        self.assertEqual(status, 200)
        self.assertEqual(restored['state']['items'][0]['review'], '')
        self.assertEqual(restored['state']['_revision'], 4)
        self.assertEqual(len(self.admin.call('/api/users')[1]['users']), 2)
        files = list((server.DB.parent / 'backups').glob('*before-restore.sqlite3'))
        self.assertEqual(len(files), 1)
        with sqlite3.connect(files[0]) as c:
            before = json.loads(c.execute('SELECT body FROM state').fetchone()[0])
            self.assertEqual(before['items'][0]['review'], '保存测试')
        entries = self.admin.call('/api/audit')[1]['entries']
        self.assertIn('restore', [x['action'] for x in entries])
        self.assertIn('state_update', [x['action'] for x in entries])
        self.assertNotIn('test-admin-password', json.dumps(entries))
        self.assertNotIn('test-member-password', json.dumps(entries))

    def test_normal_writes_reject_bulk_restore_even_without_header(self):
        editor, _ = self.add_member()
        state = self.admin.call()[1]
        bulk = copy.deepcopy(state)
        bulk['items'] = []
        for client in [self.admin, editor]:
            status, result = client.call(data=bulk)
            self.assertEqual(status, 403)
            self.assertEqual(result['code'], 'bulk_restore_required')
        targets = copy.deepcopy(state)
        targets['targets'] = {'views': 999999}
        self.assertEqual(self.admin.call(data=targets)[0], 403)
        state['items'][0]['metrics']['抖音'] = {'views': 100, 'likes': 8}
        state['ideaMemory'] = {'seen': [], 'favorites': [], 'batch': [], 'generation': 0}
        status, result = editor.call(data=state)
        self.assertEqual(status, 200)
        state = result['state']
        state['items'][0]['review'] = '正常单条复盘'
        status, result = editor.call(data=state)
        self.assertEqual(status, 200)
        state = result['state']
        state['ideaMemory'] = {'seen': ['hdw-1-1-1'], 'favorites': [{'id': 'topic-test'}], 'batch': [], 'generation': 1}
        status, result = editor.call(data=state)
        self.assertEqual(status, 200)
        self.assertEqual(result['state']['ideaMemory']['generation'], 1)
        self.assertEqual(list((server.DB.parent / 'backups').glob('*before-restore.sqlite3')), [])

    def test_user_management_password_sessions_and_last_admin(self):
        member, user = self.add_member()
        admin_id = self.admin.call('/api/session')[1]['user']['id']
        self.assertEqual(self.admin.call(f'/api/users/{admin_id}', {'role': 'editor'})[0], 409)
        self.assertEqual(self.admin.call(f'/api/users/{admin_id}', {'disabled': True})[0], 409)
        self.assertEqual(member.call('/api/users', {'username': 'outsider', 'password': 'other-long-password'})[0], 403)
        self.assertEqual(self.admin.call(f"/api/users/{user['id']}", {'password': 'new-member-password'})[0], 200)
        self.assertEqual(member.call()[0], 401)
        self.assertEqual(member.login('operator', 'test-member-password')[0], 401)
        self.assertEqual(member.login('operator', 'new-member-password')[0], 200)
        second = Client(self.url)
        self.assertEqual(second.login('operator', 'new-member-password')[0], 200)
        self.assertEqual(member.call('/api/password', {'current_password': 'new-member-password', 'password': 'personal-new-password'})[0], 200)
        self.assertEqual(member.call()[0], 200)
        self.assertEqual(second.call()[0], 401)
        self.assertEqual(self.admin.call(f"/api/users/{user['id']}", {'disabled': True})[0], 200)
        self.assertEqual(member.call()[0], 401)
        self.assertEqual(member.login('operator', 'personal-new-password')[0], 401)

    def test_session_tokens_hashed_and_logout(self):
        self.admin.setup()
        token = next(cookie.value for cookie in self.admin.cookies if cookie.name == server.COOKIE_NAME)
        with server.connect() as c:
            row = c.execute('SELECT token_hash FROM sessions').fetchone()
            self.assertNotEqual(token, row['token_hash'])
            self.assertEqual(len(row['token_hash']), 64)
            password = c.execute('SELECT password_hash FROM users').fetchone()[0]
            self.assertNotIn('test-admin-password', password)
        self.assertEqual(self.admin.call('/api/logout', {})[0], 200)
        self.assertEqual(self.admin.call()[0], 401)

    def test_login_rate_limit(self):
        self.admin.setup()
        # Exercise enforcement after repeated failures, without performing 20 expensive hashes.
        with server.connect() as c:
            c.execute('INSERT INTO login_attempts VALUES(?,?,?)', ('127.0.0.1', 20, int(server.time.time())))
        self.assertEqual(Client(self.url).login()[0], 429)

    def test_legacy_database_migration_keeps_state_and_one_backup(self):
        legacy = Path(self.tmp.name) / 'legacy.sqlite3'
        old = server.initial()
        old['items'][0]['review'] = '用户已有复盘，不能覆盖'
        with sqlite3.connect(legacy) as c:
            c.execute('CREATE TABLE state(id INTEGER PRIMARY KEY,body TEXT NOT NULL)')
            c.execute('INSERT INTO state VALUES(1,?)', (json.dumps(old, ensure_ascii=False),))
        server.DB = legacy
        server.initialize()
        with server.connect() as c:
            migrated = server.current_state(c)
            self.assertEqual(migrated['items'][0]['review'], old['items'][0]['review'])
            self.assertEqual(migrated['_revision'], 1)
        backups = list((legacy.parent / 'backups').glob('*before-collaboration.sqlite3'))
        self.assertEqual(len(backups), 1)
        with sqlite3.connect(backups[0]) as c:
            self.assertNotIn('revision', [r[1] for r in c.execute('PRAGMA table_info(state)')])
            self.assertEqual(json.loads(c.execute('SELECT body FROM state').fetchone()[0]), old)
        server.initialize()
        self.assertEqual(len(list((legacy.parent / 'backups').glob('*before-collaboration.sqlite3'))), 1)


if __name__ == '__main__':
    unittest.main()
