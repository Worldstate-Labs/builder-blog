"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { AddBuilderForm } from "@/components/AddBuilderForm";
import { builderLibraryBuilderAdded } from "@/lib/builder-library-events";

type SourceOption = {
  id: string;
  label: string;
};

export function PrivateLibraryPanel({
  title,
  count,
  sourceOptions,
  visibilityToggle,
  children,
}: {
  title: string;
  count: number;
  sourceOptions: SourceOption[];
  visibilityToggle?: ReactNode;
  children: ReactNode;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onBuilderAdded() {
      setAddOpen(false);
    }
    window.addEventListener(builderLibraryBuilderAdded, onBuilderAdded);
    return () =>
      window.removeEventListener(builderLibraryBuilderAdded, onBuilderAdded);
  }, []);

  function toggleAdd(event: React.MouseEvent<HTMLButtonElement>) {
    // Prevent the surrounding <details> from toggling when the user clicks
    // the in-summary Add source button.
    event.preventDefault();
    event.stopPropagation();
    setAddOpen((open) => !open);
  }

  return (
    <details ref={detailsRef} className="library-section-panel" open>
      <summary className="library-section-summary">
        <div>
          <h2 className="fb-section-heading">{title}</h2>
        </div>
        <div className="library-section-meta">
          <span className="fb-kind-pill">{count} sources</span>
          {visibilityToggle}
          <button
            aria-expanded={addOpen}
            aria-label={addOpen ? "Close add source" : "Add source"}
            className="fb-btn dark compact"
            onClick={toggleAdd}
            type="button"
          >
            {addOpen ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {addOpen ? "Close" : "Add source"}
          </button>
        </div>
      </summary>
      <div className="library-section-body">
        {addOpen ? (
          <div className="fb-panel mb-3">
            <AddBuilderForm sourceOptions={sourceOptions} />
          </div>
        ) : null}
        {children}
      </div>
    </details>
  );
}
