export function PlaneIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      {/* Why: a monochrome board glyph rather than Plane's colour mark, so the
      provider list reads as one set the way JiraIcon and LinearIcon do. */}
      <rect x="2.5" y="4" width="4.5" height="16" rx="1.25" />
      <rect x="9.75" y="4" width="4.5" height="11" rx="1.25" />
      <rect x="17" y="4" width="4.5" height="7" rx="1.25" />
    </svg>
  )
}
