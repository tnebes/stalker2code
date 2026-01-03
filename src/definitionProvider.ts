import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  EXTENSION_CONFIG_SECTION,
  CONFIG_RESOURCES_PATH,
  REGEX,
} from "./constants";
import { symbolCache } from "./cache";
import {
  findParentStruct,
  tieredSearch,
  findFileExact,
  findInLines,
  BlockContext,
} from "./searchUtils";
import { ASTManager } from "./astManager";
import { ASTNode, BlockNode, PropertyNode } from "./parser/ast";

export class StalkerDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private outputChannel: vscode.OutputChannel) {}

  private async resolveFile(
    filename: string,
    document: vscode.TextDocument,
    resourcesPath: string,
    token: vscode.CancellationToken
  ): Promise<vscode.Location | null> {
    const currentDir = path.dirname(document.fileName);
    const relativePath = path.resolve(currentDir, filename);
    if (fs.existsSync(relativePath)) {
      return new vscode.Location(
        vscode.Uri.file(relativePath),
        new vscode.Position(0, 0)
      );
    }

    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const fileLoc = await findFileExact(filename, folder.uri.fsPath, token);
        if (fileLoc) return fileLoc;
      }
    }

    return await findFileExact(filename, resourcesPath, token);
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Location | null> {
    const currentConfig = vscode.workspace.getConfiguration(
      EXTENSION_CONFIG_SECTION
    );
    const resourcesPath = currentConfig.get<string>(CONFIG_RESOURCES_PATH);

    if (
      !resourcesPath ||
      resourcesPath.trim() === "" ||
      !fs.existsSync(resourcesPath)
    ) {
      this.outputChannel.appendLine(
        "Global search disabled: Resources path not set or invalid."
      );
      vscode.window
        .showErrorMessage(
          "S.T.A.L.K.E.R. 2 Navigator: Game resources path is not set or invalid. Global navigation will not work.",
          "Set Up Now"
        )
        .then((selection) => {
          if (selection === "Set Up Now") {
            vscode.commands.executeCommand("stalker2.showSetup");
          }
        });
      return null;
    }

    const wordRange = document.getWordRangeAtPosition(
      position,
      REGEX.WORD_RANGE
    );
    if (!wordRange) return null;
    let word = document.getText(wordRange);

    // Recognition of enums like EAttachType::Scope
    let searchWord = word;
    let searchParentPath = findParentStruct(document, position);

    if (word.includes("::")) {
      const parts = word.split("::");
      searchWord = parts[parts.length - 1];
      // Enum path is added to the existing structural path
      const enumContexts: BlockContext[] = parts
        .slice(0, -1)
        .map((name) => ({ name }));
      searchParentPath = [...searchParentPath, ...enumContexts];
    }

    const parentNames = searchParentPath.map((c) => c.name);
    const cacheKey =
      searchParentPath.length > 0
        ? `${parentNames.join("::")}::${searchWord}`
        : searchWord;

    // Special case: refurl + refkey logic
    const lineText = document.lineAt(position.line).text;
    const refurlMatch = lineText.match(REGEX.REFURL);
    const refkeyRegex = /refkey\s*=\s*([^\s;{}]+)/i;
    const refkeyMatch = lineText.match(refkeyRegex);

    if (refkeyMatch && refurlMatch) {
      const refkey = refkeyMatch[1];
      const refurl = refurlMatch[1];
      const refkeyIndex = lineText.indexOf(refkey, lineText.indexOf("refkey"));

      if (
        position.character >= refkeyIndex &&
        position.character <= refkeyIndex + refkey.length
      ) {
        this.outputChannel.appendLine(
          `Contextual Search: refkey '${refkey}' in file '${refurl}'`
        );
        const targetFile = await this.resolveFile(
          refurl,
          document,
          resourcesPath,
          token
        );
        if (targetFile) {
          try {
            const content = await fs.promises.readFile(
              targetFile.uri.fsPath,
              "utf-8"
            );
            const lines = content.split(/\r?\n/);
            const loc = findInLines(refkey, lines, [], false);
            if (loc) {
              return new vscode.Location(
                targetFile.uri,
                new vscode.Position(loc.line, 0)
              );
            }
          } catch {}
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

    // Check if we are clicking on the definition itself to skip Tier 0
    let skipTier0 = false;
    const ast = ASTManager.getAST(document);
    const localResult = this.findInAST(
      ast.children,
      searchWord,
      searchParentPath
    );
    if (localResult) {
      const isSelf = localResult.range.contains(position);
      if (!isSelf) {
        this.outputChannel.appendLine(
          `Local AST match found for: ${searchWord}`
        );
        const loc = new vscode.Location(document.uri, localResult.range.start);
        symbolCache.set(cacheKey, loc);
        return loc;
      }
      this.outputChannel.appendLine(
        `Direct definition click detected for: ${searchWord}. Initiating global/base search...`
      );
      skipTier0 = true;
    }

    // If the word itself is a .cfg file, try to find the file
    if (REGEX.CFG_FILE_EXT.test(searchWord)) {
      const fileLoc = await this.resolveFile(
        searchWord,
        document,
        resourcesPath,
        token
      );
      if (fileLoc) return fileLoc;
    }

    // Debounce for hover: skip Tier 2/3 if it's just a quick hover
    if (skipTier0 || searchParentPath.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (token.isCancellationRequested) return null;
    }

    const results = await tieredSearch(
      searchWord,
      document,
      resourcesPath,
      token,
      searchParentPath,
      this.outputChannel,
      position,
      skipTier0
    );
    if (results) {
      symbolCache.set(cacheKey, results);
      return results;
    }

    this.outputChannel.appendLine(
      `Definition NOT FOUND for: ${searchWord} (Path: ${
        parentNames.join(" -> ") || "None"
      })`
    );
    return null;
  }

  private findInAST(
    nodes: ASTNode[],
    word: string,
    parentPath: BlockContext[]
  ): ASTNode | null {
    if (parentPath.length > 0) {
      const currentParent = parentPath[0];
      const remainingPath = parentPath.slice(1);
      for (const node of nodes) {
        if (
          node.type === "Block" &&
          (node as BlockNode).name === currentParent.name
        ) {
          return this.findInAST(
            (node as BlockNode).children,
            word,
            remainingPath
          );
        }
      }
      return null;
    }

    for (const node of nodes) {
      if (node.type === "Block" && (node as BlockNode).name === word)
        return node;
      if (node.type === "Property") {
        const prop = node as PropertyNode;
        if (prop.key === word) return node;
        // Special SID handling
        if (
          prop.key.toLowerCase() === "sid" &&
          prop.value.replace(/"/g, "") === word
        )
          return node;
      }
    }
    return null;
  }
}
