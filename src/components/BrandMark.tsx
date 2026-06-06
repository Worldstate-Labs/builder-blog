export function BrandMark({
  className = "",
  size = "default",
}: {
  className?: string;
  size?: "default" | "dark";
}) {
  const base = size === "dark" ? "fb-dark-mark serif" : "fb-mark serif";
  return (
    <span aria-hidden="true" className={`${base} ${className}`.trim()}>
      F
    </span>
  );
}
