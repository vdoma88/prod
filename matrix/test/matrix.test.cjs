const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { calculatePublicMatrix } = require('../engine/src/modules/numerology/public-matrix')

test('отдельный калькулятор совпадает с эталоном Рода для 1170 дат', () => {
  const rows = fs.readFileSync(path.join(__dirname, 'fixtures/matrix-reference.txt'), 'utf8')
    .split('\n').filter(line => line && !line.startsWith('#'))
  assert.ok(rows.length > 1000)
  for (const line of rows) {
    const [birthDate, extra, counts, soul, rod] = line.split('|')
    const result = calculatePublicMatrix({ birthDate })
    assert.equal(result.workingNumbers.all.join('.'), extra, birthDate)
    assert.equal([1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => result.counts[d]).join(''), counts, birthDate)
    assert.equal(String(result.tasks.soul), soul, birthDate)
    assert.equal(String(result.tasks.rod), rod, birthDate)
    assert.ok(result.interpretations.digits[1].text, birthDate)
  }
})

test('нет анкеты и ввода без действительной даты', () => {
  const result = calculatePublicMatrix({ birthDate: '1985-11-29' })
  assert.equal(result.clientId, null)
  assert.equal(result.fio, null)
  assert.equal('catalog' in result, false)
  for (const birthDate of ['2021-02-29', '1900-02-29', '1899-12-31', '2101-01-01', '29/11/1985']) {
    assert.throws(() => calculatePublicMatrix({ birthDate }), /дат/i)
  }
  assert.equal(calculatePublicMatrix({ birthDate: '2000-02-29', fullName: 'Анна' }).fio.fullName, 'Анна')
})
