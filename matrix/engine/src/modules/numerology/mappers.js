const { httpError } = require('../../lib/http-error')

function mapClientToNumerologyInput(client) {
  if (!client?.birthDate) {
    throw httpError('Для расчёта матрицы у клиента должна быть указана дата рождения', 400)
  }

  const date = new Date(client.birthDate)
  const day = date.getUTCDate()
  const month = date.getUTCMonth() + 1
  const year = date.getUTCFullYear()

  if (year < 1900 || year > 2100) {
    throw httpError('Дата рождения вне допустимого диапазона 1900..2100', 400)
  }

  return {
    day,
    month,
    year,
    name: client.fullName || null
  }
}

module.exports = {
  mapClientToNumerologyInput
}
