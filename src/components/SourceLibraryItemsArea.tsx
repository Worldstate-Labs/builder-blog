import type { ReactNode } from "react";

export function SourceLibraryItemsArea({
  addPanel,
  children,
  controls,
}: {
  addPanel?: ReactNode;
  children: ReactNode;
  controls?: ReactNode;
}) {
  return (
    <div className="source-library-items-area">
      {controls ? (
        <div className="source-library-items-toolbar">{controls}</div>
      ) : null}
      {addPanel}
      {children}
    </div>
  );
}
