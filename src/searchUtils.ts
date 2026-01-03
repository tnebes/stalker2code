import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { REGEX, SEARCH_LIMITS } from "./constants";
import { ASTManager } from "./astManager";
import { ASTNode, BlockNode } from "./parser/ast";

export interface BlockContext {
  name: string;
  refurl?: string;
  refkey?: string;
}

export function findParentStruct(
  document: vscode.TextDocument,
  position: vscode.Position
): BlockContext[] {
  const ast = ASTManager.getAST(document);

  function findParent(
    nodes: ASTNode[],
    targetPos: vscode.Position,
    currentPath: BlockContext[]
  ): BlockContext[] | null {
    for (const node of nodes) {
      if (node.type === "Block" && node.range.contains(targetPos)) {
        const block = node as BlockNode;
        // If it's on the struct.begin line, we want the parent's path, not this block
        if (block.startTokenRange.contains(targetPos)) {
          return currentPath;
        }

        const context: BlockContext = { name: block.name };
        if (block.params) {
          const urlMatch = block.params.match(REGEX.REFURL);
          if (urlMatch) context.refurl = urlMatch[1];
          const keyMatch = block.params.match(REGEX.REFKEY);
          if (keyMatch) context.refkey = keyMatch[1];
        }

        // Recurse into children
        const pathInChild = findParent(block.children, targetPos, [
          ...currentPath,
          context,
        ]);
        if (pathInChild) return pathInChild;

        return [...currentPath, context];
      }
    }
    return null;
  }

  return findParent(ast.children, position, []) || [];
}

export async function tieredSearch(
  word: string,
  document: vscode.TextDocument,
  resourcesPath: string,
  token: vscode.CancellationToken,
  parentContext: BlockContext[],
  outputChannel: vscode.OutputChannel,
  excludePosition?: vscode.Position,
  skipTier0: boolean = false
): Promise<vscode.Location | null> {
  const startTime = Date.now();
  const fileName = path.basename(document.fileName);
  const parentNames = parentContext.map((c) => c.name);

  if (!skipTier0) {
    // Tier 0: Current File Search
    outputChannel.appendLine(`Tier 0: Checking current file: ${fileName}`);
    const lines = document.getText().split(/\r?\n/);

    // 0a: Try local search if we have a parent context
    if (parentContext.length > 0) {
      outputChannel.appendLine(
        `  0a: Searching for '${word}' within local parent path: ${parentNames.join(
          " -> "
        )}`
      );
      const localLoc = findInLines(
        word,
        lines,
        parentNames,
        true,
        excludePosition?.line
      );
      if (localLoc) {
        outputChannel.appendLine(`  MATCH found in local struct!`);
        return new vscode.Location(
          document.uri,
          new vscode.Position(localLoc.line, 0)
        );
      }
    }

    // 0b: Try global search in the same file (fallback)
    outputChannel.appendLine(
      `  0b: Searching for '${word}' globally in current file`
    );
    const globalLoc = findInLines(word, lines, [], true, excludePosition?.line);
    if (globalLoc) {
      outputChannel.appendLine(`  MATCH found in current file!`);
      return new vscode.Location(
        document.uri,
        new vscode.Position(globalLoc.line, 0)
      );
    }
  } else {
    outputChannel.appendLine(`Tier 0: Skipped (Direct definition click)`);
  }

  // Tier 1a: Refurl Search (Inherited properties)
  for (let i = parentContext.length - 1; i >= 0; i--) {
    const ctx = parentContext[i];
    if (ctx.refurl) {
      outputChannel.appendLine(
        `Tier 1a: Tracing refurl: ${ctx.refurl}${
          ctx.refkey ? " (key: " + ctx.refkey + ")" : ""
        }`
      );
      const absoluteRefUrl = path.resolve(
        path.dirname(document.fileName),
        ctx.refurl
      );
      let targetFileLoc: vscode.Location | null = null;

      if (fs.existsSync(absoluteRefUrl)) {
        targetFileLoc = new vscode.Location(
          vscode.Uri.file(absoluteRefUrl),
          new vscode.Position(0, 0)
        );
      } else {
        // Try to find in resources
        targetFileLoc = await findFileExact(ctx.refurl, resourcesPath, token);
      }

      if (targetFileLoc) {
        const targetRefPath = ctx.refkey ? ctx.refkey.split("::") : [];
        const res = await findSymbolInFileLoc(
          word,
          targetFileLoc,
          targetRefPath,
          outputChannel
        );
        if (res) {
          outputChannel.appendLine(`  MATCH found in refurl: ${ctx.refurl}`);
          return res;
        }
      }
    }
  }

  // Tier 1: Base File Search (If current is a patch or we are tracing an overwrite)
  let baseFileNames: string[] = [];
  if (REGEX.CFG_PATCH_EXT.test(fileName)) {
    baseFileNames.push(fileName.replace(REGEX.CFG_PATCH_EXT, ".cfg"));
  } else if (skipTier0 && REGEX.CFG_FILE_EXT.test(fileName)) {
    baseFileNames.push(fileName);
  }

  // Add underscore-stripped version if not already present
  if (fileName.includes("_")) {
    const rootName = fileName.split("_")[0] + ".cfg";
    if (!baseFileNames.includes(rootName) && rootName !== fileName) {
      baseFileNames.push(rootName);
    }
  }

  for (const bName of baseFileNames) {
    outputChannel.appendLine(`Tier 1: Searching in base file: ${bName}`);
    const baseFileDef = await findSymbolInFileByName(
      word,
      bName,
      resourcesPath,
      token,
      parentContext,
      outputChannel
    );
    // Ensure we don't match the exact same file we are already in
    if (baseFileDef && baseFileDef.uri.fsPath !== document.uri.fsPath) {
      outputChannel.appendLine(`  MATCH found in base file: ${bName}`);
      return baseFileDef;
    }
  }

  // Tier 2 & 3: Global Search with Priorities
  // Priority 1: Structs & SIDs
  outputChannel.appendLine(
    `Global Search Pass 1: Prioritizing Structs and SIDs...`
  );
  const highPriRes = await searchGlobalWithPriority(
    word,
    resourcesPath,
    token,
    parentContext,
    outputChannel,
    true
  );
  if (highPriRes) return highPriRes;

  // Priority 2: General Assignments (Only if no parent context or previous failed)
  outputChannel.appendLine(
    `Global Search Pass 2: Checking generic assignments...`
  );
  const lowPriRes = await searchGlobalWithPriority(
    word,
    resourcesPath,
    token,
    parentContext,
    outputChannel,
    false
  );
  if (lowPriRes) return lowPriRes;

  const elapsed = Date.now() - startTime;
  if (elapsed > SEARCH_LIMITS.TIMEOUT_MS) {
    outputChannel.appendLine(`Search TIMEOUT reached after ${elapsed}ms.`);
  }

  return null;
}

async function searchGlobalWithPriority(
  symbol: string,
  resourcesPath: string,
  token: vscode.CancellationToken,
  parentContext: BlockContext[],
  outputChannel: vscode.OutputChannel,
  strict: boolean
): Promise<vscode.Location | null> {
  // Tier 2: Global Resources
  const globalDef = await findDefinition(
    symbol,
    resourcesPath,
    token,
    parentContext,
    outputChannel,
    strict
  );
  if (globalDef) {
    outputChannel.appendLine(
      `  MATCH found in global resources! (${strict ? "High" : "Low"} Priority)`
    );
    return globalDef;
  }

  // Tier 3: Workspaces
  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      const workspaceDef = await findDefinition(
        symbol,
        folder.uri.fsPath,
        token,
        parentContext,
        outputChannel,
        strict
      );
      if (workspaceDef) {
        outputChannel.appendLine(
          `  MATCH found in workspace: ${folder.name} (${
            strict ? "High" : "Low"
          } Priority)`
        );
        return workspaceDef;
      }
    }
  }
  return null;
}

export async function findSymbolInFileByName(
  symbol: string,
  filename: string,
  rootPath: string,
  token: vscode.CancellationToken,
  parentContext: BlockContext[],
  outputChannel: vscode.OutputChannel,
  strict: boolean = false
): Promise<vscode.Location | null> {
  outputChannel.appendLine(`  Locating file: ${filename}`);
  const fileLoc = await findFileExact(filename, rootPath, token);
  if (!fileLoc) {
    outputChannel.appendLine(`  File NOT FOUND: ${filename}`);
    return null;
  }

  return await findSymbolInFileLoc(
    symbol,
    fileLoc,
    parentContext.map((c) => c.name),
    outputChannel,
    strict
  );
}

export async function findSymbolInFileLoc(
  symbol: string,
  fileLoc: vscode.Location,
  parentPath: string[],
  outputChannel: vscode.OutputChannel,
  strict: boolean = false
): Promise<vscode.Location | null> {
  try {
    const content = await fs.promises.readFile(fileLoc.uri.fsPath, "utf-8");
    const lines = content.split(/\r?\n/);
    const loc = findInLines(symbol, lines, parentPath, strict);
    if (loc) {
      return new vscode.Location(fileLoc.uri, new vscode.Position(loc.line, 0));
    }
  } catch {}
  return null;
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

export async function findDefinition(
  symbol: string,
  rootPath: string,
  token: vscode.CancellationToken,
  parentContext: BlockContext[],
  outputChannel: vscode.OutputChannel,
  strict: boolean = false
): Promise<vscode.Location | null> {
  const startTime = Date.now();
  let filesChecked = 0;
  const parentPath = parentContext.map((c) => c.name);

  async function searchDir(
    dir: string,
    depth: number
  ): Promise<vscode.Location | null> {
    if (depth > SEARCH_LIMITS.MAX_DEPTH || token.isCancellationRequested)
      return null;
    if (Date.now() - startTime > SEARCH_LIMITS.TIMEOUT_MS) return null;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (
        token.isCancellationRequested ||
        Date.now() - startTime > SEARCH_LIMITS.TIMEOUT_MS
      )
        return null;
      if (filesChecked > SEARCH_LIMITS.MAX_FILES) return null;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const res = await searchDir(fullPath, depth + 1);
        if (res) return res;
      } else if (entry.isFile() && REGEX.CFG_FILE_EXT.test(entry.name)) {
        filesChecked++;
        try {
          const content = await fs.promises.readFile(fullPath, "utf-8");
          // Optimization: quick check if symbol even exists in file
          if (content.toLowerCase().includes(symbol.toLowerCase())) {
            const lines = content.split(/\r?\n/);
            const loc = findInLines(symbol, lines, parentPath, strict);
            if (loc) {
              outputChannel.appendLine(
                `  Found in: ${fullPath} (File #${filesChecked})`
              );
              return new vscode.Location(
                vscode.Uri.file(fullPath),
                new vscode.Position(loc.line, 0)
              );
            }
          }
        } catch {}
      }
    }
    return null;
  }
  return await searchDir(rootPath, 0);
}

export async function findFileExact(
  filename: string,
  rootPath: string,
  token: vscode.CancellationToken
): Promise<vscode.Location | null> {
  const targetBaseName = path.basename(filename).toLowerCase();
  const startTime = Date.now();

  async function searchDir(
    dir: string,
    depth: number
  ): Promise<vscode.Location | null> {
    if (depth > SEARCH_LIMITS.MAX_DEPTH || token.isCancellationRequested)
      return null;
    if (Date.now() - startTime > SEARCH_LIMITS.TIMEOUT_MS) return null;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (
        token.isCancellationRequested ||
        Date.now() - startTime > SEARCH_LIMITS.TIMEOUT_MS
      )
        return null;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const res = await searchDir(fullPath, depth + 1);
        if (res) return res;
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase() === targetBaseName
      ) {
        return new vscode.Location(
          vscode.Uri.file(fullPath),
          new vscode.Position(0, 0)
        );
      }
    }
    return null;
  }
  return await searchDir(rootPath, 0);
}

export function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
