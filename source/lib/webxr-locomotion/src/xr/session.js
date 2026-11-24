// Entering the session (README.md § Comfort → Session hygiene).

/** local-floor is required; hand tracking (for the wrist panel and joint pinches) and layers are optional. */
export const SESSION_INIT = Object.freeze({
  requiredFeatures: ['local-floor'],
  optionalFeatures: ['hand-tracking', 'layers'],
});

/**
 * Requests the immersive-vr session. Call it directly inside a click (or other user-activation) handler, before
 * any await: Safari only grants an immersive session from inside a user activation. [M] xrStore.js:4-6
 * @returns {Promise<XRSession>}
 */
export function enterVR({ xr = globalThis.navigator?.xr, init = SESSION_INIT } = {}) {
  if (!xr) return Promise.reject(new Error('WebXR is not available in this browser'));
  return xr.requestSession('immersive-vr', init);
}

/** Whether the session was granted hand tracking. */
export function handTrackingGranted(session) {
  if (Array.isArray(session?.enabledFeatures)) return session.enabledFeatures.includes('hand-tracking');
  return [...(session?.inputSources ?? [])].some((source) => !!source.hand);
}

/** The base reference space every pose is read in. */
export const requestBaseSpace = (session) => session.requestReferenceSpace('local-floor');
