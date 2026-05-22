export function isCronAuthorized(request: Request) {
  const configured = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  return Boolean(configured && auth === `Bearer ${configured}`);
}
