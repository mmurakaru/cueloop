/** Interpret an absolute-positioned ANSI byte stream (cursor moves plus printed text) into a grid of rows. */

const CSI = "\x1b[";

export function ansiScreenToLines(ansi: string, cols: number, rows: number): string[] {
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => " "),
  );
  let row = 0;
  let column = 0;
  let index = 0;

  const put = (character: string): void => {
    if (row >= 0 && row < rows && column >= 0 && column < cols) grid[row]![column] = character;
    column += 1;
  };

  while (index < ansi.length) {
    const character = ansi[index]!;

    if (character === "\x1b") {
      index = consumeEscape(ansi, index, (nextRow, nextColumn) => {
        if (nextRow === "clear") {
          for (const line of grid) line.fill(" ");
          row = 0;
          column = 0;
        } else {
          row = nextRow;
          column = nextColumn;
        }
      });
      continue;
    }
    if (character === "\n") {
      row += 1;
      column = 0;
    } else if (character === "\r") {
      column = 0;
    } else {
      put(character);
    }
    index += 1;
  }

  return grid.map((line) => line.join("").replace(/\s+$/, ""));
}

type EscapeEffect = (row: number | "clear", column: number) => void;

function consumeEscape(ansi: string, start: number, apply: EscapeEffect): number {
  if (ansi[start + 1] === "]") {
    const bell = ansi.indexOf("\x07", start);

    return bell === -1 ? ansi.length : bell + 1;
  }
  if (ansi.slice(start, start + CSI.length) !== CSI) return start + 1;
  let index = start + CSI.length;

  while (index < ansi.length && !/[A-Za-z]/.test(ansi[index]!)) index += 1;
  const final = ansi[index];
  const parameters = ansi.slice(start + CSI.length, index);

  if (final === "H" || final === "f") {
    const [rowParameter = "1", columnParameter = "1"] = parameters.split(";");

    apply(Math.max(0, Number(rowParameter) - 1), Math.max(0, Number(columnParameter) - 1));
  } else if (final === "J" && parameters === "2") {
    apply("clear", 0);
  }

  return index + 1;
}
