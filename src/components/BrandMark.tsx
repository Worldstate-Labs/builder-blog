export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 40 40" role="img" focusable="false">
        <path
          d="M12 30V10h17v4.8H17.8v5.1H28v4.7H17.8V30H12Z"
          fill="currentColor"
        />
        <path
          d="M29 11h3.5v12.2c0 5.5-4.5 10-10 10H16"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.35"
          opacity="0.72"
        />
      </svg>
    </span>
  );
}
