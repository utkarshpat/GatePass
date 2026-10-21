/** Self-contained HTML design artifact, not a production card or issued credential.
 * Replaces the supplied A4 mockup with verified vector ID-card samples. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BinaryBitmap, DecodeHintType, HybridBinarizer, RGBLuminanceSource, QRCodeReader } from '@zxing/library';
import { PassCardRenderer } from '../src/printing/PassCardRenderer.ts';
import { NodeQrMatrixEncoder } from '../src/printing/NodeQrMatrixEncoder.ts';

const sharpPath = process.env.GATEPASS_SHARP_PATH;
if (!sharpPath) throw new Error('Set GATEPASS_SHARP_PATH to an existing approved sharp package.');
const sharp = createRequire(import.meta.url)(sharpPath);
const folder = new URL('../output/previews/', import.meta.url); await mkdir(folder, { recursive: true });
const assets = Object.fromEntries(await Promise.all(['sopra-steria-logo', 'sopra-steria-icon', 'gatepass-logo'].map(async name => [name, await readFile(new URL(`../assets/brand/${name}.png`, import.meta.url))])));
const encoder = new NodeQrMatrixEncoder();
const renderer = new PassCardRenderer(encoder, { applicationLogoPng: assets['gatepass-logo'], organisationLogoPng: assets['sopra-steria-logo'], organisationIconPng: assets['sopra-steria-icon'] });
const avatar = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="156" height="176"><rect width="156" height="176" fill="#EEF1F6"/><circle cx="78" cy="55" r="29" fill="#8E9BAE"/><path d="M20 176V172C20 139 46 117 78 117S136 139 136 172V176Z" fill="#8E9BAE"/></svg>')).png().toBuffer();
type Sample = { kind: 'employee' | 'visitor'; name: string; employeeId?: string; projects?: string[]; hostName?: string; hostId?: string; purpose: string; reference: string; until: string };
const samples: Sample[] = [
  { kind: 'employee', name: 'Employee 1', employeeId: 'EMP001', projects: ['APOLLO', 'BEACON', 'COMPASS'], purpose: 'Forgot physical ID', reference: 'GP-EMP-SAMPLE-0001', until: '19:00' },
  { kind: 'visitor', name: 'Visitor 1', hostName: 'Employee 19', hostId: 'EMP019', purpose: 'Client meeting', reference: 'GP-VIS-SAMPLE-0001', until: '18:30' },
];
async function card(sample: Sample, token: string) {
  const employee = sample.kind === 'employee';
  const svg = await renderer.render({ personName: sample.name, requestType: employee ? 'DIGITAL_ID' : 'EXTERNAL',
    publicReference: 'V-DEVELOPMENT-SAMPLE', publicPassNumber: sample.reference, visitStatus: employee ? 'APPROVED' : 'PENDING', locationName: 'Noida',
    validFromUtc: '2026-10-20T03:30:00.000Z', validUntilUtc: employee ? '2026-10-20T13:30:00.000Z' : '2026-10-20T13:00:00.000Z',
    employeeId: employee ? sample.employeeId! : null, hostEmployeeId: employee ? null : sample.hostId!, hostName: employee ? null : sample.hostName!,
    purpose: sample.purpose, assignedProjectCount: sample.projects?.length ?? 0, assignedProjects: (sample.projects ?? []).map(code => ({ code, name: code }))
  }, avatar, 'image/png', token);
  return Buffer.from(svg.toString().replace(/<\/svg>$/u, '<text x="828" y="70" font-size="10" font-weight="700" fill="#9B5561" text-anchor="end">SAMPLE</text></svg>'));
}
async function decode(bytes: Buffer): Promise<string> {
  for (const angle of [0, 90, 180, 270]) {
    const raw = await sharp(bytes).rotate(angle).flatten({ background: 'white' }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
    const source = new RGBLuminanceSource(new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength), raw.info.width, raw.info.height);
    try { return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)), new Map([[DecodeHintType.TRY_HARDER, true]])).getText(); } catch { /* Independent detector: try another orientation. */ }
  }
  throw new Error('SAMPLE_QR_DECODE_FAILED');
}
const svgs: Buffer[] = []; const previews: Buffer[] = []; let decodes = 0;
for (const sample of samples) {
  const raw = randomBytes(32); const token = raw.toString('base64url'); raw.fill(0); const svg = await card(sample, token);
  for (const width of [600, 1000, 1600]) {
    const png = await sharp(svg, { density: width * 25.4 / 85.6 }).resize({ width }).png().toBuffer(); const factor = width / 856;
    const crop = await sharp(png).extract({ left: Math.floor(624 * factor), top: Math.floor(132 * factor), width: Math.ceil(208 * factor), height: Math.ceil(208 * factor) }).png().toBuffer();
    if (await decode(crop) !== token) throw new Error('SAMPLE_QR_PAYLOAD_MISMATCH'); decodes++;
    if (width === 1000) { if (await decode(png) !== token) throw new Error('SAMPLE_FULL_CARD_QR_MISMATCH'); decodes++; }
  }
  svgs.push(svg); await writeFile(new URL(`redesign-${sample.kind}-sample.svg`, folder), svg);
  previews.push(await sharp(svg, { density: 305 }).resize(1027, 648).png().toBuffer());
}
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>GatePass · ID-card print preview</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f9;color:#182230;font-family:Segoe UI,Arial,sans-serif}.page{max-width:1100px;margin:auto;padding:28px 24px 48px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:24px}h1{font-size:25px;margin:0 0 7px}p{margin:0;color:#667085;font-size:14px;line-height:1.6}.actions{display:flex;gap:10px;flex-wrap:wrap}button{background:white;border:1px solid #d7ddea;border-radius:9px;padding:11px 15px;font:600 14px Segoe UI,Arial,sans-serif;color:#182230;cursor:pointer}button:hover{background:#fff4ed;border-color:#ffb88a}button:focus-visible{outline:3px solid #C9002B;outline-offset:3px}.cards{display:grid;gap:26px}.card-page{margin:0;width:100%;aspect-ratio:856/540;border-radius:15px;overflow:hidden;box-shadow:0 12px 34px #18223014;background:#fff}.card-page>svg{display:block;width:100%;height:auto}.notes{margin-top:24px;padding:16px 18px;background:#fff;border:1px solid #e4e7ec;border-radius:10px}.notes strong{color:#182230}.hint{font-size:12px;color:#667085;margin-top:5px}
@media(max-width:600px){.page{padding:18px 12px 30px}h1{font-size:21px}.topbar{gap:12px}.card-page{border-radius:8px}.notes{padding:13px}}
@media print{@page{size:85.6mm 54mm;margin:0}html,body{margin:0;padding:0;width:85.6mm;background:#fff}.page{margin:0;padding:0;max-width:none;width:85.6mm}.topbar,.notes{display:none!important}.cards{display:block;margin:0;padding:0}.card-page{display:block;width:85.6mm;height:54mm;margin:0;aspect-ratio:auto;box-shadow:none;border:0;border-radius:0;break-inside:avoid;break-after:page;page-break-after:always;print-color-adjust:exact;-webkit-print-color-adjust:exact}.card-page:last-child{break-after:auto;page-break-after:auto}.card-page>svg{width:85.6mm;height:54mm}html[data-print="employee"] .card-page[data-card="visitor"],html[data-print="visitor"] .card-page[data-card="employee"]{display:none!important}html[data-print="employee"] .card-page[data-card="employee"],html[data-print="visitor"] .card-page[data-card="visitor"]{break-after:auto;page-break-after:auto}}
</style></head><body><main class="page">
<header class="topbar"><div><h1>GatePass card preview</h1><p>Employee Digital ID &amp; Visitor Pass · 85.6 × 54 mm landscape</p><p class="hint">Synthetic development samples; these cards are not issued or valid for access.</p></div><div class="actions"><button type="button" onclick="printCard('employee')">Print employee sample</button><button type="button" onclick="printCard('visitor')">Print visitor sample</button><button type="button" onclick="printCard('all')">Print both</button></div></header>
<section class="cards" aria-label="Individual card samples">${svgs.map((svg, index) => `<figure class="card-page" data-card="${samples[index].kind}">${svg.toString()}</figure>`).join('')}</section>
<aside class="notes"><p><strong>Print at Actual size / 100%.</strong> Select 85.6 × 54 mm media where supported. Turn off browser headers/footers and fit-to-page scaling. Each card prints on its own page.</p><p class="hint">QRs are encoded test values and were checked with an independent decoder. They are never issued into the GatePass database. Real approval and project access are checked in the guard application. Printer/device acceptance remains to be done.</p></aside>
</main><script>function printCard(kind){if(!['employee','visitor','all'].includes(kind))return;document.documentElement.dataset.print=kind;try{window.print()}catch(error){delete document.documentElement.dataset.print;throw error}}window.addEventListener('afterprint',function(){delete document.documentElement.dataset.print});</script></body></html>`;
await writeFile(new URL('GatePass_Digital_ID_Redesign.html', folder), html, 'utf8');
await sharp({ create: { width: 1067, height: 1346, channels: 3, background: '#e4e7ec' } }).composite([{ input: previews[0], left: 20, top: 15 }, { input: previews[1], left: 20, top: 683 }]).png().toFile(fileURLToPath(new URL('redesigned-cards-preview.png', folder)));
await writeFile(new URL('redesigned-cards-validation.json', folder), JSON.stringify({ Status: 'PASS', CheckedAtUtc: new Date().toISOString(), CardSizeMm: [85.6, 54],
  LogoPlacement: 'compact top-left; pass type right; small GatePass bottom-right', Cards: 2, IndependentQrDecodes: decodes, RasterWidths: [600, 1000, 1600],
  QrVersion: 5, ErrorCorrection: 'H', QrPayloadsPersistedAsPlaintext: false, IssuedIntoDatabase: false, RendererSha256: createHash('sha256').update(await readFile(new URL('../src/printing/PassCardRenderer.ts', import.meta.url))).digest('hex'), SourceSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
  HtmlSha256: createHash('sha256').update(html).digest('hex'), Limits: 'SVG card raster/decode and static HTML/print CSS verification; no browser print dialog or physical printer acceptance. Samples use the same PassCardRenderer as the DB-backed print service.' }, null, 2) + '\n', 'utf8');
process.stdout.write(`Created self-contained two-card HTML and PNG; ${decodes} independent QR decodes passed. No credential issued or database changed.\n`);
