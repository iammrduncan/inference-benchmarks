/**
 * The mark: three ascending bars (a leaderboard) inside the accent square; the dot over the
 * tallest is the harness, the one thing held constant.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="8" className="logo-bg" />
      <rect x="7.5" y="17" width="4.5" height="8" rx="1.5" className="logo-bar" opacity="0.55" />
      <rect x="13.75" y="12.5" width="4.5" height="12.5" rx="1.5" className="logo-bar" opacity="0.8" />
      <rect x="20" y="10" width="4.5" height="15" rx="1.5" className="logo-bar" />
      <circle cx="22.25" cy="6" r="2" className="logo-dot" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-word"><b>inference</b><span>benchmarks</span></span>
    </span>
  );
}
