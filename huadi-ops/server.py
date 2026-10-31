import json, sqlite3, os, re
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
ROOT=Path(__file__).parent
DB=ROOT/'data'/'operations.sqlite3'
DB.parent.mkdir(exist_ok=True)
def connect():
 c=sqlite3.connect(DB);c.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');return c
def initial():
 topics=[('视频','寻宝记','寻宝记 01｜一件老物，怎么读懂它的年代？'),('视频','寻宝记','寻宝记 02｜百元预算，在花地湾能找到什么？'),('视频','寻宝记','寻宝记 03｜店主舍不得卖的一件收藏'),('视频','寻宝记','寻宝记 04｜同一种器物，为什么价格不同？'),('视频','人物简谈','票证展览林仕荣｜从一张票证讲起'),('图文','空间美学','在花地湾，逛一家让人慢下来的店'),('图文','空间美学','一角一器｜把东方美学藏进日常'),('图文','招商推广','在白鹅潭附近，发现一个适合做文化活动的空间'),('图文','招商推广','一个聚集古玩、文玩、艺术品商户的商业空间'),('图文','器物分享','低调又有质感的文玩配色，真的很适合秋冬'),('图文','器物分享','温润的东方美学，藏在这些玉器里'),('图文','周末地摊','周末来花地湾，带你逛一圈古玩地摊'),('图文','周末地摊','第一次逛古玩地摊，先看这几个细节')]
 dates=[3,10,17,24,30,5,12,7,19,14,21,8,22]
 return {'items':[dict(id=i+1,kind=k,category=c,title=t,date=f'2026-11-{dates[i]:02}',status='待策划',owner='',notes='Excel 已定方向；标题和日期为建议，待确认' if i not in [4,7,8,9,10] else 'Excel 已定选题；日期为建议，待确认',review='',metrics={}) for i,(k,c,t) in enumerate(topics)],'leads':[],'targets':{'views':10000,'leads':10},'version':1}
with connect() as c:
 if not c.execute('SELECT 1 FROM state').fetchone():c.execute('INSERT INTO state VALUES(1,?)',(json.dumps(initial(),ensure_ascii=False),))
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'static'),**kw)
 def reply(self,data,status=200):
  b=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(b)
 def do_GET(self):
  if self.path=='/api/state':
   with connect() as c:self.reply(json.loads(c.execute('SELECT body FROM state WHERE id=1').fetchone()[0]))
  else:super().do_GET()
 def do_POST(self):
  if self.path!='/api/state':return self.reply({'error':'Not found'},404)
  if self.headers.get('Origin') and self.headers['Origin'] not in ['http://'+self.headers.get('Host','')]:return self.reply({'error':'不允许跨域写入'},403)
  try:
   size=int(self.headers.get('Content-Length',0))
   if not 0<size<=5000000:raise ValueError('数据大小无效')
   d=json.loads(self.rfile.read(size))
   if not isinstance(d,dict) or d.get('version')!=1 or not isinstance(d.get('items'),list) or not isinstance(d.get('leads'),list):raise ValueError('备份格式无效')
   ids=set()
   for x in d['items']:
    if not isinstance(x,dict) or not isinstance(x.get('id'),int) or x['id'] in ids or not isinstance(x.get('title'),str) or not isinstance(x.get('metrics'),dict):raise ValueError('内容格式无效或编号重复')
    if any(not isinstance(x.get(k),str) for k in ['kind','category','date','status','owner','notes','review']):raise ValueError('内容字段不完整')
    if x['status'] not in ['待策划','待拍摄','制作中','待发布','已发布','已复盘']:raise ValueError('进度无效')
    ids.add(x['id'])
    for m in x['metrics'].values():
     if not isinstance(m,dict):raise ValueError('指标格式无效')
     for k in ['views','likes','comments','saves','shares','leads']:
      if not isinstance(m.get(k,0),(int,float)) or m.get(k,0)<0:raise ValueError('指标必须是非负数')
   if any(not isinstance(l,dict) or not isinstance(l.get('name'),str) for l in d['leads']):raise ValueError('线索格式无效')
   with connect() as c:c.execute('UPDATE state SET body=? WHERE id=1',(json.dumps(d,ensure_ascii=False),))
   self.reply({'ok':True})
  except (ValueError,TypeError,KeyError) as e:self.reply({'error':str(e)},400)
if __name__=='__main__':
 print('花地湾运营台：本机端口 8765',flush=True)
 ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('PORT','8765'))),Handler).serve_forever()
