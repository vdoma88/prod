// Курсы, к которым общий вход даёт доступ. id — те же, что у бота
// (bot/messages.mjs, COURSES) и в адресах: rod.belayarod.ru и т. д.
//
// internal — адрес курса на этом же сервере для админки: список уроков
// ученицы и смена статуса (README, «Как курс подключается»). Пока курс не
// подключён, админка честно пишет «курс ещё не подключён к общему входу».
export const COURSES = [
  { id: 'rod', title: 'Связь с Родом', url: 'https://rod.belayarod.ru/', internal: 'http://127.0.0.1:5000' },
  { id: 'plamya', title: 'Язык Пламени', url: 'https://plamya.belayarod.ru/', internal: 'http://127.0.0.1:3000' },
  { id: 'taro', title: 'Таро', url: 'https://taro.belayarod.ru/', internal: 'http://127.0.0.1:3100' },
  { id: 'runes', title: 'Руны', url: 'https://runes.belayarod.ru/', internal: 'http://127.0.0.1:4173' },
];

export const courseById = (id) => COURSES.find(c => c.id === id) || null;

// Статусы урока — как во flame (lesson_access.status).
export const LESSON_STATUSES = ['locked', 'open', 'done'];
