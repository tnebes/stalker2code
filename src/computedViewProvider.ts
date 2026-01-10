import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  REGEX,
  EXTENSION_CONFIG_SECTION,
  CONFIG_RESOURCES_PATH,
} from "./constants";
import { findParentStruct, isPatchFile } from "./search/pathUtils";
import { findFileExact } from "./search/fileSearch";
import { BlockContext } from "./search/types";
import { ASTManager } from "./astManager";
import { BlockNode, PropertyNode, ASTNode } from "./parser/ast";

interface ComputedProperty {
  key: string;
  value: string;
  sourceFile: string;
  line: number;
  inheritanceLevel: number;
  isRemoved?: boolean;
  refkey?: string;
}

interface ComputedStruct {
  name: string;
  properties: Map<string, ComputedProperty | ComputedStruct>;
  sourceFile: string;
  line: number;
  inheritanceLevel: number;
  isBpatch: boolean;
  refkey?: string;
}

export class ComputedViewProvider {
  private static readonly viewType = "stalker2.computedView";

  public static async show(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    position: vscode.Position,
    outputChannel: vscode.OutputChannel
  ) {
    const wordRange = document.getWordRangeAtPosition(
      position,
      REGEX.WORD_RANGE
    );
    if (!wordRange) return;

    const word = document.getText(wordRange);
    const structContext = findParentStruct(document, position);

    const panel = vscode.window.createWebviewPanel(
      this.viewType,
      `Computed: ${word}`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    const currentConfig = vscode.workspace.getConfiguration(
      EXTENSION_CONFIG_SECTION
    );
    const resourcesPath =
      currentConfig.get<string>(CONFIG_RESOURCES_PATH) || "";

    try {
      const resolved = await this.resolveStructRecursive(
        word,
        document.uri,
        position.line,
        structContext,
        resourcesPath,
        0
      );

      panel.webview.html = this.getHtmlForWebview(
        panel.webview,
        resolved,
        word
      );

      panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === "openSource") {
          const uri = vscode.Uri.file(message.file);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, {
            selection: new vscode.Range(message.line, 0, message.line, 0),
          });
        } else if (message.command === "copyToClipboard") {
          const text = this.structToPlainText(resolved);
          await vscode.env.clipboard.writeText(text);
          vscode.window.showInformationMessage(
            "Configuration copied to clipboard!"
          );
        }
      });
    } catch (e) {
      outputChannel.appendLine(`Error resolving computed view: ${e}`);
      panel.webview.html = `<h1>Error</h1><p>${e}</p>`;
    }
  }

  private static structToPlainText(
    struct: ComputedStruct,
    indent: number = 0
  ): string {
    const padding = "   ".repeat(indent);
    let text = `${padding}${struct.name} : struct.begin\n`;
    for (const [key, val] of struct.properties) {
      if ("properties" in val) {
        text += this.structToPlainText(val as ComputedStruct, indent + 1);
      } else {
        const prop = val as ComputedProperty;
        if (prop.isRemoved) continue;
        text += `${padding}   ${prop.key} = ${prop.value}\n`;
      }
    }
    text += `${padding}struct.end\n`;
    return text;
  }

  private static async resolveStructRecursive(
    name: string,
    uri: vscode.Uri,
    line: number,
    context: BlockContext[],
    resourcesPath: string,
    level: number
  ): Promise<ComputedStruct> {
    const docText = await fs.promises.readFile(uri.fsPath, "utf-8");
    const lines = docText.split(/\r?\n/);
    const lineText = lines[line];

    const isBpatch = lineText.includes("{bpatch}");
    const refurlMatch = lineText.match(REGEX.REFURL);
    const refkeyMatch = lineText.match(REGEX.REFKEY);

    let parentStruct: ComputedStruct | null = null;

    // Resolve Parent
    if (refurlMatch || refkeyMatch) {
      const refurl = refurlMatch ? refurlMatch[1] : undefined;
      const refkey = refkeyMatch ? refkeyMatch[1] : undefined;

      let parentUri: vscode.Uri | undefined;
      let parentLine: number | undefined;

      if (refurl) {
        const resolved = await this.resolveFileByName(
          refurl,
          uri.fsPath,
          resourcesPath
        );
        if (resolved) {
          parentUri = resolved.uri;
          if (refkey) {
            const loc = await this.findSymbolInFile(parentUri.fsPath, refkey);
            if (loc) parentLine = loc.line;
          }
        }
      } else if (refkey) {
        const loc = await this.findSymbolInFile(uri.fsPath, refkey);
        if (loc) {
          parentUri = uri;
          parentLine = loc.line;
        } else if (isPatchFile(uri.fsPath, resourcesPath)) {
          const baseFiles = this.getPotentialBaseFiles(
            uri.fsPath,
            resourcesPath
          );
          for (const bName of baseFiles) {
            const baseLoc = await findFileExact(
              bName,
              resourcesPath,
              new vscode.CancellationTokenSource().token
            );
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
        parentStruct = await this.resolveStructRecursive(
          refkey || name,
          parentUri,
          parentLine,
          [], // Reset context for parent if it's a top level ref
          resourcesPath,
          level + 1
        );
        if (parentStruct) {
          parentStruct.refkey = refkey || name;
        }
      }
    } else if (isBpatch && isPatchFile(uri.fsPath, resourcesPath)) {
      // Implicit bpatch
      const baseFiles = this.getPotentialBaseFiles(uri.fsPath, resourcesPath);
      for (const bName of baseFiles) {
        const baseLoc = await findFileExact(
          bName,
          resourcesPath,
          new vscode.CancellationTokenSource().token
        );
        if (baseLoc) {
          const loc = await this.findSymbolInFile(
            baseLoc.uri.fsPath,
            name,
            context
          );
          if (loc) {
            parentStruct = await this.resolveStructRecursive(
              name,
              baseLoc.uri,
              loc.line,
              context,
              resourcesPath,
              level + 1
            );
            break;
          }
        }
      }
    }

    // Parse current struct
    const ast = ASTManager.getAST({
      uri: uri,
      getText: () => docText,
    } as vscode.TextDocument);

    const structNode = this.findNodeAtLine(ast, line) as BlockNode;
    const currentStruct: ComputedStruct = {
      name,
      properties: new Map(),
      sourceFile: uri.fsPath,
      line: line,
      inheritanceLevel: level,
      isBpatch,
      refkey: refkeyMatch ? refkeyMatch[1] : undefined,
    };

    if (parentStruct) {
      // Copy parent properties
      for (const [key, val] of parentStruct.properties) {
        currentStruct.properties.set(key, val);
      }
    }

    if (structNode && structNode.children) {
      for (const child of structNode.children) {
        if (child.type === "Property") {
          const prop = child as PropertyNode;
          const isRemoved = prop.value.includes("removenode");
          currentStruct.properties.set(prop.key, {
            key: prop.key,
            value: prop.value,
            sourceFile: uri.fsPath,
            line: prop.range.start.line,
            inheritanceLevel: level,
            isRemoved,
          });
        } else if (child.type === "Block") {
          const block = child as BlockNode;
          const existing = currentStruct.properties.get(block.name);

          if (block.name === "[*]") {
            const arrayKey = this.getNextArrayKey(currentStruct.properties);
            const newBlock = await this.parseBlockToComputed(block, uri, level);
            newBlock.name = arrayKey;
            currentStruct.properties.set(arrayKey, newBlock);
          } else if (
            block.params?.includes("{bpatch}") &&
            existing &&
            "properties" in existing
          ) {
            // Merge nested bpatch
            const merged = await this.mergeNestedStruct(
              existing as ComputedStruct,
              block,
              uri,
              level
            );
            currentStruct.properties.set(block.name, merged);
          } else {
            // Overwrite or new block
            const newBlock = await this.parseBlockToComputed(block, uri, level);
            currentStruct.properties.set(block.name, newBlock);
          }
        }
      }
    }

    return currentStruct;
  }

  private static getNextArrayKey(properties: Map<string, any>): string {
    const indices = Array.from(properties.keys())
      .map((k) => {
        const match = k.match(/^\[(\d+)\]$/);
        return match ? parseInt(match[1]) : -1;
      })
      .filter((i) => i >= 0);
    const next = indices.length > 0 ? Math.max(...indices) + 1 : 0;
    return `[${next}]`;
  }

  private static async mergeNestedStruct(
    base: ComputedStruct,
    patch: BlockNode,
    uri: vscode.Uri,
    level: number
  ): Promise<ComputedStruct> {
    const result: ComputedStruct = {
      ...base,
      inheritanceLevel: level, // Update level to current
    };

    if (patch.children) {
      for (const child of patch.children) {
        if (child.type === "Property") {
          const prop = child as PropertyNode;
          if (prop.key === "[*]") {
            const arrayKey = this.getNextArrayKey(result.properties);
            result.properties.set(arrayKey, {
              key: arrayKey,
              value: prop.value,
              sourceFile: uri.fsPath,
              line: prop.range.start.line,
              inheritanceLevel: level,
            });
          } else {
            const isRemoved = prop.value.includes("removenode");
            result.properties.set(prop.key, {
              key: prop.key,
              value: prop.value,
              sourceFile: uri.fsPath,
              line: prop.range.start.line,
              inheritanceLevel: level,
              isRemoved,
            });
          }
        } else if (child.type === "Block") {
          const block = child as BlockNode;
          if (block.name === "[*]") {
            const arrayKey = this.getNextArrayKey(result.properties);
            const newBlock = await this.parseBlockToComputed(block, uri, level);
            newBlock.name = arrayKey;
            result.properties.set(arrayKey, newBlock);
          } else {
            const existing = result.properties.get(block.name);
            if (
              block.params?.includes("{bpatch}") &&
              existing &&
              "properties" in existing
            ) {
              const merged = await this.mergeNestedStruct(
                existing as ComputedStruct,
                block,
                uri,
                level
              );
              result.properties.set(block.name, merged);
            } else {
              const newBlock = await this.parseBlockToComputed(
                block,
                uri,
                level
              );
              result.properties.set(block.name, newBlock);
            }
          }
        }
      }
    }
    return result;
  }

  private static async parseBlockToComputed(
    block: BlockNode,
    uri: vscode.Uri,
    level: number
  ): Promise<ComputedStruct> {
    const struct: ComputedStruct = {
      name: block.name,
      properties: new Map(),
      sourceFile: uri.fsPath,
      line: block.range.start.line,
      inheritanceLevel: level,
      isBpatch: block.params?.includes("{bpatch}") || false,
      refkey: block.params?.match(REGEX.REFKEY)?.[1],
    };

    if (block.children) {
      for (const child of block.children) {
        if (child.type === "Property") {
          const prop = child as PropertyNode;
          const key =
            prop.key === "[*]"
              ? this.getNextArrayKey(struct.properties)
              : prop.key;
          struct.properties.set(key, {
            key: key,
            value: prop.value,
            sourceFile: uri.fsPath,
            line: prop.range.start.line,
            inheritanceLevel: level,
          });
        } else if (child.type === "Block") {
          const subBlock = child as BlockNode;
          const key =
            subBlock.name === "[*]"
              ? this.getNextArrayKey(struct.properties)
              : subBlock.name;
          const subStruct = await this.parseBlockToComputed(
            subBlock,
            uri,
            level
          );
          subStruct.name = key;
          struct.properties.set(key, subStruct);
        }
      }
    }
    return struct;
  }

  private static findNodeAtLine(node: ASTNode, line: number): ASTNode | null {
    if (node.children) {
      for (const child of node.children) {
        if (child.range.start.line === line) {
          return child;
        }
        if (line > child.range.start.line && line <= child.range.end.line) {
          const nested = this.findNodeAtLine(child, line);
          if (nested) return nested;
        }
      }
    }
    return null;
  }

  private static async resolveFileByName(
    filename: string,
    activeFilePath: string,
    resourcesPath: string
  ): Promise<vscode.Location | null> {
    const currentDir = path.dirname(activeFilePath);
    const relativePath = path.resolve(currentDir, filename);
    if (fs.existsSync(relativePath)) {
      return new vscode.Location(
        vscode.Uri.file(relativePath),
        new vscode.Position(0, 0)
      );
    }
    // Try without relative
    const directPath = path.resolve(resourcesPath, filename);
    if (fs.existsSync(directPath)) {
      return new vscode.Location(
        vscode.Uri.file(directPath),
        new vscode.Position(0, 0)
      );
    }
    return await findFileExact(
      filename,
      resourcesPath,
      new vscode.CancellationTokenSource().token
    );
  }

  private static async findSymbolInFile(
    fsPath: string,
    symbol: string,
    context: BlockContext[] = []
  ): Promise<{ line: number } | null> {
    try {
      const content = await fs.promises.readFile(fsPath, "utf-8");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          line.toLowerCase().includes(symbol.toLowerCase()) &&
          (line.includes("struct.begin") ||
            line.toLowerCase().includes("sid ="))
        ) {
          // Verify it's the actual name
          const match = line.match(/^\s*([\w./\\]+)\s*[:=]/);
          if (match && match[1].toLowerCase() === symbol.toLowerCase()) {
            return { line: i };
          }
        }
      }
    } catch {}
    return null;
  }

  private static getPotentialBaseFiles(
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
    return [...new Set(baseFiles)];
  }

  private static getHtmlForWebview(
    webview: vscode.Webview,
    struct: ComputedStruct,
    rootName: string
  ): string {
    const content = this.renderStruct(struct, 0);
    return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <style>
              body { font-family: 'Consolas', 'Monaco', monospace; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 10px; line-height: 1.2; overflow-x: hidden; }
              .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--vscode-editorIndentGuide-background); padding-bottom: 10px; margin-bottom: 15px; }
              .controls { display: flex; gap: 10px; }
              button { 
                  background-color: var(--vscode-button-background); 
                  color: var(--vscode-button-foreground); 
                  border: none; 
                  padding: 4px 12px; 
                  cursor: pointer; 
                  font-size: 12px;
                  border-radius: 2px;
              }
              button:hover { background-color: var(--vscode-button-hoverBackground); }
              .code-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 400px); gap: 20px; transition: all 0.2s; }
              .code-grid.hide-metadata { grid-template-columns: minmax(0, 1fr); }
              .code-grid.hide-metadata .source-info { display: none; }
              
              .struct { border-left: 1px solid var(--vscode-editorIndentGuide-background); padding-left: 20px; grid-column: 1 / span 2; display: grid; grid-template-columns: subgrid; }
              .hide-metadata .struct { grid-column: 1; }
              
              .property-row { display: grid; grid-template-columns: subgrid; grid-column: 1 / span 2; align-items: baseline; }
              .hide-metadata .property-row { grid-column: 1; }
              
              .property-row:hover { background-color: var(--vscode-list-hoverBackground); }
              .property-content { white-space: pre; grid-column: 1; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
              .key { color: #9CDCFE; }
              .value { color: #CE9178; }
              .source-info { 
                  color: #6A9955; 
                  font-size: 0.9em; 
                  cursor: pointer; 
                  font-style: italic; 
                  grid-column: 2; 
                  white-space: nowrap; 
                  padding-left: 20px; 
                  border-left: 1px solid var(--vscode-editorIndentGuide-background);
                  overflow: hidden;
                  text-overflow: ellipsis;
              }
              .source-info:hover { text-decoration: underline; }
              .removed { text-decoration: line-through; opacity: 0.5; }
              .keyword { color: #C586C0; }
              .comment { color: #6A9955; }
              h2 { font-size: 1.2em; margin: 0; }
              
              @media (max-width: 700px) {
                  .code-grid { grid-template-columns: 1fr !important; }
                  .struct { grid-template-columns: 1fr; padding-left: 15px; }
                  .property-row { grid-template-columns: 1fr; }
                  .source-info { 
                      grid-column: 1; 
                      border-left: none; 
                      padding-left: 10px; 
                      font-size: 0.8em; 
                      margin-bottom: 5px;
                      display: block !important;
                  }
              }
          </style>
      </head>
      <body>
          <div class="header">
              <h2>Computed View: ${rootName}</h2>
              <div class="controls">
                  <button onclick="toggleMetadata()">Toggle Metadata</button>
                  <button id="copyBtn" onclick="copyToClipboard()">Copy to Clipboard</button>
              </div>
          </div>
          <div id="grid" class="code-grid">
              ${content}
          </div>
          <script>
              const vscode = acquireVsCodeApi();
              function openSource(file, line) {
                  vscode.postMessage({ command: 'openSource', file: file, line: line });
              }
              function toggleMetadata() {
                  document.getElementById('grid').classList.toggle('hide-metadata');
              }
              function copyToClipboard() {
                  vscode.postMessage({ command: 'copyToClipboard' });
                  const btn = document.getElementById('copyBtn');
                  const oldText = btn.innerText;
                  btn.innerText = 'Copied!';
                  setTimeout(() => { btn.innerText = oldText; }, 2000);
              }
          </script>
      </body>
      </html>`;
  }

  private static renderStruct(struct: ComputedStruct, indent: number): string {
    const sourceLabel = `// from ${path.basename(struct.sourceFile)}:${
      struct.line + 1
    }${struct.refkey ? " (refkey=" + struct.refkey + ")" : ""}`;
    let html = `
    <div class="property-row">
        <div class="property-content"><span class="key">${
          struct.name
        }</span> : <span class="keyword">struct.begin</span></div>
        <div class="source-info" onclick="openSource('${struct.sourceFile.replace(
          /\\/g,
          "\\\\"
        )}', ${struct.line})">${sourceLabel}</div>
    </div>`;

    html += `<div class="struct">`;
    for (const [key, val] of struct.properties) {
      if ("properties" in val) {
        html += this.renderStruct(val as ComputedStruct, indent + 1);
      } else {
        const prop = val as ComputedProperty;
        if (prop.isRemoved) continue;
        const propSource = `// from ${path.basename(prop.sourceFile)}:${
          prop.line + 1
        }${prop.refkey ? " (refkey=" + prop.refkey + ")" : ""}`;
        html += `
        <div class="property-row">
            <div class="property-content"><span class="key">${
              prop.key
            }</span> = <span class="value">${prop.value}</span></div>
            <div class="source-info" onclick="openSource('${prop.sourceFile.replace(
              /\\/g,
              "\\\\"
            )}', ${prop.line})">${propSource}</div>
        </div>`;
      }
    }
    html += `</div>`;
    html += `
    <div class="property-row">
        <div class="property-content"><span class="keyword">struct.end</span></div>
        <div class="source-info"></div>
    </div>`;
    return html;
  }
}
