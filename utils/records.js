const KEY = 'motion-diary-v1'
function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
function validate(record) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return '请选择运动日期'
  const parsed = new Date(record.date + 'T12:00:00')
  if (isNaN(parsed.getTime()) || dateKey(parsed) !== record.date || record.date > dateKey()) return '请选择今天或过去的有效日期'
  const duration = Number(record.duration)
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) return '运动时长需为 1～1440 分钟的整数'
  if (!['跑步','步行','骑行','力量','瑜伽','其他'].includes(record.type)) return '请选择运动类型'
  if (!['轻松','适中','挑战'].includes(record.feeling)) return '请选择运动感受'
  if (typeof record.note !== 'string' || record.note.length > 120) return '备注最多 120 字'
  return ''
}
function load() {
  const records = wx.getStorageSync(KEY)
  if (!records) return []
  if (!Array.isArray(records) || records.some(r => !r || validate(r) || typeof r.id !== 'string')) throw new Error('记录数据异常')
  return records
}
function save(records) { wx.setStorageSync(KEY, records) }
function summary(records, today = dateKey()) {
  const total = records.reduce((sum,r) => sum + Number(r.duration),0)
  const dates = new Set(records.map(r=>r.date))
  let streak = 0
  const cursor = new Date(today + 'T12:00:00')
  if (!dates.has(dateKey(cursor))) cursor.setDate(cursor.getDate()-1)
  while (dates.has(dateKey(cursor))) { streak++; cursor.setDate(cursor.getDate()-1) }
  const week = []
  for (let i=6;i>=0;i--) {
    const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate()-i)
    const key = dateKey(d)
    const minutes = records.filter(r=>r.date===key).reduce((sum,r)=>sum+Number(r.duration),0)
    week.push({date:key,label:['日','一','二','三','四','五','六'][d.getDay()],minutes})
  }
  const max = Math.max(30,...week.map(d=>d.minutes))
  return {total,days:dates.size,streak,count:records.length,week:week.map(d=>({...d,height:d.minutes ? Math.max(5,Math.round(d.minutes/max*100)) : 0})),weekTotal:week.reduce((s,d)=>s+d.minutes,0)}
}
module.exports = {dateKey,validate,load,save,summary}
