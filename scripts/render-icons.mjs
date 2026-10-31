import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile('assets/logo.svg');
const sizes = [16, 32, 48, 96, 128];
for (const n of sizes) {
  const png = await sharp(svg, { density: 300 }).resize(n, n).png().toBuffer();
  await writeFile(`public/icon/${n}.png`, png);
}
console.log('rendered', sizes.join(','));
