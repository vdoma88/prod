import { useEffect, useState } from 'react'
import { BrandBackdrop, RodSign } from '../components/ui/Brand'
import { dmyToIso, maskDMY } from '../lib/dateInput'
import { MatrixResult } from './admin/client-card/MatrixTab'
import { calculatePublicMatrix } from '../generated/matrix-engine'

export default function MatrixPage() {
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Нумерологическая матрица · Екатерина Белая'
    return () => { document.title = previousTitle }
  }, [])

  const clearResult = () => { setProfile(null); setError('') }
  const calculate = async (e) => {
    e.preventDefault()
    const birthDate = dmyToIso(date)
    if (!birthDate || Number(birthDate.slice(0, 4)) < 1900) {
      setError('Укажите существующую дату рождения с 1900 по 2100 год.')
      return
    }
    setProfile(null)
    setError('')
    setLoading(true)
    try {
      setProfile(calculatePublicMatrix({ birthDate, fullName: name }))
    } catch (err) {
      setError(err.message || 'Не удалось рассчитать матрицу. Попробуйте ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative isolate min-h-screen bg-paper-deep text-ink">
      <BrandBackdrop />
      <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
        <header className="mx-auto mb-8 max-w-2xl text-center">
          <RodSign className="mx-auto mb-4 h-12 w-9 text-gold-700" />
          <a href="/" className="mb-2 inline-block text-xs uppercase tracking-[0.22em] text-gold-700">Екатерина Белая · Сила Рода</a>
          <h1 className="font-display text-4xl leading-tight sm:text-5xl">Нумерологическая матрица</h1>
          <p className="mt-3 text-base leading-relaxed text-ink-muted">Рассчитайте матрицу по дате рождения и познакомьтесь со значением её чисел.</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">Нумерологические толкования — материал для самоанализа. Они не определяют здоровье, способность иметь детей или будущее и не заменяют консультацию специалиста.</p>
        </header>

        <form onSubmit={calculate} className="card mx-auto mb-8 max-w-2xl space-y-5 p-5 sm:p-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="matrix-date" className="label">Дата рождения</label>
              <input id="matrix-date" className="input" type="text" inputMode="numeric" autoComplete="off"
                placeholder="ДД/ММ/ГГГГ" value={date} disabled={loading} required
                aria-describedby="matrix-date-hint" onChange={e => { setDate(maskDMY(e.target.value)); clearResult() }} />
              <p id="matrix-date-hint" className="mt-1.5 text-xs text-ink-muted">Например, 29/11/1985</p>
            </div>
            <div>
              <label htmlFor="matrix-name" className="label">Имя и фамилия <span className="font-normal text-ink-muted">— по желанию</span></label>
              <input id="matrix-name" className="input" type="text" autoComplete="off" maxLength={120}
                placeholder="Для расчёта по имени" value={name} disabled={loading}
                onChange={e => { setName(e.target.value); clearResult() }} />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 sm:w-auto sm:px-8">
            {loading ? 'Рассчитываем…' : 'Рассчитать матрицу'}
          </button>
          <p className="text-xs leading-relaxed text-ink-muted">Расчёт происходит в вашем браузере: дата рождения и имя никуда не отправляются.</p>
        </form>

        {profile && <section aria-label="Результат расчёта"><MatrixResult numerology={profile} numbaseProfile={profile} /></section>}
        <footer className="mt-12 text-center text-xs text-ink-muted">© {new Date().getFullYear()} Екатерина Белая</footer>
      </div>
    </main>
  )
}
