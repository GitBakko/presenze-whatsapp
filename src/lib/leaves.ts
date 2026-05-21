/**
 * Back-compat shim. Source of truth moved to `src/lib/leaves/`.
 * This file will be removed once all callsites import from `@/lib/leaves/*`
 * (deferred cleanup phase per spec).
 */
export * from "./leaves/index";
