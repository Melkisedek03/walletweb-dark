/** @type {import('tailwindcss').Config} */

// Theme colors are CSS variables (see src/index.css), so one set of
// classes renders both the dark and the light theme. Each variable
// holds an RGB triplet, and <alpha-value> keeps Tailwind's opacity
// modifiers (e.g. bg-dark-900/80) working. Only the shades the
// components actually use are variable-backed; accent fills (nux
// 500-900, orange/red/green/yellow fills and borders) stay fixed
// because they read the same on both themes.
const rgb = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary text on a surface. Replaces text-white where the
        // text sits on a themed surface (cards, inputs, page).
        ink: rgb('--ink'),
        nux: {
          50: '#f2fff0',
          100: '#e3fee0',
          200: '#c0fdba',
          300: rgb('--nux-300'),
          400: rgb('--nux-400'),
          500: '#0ee90e',
          600: '#09c702',
          700: '#03a103',
          800: '#0b8507',
          900: '#0f6e0c',
        },
        dark: {
          50: rgb('--dark-50'),
          100: rgb('--dark-100'),
          200: rgb('--dark-200'),
          300: rgb('--dark-300'),
          400: rgb('--dark-400'),
          500: rgb('--dark-500'),
          600: rgb('--dark-600'),
          700: rgb('--dark-700'),
          800: rgb('--dark-800'),
          900: rgb('--dark-900'),
          950: rgb('--dark-950'),
        },
        gray: {
          100: rgb('--ink'),
          200: rgb('--ink'),
        },
        green: {
          300: rgb('--green-300'),
          400: rgb('--green-400'),
        },
        red: {
          300: rgb('--red-300'),
          400: rgb('--red-400'),
        },
        yellow: {
          200: rgb('--yellow-200'),
          300: rgb('--yellow-300'),
          400: rgb('--yellow-400'),
        },
        orange: {
          300: rgb('--orange-300'),
          400: rgb('--orange-400'),
        },
      },
    },
  },
  plugins: [],
};
