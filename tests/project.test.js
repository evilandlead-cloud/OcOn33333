const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('every declared page includes the files required for registration', () => {
  const root = path.resolve(__dirname, '..')
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.ok(app.pages.length > 0)
  for (const page of app.pages) {
    for (const extension of ['js', 'wxml', 'json']) {
      assert.ok(fs.existsSync(path.join(root, `${page}.${extension}`)), `${page}.${extension} is missing`)
    }
    const config = JSON.parse(fs.readFileSync(path.join(root, `${page}.json`), 'utf8'))
    assert.equal(typeof config, 'object')
    assert.ok(config && !Array.isArray(config))
    assert.notEqual(config.component, true, `${page} must register as a page`)
  }
})
