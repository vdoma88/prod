const { personalYearOf } = require('./explain')

const reduceToSingle = (n) => {
  let value = n
  while (value > 9 && ![11, 22].includes(value)) {
    value = String(value).split('').reduce((sum, d) => sum + Number(d), 0)
  }
  return value
}

const sumDigits = (n) => String(Math.abs(n)).split('').reduce((s, d) => s + Number(d), 0)

const LETTER_TABLE = {
  а:1,б:2,в:3,г:4,д:5,е:6,ё:7,ж:8,з:9,и:1,й:2,к:3,л:4,м:5,н:6,о:7,п:8,
  р:9,с:1,т:2,у:3,ф:4,х:5,ц:6,ч:7,ш:8,щ:9,ъ:1,ы:2,ь:3,э:4,ю:5,я:6,
  a:1,b:2,c:3,d:4,e:5,f:6,g:7,h:8,i:9,j:1,k:2,l:3,m:4,n:5,o:6,p:7,q:8,r:9,
  s:1,t:2,u:3,v:4,w:5,x:6,y:7,z:8
}

// ── Матрица по методике автора ───────────────────────────────────────────
// Эталон — калькулятор автора на matrix.belayarod.ru (исходник App.tsx).
// Здесь он повторён буквально, и тест test/numerology-reference.test.js
// сверяет результат с расчётами, снятыми с живого сайта. Прежняя версия
// оставляла 4-е число несвёрнутым, если оно 10, 11 или 12, — и примерно для
// 7 % дат матрица и родовая задача расходились с методикой.

/** Сумма цифр за один проход, без сведения к однозначному: 39 → 12. */
const stringSum = (n) => String(n).split('').reduce((s, d) => s + Number(d), 0)
const splitInt = (v) => String(v).split('').map(Number)

/** Ключ текста значения в словаре автора: «111», «10» (нет цифр), больше пяти — остаток. */
function matrixKey (count, digit) {
  if (count === 0) return `${digit}0`
  return String(digit).repeat(count > 5 ? count - 5 : count)
}

function authorMatrix ({ day, month, year }) {
  const numbers = splitInt(`${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${year}`)
  const first = numbers.reduce((a, b) => a + b, 0)
  const second = stringSum(first)
  const third = year >= 2000 ? first + 19 : first - (numbers[0] !== 0 ? numbers[0] : numbers[1]) * 2
  const fourth = stringSum(third)
  const extra = year >= 2000 ? [first, second, 19, third, fourth] : [first, second, third, fourth]
  const fullArray = [...numbers, ...extra.flatMap(splitInt)]

  const counts = {}
  const keys = {}
  for (let i = 1; i <= 9; i++) {
    counts[i] = fullArray.filter(d => d === i).length
    keys[i] = matrixKey(counts[i], i)
  }
  // С 2020 года рождения в клетке 9 добавляется ещё одна девятка. На сайте
  // автора она только дорисована в клетке, а текст значения подбирался без
  // неё; по решению владельца (28.09.2026) текст её тоже учитывает.
  const bonusNine = year >= 2020 ? 1 : 0
  keys[9] = matrixKey(counts[9] + bonusNine, 9)

  return { numbers, first, second, third, fourth, extra, fullArray, counts, keys, bonusNine }
}

function calculateAll({ day, month, year, name }) {
  const m = authorMatrix({ day, month, year })
  const [n1, n2, n3, n4] = [m.first, m.second, m.third, m.fourth]
  const workNums = m.extra
  const allNums = m.fullArray

  // Счёт по клеткам — как видно в сетке, то есть с девяткой 2020+.
  const counts = { ...m.counts }
  counts[9] += m.bonusNine

  // Grid
  const grid = {}
  ;[1,4,7,2,5,8,3,6,9].forEach(i => {
    const digs = allNums.filter(d => d === i)
    if (i === 9) for (let k = 0; k < m.bonusNine; k++) digs.push(9)
    grid[i] = { digit: i, count: counts[i], digits: digs, value: digs.length > 0 ? String(i).repeat(digs.length) : '—', key: m.keys[i] }
  })

  // Rows, columns, diagonals
  const rows = {
    r147: { sum: counts[1]+counts[4]+counts[7], name: 'Цель (1-4-7)', desc: 'Целеустремлённость' },
    r258: { sum: counts[2]+counts[5]+counts[8], name: 'Семья (2-5-8)', desc: 'Семейные ценности' },
    r369: { sum: counts[3]+counts[6]+counts[9], name: 'Стабильность (3-6-9)', desc: 'Привычки и уклад' }
  }
  const cols = {
    c123: { sum: counts[1]+counts[2]+counts[3], name: 'Восприятие себя (1-2-3)', desc: 'Самооценка' },
    c456: { sum: counts[4]+counts[5]+counts[6], name: 'Денежный канал (4-5-6)', desc: 'Финансы' },
    c789: { sum: counts[7]+counts[8]+counts[9], name: 'Таланты (7-8-9)', desc: 'Одарённость' }
  }
  const dias = {
    d159: { sum: counts[1]+counts[5]+counts[9], name: 'Духовность (1-5-9)', desc: 'Духовный потенциал' },
    d357: { sum: counts[3]+counts[5]+counts[7], name: 'Темперамент (3-5-7)', desc: 'Эмоциональность' }
  }
  const pair = { c1: counts[1], c2: counts[2] }

  // Life path
  const pathNum = n1 === 11 || n1 === 22 ? n1 : reduceToSingle(n1)

  // Birth number
  let birthNum = day
  while (birthNum > 9 && ![11, 22].includes(birthNum)) birthNum = sumDigits(birthNum)

  // Financial channel
  const c = sumDigits(year)
  const finTotal = day + month + c
  const fin = reduceToSingle(finTotal)

  // Personal year: день + месяц + год → 1–9 (как личный цикл и прогноз)
  const curYear = new Date().getFullYear()
  const py = personalYearOf(day, month, curYear)

  // FIO calculations
  const nameData = name ? convertName(name) : null
  const planes = nameData ? calcPlanes(nameData.values) : null
  const soulTask = nameData ? reduceToSingle(nameData.values.reduce((s, v) => s + v, 0)) : null

  // Число души — день и месяц рождения, сведённые к однозначному (решение
  // владельца, октябрь 2026: «кроме даты учитывать и число месяца»).
  // Задача Души по методике автора — это другое: 2-е доп. число (tasks.soul).
  const soulNumber = { value: reduceToSingle(day + month), total: day + month }

  // Destiny (from full name)
  const destiny = nameData ? { value: soulTask, fullname: name } : null

  // Chakras
  const dateStr = `${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${String(year)}`
  const chkDigits = dateStr.split('').map(Number)
  const chakraMap = {}
  for (let i = 0; i < 7 && i + 1 < chkDigits.length; i++) {
    chakraMap[i + 1] = { value: chkDigits[i] + chkDigits[i + 1], digits: `${chkDigits[i]}+${chkDigits[i+1]}` }
  }

  return {
    input: { day, month, year, name },
    numbers: { n1, n2, n3, n4, all: workNums },
    // Две задачи по методике: личная задача Души — 2-е число,
    // родовая задача (ЧРП) — 4-е.
    tasks: { soul: n2, rod: n4 },
    matrixKeys: m.keys,
    bonusNine: m.bonusNine,
    grid,
    counts,
    rows,
    cols,
    dias,
    pair,
    pathNum,
    birthNum,
    moneyTotal: finTotal,
    moneyValue: fin,
    personalYear: py,
    chakras: chakraMap,
    // FIO data
    nameData: nameData ? {
      firstName: nameData.firstName,
      fullName: nameData.fullName,
      values: nameData.values,
      planes,
      soulTask,
      clanTask: nameData.clanTask
    } : null,
    soulNumber,
    destiny
  }
}

function convertName(fullName) {
  const clean = String(fullName || '')
  const values = []
  for (const ch of clean.toLowerCase()) {
    const v = LETTER_TABLE[ch]
    if (v !== undefined) values.push(v)
  }
  const firstName = clean.split(' ')[0] || ''
  const firstNameValues = []
  for (const ch of firstName.toLowerCase()) {
    const v = LETTER_TABLE[ch]
    if (v !== undefined) firstNameValues.push(v)
  }
  const clanTask = values.length ? reduceToSingle(values.reduce((s, v) => s + v, 0)) : null
  return { firstName, fullName: clean, values, firstNameValues, clanTask }
}

function calcPlanes(values) {
  let phys = 0, ment = 0, emot = 0, intuit = 0
  values.forEach(v => {
    if (v === 4 || v === 5) phys += v
    if (v === 1 || v === 8) ment += v
    if (v === 2 || v === 3 || v === 6) emot += v
    if (v === 7 || v === 9) intuit += v
  })
  return {
    phys: reduceToSingle(phys) || 0,
    ment: reduceToSingle(ment) || 0,
    emot: reduceToSingle(emot) || 0,
    intuit: reduceToSingle(intuit) || 0
  }
}

module.exports = { calculateAll, authorMatrix, matrixKey, reduceToSingle, sumDigits }
