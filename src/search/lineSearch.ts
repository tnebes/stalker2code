import { REGEX } from "../constants";

export function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findInLines(
  symbol: string,
  lines: string[],
  parentPath: string[],
  strict: boolean = false,
  excludeLine?: number
): { line: number } | null {
  function findRecursive(
    symbolName: string,
    path: string[],
    startIdx: number,
    endIdx: number
  ): { line: number } | null {
    if (path.length === 0) {
      // Global search in this range
      const escapedSymbol = escapeRegExp(symbolName);
      const structRegex = new RegExp(
        `^\\s*${escapedSymbol}\\s*[:=]\\s*struct\\.begin:?`,
        "i"
      );
      const sidRegex = new RegExp(`sid\\s*=\\s*"?${escapedSymbol}"?\\s*$`, "i");
      const assignmentRegex = new RegExp(`^\\s*${escapedSymbol}\\s*[=:]`, "i");

      // Pass 1: Highest priority (Structs)
      for (let i = startIdx; i <= endIdx; i++) {
        if (excludeLine !== undefined && i === excludeLine) continue;
        if (structRegex.test(lines[i])) return { line: i };
      }

      // Pass 2: High priority (SIDs)
      for (let i = startIdx; i <= endIdx; i++) {
        if (excludeLine !== undefined && i === excludeLine) continue;
        if (sidRegex.test(lines[i])) return { line: i };
      }

      // Pass 3: Low priority (Generic assignments)
      if (!strict) {
        for (let i = startIdx; i <= endIdx; i++) {
          if (excludeLine !== undefined && i === excludeLine) continue;
          if (assignmentRegex.test(lines[i])) return { line: i };
        }
      }
      return null;
    }

    const currentParent = path[0];
    const remainingPath = path.slice(1);
    const escapedParent = escapeRegExp(currentParent);
    const parentRegex = new RegExp(
      `^\\s*${escapedParent}\\s*[:=]\\s*struct\\.begin`,
      "i"
    );

    for (let i = startIdx; i <= endIdx; i++) {
      if (parentRegex.test(lines[i])) {
        // Found the start of the parent struct, find its end
        let depth = 1;
        for (let j = i + 1; j <= endIdx; j++) {
          if (REGEX.STRUCT_BEGIN.test(lines[j])) depth++;
          if (REGEX.STRUCT_END.test(lines[j])) {
            depth--;
            if (depth === 0) {
              // Recursively search in this body
              return findRecursive(symbolName, remainingPath, i + 1, j - 1);
            }
          }
        }
      }
    }
    return null;
  }

  return findRecursive(symbol, parentPath, 0, lines.length - 1);
}
