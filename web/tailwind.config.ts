import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#F0F2F5',
          subtle: '#E9EDEF',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          hover: '#F5F6F6',
          card: '#FFFFFF',
          border: '#E9EDEF',
          'border-light': '#F0F2F5',
        },
        wa: {
          DEFAULT: '#008069',
          50: '#E7F7EF',
          100: '#C3ECD7',
          200: '#8CE0B6',
          300: '#53D394',
          400: '#00A884',
          500: '#008069',
          600: '#006B57',
          700: '#005445',
          800: '#003F34',
          900: '#002B23',
          bright: '#25D366',
          bubble: '#D9FDD3',
          blue: '#53BDEB',
          chatbg: '#EFEAE2',
        },
        ink: {
          DEFAULT: '#111B21',
          muted: '#667781',
          dim: '#8696A0',
        },
        gold: {
          50: '#E7F7EF',
          100: '#C3ECD7',
          200: '#8CE0B6',
          300: '#53D394',
          400: '#00A884',
          500: '#008069',
          600: '#006B57',
          700: '#005445',
          800: '#003F34',
          900: '#002B23',
          DEFAULT: '#008069',
        }
      },
      fontFamily: {
        sans: ['Segoe UI', 'Helvetica Neue', 'Helvetica', 'Lucida Grande', 'Arial', 'system-ui', 'sans-serif'],
        mono: ['SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
      },
      boxShadow: {
        'wa-sm': '0 1px 2px 0 rgba(11, 20, 26, 0.06)',
        'wa-md': '0 2px 5px 0 rgba(11, 20, 26, 0.08), 0 1px 1.5px 0 rgba(11, 20, 26, 0.04)',
        'wa-lg': '0 4px 14px 0 rgba(11, 20, 26, 0.1)',
      }
    },
  },
  plugins: [],
};

export default config;
