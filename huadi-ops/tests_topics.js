// Recommendation contracts: real production briefs, stable IDs and honest exhaustion.
const assert = require('node:assert/strict');
require('./static/topics.js');
const engine = globalThis.TopicEngine;
const seen = [], titles = new Set();
let generation = 0;
while (true) {
  const result = engine.generate({seen, seed:generation++});
  if (!result.topics.length) {assert.equal(result.remaining,0);break}
  for (const topic of result.topics) {
    assert.ok(!seen.includes(topic.id));
    assert.ok(!titles.has(topic.title));
    assert.ok(topic.hook && topic.shots.length >= 3 && topic.cta && topic.verification);
    assert.match(topic.reason,/待验证/);
    seen.push(topic.id);titles.add(topic.title);
  }
  assert.equal(seen.length + result.remaining,engine.size);
}
assert.ok(seen.length >= 180);
for (const platform of engine.platforms) {
  const x=engine.generate({category:'空间美学',platform,keyword:'器物',count:24});
  assert.ok(x.topics.length>0);
  assert.ok(x.topics.every(t=>t.category==='空间美学'&&t.platform===platform));
}
const first=engine.generate({count:1}).topics[0];
assert.ok(!engine.generate({items:[{title:first.title}],count:24}).topics.some(x=>x.title===first.title));
assert.ok(!engine.generate({seen:[first.id],platform:'抖音',count:24}).topics.some(x=>x.id===first.id));
assert.equal(engine.generate({keyword:'完全不匹配的关键词XYZ'}).topics.length,0);
const measured=engine.generate({category:'招商推广',items:[{category:'招商推广',metrics:{抖音:{views:1000,likes:30,leads:2}}}]});
assert.ok(measured.topics.every(t=>t.reason.includes('1000')||t.reason.includes('1,000')));
assert.ok(measured.topics.every(t=>t.reason.includes('2.00')&&t.reason.includes('3.00%')));
console.log(`PASS: ${seen.length} unique production briefs; exhaustion, filters, planned/seen exclusion and data evidence.`);
