/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // LeetCode-style dark palette
        surface: "#282828", // card / panel
        edge: "#3a3a3a", // borders
        edge2: "#4a4a4a",
        ink: "#f0f0f0", // primary text
        muted: "#8a8f98", // secondary text
        grind: "#2cbb5d", // LeetCode "Accepted" green (accent)
        gold: "#ffa116", // LeetCode orange — streaks / #1
        danger: "#ef4743", // LeetCode "Hard" red — errors
      },
      fontFamily: {
        // Clean system sans, like LeetCode (no more mono-everywhere).
        sans: ['"Helvetica Neue"', "system-ui", "-apple-system", "Arial", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      keyframes: {
        pop: {
          from: { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          to: { opacity: "1", transform: "none" },
        },
        grow: {
          from: { transform: "scaleY(0)" },
          to: { transform: "scaleY(1)" },
        },
      },
      animation: {
        pop: "pop 0.28s ease-out both",
      },
    },
  },
  plugins: [],
};
