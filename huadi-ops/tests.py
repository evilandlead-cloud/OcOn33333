"""HTTP smoke test; uses an isolated temporary database and restores no user data."""
import json, tempfile, threading, unittest, urllib.request, urllib.error
from pathlib import Path
import server
class Workflow(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();server.DB=Path(cls.tmp.name)/'test.sqlite3'
  with server.connect() as c:c.execute('INSERT INTO state VALUES(1,?)',(json.dumps(server.initial()),))
  cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
  cls.url='http://127.0.0.1:'+str(cls.http.server_port)
  cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
 @classmethod
 def tearDownClass(cls):cls.http.shutdown();cls.http.server_close();cls.tmp.cleanup()
 def request(self,path='/api/state',data=None,origin=None):
  headers={'Content-Type':'application/json'}
  if origin:headers['Origin']=origin
  req=urllib.request.Request(self.url+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
  return urllib.request.urlopen(req)
 def test_workflow(self):
  with self.request('/') as r:self.assertIn('花地湾'.encode(),r.read())
  with self.request() as r:d=json.load(r)
  self.assertEqual(len(d['items']),13)
  self.assertEqual(sum(x['kind']=='视频' for x in d['items']),5)
  d['items'][0].update(status='已复盘',review='下次改进开头')
  d['items'][0]['metrics']['视频号']={'views':1200,'likes':30,'leads':2,'history':[{'views':1200}]}
  d['leads'].append({'name':'测试商户','source':1,'stage':'已预约'})
  with self.request(data=d) as r:self.assertTrue(json.load(r)['ok'])
  with self.request() as r:self.assertEqual(json.load(r),d)
  with server.connect() as c:self.assertEqual(json.loads(c.execute('SELECT body FROM state').fetchone()[0]),d)
  d['items'][0]['metrics']['视频号']['views']=-1
  with self.assertRaises(urllib.error.HTTPError) as e:self.request(data=d)
  self.assertEqual(e.exception.code,400)
  with self.assertRaises(urllib.error.HTTPError) as e:self.request(data={'items':[],'leads':[]},origin='http://other.example')
  self.assertEqual(e.exception.code,403)
if __name__=='__main__':unittest.main()
