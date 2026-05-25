export function BrandMark({
  className = "",
  size = "default",
}: {
  className?: string;
  size?: "default" | "dark";
}) {
  const base = size === "dark" ? "fb-dark-mark serif" : "fb-mark serif";
  return (
    <span className={`${base} ${className}`.trim()} aria-hidden="true">
      F
    </span>
  );
}
