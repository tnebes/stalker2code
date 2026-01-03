import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    EXTENSION_CONFIG_SECTION,
    CONFIG_RESOURCES_PATH,
    REGEX
} from './constants';
import { symbolCache } from './cache';
import { findParentStruct, tieredSearch, findFileExact, findInLines } from './searchUtils';

export class StalkerDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private outputChannel: vscode.OutputChannel) { }

    private async resolveFile(filename: string, document: vscode.TextDocument, resourcesPath: string, token: vscode.CancellationToken): Promise<vscode.Location | null> {
        // Priority 0: Relative to current file
        const currentDir = path.dirname(document.fileName);
        const relativePath = path.resolve(currentDir, filename);
        if (fs.existsSync(relativePath)) {
            return new vscode.Location(vscode.Uri.file(relativePath), new vscode.Position(0, 0));
        }

        // Priority 1: Current workspace
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const fileLoc = await findFileExact(filename, folder.uri.fsPath, token);
                if (fileLoc) return fileLoc;
            }
        }

        // Priority 2: Global resources
        return await findFileExact(filename, resourcesPath, token);
    }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | null> {
        const currentConfig = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
        const resourcesPath = currentConfig.get<string>(CONFIG_RESOURCES_PATH);

        if (!resourcesPath || resourcesPath.trim() === '' || !fs.existsSync(resourcesPath)) {
            return null;
        }

        const wordRange = document.getWordRangeAtPosition(position, REGEX.WORD_RANGE);
        if (!wordRange) return null;
        const word = document.getText(wordRange);

        let searchWord = word;
        let searchParentStruct = findParentStruct(document, position);

        // Recognition of enums like EAttachType::Scope
        if (word.includes('::')) {
            const parts = word.split('::');
            searchWord = parts[parts.length - 1];
            searchParentStruct = parts[parts.length - 2]; // Take the immediate predecessor as the parent struct
        }

        const cacheKey = searchParentStruct ? `${searchParentStruct}::${searchWord}` : searchWord;

        // Special case: refurl + refkey logic
        // If the user clicks on a refkey value, and there is a refurl on the same line, jump to that file + key
        const lineText = document.lineAt(position.line).text;
        const refurlMatch = lineText.match(REGEX.REFURL);
        const refkeyRegex = /refkey\s*=\s*([^\s;{}]+)/i;
        const refkeyMatch = lineText.match(refkeyRegex);

        if (refkeyMatch && refurlMatch) {
            const refkey = refkeyMatch[1];
            const refurl = refurlMatch[1];

            // Determine if the cursor is actually on the refkey value
            const refkeyStart = lineText.indexOf(refkey, lineText.indexOf('refkey'));
            if (position.character >= refkeyStart && position.character <= refkeyStart + refkey.length) {
                this.outputChannel.appendLine(`Contextual Search: refkey '${refkey}' in file '${refurl}'`);
                const targetFile = await this.resolveFile(refurl, document, resourcesPath, token);
                if (targetFile) {
                    try {
                        const content = await fs.promises.readFile(targetFile.uri.fsPath, 'utf-8');
                        const lines = content.split(/\r?\n/);
                        const loc = findInLines(refkey, lines, null, false);
                        if (loc) {
                            return new vscode.Location(targetFile.uri, new vscode.Position(loc.line, 0));
                        }
                    } catch (e) { }
                    // If key not found in that specific file, fall back to normal search or return the file?
                    // User probably wants the file if key is missing.
                    return targetFile;
                }
            }
        }

        // Check Cache
        if (symbolCache.has(cacheKey)) {
            const cached = symbolCache.get(cacheKey);
            if (cached && fs.existsSync(cached.uri.fsPath)) {
                return cached;
            }
            symbolCache.delete(cacheKey);
        }

        // If the word itself is a .cfg file, try to find the file
        if (REGEX.CFG_FILE_EXT.test(searchWord)) {
            const fileLoc = await this.resolveFile(searchWord, document, resourcesPath, token);
            if (fileLoc) return fileLoc;
        }

        const results = await tieredSearch(searchWord, document, resourcesPath, token, searchParentStruct, this.outputChannel);

        if (results) {
            symbolCache.set(cacheKey, results);
            return results;
        }

        this.outputChannel.appendLine(`Definition NOT FOUND for: ${searchWord} (Struct: ${searchParentStruct || 'None'})`);
        return null;
    }
}
