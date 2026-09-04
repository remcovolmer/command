/** @type {import('tailwindcss').Config} */

/**
 * Token color with working opacity modifiers. The tokens are full oklch()
 * colors in src/index.css, so Tailwind cannot splice an alpha channel into
 * them; `bg-primary/25` would otherwise generate no CSS at all. With this
 * helper the modifier becomes a color-mix toward transparent, which keeps a
 * single source of truth for every color.
 */
const tok =
  (name) =>
  ({ opacityValue }) => {
    // Without a modifier Tailwind passes `var(--tw-bg-opacity)` (a string),
    // not a number — only a real fraction below 1 gets the color-mix.
    const alpha = Number(opacityValue)
    if (!Number.isFinite(alpha) || alpha >= 1) return `var(${name})`
    return `color-mix(in oklch, var(${name}) ${alpha * 100}%, transparent)`
  }

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: tok('--background'),
        foreground: tok('--foreground'),
        canvas: tok('--canvas'),
        panel: tok('--panel'),
        screen: tok('--screen'),
        raised: tok('--raised'),
        selected: tok('--selected'),
        'border-strong': tok('--border-strong'),
        card: {
          DEFAULT: tok('--card'),
          foreground: tok('--card-foreground'),
        },
        popover: {
          DEFAULT: tok('--popover'),
          foreground: tok('--popover-foreground'),
        },
        primary: {
          DEFAULT: tok('--primary'),
          hover: tok('--primary-hover'),
          soft: tok('--primary-soft'),
          foreground: tok('--primary-foreground'),
        },
        secondary: {
          DEFAULT: tok('--secondary'),
          foreground: tok('--secondary-foreground'),
        },
        muted: {
          DEFAULT: tok('--muted'),
          foreground: tok('--muted-foreground'),
        },
        accent: {
          DEFAULT: tok('--accent'),
          foreground: tok('--accent-foreground'),
        },
        destructive: {
          DEFAULT: tok('--destructive'),
          foreground: tok('--destructive-foreground'),
        },
        fg: {
          strong: tok('--fg-strong'),
          DEFAULT: tok('--fg'),
          muted: tok('--fg-muted'),
          faint: tok('--fg-faint'),
        },
        info: tok('--info'),
        success: tok('--success'),
        warning: tok('--warning'),
        danger: tok('--danger'),
        status: {
          attention: tok('--status-attention'),
          done: tok('--status-done'),
          busy: tok('--status-busy'),
          stopped: tok('--status-stopped'),
        },
        border: tok('--border'),
        scrim: tok('--scrim'),
        input: tok('--input'),
        ring: tok('--ring'),
        sidebar: {
          DEFAULT: tok('--sidebar'),
          foreground: tok('--sidebar-foreground'),
          primary: tok('--sidebar-primary'),
          'primary-foreground': tok('--sidebar-primary-foreground'),
          accent: tok('--sidebar-accent'),
          'accent-foreground': tok('--sidebar-accent-foreground'),
          border: tok('--sidebar-border'),
          ring: tok('--sidebar-ring'),
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: '8px',
        xl: '12px',
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        blink: 'blink 1s ease-in-out infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 },
        },
      },
    },
  },
  plugins: [],
}
