import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { REGEX, SEARCH_LIMITS } from "../constants";
import { BlockContext } from "./types";
import { findInLines } from "./lineSearch";
import { findModRoot } from "./pathUtils";
import {
  findFileExact,
  findSymbolInFileLoc,
  findSymbolInFileByName,
  findDefinition,
  searchGlobalWithPriority,
} from "./fileSearch";

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

  if (fileName.includes("_")) {
    let rootPart = fileName.split("_")[0];
    if (REGEX.CFG_FILE_EXT.test(rootPart)) {
      baseFileNames.push(rootPart);
    } else {
      baseFileNames.push(rootPart + ".cfg");
    }
  }

  baseFileNames = [...new Set(baseFileNames)].filter((n) => n !== fileName);

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
    if (baseFileDef && baseFileDef.uri.fsPath !== document.uri.fsPath) {
      outputChannel.appendLine(`  MATCH found in base file: ${bName}`);
      return baseFileDef;
    }
  }

  // Tier 1.5: Mod-Local Search
  const isGeneric = /^\[(\d+|\*)\]$/.test(word);
  if (isGeneric) {
    outputChannel.appendLine(
      `Symbol '${word}' is generic. Skipping mod-local and global search tiers to avoid pollution.`
    );
    return null;
  }

  const modRoot = findModRoot(document.fileName);
  if (modRoot) {
    outputChannel.appendLine(`Tier 1.5: Searching in mod root: ${modRoot}`);
    const localStrict = await findDefinition(
      word,
      modRoot,
      token,
      parentContext,
      outputChannel,
      true,
      document.fileName
    );
    if (localStrict) return localStrict;

    if (parentContext.length > 0) {
      outputChannel.appendLine(
        `  1.5b: Retrying MOD search with global context (empty parent path)`
      );
      const localGlobalStrict = await findDefinition(
        word,
        modRoot,
        token,
        [],
        outputChannel,
        true,
        document.fileName
      );
      if (localGlobalStrict) return localGlobalStrict;
    }
  }

  // Tier 2 & 3: Global Search
  outputChannel.appendLine(
    `Global Search Pass 1: Prioritizing Structs and SIDs...`
  );
  const highPriRes = await searchGlobalWithPriority(
    word,
    resourcesPath,
    token,
    parentContext,
    outputChannel,
    true,
    document.fileName
  );
  if (highPriRes) return highPriRes;

  if (parentContext.length > 0) {
    outputChannel.appendLine(
      `Global Search Pass 1b: Retrying global search with empty parent path...`
    );
    const globalStrictNoPath = await searchGlobalWithPriority(
      word,
      resourcesPath,
      token,
      [],
      outputChannel,
      true,
      document.fileName
    );
    if (globalStrictNoPath) return globalStrictNoPath;
  }

  outputChannel.appendLine(
    `Global Search Pass 2: Checking generic assignments...`
  );
  const lowPriRes = await searchGlobalWithPriority(
    word,
    resourcesPath,
    token,
    parentContext,
    outputChannel,
    false,
    document.fileName
  );
  if (lowPriRes) return lowPriRes;

  const elapsed = Date.now() - startTime;
  if (elapsed > SEARCH_LIMITS.TIMEOUT_MS) {
    outputChannel.appendLine(`Search TIMEOUT reached after ${elapsed}ms.`);
  }

  return null;
}
