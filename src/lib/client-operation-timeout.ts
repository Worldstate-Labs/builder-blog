export class ClientOperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientOperationTimeoutError";
  }
}

export async function runClientOperationWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: {
    timeoutMs: number;
    timeoutMessage: string;
  },
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ClientOperationTimeoutError(options.timeoutMessage));
      controller.abort();
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
