const { getDictionaries } = require('./dictionary.loader')
const { mapClientToNumerologyInput } = require('./mappers')
const { calculateAll } = require('./calculator')
const { enrich } = require('./enrich')
const { explain } = require('./explain')

// v3: матрица и задачи — по калькулятору автора (matrix.belayarod.ru).
const ENGINE_VERSION = 'author-matrix-v3'

function calculateForClient(client) {
  const input = mapClientToNumerologyInput(client)
  const result = calculateAll(input)
  const { formulas, numberMeanings } = getDictionaries()

  return {
    engineVersion: ENGINE_VERSION,
    calculatedAt: new Date().toISOString(),
    input: result.input,
    workingNumbers: result.numbers,
    tasks: result.tasks,
    matrixKeys: result.matrixKeys,
    bonusNine: result.bonusNine,
    grid: result.grid,
    counts: result.counts,
    rows: result.rows,
    columns: result.cols,
    diagonals: result.dias,
    pair: result.pair,
    pathNumber: result.pathNum,
    birthNumber: result.birthNum,
    moneyChannel: { total: result.moneyTotal, value: result.moneyValue },
    personalYear: result.personalYear,
    chakras: result.chakras,
    fio: result.nameData,
    soulNumber: result.soulNumber,
    destiny: result.destiny,
    // NumBase+ extra data
    numbasePlus: {
      engine: ENGINE_VERSION,
      formulas,
      numberMeanings,
      primaryCalculations: {
        grid: result.grid,
        rows: result.rows,
        columns: result.cols,
        diagonals: result.dias,
        counts: result.counts,
        pair: result.pair
      },
      chakraMap: result.chakras,
      matrixPortable: {
        source_digits: result.input.day ? String(result.input.day + result.input.month + result.input.year).split('').map(Number).filter(d => d >= 1 && d <= 9) : [],
        grid: result.grid,
        soul_task: { value: result.tasks.soul, total: result.numbers.n1 },
        chrp: result.numbers.n4
      }
    }
  }
}

// Один профиль для карточки ученицы и открытого калькулятора.
function calculateProfile(client) {
  const result = calculateForClient(client)
  const { formulas = [], practices = [], algorithms = [] } = getDictionaries()
  const enriched = enrich(result)
  const anchors = [
    result.workingNumbers?.n1, result.workingNumbers?.n2,
    result.pathNumber, result.birthNumber, result.moneyChannel?.value
  ].filter(Boolean)

  return {
    clientId: client.id || null,
    engineVersion: result.engineVersion,
    calculatedAt: result.calculatedAt,
    input: result.input,
    workingNumbers: result.workingNumbers,
    tasks: result.tasks,
    matrixKeys: result.matrixKeys,
    bonusNine: result.bonusNine,
    grid: result.grid,
    counts: result.counts,
    rows: result.rows,
    columns: result.columns,
    diagonals: result.diagonals,
    pair: result.pair,
    pathNumber: result.pathNumber,
    birthNumber: result.birthNumber,
    moneyChannel: result.moneyChannel,
    personalYear: result.personalYear,
    chakras: result.chakras,
    fio: result.fio,
    soulNumber: result.soulNumber,
    destiny: result.destiny,
    anchors: Array.from(new Set(anchors)),
    catalog: { formulas, algorithms, practices },
    interpretations: enriched.interpretations,
    explain: explain(result, enriched.interpretations)
  }
}

module.exports = { calculateForClient, calculateProfile, ENGINE_VERSION }
