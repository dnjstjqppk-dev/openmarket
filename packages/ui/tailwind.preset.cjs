// @olmoa/ui Tailwind preset — maps the CSS-variable design tokens (src/styles/tokens.css) to utilities.
// Apps: `presets: [require('@olmoa/ui/tailwind.preset.cjs')]` and include the package in `content`.
// Utilities read semantic tokens only (bg-surface, text-muted, bg-primary …) so light/dark switch for free.
const v = (name) => `rgb(var(--om-${name}) / <alpha-value>)`;
const scale = (name, steps) => Object.fromEntries(steps.map((s) => [s, v(`${name}-${s}`)]));

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    screens: {
      xs: '375px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1366px',
      '2xl': '1440px',
      '3xl': '1920px'
    },
    extend: {
      colors: {
        bg: v('bg'),
        surface: { DEFAULT: v('surface'), 2: v('surface-2'), 3: v('surface-3') },
        ink: { DEFAULT: v('text'), muted: v('text-muted'), subtle: v('text-subtle'), inverse: v('text-inverse') },
        line: { DEFAULT: v('border'), strong: v('border-strong'), divider: v('divider') },
        primary: { DEFAULT: v('primary'), hover: v('primary-hover'), active: v('primary-active'), soft: v('primary-soft'), 'soft-ink': v('primary-soft-text'), on: v('on-primary') },
        secondary: { DEFAULT: v('secondary'), hover: v('secondary-hover'), on: v('on-secondary') },
        accent: { DEFAULT: v('accent'), soft: v('accent-soft') },
        highlight: { DEFAULT: v('highlight'), soft: v('highlight-soft'), ink: v('highlight-text') },
        success: { DEFAULT: v('success'), soft: v('success-soft') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
        info: { DEFAULT: v('info'), soft: v('info-soft') },
        focus: v('focus'),
        overlay: v('overlay'),
        lagoon: scale('lagoon', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900])
      },
      fontFamily: {
        sans: ['var(--om-font-sans)'],
        mono: ['var(--om-font-mono)']
      },
      fontSize: {
        '2xs': ['var(--om-text-2xs)', { lineHeight: '1rem' }],
        xs: ['var(--om-text-xs)', { lineHeight: '1.125rem' }],
        sm: ['var(--om-text-sm)', { lineHeight: '1.25rem' }],
        md: ['var(--om-text-md)', { lineHeight: '1.5rem' }],
        lg: ['var(--om-text-lg)', { lineHeight: '1.625rem' }],
        xl: ['var(--om-text-xl)', { lineHeight: '1.75rem' }],
        '2xl': ['var(--om-text-2xl)', { lineHeight: '2rem' }],
        '3xl': ['var(--om-text-3xl)', { lineHeight: '2.375rem' }],
        '4xl': ['var(--om-text-4xl)', { lineHeight: '2.875rem' }]
      },
      borderRadius: {
        xs: 'var(--om-radius-xs)',
        sm: 'var(--om-radius-sm)',
        DEFAULT: 'var(--om-radius-md)',
        md: 'var(--om-radius-md)',
        lg: 'var(--om-radius-lg)',
        xl: 'var(--om-radius-xl)',
        '2xl': 'var(--om-radius-2xl)',
        '3xl': 'var(--om-radius-3xl)'
      },
      boxShadow: {
        sm: 'var(--om-shadow-sm)',
        DEFAULT: 'var(--om-shadow-md)',
        md: 'var(--om-shadow-md)',
        lg: 'var(--om-shadow-lg)',
        overlay: 'var(--om-shadow-overlay)'
      },
      zIndex: {
        dropdown: 'var(--om-z-dropdown)',
        sticky: 'var(--om-z-sticky)',
        drawer: 'var(--om-z-drawer)',
        modal: 'var(--om-z-modal)',
        toast: 'var(--om-z-toast)',
        tooltip: 'var(--om-z-tooltip)'
      },
      transitionTimingFunction: { om: 'var(--om-ease)' },
      transitionDuration: { fast: 'var(--om-duration-fast)', DEFAULT: 'var(--om-duration)', slow: 'var(--om-duration-slow)' },
      maxWidth: { container: 'var(--om-container)' },
      height: { header: 'var(--om-header-h)' },
      keyframes: {
        'om-shimmer': { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        'om-fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'om-slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'om-slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'om-slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } }
      },
      animation: {
        shimmer: 'om-shimmer 1.4s linear infinite',
        'fade-in': 'om-fade-in var(--om-duration) var(--om-ease)',
        'slide-up': 'om-slide-up var(--om-duration) var(--om-ease)',
        'slide-in-right': 'om-slide-in-right var(--om-duration-slow) var(--om-ease)',
        'slide-in-left': 'om-slide-in-left var(--om-duration-slow) var(--om-ease)'
      }
    }
  },
  plugins: []
};
