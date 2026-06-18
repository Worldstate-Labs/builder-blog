import Link from "next/link";
import { Home, Search } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

export default function WorkspaceNotFound() {
  return (
    <div className="page-pad page-pad--reading workspace-not-found">
      <PageHeader
        title="Page not found"
        description="This page may be unavailable or outside your Sources and imported AI Digest collections."
      />
      <div className="workspace-content-stack">
        <EmptyState
          actions={
            <div className="workspace-not-found-actions">
              <Link className="fb-btn dark" href="/dashboard">
                <Home aria-hidden="true" />
                Home
              </Link>
              <Link className="fb-btn light" href="/search">
                <Search aria-hidden="true" />
                Search
              </Link>
            </div>
          }
          className="workspace-not-found-empty"
          title="Nothing to open here"
          body="Search sources, posts, and AI Digest issues."
        />
      </div>
    </div>
  );
}
