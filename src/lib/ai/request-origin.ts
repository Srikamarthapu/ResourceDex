/** Browsers cannot choose Host. Next may use the bind address in request.url, so
 * compare the browser Origin with the actual request Host behind the app server. */
export function hasValidRequestOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Non-browser clients still need a verified session.
  try {
    const source = new URL(origin);
    const requestHost = request.headers.get('host') ?? new URL(request.url).host;
    return ['http:', 'https:'].includes(source.protocol) && source.host === requestHost;
  } catch {
    return false;
  }
}
