const pad2 = (n) => String(n).padStart(2, '0')
const valid = (d) => d && !Number.isNaN(new Date(d).getTime())
export const formatDate = (d) => {
  if (!valid(d)) return '—'
  const x = new Date(d)
  return `${pad2(x.getDate())}/${pad2(x.getMonth() + 1)}/${pad2(x.getFullYear() % 100)}`
}
export const formatDateTime = (d) => {
  if (!valid(d)) return '—'
  const x = new Date(d)
  return `${formatDate(x)}, ${pad2(x.getHours())}:${pad2(x.getMinutes())}`
}
export const formatDMY = (day, month, year) => `${pad2(day)}/${pad2(month)}/${pad2(year % 100)}`
