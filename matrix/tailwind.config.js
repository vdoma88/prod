import plugin from 'tailwindcss/plugin'

// Вид «телефон / компьютер» (lib/viewMode.js): sm/md/lg/xl срабатывают по
// ширине окна, только если не выбран мобильный вид — атрибут data-view на
// <html>. Иначе на широком экране кабинет нельзя было бы показать телефонным.
const BREAKPOINTS = [['sm', 640], ['md', 768], ['lg', 1024], ['xl', 1280], ['2xl', 1536]]

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    // Точки перестройки — плагином ниже, с учётом выбранного вида
    screens: {},
    extend: {
      colors: {
        // Палитра лендинга belayarod.ru (бренд «Сила Рода», client/public/brand/
        // tokens.css). Приложение выглядит как лендинг; своё у него только
        // тон фона — --sr-bg-1..3 для data-sr-product="rod".
        // Литералы, а не var(): иначе не работают модификаторы вида /85.
        ink: {
          DEFAULT: '#33251d',   // основной текст
          soft: '#5d4a3c',      // второстепенный текст
          muted: '#776557',     // подписи
          faint: '#9a8676',     // подсказки, неактивное
        },
        paper: {
          DEFAULT: '#fffaf4',   // карточки, поля
          deep: '#f2e7d8',      // фон страницы (тон «Рода»)
          sand: '#e6d4bf',
        },
        gold: {
          50:  '#fbf5ec',
          100: '#f6e8d3',
          200: '#ecd3ae',
          300: '#d7ae70',
          400: '#c58b43',
          500: '#b87a34',
          600: '#a86427',
          700: '#8b5a2e',
          800: '#6e4524',
          900: '#4a2f19',
        },
        // Фон страницы (= --sr-bg-2). Класс bg-paper-deep — выезжающие панели.
        bg: { deep: '#f2e7d8' },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        body: ['Manrope', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        // Три варианта одной орбиты с разной длительностью и задержкой.
        'orb-1': 'orbFloat 8s ease-in-out infinite',
        'orb-2': 'orbFloat 10s ease-in-out infinite 2s',
        'orb-3': 'orbFloat 12s ease-in-out infinite 4s',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.6' } },
        orbFloat: {
          '0%': { transform: 'translate(0, 0) scale(1)' },
          '25%': { transform: 'translate(20px, -30px) scale(1.1)' },
          '50%': { transform: 'translate(-10px, -60px) scale(0.9)' },
          '75%': { transform: 'translate(-30px, -20px) scale(1.05)' },
          '100%': { transform: 'translate(0, 0) scale(1)' },
        },
      }
    }
  },
  // Классы animate-orb-* собираются динамически в FloatingParticles.jsx,
  // сканер контента их не находит и вырезал из сборки — анимация не работала.
  safelist: ['animate-orb-1', 'animate-orb-2', 'animate-orb-3'],
  plugins: [
    plugin(({ addVariant }) => {
      for (const [name, px] of BREAKPOINTS) addVariant(name, `@media (min-width: ${px}px) { html:not([data-view="mobile"]) & }`)
    })
  ]
}
