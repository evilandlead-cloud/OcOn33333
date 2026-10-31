let state,tab='总览',filter='',query='',platform='视频号',editing=null,busy=false;
let currentUser=null,csrfToken='',sessionInfo=null,pendingState=null,modalRevision=null,modalStale=false,modalStateful=true,polling=false,teamUsers=[],auditEntries=[],authEpoch=0;
const roleNames={admin:'管理员',editor:'运营编辑',viewer:'只读查看'};
const canWrite=()=>currentUser&&['admin','editor'].includes(currentUser.role);
const isAdmin=()=>currentUser?.role==='admin';
let ideaCategory='全部',ideaPlatform='全部',ideaKeyword='',ideaShelf='recommended';
const categories=['寻宝记','人物简谈','空间美学','招商推广','器物分享','周末地摊'];
const statuses=['待策划','待拍摄','制作中','待发布','已发布','已复盘'],platforms=['视频号','小红书','抖音'],keys=['views','likes','comments','saves','shares','leads'],names=['播放 / 阅读','点赞','评论','收藏','分享','有效咨询'];
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num=n=>Number(n||0).toLocaleString('zh-CN'),sum=(items,k)=>items.reduce((a,x)=>a+Object.values(x.metrics||{}).reduce((b,m)=>b+Number(m[k]||0),0),0),done=x=>['已发布','已复盘'].includes(x.status);
async function api(path, method='GET', data, headers={}) {
  const options={method,credentials:'same-origin',headers:{...headers}};
  if(data!==undefined){options.body=JSON.stringify(data);options.headers['Content-Type']='application/json'}
  if(method!=='GET' && csrfToken)options.headers['X-CSRF-Token']=csrfToken;
  const response=await fetch(path,options);
  let body;try{body=await response.json()}catch{body={error:'服务响应异常，请检查主机是否仍在运行。'}}
  if(response.status===401 && !['/api/login','/api/setup'].includes(path)) {
    showAuth(sessionInfo||{},'登录已过期，请重新登录。');
  }
  if(!response.ok){const error=new Error(body.error||'请求失败');error.status=response.status;error.body=body;throw error}
  return body;
}
function requireWrite(){if(!canWrite()){alert('当前账号只有查看权限。');return false}return true}
function showConflict(latest) {
  if(latest && (!pendingState || latest._revision>pendingState._revision))pendingState=normalizeState(latest);
  if($('#modal').open && modalStateful){modalStale=true;$('#modalNotice').hidden=false;$('#modalNotice').textContent='同事已更新数据。你的草稿仍保留在表单中，请先复制需要保留的文字，再关闭并重新打开编辑。此次保存不会覆盖同事的内容。';$('#form .modal-actions .primary').disabled=true;}
  $('#collaborationNotice').hidden=false;
  $('#collaborationMessage').textContent='发现同事的新修改。为避免覆盖，请刷新团队数据后再编辑。';
}
async function save(next, options={}) {
  if(!requireWrite())throw Error('只读账号不能修改数据');
  if(busy)throw Error('正在保存，请稍后');
  if($('#modal').open && modalStateful && modalStale)throw Error('请先复制草稿并重新打开编辑');
  next=normalizeState(next);
  next._revision=$('#modal').open&&modalStateful?modalRevision:state._revision;
  busy=true;$('#saveState').textContent='正在保存…';
  try {
    const data=await api('/api/state','POST',next,options.restore?{'X-Restore-Backup':'1'}:{});
    state=normalizeState(data.state);pendingState=null;
    $('#collaborationNotice').hidden=true;$('#saveState').textContent='已保存到团队';render();
  } catch(error) {
    $('#saveState').textContent=error.status===409?'有新版本，待刷新':'保存失败';
    if(error.status===409){showConflict(error.body.state);if(!$('#modal').open)alert('同事刚刚更新了数据，本次修改没有保存。请点击“刷新团队数据”后重试。')}
    else if(error.status!==401)alert(error.message);
    throw error;
  } finally {busy=false}
}
async function refreshWorkspace() {
  if(!currentUser)return;
  if($('#modal').open && !confirm('刷新将关闭当前表单。请先复制需要保留的草稿，确认继续？'))return;
  if($('#modal').open)$('#modal').close();
  try{state=normalizeState(await api('/api/state'));pendingState=null;$('#collaborationNotice').hidden=true;$('#saveState').textContent='已刷新团队数据';render()}catch(error){if(error.status!==401)alert(error.message)}
}
function normalizeState(data) {
  const memory=data.ideaMemory;
  if (!memory || typeof memory!=='object' || Array.isArray(memory)) data.ideaMemory={};
  const m=data.ideaMemory;
  for (const key of ['seen','favorites','batch']) if (!Array.isArray(m[key])) m[key]=[];
  m.seen=m.seen.filter(x=>typeof x==='string');
  for (const key of ['favorites','batch']) m[key]=m[key].filter(x=>x && typeof x.id==='string' && typeof x.title==='string' && Array.isArray(x.shots));
  if (!Number.isSafeInteger(m.generation) || m.generation<0) m.generation=0;
  return data;
}
function go(t) {
  tab=t;filter='';query='';render();
  if (t==='选题灵感' && !state.ideaMemory.generation && !busy && canWrite()) nextTopics();
  if(t==='团队管理'&&isAdmin())loadTeam();
  if(t==='操作记录'&&canWrite())loadAudit();
}

const iconPaths = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m6 0h1m-8 3h1"/>',
  chart: '<path d="M4 4v16h17M8 15v-4m5 4V7m5 8v-6"/>',
  review: '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M9 15l1-4L19 2l3 3-9 9-4 1Z"/>',
  sparkle: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 2v4m-2-2h4"/>',
  store: '<path d="M4 10v10h16V10M3 10l2-7h14l2 7M3 10c0 4 6 4 6 0 0 4 6 4 6 0 0 4 6 4 6 0M9 20v-6h6v6"/>',
  play: '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="m10 9 5 3-5 3V9Z"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1-7.5A8.5 8.5 0 1 1 21 11.5ZM8 11h.01M12 11h.01M16 11h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>'
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.overview}</svg>`;
}
function statusBadge(status) {
  return `<span class="status-badge status-${Math.max(0, statuses.indexOf(status))}"><span aria-hidden="true"></span>${esc(status)}</span>`;
}
function render() {
  if(!currentUser||!state)return;
  const tabs = ['总览', '内容计划', '数据监控', '复盘记录', '选题灵感', '招商线索'];
  const icons = ['overview', 'calendar', 'chart', 'review', 'sparkle', 'store'];
  if(canWrite()){tabs.push('操作记录');icons.push('review')}
  if(isAdmin()){tabs.push('团队管理');icons.push('store')}
  if(!tabs.includes(tab))tab='总览';
  updateIdentity();
  const descriptions = {
    总览: '内容、数据与下一步，一目了然。',
    内容计划: '从一个想法，到一次值得期待的发布。',
    数据监控: '记录真实反馈，发现内容的更多可能。',
    复盘记录: '留下经验，让下一次创作更有方向。',
    选题灵感: '好故事，从一个新的视角开始。',
    招商线索: '让每一次兴趣，都有下一步。',
    团队管理:'五个人，一个共享的内容工作空间。',
    操作记录:'团队的每一次修改，都有迹可循。'
  };
  $('#nav').innerHTML = tabs.map((t, i) => `<button type="button" class="${tab === t ? 'active' : ''}" ${tab === t ? 'aria-current="page"' : ''} onclick="go('${t}')"><span class="nav-icon">${icon(icons[i])}</span><span class="nav-label">${t}</span>${t === '内容计划' ? `<span class="nav-count">${state.items.length}</span>` : ''}</button>`).join('');
  $('#heading').textContent = tab;
  $('#pageDescription').textContent = descriptions[tab];
  $('#view').innerHTML = ({总览: overview, 内容计划: plan, 数据监控: metrics, 复盘记录: reviews, 选题灵感: ideas, 招商线索: leads,团队管理: teamView,操作记录: auditView}[tab])();
}
function card(label, value, note, glyph = 'chart') {
  return `<div class="card"><div class="card-top"><span class="muted">${label}</span><span class="card-icon">${icon(glyph)}</span></div><div class="value">${value}</div><span class="muted">${note}</span></div>`;
}
function overview() {
  const n = state.items.length, p = state.items.filter(done).length;
  const v = sum(state.items, 'views'), l = sum(state.items, 'leads');
  return `<div class="hero">
    <div class="hero-copy"><div class="hero-eyebrow">本月内容计划 <span>·</span> NOVEMBER 2026</div><h2>好内容，<br>让每一次到访发生。</h2><p>寻宝故事、空间美学与人物记忆。<br>把创作、反馈和新的可能，汇聚在这里。</p><div class="hero-actions"><button class="primary" onclick="go('内容计划')">查看内容计划 ${icon('arrow')}</button><button class="text-button" onclick="go('选题灵感')">探索选题灵感 ↗</button></div></div>
    <div class="hero-visual" aria-label="2026 年 11 月"><div class="hero-orbit"><div class="hero-glyph">${icon('calendar')}</div><span class="month-value">11</span><span class="month-label">NOVEMBER 2026</span></div></div>
  </div>
  <div class="cards">${card('内容发布', `${p}<small> / ${n}</small>`, '按内容计数 · 跨平台发布计一条', 'calendar')}${card('播放与阅读', num(v), '各平台累计曝光', 'play')}${card('有效咨询', num(l), '已录入的内容咨询量', 'chat')}${card('已完成复盘', state.items.filter(x => x.status === '已复盘').length, '每一次反馈，都是下一步的起点', 'check')}</div>
  <div class="grid"><section class="panel"><div class="panel-heading"><div><div class="section-kicker">UP NEXT</div><h2>接下来要推进</h2></div><button class="text-button" onclick="go('内容计划')">全部计划 ${icon('arrow')}</button></div>
  ${state.items.filter(x => !done(x)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5).map(x => `<div class="row"><div class="task-date">${esc(x.date.slice(8))}<small>${esc(x.date.slice(5, 7))}月</small></div><div class="task-copy"><p>${esc(x.title)}</p><div class="task-meta">${esc(x.category)}<span>·</span>${esc(x.kind)}${x.owner ? `<span>·</span>${esc(x.owner)}` : ''}</div></div>${canWrite()?`<button class="task-edit" onclick="edit(${x.id})" aria-label="编辑 ${esc(x.title)}">${statusBadge(x.status)}</button>`:statusBadge(x.status)}</div>`).join('') || '<div class="empty">所有内容均已发布，开始下一轮好创作。</div>'}</section>
  <section class="panel"><div class="panel-heading"><div><div class="section-kicker">CONTENT MIX</div><h2>栏目执行进度</h2></div><span class="badge">6 个栏目</span></div>${['寻宝记', '人物简谈', '空间美学', '招商推广', '器物分享', '周末地摊'].map(c => {const a = state.items.filter(x => x.category === c), b = a.filter(done).length; return `<div class="progress-item"><div class="progress-label"><span>${c}</span><span class="progress-count"><strong>${b}</strong> / ${a.length}</span></div><div class="bar progress-track" role="progressbar" aria-label="${c}发布进度" aria-valuemin="0" aria-valuemax="${a.length || 1}" aria-valuenow="${b}"><span style="width:${a.length ? b / a.length * 100 : 0}%"></span></div></div>`}).join('')}</section></div>`;
}
function toolbar() {
  return `<div class="toolbar"><div class="search-wrap"><span class="search-icon">${icon('search')}</span><input aria-label="搜索标题、栏目或负责人" placeholder="搜索标题、栏目或负责人" value="${esc(query)}" oninput="query=this.value;refreshTable()"></div><select aria-label="筛选内容进度" onchange="filter=this.value;refreshTable()"><option value="">所有状态</option>${statuses.map(s => `<option ${filter === s ? 'selected' : ''}>${s}</option>`).join('')}</select><span class="toolbar-count">共 ${state.items.length} 条内容</span></div>`;
}
function filtered(){return state.items.filter(x=>(!filter||x.status===filter)&&`${x.title} ${x.category} ${x.owner}`.includes(query)).sort((a,b)=>a.date.localeCompare(b.date))}
function plan(){return '<div class="note">排期为建议日期，可点击编辑调整；空间美学无法推进时，可按原计划改为寻宝记图文。实际发布时请在各平台数据中登记链接。</div>'+toolbar()+'<div id="table">'+planTable()+'</div>'}
function planTable(){return `<div class="table-wrap"><table><thead><tr><th>排期</th><th>内容与栏目</th><th>形式</th><th>负责人</th><th>进度</th><th>操作</th></tr></thead><tbody>${filtered().map(x=>`<tr><td>${esc(x.date)}</td><td><div class="title">${esc(x.title)}</div><small class="muted">${esc(x.category)}</small></td><td><span class="badge ${x.kind==='视频'?'video':''}">${esc(x.kind)}</span></td><td>${esc(x.owner)||'待分配'}</td><td>${statusBadge(x.status)}</td><td>${canWrite()?`<button onclick="edit(${x.id})">编辑</button> <button onclick="record(${x.id})">录数据</button>`:'只读'}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">没有匹配内容</td></tr>'}</tbody></table></div>`}
function refreshTable(){$('#table').innerHTML=planTable()}
function metrics(){let v=sum(state.items,'views'),eng=['likes','comments','saves','shares'].reduce((a,k)=>a+sum(state.items,k),0);return `<div class="cards">${card('播放 / 阅读',num(v),'未录入的指标不计入')}${card('互动总量',num(eng),'点赞 + 评论 + 收藏 + 分享')}${card('互动率',v?(eng/v*100).toFixed(2)+'%':'—','互动总量 ÷ 播放 / 阅读')}${card('每千次曝光咨询',v?(sum(state.items,'leads')/v*1000).toFixed(2):'—','有效咨询 ÷ 曝光 × 1000')}</div><div class="note">手动录入累计指标，不会自动同步平台。每次更新覆盖当前值并保留快照，可查看 24h / 72h / 7d 变化。不同平台口径不同，请在复盘中解释。</div><div class="toolbar platform-tabs" role="group" aria-label="选择数据平台">${platforms.map(p=>`<button aria-pressed="${p===platform}" class="${p===platform?'primary':''}" onclick="platform='${p}';render()">${p}</button>`).join('')}</div>${platform==='抖音'?douyinGuide():''}<div class="table-wrap"><table><thead><tr><th>内容</th>${names.map(n=>`<th>${n}</th>`).join('')}<th>更新时间</th><th></th></tr></thead><tbody>${state.items.map(x=>{const m=x.metrics[platform]||{};return `<tr><td><div class="title">${esc(x.title)}</div></td>${keys.map(k=>`<td>${m[k]===undefined?'—':num(m[k])}</td>`).join('')}<td>${m.updated?esc(m.updated.slice(0,16).replace('T',' ')):'未录入'}</td><td>${canWrite()?`<button onclick="record(${x.id})">录入 / 历史</button>`:'只读'}</td></tr>`}).join('')}</tbody></table></div>`}
function reviews(){return `<div class="note">建议每周复盘：目标是否达成 → 数据证据 → 原因假设 → 下次只改一个变量。填写复盘后，可在内容编辑中将状态推进为“已复盘”。</div><div class="recommendations">${state.items.map(x=>`<section class="panel">${statusBadge(x.status)}<h3>${esc(x.title)}</h3><div class="muted">曝光 ${num(sum([x],'views'))} · 有效咨询 ${num(sum([x],'leads'))}</div><p class="review">${esc(x.review)||'尚未复盘。发布后录入数据，再用事实判断选题、开头、封面与转化路径。'}</p>${canWrite()?`<button onclick="review(${x.id})">${x.review?'编辑复盘':'开始复盘'}</button>`:''}</section>`).join('')}</div>`}
function topicOptions(options, value) {
  return options.map(v=>`<option value="${esc(v)}" ${value===v?'selected':''}>${esc(v)}</option>`).join('');
}
function currentTopics() {
  const m=state.ideaMemory;
  if (ideaShelf==='recommended') return m.batch;
  return m.favorites.filter(x=>(ideaCategory==='全部'||x.category===ideaCategory)&&(ideaPlatform==='全部'||x.platform===ideaPlatform)&&(!ideaKeyword||`${x.title} ${x.category} ${x.hook} ${x.shots.join(' ')}`.includes(ideaKeyword)));
}
function searchTopicKeyword(value) {
  ideaKeyword=value;
  if(ideaShelf==='favorites') {
    const grid=$('#view .topic-grid');
    if(grid)grid.innerHTML=currentTopics().map((x,i)=>topicCard(x,i)).join('')||'<section class="panel empty topic-empty">没有匹配的收藏，试试其他关键词。</section>';
  }
}
function ideas() {
  const memory=state.ideaMemory, topics=currentTopics();
  const context=memory.context;
  return `<div class="ideas-heading"><div><div class="section-kicker">CREATIVE STUDIO</div><h2>下一条好内容，从这里开始。</h2><p>每批最多 6 个选题，带着开头、镜头与转化动作出发。</p></div>${canWrite()?`<button class="primary" onclick="nextTopics()">${icon('sparkle')} 换一批</button>`:'<span class="badge">只读查看团队选题</span>'}</div>
  <div class="note">本地策划引擎 · 非实时热榜，无需 API 或密钥。结合栏目表现与不同切入角度推荐；已推荐的方向会去重，推荐库用尽时会提示。收藏与推荐记录会随备份保存。</div>
  <div class="toolbar idea-filters">
    <select aria-label="选题栏目" onchange="ideaCategory=this.value;if(ideaShelf==='favorites')render()">${topicOptions(['全部',...categories],ideaCategory)}</select>
    <select aria-label="选题平台" onchange="ideaPlatform=this.value;if(ideaShelf==='favorites')render()">${topicOptions(['全部',...platforms],ideaPlatform)}</select>
    <div class="search-wrap"><span class="search-icon">${icon('search')}</span><input aria-label="选题关键词" placeholder="关键词，如：玉器、票证、看场" value="${esc(ideaKeyword)}" oninput="searchTopicKeyword(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();if(ideaShelf==='favorites')searchTopicKeyword(this.value);else if(canWrite())nextTopics()}"></div>
    <span class="muted">${ideaShelf==='favorites'?'筛选当前收藏':'筛选条件用于下一批'}</span>
  </div>
  <div class="ideas-navigation"><div class="platform-tabs" role="group" aria-label="选题视图"><button aria-pressed="${ideaShelf==='recommended'}" class="${ideaShelf==='recommended'?'primary':''}" onclick="ideaShelf='recommended';render()">推荐选题</button><button aria-pressed="${ideaShelf==='favorites'}" class="${ideaShelf==='favorites'?'primary':''}" onclick="ideaShelf='favorites';render()">我的收藏 <span class="favorite-count">${memory.favorites.length}</span></button></div><span class="muted">${context&&ideaShelf==='recommended'?`当前批次：${esc(context.category)} · ${esc(context.platform)}${context.keyword?' · '+esc(context.keyword):''} · 还可推荐 ${esc(memory.remaining??'—')} 个方向`:'收藏好想法，合适时再开始。'}</span></div>
  <div class="recommendations topic-grid">${topics.map((x,i)=>topicCard(x,i)).join('')||`<section class="panel empty topic-empty">${ideaShelf==='favorites'?'还没有匹配的收藏。点击选题卡片上的收藏，留住好想法。':'当前条件没有新的推荐。试试其他栏目或关键词，再点“换一批”。'}<br><button class="text-button" onclick="clearTopicFilters()">清空筛选</button></section>`}</div>`;
}
function topicCard(x,index) {
  const favorite=state.ideaMemory.favorites.some(a=>a.id===x.id),planned=state.items.some(a=>a.title===x.title);
  return `<section class="panel topic-card"><div class="topic-top"><span class="eyebrow">${esc(x.category)}</span><span class="badge">${esc(x.platform)} · ${esc(x.kind)}</span></div><h3>${esc(x.title)}</h3><div class="topic-hook"><small>开头这样说</small><p>${esc(x.hook)}</p><small class="topic-format">${esc(x.formatGuidance||'')}</small></div><details class="topic-script"><summary>查看拍摄步骤与转化引导</summary><ol>${x.shots.map(t=>`<li>${esc(t)}</li>`).join('')}</ol><p><b>结尾引导：</b>${esc(x.cta)}</p><p class="muted">${esc(x.verification)}</p></details><p class="topic-reason"><b>推荐依据：</b>${esc(x.reason)}</p><div class="topic-actions">${canWrite()?`<button class="favorite-button ${favorite?'is-favorite':''}" aria-pressed="${favorite}" aria-label="${favorite?'取消收藏':'收藏选题'}：${esc(x.title)}" onclick="toggleTopicFavorite(${index})">${favorite?'★ 已收藏':'☆ 收藏'}</button><button onclick="adoptTopic(${index})" ${planned?'disabled':''}>${planned?'已在计划':'加入计划'}</button>`:'<span class="muted">只读账号 · 可查看拍摄步骤</span>'}</div></section>`;
}
async function nextTopics() {
  if (busy || !requireWrite()) return;
  const next=structuredClone(state),memory=next.ideaMemory;
  const result=TopicEngine.generate({category:ideaCategory,platform:ideaPlatform,keyword:ideaKeyword.trim(),seen:memory.seen,items:next.items,count:6,seed:memory.generation});
  memory.batch=result.topics;
  memory.seen=[...new Set([...memory.seen,...result.topics.map(x=>x.id)])];
  memory.generation+=1;memory.remaining=result.remaining;memory.total=result.total;
  memory.context={category:ideaCategory,platform:ideaPlatform,keyword:ideaKeyword.trim()};
  ideaShelf='recommended';
  try {await save(next)} catch {} // save reports errors and preserves the previous state.
}
function clearTopicFilters() {
  ideaCategory='全部';ideaPlatform='全部';ideaKeyword='';
  if(ideaShelf==='favorites')render();else if(canWrite())nextTopics();
}
async function toggleTopicFavorite(index) {
  if (busy||!requireWrite())return;
  const topic=currentTopics()[index];if(!topic)return;
  const next=structuredClone(state),a=next.ideaMemory.favorites;
  const found=a.findIndex(x=>x.id===topic.id);
  if(found<0)a.push(structuredClone(topic));else a.splice(found,1);
  try {await save(next)} catch {}
}
function adoptTopic(index) {
  if(!requireWrite())return;
  const x=currentTopics()[index];if(!x)return;
  const notes=`平台：${x.platform}\n形式建议：${x.formatGuidance||x.kind}\n开头：${x.hook}\n拍摄步骤：\n${x.shots.map((s,i)=>(i+1)+'. '+s).join('\n')}\n结尾引导：${x.cta}\n核实事项：${x.verification}\n推荐依据：${x.reason}`;
  edit(null,{title:x.title,category:x.category,kind:x.kind,notes});
}
function douyinGuide() {
  return `<details class="integration-guide"><summary><span>${icon('chart')} 抖音 API 接入指引</span><span class="badge">尚未接入</span></summary><div class="integration-body"><p>你目前没有开放平台应用，先完成以下步骤。当前数据仍使用手动录入。</p><ol><li><b>入驻：</b>打开 <a href="https://open.douyin.com/" target="_blank" rel="noopener noreferrer">抖音开放平台 ↗</a>，注册并按应用类型要求完成开发者认证。</li><li><b>创建应用：</b>按真实用途选择应用类型，说明“花地湾古玩城自有账号视频数据分析”，按控制台要求准备应用说明、隐私政策与回调地址。</li><li><b>申请权限：</b>在控制台查找并申请授权用户视频列表、视频数据能力。是否开放、所需资质与审核要求，以控制台为准。</li><li><b>账号授权：</b>审核通过后，通过官方 OAuth 流程让运营账号授权；由本地服务端或正式回调服务保存和刷新令牌，再同步已获授权的视频指标。</li><li><b>绑定内容：</b>将抖音视频 ID 关联本地计划。播放、点赞、评论、分享按实际字段同步；收藏、有效招商咨询无法从其他指标推算，仍需单独记录。</li></ol><p class="muted">普通视频数据权限不等于实时热榜权限。应用密钥和令牌只放在受保护的服务端配置，不要放进网页、聊天或 GitHub。回调能否使用本机地址须以应用类型与审核要求为准。</p><p>详细说明见下载包内 <b>DOUYIN_API.md</b>。申请后提供应用类型和获批的接口名称即可继续配置，无需发送密钥。</p></div></details>`;
}
function leads(){return `<div class="hero"><div><h2>从内容兴趣，到预约看场</h2><p>只记录必要的业务跟进信息。咨询指标用于内容归因，线索档案用于跟进，两者分别统计。</p></div>${canWrite()?'<button class="primary" onclick="lead()">＋ 新增线索</button>':''}</div><div class="table-wrap"><table><thead><tr><th>称呼 / 商户</th><th>来源内容</th><th>意向</th><th>跟进阶段</th><th>下次跟进</th><th>备注</th><th></th></tr></thead><tbody>${state.leads.map((l,i)=>`<tr><td>${esc(l.name)}</td><td>${esc(state.items.find(x=>x.id===Number(l.source))?.title||'其他')}</td><td>${esc(l.need)}</td><td>${esc(l.stage)}</td><td>${esc(l.next)}</td><td>${esc(l.note)}</td><td>${canWrite()?`<button onclick="lead(${i})">跟进</button>`:'只读'}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">还没有线索，收到咨询后建立第一条跟进记录。</td></tr>'}</tbody></table></div>`}
function input(n,t,v='',type='text'){return `<label>${t}<input name="${n}" type="${type}" value="${esc(v)}" ${type==='number'?'min="0" step="1"':''}></label>`}
function select(n,t,opts,v){return `<label>${t}<select name="${n}">${opts.map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`}
function textarea(n,t,v){return `<label>${t}<textarea name="${n}">${esc(v)}</textarea></label>`}
function open(title,fields,submit,options={}) {
  modalStateful=options.stateful!==false;modalStale=false;modalRevision=state?state._revision:null;
  $('#modalNotice').hidden=true;$('#form .modal-actions .primary').disabled=false;
  $('#modalTitle').textContent=title;$('#fields').innerHTML=fields;
  let submitting=false;
  $('#form').onsubmit=async event=>{
    event.preventDefault();if(busy||submitting)return;
    if(modalStale&&modalStateful)return;
    const data=Object.fromEntries(new FormData(event.target));submitting=true;
    $('#form .modal-actions .primary').disabled=true;
    try{await submit(data);$('#modal').close()}catch(error){if(!modalStale)$('#form .modal-actions .primary').disabled=false;}finally{submitting=false}
  };
  $('#modal').showModal();
}
function edit(id,preset={}){if(!requireWrite())return;const x=state.items.find(x=>x.id===id)||{id:Date.now(),title:'',kind:'视频',category:'寻宝记',date:'2026-11-01',status:'待策划',owner:'',notes:'',metrics:{},review:'',...preset};open(id?'编辑内容':'新建内容',input('title','内容标题',x.title)+`<div class="formgrid">${select('kind','内容形式',['视频','图文'],x.kind)}${select('category','栏目',categories,x.category)}${input('date','计划日期',x.date,'date')}${select('status','进度',statuses,x.status)}${input('owner','负责人',x.owner)}</div>`+textarea('notes','拍摄要点 / 依赖 / 备注',x.notes)+(id?'<button type="button" class="danger" onclick="removeItem('+id+')">删除此内容</button>':''),async d=>{if(!d.title.trim()||!d.date)throw alert('请填写标题和日期');if(d.status==='已复盘'&&!x.review)throw alert('请先填写复盘');const next=structuredClone(state);if(id)next.items=next.items.map(a=>a.id===id?{...x,...d}:a);else next.items.push({...x,...d});await save(next)})}
async function removeItem(id){if(!requireWrite()||modalStale)return;if(confirm('删除内容会同时删除其指标和复盘，建议先导出备份。确认删除？')){let n=structuredClone(state);n.items=n.items.filter(x=>x.id!==id);try{await save(n);$('#modal').close()}catch{}}}
function record(id){if(!requireWrite())return;const x=state.items.find(x=>x.id===id),m=x.metrics[platform]||{};open('录入数据 · '+platform,`<div class="note">${esc(x.title)}<br>累计值，非本次增量；未填写指标按 0 保存。更新时间使用北京时间。</div><div class="formgrid">${keys.map((k,i)=>input(k,names[i],m[k]??0,'number')).join('')}</div>`+input('url','发布链接（选填）',m.url||'','url')+`<details><summary>历史快照（${(m.history||[]).length}）</summary>${(m.history||[]).slice().reverse().map(h=>`<p class="muted">${esc(h.updated)} · 曝光 ${num(h.views)} · 咨询 ${num(h.leads)}</p>`).join('')||'暂无历史'}</details>`,async d=>{let n=structuredClone(state),item=n.items.find(a=>a.id===id);const vals=Object.fromEntries(keys.map(k=>[k,Number(d[k])]));if(Object.values(vals).some(v=>!Number.isFinite(v)||v<0))throw alert('请填写非负指标');const updated=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'});item.metrics[platform]={...vals,url:d.url,updated,history:[...(m.history||[]),{...vals,updated}]};await save(n)})}
function review(id){if(!requireWrite())return;const x=state.items.find(x=>x.id===id);open('内容复盘',textarea('review','目标 / 数据证据 / 原因假设 / 下次行动',x.review||'目标：\n数据证据：\n原因假设：\n下次行动（负责人、截止日期）：'),async d=>{let n=structuredClone(state);n.items.find(a=>a.id===id).review=d.review;await save(n)})}
function lead(i){if(!requireWrite())return;const l=state.leads[i]||{name:'',need:'',stage:'新咨询',next:'',note:'',source:''};open('招商线索',input('name','称呼 / 商户',l.name)+`<label>来源内容<select name="source"><option value="">其他 / 未知</option>${state.items.map(x=>`<option value="${x.id}" ${String(l.source)===String(x.id)?'selected':''}>${esc(x.title)}</option>`).join('')}</select></label>`+input('need','需求 / 意向',l.need)+select('stage','阶段',['新咨询','已联系','已预约','已到访','洽谈中','已成交','暂缓'],l.stage)+input('next','下次跟进',l.next,'date')+textarea('note','跟进备注（避免存储敏感个人资料）',l.note),async d=>{if(!d.name.trim())throw alert('请填写称呼');let n=structuredClone(state);if(i===undefined)n.leads.push(d);else n.leads[i]=d;await save(n)})}
function backup(){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.href=u;a.download='花地湾运营备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
$('#restore').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try {
    if(!isAdmin())throw Error('只有管理员可以恢复团队备份。');
    const data=JSON.parse(await file.text());
    if(data.version!==1||!Array.isArray(data.items)||!Array.isArray(data.leads))throw Error('不是有效的运营备份');
    if(confirm('恢复将覆盖所有人的当前运营数据。建议先导出最新备份，确认继续？'))await save(data,{restore:true});
  }catch(error){if(error.status!==409&&error.status!==401)alert('恢复失败：'+error.message)}
  event.target.value='';
};

function updateIdentity() {
  $('#currentIdentity').textContent=`${currentUser.display_name||currentUser.username} · ${roleNames[currentUser.role]||currentUser.role}`;
  $('.new-content').hidden=!canWrite();$('#restoreButton').hidden=!isAdmin();
}
function showAuth(info={},message='') {
  authEpoch++;sessionInfo=info;currentUser=null;csrfToken='';pendingState=null;state=undefined;teamUsers=[];auditEntries=[];
  if($('#modal').open)$('#modal').close();
  document.body.classList.remove('authenticated');$('#authScreen').hidden=false;
  $('#view').replaceChildren();$('#nav').replaceChildren();$('#fields').replaceChildren();$('#form').onsubmit=null;$('#currentIdentity').textContent='';$('#heading').textContent='总览';$('#collaborationNotice').hidden=true;$('#collaborationMessage').textContent='';
  const setup=info.setup_required;
  $('#authTitle').textContent=setup?'创建团队工作空间':'欢迎回到花地湾';
  $('#authDescription').textContent=setup?'先由主机管理员创建第一个账号，再邀请同事。':'使用管理员为你创建的账号登录共享工作台。';
  $('#authForm').hidden=Boolean(setup&&!info.can_setup);
  $('#setupNameLabel').hidden=!setup;
  $('#authName').required=Boolean(setup);
  $('#authPassword').minLength=setup?10:1;
  $('#authPassword').autocomplete=setup?'new-password':'current-password';
  $('#authSubmit').textContent=setup?'创建管理员并进入':'登录工作台';
  $('#authHint').textContent=setup&&!info.can_setup?'请让主机管理员在运行服务的电脑上打开 http://127.0.0.1:8765，完成首次创建。':setup?'密码至少 10 个字符，请自行设定，不使用默认密码。':'同一办公室的成员连接同一个主机地址，共享同一份数据。';
  $('#authMessage').textContent=message;$('#authPassword').value='';
}
async function loadSession() {
  const info=await api('/api/session');sessionInfo=info;
  if(!info.user){showAuth(info);return}
  currentUser=info.user;csrfToken=info.csrf_token;
  state=normalizeState(await api('/api/state'));
  document.body.classList.add('authenticated');$('#authScreen').hidden=true;
  $('#authPassword').value='';$('#authName').value='';
  $('#saveState').textContent='已连接团队工作空间';tab='总览';render();
}
$('#authForm').onsubmit=async event=>{
  event.preventDefault();$('#authSubmit').disabled=true;$('#authMessage').textContent='';
  try{
    const data={username:$('#authUsername').value.trim(),password:$('#authPassword').value};
    if(sessionInfo?.setup_required)data.display_name=$('#authName').value.trim();
    await api(sessionInfo?.setup_required?'/api/setup':'/api/login','POST',data);
    await loadSession();
  }catch(error){$('#authMessage').textContent=error.message}finally{$('#authSubmit').disabled=false}
};
async function logout() {
  if($('#modal').open&&!confirm('退出会关闭当前未保存表单，确认退出？'))return;
  try{await api('/api/logout','POST',{});showAuth({setup_required:false,can_setup:false})}catch(error){if(error.status!==401)alert(error.message)}
}
function changePassword() {
  open('修改我的密码',input('current_password','当前密码','','password')+input('password','新密码（至少 10 个字符）','','password'),async data=>{
    try{await api('/api/password','POST',data);alert('密码已更新，其他设备上的旧会话已退出。')}catch(error){if(error.status!==401)alert(error.message);throw error}
  },{stateful:false});
}
function roleSelect(value) {
  return `<label>角色<select name="role">${Object.entries(roleNames).map(([key,name])=>`<option value="${key}" ${key===value?'selected':''}>${name}</option>`).join('')}</select></label>`;
}
async function loadTeam() {
  try{teamUsers=(await api('/api/users')).users||[];if(tab==='团队管理')render()}catch(error){if(error.status!==401)alert(error.message)}
}
function teamView() {
  return `<div class="team-intro"><div><h2>为同事创建独立账号</h2><p>建议一位管理员、四位运营编辑。只需在同一办公网络中访问主机网址。</p></div><button class="primary" onclick="manageUser()">＋ 新增成员</button></div><div class="table-wrap"><table><thead><tr><th>成员</th><th>登录账号</th><th>角色</th><th>状态</th><th></th></tr></thead><tbody>${teamUsers.map(user=>`<tr><td>${esc(user.display_name)}</td><td>${esc(user.username)}</td><td>${esc(roleNames[user.role]||user.role)}</td><td>${user.disabled?'已停用':'正常'}</td><td><button onclick="manageUser(${user.id})">管理</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">正在读取成员…</td></tr>'}</tbody></table></div><div class="note team-note">管理员可管理账号和恢复备份；运营编辑可维护内容、数据、复盘与选题；只读成员可查看和导出。重置密码后，该成员需要重新登录。</div>`;
}
function manageUser(id) {
  if(!isAdmin())return;
  const user=teamUsers.find(x=>x.id===id);
  const fields=(user?`<p class="muted">登录账号：${esc(user.username)}</p>`:input('username','登录账号'))+input('display_name','成员姓名',user?.display_name||'')+roleSelect(user?.role||'editor')+input('password',user?'重置密码（留空则不修改）':'初始密码（至少 10 个字符）','','password')+(user?`<label>账号状态<select name="disabled"><option value="false" ${!user.disabled?'selected':''}>正常</option><option value="true" ${user.disabled?'selected':''}>停用</option></select></label>`:'');
  open(user?'管理团队成员':'新增团队成员',fields,async data=>{
    if(user&&!data.password)delete data.password;
    if(user)data.disabled=data.disabled==='true';
    try{await api(user?'/api/users/'+user.id:'/api/users','POST',data);await loadTeam()}catch(error){if(error.status!==401)alert(error.message);throw error}
  },{stateful:false});
}
async function loadAudit() {
  try{auditEntries=(await api('/api/audit')).entries||[];if(tab==='操作记录')render()}catch(error){if(error.status!==401)alert(error.message)}
}
function auditTime(value) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?String(value||''):date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
}
function auditView() {
  return `<div class="note">最近 100 条团队操作。日志记录修改人、时间与概述，不包含密码。</div><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>说明</th></tr></thead><tbody>${auditEntries.map(entry=>`<tr><td>${esc(auditTime(entry.time))}</td><td>${esc(entry.actor)}</td><td>${esc(({setup:'初始化团队',login:'登录',logout:'退出登录',state_update:'更新运营数据',restore:'恢复备份',user_create:'新增成员',user_update:'修改成员',password_change:'修改密码'})[entry.action]||entry.action)}</td><td>${esc(entry.summary)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">还没有操作记录</td></tr>'}</tbody></table></div>`;
}
$('#modal').addEventListener('close',()=>{
  modalRevision=null;modalStale=false;$('#modalNotice').hidden=true;$('#fields').replaceChildren();$('#form').onsubmit=null;
  if(currentUser&&pendingState&&(!state||pendingState._revision>state._revision)){
    state=pendingState;pendingState=null;$('#collaborationNotice').hidden=true;$('#saveState').textContent='已加载同事的新修改';render();
  }
});
async function pollWorkspace() {
  if(!currentUser||busy||polling||document.hidden)return;
  polling=true;const epoch=authEpoch;
  try {
    const info=await api('/api/session');
    if(epoch!==authEpoch||!currentUser)return;
    if(!info.user){showAuth(info,'请重新登录。');return}
    const changedRole=currentUser.role!==info.user.role;
    currentUser=info.user;csrfToken=info.csrf_token;
    const latest=normalizeState(await api('/api/state'));
    if(epoch!==authEpoch||!currentUser)return;
    if(!state||latest._revision>state._revision){
      const focused=document.activeElement?.matches('input,textarea,select');
      if($('#modal').open||focused){showConflict(latest)}
      else{state=latest;pendingState=null;$('#saveState').textContent='已同步同事的修改';$('#collaborationNotice').hidden=true;render()}
    }else if(changedRole){render()}
    if(tab==='团队管理'&&isAdmin())await loadTeam();
    if(tab==='操作记录'&&canWrite())await loadAudit();
  }catch(error){if(error.status!==401)$('#saveState').textContent='连接中断，等待主机恢复'}finally{polling=false}
}
loadSession().catch(error=>{$('#authMessage').textContent='连接失败，请确认主机服务仍在运行，再刷新页面。';$('#authScreen').hidden=false});
setInterval(pollWorkspace,12000);
