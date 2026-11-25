/**
 * Ошибка с HTTP-статусом.
 *
 * Раньше статус дописывали прямо в объект Error, и в двух местах по-разному:
 * upload.js ставил `err.status`, modules/numerology/mappers.js — `err.statusCode`.
 * Обработчик (middleware/error.js) читает только `status`, а роуты матрицы
 * ловили ошибку сами и читали `statusCode` — работало, но держалось на том,
 * что оба места помнят про своё имя поля. Стоило ошибке из mappers уйти в
 * общий обработчик, и понятное сообщение стало бы 500.
 *
 * Один класс убирает расхождение и делает поле видимым для проверки типов.
 */
class HttpError extends Error {
  /**
   * @param {string} message Текст, который увидит пользователь.
   * @param {number} [status] HTTP-статус ответа.
   */
  constructor (message, status = 400) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * @param {string} message
 * @param {number} [status]
 * @returns {HttpError}
 */
const httpError = (message, status = 400) => new HttpError(message, status)

module.exports = { HttpError, httpError }
