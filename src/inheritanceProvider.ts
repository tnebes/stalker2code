import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  REGEX,
  EXTENSION_CONFIG_SECTION,
  CONFIG_RESOURCES_PATH,
} from "./constants";
import { findParentStruct, isPatchFile } from "./search/pathUtils";
import { tieredSearch } from "./search/tieredSearch";
import { findFileExact } from "./search/fileSearch";
import { BlockContext } from "./search/types";

export interface InheritanceItem {
  name: string;
  uri?: vscode.Uri;
  line?: number;
  type: "parent" | "current" | "child";
  context?: BlockContext[];
  children?: InheritanceItem[];
  hasSearchedChildren?: boolean;
}

export class InheritanceTreeProvider
  implements vscode.TreeDataProvider<InheritanceItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    InheritanceItem | undefined | null | void
  > = new vscode.EventEmitter<InheritanceItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    InheritanceItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private currentItem: InheritanceItem | null = null;
  private parents: InheritanceItem[] = [];
  private children: InheritanceItem[] = [];
  private searchTokenSource: vscode.CancellationTokenSource | null = null;

  constructor(private outputChannel: vscode.OutputChannel) {}

  refresh(item?: InheritanceItem): void {
    this._onDidChangeTreeData.fire(item);
  }

  async showInheritance(
    document: vscode.TextDocument,
    position: vscode.Position
  ) {
    const wordRange = document.getWordRangeAtPosition(
      position,
      REGEX.WORD_RANGE
    );
    if (!wordRange) return;

    const word = document.getText(wordRange);
    const context = findParentStruct(document, position);

    this.currentItem = {
      name: word,
      uri: document.uri,
      line: position.line,
      type: "current",
      context: context,
    };

    this.parents = [];
    this.children = [];
    this.refresh();

    // Resolve parents and children in the background
    this.resolveHierarchy(document, position, word, context);
  }

  private async resolveHierarchy(
    document: vscode.TextDocument,
    position: vscode.Position,
    word: string,
    context: BlockContext[]
  ) {
    if (this.searchTokenSource) {
      this.searchTokenSource.cancel();
    }
    this.searchTokenSource = new vscode.CancellationTokenSource();
    const token = this.searchTokenSource.token;

    const currentConfig = vscode.workspace.getConfiguration(
      EXTENSION_CONFIG_SECTION
    );
    const resourcesPath =
      currentConfig.get<string>(CONFIG_RESOURCES_PATH) || "";

    // 1. Find Parents Recursive (Upwards)
    await this.resolveParentsRecursive(
      document.uri,
      position.line,
      word,
      context,
      token,
      resourcesPath
    );

    this.refresh();

    // 2. Find Children (Downwards) for current item
    if (this.currentItem) {
      await this.findChildrenForItem(this.currentItem, resourcesPath, token);
    }
  }

  private async resolveParentsRecursive(
    uri: vscode.Uri,
    line: number,
    word: string,
    context: BlockContext[],
    token: vscode.CancellationToken,
    resourcesPath: string
  ) {
    if (token.isCancellationRequested) return;

    try {
      const docText =
        uri.fsPath === vscode.window.activeTextEditor?.document.uri.fsPath
          ? vscode.window.activeTextEditor.document.getText()
          : await fs.promises.readFile(uri.fsPath, "utf-8");
      const lines = docText.split(/\r?\n/);
      const lineText = lines[line];
      if (!lineText) return;

      const refurlMatch = lineText.match(REGEX.REFURL);
      const refkeyMatch = lineText.match(REGEX.REFKEY);

      if (refurlMatch || refkeyMatch) {
        const refurl = refurlMatch ? refurlMatch[1] : undefined;
        const refkey = refkeyMatch ? refkeyMatch[1] : undefined;

        let parentUri: vscode.Uri | undefined;
        let parentLine: number | undefined;

        if (refurl) {
          const resolved = await this.resolveFileByName(
            refurl,
            uri.fsPath,
            resourcesPath,
            token
          );
          if (resolved) {
            parentUri = resolved.uri;
            if (refkey) {
              const loc = await this.findSymbolInFile(parentUri.fsPath, refkey);
              if (loc) parentLine = loc.line;
            }
          }
        } else if (refkey) {
          // Try same file first
          let loc = await this.findSymbolInFile(uri.fsPath, refkey);
          if (loc) {
            parentUri = uri;
            parentLine = loc.line;
          } else if (isPatchFile(uri.fsPath, resourcesPath)) {
            // Check base files
            const baseFiles = this.getPotentialBaseFiles(
              uri.fsPath,
              resourcesPath
            );
            for (const bName of baseFiles) {
              const baseLoc = await findFileExact(bName, resourcesPath, token);
              if (baseLoc) {
                const bLoc = await this.findSymbolInFile(
                  baseLoc.uri.fsPath,
                  refkey
                );
                if (bLoc) {
                  parentUri = baseLoc.uri;
                  parentLine = bLoc.line;
                  break;
                }
              }
            }
          }
        }

        if (parentUri && parentLine !== undefined) {
          const parentItem: InheritanceItem = {
            name: refkey || path.basename(parentUri.fsPath),
            uri: parentUri,
            line: parentLine,
            type: "parent",
          };
          this.parents.unshift(parentItem); // Add to beginning to keep hierarchy order
          // Recurse
          await this.resolveParentsRecursive(
            parentUri,
            parentLine,
            refkey || word,
            [],
            token,
            resourcesPath
          );
        }
      } else if (isPatchFile(uri.fsPath, resourcesPath)) {
        // Handle implicit bpatch parent if no refurl/refkey
        const baseFiles = this.getPotentialBaseFiles(uri.fsPath, resourcesPath);
        for (const bName of baseFiles) {
          const baseLoc = await findFileExact(bName, resourcesPath, token);
          if (baseLoc) {
            const loc = await this.findSymbolInFile(
              baseLoc.uri.fsPath,
              word,
              context
            );
            if (loc) {
              const parentItem: InheritanceItem = {
                name: `${word} (Base: ${bName})`,
                uri: baseLoc.uri,
                line: loc.line,
                type: "parent",
              };
              this.parents.unshift(parentItem);
              // Recurse into base file
              await this.resolveParentsRecursive(
                baseLoc.uri,
                loc.line,
                word,
                context,
                token,
                resourcesPath
              );
              break;
            }
          }
        }
      }
    } catch (e) {
      this.outputChannel.appendLine(`Error resolving parents: ${e}`);
    }
  }

  private async resolveFileByName(
    filename: string,
    activeFilePath: string,
    resourcesPath: string,
    token: vscode.CancellationToken
  ): Promise<vscode.Location | null> {
    const currentDir = path.dirname(activeFilePath);
    const relativePath = path.resolve(currentDir, filename);
    if (fs.existsSync(relativePath)) {
      return new vscode.Location(
        vscode.Uri.file(relativePath),
        new vscode.Position(0, 0)
      );
    }
    return await findFileExact(filename, resourcesPath, token);
  }

  private async findChildrenForItem(
    item: InheritanceItem,
    resourcesPath: string,
    token: vscode.CancellationToken
  ) {
    if (item.hasSearchedChildren || !item.uri) return;

    const word = item.name;
    const baseFilePath = item.uri.fsPath;

    this.outputChannel.appendLine(`Searching for children of ${word}...`);

    if (!item.children) item.children = [];

    // 1. Search current document
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      await this.searchFileForChildren(
        activeEditor.document.uri,
        activeEditor.document.getText(),
        word,
        baseFilePath,
        token,
        item.children
      );
    }

    // 2. Search all open documents
    for (const doc of vscode.workspace.textDocuments) {
      if (
        doc.languageId === "stalker2-config" &&
        doc.uri.fsPath !== activeEditor?.document.uri.fsPath
      ) {
        await this.searchFileForChildren(
          doc.uri,
          doc.getText(),
          word,
          baseFilePath,
          token,
          item.children
        );
      }
    }

    // 3. Search workspace folders
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        if (token.isCancellationRequested) return;
        await this.searchDirForChildren(
          folder.uri.fsPath,
          word,
          baseFilePath,
          token,
          item.children
        );
      }
    }

    // 4. Search resources (limited to relevant files for performance)
    if (resourcesPath && !token.isCancellationRequested) {
      const baseDir = path.dirname(baseFilePath);
      if (baseDir.includes(resourcesPath)) {
        await this.searchDirForChildren(
          baseDir,
          word,
          baseFilePath,
          token,
          item.children
        );
      }
    }

    item.hasSearchedChildren = true;
    this.refresh(item);
  }

  private async searchDirForChildren(
    dirPath: string,
    word: string,
    baseFilePath: string,
    token: vscode.CancellationToken,
    targetArray: InheritanceItem[]
  ) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (token.isCancellationRequested) return;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.searchDirForChildren(
          fullPath,
          word,
          baseFilePath,
          token,
          targetArray
        );
      } else if (entry.isFile() && REGEX.CFG_FILE_EXT.test(entry.name)) {
        if (fullPath === baseFilePath) continue;
        try {
          const content = await fs.promises.readFile(fullPath, "utf-8");
          if (content.toLowerCase().includes(word.toLowerCase())) {
            await this.searchFileForChildren(
              vscode.Uri.file(fullPath),
              content,
              word,
              baseFilePath,
              token,
              targetArray
            );
          }
        } catch {}
      }
    }
  }

  private async searchFileForChildren(
    uri: vscode.Uri,
    content: string,
    word: string,
    baseFilePath: string,
    token: vscode.CancellationToken,
    targetArray: InheritanceItem[]
  ) {
    if (token.isCancellationRequested) return;

    const lines = content.split(/\r?\n/);
    const baseFileName = path.basename(baseFilePath);
    const refkeyRegex = new RegExp(`refkey\\s*=\\s*${word}`, "i");
    const bpatchRegex = new RegExp(
      `^\\s*${word}\\s*[:=]\\s*struct\\.begin\\s*\\{bpatch\\}`,
      "i"
    );

    for (let i = 0; i < lines.length; i++) {
      if (token.isCancellationRequested) return;
      const line = lines[i];
      let isChild = false;

      if (refkeyRegex.test(line)) {
        const refurlMatch = line.match(REGEX.REFURL);
        if (refurlMatch) {
          const refurl = refurlMatch[1];
          if (refurl.endsWith(baseFileName)) {
            isChild = true;
          }
        } else {
          // If no refurl, it's a child if it's the same file OR a patch of the base file
          if (
            uri.fsPath === baseFilePath ||
            this.isPatchOf(baseFilePath, uri.fsPath)
          ) {
            isChild = true;
          }
        }
      } else if (bpatchRegex.test(line)) {
        // Word is the same, but it's a {bpatch} - this is a child (patcher)
        if (this.isPatchOf(baseFilePath, uri.fsPath)) {
          isChild = true;
        }
      }

      if (isChild) {
        const childMatch = line.match(/^\s*([\w./\\]+)\s*[:=]/);
        if (childMatch) {
          const childName = childMatch[1];
          // If it's the same name as word, and it's not a {bpatch}, skip (it's the definition itself)
          if (childName === word && !line.includes("{bpatch}")) continue;

          // Check if already in children
          if (
            !targetArray.some(
              (c) => c.uri?.fsPath === uri.fsPath && c.line === i
            )
          ) {
            targetArray.push({
              name: childName === word ? `${childName} (Patch)` : childName,
              uri: uri,
              line: i,
              type: "child",
            });
            this.refresh();
          }
        }
      }
    }
  }

  private isPatchOf(basePath: string, patchPath: string): boolean {
    const baseName = path.basename(basePath, ".cfg").toLowerCase();
    const patchName = path.basename(patchPath).toLowerCase();

    // Case 1: baseName_patch_...
    if (patchName.startsWith(baseName + "_patch_")) return true;

    // Case 2: Folder Technique
    const patchDir = path.dirname(patchPath);
    const patchDirName = path.basename(patchDir).toLowerCase();
    if (patchDirName === baseName || patchDirName === baseName + ".cfg")
      return true;

    return false;
  }

  private getPotentialBaseFiles(
    filePath: string,
    resourcesPath: string
  ): string[] {
    const fileName = path.basename(filePath);
    const baseFiles: string[] = [];

    if (REGEX.CFG_PATCH_EXT.test(fileName)) {
      baseFiles.push(fileName.replace(REGEX.CFG_PATCH_EXT, ".cfg"));
    }

    const dirPath = path.dirname(filePath);
    const parentDirName = path.basename(dirPath);
    if (
      parentDirName.toLowerCase() !== "gamedata" &&
      dirPath.toLowerCase().includes("gamedata")
    ) {
      baseFiles.push(parentDirName + ".cfg");
    }

    if (fileName.includes("_")) {
      let rootPart = fileName.split("_")[0];
      if (REGEX.CFG_FILE_EXT.test(rootPart)) {
        baseFiles.push(rootPart);
      } else {
        baseFiles.push(rootPart + ".cfg");
      }
    }

    return [...new Set(baseFiles)];
  }

  private async resolveFile(
    filename: string,
    document: vscode.TextDocument,
    resourcesPath: string
  ): Promise<vscode.Location | null> {
    const currentDir = path.dirname(document.fileName);
    const relativePath = path.resolve(currentDir, filename);
    if (fs.existsSync(relativePath)) {
      return new vscode.Location(
        vscode.Uri.file(relativePath),
        new vscode.Position(0, 0)
      );
    }
    return await findFileExact(
      filename,
      resourcesPath,
      new vscode.CancellationTokenSource().token
    );
  }

  private async findSymbolInFile(
    fsPath: string,
    symbol: string,
    context: BlockContext[] = []
  ): Promise<{ line: number } | null> {
    try {
      const content = await fs.promises.readFile(fsPath, "utf-8");
      const lines = content.split(/\r?\n/);
      // Simple search for now, could use findInLines
      for (let i = 0; i < lines.length; i++) {
        if (
          lines[i].includes(symbol) &&
          (lines[i].includes("struct.begin") || lines[i].includes("sid ="))
        ) {
          return { line: i };
        }
      }
    } catch {}
    return null;
  }

  getTreeItem(element: InheritanceItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(element.name);

    if (element.children && element.children.length > 0) {
      treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    } else if (element.type === "child" && !element.hasSearchedChildren) {
      treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    if (element.type === "current") {
      treeItem.iconPath = new vscode.ThemeIcon("symbol-class");
      treeItem.description = "(Selected)";
    } else if (element.type === "parent") {
      treeItem.iconPath = new vscode.ThemeIcon("arrow-up");
      treeItem.description = "Inherited FROM";
      treeItem.contextValue = "navigable";
    } else {
      treeItem.iconPath = new vscode.ThemeIcon("arrow-down");
      treeItem.description = "Inherited BY";
      treeItem.contextValue = "navigable";
    }

    if (element.uri) {
      treeItem.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [
          element.uri,
          {
            selection: new vscode.Range(
              element.line || 0,
              0,
              element.line || 0,
              0
            ),
          },
        ],
      };
      treeItem.tooltip = `${element.uri.fsPath}${
        element.line !== undefined ? ":" + (element.line + 1) : ""
      }`;
    }

    return treeItem;
  }

  getChildren(element?: InheritanceItem): Thenable<InheritanceItem[]> {
    if (!this.currentItem) return Promise.resolve([]);

    if (!element) {
      // Root level: Show parents recursively, then current
      if (this.parents.length > 0) {
        // Construct the nested structure for parents
        let root = this.parents[0];
        let current = root;
        for (let i = 1; i < this.parents.length; i++) {
          current.children = [this.parents[i]];
          current = this.parents[i];
        }
        current.children = [this.currentItem];
        return Promise.resolve([root]);
      }

      return Promise.resolve([this.currentItem]);
    }

    if (element.type === "child" && !element.hasSearchedChildren) {
      // Trigger lazy load
      const currentConfig = vscode.workspace.getConfiguration(
        EXTENSION_CONFIG_SECTION
      );
      const resourcesPath =
        currentConfig.get<string>(CONFIG_RESOURCES_PATH) || "";
      const token =
        this.searchTokenSource?.token ||
        new vscode.CancellationTokenSource().token;

      return this.findChildrenForItem(element, resourcesPath, token).then(
        () => {
          return element.children || [];
        }
      );
    }

    return Promise.resolve(element.children || []);
  }
}
