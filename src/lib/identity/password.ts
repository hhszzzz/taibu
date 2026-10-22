import bcrypt from 'bcryptjs';

/** GoTrue stored bcrypt `$2a$` hashes; bcryptjs verifies them unchanged. */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
