import * as vscode from "vscode";
import { ASTManager } from "../astManager";
import { ASTNode, BlockNode, PropertyNode, ErrorNode } from "../parser/ast";
import { extensionOutputChannel } from "../extension";
import { validateCfgFilename } from "../validation";

export function activateDiagnostics(context: vscode.ExtensionContext) {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("stalker2-config");

  function updateDiagnostics(document: vscode.TextDocument) {
    if (document.languageId !== "stalker2-config") {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    // extensionOutputChannel.appendLine(`Updating diagnostics for: ${document.uri.fsPath}`);

    // Validate filename pattern
    const filenameValidation = validateCfgFilename(document.uri.fsPath);
    if (!filenameValidation.valid && filenameValidation.error) {
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0), // Show at the top of the file
          filenameValidation.error,
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    function collectDiagnostics(node: ASTNode) {
      if (node.type === "Error") {
        const error = node as ErrorNode;
        diagnostics.push(
          new vscode.Diagnostic(
            error.range,
            error.message,
            vscode.DiagnosticSeverity.Error
          )
        );
      }

      if (node.children) {
        const keys = new Map<string, vscode.Range>();
        for (const child of node.children) {
          if (child.type === "Property") {
            const prop = child as PropertyNode;
            if (keys.has(prop.key) && prop.key !== "[*]") {
              diagnostics.push(
                new vscode.Diagnostic(
                  prop.range,
                  `Duplicate property key '${prop.key}'.`,
                  vscode.DiagnosticSeverity.Warning
                )
              );
            } else {
              keys.set(prop.key, prop.range);
            }
          } else if (child.type === "Block") {
            const block = child as BlockNode;
            if (!block.endTokenRange) {
              diagnostics.push(
                new vscode.Diagnostic(
                  block.startTokenRange,
                  `Unclosed block '${block.name}'. Missing 'struct.end'.`,
                  vscode.DiagnosticSeverity.Error
                )
              );
            }
          }
          collectDiagnostics(child);
        }
      }
    }

    try {
      const ast = ASTManager.getAST(document);
      collectDiagnostics(ast);
    } catch (e) {
      extensionOutputChannel.appendLine(`Error updating diagnostics: ${e}`);
    }

    diagnosticCollection.set(document.uri, diagnostics);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => updateDiagnostics(doc))
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) =>
      updateDiagnostics(e.document)
    )
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) =>
      diagnosticCollection.delete(doc.uri)
    )
  );

  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document);
  }
}
