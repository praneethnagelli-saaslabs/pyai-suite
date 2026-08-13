/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f4f6f8",
          100: "#e6ebf0",
          200: "#c9d3de",
          300: "#9aabbd",
          400: "#6b8199",
          500: "#4a6078",
          600: "#364a60",
          700: "#273849",
          800: "#1a2735",
          900: "#111b26",
          950: "#0a1118",
        },
        accent: {
          DEFAULT: "#0d9488",
          soft: "#ccfbf1",
          strong: "#0f766e",
        },
        status: {
          pass: "#15803d",
          warn: "#b45309",
          block: "#b91c1c",
          running: "#0369a1",
        },
      },
      fontFamily: {
        sans: ["Sora", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "0 8px 24px rgba(17, 27, 38, 0.06)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 220ms ease-out",
      },
    },
  },
  plugins: [
    function panelPlugin({ addComponents }) {
      addComponents({
        ".panel": {
          borderRadius: "0.75rem",
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "rgba(201, 211, 222, 0.9)",
          backgroundColor: "rgba(255, 255, 255, 0.92)",
          boxShadow: "0 8px 24px rgba(17, 27, 38, 0.06)",
          backdropFilter: "blur(8px)",
        },
      });
    },
  ],
};
