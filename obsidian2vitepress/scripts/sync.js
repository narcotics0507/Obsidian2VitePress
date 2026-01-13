const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const copyFile = promisify(fs.copyFile);
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);
const rm = promisify(fs.rm);

// Configuration
const VAULT_DIR = path.resolve(__dirname, '../../vault/publish');
const DOCS_DIR = path.resolve(__dirname, '../site/docs');
const ASSETS_DIR = path.resolve(__dirname, '../site/docs/public/assets');

// Map to store path mappings: sourceFullPath -> { safePath, originalName, isDir, safeName }
const pathMap = new Map();
// Map to store filename -> sourceFullPath for fuzzy linking (Obsidian style)
const fileCache = new Map();

// Generate a safe short hash for a name
function getSafeName(name) {
    // exception: index.md should remain index.md for VitePress to work as root
    if (name.toLowerCase() === 'index.md') return 'index.md';

    const hash = crypto.createHash('md5').update(name).digest('hex').substring(0, 8);
    const api = path.extname(name);
    return hash + api;
}

// Recursively clean directory
async function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
    }
}

// Phase 1: Scan and Build Map
async function scanVault(dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(dir, entry.name);

        // Calculate safe name
        let safeName = getSafeName(entry.name);

        // Determine parent's safe path
        const parentPath = path.dirname(fullPath);
        let parentSafePath = '';
        if (parentPath === VAULT_DIR) {
            parentSafePath = '';
        } else {
            const parentInfo = pathMap.get(parentPath);
            parentSafePath = parentInfo ? parentInfo.safePath : '';
        }

        const safePath = path.join(parentSafePath, safeName).replace(/\\/g, '/');

        pathMap.set(fullPath, {
            safePath: safePath,
            safeName: safeName,
            originalName: entry.name,
            isDir: entry.isDirectory()
        });

        if (entry.isDirectory()) {
            await scanVault(fullPath);
        } else if (entry.isFile()) {
            fileCache.set(entry.name.toLowerCase(), fullPath);
        }
    }
}

// Helper: Find image file
async function findImageFile(filename) {
    filename = decodeURI(filename);
    const name = path.basename(filename).toLowerCase();
    return fileCache.get(name) || null;
}

function isImage(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff'].includes(ext);
}

// Phase 2: Process Content
async function processImageEmbeds(content) {
    let newContent = content;

    // 1. Handle Obsidian ![[image.png]]
    const obsidianRegex = /!\[\[(.*?)\]\]/g;
    const obsidianMatches = [...newContent.matchAll(obsidianRegex)];

    for (const m of obsidianMatches) {
        const fullMatch = m[0];
        const filename = m[1].split('|')[0];

        let srcPath = await findImageFile(filename);

        if (!srcPath) {
            const fallbackPath = path.resolve(VAULT_DIR, '../../vault/attachments', filename);
            if (fs.existsSync(fallbackPath)) srcPath = fallbackPath;
        }

        if (srcPath) {
            const assetSafeName = getSafeName(path.basename(srcPath));

            if (!isImage(assetSafeName)) {
                newContent = newContent.replace(fullMatch, `(Attachment: ${filename})`);
                continue;
            }

            const destPath = path.join(ASSETS_DIR, assetSafeName);

            if (!fs.existsSync(ASSETS_DIR)) await mkdir(ASSETS_DIR, { recursive: true });

            await copyFile(srcPath, destPath);

            const linkUrl = `/assets/${assetSafeName}`;
            const replacement = `![${filename}](${linkUrl})`;
            newContent = newContent.replace(fullMatch, replacement);
        }
    }

    // 2. Handle Standard Markdown ![alt](path/to/image.png)
    const markdownRegex = /!\[(.*?)\]\((.*?)\)/g;
    const markdownMatches = [...newContent.matchAll(markdownRegex)];

    for (const m of markdownMatches) {
        const fullMatch = m[0];
        const alt = m[1];
        const linkPath = m[2];

        if (linkPath.startsWith('http')) continue;
        if (linkPath.startsWith('/assets/')) continue;

        const filename = path.basename(decodeURI(linkPath));
        let srcPath = await findImageFile(filename);

        if (!srcPath) {
            const fallbackPath = path.resolve(VAULT_DIR, '../../vault/attachments', filename);
            if (fs.existsSync(fallbackPath)) srcPath = fallbackPath;
        }

        if (srcPath) {
            const assetSafeName = getSafeName(path.basename(srcPath));

            if (!isImage(assetSafeName)) {
                newContent = newContent.split(fullMatch).join(`(Attachment: ${filename})`);
                continue;
            }

            const destPath = path.join(ASSETS_DIR, assetSafeName);
            if (!fs.existsSync(ASSETS_DIR)) await mkdir(ASSETS_DIR, { recursive: true });
            await copyFile(srcPath, destPath);

            const linkUrl = `/assets/${assetSafeName}`;
            const replacement = `![${alt}](${linkUrl})`;
            newContent = newContent.split(fullMatch).join(replacement);
        }
    }

    return newContent;
}

function convertWikiLinks(content) {
    const wikiLinkRegex = /\[\[(.*?)(?:\|(.*?))?\]\]/g;
    return content.replace(wikiLinkRegex, (match, link, alias) => {
        const text = alias || link;
        const linkName = link.replace(/\.md$/, '').toLowerCase();

        const targetPath = fileCache.get(linkName + '.md');
        if (targetPath) {
            const keys = pathMap.get(targetPath);
            if (keys) {
                const urlPath = '/' + keys.safePath.replace(/\.md$/, '');
                return `[${text}](${urlPath})`;
            }
        }

        // If not found as md, try as asset (fileCache check)
        // If it was captured by processImageEmbeds, it should have been handled? 
        // No, processImageEmbeds handles ![[]]. This is [[]].
        // If it is a non-md file in pathMap (e.g. Code.zip), we resolve it here.
        const targetAssetPath = fileCache.get(linkName); // linkName includes extension if it was file.zip?
        // No, replace(/\.md$/) removes .md. If file.zip, it remains file.zip.
        if (!targetPath && targetAssetPath) {
            const keys = pathMap.get(targetAssetPath);
            if (keys) {
                // It's a file in docs (e.g. hash/hash.zip)
                const urlPath = '/' + keys.safePath;
                return `[${text}](${urlPath})`;
            }
        }

        return text;
    });
}

const SAFE_TAGS = new Set([
    'a', 'abbr', 'address', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup',
    'data', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2',
    'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p',
    'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr'
]);

function sanitizeContent(content) {
    content = content.replace(/<([a-zA-Z0-9\-\_]+)([^>]*)>/g, (match, tagName, attrs) => {
        if (SAFE_TAGS.has(tagName.toLowerCase())) {
            return match;
        } else {
            return `&lt;${tagName}${attrs}&gt;`;
        }
    });

    content = content.replace(/{{/g, '&#123;&#123;').replace(/}}/g, '&#125;&#125;');

    return content;
}

async function processVault(dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(dir, entry.name);
        if (!pathMap.has(fullPath)) continue;

        const { safePath, isDir, originalName } = pathMap.get(fullPath);
        const destPath = path.join(DOCS_DIR, safePath);

        if (isDir) {
            await mkdir(destPath, { recursive: true });
            await processVault(fullPath);
        } else if (entry.isFile()) {
            if (entry.name.endsWith('.md')) {
                let content = await readFile(fullPath, 'utf8');

                const hasH1 = content.match(/^#\s+(.*)/m);
                const hasFrontmatterTitle = content.match(/^title:\s+(.*)/m);

                if (!hasH1 && !hasFrontmatterTitle) {
                    const title = originalName.replace(/\.md$/, '');
                    content = `# ${title}\n\n${content}`;
                }

                content = sanitizeContent(content);
                content = await processImageEmbeds(content);
                content = convertWikiLinks(content);

                await writeFile(destPath, content);
                console.log(`Processed: ${originalName} -> ${safePath}`);
            } else if (!isImage(entry.name)) {
                await copyFile(fullPath, destPath);
                console.log(`Copied Asset: ${originalName} -> ${safePath}`);
            }
        }
    }
}

async function generateSidebar(dir) {
    const items = [];
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (!pathMap.has(fullPath)) continue;

        const { safePath, isDir, originalName } = pathMap.get(fullPath);

        if (isDir) {
            const children = await generateSidebar(fullPath);
            if (children.length > 0) {
                items.push({
                    text: originalName,
                    collapsed: true,
                    items: children
                });
            }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            if (entry.name.toLowerCase() === 'index.md') continue;

            const link = '/' + safePath.replace(/\.md$/, '');
            items.push({
                text: originalName.replace(/\.md$/, ''),
                link: link
            });
        }
    }
    return items;
}

async function main() {
    console.log("Starting Safe Sync...");

    console.log("Cleaning old docs...");
    const docsEntries = await readdir(DOCS_DIR);
    for (const d of docsEntries) {
        if (d === '.vitepress' || d === 'public') continue;
        await rm(path.join(DOCS_DIR, d), { recursive: true, force: true });
    }

    console.log("Scanning vault...");
    if (!fs.existsSync(VAULT_DIR)) {
        console.error("Vault dir not found!");
        process.exit(1);
    }
    await scanVault(VAULT_DIR);

    console.log("Processing files...");
    await processVault(VAULT_DIR);

    console.log("Generating sidebar...");
    const sidebarConfig = {};
    const topEntries = await readdir(VAULT_DIR, { withFileTypes: true });

    for (const entry of topEntries) {
        if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
        const fullPath = path.join(VAULT_DIR, entry.name);
        if (!pathMap.has(fullPath)) continue;

        const { safePath } = pathMap.get(fullPath);
        const items = await generateSidebar(fullPath);
        if (items.length > 0) {
            const key = `/${safePath}/`;
            sidebarConfig[key] = items;
        }
    }

    const sidebarPath = path.resolve(DOCS_DIR, '.vitepress/sidebar.json');
    await writeFile(sidebarPath, JSON.stringify(sidebarConfig, null, 2));

    console.log("Sync Complete!");
}

main().catch(console.error);
