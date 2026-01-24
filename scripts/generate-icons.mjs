/**
 * Script to generate app icons from SVG source
 * Run with: node scripts/generate-icons.mjs
 *
 * Requires: npm install sharp --save-dev
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const publicDir = join(__dirname, '..', 'public');

const svgPath = join(buildDir, 'icon.svg');
const svgBuffer = readFileSync(svgPath);

const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

async function generatePNGs() {
  console.log('Generating PNG icons...');

  for (const size of sizes) {
    const outputPath = join(buildDir, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`  Created: icon-${size}.png`);
  }

  // Main icon.png (256x256 for electron-builder)
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(join(buildDir, 'icon.png'));
  console.log('  Created: icon.png (256x256)');
}

async function generateICO() {
  console.log('Generating ICO file...');

  // For Windows ICO, we need multiple sizes in one file
  // sharp doesn't support ICO directly, but we can use png-to-ico
  // For now, create the PNGs and use an online converter or ico-convert package

  const icoSizes = [16, 32, 48, 256];
  const pngBuffers = await Promise.all(
    icoSizes.map(size =>
      sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toBuffer()
    )
  );

  // Create a simple ICO file (just using 256x256 for now)
  // For proper multi-resolution ICO, use png-to-ico package
  console.log('  Note: For proper ICO with multiple resolutions, use png-to-ico package');
  console.log('  Run: npx png-to-ico build/icon-16.png build/icon-32.png build/icon-48.png build/icon-256.png > build/icon.ico');
}

async function main() {
  try {
    await generatePNGs();
    await generateICO();

    // Copy favicon to public
    await sharp(svgBuffer)
      .resize(32, 32)
      .png()
      .toFile(join(publicDir, 'favicon.png'));
    console.log('  Created: public/favicon.png');

    console.log('\nDone! Next steps:');
    console.log('1. For Windows ICO: npx png-to-ico build/icon-16.png build/icon-32.png build/icon-48.png build/icon-256.png > build/icon.ico');
    console.log('2. For macOS ICNS: Use iconutil on macOS or online converter');
    console.log('3. Copy icon.ico to public/favicon.ico');
  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

main();
