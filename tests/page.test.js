const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const template = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
const overlayTag = template.match(/<view\b[^>]*\bclass="overlay"[^>]*>/)[0]
const overlayCondition = overlayTag.match(/wx:if="([^"]+)"/)[1]

function conditionValue(binding, data) {
  assert.match(binding, /^\{\{[\s\S]+\}\}$/, 'wx:if must evaluate data rather than a nonempty literal string')
  return Boolean(vm.runInNewContext(binding.slice(2, -2), {...data}))
}

function createPage() {
  const storage = new Map()
  const wx = {
    getStorageSync: key => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    showToast() {}
  }
  const storeModule = {exports: {}}
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/records.js'), 'utf8'), {module: storeModule, wx})
  let config
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8'), {
    require(name) { assert.equal(name, '../../utils/records'); return storeModule.exports },
    Page(value) { config = value },
    wx
  })
  const page = {...config, data: structuredClone(config.data), setData(patch) { Object.assign(this.data, patch) }}
  page.onShow()
  return page
}

test('conditional rendering uses data bindings throughout the template', () => {
  const guards = [...template.matchAll(/wx:if="([^"]+)"/g)]
  assert.ok(guards.length > 0)
  for (const [, binding] of guards) assert.match(binding, /^\{\{[\s\S]+\}\}$/)
})

test('the form starts hidden, opens, closes and reopens without changing records', () => {
  const page = createPage()
  assert.equal(conditionValue(overlayCondition, page.data), false)
  assert.equal(page.data.types.length, 6)
  assert.equal(page.data.feelings.length, 3)
  page.openForm()
  assert.equal(conditionValue(overlayCondition, page.data), true)
  assert.equal(page.data.date, page.data.today)
  page.closeForm()
  assert.equal(conditionValue(overlayCondition, page.data), false)
  assert.equal(page.data.records.length, 0)
  page.openForm()
  assert.equal(conditionValue(overlayCondition, page.data), true)
})

test('saving a valid workout dismisses the form and updates the daily total', () => {
  const page = createPage()
  page.openForm()
  page.input({currentTarget: {dataset: {field: 'duration'}}, detail: {value: '30'}})
  page.submit()
  assert.equal(conditionValue(overlayCondition, page.data), false)
  assert.equal(page.data.records.length, 1)
  assert.equal(page.data.todayMinutes, 30)
})
