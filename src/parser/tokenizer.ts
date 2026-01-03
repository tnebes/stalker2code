import * as vscode from "vscode";

export type TokenType =
  | "KEYWORD_BEGIN" // struct.begin
  | "KEYWORD_END" // struct.end
  | "IDENTIFIER"
  | "EQUAL"
  | "COLON"
  | "STRING"
  | "NUMBER"
  | "LBRACE" // {
  | "RBRACE" // }
  | "LBRACKET" // [
  | "RBRACKET" // ]
  | "COMMA"
  | "COMMENT"
  | "WHITESPACE"
  | "UNKNOWN";

export interface Token {
  type: TokenType;
  value: string;
  range: vscode.Range;
}

export class Tokenizer {
  private line = 0;
  private char = 0;
  private pos = 0;
  private text = "";

  tokenize(text: string): Token[] {
    this.text = text;
    this.pos = 0;
    this.line = 0;
    this.char = 0;
    const tokens: Token[] = [];

    while (this.pos < this.text.length) {
      const startPos = this.pos;
      const startLine = this.line;
      const startChar = this.char;

      const token = this.getNextToken();
      if (token) {
        tokens.push(token);
      }
    }

    return tokens;
  }

  private getNextToken(): Token | null {
    const char = this.text[this.pos];

    // Handle Whitespace
    if (/\s/.test(char)) {
      const startLine = this.line;
      const startChar = this.char;
      let value = "";
      while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) {
        const c = this.text[this.pos];
        value += c;
        this.advance();
        if (c === "\n") break; // Newline ends the whitespace token
      }
      return {
        type: "WHITESPACE",
        value,
        range: new vscode.Range(startLine, startChar, this.line, this.char),
      };
    }

    const startLine = this.line;
    const startChar = this.char;

    // Handle Comments
    if (char === "/" && this.text[this.pos + 1] === "/") {
      let value = "";
      while (this.pos < this.text.length && this.text[this.pos] !== "\n") {
        value += this.text[this.pos];
        this.advance();
      }
      return {
        type: "COMMENT",
        value,
        range: new vscode.Range(startLine, startChar, this.line, this.char),
      };
    }

    // Handle Strings
    if (char === '"' || char === "'") {
      const quote = char;
      let value = char;
      this.advance();
      while (this.pos < this.text.length && this.text[this.pos] !== quote) {
        if (this.text[this.pos] === "\\") {
          value += this.text[this.pos];
          this.advance();
        }
        value += this.text[this.pos];
        this.advance();
      }
      if (this.pos < this.text.length) {
        value += this.text[this.pos];
        this.advance();
      }
      return {
        type: "STRING",
        value,
        range: new vscode.Range(startLine, startChar, this.line, this.char),
      };
    }

    // Handle Keywords/Identifiers
    if (/[a-zA-Z_*]/.test(char)) {
      let value = "";
      while (
        this.pos < this.text.length &&
        /[a-zA-Z0-9_.*]/.test(this.text[this.pos])
      ) {
        value += this.text[this.pos];
        this.advance();
      }

      if (value === "struct.begin")
        return {
          type: "KEYWORD_BEGIN",
          value,
          range: new vscode.Range(startLine, startChar, this.line, this.char),
        };
      if (value === "struct.end")
        return {
          type: "KEYWORD_END",
          value,
          range: new vscode.Range(startLine, startChar, this.line, this.char),
        };

      return {
        type: "IDENTIFIER",
        value,
        range: new vscode.Range(startLine, startChar, this.line, this.char),
      };
    }

    // Handle Numbers
    if (
      /[0-9]/.test(char) ||
      (char === "-" && /[0-9]/.test(this.text[this.pos + 1]))
    ) {
      let value = "";
      // If it starts with a minus, consume it
      if (this.text[this.pos] === "-") {
        value += this.text[this.pos];
        this.advance();
      }
      while (
        this.pos < this.text.length &&
        /[0-9.f%]/.test(this.text[this.pos])
      ) {
        value += this.text[this.pos];
        this.advance();
      }
      return {
        type: "NUMBER",
        value,
        range: new vscode.Range(startLine, startChar, this.line, this.char),
      };
    }

    // Single character tokens
    const typeMap: Record<string, TokenType> = {
      "=": "EQUAL",
      ":": "COLON",
      "{": "LBRACE",
      "}": "RBRACE",
      "[": "LBRACKET",
      "]": "RBRACKET",
      ",": "COMMA",
    };

    if (typeMap[char]) {
      this.advance();
      return {
        type: typeMap[char],
        value: char,
        range: new vscode.Range(startLine, startChar, this.line, this.char),
      };
    }

    // Unknown
    this.advance();
    return {
      type: "UNKNOWN",
      value: char,
      range: new vscode.Range(startLine, startChar, this.line, this.char),
    };
  }

  private advance() {
    if (this.text[this.pos] === "\n") {
      this.line++;
      this.char = 0;
    } else {
      this.char++;
    }
    this.pos++;
  }
}
