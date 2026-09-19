// Tailwind v4 laeuft als PostCSS-Plugin; eine tailwind.config.js gibt es
// nicht mehr. Das Design-System steht in src/styles/theme.css.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
