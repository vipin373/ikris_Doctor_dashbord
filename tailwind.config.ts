import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#EEF2FA",
          100: "#DCE4F4",
          200: "#B6C5E6",
          300: "#869FD2",
          400: "#5677B8",
          500: "#34559C",
          600: "#24417F",
          700: "#1C346A",
          800: "#172A5C",
          900: "#101E43",
        },
        ink: { DEFAULT: "#0F172A", muted: "#475569", soft: "#64748B" },
        line: "#E2E8F0",
        canvas: "#F6F8FB",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
