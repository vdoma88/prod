// Курсы, к которым общий вход даёт доступ. id — те же, что у бота
// (bot/messages.mjs, COURSES) и в адресах: rod.belayarod.ru и т. д.
//
// internal — адрес курса на этом же сервере для админки: список уроков
// ученицы и смена статуса (README, «Подключение курса»).
//
// staff — где у курса кабинет куратора: туда карточка курса ведёт куратора и
// администратора (ученицу — на url).
//
// sso: false — у курса свой вход, общий вход им не управляет: доступ туда
// здесь не выдаётся, уроки не показываются, в «Моих курсах» — просто ссылка.
// Так сейчас у «Языка Пламени»: там занимаются ученицы со своими учётками.
export const COURSES = [
  { id: 'rod', title: 'Связь с Родом', url: 'https://rod.belayarod.ru/', staff: '/admin', internal: 'http://127.0.0.1:5000', sso: true },
  { id: 'plamya', title: 'Язык Пламени', url: 'https://plamya.belayarod.ru/', internal: 'http://127.0.0.1:3000', sso: false },
  { id: 'taro', title: 'Таро', url: 'https://taro.belayarod.ru/', staff: '/cabinet.html', internal: 'http://127.0.0.1:3100', sso: true },
  { id: 'runes', title: 'Руны', url: 'https://runes.belayarod.ru/', staff: '/#curator', internal: 'http://127.0.0.1:4173', sso: true },
];

/** Курсы, доступом к которым управляет общий вход. */
export const SSO_COURSES = COURSES.filter(c => c.sso);

/** Курс под общим входом по id; курс со своим входом — null. */
export const courseById = (id) => SSO_COURSES.find(c => c.id === id) || null;

// Статусы урока — как во flame (lesson_access.status).
export const LESSON_STATUSES = ['locked', 'open', 'done'];
