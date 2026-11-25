// Айдентика «Сила Рода» с лендинга belayarod.ru: знак Рода (тот же рисунок,
// что в шапке лендинга, vdoma88/prod site/index.html), папоротник и дуб —
// тонкой линией, в тон знаку. Цвет — currentColor, размер — от className.

export const SIGN_RED = '#c93f27'

export function RodSign ({ className = '', title }) {
  return (
    <svg className={className} viewBox="0 0 48 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M24 3l6 6-6 6-6-6z" />
        <path d="M12 9l6 6-6 6-6-6zM36 9l6 6-6 6-6-6z" />
        <path d="M18 15l6 6 6-6" />
        <path d="M24 21v22" />
        <path d="M12 21l12 12 12-12M6 27l6 6-6 6M42 27l-6 6 6 6" />
        <path d="M12 33l12 12 12-12" />
        <path d="M18 45l6 6 6-6" />
        <path d="M12 43l6 6-6 6-6-6zM36 43l6 6-6 6-6-6z" />
        <path d="M24 49l6 6-6 6-6-6z" />
      </g>
    </svg>
  )
}

// Вайя папоротника: стебель и пары листочков, к верхушке всё мельче
const FERN = (() => {
  const parts = ['M60 236C58 180 63 110 60 12']
  const n = 13
  for (let i = 0; i < n; i++) {
    const y = 214 - i * 15.5
    const l = 48 * (1 - i / n) + 6
    for (const s of [-1, 1]) {
      const x = 60 + s * 0.6
      parts.push(`M${x} ${y}Q${x + s * l * 0.45} ${y - l * 0.5} ${x + s * l} ${y - l * 0.32}Q${x + s * l * 0.5} ${y - l * 0.08} ${x} ${y}`)
    }
  }
  return parts.join('')
})()

export function Fern ({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 120 240" aria-hidden="true" focusable="false">
      <path d={FERN} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Дубовый лист с лопастями, жилками и жёлудем
const OAK = (() => {
  const top = 26, base = 150, k = 5
  const w = t => 34 * Math.sin(Math.PI * (0.15 + 0.85 * t)) + 4
  const side = s => {
    let d = ''
    for (let j = 0; j < k; j++) {
      const t0 = j / k, t1 = (j + 1) / k
      const yOut = base - (base - top) * (t0 + 0.55 / k)
      const yIn = base - (base - top) * t1
      d += `Q${80 + s * w(t0 + 0.5 / k) * 1.15} ${yOut} ${80 + s * w(t1) * 0.5} ${yIn}`
    }
    return d
  }
  const right = `M80 ${base}${side(1)}L80 ${top}`
  const left = `M80 ${base}${side(-1)}L80 ${top}`
  const veins = [...Array(k)].map((_, j) => {
    const t = (j + 0.5) / k
    const y = base - (base - top) * t
    return `M80 ${y + 8}L${80 + w(t) * 0.8} ${y - 2}M80 ${y + 8}L${80 - w(t) * 0.8} ${y - 2}`
  }).join('')
  return `${right}${left}M80 ${base + 18}L80 ${top + 6}${veins}`
})()

export function OakLeaf ({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 160 200" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d={OAK} />
        {/* жёлудь на веточке */}
        <path d="M80 168C92 172 104 174 116 170" />
        <ellipse cx="124" cy="184" rx="8" ry="11" />
        <path d="M114 177c3-6 17-6 20 0-5 3-15 3-20 0zM124 171v-4" />
      </g>
    </svg>
  )
}

// Разделитель под заголовком: линия — ромбы знака — линия
export function Ornament ({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 96 12" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M2 6h30M64 6h30" />
        <path d="M38 6l4-4 4 4-4 4zM50 6l4-4 4 4-4 4z" />
        <path d="M44 6l4-4 4 4-4 4z" fill="currentColor" />
      </g>
    </svg>
  )
}

// Фон кабинета: папоротник снизу слева и дубовый лист сверху справа —
// едва заметно, за содержимым, не мешает чтению и нажатиям.
export function BrandBackdrop () {
  return (
    <div className="brand-backdrop" aria-hidden="true">
      <Fern className="brand-backdrop-fern" />
      <OakLeaf className="brand-backdrop-oak" />
    </div>
  )
}
