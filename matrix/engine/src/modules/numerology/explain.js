// Всплывающие толкования чисел матрицы и прогноз на два года.
//
// Каждое число в итогах расчёта (клетки, доп. числа, путь, рождение, душа,
// финансовый канал, личный год, строки/столбцы/диагонали, чакры) получает
// запись в items[id]: заголовок, как посчитано и разделы текста. Клиент
// по клику открывает окно с этой записью (MatrixTab.jsx).
//
// Тексты: автора методики — data/author_matrix.json (через enrich), словарь
// чисел — data/number_meanings.json, недостающее (душа, чакры, годы) —
// data/explain.json.

const MEANINGS = require('./data/number_meanings.json')
const EX = require('./data/explain.json')

const digitsSum = (n) => String(Math.abs(n)).split('').reduce((s, d) => s + Number(d), 0)
/** Свести к однозначному, мастер-числа 11 и 22 оставить. */
const reduceMaster = (n) => { let v = n; while (v > 9 && v !== 11 && v !== 22) v = digitsSum(v); return v }
/** Свести строго к 1–9 (для личного года). */
const reduce9 = (n) => { let v = n; while (v > 9) v = digitsSum(v); return v || 9 }

/** Личный год: день + месяц рождения + год, сведённые к 1–9. */
const personalYearOf = (day, month, year) => reduce9(day + month + digitsSum(year))
/** Родологический (12-летний) цикл года — формула прежняя (enrich.js), год сводится с мастер-числами. */
const rodCycleOf = (day, month, year) => ((reduceMaster(digitsSum(year)) + day + month - 1) % 12 + 12) % 12 + 1

const meaningOf = (n) => MEANINGS[String(n)] || MEANINGS[String(reduceMaster(n))] || null

/** Разделы словаря числа: описание + контекст + сильные/слабые стороны. */
function meaningSections (n, context) {
  const m = meaningOf(n)
  if (!m) return []
  const out = []
  if (context && m.interpretation?.[context]) out.push({ h: m.title, text: m.interpretation[context] })
  else out.push({ h: m.title, text: m.description })
  if (context && m.interpretation?.[context]) out.push({ h: 'О числе', text: m.description })
  if (m.positive?.length) out.push({ h: 'Сильные стороны', list: m.positive })
  if (m.negative?.length) out.push({ h: 'Над чем работать', list: m.negative })
  if (context === 'financial' && m.professions?.length) out.push({ h: 'Подходящие сферы', list: m.professions })
  return out
}

function yearForecast (day, month, year) {
  const py = personalYearOf(day, month, year)
  const rc = rodCycleOf(day, month, year)
  const p = EX.personalYear[py] || {}
  return {
    year,
    personal: { number: py, title: p.title || '', essence: p.essence || '', do: p.do || [], avoid: p.avoid || [] },
    rod: { number: rc, text: EX.genealogicalCycle[rc] || '' }
  }
}

/**
 * @param {any} result итог calculateForClient
 * @param {any} interp enrich(result).interpretations
 * @param {Date} [now]
 */
function explain (result, interp, now = new Date()) {
  const { day, month } = result.input || {}
  const year = now.getFullYear()
  const items = {}
  const add = (id, item) => { items[id] = item }

  // Клетки матрицы — тексты автора
  for (let d = 1; d <= 9; d++) {
    const dm = interp?.digits?.[d] || {}
    const count = result.counts?.[d] || 0
    add(`cell-${d}`, {
      title: `Цифра ${d} в матрице`,
      value: count ? String(d).repeat(count) : `нет ${d}`,
      formula: `Сколько раз цифра ${d} встречается в дате рождения и доп. числах`,
      sections: [
        dm.intro && { h: `Что означает цифра ${d}`, text: dm.intro },
        { h: `Значение «${dm.key || '—'}»`, text: dm.text || 'У автора методики нет текста для этого сочетания.' }
      ].filter(Boolean)
    })
  }

  // Доп. числа
  const wn = result.workingNumbers || {}
  const nItem = (k, n, extra) => n !== undefined && n !== null && add(k, {
    title: { n1: '1-е доп. число', n2: '2-е доп. число — задача Души', n3: '3-е доп. число', n4: '4-е доп. число — ЧРП' }[k],
    value: n,
    formula: EX.roles[k],
    sections: extra
  })
  nItem('n1', wn.n1, meaningSections(reduceMaster(wn.n1 || 0)))
  nItem('n2', wn.n2, [{ h: 'Личная задача Души (текст автора)', text: interp?.soulTask?.text || 'У автора нет текста для этого числа.' }])
  nItem('n3', wn.n3, meaningSections(reduceMaster(wn.n3 || 0)))
  nItem('n4', wn.n4, [{ h: 'Родовая задача (текст автора)', text: interp?.rodTask?.text || 'У автора нет текста для этого числа.' }])

  // Основные числа
  if (result.pathNumber) add('path', { title: 'Число пути', value: result.pathNumber, formula: EX.roles.path, sections: meaningSections(result.pathNumber, 'life_path') })
  if (result.birthNumber) add('birth', { title: 'Число рождения', value: result.birthNumber, formula: `${EX.roles.birth} Расчёт: ${day} → ${result.birthNumber}.`, sections: meaningSections(result.birthNumber, 'birth_number') })
  const soul = result.soulNumber?.value
  if (soul) {
    add('soul', {
      title: 'Число души',
      value: soul,
      formula: `${EX.roles.soul} Расчёт: ${day} + ${month} = ${day + month} → ${soul}.`,
      sections: [{ h: 'Чего хочет душа', text: EX.soul[soul] || '' }, ...meaningSections(soul).slice(0, 1).map(s => ({ ...s, h: `О числе ${soul}` }))]
    })
  }
  if (result.moneyChannel?.value) {
    add('money', {
      title: 'Финансовый канал',
      value: result.moneyChannel.value,
      formula: `${EX.roles.money} Сумма: ${result.moneyChannel.total}.`,
      sections: [...meaningSections(result.moneyChannel.value, 'financial'), interp?.moneyChannel?.full && { h: 'Денежный канал в матрице (4-5-6)', text: interp.moneyChannel.full }].filter(Boolean)
    })
  }

  // Прогноз: этот и следующий год
  const forecast = [yearForecast(day, month, year), yearForecast(day, month, year + 1)]
  for (const f of forecast) {
    add(`year-${f.year}`, {
      title: `Личный год на ${f.year}`,
      value: f.personal.number,
      formula: `${EX.roles.year} Расчёт: ${day} + ${month} + ${f.year} → ${f.personal.number}.`,
      sections: [
        { h: f.personal.title, text: f.personal.essence },
        { h: 'Что делать', list: f.personal.do },
        { h: 'Чего избегать', list: f.personal.avoid }
      ]
    })
    add(`rodcycle-${f.year}`, { title: `Родологический цикл на ${f.year}`, value: f.rod.number, formula: EX.roles.rodCycle, sections: [{ h: `Цикл ${f.rod.number}`, text: f.rod.text }] })
  }

  // Строки, столбцы, диагонали
  for (const [group, label] of [['rows', 'Строка'], ['columns', 'Столбец'], ['diagonals', 'Диагональ']]) {
    for (const [k, v] of Object.entries(interp?.[group] || {})) {
      add(`${group}-${k}`, { title: `${label}: ${v.name}`, value: v.sum, formula: `${v.desc}. Число — сколько всего цифр в этих клетках.`, sections: [{ h: 'Что показывает', text: v.level || '' }] })
    }
  }

  // Чакры: окно по клику и подробный анализ для отчёта
  const chakras = []
  for (const [k, ch] of Object.entries(result.chakras || {})) {
    const c = EX.chakras[k]
    if (!c) continue
    const v = Number(ch.value)
    const level = chakraLevel(v)
    const levelName = { low: 'Мало энергии', norm: 'В норме', high: 'Избыток' }[level]
    chakras.push({ n: Number(k), name: c.name, value: ch.value, digits: ch.digits, level, levelName, about: c.about, text: c[level] })
    add(`chakra-${k}`, {
      title: `Чакра ${c.name}`,
      value: ch.value,
      formula: `Сумма соседних цифр даты: ${ch.digits}. До 4 — мало энергии, 5–10 — норма, 11 и больше — избыток.`,
      sections: [{ h: 'За что отвечает', text: c.about }, { h: levelName, text: c[level] }]
    })
  }

  return { items, forecast, chakras, summary: summarize(result, interp, chakras, forecast) }
}

const chakraLevel = (v) => v <= 4 ? 'low' : v <= 10 ? 'norm' : 'high'

/** «… Рекомендации: X» → «X»; иначе весь текст. */
const advice = (text) => { const m = /Рекомендации:\s*(.+)$/.exec(String(text || '')); return (m ? m[1] : String(text || '')).trim() }
/** Текст без значков уровня (⚠ ✅ 🔶 …) и «N цифр:»; длинный — по границе предложения. */
const gist = (text, max = 220) => {
  const t = String(text || '').replace(/^[^:]{0,20}цифр[ыа]?:\s*/i, '').replace(/^[\u2600-\u27BF\u{1F300}-\u{1FAFF}\uFE0F\s]+/u, '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const head = t.slice(0, max)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  return end > 40 ? head.slice(0, end + 1) : head.replace(/\s\S*$/, '') + '…'
}
const cap = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1) : t

/**
 * Итог для отчёта: главные задачи, сильные стороны и над чем поработать.
 * Собирается из уже посчитанного: задачи Души и Рода, уровни строк/столбцов/
 * диагоналей, пустые клетки, чакры, родовые программы и самопроклятия, год.
 */
function summarize (result, interp, chakras, forecast) {
  const tasks = []
  if (interp?.soulTask?.number) tasks.push({ title: `Задача Души — ${interp.soulTask.number}`, text: gist(interp.soulTask.text, 260) })
  if (interp?.rodTask?.number) tasks.push({ title: `Родовая задача (ЧРП) — ${interp.rodTask.number}`, text: gist(interp.rodTask.text, 260) })

  const strengths = []
  const work = []
  for (const group of ['rows', 'columns', 'diagonals']) {
    for (const v of Object.values(interp?.[group] || {})) {
      const lvl = String(v.level || '')
      if (lvl.includes('✅')) strengths.push(`${v.name}: ${gist(lvl, 140)}`)
      else if (/⚠|🔴|🔶|🟡|🔷/u.test(lvl)) work.push({ area: v.name, text: gist(lvl, 220) })
    }
  }
  for (const ch of chakras) {
    if (ch.level === 'norm') strengths.push(`Чакра ${ch.name} (${ch.value}) — в норме`)
    else work.push({ area: `Чакра ${ch.name} (${ch.value}) — ${ch.levelName.toLowerCase()}`, text: cap(advice(ch.text)) })
  }
  for (let d = 1; d <= 9; d++) {
    if (!result.counts?.[d]) {
      const t = interp?.digits?.[d]?.text
      if (t) work.push({ area: `Нет цифры ${d}`, text: cap(gist(t, 220)) })
    }
  }
  for (const p of interp?.clanPrograms || []) work.push({ area: `Родовая программа «${p.name}»`, text: gist(p.desc, 220) })
  for (const c of interp?.selfCurses || []) work.push({ area: `Самопроклятие ${c.code}`, text: gist(c.desc, 220) })

  const year = forecast?.[0]
  const focus = year ? `${year.year}: ${year.personal.title.toLowerCase()} (личный год ${year.personal.number}). ${year.personal.do[0] || ''}.` : ''
  return { tasks, strengths, work, focus: focus.replace(/\.\.$/, '.') }
}

module.exports = { explain, personalYearOf, rodCycleOf, reduce9, reduceMaster }
