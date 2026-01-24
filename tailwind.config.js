/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Anthropic Claude Theme
        claude: {
          // Sidebar (dark warm brown)
          sidebar: {
            bg: '#1a1714',
            surface: '#211e1b',
            border: '#2e2a26',
            hover: '#35302b',
            text: '#f5f0eb',
            muted: '#9b958f',
          },
          // Main content area (warm cream/beige)
          main: {
            bg: '#f5f0eb',
            surface: '#ffffff',
            border: '#e8e2dc',
            text: '#1a1714',
            muted: '#6b6560',
          },
          // Accent colors
          accent: {
            primary: '#da7756',    // Coral/orange (Claude's signature)
            hover: '#c86a4b',
            light: '#f0d4c8',
          },
          // Status colors
          success: '#2e7d32',
          warning: '#ed6c02',
          error: '#d32f2f',
          info: '#0288d1',
        },
        // Keep terminal colors for xterm
        terminal: {
          bg: '#1a1714',
          surface: '#211e1b',
          border: '#2e2a26',
          text: '#f5f0eb',
          muted: '#9b958f',
          accent: '#da7756',
          success: '#4caf50',
          warning: '#ff9800',
          error: '#f44336',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink': 'blink 1s ease-in-out infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 },
        },
      },
      borderRadius: {
        'claude': '0.75rem',
      },
    },
  },
  plugins: [],
}
