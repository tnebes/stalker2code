import * as vscode from "vscode";
import { Parser } from "./parser/parser";
import { DocumentNode } from "./parser/ast";

export class ASTManager {
  private static astCache = new Map<string, DocumentNode>();
  private static parser = new Parser();
  private static disposables: vscode.Disposable[] = [];

  public static activate(context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "stalker2-config") {
          this.invalidate(e.document.uri);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.invalidate(doc.uri);
      })
    );
    context.subscriptions.push(...this.disposables);
  }

  public static getAST(document: vscode.TextDocument): DocumentNode {
    const uri = document.uri.toString();
    if (this.astCache.has(uri)) {
      return this.astCache.get(uri)!;
    }

    const ast = this.parser.parse(document.getText());
    this.astCache.set(uri, ast);
    return ast;
  }

  public static invalidate(uri: vscode.Uri) {
    this.astCache.delete(uri.toString());
  }

  public static clear() {
    this.astCache.clear();
  }
}
