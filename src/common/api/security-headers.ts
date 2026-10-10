/**
 * Security-header policy that depends on how the deployment is actually
 * reached, rather than on how it would ideally be reached.
 *
 * Helmet enables `upgrade-insecure-requests` in its default CSP and emits
 * `Strict-Transport-Security` unconditionally. Both are only meaningful when
 * the response travels over TLS:
 *
 * - `upgrade-insecure-requests` rewrites every a-priori-insecure subresource
 *   URL to `https://`. On a plain-HTTP public origin the browser therefore
 *   requests `/admin/assets/*.js` and `*.css` over TLS, the handshake fails,
 *   and the admin console (and the Scalar page at `/api/docs`) renders a blank
 *   page with an empty `#root`. Loopback counts as a potentially trustworthy
 *   origin and is exempt, so local development never reproduces it.
 * - `Strict-Transport-Security` is ignored by browsers when it arrives over a
 *   non-secure transport, so emitting it on plain HTTP is noise.
 *
 * `PUBLIC_BASE_URL` is the deployment's own statement of the origin clients
 * use, so its scheme decides whether those HTTPS-only headers apply.
 */
export interface HttpsOnlyHeaderPolicy {
  /**
   * CSP directives to merge into Helmet's defaults. `null` is Helmet's
   * "remove this default directive" value.
   */
  readonly cspDirectives: Readonly<Record<string, null>>;
  /** Value for Helmet's `hsts` option. */
  readonly hsts: boolean;
}

/**
 * Resolves the HTTPS-only header policy from the configured public URL.
 *
 * A blank or non-`https` value yields the plain-HTTP policy: on such a
 * deployment the HTTPS-only headers cannot work and `upgrade-insecure-requests`
 * actively breaks same-origin asset loading.
 */
export function resolveHttpsHeaderPolicy(
  publicBaseUrl: string,
): HttpsOnlyHeaderPolicy {
  if (publicBaseUrl.trim().toLowerCase().startsWith('https://')) {
    return { cspDirectives: {}, hsts: true };
  }

  return { cspDirectives: { 'upgrade-insecure-requests': null }, hsts: false };
}
