import { createPortal } from 'react-dom'
import Modal from '../../../components/ui/Modal'
import { formatDate, formatDMY } from '../../../lib/utils'

// Компактный отчёт по матрице: всё главное на 1–3 страницах, сохраняется в
// PDF через печать браузера («Сохранить как PDF»). Копия для печати выносится
// порталом в <body>, а #root в печати гаснет — как у схемы рода
// (index.css, .matrix-printable).

const ORDER = [1, 4, 7, 2, 5, 8, 3, 6, 9]
const LEVEL_CLASS = { low: 'bg-amber-400/20 text-amber-800', norm: 'bg-green-600/15 text-green-800', high: 'bg-red-400/15 text-red-800' }

/** Первое предложение (или ~220 знаков) — для компактных строк отчёта. */
function brief (text, max = 220) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const dot = t.search(/[.!?](\s|$)/)
  const cut = dot > 40 && dot < max ? t.slice(0, dot + 1) : t.length > max ? t.slice(0, max).replace(/\s\S*$/, '') + '…' : t
  return cut
}

function ReportBody ({ name, numerology, profile, publicView }) {
  const input = numerology.input || {}
  const counts = numerology.counts || {}
  const ex = profile?.explain || { items: {}, forecast: [] }
  const it = (id) => ex.items?.[id]
  const interp = profile?.interpretations || {}
  const firstText = (item) => brief(item?.sections?.find(s => s.text)?.text)
  const keyNumbers = [
    ['Число пути', 'path'], ['Число рождения', 'birth'], ['Число души', 'soul'], ['Финансовый канал', 'money'],
    ['Задача Души (2-е доп. число)', 'n2'], ['Родовая задача, ЧРП (4-е доп. число)', 'n4']
  ].filter(([, id]) => it(id))

  return (
    <div className="matrix-report space-y-5 text-ink">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-gold-400/40 pb-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gold-700">Связь с Родом · матрица</p>
          <h2 className="font-display text-2xl">{name || 'Ученица'}</h2>
        </div>
        <div className="text-right text-sm text-ink-muted">
          <div>Дата рождения: <b className="text-ink">{input.day ? formatDMY(input.day, input.month, input.year) : '—'}</b></div>
          <div>Отчёт от {formatDate(new Date())}</div>
        </div>
      </header>

      {publicView && <p className="text-sm text-ink-muted">Нумерологические толкования — материал для самоанализа. Они не определяют здоровье, способность иметь детей или будущее и не заменяют консультацию специалиста.</p>}

      <section className="grid gap-4 sm:grid-cols-[auto,1fr]">
        <div>
          <div className="grid w-48 grid-cols-3 gap-1">
            {ORDER.map(n => (
              <div key={n} className="rounded-lg border border-ink/10 bg-ink/[0.03] py-2 text-center font-semibold">
                {counts[n] ? String(n).repeat(counts[n]) : '—'}
              </div>
            ))}
          </div>
          {numerology.workingNumbers?.all?.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">Доп. числа: <b className="font-mono text-gold-700">{numerology.workingNumbers.all.join('.')}</b></p>
          )}
        </div>
        <table className="w-full text-sm">
          <tbody>
            {keyNumbers.map(([label, id]) => (
              <tr key={id} className="border-b border-ink/[0.06] align-top">
                <td className="py-1 pr-2 text-ink-muted">{label}</td>
                <td className="py-1 pr-2 text-lg font-bold text-gold-700">{it(id).value}</td>
                <td className="py-1 text-ink-soft">{firstText(it(id))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {ex.forecast?.length > 0 && (
        <section className="report-block">
          <h3 className="mb-2 font-display text-lg">Прогноз и рекомендации</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {ex.forecast.map(f => (
              <div key={f.year} className="rounded-xl border border-gold-400/30 bg-gold-400/[0.06] p-3 text-sm">
                <p className="font-semibold">{f.year}: личный год {f.personal.number} — {f.personal.title}</p>
                <p className="mt-1 text-ink-soft">{f.personal.essence}</p>
                <p className="mt-2 font-semibold text-green-800">Делать</p>
                <ul className="list-disc pl-5 text-ink-soft">{f.personal.do.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <p className="mt-1 font-semibold text-red-800">Избегать</p>
                <ul className="list-disc pl-5 text-ink-soft">{f.personal.avoid.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <p className="mt-2 text-ink-muted"><b>Родовой цикл {f.rod.number}:</b> {f.rod.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="report-block">
        <h3 className="mb-2 font-display text-lg">Сферы жизни</h3>
        <table className="w-full text-sm">
          <tbody>
            {[...Object.values(interp.rows || {}), ...Object.values(interp.columns || {}), ...Object.values(interp.diagonals || {})].map((r, i) => (
              <tr key={i} className="border-b border-ink/[0.06] align-top">
                <td className="py-1 pr-2 text-ink-muted whitespace-nowrap">{r.name}</td>
                <td className="py-1 pr-2 font-bold text-gold-700">{r.sum}</td>
                <td className="py-1 text-ink-soft">{brief(r.level, 180)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {ex.chakras?.length > 0 && (
        <section className="report-block">
          <h3 className="mb-1 font-display text-lg">Чакральный анализ</h3>
          <p className="mb-2 text-xs text-ink-muted">Значение — сумма соседних цифр даты рождения. До 4 — мало энергии, 5–10 — норма, 11 и больше — избыток.</p>
          <div className="space-y-1.5">
            {ex.chakras.map(c => (
              <div key={c.n} className="chakra-row grid grid-cols-[8.5rem,2.5rem,1fr] gap-2 border-b border-ink/[0.06] pb-1.5 text-sm">
                <div>
                  <div className="font-semibold">{c.n}. {c.name}</div>
                  <span className={`mt-0.5 inline-block rounded-full px-2 text-[11px] font-semibold ${LEVEL_CLASS[c.level]}`}>{c.levelName}</span>
                </div>
                <div className="text-lg font-bold text-gold-700">{c.value}</div>
                <div className="text-ink-soft">
                  <span className="text-ink-muted">{c.about}</span> {c.text}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(interp.clanPrograms?.length > 0 || interp.stones?.length > 0) && (
        <section className="report-block grid gap-3 sm:grid-cols-2 text-sm">
          {interp.clanPrograms?.length > 0 && (
            <div>
              <h3 className="mb-1 font-display text-lg">Родовые программы</h3>
              <ul className="list-disc pl-5 text-ink-soft">{interp.clanPrograms.map((p, i) => <li key={i}><b className="text-ink">{p.name}.</b> {brief(p.desc, 140)}</li>)}</ul>
            </div>
          )}
          {interp.stones?.length > 0 && (
            <div>
              <h3 className="mb-1 font-display text-lg">Камни</h3>
              <ul className="list-disc pl-5 text-ink-soft">{interp.stones.map((s, i) => <li key={i}>{brief(s, 120)}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {ex.summary && (
        <section className="report-block rounded-2xl border border-gold-400/40 bg-gold-400/[0.06] p-4">
          <h3 className="mb-2 font-display text-xl">Итого</h3>
          {ex.summary.tasks?.length > 0 && (
            <div className="mb-3 space-y-1 text-sm">
              {ex.summary.tasks.map((t, i) => <p key={i}><b>{t.title}.</b> <span className="text-ink-soft">{t.text}</span></p>)}
            </div>
          )}
          {ex.summary.focus && <p className="mb-3 text-sm"><b>Фокус года — </b><span className="text-ink-soft">{ex.summary.focus}</span></p>}
          <div className="grid gap-4 sm:grid-cols-[1fr,1.6fr] text-sm">
            {ex.summary.strengths?.length > 0 && (
              <div>
                <p className="mb-1 font-semibold text-green-800">Сильные стороны — опора</p>
                <ul className="list-disc space-y-0.5 pl-5 text-ink-soft">{ex.summary.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {ex.summary.work?.length > 0 && (
              <div>
                <p className="mb-1 font-semibold text-red-800">Над чем проработать</p>
                <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
                  {ex.summary.work.map((w, i) => <li key={i}><b className="text-ink">{w.area}.</b> {w.text}</li>)}
                </ol>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="border-t border-ink/10 pt-2 text-[11px] text-ink-faint">
        Сила Рода · belayarod.ru · {publicView ? 'Подробные толкования — в расчёте матрицы.' : 'Подробные толкования — во вкладке «Матрица» кабинета куратора.'}
      </footer>
    </div>
  )
}

export default function MatrixReport ({ open, onClose, name, numerology, profile, publicView = false }) {
  if (!open || !numerology) return null
  return (
    <>
      <Modal open={open} onClose={onClose} title="Отчёт по матрице" wide>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.print()} className="btn-primary text-sm py-2">📄 Сохранить в PDF</button>
          <span className="self-center text-xs text-ink-muted">В окне печати выберите «Сохранить как PDF».</span>
        </div>
        <ReportBody name={name} numerology={numerology} profile={profile} publicView={publicView} />
      </Modal>
      {createPortal(
        <div className="matrix-printable"><ReportBody name={name} numerology={numerology} profile={profile} publicView={publicView} /></div>,
        document.body
      )}
    </>
  )
}
