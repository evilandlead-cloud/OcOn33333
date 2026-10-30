const test = require('node:test')
const assert = require('node:assert/strict')
const {dateKey,validate,summary,load,save} = require('../utils/records')
const sample={id:'1',date:'2026-01-01',type:'跑步',duration:30,feeling:'适中',note:''}
test('validates duration and calendar dates',()=>{
 assert.equal(validate(sample),'')
 for(const duration of [0,-1,1.5,1441,'abc']) assert.ok(validate({...sample,duration}))
 assert.ok(validate({...sample,date:'2026-02-30'}))
 assert.ok(validate({...sample,date:'2999-01-01'}))
})
test('aggregates multiple records, weekly totals and streak across month boundary',()=>{
 const records=[sample,{...sample,id:'2',duration:20},{...sample,id:'3',date:'2025-12-31',duration:10}]
 const s=summary(records,'2026-01-02')
 assert.equal(s.total,60);assert.equal(s.days,2);assert.equal(s.streak,2);assert.equal(s.weekTotal,60)
 assert.equal(s.week.find(d=>d.date==='2026-01-01').minutes,50)
 assert.equal(summary(records,'2026-01-03').streak,0)
 assert.equal(summary([],'2026-01-01').streak,0)
})
test('storage round trip and corrupt-data protection',()=>{
 let data
 global.wx={getStorageSync:()=>data,setStorageSync:(k,v)=>{data=v}}
 assert.deepEqual(load(),[]);save([sample]);assert.deepEqual(load(),[sample])
 data={bad:true};assert.throws(()=>load())
 data=[null];assert.throws(()=>load())
})
test('local date formatting',()=>assert.equal(dateKey(new Date(2026,0,2)),'2026-01-02'))
