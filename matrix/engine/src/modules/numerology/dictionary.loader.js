// Для отдельной страницы достаточно словаря чисел; кабинетные каталоги не нужны.
const numberMeanings = require('./data/number_meanings.json')
function getDictionaries() { return { formulas: [], numberMeanings, practices: [], algorithms: [] } }
module.exports = { getDictionaries }
