/**
 * Whether a model id is temporary.
 * The backend deletes temporary models on a timer. The collaboration button uses this before sharing a link.
 */

/** Returns true if the model ID is a temporary (auto-cleanup) model. */
export function isTemporaryModel(id: string | null): boolean {
  return id != null && id.startsWith('tmp')
}
