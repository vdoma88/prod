import { createContext, useContext, useState } from 'react'
import Modal from '../../../components/ui/Modal'

// Всплывающие толкования чисел матрицы. Тексты собирает сервер
// (server/src/modules/numerology/explain.js) в explain.items[id]; здесь —
// кликабельное число и окно с толкованием.

const ExplainContext = createContext({ items: {}, open: () => {} })

export function ExplainProvider ({ items, children }) {
  const [current, setCurrent] = useState(null)
  const item = current ? items?.[current] : null
  return (
    <ExplainContext.Provider value={{ items: items || {}, open: setCurrent }}>
      {children}
      <Modal open={Boolean(item)} onClose={() => setCurrent(null)} title={item?.title} wide>
        {item && <ExplainBody item={item} />}
      </Modal>
    </ExplainContext.Provider>
  )
}

export function ExplainBody ({ item }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="grid h-16 min-w-16 place-items-center rounded-2xl bg-gold-400/15 px-3 font-display text-3xl text-gold-700">{item.value}</span>
        {item.formula && <p className="text-sm text-ink-muted leading-relaxed">{item.formula}</p>}
      </div>
      {item.sections.map((s, i) => (
        <section key={i} className="space-y-1">
          {s.h && <h4 className="font-semibold text-ink">{s.h}</h4>}
          {s.text && <p className="max-w-prose whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">{s.text}</p>}
          {s.list && (
            <ul className="list-disc space-y-0.5 pl-5 text-[15px] text-ink-soft">
              {s.list.map((x, j) => <li key={j}>{x}</li>)}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

/**
 * Число, по клику — толкование. Нет толкования — обычный текст.
 * @param {{ id: string, children: any, className?: string }} props
 */
export function Num ({ id, children, className = '' }) {
  const { items, open } = useContext(ExplainContext)
  if (!items[id]) return <span className={className}>{children}</span>
  return (
    <button type="button" onClick={() => open(id)} title="Подробное толкование"
      className={`num-explain ${className}`}>
      {children}
    </button>
  )
}
