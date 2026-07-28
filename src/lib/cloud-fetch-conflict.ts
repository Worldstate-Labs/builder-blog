export type CloudFetchConflictCode =
  | "reset_fenced"
  | "cloud_run_not_running"
  | "cloud_source_already_finalized"
  | "cloud_source_finalize_race"
  | "cloud_lease_expired"
  | "cloud_source_result_incomplete";

export class CloudFetchConflictError extends Error {
  readonly statusCode = 409;

  constructor(
    readonly code: CloudFetchConflictCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CloudFetchConflictError";
  }
}

export function cloudFetchConflictBody(error: {
  message: string;
  code: CloudFetchConflictCode;
  retryable: boolean;
}) {
  return {
    error: error.message,
    code: error.code,
    retryable: error.retryable,
  };
}
