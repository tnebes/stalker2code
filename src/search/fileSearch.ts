import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { REGEX, SEARCH_LIMITS } from "../constants";
import { BlockContext } from "./types";
import { findInLines } from "./lineSearch";

export async function findDefinition(
  symbol: string,
  rootPath: string,
  token: vscode.CancellationToken,
  parentContext: BlockContext[],
  outputChannel: vscode.OutputChannel,
  strict: boolean = false,
  filePath?: string
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

    if (filePath) {
      const currentSubDir = path.basename(path.dirname(filePath)).toLowerCase();

      entries.sort((a, b) => {
        if (a.isDirectory() && b.isDirectory()) {
          if (a.name.toLowerCase() === currentSubDir) return -1;
          if (b.name.toLowerCase() === currentSubDir) return 1;
        }
        return 0;
      });
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

export async function searchGlobalWithPriority(
  symbol: string,
  resourcesPath: string,
  token: vscode.CancellationToken,
  parentContext: BlockContext[],
  outputChannel: vscode.OutputChannel,
  strict: boolean,
  filePath?: string
): Promise<vscode.Location | null> {
  const globalDef = await findDefinition(
    symbol,
    resourcesPath,
    token,
    parentContext,
    outputChannel,
    strict,
    filePath
  );
  if (globalDef) {
    outputChannel.appendLine(
      `  MATCH found in global resources! (${strict ? "High" : "Low"} Priority)`
    );
    return globalDef;
  }

  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      const workspaceDef = await findDefinition(
        symbol,
        folder.uri.fsPath,
        token,
        parentContext,
        outputChannel,
        strict,
        filePath
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
