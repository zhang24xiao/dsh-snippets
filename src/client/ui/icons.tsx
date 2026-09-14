/**
 * The `</>` glyph for the sidebar-foot trigger.
 *
 * Hand-drawn rather than taken from `@deepseek-ai/dsh-client-ui-primitives`,
 * for two reasons: the shared set has no `</>` mark — its nearest neighbour,
 * `IconCodeOutline16`, is drawn as a `#` — and the SiYuan original this plugin
 * mirrors puts a literal `</>` on its toolbar button. The outline stroke style
 * matches the neighbouring glyphs, and the colour rides `currentColor` so the
 * trigger's hover and active states carry through.
 *
 * (`dsh-remote-web-ui` takes the same route for its phone glyph.)
 */

/** Props, mirroring the shared icon set's `IconProps`. */
export interface CodeGlyphProps {
  /** Square edge in px. */
  size?: number
  /** Extra class for layout placement. */
  className?: string
}

/**
 * Render the code glyph.
 * @param props - size and optional class.
 * @returns the svg element.
 */
export function CodeGlyph({ size = 16, className }: CodeGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Left chevron */}
      <path
        d="M5.1 3.9 1.9 8l3.2 4.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right chevron */}
      <path
        d="m10.9 3.9 3.2 4.1-3.2 4.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Separating slash */}
      <path
        d="M9.35 2.9 6.65 13.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
