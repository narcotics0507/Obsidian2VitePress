const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const copyFile = promisify(fs.copyFile);
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);

// Configuration
// Assuming this script is run from d:\Workspace\GoLang\Blog\blog
const VAULT_DIR = path.resolve(__dirname, '../../vault/publish');
// We need to look for attachments in the whole vault or a specific folder?
// For simplicity, we assume attachments might be in the publish folder or we look in a commonly used 'attachments' folder in vault root.
// Let's assume for this specific requirement "Attachments/Assets" are usually in the same tree or we search recursively.
// To keep it strictly efficient for the prompt: "Obisidian 图片引用：![[image.png]] 或附件目录引用"
// We will search for images in the VAULT_DIR recursive or a specific asset dir.
// Let's assume a flat search or relative paths for simplicity first, but robust enough.
const ATTACHMENT_DIRS = [
    path.resolve(__dirname, '../../vault/publish'),
    path.resolve(__dirname, '../../vault/attachments'), // Common convention
    path.resolve(__dirname, '../../vault')
];

const DOCS_DIR = path.resolve(__dirname, '../site/docs');
const ASSETS_DIR = path.resolve(__dirname, '../site/docs/public/assets');

// Ensure directories exist
if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Cache for file locations to avoid repeated searches
const fileCache = new Map();

async function buildFileIndex(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            await buildFileIndex(fullPath);
        } else if (entry.isFile()) {
            // Store lower case filename for case-insensitive lookup
            fileCache.set(entry.name.toLowerCase(), fullPath);
        }
    }
}

async function findImageFile(filename) {
    // Decode filename just in case it's URL encoded
    filename = decodeURI(filename);
    const name = path.basename(filename).toLowerCase();

    // Lazy build index if empty
    if (fileCache.size === 0) {
        console.log("Building file index from vault...");
        // Index the parent of VAULT_DIR (likely the vault root)
        // VAULT_DIR is .../vault/publish. We want .../vault
        const vaultRoot = path.resolve(VAULT_DIR, '..');
        if (fs.existsSync(vaultRoot)) {
            await buildFileIndex(vaultRoot);
        }
    }

    return fileCache.get(name) || null;
}

function convertWikiLinks(content) {
    // [[Note Name]] -> [Note Name](/Note-Name)
    // [[Note Name|Alias]] -> [Alias](/Note-Name)
    const wikiLinkRegex = /\[\[(.*?)(?:\|(.*?))?\]\]/g;
    return content.replace(wikiLinkRegex, (match, link, alias) => {
        const text = alias || link;
        // Basic slugify: spaces to hyphens, lowercase. Adapt to your VitePress setup.
        // VitePress default: file name "My Note.md" -> URL "/My%20Note" (encoded)
        // Let's stick to simple relative URL logic or encoded.
        // If file is "My Note", VitePress usually handles "/My Note" fine with %20.
        // Let's just strip .md extension if present and keep it raw for VitePress to handle encoding or do basic encodeURI.
        let urlPath = link.replace(/\.md$/, '');
        urlPath = encodeURI(urlPath);
        return `[${text}](/${urlPath})`;
    });
}

function isImage(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff'].includes(ext);
}

async function processImageEmbeds(content) {
    let newContent = content;

    // 1. Handle Obsidian ![[image.png]]
    const obsidianRegex = /!\[\[(.*?)\]\]/g;
    const obsidianMatches = [...newContent.matchAll(obsidianRegex)];

    for (const m of obsidianMatches) {
        const fullMatch = m[0];
        const filename = m[1].split('|')[0]; // Handle aliases like ![[image.png|100]]

        const srcPath = await findImageFile(filename);
        if (srcPath) {
            const destFilename = path.basename(srcPath);
            const destPath = path.join(ASSETS_DIR, destFilename);
            await copyFile(srcPath, destPath);

            const linkUrl = `/assets/${encodeURI(destFilename)}`;
            const replacement = isImage(destFilename)
                ? `![${destFilename}](${linkUrl})`
                : `[${destFilename}](${linkUrl})`;

            newContent = newContent.replace(fullMatch, replacement);
        } else {
            console.warn(`Warning: Image not found ${filename}`);
        }
    }

    // 2. Handle Standard Markdown ![alt](path/to/image.png)
    // We catch regular links that look like images.
    // We ignore http/https links.
    const markdownRegex = /!\[(.*?)\]\((.*?)\)/g;
    const markdownMatches = [...newContent.matchAll(markdownRegex)];

    for (const m of markdownMatches) {
        const fullMatch = m[0];
        const alt = m[1];
        const linkPath = m[2];

        if (linkPath.startsWith('http')) continue;
        if (linkPath.startsWith('/assets/')) continue; // Already processed or manual

        // Extract filename from path
        const filename = path.basename(decodeURI(linkPath));

        const srcPath = await findImageFile(filename);
        if (srcPath) {
            const destFilename = path.basename(srcPath);
            const destPath = path.join(ASSETS_DIR, destFilename);
            await copyFile(srcPath, destPath);

            const linkUrl = `/assets/${encodeURI(destFilename)}`;
            // If it was valid image syntax but pointing to non-image, convert to link
            // If it is an image, keep the !
            const replacement = isImage(destFilename)
                ? `![${alt}](${linkUrl})`
                : `[${alt}](${linkUrl})`;

            // Replace the whole link with new asset path
            newContent = newContent.split(fullMatch).join(replacement);
        } else {
            console.warn(`Warning: Standard image not found ${filename} (from ${linkPath})`);
        }
    }

    return newContent;
}

async function processFile(filePath, relativePath) {
    let content = await readFile(filePath, 'utf8');

    // 1. Process Images (Must do this before WikiLinks to avoid breaking ![[...]])
    content = await processImageEmbeds(content);

    // 2. Convert WikiLinks
    content = convertWikiLinks(content);

    const destPath = path.join(DOCS_DIR, relativePath);
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(destDir)) {
        await mkdir(destDir, { recursive: true });
    }

    await writeFile(destPath, content);
    console.log(`Processed: ${relativePath}`);
}

async function syncDir(dir, baseDir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        if (entry.isDirectory()) {
            await syncDir(fullPath, baseDir);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            await processFile(fullPath, relativePath);
        }
    }
}

// Helper to get sidebar structure
async function getSidebarStructure(dir, baseDir) {
    const entries = await readdir(dir, { withFileTypes: true });

    const items = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath); // relative to docs root

        // Skip .vitepress, public, assets, and hidden files
        if (entry.name.startsWith('.') || entry.name === 'public' || entry.name === 'assets') continue;

        if (entry.isDirectory()) {
            const children = await getSidebarStructure(fullPath, baseDir);
            if (children.length > 0) {
                items.push({
                    text: entry.name,
                    collapsed: true,
                    items: children
                });
            }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            // Check if it's index.md, we usually handle it separately or ignore if it's the section root
            // But if it's a leaf, we include it.
            if (entry.name.toLowerCase() === 'index.md') continue;

            const link = '/' + relativePath.replace(/\\/g, '/').replace(/\.md$/, '');
            items.push({
                text: entry.name.replace(/\.md$/, ''),
                link: encodeURI(link)
            });
        }
    }

    return items;
}

async function main() {
    console.log('Starting sync...');
    console.log(`From: ${VAULT_DIR}`);
    console.log(`To:   ${DOCS_DIR}`);

    // Clean docs dir? Maybe optional or be careful not to delete index.md if it's manual.
    // For this user logic: "Obsidian 是唯一真源", so site/docs should be mirrored.
    // Usually VitePress needs an index.md. If it's in Obsidian publish/index.md, good.
    // If not, we might overwrite a manual setup. 
    // The user said: "从 Obsidian Vault 的 publish/ 子目录同步到 VitePress 的 site/docs/"
    // So we assume publish/ contains everything needed.

    if (fs.existsSync(VAULT_DIR)) {
        await syncDir(VAULT_DIR, VAULT_DIR);
    } else {
        console.error(`Vault directory not found: ${VAULT_DIR}`);
    }

    // Generate Sidebar
    console.log('Generating sidebar config...');
    const sidebarStructure = await getSidebarStructure(DOCS_DIR, DOCS_DIR);

    // We want to scope the sidebar to specific top-level folders basically.
    // Or just one global sidebar. For "Infinite Progress" (无限进步), usually user wants that folder to have its own sidebar.
    // Let's create a mapped sidebar: { '/folder/': [items] }

    const sidebarConfig = {};

    // For each top-level item in structure, if it's a directory, make it a section?
    // Or just dump the whole tree into '/'?
    // The user has "无限进步" folder.
    // Strategy: If top level item is folder, key is /folder/, value is its children.
    // If top level item is file, it goes to root sidebar?

    // Let's iterate the top level of sidebarStructure (which corresponds to DOCS_DIR)
    for (const item of sidebarStructure) {
        if (item.items) {
            // It's a directory
            // The key should be the link to the directory, e.g. /无限进步/
            // Note: sidebarStructure items don't have 'link' on directory nodes currently, just text.
            // We can construct it.
            // VitePress expects decoded keys for sidebar sections (usually).
            // e.g. '/无限进步/' instead of '/%E6%97%...'
            const sectionKey = `/${item.text}/`;
            sidebarConfig[sectionKey] = item.items;
        } else {
            // Root files? usually default sidebar or empty.
        }
    }

    // Write sidebar.json
    const sidebarPath = path.resolve(DOCS_DIR, '.vitepress/sidebar.json');
    await mkdir(path.dirname(sidebarPath), { recursive: true }); // Ensure .vitepress directory exists
    await writeFile(sidebarPath, JSON.stringify(sidebarConfig, null, 2));
    console.log(`Sidebar config written to ${sidebarPath}`);

    console.log('Sync complete.');
}

main().catch(console.error);
