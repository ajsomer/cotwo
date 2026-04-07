/**
 * Coviu-branded SurveyJS theme.
 * Based on default-light with Coviu teal palette, Inter font, and soft rounded panels.
 * Applied to both the patient-facing form renderer and the Creator preview.
 */
export const coviuTheme = {
  themeName: "default",
  colorPalette: "light",
  isPanelless: false,
  cssVariables: {
    // Primary — Coviu teal
    "--sjs-primary-backcolor": "rgba(42, 191, 191, 1)",
    "--sjs-primary-backcolor-dark": "rgba(31, 168, 168, 1)",
    "--sjs-primary-backcolor-light": "rgba(42, 191, 191, 0.1)",
    "--sjs-primary-forecolor": "rgba(255, 255, 255, 1)",
    "--sjs-primary-forecolor-light": "rgba(255, 255, 255, 0.25)",

    // Secondary — Coviu amber
    "--sjs-secondary-backcolor": "rgba(212, 136, 43, 1)",
    "--sjs-secondary-backcolor-light": "rgba(212, 136, 43, 0.1)",
    "--sjs-secondary-backcolor-semi-light": "rgba(212, 136, 43, 0.25)",
    "--sjs-secondary-forecolor": "rgba(255, 255, 255, 1)",
    "--sjs-secondary-forecolor-light": "rgba(255, 255, 255, 0.25)",

    // Backgrounds — soft gray page, white panels (panels pop against the page)
    "--sjs-general-backcolor": "rgba(255, 255, 255, 1)",
    "--sjs-general-backcolor-dark": "rgba(248, 248, 246, 1)",
    "--sjs-general-backcolor-dim": "rgba(248, 248, 246, 1)",
    "--sjs-general-backcolor-dim-light": "rgba(252, 252, 251, 1)",
    "--sjs-general-backcolor-dim-dark": "rgba(240, 239, 237, 1)",

    // Foreground — Coviu gray palette
    "--sjs-general-forecolor": "rgba(44, 44, 42, 0.91)",
    "--sjs-general-forecolor-light": "rgba(138, 137, 133, 1)",
    "--sjs-general-dim-forecolor": "rgba(44, 44, 42, 0.91)",
    "--sjs-general-dim-forecolor-light": "rgba(138, 137, 133, 1)",

    // Borders — soft Coviu gray
    "--sjs-border-default": "rgba(226, 225, 222, 0.6)",
    "--sjs-border-light": "rgba(240, 239, 237, 1)",
    "--sjs-border-inside": "rgba(0, 0, 0, 0.08)",

    // Shadows — soft elevation on panels
    "--sjs-shadow-small": "0px 1px 2px 0px rgba(0, 0, 0, 0.08)",
    "--sjs-shadow-small-reset": "0px 0px 0px 0px rgba(0, 0, 0, 0)",
    "--sjs-shadow-medium": "0px 2px 8px 0px rgba(0, 0, 0, 0.06)",
    "--sjs-shadow-large": "0px 8px 16px 0px rgba(0, 0, 0, 0.06)",
    "--sjs-shadow-inner": "inset 0px 1px 2px 0px rgba(0, 0, 0, 0.06)",
    "--sjs-shadow-inner-reset": "inset 0px 0px 0px 0px rgba(0, 0, 0, 0)",

    // Status colors — Coviu palette
    "--sjs-special-red": "rgba(226, 75, 74, 1)",
    "--sjs-special-red-light": "rgba(226, 75, 74, 0.1)",
    "--sjs-special-red-forecolor": "rgba(255, 255, 255, 1)",
    "--sjs-special-green": "rgba(29, 158, 117, 1)",
    "--sjs-special-green-light": "rgba(29, 158, 117, 0.1)",
    "--sjs-special-green-forecolor": "rgba(255, 255, 255, 1)",
    "--sjs-special-blue": "rgba(59, 139, 212, 1)",
    "--sjs-special-blue-light": "rgba(59, 139, 212, 0.1)",
    "--sjs-special-blue-forecolor": "rgba(255, 255, 255, 1)",
    "--sjs-special-yellow": "rgba(212, 136, 43, 1)",
    "--sjs-special-yellow-light": "rgba(212, 136, 43, 0.1)",
    "--sjs-special-yellow-forecolor": "rgba(255, 255, 255, 1)",

    // Layout — rounded, spacious
    "--sjs-base-unit": "8px",
    "--sjs-corner-radius": "12px",
    "--sjs-font-family": "Inter, sans-serif",

    // Font sizes
    "--sjs-font-size": "14px",

    // Question title
    "--sjs-article-font-default-fontWeight": "500",
    "--sjs-article-font-default-fontStyle": "normal",
    "--sjs-article-font-default-fontStretch": "normal",
    "--sjs-article-font-default-letterSpacing": "0",
    "--sjs-article-font-default-lineHeight": "1.5",
    "--sjs-article-font-default-paragraphIndent": "0px",
    "--sjs-article-font-default-textDecoration": "none",
  },
} as const;
