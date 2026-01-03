import * as vscode from "vscode";

export const symbolCache = new Map<string, vscode.Location>();

export function clearCache() {
  symbolCache.clear();
}
