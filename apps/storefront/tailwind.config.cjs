// Build-time Tailwind (replaces the cdn.tailwindcss.com runtime). Tokens come from the @olmoa/ui preset.
/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('../../packages/ui/tailwind.preset.cjs')],
  content: ['./index.html', './src/**/*.{vue,ts}', '../../packages/ui/src/**/*.{vue,ts}']
};
