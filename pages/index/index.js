const store = require('../../utils/records')
Page({
  data: {tab:'today',today:'',date:'',types:['跑步','步行','骑行','力量','瑜伽','其他'],type:'跑步',duration:'',feeling:'适中',feelings:['轻松','适中','挑战'],note:'',records:[],visible:[],stats:{week:[]},todayMinutes:0,showForm:false,editingId:'',storageError:false},
  onShow() { this.refresh() },
  refresh() {
    const today = store.dateKey()
    try {
      const records = store.load().sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt)
      const stats = store.summary(records,today)
      this.setData({records,today,stats,storageError:false,todayMinutes:records.filter(r=>r.date===today).reduce((s,r)=>s+Number(r.duration),0)})
      this.filter()
    } catch(e) { this.setData({storageError:true}); wx.showToast({title:'本地记录读取失败，请重试',icon:'none'}) }
  },
  filter() { this.setData({visible:this.data.tab==='today'?this.data.records.filter(r=>r.date===this.data.today):this.data.records}) },
  switchTab(e) { this.setData({tab:e.currentTarget.dataset.tab}); this.filter() },
  openForm() { if(this.data.storageError) { wx.showToast({title:'请先重试读取记录',icon:'none'}); return } this.setData({showForm:true,editingId:'',date:this.data.today,type:'跑步',duration:'',feeling:'适中',note:''}) },
  closeForm() { this.setData({showForm:false}) },
  noop() {},
  input(e) { this.setData({[e.currentTarget.dataset.field]:e.detail.value}) },
  choose(e) { this.setData({[e.currentTarget.dataset.field]:e.currentTarget.dataset.value}) },
  edit(e) { const r=this.data.records.find(r=>r.id===e.currentTarget.dataset.id); if(r) this.setData({showForm:true,editingId:r.id,date:r.date,type:r.type,duration:String(r.duration),feeling:r.feeling,note:r.note}) },
  submit() {
    const {date,type,duration,feeling,note,editingId} = this.data
    const record = {date,type,duration,feeling,note:note.trim()}
    const error = store.validate(record)
    if(error) { wx.showToast({title:error,icon:'none'}); return }
    try {
      const records=store.load()
      const old=records.find(r=>r.id===editingId)
      const next={...record,duration:Number(duration),id:old?old.id:Date.now()+'-'+Math.random().toString(36).slice(2),createdAt:old?old.createdAt:Date.now()}
      store.save(old?records.map(r=>r.id===old.id?next:r):[next,...records])
      this.setData({showForm:false}); this.refresh(); wx.showToast({title:'记录已保存',icon:'success'})
    } catch(e) { wx.showToast({title:'保存失败，请重试',icon:'none'}) }
  },
  remove(e) {
    const id=e.currentTarget.dataset.id
    wx.showModal({title:'删除这条记录？',content:'删除后无法恢复。',confirmText:'删除',confirmColor:'#ad5147',success:res=>{
      if(!res.confirm) return
      try { store.save(store.load().filter(r=>r.id!==id)); this.refresh() } catch(e) { wx.showToast({title:'删除失败，请重试',icon:'none'}) }
    }})
  }
})
