import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../../lib/api'
import { formatDateTime, formatDMY } from '../../../lib/utils'
import { ExplainProvider, Num } from './MatrixExplain'
import MatrixReport from './MatrixReport'

function extractApiErrorMessage(error) {
  return error?.response?.data?.error || error?.message || ''
}

function NumerologyCard({ title, value, description, id }) {
  if (value === undefined || value === null) return null
  return (
    <div className="card p-4 space-y-1">
      <p className="text-xs text-ink-muted">{title}</p>
      <p className="text-3xl font-bold text-ink"><Num id={id}>{value}</Num></p>
      {description && <p className="text-xs text-ink-muted">{description}</p>}
    </div>
  )
}

// Сетка и доп. числа — как в калькуляторе автора (matrix.belayarod.ru):
// в клетке столько цифр, сколько их в дате и доп. числах.
function PsychomatrixGrid({ block }) {
  const grid = block?.grid
  if (!grid) return null
  const order = [1, 4, 7, 2, 5, 8, 3, 6, 9]
  const wnums = block?.workingNumbers?.all || []
  // С 2000 года третьим идёт служебное 19 — у него толкования нет
  const wnIds = block?.input?.year >= 2000 ? ['n1', 'n2', null, 'n3', 'n4'] : ['n1', 'n2', 'n3', 'n4']
  const input = block?.input

  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Матрица</p>
        {input && <p className="text-xs text-ink-muted">{formatDMY(input.day, input.month, input.year)}</p>}
      </div>

      {wnums.length > 0 && (
        <p className="text-sm text-ink-soft">
          Доп. числа:{' '}
          {wnums.map((n, i) => (
            <span key={i} className="text-gold-700 font-mono text-base">
              {i > 0 && '.'}<Num id={wnIds[i]}>{n}</Num>
            </span>
          ))}
        </p>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        {order.map(n => {
          const digits = grid[n]?.digits || []
          return (
            <div key={n} className="rounded-xl border border-ink/[0.06] bg-ink/[0.03] px-2 py-4 text-center">
              <div className="text-lg font-bold text-ink leading-tight break-words"><Num id={`cell-${n}`}>{digits.length ? digits.join(' ') : '—'}</Num></div>
            </div>
          )
        })}
      </div>

      {block?.bonusNine > 0 && (
        <p className="text-[11px] text-ink-faint">Рождение с 2020 года: в клетке 9 добавлена девятка, значение девяток учитывает её.</p>
      )}
    </div>
  )
}

// Длинный текст автора — целиком, с его переносами строк.
// max-w-prose — около 65 знаков в строке: тексты автора по 1–5 тысяч знаков
// во всю ширину карточки читать тяжело.
function AuthorText({ children }) {
  return <p className="max-w-prose text-[15px] text-ink-soft leading-relaxed whitespace-pre-line">{children}</p>
}

// Две задачи и значения цифр — полные тексты автора методики.
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const allOpen = (v) => Object.fromEntries(DIGITS.map(n => [n, v]))

function AuthorInterpretation({ interpretations, counts }) {
  // По умолчанию всё развёрнуто, как раньше: куратор читает разбор целиком.
  const [open, setOpen] = useState(() => allOpen(true))
  const setAll = (v) => setOpen(allOpen(v))
  if (!interpretations?.digits) return null
  const { soulTask, rodTask, digits } = interpretations
  return (
    <div className="space-y-3">
      {soulTask && (
        <div className="card p-4 space-y-2">
          <h4 className="font-display text-lg text-ink">Личная задача Души · <Num id="n2">{soulTask.number}</Num></h4>
          {soulTask.text ? <AuthorText>{soulTask.text}</AuthorText> : <p className="text-sm text-ink-muted">У автора нет текста для этого числа.</p>}
        </div>
      )}
      {rodTask && (
        <div className="card p-4 space-y-2">
          <h4 className="font-display text-lg text-ink">Родовая задача. ЧРП · <Num id="n4">{rodTask.number}</Num></h4>
          {rodTask.text ? <AuthorText>{rodTask.text}</AuthorText> : <p className="text-sm text-ink-muted">У автора нет текста для этого числа.</p>}
        </div>
      )}

      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-display text-lg text-ink">Значения матрицы</h4>
          <div className="flex gap-3 text-xs">
            <button type="button" className="text-ink-muted hover:text-gold-700" onClick={() => setAll(true)}>Развернуть всё</button>
            <button type="button" className="text-ink-muted hover:text-gold-700" onClick={() => setAll(false)}>Свернуть всё</button>
          </div>
        </div>

        {/* Оглавление: девять текстов подряд — это 20+ экранов, к нужной цифре
            проще перейти, чем листать. */}
        <nav aria-label="Цифры матрицы" className="flex flex-wrap gap-1.5">
          {DIGITS.map(n => (
            <a key={n} href={`#digit-${n}`} onClick={() => setOpen(o => ({ ...o, [n]: true }))}
              className="rounded-full border border-ink/[0.08] bg-ink/[0.03] px-3 py-1 text-sm text-ink-soft hover:border-gold-400/40 hover:text-gold-700">
              {n} <span className="font-mono text-gold-700">{counts?.[n] ? String(n).repeat(counts[n]) : '—'}</span>
            </a>
          ))}
        </nav>

        {DIGITS.map(n => {
          const d = digits[n] || {}
          return (
            <details key={n} id={`digit-${n}`} open={open[n]}
              onToggle={e => { const v = e.currentTarget.open; setOpen(o => (o[n] === v ? o : { ...o, [n]: v })) }}
              className="scroll-mt-24 border-t border-ink/[0.06] pt-3 first-of-type:border-0 first-of-type:pt-0">
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 py-1">
                <span className="text-base font-semibold text-ink">Значение цифры {n}</span>
                <span className="font-mono text-gold-700">{counts?.[n] ? String(n).repeat(counts[n]) : `нет ${n}`}</span>
              </summary>
              <div className="space-y-2 pt-2">
                {d.intro && <p className="max-w-prose text-xs text-ink-muted leading-relaxed whitespace-pre-line">{d.intro}</p>}
                {d.text
                  ? <AuthorText>{d.text}</AuthorText>
                  : <p className="text-sm text-ink-muted">У автора нет текста для сочетания «{d.key}».</p>}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

function ChakraMatrix({ block }) {
  const chakras = block?.chakras
  if (!chakras || !Object.keys(chakras).length) return null
  const names = { 1: 'Муладхара', 2: 'Свадхистана', 3: 'Манипура', 4: 'Анахата', 5: 'Вишудха', 6: 'Аджна', 7: 'Сахасрара' }
  return (
    <div className="card p-4">
      <p className="text-sm font-semibold text-ink mb-3">Чакральный срез</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {Object.entries(chakras).map(([key, chakra]) => (
          <div key={key} className="rounded-xl bg-ink/[0.03] px-3 py-2 border border-ink/[0.06]">
            <p className="text-xs text-ink-muted">{names[key] || `Чакра ${key}`}</p>
            <p className="text-lg font-bold text-ink"><Num id={`chakra-${key}`}>{chakra.value ?? '—'}</Num></p>
            <p className="text-[10px] text-ink-faint">Расчёт: {chakra.digits || `${key}+`}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Прогноз: личный год и родологический цикл на этот и следующий год
function Forecast({ forecast }) {
  return (
    <div className="card p-4 space-y-3">
      <h4 className="font-display text-lg text-ink">Прогноз и рекомендации</h4>
      <div className="grid gap-3 md:grid-cols-2">
        {forecast.map(f => (
          <div key={f.year} className="rounded-xl border border-gold-400/25 bg-gold-400/[0.05] p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-lg text-ink">{f.year}</span>
              <span className="text-sm text-ink-muted">личный год <b className="text-xl text-gold-700"><Num id={`year-${f.year}`}>{f.personal.number}</Num></b></span>
            </div>
            <p className="font-semibold text-ink">{f.personal.title}</p>
            <p className="text-sm text-ink-soft leading-relaxed">{f.personal.essence}</p>
            <div className="text-sm">
              <p className="font-semibold text-green-800">Что делать</p>
              <ul className="list-disc pl-5 text-ink-soft">{f.personal.do.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <p className="mt-1 font-semibold text-red-800">Чего избегать</p>
              <ul className="list-disc pl-5 text-ink-soft">{f.personal.avoid.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
            <p className="text-sm text-ink-muted border-t border-ink/[0.06] pt-2">
              Родологический цикл <b className="text-amber-700"><Num id={`rodcycle-${f.year}`}>{f.rod.number}</Num></b>: {f.rod.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MatrixTab({ clientId, hasBirthDate }) {
  const qc = useQueryClient()

  const { data: numerology, isLoading: numerologyLoading, error: numerologyError } = useQuery({
    queryKey: ['admin-client-numerology', clientId],
    queryFn: () => api.get(`/admin/clients/${clientId}/numerology`).then(r => r.data),
    enabled: hasBirthDate
  })
  const numerologyErrorMessage = extractApiErrorMessage(numerologyError) || 'Не удалось рассчитать матрицу'

  const { data: numerologySnapshots = [] } = useQuery({
    queryKey: ['admin-client-numerology-snapshots', clientId],
    queryFn: () => api.get(`/admin/clients/${clientId}/numerology/snapshots`).then(r => r.data),
    enabled: hasBirthDate
  })

  const { data: numbaseProfile } = useQuery({
    queryKey: ['admin-client-numbase', clientId],
    queryFn: () => api.get(`/admin/clients/${clientId}/numbase`).then(r => r.data),
    enabled: hasBirthDate
  })

  const saveSnapshotMutation = useMutation({
    mutationFn: () => api.post(`/admin/clients/${clientId}/numerology/snapshots`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-client-numerology-snapshots', clientId] })
  })

  return <MatrixResult numerology={numerology} numbaseProfile={numbaseProfile}
    hasBirthDate={hasBirthDate} numerologyLoading={numerologyLoading}
    numerologyError={numerologyError && numerologyErrorMessage}
    numerologySnapshots={numerologySnapshots} onSaveSnapshot={() => saveSnapshotMutation.mutate()}
    savePending={saveSnapshotMutation.isPending} />
}

// Общий вид расчёта: для отдельного калькулятора и карточки ученицы.
export function MatrixResult({ numerology, numbaseProfile, hasBirthDate = true,
  numerologyLoading = false, numerologyError, numerologySnapshots = [], onSaveSnapshot, savePending = false }) {
  const [reportOpen, setReportOpen] = useState(false)

  return (
    <ExplainProvider items={numbaseProfile?.explain?.items}>
    <div className="space-y-4">
      <div className="card p-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg text-ink">{onSaveSnapshot ? 'Матрица ученицы' : 'Ваша матрица'}</h3>
          <p className="text-xs text-ink-muted">Нажмите на любое число — откроется подробное толкование</p>
        </div>
        {onSaveSnapshot && <button
          onClick={onSaveSnapshot}
          disabled={savePending || !hasBirthDate}
          className="btn-primary text-sm py-2">
          {savePending ? '⏳ Сохраняю...' : '💾 Сохранить снимок'}
        </button>}
        {!onSaveSnapshot && numerology && numbaseProfile && (
          <button type="button" onClick={() => setReportOpen(true)} className="btn-secondary text-sm py-2">Отчёт и PDF</button>
        )}
      </div>

      {!hasBirthDate && (
        <div className="card p-5 text-sm text-amber-700 bg-amber-400/5 border border-amber-400/15">
          Для расчёта матрицы укажите дату рождения в анкете ученицы (вкладка «Данные ученицы»).
        </div>
      )}

      {numerologyLoading && <div className="card p-5 text-sm text-ink-muted">Загрузка матрицы...</div>}
      {numerologyError && (
        <div className="card p-5 text-sm text-red-700">
          {numerologyError}
        </div>
      )}

      {numerology && (
        <div className="space-y-3">
          {numerology.grid && <PsychomatrixGrid block={numerology} />}

          <AuthorInterpretation interpretations={numbaseProfile?.interpretations} counts={numerology.counts} />

          <div className="grid md:grid-cols-2 gap-3">
            {numerology.tasks && <NumerologyCard id="n2" title="Задача Души" value={numerology.tasks.soul} description="2-е доп. число" />}
            {numerology.tasks && <NumerologyCard id="n4" title="ЧРП — родовая задача" value={numerology.tasks.rod} description="4-е доп. число" />}
            {numerology.pathNumber && <NumerologyCard id="path" title="Число пути" value={numerology.pathNumber} description="сумма даты, сведённая к однозначному" />}
            {numerology.birthNumber && <NumerologyCard id="birth" title="Число рождения" value={numerology.birthNumber} description="день рождения" />}
            {numerology.soulNumber?.value && <NumerologyCard id="soul" title="Число души" value={numerology.soulNumber.value} description="день + месяц рождения" />}
            {numerology.moneyChannel && <NumerologyCard id="money" title="Фин. канал" value={numerology.moneyChannel.value} />}
            {numerology.personalYear && <NumerologyCard id={`year-${new Date().getFullYear()}`} title={`Личный год ${new Date().getFullYear()}`} value={numerology.personalYear} />}
          </div>

          {numerology.chakras && <ChakraMatrix block={{ chakras: numerology.chakras }} />}
        </div>
      )}

      {onSaveSnapshot && <div className="card p-5">
        <h4 className="font-semibold text-ink mb-3">История снимков</h4>
        <div className="space-y-2">
          {numerologySnapshots.map(s => (
            <div key={s.id} className="border border-ink/[0.06] rounded-xl px-3 py-2 text-sm flex justify-between gap-4">
              <span className="text-ink-soft">{formatDateTime(s.createdAt)}</span>
              <span className="text-ink-muted">{s.engineVersion}</span>
              <span className="text-ink-muted">{s.createdBy?.name || s.createdBy?.email || 'admin'}</span>
            </div>
          ))}
          {numerologySnapshots.length === 0 && (
            <p className="text-sm text-ink-muted">Снимков пока нет</p>
          )}
        </div>
      </div>}

      {numbaseProfile && (
        <div className="space-y-3">
          {numbaseProfile.interpretations?.rows && (
            <div className="card p-4">
              <h4 className="text-sm font-semibold text-ink mb-2">Строки матрицы</h4>
              <div className="space-y-2">
                {Object.entries(numbaseProfile.interpretations.rows).map(([k, r]) => (
                  <div key={k} className="bg-ink/[0.03] rounded-xl p-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm text-ink font-medium">{r.name}</span>
                      <span className="text-lg font-bold text-gold-700"><Num id={`rows-${k}`}>{r.sum}</Num></span>
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed">{r.level}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {numbaseProfile.interpretations?.columns && (
            <div className="card p-4">
              <h4 className="text-sm font-semibold text-ink mb-2">Столбцы матрицы</h4>
              <div className="space-y-2">
                {Object.entries(numbaseProfile.interpretations.columns).map(([k, c2]) => (
                  <div key={k} className="bg-ink/[0.03] rounded-xl p-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm text-ink font-medium">{c2.name}</span>
                      <span className="text-lg font-bold text-gold-700"><Num id={`columns-${k}`}>{c2.sum}</Num></span>
                    </div>
                    <p className="text-xs text-ink-muted leading-relaxed">{c2.level}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {numbaseProfile.interpretations?.diagonals && (
            <div className="card p-4">
              <h4 className="text-sm font-semibold text-ink mb-2">Диагонали</h4>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(numbaseProfile.interpretations.diagonals).map(([k, d]) => (
                  <div key={k} className="bg-ink/[0.03] rounded-xl p-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-ink-soft">{d.name}</span>
                      <span className="text-lg font-bold text-gold-700"><Num id={`diagonals-${k}`}>{d.sum}</Num></span>
                    </div>
                    <p className="text-[10px] text-ink-muted leading-relaxed">{d.level}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {numbaseProfile.interpretations?.moneyChannel && (
            <div className="card p-4 border-amber-400/15">
              <h4 className="text-sm font-semibold text-amber-700 mb-2">💰 Денежный канал (4-5-6)</h4>
              <div className="flex gap-3 mb-3 text-center">
                <div className="flex-1 bg-ink/[0.03] rounded-xl p-2">
                  <div className="text-[10px] text-ink-muted">4 (Здоровье)</div>
                  <div className="text-xl font-bold text-ink">{numbaseProfile.interpretations.moneyChannel.c4}</div>
                </div>
                <div className="flex-1 bg-ink/[0.03] rounded-xl p-2">
                  <div className="text-[10px] text-ink-muted">5 (Логика)</div>
                  <div className="text-xl font-bold text-ink">{numbaseProfile.interpretations.moneyChannel.c5}</div>
                </div>
                <div className="flex-1 bg-ink/[0.03] rounded-xl p-2">
                  <div className="text-[10px] text-ink-muted">6 (Труд)</div>
                  <div className="text-xl font-bold text-ink">{numbaseProfile.interpretations.moneyChannel.c6}</div>
                </div>
              </div>
              <p className="text-xs text-ink-muted leading-relaxed whitespace-pre-line">{numbaseProfile.interpretations.moneyChannel.full}</p>
            </div>
          )}

          {numbaseProfile.interpretations?.clanFlow && (
            <div className="card p-4 border-gold-400/15">
              <h4 className="text-sm font-semibold text-gold-700 mb-2">🌊 Родовой поток: {numbaseProfile.interpretations.clanFlow.name}</h4>
              <p className="text-xs text-ink-muted mb-2">{numbaseProfile.interpretations.clanFlow.desc}</p>
              <div className="text-xs text-ink-muted">
                <p>Идеальный поток: <span className="text-ink-soft">{numbaseProfile.interpretations.clanFlow.ideal}</span></p>
                <p className="mt-1">Рекомендуемые профессии: <span className="text-ink-muted">{numbaseProfile.interpretations.clanFlow.prof}</span></p>
              </div>
            </div>
          )}

          {numbaseProfile.interpretations && (
            <>
              {numbaseProfile.interpretations.birthNumber && (
                <div className="card p-4">
                  <h4 className="text-sm font-semibold text-amber-700 mb-2">Интерпретация числа рождения (<Num id="birth">{numbaseProfile.birthNumber}</Num>)</h4>
                  <p className="text-xs text-ink-soft leading-relaxed">{numbaseProfile.interpretations.birthNumber}</p>
                </div>
              )}

              {typeof numbaseProfile.interpretations.moneyChannel === 'string' && (
                <div className="card p-4 border-amber-400/15">
                  <h4 className="text-sm font-semibold text-amber-700 mb-2">💰 Денежный канал</h4>
                  <p className="text-xs text-ink-soft leading-relaxed">{numbaseProfile.interpretations.moneyChannel}</p>
                </div>
              )}

              {numbaseProfile.explain?.forecast?.length > 0 && <Forecast forecast={numbaseProfile.explain.forecast} />}

              {numbaseProfile.interpretations.selfCurses?.length > 0 && (
                <div className="card p-4 border-red-400/15">
                  <h4 className="text-sm font-semibold text-red-700 mb-2">⚠ Родовые самопроклятия ({numbaseProfile.interpretations.selfCurses.length})</h4>
                  {numbaseProfile.interpretations.selfCurses.map((c, i) => (
                    <div key={i} className="bg-red-400/5 rounded-lg px-3 py-2 mb-1">
                      <span className="text-xs text-red-700 font-mono">{c.code}</span>
                      <p className="text-xs text-red-700/80 mt-0.5">{c.desc}</p>
                    </div>
                  ))}
                  <p className="text-[10px] text-red-700/60 mt-2">Рекомендуется снять до 46 лет. Днём, в хорошем настроении.</p>
                </div>
              )}

              {numbaseProfile.interpretations.clanPrograms?.length > 0 && (
                <div className="card p-4 border-amber-400/15">
                  <h4 className="text-sm font-semibold text-amber-700 mb-2">Родовые программы ({numbaseProfile.interpretations.clanPrograms.length})</h4>
                  {numbaseProfile.interpretations.clanPrograms.map((p, i) => (
                    <div key={i} className="bg-amber-400/5 rounded-lg px-3 py-2 mb-1">
                      <span className="text-xs text-amber-700 font-medium">{p.name}</span>
                      <p className="text-xs text-amber-700/80 mt-0.5">{p.desc}</p>
                    </div>
                  ))}
                </div>
              )}

              {numbaseProfile.interpretations.clanRoles?.length > 0 && (
                <div className="card p-4">
                  <h4 className="text-sm font-semibold text-ink mb-2">Роли в Роду</h4>
                  {numbaseProfile.interpretations.clanRoles.map((r, i) => (
                    <div key={i} className="bg-ink/[0.03] rounded-lg px-3 py-2 mb-1">
                      <span className="text-xs text-gold-700 font-medium">{r.role}</span>
                      <p className="text-xs text-ink-muted mt-0.5">{r.desc}</p>
                    </div>
                  ))}
                </div>
              )}

              {numbaseProfile.interpretations.generationProgram && (
                <div className="card p-4">
                  <h4 className="text-sm font-semibold text-ink mb-2">Программа поколения ({numbaseProfile.interpretations.generationProgram.generation}-е поколение)</h4>
                  <p className="text-xs text-ink-soft leading-relaxed">{numbaseProfile.interpretations.generationProgram.text}</p>
                </div>
              )}

              {numbaseProfile.interpretations.stones?.length > 0 && (
                <div className="card p-4">
                  <h4 className="text-sm font-semibold text-ink mb-2">💎 Рекомендуемые камни</h4>
                  {numbaseProfile.interpretations.stones.map((s, i) => (
                    <div key={i} className="text-xs text-ink-muted py-0.5">• {s}</div>
                  ))}
                </div>
              )}

              {numbaseProfile.interpretations.monthTask && (
                <div className="card p-4">
                  <h4 className="text-sm font-semibold text-ink mb-2">Ошибка прошлого воплощения</h4>
                  <p className="text-xs text-ink-soft leading-relaxed">{numbaseProfile.interpretations.monthTask}</p>
                </div>
              )}

              {onSaveSnapshot && <div className="text-center text-[10px] text-ink-faint pb-2">
                Версия: {numbaseProfile.engineVersion} · Формул: {numbaseProfile.catalog?.formulas?.length || 0}
              </div>}
            </>
          )}
        </div>
      )}

      {/* Отчёт: компактно, с сохранением в PDF */}
      {numerology && numbaseProfile && (
        <div className="card p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-display text-lg text-ink">Отчёт по матрице</h4>
            <p className="text-xs text-ink-muted">Числа, прогноз на два года, сферы жизни, чакральный анализ и итог — над чем проработать</p>
          </div>
          <button type="button" onClick={() => setReportOpen(true)} className="btn-primary text-sm py-2">📄 Отчёт и PDF</button>
        </div>
      )}
      <MatrixReport open={reportOpen} onClose={() => setReportOpen(false)}
        name={numbaseProfile?.fio?.fullName || (!onSaveSnapshot ? 'Матрица по дате рождения' : undefined)}
        numerology={numerology} profile={numbaseProfile} publicView={!onSaveSnapshot} />
    </div>
    </ExplainProvider>
  )
}
