/**
 * Tab filenames use the .ump extension on disk and in compiler messages.
 * ensureUmpExt adds it for saves. stripUmpExt removes it for the tab label.
 */

/** Ensure a tab name has the `.ump` extension. */
export function ensureUmpExt(name: string): string {
  return name.endsWith('.ump') ? name : name + '.ump'
}

/** Strip the `.ump` extension for display purposes. */
export function stripUmpExt(name: string): string {
  return name.endsWith('.ump') ? name.slice(0, -4) : name
}
