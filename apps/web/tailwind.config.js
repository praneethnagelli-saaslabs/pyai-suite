/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        elevated: "var(--elevated)",
        interactive: "var(--interactive)",
        overlay: "var(--overlay)",
        ink: {
          50: "var(--ink-50)",
          100: "var(--ink-100)",
          200: "var(--ink-200)",
          300: "var(--ink-300)",
          400: "var(--ink-400)",
          500: "var(--ink-500)",
          600: "var(--ink-600)",
          700: "var(--ink-700)",
          800: "var(--ink-800)",
          900: "var(--ink-900)",
          950: "var(--ink-950)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
          strong: "var(--accent-strong)",
          ink: "var(--accent-ink)",
        },
        status: {
          pass: "var(--status-pass)",
          warn: "var(--status-warn)",
          block: "var(--status-block)",
          running: "var(--status-info)",
          info: "var(--status-info)",
        },
        soft: {
          pass: "var(--pass-soft)",
          warn: "var(--warn-soft)",
          block: "var(--block-soft)",
          info: "var(--info-soft)",
        },
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["2.25rem", { lineHeight: "1.12", letterSpacing: "-0.03em", fontWeight: "600" }],
        caption: ["0.6875rem", { lineHeight: "1.4", letterSpacing: "0.06em", fontWeight: "500" }],
      },
      boxShadow: {
        soft: "var(--shadow)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        spring: "var(--ease-spring)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "fade-up": "fade-up 220ms var(--ease-spring)",
        "scale-in": "scale-in 180ms var(--ease-spring)",
      },
    },
  },
  plugins: [],
};
