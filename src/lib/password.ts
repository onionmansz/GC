// Keep in sync with Supabase Auth → "Minimum password length" (README).
export const MIN_PASSWORD_LENGTH = 10

/** Returns a message for the first problem, or null if the new password is acceptable. */
export function checkNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password.trim() !== password) return "Password can't start or end with a space."
  if (password !== confirm) return "The passwords don't match."
  return null
}
