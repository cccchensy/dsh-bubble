/**
 * Host half of `dsh-bubble`.
 *
 * The whole feature lives in the browser half (`lib/client.js`): it watches the
 * process-local Session run state and plays the bundled WAV through Web Audio
 * when a whole task finishes. No Host service, Session event, or model-visible
 * capability is needed, so this half registers nothing on purpose.
 *
 * @module dsh-bubble
 */

/** Host plugin body: the browser half owns the chime. */
export function apply() {}
