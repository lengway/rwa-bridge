export function russianActionError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return /[А-Яа-яЁё]/.test(message) ? message : fallback;
}
