export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T | null;
  meta?: Record<string, unknown>;
}

export function successEnvelope<T>(data: T): ApiEnvelope<T> {
  return {
    code: 'OK',
    message: '',
    data,
  };
}

export function errorEnvelope(
  code: string,
  message: string,
): ApiEnvelope<never> {
  return {
    code,
    message,
    data: null,
  };
}
