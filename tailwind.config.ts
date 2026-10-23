import type { Config } from "tailwindcss";

/**
 * IKRIS design tokens — Walnut Brown · Sage Green · Amber Glow.
 *  walnut-700 #5A3E2B  sidebar / dark panels
 *  sage-400   #87A96B  content accents, active items, charts
 *  glow-500   #D5851F  primary actions, highlights
 *  canvas     #F8F6F0  warm ivory background
 *  cream      #EFE7D8  secondary surfaces
 *  ink        #29251F  deep charcoal text
 * `brand` is the accent used across existing pages; it maps to the sage scale.
 * `slate` is re-tuned to warm neutrals so every page picks up the palette.
 */
const walnut = {
  50: "#F7F2EC", 100: "#ECDFD1", 200: "#D9C2A9", 300: "#BE9B7B", 400: "#9C7656",
  500: "#7C5A40", 600: "#6A4C35", 700: "#5A3E2B", 800: "#473122", 900: "#34241A", 950: "#241811",
};
const sage = {
  50: "#F3F7EF", 100: "#E4EDDB", 200: "#C9DBB8", 300: "#A9C493", 400: "#87A96B", 500: "#6F9155",
  600: "#587443", 700: "#465C36", 800: "#38492C", 900: "#2B3822",
};
const glow = {
  50: "#FDF6EA", 100: "#FAE8CA", 200: "#F3CD90", 300: "#EAAE57", 400: "#E09A36", 500: "#D5851F",
  600: "#B56C15", 700: "#8F5413", 800: "#6F4213", 900: "#573512",
};
const warm = {
  50: "#FAF8F3", 100: "#F3EEE4", 200: "#E8E0D1", 300: "#D5CAB7", 400: "#ACA08C", 500: "#7E7363",
  600: "#5F5648", 700: "#473F35", 800: "#342E27", 900: "#29251F", 950: "#1B1814",
};

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: sage,
        sage,
        walnut,
        glow,
        slate: warm,
        ink: { DEFAULT: "#29251F", muted: "#5A5145", soft: "#776C5D" },
        line: "#E6DDCC",
        canvas: "#F8F6F0",
        cream: "#EFE7D8",
      },
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(41,37,31,0.04), 0 2px 6px -1px rgba(90,62,43,0.06), 0 10px 24px -14px rgba(90,62,43,0.18)",
        lift: "0 2px 4px rgba(41,37,31,0.05), 0 12px 24px -8px rgba(90,62,43,0.18), 0 28px 48px -24px rgba(90,62,43,0.30)",
        glow: "0 0 0 1px rgba(213,133,31,0.35), 0 8px 22px -6px rgba(213,133,31,0.55)",
        "inset-walnut": "inset 0 1px 0 rgba(255,255,255,0.06), inset -1px 0 0 rgba(0,0,0,0.25)",
        pop: "0 16px 40px -12px rgba(41,37,31,0.28), 0 4px 12px -4px rgba(41,37,31,0.12)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: { 250: "250ms", 350: "350ms" },
      keyframes: {
        rise: { from: { opacity: "0", translate: "0 10px", scale: "0.985" }, to: { opacity: "1", translate: "none", scale: "none" } },
        "pop-in": { from: { opacity: "0", transform: "translateY(-4px) scale(0.97)" }, to: { opacity: "1", transform: "none" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        shine: { from: { transform: "translateX(-120%) skewX(-20deg)" }, to: { transform: "translateX(220%) skewX(-20deg)" } },
        float: { "0%,100%": { translate: "0 0" }, "50%": { translate: "0 -8px" } },
        drift: {
          "0%,100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(3%,-2%,0) scale(1.06)" },
        },
        grow: { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
      },
      animation: {
        rise: "rise 480ms cubic-bezier(0.22,1,0.36,1) both",
        "pop-in": "pop-in 200ms cubic-bezier(0.34,1.56,0.64,1) both",
        "fade-in": "fade-in 250ms ease-out both",
        float: "float 7s ease-in-out infinite",
        drift: "drift 26s ease-in-out infinite",
        grow: "grow 900ms cubic-bezier(0.22,1,0.36,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
