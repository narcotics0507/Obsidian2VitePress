$ErrorActionPreference = "Stop"

Write-Host "1. Syncing content from Obsidian Vault..."
node obsidian2vitepress/scripts/sync.js

Write-Host "2. Building VitePress site..."
Set-Location obsidian2vitepress/site
npm run docs:build
Set-Location ../..

$distPath = "obsidian2vitepress/site/docs/.vitepress/dist"
$zipName = "latest_site_build.zip"

Write-Host "3. Packaging for Remote Server..."
# Remove old zip if exists
if (Test-Path $zipName) { Remove-Item $zipName -Force }

# Create new zip
# We use Compress-Archive. Note: this requires PowerShell 5.0+ (Standard on Win 10/11)
Compress-Archive -Path "$distPath\*" -DestinationPath $zipName -Force

Write-Host "----------------------------------------------------------------"
Write-Host "Build Complete!" -ForegroundColor Green
Write-Host "Package File: $PWD\$zipName"
Write-Host "----------------------------------------------------------------"
Write-Host "Deployment Instructions:"
Write-Host "1. Upload '$zipName' to your server's deployment directory."
Write-Host "2. Create a 'dist' folder next to docker-compose.yml."
Write-Host "3. Unzip contents into the 'dist' folder."
Write-Host "----------------------------------------------------------------"
