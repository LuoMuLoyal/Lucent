export function getEnvFilePaths(): string[] {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  return [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env.local', '.env'];
}
