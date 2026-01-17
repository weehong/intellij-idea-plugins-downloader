# JetBrains Plugin Installer CLI

An interactive command-line tool to search for IntelliJ IDEA plugins via the JetBrains Marketplace API and generate installation commands.

## Features

- **Browse plugins**: Browse and search plugins from the JetBrains Marketplace with interactive multi-select
- **Search-as-you-type**: Real-time plugin search with autocomplete
- **Multi-plugin selection**: Add multiple plugins to your "basket" before generating the command
- **Auto-detect IDE**: Automatically detects IntelliJ IDEA installations on your system
- **Clipboard support**: Copy the generated command directly to your clipboard
- **Keyboard navigation**: Use arrow keys or number keys to navigate menus
- **Escape to go back**: Press Escape in any submenu to return to the main menu
- **Persistent selection**: Your plugin selection is saved between sessions
- **Import from command**: Import plugin IDs from an existing install command
- **Cross-platform**: Works on macOS, Windows, and Linux (including WSL)

## Prerequisites

- Node.js 18.0.0 or higher
- IntelliJ IDEA (or other JetBrains IDE)

## Installation

1. Clone or download this project
2. Install dependencies:

```bash
npm install
```

3. Run the CLI:

```bash
npm start
# or
node index.js
```

### Global Installation (Optional)

To install the CLI globally and use it from anywhere:

```bash
npm install -g .
# Then use:
jb-plugins
```

## Usage

1. Run the CLI:

```bash
npm start
```

2. Use the main menu to:
   - **Browse all plugins**: Interactive multi-select with search filtering
   - **Import from command**: Paste an existing install command to import plugin IDs
   - **View selected plugins**: See your current selection
   - **Remove plugins**: Remove plugins from your selection
   - **Clear all**: Clear your entire selection
   - **Generate command**: Create the installation command

### Keyboard Navigation

**Main Menu:**
- Use `Up/Down` or `Left/Right` arrow keys to navigate
- Press a number key (`1-6`, `0`) for instant selection
- Press `Enter` to confirm selection

**All Submenus:**
- Press `Escape` to return to the main menu
- Press `Ctrl+C` to exit

**Browse Plugins:**
- Type to search/filter plugins
- Use `Up/Down` arrows to navigate
- Press `Space` to toggle selection
- Press `Enter` to confirm
- Press `Escape` to cancel

## Example Workflow

```
============================================================
  JetBrains Plugin Installer
  Search and install IntelliJ IDEA plugins with ease
============================================================

------------------------------------------------------------
Selected Plugins (3):
   1. Rainbow Brackets (izhangzhihao.rainbow.brackets)
   2. IdeaVIM (IdeaVIM)
   3. Key Promoter X (Key Promoter X)
------------------------------------------------------------

What would you like to do? (use arrow keys or number)

> [1] Browse all plugins (multi-select with filter)
  [2] Import from install command
  [3] View selected plugins
  [4] Remove a plugin from selection
  [5] Clear all selections
  [6] Generate install command
  [0] Exit
```

### Generated Command

The tool automatically detects your IntelliJ IDEA installation and generates a properly quoted command:

```
================================================================================
INSTALLATION COMMAND
================================================================================

"/Users/username/Applications/IntelliJ IDEA.app/Contents/MacOS/idea" installPlugins izhangzhihao.rainbow.brackets IdeaVIM "Key Promoter X"

================================================================================
```

## Auto-Detection

The CLI automatically searches for IntelliJ IDEA installations in common locations:

**macOS:**
- `/Applications`
- `~/Applications`
- `~/Library/Application Support/JetBrains/Toolbox/apps`

**Windows:**
- `%LOCALAPPDATA%/Programs`
- `%PROGRAMFILES%/JetBrains`
- `%PROGRAMFILES(X86)%/JetBrains`
- Toolbox app installations

**Linux:**
- `/opt`
- `/usr/local`
- `~/.local/share/JetBrains/Toolbox/apps`
- Snap installations

If multiple installations are found, you'll be prompted to select one.

## Configuring the `idea` Command-Line Launcher (Optional)

If auto-detection doesn't find your IDE, you can configure the command-line launcher manually.

### macOS

1. Open IntelliJ IDEA
2. Go to **Tools** > **Create Command-line Launcher...**
3. Accept the default path (`/usr/local/bin/idea`) or choose a custom location

### Windows

1. Open IntelliJ IDEA
2. Go to **Tools** > **Create Command-line Launcher...**
3. Add the created directory to your system PATH

### Linux

1. Open IntelliJ IDEA
2. Go to **Tools** > **Create Command-line Launcher...**
3. Accept the default path (`/usr/local/bin/idea`)

## API Reference

This tool uses the JetBrains Marketplace API:

- **Search Endpoint**: `https://plugins.jetbrains.com/api/search/plugins`
- **Browse Endpoint**: `https://plugins.jetbrains.com/api/searchPlugins`

## Troubleshooting

### "idea: command not found"

The `idea` command-line launcher is not configured and auto-detection failed. Either:
1. Configure the command-line launcher manually (see above)
2. Ensure IntelliJ IDEA is installed in a standard location

### API Rate Limiting

If you see rate limit errors, wait a few seconds before searching again.

### Network Issues

Ensure you have an active internet connection. The tool requires access to `plugins.jetbrains.com`.

### Clipboard Not Working

On some Linux systems, you may need to install additional packages:

```bash
# For X11
sudo apt install xclip
# or
sudo apt install xsel

# For Wayland
sudo apt install wl-clipboard
```

## Other JetBrains IDEs

The tool auto-detects IntelliJ IDEA, but you can manually use other JetBrains IDE launchers by replacing `idea` in the generated command:

| IDE | Command |
|-----|---------|
| IntelliJ IDEA | `idea` |
| PyCharm | `pycharm` |
| WebStorm | `webstorm` |
| PhpStorm | `phpstorm` |
| RubyMine | `rubymine` |
| CLion | `clion` |
| GoLand | `goland` |
| Rider | `rider` |
| DataGrip | `datagrip` |

## Configuration

Plugin selections are saved to `~/.jb-plugins-config.json` and persist between sessions.

## License

MIT
