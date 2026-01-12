#!/bin/bash
set -e

echo "1. Syncing content from Obsidian Vault..."
node obsidian2vitepress/scripts/sync.js

echo "2. Building VitePress site..."
cd obsidian2vitepress/site
npm run docs:build
cd ../..

DIST_DIR="obsidian2vitepress/site/docs/.vitepress/dist"
ZIP_NAME="latest_site_build.zip"

echo "3. Packaging for Remote Server..."
# Remove old zip if exists
rm -f "$ZIP_NAME"

# Check if dist directory exists
if [ ! -d "$DIST_DIR" ]; then
    echo "Error: Build directory $DIST_DIR does not exist."
    exit 1
fi

# Zip the contents of the dist directory
# We cd into the directory to avoid including the full path in the zip
pushd "$DIST_DIR" > /dev/null
zip -r "../../../../$ZIP_NAME" .
popd > /dev/null

echo "----------------------------------------------------------------"
echo "Build Complete!"
echo "Package File: $(pwd)/$ZIP_NAME"
echo "----------------------------------------------------------------"
echo "Deployment Instructions:"
echo "1. Upload '$ZIP_NAME' to your server's deployment directory."
echo "2. Create a 'dist' folder next to docker-compose.yml."
echo "3. Unzip contents into the 'dist' folder."
echo "----------------------------------------------------------------"
