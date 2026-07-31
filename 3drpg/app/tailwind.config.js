/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* CORESAPIAN runic CRT tokens (design.md §2) */
        void: "rgb(var(--void-rgb) / <alpha-value>)",
        abyss: "rgb(var(--abyss-rgb) / <alpha-value>)",
        stone: {
          DEFAULT: "rgb(var(--stone-rgb) / <alpha-value>)",
          2: "rgb(var(--stone-2-rgb) / <alpha-value>)",
        },
        iron: {
          DEFAULT: "rgb(var(--iron-rgb) / <alpha-value>)",
          2: "rgb(var(--iron-2-rgb) / <alpha-value>)",
        },
        bone: {
          DEFAULT: "rgb(var(--bone-rgb) / <alpha-value>)",
          dim: "rgb(var(--bone-dim-rgb) / <alpha-value>)",
        },
        ash: "rgb(var(--ash-rgb) / <alpha-value>)",
        phosphor: {
          DEFAULT: "rgb(var(--phosphor-rgb) / <alpha-value>)",
          hi: "rgb(var(--phosphor-hi-rgb) / <alpha-value>)",
          dim: "rgb(var(--phosphor-dim-rgb) / <alpha-value>)",
        },
        ice: "rgb(var(--ice-rgb) / <alpha-value>)",
        soul: "rgb(var(--soul-rgb) / <alpha-value>)",
        blood: {
          DEFAULT: "rgb(var(--blood-rgb) / <alpha-value>)",
          hi: "rgb(var(--blood-hi-rgb) / <alpha-value>)",
        },
        galdr: "rgb(var(--galdr-rgb) / <alpha-value>)",
        realm: {
          midgard: "rgb(var(--realm-midgard-rgb) / <alpha-value>)",
          jotunheim: "rgb(var(--realm-jotunheim-rgb) / <alpha-value>)",
          niflheim: "rgb(var(--realm-niflheim-rgb) / <alpha-value>)",
          muspelheim: "rgb(var(--realm-muspelheim-rgb) / <alpha-value>)",
          alfheim: "rgb(var(--realm-alfheim-rgb) / <alpha-value>)",
          svartalfheim: "rgb(var(--realm-svartalfheim-rgb) / <alpha-value>)",
          vanaheim: "rgb(var(--realm-vanaheim-rgb) / <alpha-value>)",
          asgard: "rgb(var(--realm-asgard-rgb) / <alpha-value>)",
          helheim: "rgb(var(--realm-helheim-rgb) / <alpha-value>)",
        },
        /* shadcn semantic tokens (compat with src/components/ui) */
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      fontFamily: {
        display: ["Cinzel", "serif"],
        runic: ["'Noto Sans Runic'", "monospace"],
        norse: ["'Uncial Antiqua'", "cursive"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      maxWidth: {
        content: "1280px",
        reading: "720px",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "phosphor-glow": "0 0 24px rgb(var(--phosphor-rgb) / 0.35)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
