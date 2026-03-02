/**
 * Script to generate app icons from SVG source
 * Run with: node scripts/generate-icons.mjs
 *
 * Requires: npm install sharp png-to-ico --save-dev
 */

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const publicDir = join(__dirname, '..', 'public');

const svgPath = join(buildDir, 'icon.svg');
const svgBuffer = readFileSync(svgPath);

const sizes = [16, 32, 48, 256];

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
  copyFileSync(join(buildDir, 'icon-256.png'), join(buildDir, 'icon.png'));
  console.log('  Created: icon.png (256x256, copied from icon-256.png)');
}

async function generateICO() {
  console.log('Generating ICO file...');

  const icoSizes = [16, 32, 48, 256];
  const pngBuffers = await Promise.all(
    icoSizes.map(size =>
      sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toBuffer()
    )
  );

  const icoBuffer = await pngToIco(pngBuffers);
  writeFileSync(join(buildDir, 'icon.ico'), icoBuffer);
  console.log('  Created: icon.ico (16, 32, 48, 256)');
}

async function copyToPublic() {
  console.log('Copying to public/...');

  // Favicon PNG (32x32)
  await sharp(svgBuffer)
    .resize(32, 32)
    .png()
    .toFile(join(publicDir, 'favicon.png'));
  console.log('  Created: public/favicon.png');

  // Favicon ICO
  copyFileSync(join(buildDir, 'icon.ico'), join(publicDir, 'favicon.ico'));
  console.log('  Copied: public/favicon.ico');

  // Favicon SVG
  copyFileSync(join(buildDir, 'icon.svg'), join(publicDir, 'favicon.svg'));
  console.log('  Copied: public/favicon.svg');
}

async function main() {
  try {
    await generatePNGs();
    await generateICO();
    await copyToPublic();
    console.log('\nDone! All icons generated and copied.');
  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

main();
