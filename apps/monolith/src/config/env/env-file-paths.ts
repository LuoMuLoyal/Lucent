export function getEnvFilePaths(): string[] {
  const nodeEnv = process.env['NODE_ENV']?.trim() || 'development';
  return [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`];
}

export function getDotenvLoadOrder(): string[] {
  const nodeEnv = process.env['NODE_ENV']?.trim() || 'development';
  return [`.env.${nodeEnv}`, `.env.${nodeEnv}.local`];
}
