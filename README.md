# Colonel's Blog System

[![VitePress](https://img.shields.io/badge/VitePress-1.x-646CFF.svg?logo=vite&logoColor=white)](https://vitepress.dev/)
[![Obsidian](https://img.shields.io/badge/Writer-Obsidian-483699.svg?logo=obsidian&logoColor=white)](https://obsidian.md/)
[![Docker](https://img.shields.io/badge/Deploy-Docker-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **极简、高效、纯静态的个人知识库系统。**
> 
> 这是一个基于 [VitePress](https://vitepress.dev/) 构建的静态博客系统，它并非传统的 CMS，而是专门为 **Obsidian** 用户打造的"发布流"解决方案。你只需要专注于在 Obsidian 中写作，剩下的同步、构建、部署全部由自动化脚本完成。

## 📖 核心理念 (Core Concepts)

1.  **数据源即真理 (Source of Truth)**: 你的 Obsidian Vault 是唯一的内容源。
2.  **零侵入写作**: 不需要学习复杂的 Frontmatter 配置，像平常一样写笔记即可。
3.  **自动化工作流**: 一键脚本完成 `同步 -> 转换 -> 构建 -> 打包` 全过程。
4.  **无后端架构**: 生成纯静态 HTML，部署简单，安全性高，访问速度极快。

## 🏗️ 架构概览 (Architecture)

```mermaid
graph LR
    subgraph "Local Environment"
        Obsidian[Obsidian Vault\n(Markdown + Images)] -->|Sync Script| ViteSource[VitePress Source\n(docs/)]
        ViteSource -->|Build| Dist[Static HTML/CSS/JS\n(dist/)]
        Dist -->|Package| Zip[Release Zip\n(latest_site_build.zip)]
    end
    
    subgraph "Production Environment"
        Zip -->|Upload & Unzip| Volume[Docker Volume\n(data/frontend_dist)]
        Volume -->|Mount| Nginx[Nginx Container]
        Nginx -->|Serve| User((User))
    end
```

## 📂 目录结构

```text
.
├── obsidian2vitepress/
│   ├── site/               # VitePress 前端项目源码
│   │   ├── docs/           # (自动生成) 同步后的文档存放处，不要手动修改！
│   │   └── .vitepress/     # 站点配置文件 (config.mjs, theme config)
│   ├── scripts/sync.js     # 核心同步脚本：处理Obsidian链接/图片转换，生成侧边栏
│   └── deploy/             # 部署配置
│       └── docker-compose.yml # 生产环境 Docker 编排文件
├── vault/                  # 你的个人知识库
│   └── publish/            # 【重要】只有放入此目录的笔记才会被发布
├── publish.ps1             # Windows 一键发布脚本
├── publish.sh              # macOS/Linux 一键发布脚本
└── README.md
```

## 🚀 快速开始 (Quick Start)

### 环境要求
*   **开发环境**: Node.js v18+
*   **生产环境**: Docker Engine (可选，但推荐)

### 1. 初始化项目

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/your-repo.git
cd your-repo

# 2. 安装依赖
cd obsidian2vitepress/site
npm install
```

### 2. 本地开发预览
在写作过程中，你可以实时预览网站效果：

```bash
npm run docs:dev
```
访问 `http://localhost:5173`。当你修改 Obsidian 文件并运行同步脚本后，预览会自动热更新。

## ✍️ 写作指南 (Writing Guide)

1.  **打开 Obsidian**: 指向 `vault` 目录。
2.  **创建内容**: 在 `publish` 文件夹下创建你的笔记目录结构。
    *   例如：`publish/技术/Golang/Hello.md`
    *   目录结构会自动转化为网站的**左侧导航栏**。
3.  **引用图片**: 
    *   直接支持 Obsidian 的 `![[图片.png]]` 语法。
    *   脚本会自动寻找 Vault 中的图片并复制到站点资源目录。
4.  **内部链接**:
    *   支持 `[[笔记标题]]` 语法，会自动转换为网页链接。

## 📦 发布与部署 (Deployment)

我们提供了一键脚本来简化发布流程。脚本会执行：`同步资源` -> `生成静态站` -> `打包为 Zip`。

### Windows 用户
在项目根目录运行 PowerShell：
```powershell
./publish.ps1
```

### macOS / Linux 用户
在项目根目录运行 Bash：
```bash
chmod +x publish.sh # 首次运行赋权
./publish.sh
```

### 部署到服务器 (Docker)

脚本运行结束后，会在根目录生成 `latest_site_build.zip`。

1.  **准备环境**: 在服务器上确保有 docker 和 docker-compose。
2.  **启动服务**:
    ```bash
    cd blog/deploy
    docker-compose up -d
    ```
3.  **上传内容**:
    将 `latest_site_build.zip` 上传到服务器，并解压到 `blog/deploy/dist` 目录（即 `docker-compose.yml` 的同级目录 `dist`）。
    
    *示例操作*:
    ```bash
    # 假设你在 blog/deploy 目录下
    mkdir dist
    unzip -o ../../latest_site_build.zip -d dist
    ```
    无需重启 Nginx 容器，刷新浏览器即可看到最新内容。

## ⚙️ 高级配置 (Configuration)

### 修改站点标题
编辑 `obsidian2vitepress/site/docs/.vitepress/config.mjs`:
```javascript
export default defineConfig({
    title: "我的博客", // 修改这里
    description: "...",
    // ...
})
```

### 修改同步逻辑
核心逻辑位于 `obsidian2vitepress/scripts/sync.js`。如果你需要修改：
*   Obsidian 附件的查找路径
*   文件名过滤规则
*   侧边栏生成策略
请直接修改该 Node.js 脚本。

## ❓ 常见问题 (FAQ)

**Q: 为什么我在 site/docs 下修改的文件被覆盖了？**
A: `site/docs` 是构建产物，**永远不要手动修改它**。每次运行发布脚本时，它都会被 `vault/publish` 的内容覆盖。请始终在 `vault` 中写作。

**Q: 图片显示不出来？**
A: 请确保图片在 Obsidian 中能正常显示，且文件名不包含特殊字符（推荐仅使用字母、数字、下划线）。

**Q: 部署后访问出现 403 Forbidden？**
A: 这是 Linux 文件权限问题。Nginx 容器没有读取你解压出来的文件的权限。
请在服务器的 `blog/deploy` 目录下运行：
```bash
chmod -R 755 dist
```
然后刷新网页即可。

## 📄 License

MIT License. Feel free to use this template for your own blog!
