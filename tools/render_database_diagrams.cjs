// Render authored vector diagrams; does not modify the supplied logo.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharpPath = process.env.GATEPASS_SHARP_PATH;
if (!sharpPath) throw new Error('Set GATEPASS_SHARP_PATH to the bundled sharp package directory.');
const sharp = require(sharpPath);
(async () => {
  const dir = path.resolve(__dirname, '../docs/database/diagrams');
  for (const file of (await fs.readdir(dir)).filter(f => f.endsWith('.svg')).sort()) {
    await sharp(path.join(dir, file)).png().toFile(path.join(dir, file.replace(/\.svg$/, '.png')));
    console.log('Rendered ' + file);
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });

