import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSourcePath = path.join(
  projectRoot,
  'frontend',
  'public',
  'assets',
  'achievements',
  'new_path.svg'
);
const defaultOutputPath = path.join(projectRoot, 'build', 'icon.png');
const paper = { r: 244, g: 240, b: 232, alpha: 1 };

export async function buildIcon({
  sourcePath = defaultSourcePath,
  outputPath = defaultOutputPath
} = {}) {
  const source = sourcePath instanceof URL ? fileURLToPath(sourcePath) : sourcePath;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(source)
    .resize(384, 384, { fit: 'contain' })
    .extend({ top: 64, bottom: 64, left: 64, right: 64, background: paper })
    .flatten({ background: paper })
    .png()
    .toFile(outputPath);
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputPath = await buildIcon();
  console.log(`Built Margin icon: ${outputPath}`);
}
