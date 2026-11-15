interface StratumLogoProps {
  size?: number
  color?: string
}

/**
 * Stratum mark: two stacked diamonds joined by a folded band.
 * Geometry measured from the official brand artwork (100-unit grid, stroke ≈ 8% of the grid).
 * Height is `size`; width follows the mark's aspect ratio.
 */
export default function StratumLogo({ size = 20, color = 'currentColor' }: StratumLogoProps) {
  return (
    <svg
      viewBox="-6 -6 212 312"
      height={size}
      width={(size * 212) / 312}
      fill="none"
      stroke={color}
      strokeWidth={8}
      strokeLinejoin="miter"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M0 100 L100 0 L200 100 L100 200 L200 200 L100 300 L0 200 L100 100 Z" />
      <path d="M0 100 L100 200 M100 100 L200 200" />
    </svg>
  )
}
