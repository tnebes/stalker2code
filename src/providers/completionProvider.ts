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

    // Check for struct.begin modifiers
    if (/\bstruct\.begin\s*$/.test(linePrefix)) {
      const bpatch = new vscode.CompletionItem(
        "{bpatch}",
        vscode.CompletionItemKind.Keyword
      );
      bpatch.insertText = "{bpatch}";
      bpatch.documentation = "Marks this struct as a patch.";

      const refurl = new vscode.CompletionItem(
        "{refurl}",
        vscode.CompletionItemKind.Keyword
      );
      refurl.insertText = new vscode.SnippetString("{refurl=$1}");
      refurl.documentation = "Reference to a struct in another file.";

      const refkey = new vscode.CompletionItem(
        "{refkey}",
        vscode.CompletionItemKind.Keyword
      );
      refkey.insertText = new vscode.SnippetString("{refkey=$1}");
      refkey.documentation = "Reference to a struct in the same file.";

      return [bpatch, refurl, refkey];
    }

    // Generic enum completion
    if (context.triggerCharacter !== ":") {
      const items: vscode.CompletionItem[] = Object.keys(StalkerEnums).map(
        (name) => {
          const item = new vscode.CompletionItem(
            name,
            vscode.CompletionItemKind.Enum
          );
          item.detail = "Stalker 2 Enum";
          return item;
        }
      );

      // Add struct.begin snippet
      const structBegin = new vscode.CompletionItem(
        "struct.begin",
        vscode.CompletionItemKind.Snippet
      );
      structBegin.insertText = new vscode.SnippetString(
        "struct.begin\n\t$0\nstruct.end"
      );
      structBegin.detail = "Struct Block";
      structBegin.documentation =
        "Creates a new struct block with matching end.";
      items.push(structBegin);

      return items;
    }

    return [];
  }
}
