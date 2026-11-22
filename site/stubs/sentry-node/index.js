// SPDX-License-Identifier: Apache-2.0
// Lighthouse imports @sentry/node only when error reporting is turned on (core/lib/sentry.js), and the site's
// checks never turn it on. This stand-in keeps that optional package, and the licence of its dependency tree,
// out of site/package-lock.json. Every function does nothing and nothing is sent anywhere.
const nothing = () => undefined;
export const init = nothing;
export const setTags = nothing;
export const setExtras = nothing;
export const setContext = nothing;
export const addBreadcrumb = nothing;
export const captureMessage = nothing;
export const captureException = nothing;
export const withScope = (callback) => callback({ setLevel: nothing, setTags: nothing, setExtras: nothing, setContext: nothing });
