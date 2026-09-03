/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/pages/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f6ff",
          100: "#e2eaff",
          500: "#4f6df5",
          600: "#3d54e0",
          700: "#2f41b8",
        },
      },
    },
  },
  plugins: [],
};
