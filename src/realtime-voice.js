/*
 * Mike AI realtime voice is owned by src/main.jsx.
 *
 * This module is intentionally a no-op. An older version installed a second
 * click handler on .voice-box, which intercepted the React button event and
 * made the microphone appear unresponsive on mobile Safari.
 *
 * Keep this file so older deployments or automated wiring can safely include
 * it without creating a second realtime session or competing event handler.
 */
export {};