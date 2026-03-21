function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();

  return normalized ? normalized : null;
}

export function isAdminEmail(
  userEmail: string | null | undefined,
  adminEmail: string | null | undefined,
) {
  const normalizedUserEmail = normalizeEmail(userEmail);
  const normalizedAdminEmail = normalizeEmail(adminEmail);

  if (!normalizedUserEmail || !normalizedAdminEmail) {
    return false;
  }

  return normalizedUserEmail === normalizedAdminEmail;
}
