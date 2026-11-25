// Ввод даты в формате ДД/ММ/ГГГГ вместо системного поля браузера: то
// показывало «mm/dd/yyyy» по языку браузера, а во всём кабинете даты ДД/ММ.
// Хранится по-прежнему ISO «ГГГГ-ММ-ДД» — анкеты и отчёты не меняются.

/** Цифры → «ДД/ММ/ГГГГ» по мере ввода */
export function maskDMY (raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 8)
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join('/')
}

/** «ДД/ММ/ГГГГ» → «ГГГГ-ММ-ДД»; '' — пусто; null — дата неполная или неверная */
export function dmyToIso (text) {
  const s = String(text || '').trim()
  if (!s) return ''
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd))
  if (d.getUTCFullYear() !== +yyyy || d.getUTCMonth() !== +mm - 1 || d.getUTCDate() !== +dd) return null
  if (+yyyy < 1850 || +yyyy > 2100) return null
  return `${yyyy}-${mm}-${dd}`
}

/** «ГГГГ-ММ-ДД…» → «ДД/ММ/ГГГГ» */
export function isoToDmy (iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}
