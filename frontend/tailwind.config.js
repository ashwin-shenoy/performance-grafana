/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // Override defaults (not extend) so ALL rounded/shadow utils are flat
    borderRadius: {
      'none':  '0',
      DEFAULT: '0',
      sm:      '0',
      md:      '0',
      lg:      '0',
      xl:      '0',
      '2xl':   '0',
      '3xl':   '0',
      full:    '9999px',   // keep for pulse dots / spinners
    },
    boxShadow: {
      none:    'none',
      sm:      'none',
      DEFAULT: 'none',
      md:      'none',
      lg:      'none',
      xl:      'none',
      '2xl':   'none',
      inner:   'none',
      // One lightweight drop-shadow for floating elements (dropdown menus)
      dropdown: '0 2px 6px rgba(0,0,0,0.20)',
    },
    extend: {
      colors: {
        // ── IBM Carbon Design System — Blue ──────────────────────
        'cds-blue-10':  '#edf5ff',
        'cds-blue-20':  '#d0e2ff',
        'cds-blue-30':  '#a6c8ff',
        'cds-blue-40':  '#78a9ff',
        'cds-blue-50':  '#4589ff',
        'cds-blue-60':  '#0f62fe',   // Interactive / Primary
        'cds-blue-70':  '#0043ce',   // Hover
        'cds-blue-80':  '#002d9c',   // Active / pressed
        'cds-blue-90':  '#001d6c',
        // ── IBM Carbon Design System — Gray ──────────────────────
        'cds-gray-10':  '#f4f4f4',   // UI background
        'cds-gray-20':  '#e0e0e0',   // Subtle bg / borders
        'cds-gray-30':  '#c6c6c6',   // Disabled border
        'cds-gray-40':  '#a8a8a8',   // Placeholder
        'cds-gray-50':  '#8d8d8d',   // Subtle text / input border
        'cds-gray-60':  '#6f6f6f',   // Secondary text
        'cds-gray-70':  '#525252',   // Helper / label text
        'cds-gray-80':  '#393939',
        'cds-gray-90':  '#262626',
        'cds-gray-100': '#161616',   // Primary text (near-black)
        // ── IBM Carbon Design System — Status ────────────────────
        'cds-red-40':    '#ff8389',
        'cds-red-60':    '#da1e28',   // Error / Danger
        'cds-red-70':    '#a2191f',   // Danger hover
        'cds-green-40':  '#42be65',   // Success indicator
        'cds-green-50':  '#24a148',
        'cds-orange-40': '#ff832b',   // Warning
        'cds-purple-50': '#a56eff',
        'cds-purple-60': '#8a3ffc',   // Pending
        'cds-teal-40':   '#08bdba',   // Info / teal
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"SFMono-Regular"', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
};
