const { httpError } = require('../../lib/http-error')
const { calculateProfile } = require('./numerology.service')

// Данные расчёта живут только в запросе: карточка ученицы и БД не нужны.
function calculatePublicMatrix(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError('Укажите дату рождения')
  }
  const { birthDate, fullName = '' } = body
  if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw httpError('Укажите корректную дату рождения')
  }
  const [year, month, day] = birthDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (year < 1900 || year > 2100 || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw httpError('Укажите существующую дату с 1900 по 2100 год')
  }
  if (typeof fullName !== 'string' || fullName.length > 120) {
    throw httpError('Имя должно содержать не более 120 символов')
  }
  const profile = calculateProfile({ birthDate: date, fullName: fullName.trim() || null })
  // Общий каталог формул и практик нужен куратору, но не открытому результату.
  const { catalog, ...result } = profile
  return result
}

module.exports = { calculatePublicMatrix }
