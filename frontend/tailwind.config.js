/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        golplus: {
          blue:   { DEFAULT: '#0E4DA4', 50:'#eaf1fb',100:'#cfe0f6',200:'#a3c2ec',300:'#6e9ce0',400:'#3d77d2',500:'#1b59bf',600:'#0E4DA4',700:'#0c3f86',800:'#0a3268',900:'#082a55' },
          orange: { DEFAULT: '#F47C20', 50:'#fef3e9',100:'#fcdfc4',200:'#f9c290',300:'#f6a259',400:'#f58a36',500:'#F47C20',600:'#d9650f',700:'#b34f0d',800:'#8f3f0f',900:'#74360f' },
        },
      },
      fontFamily: { sans: ['Nunito','Poppins','ui-sans-serif','system-ui','sans-serif'] },
      borderRadius: { xl: '1rem', '2xl': '1.25rem' },
    },
  },
  plugins: [],
}
