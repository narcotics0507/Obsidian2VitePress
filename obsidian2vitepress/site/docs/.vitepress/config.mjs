import { defineConfig } from 'vitepress'
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let sidebar = {};
try {
    sidebar = require('./sidebar.json');
} catch (e) {
    console.log("No sidebar.json found, skipping.");
}

export default defineConfig({
    title: "Colonel's Blog",
    description: "Synced from Obsidian",
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: '上校的进阶之路', link: '/无限进步/' }
        ],
        // Use the generated sidebar
        sidebar: sidebar
    }
})
