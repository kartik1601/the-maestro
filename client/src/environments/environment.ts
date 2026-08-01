export const environment = {
  production: false,
  apiBase: 'http://localhost:4000/api',

  /**
   * Must match ADMIN_PORTAL_PATH in server/.env. The admin login route is mounted
   * under this segment on both sides; anything else 404s, so the portal is not
   * discoverable by browsing.
   */
  adminPortalPath: 'portal-dev-only',
};
