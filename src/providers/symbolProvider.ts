import * as vscode from "vscode";
import { ASTManager } from "../astManager";
import { ASTNode, BlockNode, PropertyNode } from "../parser/ast";

export class StalkerDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  public provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const ast = ASTManager.getAST(document);
    return this.collectSymbols(ast.children);
  }

  private collectSymbols(nodes: ASTNode[]): vscode.DocumentSymbol[] {
    const symbols: vscode.DocumentSymbol[] = [];

    for (const node of nodes) {
      if (node.type === "Block") {
        const block = node as BlockNode;
        const symbol = new vscode.DocumentSymbol(
          block.name,
          block.params || "struct",
          vscode.SymbolKind.Namespace,
          block.range,
          block.startTokenRange
        );
        symbol.children = this.collectSymbols(block.children);
        symbols.push(symbol);
      } else if (node.type === "Property") {
        const prop = node as PropertyNode;
        const symbol = new vscode.DocumentSymbol(
          prop.key,
          prop.value,
          vscode.SymbolKind.Property,
          prop.range,
          prop.range
        );
        symbols.push(symbol);
      }
    }

    return symbols;
  }
}
