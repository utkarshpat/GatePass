/** Development samples only. The fixed preview QR is never issued into SQL. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PassCardRenderer } from '../src/printing/PassCardRenderer.ts';
import { NodeQrMatrixEncoder } from '../src/printing/NodeQrMatrixEncoder.ts';
const sharpPath = process.env.GATEPASS_SHARP_PATH;
if (!sharpPath) throw new Error('Set the existing sharp path; this tool installs nothing.');
const sharp = createRequire(import.meta.url)(sharpPath);
const renderer = new PassCardRenderer(new NodeQrMatrixEncoder(), { applicationLogoPng: await readFile(new URL('../assets/brand/gatepass-logo.png', import.meta.url)), organisationLogoPng: await readFile(new URL('../assets/brand/sopra-steria-logo.png', import.meta.url)), organisationIconPng: await readFile(new URL('../assets/brand/sopra-steria-icon.png', import.meta.url)) });
const avatar = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="120"><rect width="100" height="120" fill="#eef1f6"/><circle cx="50" cy="34" r="20" fill="#7e8c9e"/><ellipse cx="50" cy="109" rx="39" ry="48" fill="#7e8c9e"/></svg>')).jpeg().toBuffer();
const folder = new URL('../output/previews/', import.meta.url); await mkdir(folder, { recursive: true }); const images: Buffer[] = [];
for (const status of ['APPROVED', 'PENDING'] as const) {
  const source = await renderer.render({ personName: status === 'APPROVED' ? 'Employee 1' : 'Visitor 1', requestType: status === 'APPROVED' ? 'DIGITAL_ID' : 'EXTERNAL',
    publicReference: 'V-DEVELOPMENT-SAMPLE', publicPassNumber: 'GP-SAMPLE-NOT-A-LIVE-PASS', visitStatus: status, locationName: 'Noida',
    employeeId: status === 'APPROVED' ? 'EMP001' : null, hostEmployeeId: status === 'PENDING' ? 'EMP019' : null, hostName: status === 'PENDING' ? 'Employee 19' : null, purpose: status === 'APPROVED' ? 'Forgot physical ID' : 'Client meeting', assignedProjectCount: status === 'APPROVED' ? 2 : 0, assignedProjects: status === 'APPROVED' ? ['APOLLO', 'BEACON'].map(code => ({ code, name: code })) : [], validFromUtc: '2026-10-20T03:30:00.000Z', validUntilUtc: '2026-10-20T18:30:00.000Z' }, avatar, 'image/jpeg', Buffer.alloc(32, 97).toString('base64url'));
  const marked = Buffer.from(source.toString().replace(/<\/svg>$/u, '<text x="428" y="123" text-anchor="middle" fill="#C9002B" font-size="10">DEVELOPMENT SAMPLE · NOT A LIVE PASS</text></svg>'));
  await writeFile(new URL(`${status.toLowerCase()}-card-sample.svg`, folder), marked); const png = await sharp(marked, { density: 305 }).resize(1027, 648).png().toBuffer(); images.push(png);
}
await sharp({ create: { width: 1067, height: 1346, channels: 3, background: '#e4e7ec' } }).composite([{ input: images[0], left: 20, top: 15 }, { input: images[1], left: 20, top: 683 }]).png()
  .toFile(fileURLToPath(new URL('print-cards-preview.png', folder)));
process.stdout.write('Created approved and pending development card previews; no live credential or personal photo used.\n');
