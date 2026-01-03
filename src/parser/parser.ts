import * as vscode from "vscode";
import { Token, Tokenizer } from "./tokenizer";
import {
  ASTNode,
  BlockNode,
  DocumentNode,
  PropertyNode,
  ErrorNode,
} from "./ast";

export class Parser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(text: string): DocumentNode {
    const tokenizer = new Tokenizer();
    // Filter out whitespace and comments for parsing logic, but we might want them for range calculations
    // For now, let's keep them and skip them explicitly.
    this.tokens = tokenizer.tokenize(text);
    this.pos = 0;

    const doc: DocumentNode = {
      type: "Document",
      range: new vscode.Range(0, 0, 0, 0), // Will update after parsing
      children: [],
    };

    let iterations = 0;
    const maxIterations = this.tokens.length * 2;

    while (!this.isAtEnd() && iterations < maxIterations) {
      iterations++;
      const startPos = this.pos;
      const node = this.parseTopLevel();
      if (node) {
        doc.children.push(node);
      }

      // Safety: if we didn't advance, advance manually to avoid infinite loops
      if (this.pos === startPos && !this.isAtEnd()) {
        this.advance();
      }
    }

    if (this.tokens.length > 0) {
      const start = this.tokens[0].range.start;
      const end = this.tokens[this.tokens.length - 1].range.end;
      doc.range = new vscode.Range(start, end);
    }

    return doc;
  }

  private parseTopLevel(): ASTNode | null {
    this.skipTrivia();
    if (this.isAtEnd()) return null;

    // If we see a 'struct.end', don't consume it here.
    // Return null so that the parent block's child-parsing loop can catch it.
    if (this.check("KEYWORD_END")) {
      return null;
    }

    // Look ahead for COLON or EQUAL on the same line
    let lookahead = 0;
    let foundSeparator: "COLON" | "EQUAL" | null = null;
    while (this.peek(lookahead) && !this.isTokenNewLine(this.peek(lookahead))) {
      const type = this.peek(lookahead).type;
      if (type === "COLON") {
        foundSeparator = "COLON";
        break;
      }
      if (type === "EQUAL") {
        foundSeparator = "EQUAL";
        break;
      }
      lookahead++;
    }

    if (foundSeparator === "COLON") {
      return this.parseBlock();
    } else if (foundSeparator === "EQUAL") {
      return this.parseProperty();
    }

    const token = this.advance();
    if (token.type !== "WHITESPACE" && token.type !== "COMMENT") {
      return {
        type: "Error",
        message: `Unexpected token '${token.value}'. Expected a block definition or property assignment.`,
        range: token.range,
      } as ErrorNode;
    }
    return null;
  }

  private parseBlock(): BlockNode | ErrorNode {
    const startToken = this.peek();
    let name = "";
    while (!this.isAtEnd() && !this.check("COLON") && !this.isAtNewLine()) {
      name += this.advance().value;
    }
    name = name.trim();

    this.skipTrivia();

    if (!this.match("COLON")) {
      return this.createError(
        "Expected ':' after block name.",
        startToken.range
      );
    }
    this.skipTrivia();

    if (!this.match("KEYWORD_BEGIN")) {
      return this.createError(
        "Expected 'struct.begin' after ':'.",
        startToken.range
      );
    }
    this.match("COLON"); // Consume optional trailing colon like 'struct.begin:'
    this.skipTrivia();

    let params: string | undefined;
    if (this.check("LBRACE")) {
      const start = this.pos;
      this.advance(); // {
      let depth = 1;
      // Limit parameter block to 1000 tokens to prevent memory crashes on unmatched braces
      while (!this.isAtEnd() && depth > 0 && this.pos - start < 1000) {
        if (this.check("LBRACE")) depth++;
        if (this.check("RBRACE")) depth--;
        this.advance();
      }
      const end = this.pos;
      params = this.tokens
        .slice(start, end)
        .map((t) => t.value)
        .join("");
    }

    const children: ASTNode[] = [];
    const startLine = startToken.range.start.line;

    while (!this.isAtEnd() && !this.check("KEYWORD_END")) {
      const node = this.parseTopLevel();
      if (node) {
        children.push(node);
      }
      this.skipTrivia();
    }

    let endRange: vscode.Range | undefined;
    if (this.match("KEYWORD_END")) {
      endRange = this.previous().range;
    }

    const range = new vscode.Range(
      startToken.range.start,
      endRange
        ? endRange.end
        : children.length > 0
        ? children[children.length - 1].range.end
        : startToken.range.end
    );

    return {
      type: "Block",
      name: name,
      params,
      children,
      range,
      startTokenRange: startToken.range,
      endTokenRange: endRange,
    };
  }

  private parseProperty(): PropertyNode | ErrorNode {
    const startToken = this.peek();
    let key = "";
    while (!this.isAtEnd() && !this.check("EQUAL") && !this.isAtNewLine()) {
      key += this.advance().value;
    }
    key = key.trim();

    this.skipTrivia();

    if (!this.match("EQUAL")) {
      return this.createError(
        "Expected '=' after property key.",
        startToken.range
      );
    }

    // Skip only horizontal whitespace on the same line after '='
    while (
      !this.isAtEnd() &&
      this.check("WHITESPACE") &&
      !this.peek().value.includes("\n")
    ) {
      this.advance();
    }

    // The value is basically everything until the end of the line or next token that looks like a new entry
    // In Stalker 2, values can be complex.
    let value = "";
    const startValuePos = this.pos;

    while (
      !this.isAtEnd() &&
      !this.isAtNewLine() &&
      !this.looksLikeNextEntry()
    ) {
      if (this.check("COMMENT")) break;
      value += this.advance().value;
    }

    const endValuePos = this.pos;
    const range = new vscode.Range(
      startToken.range.start,
      endValuePos > startValuePos
        ? this.tokens[endValuePos - 1].range.end
        : startToken.range.end
    );

    return {
      type: "Property",
      key: key,
      value: value.trim(),
      range,
    };
  }

  private looksLikeNextEntry(): boolean {
    // If the next token is on a new line and followed by : or = it's a new entry
    // This is a bit tricky with trivia.
    return false; // For now keep it simple: everything until new line is value
  }

  private isAtNewLine(): boolean {
    if (this.isAtEnd()) return true;
    const current = this.peek();

    // If this token itself contains a newline, it's a boundary
    if (this.isTokenNewLine(current)) return true;

    if (this.pos > 0) {
      const prev = this.tokens[this.pos - 1];
      // A "new line" means the current token starts on a line AFTER the previous token ended its line.
      // Reverting to end.line comparison to correctly handle multi-line tokens (comments, multi-line blocks).
      if (current.range.start.line > prev.range.end.line) return true;
    }
    return false;
  }

  private isTokenNewLine(token: Token): boolean {
    if (!token) return false;
    return (
      (token.type === "WHITESPACE" && token.value.includes("\n")) ||
      token.type === "COMMENT"
    );
  }

  private skipTrivia() {
    while (
      !this.isAtEnd() &&
      (this.check("WHITESPACE") || this.check("COMMENT"))
    ) {
      this.advance();
    }
  }

  private match(...types: string[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: string): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset];
  }

  private previous(): Token {
    return this.tokens[this.pos - 1];
  }

  private createError(message: string, range: vscode.Range): ErrorNode {
    return { type: "Error", message, range };
  }
}
