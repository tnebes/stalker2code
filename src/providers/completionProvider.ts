import * as vscode from "vscode";
import { StalkerEnums } from "../stalkerEnums";

export class StalkerCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    // Check if we are typing after '::'
    const linePrefix = document
      .lineAt(position)
      .text.substr(0, position.character);
    const match = linePrefix.match(/\b(\w+)::$/);

    if (match) {
      const enumName = match[1];
      const enums = StalkerEnums as any;

      if (enums[enumName]) {
        return Object.entries(enums[enumName]).map(([name, value]) => {
          const item = new vscode.CompletionItem(
            name,
            vscode.CompletionItemKind.EnumMember
          );
          item.detail = `Value: ${value}`;
          item.documentation = new vscode.MarkdownString(
            `Enum: \`${enumName}\``
          );
          return item;
        });
      }
    }

    // Generic enum completion
    if (context.triggerCharacter !== ":") {
      return Object.keys(StalkerEnums).map((name) => {
        const item = new vscode.CompletionItem(
          name,
          vscode.CompletionItemKind.Enum
        );
        item.detail = "Stalker 2 Enum";
        return item;
      });
    }

    return [];
  }
}
