#!/usr/bin/env node

/**
 * JetBrains Plugin Installer CLI
 *
 * An interactive CLI tool to search for IntelliJ IDEA plugins via the
 * JetBrains Marketplace API and generate installation commands.
 *
 * Usage: node index.js
 *        npm start
 *        jb-plugins (if installed globally)
 */

import axios from 'axios';
import inquirer from 'inquirer';
import autocomplete from 'inquirer-autocomplete-prompt';
import clipboard from 'clipboardy';
import ora from 'ora';
import { search, confirm, checkbox, select } from '@inquirer/prompts';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as readline from 'readline';
import Table from 'cli-table3';

// Register the autocomplete prompt type
inquirer.registerPrompt('autocomplete', autocomplete);

// Configuration
const API_BASE_URL = 'https://plugins.jetbrains.com/api/search/plugins';
const API_BROWSE_URL = 'https://plugins.jetbrains.com/api/searchPlugins';
const SEARCH_DEBOUNCE_MS = 300;
const MAX_RESULTS = 20;

// Selected plugins basket
let selectedPlugins = [];

// Cached IDE path
let cachedIdePath = null;

// Config file path
const CONFIG_FILE = path.join(os.homedir(), '.jb-plugins-config.json');

/**
 * Load selected plugins from config file
 */
function loadSelectedPlugins() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const config = JSON.parse(data);
      if (Array.isArray(config.selectedPlugins)) {
        selectedPlugins = config.selectedPlugins;
        return true;
      }
    }
  } catch (error) {
    // Ignore errors, start with empty selection
  }
  return false;
}

/**
 * Save selected plugins to config file
 */
function saveSelectedPlugins() {
  try {
    const config = {
      selectedPlugins,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('\n[!] Could not save selection:', error.message);
    return false;
  }
}

/**
 * Check if running in WSL (Windows Subsystem for Linux)
 * @returns {boolean}
 */
function isWSL() {
  try {
    const release = os.release().toLowerCase();
    return release.includes('microsoft') || release.includes('wsl');
  } catch {
    return false;
  }
}

/**
 * Get the Windows username when running in WSL
 * @returns {string|null}
 */
function getWindowsUsername() {
  try {
    const userDir = fs.readdirSync('/mnt/c/Users').filter(name =>
      !['Public', 'Default', 'Default User', 'All Users'].includes(name) &&
      fs.statSync(`/mnt/c/Users/${name}`).isDirectory()
    );
    return userDir[0] || null;
  } catch {
    return null;
  }
}

/**
 * Find IntelliJ IDEA installation paths
 * @returns {Array<{path: string, name: string}>} Array of found IDE paths
 */
function findIdeaPaths() {
  const foundPaths = [];
  const platform = os.platform();
  const homeDir = os.homedir();

  // IDE product names to search for
  const ideProducts = [
    { pattern: 'IntelliJ IDEA Ultimate', name: 'IntelliJ IDEA Ultimate' },
    { pattern: 'IntelliJ IDEA Community', name: 'IntelliJ IDEA Community' },
    { pattern: 'IntelliJ IDEA', name: 'IntelliJ IDEA' },
    { pattern: 'IDEA-U', name: 'IntelliJ IDEA Ultimate (Toolbox)' },
    { pattern: 'IDEA-C', name: 'IntelliJ IDEA Community (Toolbox)' },
  ];

  if (platform === 'win32') {
    // Windows paths
    const windowsSearchPaths = [
      `${process.env.LOCALAPPDATA}/Programs`,
      `${process.env.PROGRAMFILES}/JetBrains`,
      `${process.env['PROGRAMFILES(X86)']}/JetBrains`,
      `${homeDir}/AppData/Local/JetBrains/Toolbox/apps`,
    ];

    for (const searchPath of windowsSearchPaths) {
      if (!searchPath || !fs.existsSync(searchPath)) continue;
      searchWindowsPath(searchPath, foundPaths, ideProducts);
    }
  } else if (platform === 'darwin') {
    // macOS paths
    const macSearchPaths = [
      '/Applications',
      `${homeDir}/Applications`,
      `${homeDir}/Library/Application Support/JetBrains/Toolbox/apps`,
    ];

    for (const searchPath of macSearchPaths) {
      if (!fs.existsSync(searchPath)) continue;
      searchMacPath(searchPath, foundPaths, ideProducts);
    }
  } else {
    // Linux paths (including WSL)
    const linuxSearchPaths = [
      '/opt',
      '/usr/local',
      `${homeDir}/.local/share/JetBrains/Toolbox/apps`,
      '/snap',
    ];

    for (const searchPath of linuxSearchPaths) {
      if (fs.existsSync(searchPath)) {
        searchLinuxPath(searchPath, foundPaths, ideProducts);
      }
    }

    // If WSL, also search Windows paths
    if (isWSL()) {
      const winUser = getWindowsUsername();
      if (winUser) {
        const wslWindowsPaths = [
          `/mnt/c/Users/${winUser}/AppData/Local/Programs`,
          `/mnt/c/Program Files/JetBrains`,
          `/mnt/c/Program Files (x86)/JetBrains`,
          `/mnt/c/Users/${winUser}/AppData/Local/JetBrains/Toolbox/apps`,
        ];

        for (const searchPath of wslWindowsPaths) {
          if (fs.existsSync(searchPath)) {
            searchWindowsPathWSL(searchPath, foundPaths, ideProducts);
          }
        }
      }
    }
  }

  return foundPaths;
}

/**
 * Search Windows paths for IDE installations
 */
function searchWindowsPath(basePath, foundPaths, ideProducts) {
  try {
    const entries = fs.readdirSync(basePath);
    for (const entry of entries) {
      for (const product of ideProducts) {
        if (entry.includes(product.pattern)) {
          const exePath = path.join(basePath, entry, 'bin', 'idea64.exe');
          if (fs.existsSync(exePath)) {
            foundPaths.push({ path: exePath, name: `${product.name} - ${entry}` });
          }
        }
      }
      // Check Toolbox structure
      if (entry === 'IDEA-U' || entry === 'IDEA-C') {
        const toolboxPath = path.join(basePath, entry);
        searchToolboxPath(toolboxPath, foundPaths, entry === 'IDEA-U' ? 'Ultimate' : 'Community', 'idea64.exe');
      }
    }
  } catch { /* ignore errors */ }
}

/**
 * Search Windows paths from WSL
 */
function searchWindowsPathWSL(basePath, foundPaths, ideProducts) {
  try {
    const entries = fs.readdirSync(basePath);
    for (const entry of entries) {
      for (const product of ideProducts) {
        if (entry.includes(product.pattern)) {
          const exePath = path.join(basePath, entry, 'bin', 'idea64.exe');
          if (fs.existsSync(exePath)) {
            foundPaths.push({ path: `"${exePath}"`, name: `${product.name} - ${entry} (Windows)` });
          }
        }
      }
      // Check Toolbox structure
      if (entry === 'IDEA-U' || entry === 'IDEA-C') {
        const toolboxPath = path.join(basePath, entry);
        searchToolboxPathWSL(toolboxPath, foundPaths, entry === 'IDEA-U' ? 'Ultimate' : 'Community');
      }
    }
  } catch { /* ignore errors */ }
}

/**
 * Search Toolbox installation path
 */
function searchToolboxPath(basePath, foundPaths, edition, executable) {
  try {
    const channels = fs.readdirSync(basePath);
    for (const channel of channels) {
      const channelPath = path.join(basePath, channel);
      if (!fs.statSync(channelPath).isDirectory()) continue;

      const versions = fs.readdirSync(channelPath)
        .filter(v => fs.statSync(path.join(channelPath, v)).isDirectory())
        .sort()
        .reverse();

      for (const version of versions) {
        const exePath = path.join(channelPath, version, 'bin', executable);
        if (fs.existsSync(exePath)) {
          foundPaths.push({
            path: exePath,
            name: `IntelliJ IDEA ${edition} ${version} (Toolbox)`,
          });
          break; // Only take the latest version per channel
        }
      }
    }
  } catch { /* ignore errors */ }
}

/**
 * Search Toolbox installation path from WSL
 */
function searchToolboxPathWSL(basePath, foundPaths, edition) {
  try {
    const channels = fs.readdirSync(basePath);
    for (const channel of channels) {
      const channelPath = path.join(basePath, channel);
      if (!fs.statSync(channelPath).isDirectory()) continue;

      const versions = fs.readdirSync(channelPath)
        .filter(v => fs.statSync(path.join(channelPath, v)).isDirectory())
        .sort()
        .reverse();

      for (const version of versions) {
        const exePath = path.join(channelPath, version, 'bin', 'idea64.exe');
        if (fs.existsSync(exePath)) {
          foundPaths.push({
            path: `"${exePath}"`,
            name: `IntelliJ IDEA ${edition} ${version} (Toolbox/Windows)`,
          });
          break;
        }
      }
    }
  } catch { /* ignore errors */ }
}

/**
 * Search macOS paths for IDE installations
 */
function searchMacPath(basePath, foundPaths, ideProducts) {
  try {
    const entries = fs.readdirSync(basePath);
    for (const entry of entries) {
      if (entry.includes('IntelliJ IDEA') && entry.endsWith('.app')) {
        const exePath = path.join(basePath, entry, 'Contents', 'MacOS', 'idea');
        if (fs.existsSync(exePath)) {
          foundPaths.push({ path: exePath, name: entry.replace('.app', '') });
        }
      }
      // Check Toolbox structure
      if (entry === 'IDEA-U' || entry === 'IDEA-C') {
        const toolboxPath = path.join(basePath, entry);
        searchToolboxPathMac(toolboxPath, foundPaths, entry === 'IDEA-U' ? 'Ultimate' : 'Community');
      }
    }
  } catch { /* ignore errors */ }
}

/**
 * Search Toolbox installation path on macOS
 */
function searchToolboxPathMac(basePath, foundPaths, edition) {
  try {
    const channels = fs.readdirSync(basePath);
    for (const channel of channels) {
      const channelPath = path.join(basePath, channel);
      if (!fs.statSync(channelPath).isDirectory()) continue;

      const versions = fs.readdirSync(channelPath)
        .filter(v => fs.statSync(path.join(channelPath, v)).isDirectory())
        .sort()
        .reverse();

      for (const version of versions) {
        // Find .app bundle in version folder
        const versionPath = path.join(channelPath, version);
        const apps = fs.readdirSync(versionPath).filter(f => f.endsWith('.app'));
        for (const app of apps) {
          const exePath = path.join(versionPath, app, 'Contents', 'MacOS', 'idea');
          if (fs.existsSync(exePath)) {
            foundPaths.push({
              path: exePath,
              name: `IntelliJ IDEA ${edition} ${version} (Toolbox)`,
            });
            break;
          }
        }
        break; // Only take the latest version
      }
    }
  } catch { /* ignore errors */ }
}

/**
 * Search Linux paths for IDE installations
 */
function searchLinuxPath(basePath, foundPaths, ideProducts) {
  try {
    const entries = fs.readdirSync(basePath);
    for (const entry of entries) {
      const entryLower = entry.toLowerCase();
      if (entryLower.includes('intellij') || entryLower.includes('idea')) {
        const exePath = path.join(basePath, entry, 'bin', 'idea.sh');
        if (fs.existsSync(exePath)) {
          foundPaths.push({ path: exePath, name: `IntelliJ IDEA - ${entry}` });
        }
        // Snap structure
        const snapExe = path.join(basePath, entry, 'current', 'bin', 'idea.sh');
        if (fs.existsSync(snapExe)) {
          foundPaths.push({ path: snapExe, name: `IntelliJ IDEA - ${entry} (Snap)` });
        }
      }
      // Check Toolbox structure
      if (entry === 'IDEA-U' || entry === 'IDEA-C') {
        const toolboxPath = path.join(basePath, entry);
        searchToolboxPath(toolboxPath, foundPaths, entry === 'IDEA-U' ? 'Ultimate' : 'Community', 'idea.sh');
      }
    }
  } catch { /* ignore errors */ }
}

/**
 * Detect or select IDE path
 * @returns {Promise<string|null>} The IDE executable path or null if cancelled
 */
async function getIdePath() {
  if (cachedIdePath) {
    return cachedIdePath;
  }

  const spinner = ora('Detecting IntelliJ IDEA installations...').start();
  const foundPaths = findIdeaPaths();
  spinner.stop();

  if (foundPaths.length === 0) {
    console.log('\n[!] No IntelliJ IDEA installation found automatically.');
    console.log('   Using default command: idea\n');
    cachedIdePath = 'idea';
    return cachedIdePath;
  }

  if (foundPaths.length === 1) {
    console.log(`\n[OK] Found: ${foundPaths[0].name}`);
    cachedIdePath = foundPaths[0].path;
    return cachedIdePath;
  }

  // Multiple installations found - let user choose
  console.log(`\nFound ${foundPaths.length} IntelliJ IDEA installations:\n`);

  try {
    const selected = await select({
      message: 'Select which IDE to use (Esc to cancel):',
      choices: [
        ...foundPaths.map(p => ({
          name: p.name,
          value: p.path,
          description: p.path,
        })),
        {
          name: 'Use default (idea)',
          value: 'idea',
          description: 'Use the idea command from PATH',
        },
      ],
    });

    cachedIdePath = selected;
    return cachedIdePath;
  } catch {
    // User pressed Escape or Ctrl+C
    return null;
  }
}

/**
 * Search for plugins using the JetBrains Marketplace API
 * @param {string} query - Search query string
 * @returns {Promise<Array>} Array of plugin objects
 */
async function searchPlugins(query) {
  if (!query || query.trim().length < 2) {
    return [];
  }

  try {
    const response = await axios.get(API_BASE_URL, {
      params: {
        query: query.trim(),
        max: MAX_RESULTS,
      },
      timeout: 10000,
    });

    // The API returns an array of plugin objects
    const plugins = response.data.plugins || response.data || [];

    return plugins.map(plugin => ({
      name: formatPluginDisplay(plugin),
      value: {
        xmlId: plugin.xmlId || plugin.id,
        name: plugin.name,
        organization: plugin.organization || plugin.vendor?.name || 'Unknown',
      },
      short: plugin.name,
    }));
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error('\n[!] Request timed out. Please try again.');
    } else if (error.response?.status === 429) {
      console.error('\n[!] Rate limited by JetBrains API. Please wait a moment and try again.');
    } else if (error.response?.status >= 500) {
      console.error('\n[!] JetBrains API is currently unavailable. Please try again later.');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('\n[!] Unable to reach JetBrains API. Please check your internet connection.');
    }
    return [];
  }
}

/**
 * Format plugin information for display in the autocomplete list
 * @param {Object} plugin - Plugin object from API
 * @returns {string} Formatted display string
 */
function formatPluginDisplay(plugin) {
  const name = plugin.name || 'Unknown Plugin';
  const org = plugin.organization || plugin.vendor?.name || '';
  const downloads = plugin.downloads ? ` [${formatNumber(plugin.downloads)} downloads]` : '';

  if (org) {
    return `${name} — by ${org}${downloads}`;
  }
  return `${name}${downloads}`;
}

/**
 * Format large numbers with K/M suffixes
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

/**
 * Fetch plugins from browse API
 * @param {string} query - Search query
 * @param {number} max - Max results
 * @returns {Promise<Array>} Array of plugins
 */
async function fetchBrowsePlugins(query = '', max = 20) {
  try {
    const response = await axios.get(API_BROWSE_URL, {
      params: { search: query || 'a', max },
      timeout: 15000,
    });
    return response.data.plugins || [];
  } catch (error) {
    return [];
  }
}

/**
 * Fetch latest version info for a plugin
 * @param {number} pluginId - Plugin ID
 * @returns {Promise<Object|null>} Version info or null
 */
async function fetchPluginVersion(pluginId) {
  try {
    const response = await axios.get(`https://plugins.jetbrains.com/api/plugins/${pluginId}/updates?size=1`, {
      timeout: 5000,
    });
    if (response.data && response.data.length > 0) {
      const update = response.data[0];
      return {
        version: update.version,
        ideaVersion: update.compatibleVersions?.IDEA || update.sinceUntil || 'N/A',
      };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Fetch popular plugins across multiple categories
 * @returns {Promise<Array>} Array of unique plugins sorted by downloads
 */
async function fetchAllPopularPlugins() {
  // Expanded categories to cover more plugins
  const categories = [
    // Languages & Frameworks
    'java', 'kotlin', 'python', 'javascript', 'typescript', 'rust', 'go', 'ruby', 'php', 'scala', 'swift',
    // Tools & Integrations
    'git', 'docker', 'kubernetes', 'database', 'sql', 'maven', 'gradle', 'npm',
    // Code Quality & Analysis
    'lint', 'sonar', 'qodana', 'code quality', 'inspection',
    // AI & Productivity
    'ai', 'copilot', 'assistant', 'productivity',
    // UI & Themes
    'theme', 'material', 'icon',
    // Editors & Navigation
    'vim', 'editor', 'navigation',
    // Documentation & Formats
    'markdown', 'json', 'yaml', 'xml',
    // Testing & Debug
    'test', 'debug', 'coverage',
    // Cloud & DevOps
    'aws', 'azure', 'cloud', 'terraform',
    // Misc popular terms
    'plugin', 'tool', 'support', 'framework',
  ];
  const allPlugins = new Map();

  const spinner = ora({
    text: 'Fetching plugins from JetBrains Marketplace...',
    spinner: 'dots',
  }).start();

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    spinner.text = `Fetching plugins... (${i + 1}/${categories.length}) - ${category}`;
    const plugins = await fetchBrowsePlugins(category, 20);
    for (const plugin of plugins) {
      if (!allPlugins.has(plugin.xmlId)) {
        allPlugins.set(plugin.xmlId, plugin);
      }
    }
  }

  const result = Array.from(allPlugins.values()).sort((a, b) => (b.downloads || 0) - (a.downloads || 0));

  // Fetch version info for top plugins (limit to avoid too many requests)
  spinner.text = 'Fetching plugin version info...';
  const topPlugins = result.slice(0, 100);
  const versionPromises = topPlugins.map(p => fetchPluginVersion(p.id));
  const versions = await Promise.all(versionPromises);

  for (let i = 0; i < topPlugins.length; i++) {
    if (versions[i]) {
      topPlugins[i].latestVersion = versions[i].version;
      topPlugins[i].ideaVersion = versions[i].ideaVersion;
    }
  }

  spinner.succeed(`Loaded ${result.length} plugins from JetBrains Marketplace`);

  return result;
}

/**
 * Search for plugins from the API (for dynamic search)
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of plugins
 */
async function searchPluginsFromAPI(query) {
  if (!query || query.length < 2) return [];

  try {
    const response = await axios.get(API_BROWSE_URL, {
      params: { search: query, max: 20 },
      timeout: 10000,
    });
    return response.data.plugins || [];
  } catch {
    return [];
  }
}

/**
 * Filter plugins by search term
 * @param {Array} plugins - Array of plugins
 * @param {string} searchTerm - Search term
 * @returns {Array} Filtered plugins
 */
function filterPlugins(plugins, searchTerm) {
  if (!searchTerm) return plugins;
  const term = searchTerm.toLowerCase();
  return plugins.filter(p =>
    p.name.toLowerCase().includes(term) ||
    (p.vendor?.name || '').toLowerCase().includes(term) ||
    (p.xmlId || '').toLowerCase().includes(term)
  );
}

/**
 * Truncate string to max length with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLen - Maximum length
 * @returns {string} Truncated string
 */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Interactive multi-select with filtering and dynamic API search
 * @param {Array} allPlugins - All available plugins (pre-fetched)
 * @returns {Promise<Array|null>} Selected plugins or null if cancelled
 */
async function interactiveSelect(allPlugins) {
  const selectedIds = new Set();
  // Pre-select already selected plugins
  selectedPlugins.forEach(p => selectedIds.add(p.xmlId));

  // Cache for all plugins including dynamically fetched ones
  const pluginCache = new Map();
  allPlugins.forEach(p => pluginCache.set(p.xmlId, p));

  let searchTerm = '';
  let cursorIndex = 0;
  let currentFiltered = allPlugins;
  let isSearching = false;
  let searchTimeout = null;
  const pageSize = 8;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // Function to perform API search and merge results
  const performAPISearch = async (term) => {
    if (term.length < 2) {
      currentFiltered = filterPlugins(allPlugins, term);
      return;
    }

    isSearching = true;
    render();

    // Search API for plugins not in cache
    const apiResults = await searchPluginsFromAPI(term);

    // Merge API results with cache
    for (const plugin of apiResults) {
      if (!pluginCache.has(plugin.xmlId)) {
        pluginCache.set(plugin.xmlId, plugin);
      }
    }

    // Filter from the merged cache
    const allCachedPlugins = Array.from(pluginCache.values());
    currentFiltered = filterPlugins(allCachedPlugins, term);

    // Sort by relevance (exact matches first, then by downloads)
    currentFiltered.sort((a, b) => {
      const termLower = term.toLowerCase();
      const aNameMatch = a.name.toLowerCase().includes(termLower) ? 1 : 0;
      const bNameMatch = b.name.toLowerCase().includes(termLower) ? 1 : 0;
      const aIdMatch = a.xmlId.toLowerCase().includes(termLower) ? 1 : 0;
      const bIdMatch = b.xmlId.toLowerCase().includes(termLower) ? 1 : 0;

      const aScore = aNameMatch * 2 + aIdMatch;
      const bScore = bNameMatch * 2 + bIdMatch;

      if (aScore !== bScore) return bScore - aScore;
      return (b.downloads || 0) - (a.downloads || 0);
    });

    isSearching = false;
    cursorIndex = 0;
    render();
  };

  const render = () => {
    console.clear();
    console.log('\x1b[1m══════════════════════════════════════════════════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[1m  Browse All Plugins\x1b[0m');
    console.log('\x1b[1m══════════════════════════════════════════════════════════════════════════════════════════════════════\x1b[0m');

    const searchStatus = isSearching ? ' \x1b[33m(searching...)\x1b[0m' : '';
    console.log(`\n  \x1b[32mSelected: ${selectedIds.size} plugin(s)\x1b[0m    Filter: \x1b[33m${searchTerm || '(type to search any plugin)'}\x1b[0m${searchStatus}`);
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('  │  \x1b[36mSpace\x1b[0m = toggle selection  │  \x1b[36mEnter\x1b[0m = confirm  │  \x1b[36mEsc\x1b[0m = cancel  │  \x1b[36m↑/↓\x1b[0m = navigate  │  \x1b[36mType\x1b[0m = search │');
    console.log('  └─────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');

    const filtered = currentFiltered;
    const startIndex = Math.max(0, cursorIndex - Math.floor(pageSize / 2));
    const endIndex = Math.min(filtered.length, startIndex + pageSize);

    if (filtered.length === 0 && !isSearching) {
      if (searchTerm.length >= 2) {
        console.log('  No plugins found. Try a different search term.\n');
      } else {
        console.log('  Type at least 2 characters to search...\n');
      }
    } else if (filtered.length > 0) {
      // Create table
      const table = new Table({
        head: ['', '', 'Plugin Name', 'Plugin ID', 'Downloads', 'Author', 'IDEA Version'],
        colWidths: [3, 3, 28, 30, 12, 20, 14],
        style: {
          head: ['cyan'],
          border: ['gray'],
        },
        chars: {
          'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
          'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
          'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
          'right': '│', 'right-mid': '┤', 'middle': '│'
        },
      });

      for (let i = startIndex; i < endIndex; i++) {
        const p = filtered[i];
        const isSelected = selectedIds.has(p.xmlId);
        const checkbox = isSelected ? '\x1b[32m◉\x1b[0m' : '○';
        const cursor = i === cursorIndex ? '\x1b[33m❯\x1b[0m' : ' ';
        const downloads = formatNumber(p.downloads || 0);
        const vendor = truncate(p.vendor?.name || 'Unknown', 18);
        const ideaVer = p.ideaVersion || 'N/A';

        // Highlight current row
        const name = i === cursorIndex
          ? `\x1b[36m${truncate(p.name, 26)}\x1b[0m`
          : truncate(p.name, 26);

        table.push([
          cursor,
          checkbox,
          name,
          truncate(p.xmlId, 28),
          downloads,
          vendor,
          truncate(ideaVer, 12),
        ]);
      }

      console.log(table.toString());

      // Show URL of currently selected item
      if (filtered[cursorIndex]) {
        const p = filtered[cursorIndex];
        const url = `https://plugins.jetbrains.com${p.link || `/plugin/${p.id}`}`;
        console.log(`\n  \x1b[90mURL: ${url}\x1b[0m`);
      }
    }

    console.log(`\n  Showing ${filtered.length > 0 ? startIndex + 1 : 0}-${endIndex} of ${filtered.length} plugins (${pluginCache.size} in cache)`);
  };

  return new Promise((resolve) => {
    render();

    const onKeypress = async (str, key) => {
      if (!key) return;

      if (key.name === 'return') {
        cleanup();
        // Get all selected plugins from cache
        const selected = Array.from(pluginCache.values()).filter(p => selectedIds.has(p.xmlId));
        resolve(selected);
        return;
      }

      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === 'space') {
        if (currentFiltered.length > 0 && cursorIndex < currentFiltered.length) {
          const p = currentFiltered[cursorIndex];
          if (selectedIds.has(p.xmlId)) {
            selectedIds.delete(p.xmlId);
          } else {
            selectedIds.add(p.xmlId);
          }
        }
        render();
      } else if (key.name === 'down') {
        cursorIndex = Math.min(cursorIndex + 1, currentFiltered.length - 1);
        render();
      } else if (key.name === 'up') {
        cursorIndex = Math.max(cursorIndex - 1, 0);
        render();
      } else if (key.name === 'backspace') {
        searchTerm = searchTerm.slice(0, -1);
        cursorIndex = 0;
        // Debounce API search
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => performAPISearch(searchTerm), 300);
        currentFiltered = filterPlugins(Array.from(pluginCache.values()), searchTerm);
        render();
      } else if (str && str.length === 1 && !key.ctrl && !key.meta && key.name !== 'space' && key.name !== 'return') {
        searchTerm += str;
        cursorIndex = 0;
        // Debounce API search
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => performAPISearch(searchTerm), 300);
        // Immediately filter from cache while waiting for API
        currentFiltered = filterPlugins(Array.from(pluginCache.values()), searchTerm);
        render();
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    process.stdin.on('keypress', onKeypress);
  });
}

/**
 * Browse and select from all plugins
 */
async function browseAllPlugins() {
  const allPlugins = await fetchAllPopularPlugins();

  if (allPlugins.length === 0) {
    console.log('\n[!] Could not fetch plugins. Please check your internet connection.\n');
    return;
  }

  const selected = await interactiveSelect(allPlugins);

  console.clear();

  if (selected === null) {
    console.log('\nCancelled. No changes made.\n');
    return;
  }

  // Update the global selectedPlugins with the new selection
  selectedPlugins = selected.map(p => ({
    xmlId: p.xmlId,
    name: p.name,
    organization: p.vendor?.name || 'Unknown',
  }));

  console.log(`\n[OK] Selection updated: ${selectedPlugins.length} plugin(s) selected.\n`);
  saveSelectedPlugins();
}

/**
 * Create a debounced search function
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, delay) {
  let timeoutId;
  let lastQuery = '';
  let cachedResults = [];

  return async (answers, input) => {
    input = input || '';

    // Return cached results if query hasn't changed
    if (input === lastQuery && cachedResults.length > 0) {
      return cachedResults;
    }

    // Clear previous timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Return a promise that resolves after the debounce delay
    return new Promise((resolve) => {
      timeoutId = setTimeout(async () => {
        lastQuery = input;

        if (input.length < 2) {
          cachedResults = [{
            name: 'Type at least 2 characters to search...',
            value: null,
            disabled: true,
          }];
          resolve(cachedResults);
          return;
        }

        // Show loading indicator
        const results = await searchPlugins(input);

        if (results.length === 0) {
          cachedResults = [{
            name: 'No plugins found. Try a different search term.',
            value: null,
            disabled: true,
          }];
        } else {
          cachedResults = results;
        }

        resolve(cachedResults);
      }, delay);
    });
  };
}

/**
 * Display the current plugin basket
 */
function displayBasket() {
  console.log('\n' + '-'.repeat(60));
  if (selectedPlugins.length === 0) {
    console.log('Your basket is empty');
  } else {
    console.log(`Selected Plugins (${selectedPlugins.length}):`);
    selectedPlugins.forEach((plugin, index) => {
      console.log(`   ${index + 1}. ${plugin.name} (${plugin.xmlId})`);
    });
  }
  console.log('-'.repeat(60) + '\n');
}

/**
 * Generate the installation command
 * @returns {string} The idea installPlugins command
 */
function generateCommand(idePath) {
  const pluginIds = selectedPlugins.map(p => {
    // Quote plugin IDs that contain spaces
    if (p.xmlId.includes(' ')) {
      return `"${p.xmlId}"`;
    }
    return p.xmlId;
  }).join(' ');
  // Quote the IDE path if it contains spaces
  const quotedIdePath = idePath.includes(' ') ? `"${idePath}"` : idePath;
  return `${quotedIdePath} installPlugins ${pluginIds}`;
}

/**
 * Parse an install command and extract plugin IDs
 * @param {string} command - The install command to parse
 * @returns {Array<string>} Array of plugin IDs
 */
function parseInstallCommand(command) {
  // Find "installPlugins" and extract everything after it
  const match = command.match(/installPlugins\s+(.+)/i);
  if (!match) return [];

  const pluginsPart = match[1].trim();
  const pluginIds = [];

  // Parse plugin IDs (handle quoted IDs with spaces)
  let current = '';
  let inQuote = false;
  for (const char of pluginsPart) {
    if (char === '"') {
      inQuote = !inQuote;
    } else if (char === ' ' && !inQuote) {
      if (current) pluginIds.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) pluginIds.push(current);

  return pluginIds;
}

/**
 * Prompt for text input with Escape support
 * @param {string} message - Prompt message
 * @returns {Promise<string|null>} Input value or null if cancelled
 */
async function promptInput(message) {
  return new Promise((resolve) => {
    let input = '';

    process.stdout.write(`${message} `);

    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (key) => {
      // Escape key
      if (key === '\x1b') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(null);
        return;
      }

      // Ctrl+C
      if (key === '\x03') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(null);
        return;
      }

      // Enter key
      if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }

      // Regular character
      if (key >= ' ' && key <= '~') {
        input += key;
        process.stdout.write(key);
      }
    };

    process.stdin.on('data', onData);
  });
}

/**
 * Prompt for confirmation with Escape support
 * @param {string} message - Prompt message
 * @param {boolean} defaultValue - Default value
 * @returns {Promise<boolean|null>} true/false or null if cancelled
 */
async function promptConfirm(message, defaultValue = false) {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';

  return new Promise((resolve) => {
    process.stdout.write(`${message} ${hint} `);

    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('', (answer) => {
        rl.close();
        const a = answer.toLowerCase().trim();
        if (a === 'y' || a === 'yes') resolve(true);
        else if (a === 'n' || a === 'no') resolve(false);
        else resolve(defaultValue);
      });
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (chunk) => {
      const key = chunk.toString();

      // Escape key
      if (key === '\x1b') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(null);
        return;
      }

      // Ctrl+C
      if (key === '\x03') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(null);
        return;
      }

      // Y/y
      if (key === 'y' || key === 'Y') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('yes\n');
        resolve(true);
        return;
      }

      // N/n
      if (key === 'n' || key === 'N') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('no\n');
        resolve(false);
        return;
      }

      // Enter key - use default
      if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write(defaultValue ? 'yes\n' : 'no\n');
        resolve(defaultValue);
        return;
      }
    };

    process.stdin.on('data', onData);
  });
}

/**
 * Import plugins from an install command
 */
async function importFromCommand() {
  const command = await promptInput('Paste the install command (Esc to cancel):');

  if (command === null) {
    return; // User pressed Escape
  }

  if (!command || !command.trim()) {
    console.log('\n[!] No command provided.\n');
    return;
  }

  const pluginIds = parseInstallCommand(command);

  if (pluginIds.length === 0) {
    console.log('\n[!] No plugin IDs found in the command. Make sure it contains "installPlugins" followed by plugin IDs.\n');
    return;
  }

  const spinner = ora('Looking up plugin information...').start();

  let addedCount = 0;
  let skippedCount = 0;
  const addedPlugins = [];

  for (const xmlId of pluginIds) {
    // Check if already in selectedPlugins
    if (selectedPlugins.some(p => p.xmlId === xmlId)) {
      skippedCount++;
      continue;
    }

    // Try to look up plugin info via API
    let pluginInfo = { xmlId, name: xmlId, organization: 'Unknown' };

    try {
      const results = await searchPluginsFromAPI(xmlId);
      const exactMatch = results.find(p => p.xmlId === xmlId);
      if (exactMatch) {
        pluginInfo = {
          xmlId: exactMatch.xmlId,
          name: exactMatch.name,
          organization: exactMatch.vendor?.name || 'Unknown',
        };
      }
    } catch {
      // Use fallback info
    }

    selectedPlugins.push(pluginInfo);
    addedPlugins.push(pluginInfo);
    addedCount++;
  }

  spinner.stop();

  if (addedCount > 0) {
    saveSelectedPlugins();
    console.log(`\n[OK] Added ${addedCount} plugin(s):`);
    addedPlugins.forEach(p => console.log(`   - ${p.name} (${p.xmlId})`));
  }

  if (skippedCount > 0) {
    console.log(`\n[!] Skipped ${skippedCount} plugin(s) already in selection.`);
  }

  if (addedCount === 0 && skippedCount === 0) {
    console.log('\n[!] No plugins were added.\n');
  } else {
    console.log('');
  }
}

/**
 * Main menu options
 */
async function showMainMenu() {
  const choices = [
    { name: 'Browse all plugins (multi-select with filter)', value: 'browse', key: '1' },
    { name: 'Import from install command', value: 'import', key: '2' },
    { name: 'View selected plugins', value: 'view', key: '3' },
  ];

  if (selectedPlugins.length > 0) {
    choices.push(
      { name: 'Remove a plugin from selection', value: 'remove', key: '4' },
      { name: 'Clear all selections', value: 'clear', key: '5' },
      { name: 'Generate install command', value: 'generate', key: '6' },
    );
  }

  choices.push({ name: 'Exit', value: 'exit', key: '0' });

  // Create a map for quick lookup by key
  const keyMap = new Map(choices.map(c => [c.key, c.value]));

  let selectedIndex = 0;

  const render = () => {
    // Move cursor up to redraw menu (clear previous render)
    process.stdout.write('\x1b[2K'); // Clear current line
    for (let i = 0; i < choices.length + 3; i++) {
      process.stdout.write('\x1b[1A\x1b[2K'); // Move up and clear line
    }

    console.log('What would you like to do? (use arrow keys or number)\n');
    choices.forEach((choice, index) => {
      const cursor = index === selectedIndex ? '>' : ' ';
      const highlight = index === selectedIndex ? '\x1b[36m' : '';
      const reset = index === selectedIndex ? '\x1b[0m' : '';
      console.log(`${cursor} ${highlight}[${choice.key}] ${choice.name}${reset}`);
    });
    console.log('');
  };

  const initialRender = () => {
    console.log('What would you like to do? (use arrow keys or number)\n');
    choices.forEach((choice, index) => {
      const cursor = index === selectedIndex ? '>' : ' ';
      const highlight = index === selectedIndex ? '\x1b[36m' : '';
      const reset = index === selectedIndex ? '\x1b[0m' : '';
      console.log(`${cursor} ${highlight}[${choice.key}] ${choice.name}${reset}`);
    });
    console.log('');
  };

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Handle keypress for navigation and selection
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();

      initialRender();

      const onKeypress = (chunk) => {
        const key = chunk.toString();

        // Check if it's a valid menu key (number)
        if (keyMap.has(key)) {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onKeypress);
          rl.close();
          resolve(keyMap.get(key));
          return;
        }

        // Handle arrow keys (escape sequences)
        if (key === '\x1b[A' || key === '\x1b[D') { // Up or Left
          selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
          render();
          return;
        }

        if (key === '\x1b[B' || key === '\x1b[C') { // Down or Right
          selectedIndex = (selectedIndex + 1) % choices.length;
          render();
          return;
        }

        // Handle Enter
        if (key === '\r' || key === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onKeypress);
          rl.close();
          resolve(choices[selectedIndex].value);
          return;
        }

        // Handle Ctrl+C
        if (key === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onKeypress);
          rl.close();
          resolve('exit');
          return;
        }
      };

      process.stdin.on('data', onKeypress);
    } else {
      // Fallback for non-TTY (prompt for input)
      initialRender();
      rl.question('Enter option number: ', (answer) => {
        rl.close();
        if (keyMap.has(answer.trim())) {
          resolve(keyMap.get(answer.trim()));
        } else {
          resolve('view'); // Default action
        }
      });
    }
  });
}

/**
 * Search and add plugins workflow
 */
async function searchAndAddPlugins() {
  const debouncedSearch = debounce(searchPlugins, SEARCH_DEBOUNCE_MS);

  let continueSearching = true;

  while (continueSearching) {
    try {
      const { plugin } = await inquirer.prompt([
        {
          type: 'autocomplete',
          name: 'plugin',
          message: 'Search for a plugin (type to search, Esc to go back):',
          source: debouncedSearch,
          emptyText: 'No results found',
          pageSize: 15,
          suggestOnly: false,
        },
      ]);

      if (plugin && plugin.xmlId) {
        // Check if already selected
        const alreadySelected = selectedPlugins.some(p => p.xmlId === plugin.xmlId);

        if (alreadySelected) {
          console.log(`\n[!] "${plugin.name}" is already in your selection.\n`);
        } else {
          selectedPlugins.push(plugin);
          console.log(`\n[OK] Added "${plugin.name}" to your selection.\n`);
        }

        // Ask if user wants to add more
        const addMore = await promptConfirm('Add another plugin?', true);
        continueSearching = addMore === true;
      }
    } catch (error) {
      // User pressed Ctrl+C or escaped
      continueSearching = false;
    }
  }
}

/**
 * Remove plugins from selection (multi-select)
 */
async function removePlugin() {
  if (selectedPlugins.length === 0) {
    console.log('\nNo plugins to remove.\n');
    return;
  }

  console.log('\n');

  try {
    const pluginsToRemove = await checkbox({
      message: 'Select plugins to remove (Space to select, Enter to confirm, Esc to cancel):',
      choices: selectedPlugins.map(p => ({
        name: `${p.name} (${p.xmlId})`,
        value: p.xmlId,
      })),
      pageSize: 15,
    });

    if (pluginsToRemove.length > 0) {
      const removeSet = new Set(pluginsToRemove);
      const removedNames = selectedPlugins
        .filter(p => removeSet.has(p.xmlId))
        .map(p => p.name);

      selectedPlugins = selectedPlugins.filter(p => !removeSet.has(p.xmlId));

      console.log(`\nRemoved ${removedNames.length} plugin(s):`);
      removedNames.forEach(name => console.log(`   - ${name}`));
      console.log('');

      saveSelectedPlugins();
    } else {
      console.log('\nNo plugins removed.\n');
    }
  } catch {
    // User pressed Escape or Ctrl+C
    console.log('');
  }
}

/**
 * Clear all selections
 */
async function clearSelections() {
  const confirmed = await promptConfirm(
    `Are you sure you want to clear all ${selectedPlugins.length} selected plugins? (Esc to cancel)`,
    false
  );

  if (confirmed === null) {
    return; // User pressed Escape
  }

  if (confirmed) {
    selectedPlugins = [];
    console.log('\nAll selections cleared.\n');
    saveSelectedPlugins();
  }
}

/**
 * Generate and display the install command
 */
async function generateInstallCommand() {
  if (selectedPlugins.length === 0) {
    console.log('\nNo plugins selected. Add some plugins first.\n');
    return;
  }

  // Detect IDE path
  const idePath = await getIdePath();
  if (idePath === null) {
    return; // User cancelled
  }

  const command = generateCommand(idePath);

  console.log('\n' + '='.repeat(80));
  console.log('INSTALLATION COMMAND');
  console.log('='.repeat(80));
  console.log('\n' + command + '\n');
  console.log('='.repeat(80) + '\n');

  // Try to copy to clipboard
  const copyToClipboard = await promptConfirm('Copy command to clipboard? (Esc to skip)', true);

  if (copyToClipboard === true) {
    try {
      await clipboard.write(command);
      console.log('\n[OK] Command copied to clipboard!\n');
    } catch (error) {
      console.log('\n[!] Could not copy to clipboard. Please copy the command manually.\n');
    }
  }

  // Show additional instructions
  console.log('To install the plugins:');
  console.log('   1. Make sure IntelliJ IDEA is closed');
  console.log('   2. Run the command above in your terminal');
  console.log('   3. Restart IntelliJ IDEA\n');
}

/**
 * Display welcome banner
 */
function displayBanner() {
  console.log('\n' + '='.repeat(60));
  console.log('  JetBrains Plugin Installer');
  console.log('  Search and install IntelliJ IDEA plugins with ease');
  console.log('='.repeat(60) + '\n');
}

/**
 * Main application entry point
 */
async function main() {
  displayBanner();

  // Load saved plugins from previous session
  if (loadSelectedPlugins() && selectedPlugins.length > 0) {
    console.log(`\x1b[32m[OK] Loaded ${selectedPlugins.length} saved plugin(s) from previous session\x1b[0m\n`);
  }

  let running = true;

  while (running) {
    displayBasket();
    const action = await showMainMenu();

    switch (action) {
      case 'browse':
        await browseAllPlugins();
        break;
      case 'import':
        await importFromCommand();
        break;
      case 'view':
        // Basket is displayed at the start of each loop
        break;
      case 'remove':
        await removePlugin();
        break;
      case 'clear':
        await clearSelections();
        break;
      case 'generate':
        await generateInstallCommand();
        break;
      case 'exit':
        running = false;
        break;
    }
  }

  console.log('\nGoodbye!\n');
}

// Run the application
main().catch((error) => {
  if (error.isTtyError) {
    console.error('[ERROR] This CLI requires an interactive terminal.');
  } else if (error.message?.includes('User force closed')) {
    console.log('\nGoodbye!\n');
  } else {
    console.error('[ERROR] An unexpected error occurred:', error.message);
  }
  process.exit(1);
});
