import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: { DEFAULT: '#1C1C1C', soft: '#4B4B4B', muted: '#8A8A8A' },
        line: '#EBEBEB',
        surface: { DEFAULT: '#FFFFFF', sunken: '#F7F7F7' },
        brand: { DEFAULT: '#0F9D58', dark: '#0B7A44', tint: '#E7F6EE' },
        pending: { DEFAULT: '#C2410C', tint: '#FFF4EA' },
        danger: { DEFAULT: '#C62828', tint: '#FDECEC' },
      },
      boxShadow: {
        pop: '0 12px 32px -8px rgba(28, 28, 28, 0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
