/**
 * PostCSS config para Tailwind CSS v4.
 *
 * Tailwind v4 usa o plugin `@tailwindcss/postcss` em vez do antigo `tailwindcss`
 * direto. Autoprefixer ainda é útil para browsers mais antigos.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};

export default config;
