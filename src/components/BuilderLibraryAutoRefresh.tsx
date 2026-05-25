"use client";

import { UserDataAutoRefresh } from "@/components/UserDataAutoRefresh";

type BuilderLibraryAutoRefreshProps = {
  initialVersion?: string;
};

export function BuilderLibraryAutoRefresh(props: BuilderLibraryAutoRefreshProps) {
  return <UserDataAutoRefresh {...props} />;
}
