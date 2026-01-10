# S.T.A.L.K.E.R. 2 Navigator

Advanced workspace support for S.T.A.L.K.E.R. 2 configuration modding (`.cfg`).

## Key Features

- **Robust Navigation**: Instant "Go to Definition" (F12) or `Ctrl+Click` for:
  - **Prototypes & Structs**: Cross-file lookups for base classes and referenced prototypes.
  - **Resource Files**: Direct navigation to files referenced in `{refurl}`.
  - **String IDs (SID)**: Jump to source definitions of unique identifiers.
- **Inheritance Visualizer**: A dedicated sidebar tree view that shows the complete parent and child hierarchy for any struct.
- **Computed View**: A resolved view of any object:
  - **Recursive Resolution**: Traces the entire inheritance chain ({refurl}, {refkey}).
  - **Patch Merging**: Correct merges using S.T.A.L.K.E.R. 2 rules ({bpatch}, `{bskipref}`, `removenode`).
  - **Array Handling**: Correctly appends elements via `[*]`.
  - **Two-Column Layout**: Code on the left, source metadata (file, line, refkey) on the right.
- **Smart Validation**: Real-time syntax diagnostics for unclosed blocks and duplicate keys.
- **Hierarchical Outline**: Clean document structure view for easy navigation of massive config files.
- **Enum Support**: Enhanced features for S.T.A.L.K.E.R. 2 enums:
  - **Syntax Highlighting**: Proper highlighting for `Enum::Member` pairs.
  - **Hover Tooltips**: Mouse over any enum to see its numeric value and all other possible members.
  - **Intellisense**: Auto-completion for enum names and members when typing `::`.
- **AST-Powered**: High-performance parsing with centralized caching for a smooth experience.

### Inheritance and Computed View

The **Inheritance Structure** view provides a tree representation of a struct's lineage. The **Computed View** builds upon this by generating a "final" version of the struct as the game would see it. It features a responsive two-column layout where you can click any source annotation to jump directly to the original file.

![Inheritance and Computed View](https://github.com/tnebes/stalker2code/blob/master/media/inheritanceComputedView.gif?raw=true)

### Syntax Highlighting

The extension provides syntax highlighting for `.cfg` files, including strings, numbers, keywords, and enums.

![Syntax Highlighting](https://github.com/tnebes/stalker2code/blob/master/media/navigatorSyntax.gif?raw=true)

### Problem Reporting

Real-time validation helps catch common modding errors like forgetting to close a `struct.begin` block or using duplicate keys within the same scope.

![Problem Reporting](https://github.com/tnebes/stalker2code/blob/master/media/problemReport.gif?raw=true)

### Outline

The Outline view allows for quick navigation through large configuration files by listing all defined structs and their nesting.

![Outline](https://github.com/tnebes/stalker2code/blob/master/media/outline.png?raw=true)

## Setup

1. **Setup Screen**: Upon first installation, the extension will show a setup screen to help you configure your `resourcesPath`. You can always re-run this via `Stalker 2: Show Setup/Intro Screen`.
2. **Resources Path**: Set the `stalker2.resourcesPath` in settings to your unpacked game data folder (must contain the `Stalker2` subfolder).
3. **Indexing**: The extension automatically indexes files on demand to keep memory usage low.

## Configuration

| Setting                    | Description                                    | Default |
| -------------------------- | ---------------------------------------------- | ------- |
| `stalker2.resourcesPath`   | Path to extracted Stalker 2 resources.         | `""`    |
| `stalker2.search.maxDepth` | Maximum directory depth for symbol scanning.   | `12`    |
| `stalker2.search.maxFiles` | Maximum number of files to scan during search. | `50000` |
| `stalker2.search.timeout`  | Timeout (ms) for global search operations.     | `15000` |

## Commands

- `Stalker 2: Show Setup/Intro Screen`: Opens the interactive onboarding screen.
- `Stalker 2: Show Inheritance Structure`: Opens the tree view for the struct under the cursor.
- `Stalker 2: Show Computed View`: Opens the resolved/merged view for the struct under the cursor.
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
