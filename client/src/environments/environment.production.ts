export const environment = {
  production: true,

  /** Same-origin in production — the API is served behind the same host. */
  apiBase: '/api',

  /** Replace at build time with the private value used in the server environment. */
  adminPortalPath: 'CHANGE-ME-BEFORE-DEPLOY',
};
