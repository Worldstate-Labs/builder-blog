const DEFAULT_ADMIN_EMAILS = ["jie@worldstatelabs.com"];

export function adminEmails() {
  const configured = process.env.ADMIN_EMAILS?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_ADMIN_EMAILS;
}

export function isAdminEmail(email: string | null | undefined) {
  return Boolean(email && adminEmails().includes(email.toLowerCase()));
}
