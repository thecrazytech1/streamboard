/**
 * Shared bits of text items: used both by the picker, where a new one is typed,
 * and by the editor dialog, where a placed one is reworded.
 */

/** A handful of presets covers most needs without a full colour picker. */
export const TEXT_COLOURS = [
  "#ffffff",
  "#9146ff",
  "#00e701",
  "#ffd400",
  "#ff5c5c",
  "#000000",
];

/** Matches MAX_TEXT_LENGTH on the server, which enforces it. */
export const MAX_TEXT_LENGTH = 100;
