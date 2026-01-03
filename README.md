# S.T.A.L.K.E.R. 2 Navigator

This extension provides support for S.T.A.L.K.E.R. 2 configuration modding (`.cfg` files).

## Features

- **Syntax Highlighting**: tailored for `.cfg` files, highlighting `struct.begin`, `struct.end`, `{bpatch}`, and more.
- **Go to Definition**: 
    - Click on a struct name to find where it is defined in the original game resources.
    - Click on a file name (ending in `.cfg`) to open that file.
    - Click on a SID to find its definition.

## Setup

1. **Install**: Load this extension in VS Code.
2. **Configure**: Go to VS Code Settings (`Ctrl+,`).
3. Search for `Navigator`.
4. Set `S.T.A.L.K.E.R. 2 Navigator: Resources Path` to the folder containing your unpacked game resources. The chosen folder must be `Stalker2`

## Usage

- Open any `.cfg` file.
- **Ctrl+Click** (or **F12**) on a struct name, SID, or file reference to navigate.

## Development

- Run `npm install` to install dependencies.
- Open in VS Code.
- Press **F5** to launch a debug window with the extension loaded.

## Building to .vsix

To package the extension for manual installation:
1. Run `npm install`
2. Run `npx vsce package`

# Rationale

This visual studio code extension is powered exclusively by spite.
