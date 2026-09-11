/**
 * Encode key names into the bytes a terminal sends for them, so a PTY test
 * writes `press("down")` or `press(["ctrl", "e"])` instead of escape sequences.
 * The table follows xterm: CSI arrows, SS3 F1-F4, tilde-form editing keys,
 * ctrl+letter as the C0 control byte, alt as an ESC prefix, and CSI u for
 * ctrl with enter/tab/backspace/escape (the only combos plain bytes cannot say).
 * Not built on @opentui/core/testing KeyCodes: that table targets the mock
 * renderer (backspace is 0x08 there, xterm sends 0x7f) and has no chord encoder.
 */

/** Named keys and their byte sequences; letters and other printables are sent as themselves. */
const PTY_KEY_SEQUENCES = {
  enter: "\r",
  return: "\r",
  escape: "\x1b",
  tab: "\t",
  space: " ",
  backspace: "\x7f",
  delete: "\x1b[3~",
  insert: "\x1b[2~",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
  f5: "\x1b[15~",
  f6: "\x1b[17~",
  f7: "\x1b[18~",
  f8: "\x1b[19~",
  f9: "\x1b[20~",
  f10: "\x1b[21~",
  f11: "\x1b[23~",
  f12: "\x1b[24~",
} as const;

/** A key the table names, such as "down" or "f5". */
type PtyNamedKey = keyof typeof PTY_KEY_SEQUENCES;

/** A modifier that can prefix a chord: ["ctrl", "e"], ["alt", "n"], ["shift", "tab"]. */
type PtyKeyModifier = "ctrl" | "alt" | "shift";

/**
 * One key press: a named key, a single printable character, or a chord whose
 * last element is the key and whose earlier elements are modifiers.
 */
export type PtyKeyPress = string | [...PtyKeyModifier[], string];

/** Legacy CSI u code points for the keys whose ctrl form has no plain byte (return aliases enter). */
const CSI_U_CODE_POINTS = new Map([
  ["enter", 13],
  ["return", 13],
  ["tab", 9],
  ["backspace", 127],
  ["escape", 27],
]);

const MODIFIERS: ReadonlySet<string> = new Set<PtyKeyModifier>(["ctrl", "alt", "shift"]);

function isModifier(token: string): token is PtyKeyModifier {
  return MODIFIERS.has(token);
}

function isNamedKey(token: string): token is PtyNamedKey {
  return Object.hasOwn(PTY_KEY_SEQUENCES, token);
}

/** The xterm modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). */
function csiModifierParameter(modifiers: ReadonlySet<PtyKeyModifier>): number {
  return (
    1 +
    (modifiers.has("shift") ? 1 : 0) +
    (modifiers.has("alt") ? 2 : 0) +
    (modifiers.has("ctrl") ? 4 : 0)
  );
}

/**
 * The bytes a terminal sends for `press`. Throws when a chord names a key that
 * cannot carry its modifiers, so a typo fails loudly instead of typing garbage.
 */
export function encodePtyKeyPress(press: PtyKeyPress): string {
  if (!Array.isArray(press)) return encodeSingleKey(press, new Set());
  const key = press[press.length - 1];
  const modifiers = new Set<PtyKeyModifier>();

  for (const token of press.slice(0, -1)) {
    if (!isModifier(token)) throw new Error(`PTY key chord has an unknown modifier "${token}"`);
    modifiers.add(token);
  }
  if (key === undefined) throw new Error("PTY key chord is empty");

  return encodeSingleKey(key, modifiers);
}

function encodeSingleKey(key: string, modifiers: ReadonlySet<PtyKeyModifier>): string {
  const prefix = modifiers.has("alt") ? "\x1b" : "";

  if (modifiers.has("ctrl")) {
    if (key.length === 1 && /[a-z]/i.test(key)) {
      return prefix + String.fromCharCode(key.toLowerCase().charCodeAt(0) & 0x1f);
    }
    const codePoint = CSI_U_CODE_POINTS.get(key);

    if (codePoint === undefined) {
      throw new Error(
        `PTY key chord cannot send ctrl with "${key}"; use a letter, enter, tab, backspace, or escape`,
      );
    }

    return `\x1b[${codePoint};${csiModifierParameter(modifiers)}u`;
  }
  if (isNamedKey(key)) {
    const sequence = PTY_KEY_SEQUENCES[key];

    if (modifiers.has("shift") && key === "tab") return `${prefix}\x1b[Z`;
    if (modifiers.has("shift") && sequence.startsWith("\x1b[") && /[A-Z]$/.test(sequence)) {
      return `${prefix}\x1b[1;${csiModifierParameter(modifiers)}${sequence.slice(-1)}`;
    }

    return prefix + sequence;
  }
  if (key.length !== 1)
    throw new Error(`PTY key press "${key}" is neither a named key nor one character`);

  return prefix + (modifiers.has("shift") ? key.toUpperCase() : key);
}
