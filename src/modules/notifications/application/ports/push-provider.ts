/** Push notification payload sent to a provider. */
export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Provider boundary for user-targeted push delivery. */
export interface PushProvider {
  readonly isConfigured: boolean;
  send(aliases: string[], message: PushMessage): Promise<void>;
}
