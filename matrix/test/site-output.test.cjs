const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('собранная страница матрицы и ссылка с курса входят в основной сайт', () => {
  const root = path.join(__dirname, '../..')
  const page = fs.readFileSync(path.join(root, 'site/matrix/index.html'), 'utf8')
  const assets = [...page.matchAll(/(?:src|href)="(\/matrix\/assets\/[^"]+)"/g)].map(m => m[1])
  assert.ok(assets.some(x => x.endsWith('.js')), 'нет скрипта калькулятора')
  assert.ok(assets.some(x => x.endsWith('.css')), 'нет стилей калькулятора')
  for (const asset of assets) {
    const file = path.join(root, 'site', asset)
    assert.ok(fs.existsSync(file), `нет ${asset}`)
    assert.ok(fs.statSync(file).size > 0, `пустой ${asset}`)
  }
  assert.match(page, /href="\/brand\/fonts\.css"/)
  assert.match(page, /href="\/touch-icon\.png"/)
  assert.doesNotMatch(page, /\son[a-z]+="|\sstyle="/i)
  assert.match(fs.readFileSync(path.join(root, 'site/therapy.html'), 'utf8'), /href="\/matrix\/"/)
})
