import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { REGEX, SEARCH_LIMITS } from './constants';

export function findParentStruct(document: vscode.TextDocument, position: vscode.Position): string | null {
    let line = position.line;
    let depth = 0;

    while (line >= 0) {
        const text = document.lineAt(line).text;

        // If we hit a struct.end going upwards, we are skipping a nested struct
        if (REGEX.STRUCT_END.test(text)) {
            depth++;
        }

        const structMatch = text.match(REGEX.STRUCT_BEGIN);
        if (structMatch) {
            if (depth === 0) {
                return structMatch[1];
            } else {
                depth--;
            }
        }
        line--;
    }
    return null;
}

export async function tieredSearch(
    word: string,
    document: vscode.TextDocument,
    resourcesPath: string,
    token: vscode.CancellationToken,
    parentStruct: string | null,
    outputChannel: vscode.OutputChannel
): Promise<vscode.Location | null> {
    const fileName = path.basename(document.fileName);

    // Tier 0: Current File Search
    outputChannel.appendLine(`Tier 0: Searching for ${word} in current file (Context: ${parentStruct || 'None'})`);
    const lines = document.getText().split(/\r?\n/);
    const localLoc = findInLines(word, lines, parentStruct, true); // Strict search for current file
    if (localLoc) {
        return new vscode.Location(document.uri, new vscode.Position(localLoc.line, 0));
    }

    // Tier 1: Base File Search (If current is a patch)
    if (REGEX.CFG_PATCH_EXT.test(fileName)) {
        const baseFileName = fileName.replace(REGEX.CFG_PATCH_EXT, '.cfg');
        outputChannel.appendLine(`Tier 1: Searching for ${word} in base file: ${baseFileName} (Context: ${parentStruct || 'None'})`);
        const baseFileDef = await findSymbolInFileByName(word, baseFileName, resourcesPath, token, parentStruct);
        if (baseFileDef) return baseFileDef;
    }

    // Tier 2: Global Resources Search
    outputChannel.appendLine(`Tier 2: Searching for ${word} in global resources (Context: ${parentStruct || 'None'})`);
    const globalDef = await findDefinition(word, resourcesPath, token, parentStruct);
    if (globalDef) return globalDef;

    // Tier 3: Current Workspace Search
    outputChannel.appendLine(`Tier 3: Searching for ${word} in workspace (Context: ${parentStruct || 'None'})`);
    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            const workspaceDef = await findDefinition(word, folder.uri.fsPath, token, parentStruct);
            if (workspaceDef) return workspaceDef;
        }
    }

    return null;
}

export async function findSymbolInFileByName(
    symbol: string,
    filename: string,
    rootPath: string,
    token: vscode.CancellationToken,
    parentStruct: string | null
): Promise<vscode.Location | null> {
    const fileLoc = await findFileExact(filename, rootPath, token);
    if (!fileLoc) return null;

    try {
        const content = await fs.promises.readFile(fileLoc.uri.fsPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const loc = findInLines(symbol, lines, parentStruct, false); // Not strict for cross-file
        if (loc) {
            return new vscode.Location(fileLoc.uri, new vscode.Position(loc.line, 0));
        }
    } catch { }
    return null;
}

export function findInLines(symbol: string, lines: string[], parentStruct: string | null, strict: boolean = false): { line: number } | null {
    const escapedSymbol = escapeRegExp(symbol);

    const structRegex = new RegExp(`^\\s*${escapedSymbol}\\s*:\\s*struct\\.begin`, 'i');
    const assignmentRegex = new RegExp(`^\\s*${escapedSymbol}\\s*[=:]`, 'i');
    const sidRegex = new RegExp(`sid\\s*=\\s*"?${escapedSymbol}"?`, 'i');

    if (parentStruct) {
        const escapedParent = escapeRegExp(parentStruct);
        const parentRegex = new RegExp(`^\\s*${escapedParent}\\s*:\\s*struct\\.begin`, 'i');
        let inTargetStruct = false;
        let structDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];

            if (!inTargetStruct) {
                if (parentRegex.test(lineText)) {
                    inTargetStruct = true;
                    structDepth = 1;
                }
            } else {
                if (REGEX.STRUCT_BEGIN.test(lineText)) {
                    structDepth++;
                }
                if (REGEX.STRUCT_END.test(lineText)) {
                    structDepth--;
                    if (structDepth === 0) {
                        inTargetStruct = false;
                        continue;
                    }
                }

                if (structDepth === 1) {
                    // In strict mode, we only care about structs or SIDs
                    if (structRegex.test(lineText) || sidRegex.test(lineText)) {
                        return { line: i };
                    }
                    // Only check generic assignment if NOT in strict mode
                    if (!strict && assignmentRegex.test(lineText)) {
                        return { line: i };
                    }
                }
            }
        }
    }

    for (let i = 0; i < lines.length; i++) {
        if (structRegex.test(lines[i]) || sidRegex.test(lines[i])) {
            return { line: i };
        }
        if (!strict && assignmentRegex.test(lines[i])) {
            return { line: i };
        }
    }
    return null;
}

export async function findDefinition(symbol: string, rootPath: string, token: vscode.CancellationToken, parentStruct: string | null): Promise<vscode.Location | null> {
    let filesChecked = 0;
    const startTime = Date.now();

    async function searchDir(dir: string, depth: number): Promise<vscode.Location | null> {
        if (depth > SEARCH_LIMITS.MAX_DEPTH) return null;
        if (filesChecked > SEARCH_LIMITS.MAX_FILES) return null;
        if (Date.now() - startTime > SEARCH_LIMITS.TIMEOUT_MS) return null;
        if (token.isCancellationRequested) return null;

        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (e) { return null; }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const res = await searchDir(fullPath, depth + 1);
                if (res) return res;
            } else if (entry.isFile() && REGEX.CFG_FILE_EXT.test(entry.name)) {
                filesChecked++;
                try {
                    const content = await fs.promises.readFile(fullPath, 'utf-8');
                    const lines = content.split(/\r?\n/);
                    const loc = findInLines(symbol, lines, parentStruct);
                    if (loc) {
                        return new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(loc.line, 0));
                    }
                } catch { }
            }
        }
        return null;
    }
    return await searchDir(rootPath, 0);
}

export async function findFileExact(filename: string, rootPath: string, token: vscode.CancellationToken): Promise<vscode.Location | null> {
    // If it's a relative path, we might want to try resolving it from the search root if applicable,
    // but usually user just wants to find the file by name in the complex tree.
    const targetBaseName = path.basename(filename).toLowerCase();

    async function searchDir(dir: string, depth: number): Promise<vscode.Location | null> {
        if (depth > SEARCH_LIMITS.MAX_DEPTH) return null;
        if (token.isCancellationRequested) return null;

        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (e) { return null; }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const res = await searchDir(fullPath, depth + 1);
                if (res) return res;
            } else if (entry.isFile() && entry.name.toLowerCase() === targetBaseName) {
                return new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0));
            }
        }
        return null;
    }
    return await searchDir(rootPath, 0);
}

export function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
