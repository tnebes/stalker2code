# S.T.A.L.K.E.R. 2 Navigator

Advanced workspace support for S.T.A.L.K.E.R. 2 configuration modding (`.cfg`).

## Key Features

- **Robust Navigation**: Instant "Go to Definition" (F12) or `Ctrl+Click` for:
  - **Prototypes & Structs**: Cross-file lookups for base classes and referenced prototypes.
  - **Resource Files**: Direct navigation to files referenced in `{refurl}`.
  - **String IDs (SID)**: Jump to source definitions of unique identifiers.
- **Smart Validation**: Real-time syntax diagnostics for unclosed blocks and duplicate keys.
- **Hierarchical Outline**: Clean document structure view for easy navigation of massive config files.
- **Enum Support**: Enhanced features for S.T.A.L.K.E.R. 2 enums:
  - **Syntax Highlighting**: Proper highlighting for `Enum::Member` pairs.
  - **Hover Tooltips**: Mouse over any enum to see its numeric value and all other possible members.
  - **Intellisense**: Auto-completion for enum names and members when typing `::`.
- **AST-Powered**: High-performance parsing with centralized caching for a smooth experience.

### Syntax Highlighting

The video shows that a STALKER 2 `.cfg` file can have syntax highlighting when the extension is activated and the language is set to `stalker 2 config`

![Syntax Highlighting](https://github.com/tnebes/stalker2code/blob/master/media/navigatorSyntax.gif?raw=true)

### Demo

The video shows how a user can click on definitions of keys and structs and be brought to the original file for reference. Additionally, it also shows code folding of structs.

![Demo](https://github.com/tnebes/stalker2code/blob/master/media/smallDemo.gif?raw=true)

### Problem Reporting

The video shows that the user can easily fix configuration files by solving issue related to syntax, such as forgetting to close a `struct` or misstyping a certain word.

![Problem Reporting](https://github.com/tnebes/stalker2code/blob/master/media/problemReport.gif?raw=true)

### Outline

The screenshot shows the outline of a `.cfg` file.

![Outline](https://github.com/tnebes/stalker2code/blob/master/media/outline.png?raw=true)

## Setup

1. **Resources Path**: Set the `stalker2.resourcesPath` in settings to your unpacked game data folder (must contain the `Stalker2` subfolder). The unpacked game data folder is either derived from the Zone Toolkit or by downloading the unpacked game data from a modding community.
2. **Indexing**: The extension automatically indexes files on demand.

## Configuration

| Setting                    | Description                                    | Default |
| -------------------------- | ---------------------------------------------- | ------- |
| `stalker2.resourcesPath`   | Path to extracted Stalker 2 resources.         | `""`    |
| `stalker2.search.maxDepth` | Maximum directory depth for symbol scanning.   | `12`    |
| `stalker2.search.maxFiles` | Maximum number of files to scan during search. | `50000` |
| `stalker2.search.timeout`  | Timeout (ms) for global search operations.     | `15000` |

## Commands

- `Stalker 2: Clear Symbol Cache`: Resets the internal symbol and AST cache.

---

### Development

1. `npm install`
2. `F5` to start debugging.
3. `npm run package` to generate a `.vsix` in `./built/`.

### Enum Data Regeneration

The extension comes with a pre-built list of S.T.A.L.K.E.R. 2 enums. If you need to update this list from a new version of the game:

1. Obtain the `Stalker2_enums.txt` file (usually found in community modding resources or dumped from the game).
2. Run the transformation script to update the internal TypeScript enum class:

```powershell
node tools/transform-enums.js path/to/Stalker2_enums.txt src/stalkerEnums.ts
```

This will parse the C++ enums and update `src/stalkerEnums.ts` with a minified version used by the extension for hover info and intellisense.

### Rationale

This Visual Studio Code extension is powered exclusively by spite.

### Inspiration

Inspired by and code partially stolen from [stalker2-cfg-extension](https://github.com/Felicheat/stalker2-cfg-extension) by [Felicheat](https://github.com/Felicheat).
