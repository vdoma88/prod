import { useEffect, useId, useRef } from 'react'

// wide — для длинного текста (материал шага): окно шире и прокручивается внутри.
export default function Modal({ open, onClose, title, children, wide = false }) {
  const titleId = useId()
  const dialogRef = useRef(null)
  // onClose — в ref: родитель обычно передаёт новую стрелочную функцию на
  // каждой отрисовке, и эффект ниже перезапускался, снова фокусируя окно —
  // посреди набора в поле внутри окна курсор уходил с поля.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)

    // Фокус уходил в никуда: диалог открывался, но клавиатура оставалась на
    // кнопке под оверлеем, а после закрытия место в документе терялось.
    const previouslyFocused = document.activeElement
    dialogRef.current?.focus()

    return () => {
      window.removeEventListener('keydown', onKey)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`card w-full p-6 space-y-4 focus:outline-none ${wide ? 'max-w-2xl max-h-[90vh] overflow-y-auto overscroll-contain' : 'max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id={titleId} className="font-display text-lg text-ink">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="w-11 h-11 -mr-2 flex items-center justify-center text-ink-muted hover:text-ink text-xl leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
