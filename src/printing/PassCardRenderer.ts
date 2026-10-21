import { createHash } from 'node:crypto';
export interface QrMatrixEncoder { readonly errorCorrectionLevel: 'H'; encode(credential: string): Promise<boolean[][]> }
export type CardBrandAssets = { organisationLogoPng: Buffer; applicationLogoPng: Buffer; organisationIconPng: Buffer };
export type CardProject = { code: string; name: string };
export type PassCardData = { personName: string; requestType: 'DIGITAL_ID' | 'EMPLOYEE_PROJECT' | 'EXTERNAL'; publicReference: string; publicPassNumber: string;
  visitStatus: 'PENDING' | 'APPROVED'; locationName: string; projectName?: string; validFromUtc: string; validUntilUtc: string;
  employeeId: string | null; hostEmployeeId: string | null; hostName: string | null; purpose: string; assignedProjectCount: number; assignedProjects: CardProject[] };
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const glyphs = (text: string) => [...segmenter.segment(text)].map(p => p.segment);
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\ufffe\uffff]/gu, ' ').replace(/\s+/gu, ' ').trim();
const units = (text: string) => glyphs(text).reduce((sum, g) => sum + (/^[ ilI1.,'’]$/u.test(g) ? .35 : /^[MW@#%]$/u.test(g) ? 1 : /^[\x20-\x7e]$/u.test(g) ? .66 : 1.3), 0);
function wrap(text: string, limit: number) {
  const result: string[] = []; let line = '';
  for (const word of clean(text).split(' ')) {
    if (units(line ? line + ' ' + word : word) <= limit) { line = line ? line + ' ' + word : word; continue; }
    if (line) { result.push(line); line = ''; }
    for (const g of glyphs(word)) { if (line && units(line + g) > limit) { result.push(line); line = ''; } line += g; }
  }
  if (line) result.push(line); return result.length ? result : ['—'];
}
function fit(text: string, width: number, maximumLines: number, preferred: number, minimum = 16) {
  for (let size = preferred; size >= minimum; size -= 2) { const lines = wrap(text, width / size); if (lines.length <= maximumLines) return { lines, size }; }
  const lines = wrap(text, width / minimum).slice(0, maximumLines); const last = glyphs(lines.at(-1)!);
  while (last.length && units(last.join('') + '…') > width / minimum) last.pop(); lines[lines.length - 1] = last.join('').trimEnd() + '…';
  return { lines, size: minimum };
}
const label = (x: number, y: number, text: string) => `<text x="${x}" y="${y}" font-size="12" font-weight="700" fill="#667085">${escape(text.toUpperCase())}</text>`;
const text = (x: number, y: number, value: string, size = 20, weight = 600, color = '#182230', anchor = 'start') => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escape(value)}</text>`;
function block(x: number, baseline: number, width: number, fitted: ReturnType<typeof fit>, weight = 600, color = '#182230') {
  const height = fitted.lines.length * (fitted.size + 2) + 5;
  return `<svg x="${x}" y="${baseline - fitted.size}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="hidden">${fitted.lines.map((line, i) => text(0, fitted.size + i * (fitted.size + 2), line, fitted.size, weight, color)).join('')}</svg>`;
}
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value.length <= max && clean(value).length > 0;
/** Pure, bounded vector card. Printed identity is never an approval/entry decision. */
export class PassCardRenderer {
  #encoder: QrMatrixEncoder; #logo: string; #organisation: string; #icon: string;
  constructor(encoder: QrMatrixEncoder, brands: CardBrandAssets) {
    for (const png of [brands.organisationLogoPng, brands.applicationLogoPng, brands.organisationIconPng]) {
      if (!Buffer.isBuffer(png) || png.length > 2097152 || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('INVALID_BRAND_ASSET');
    }
    if (encoder.errorCorrectionLevel !== 'H') throw new Error('QR_HIGH_ERROR_CORRECTION_REQUIRED');
    this.#encoder = encoder; this.#logo = brands.applicationLogoPng.toString('base64'); this.#organisation = brands.organisationLogoPng.toString('base64'); this.#icon = brands.organisationIconPng.toString('base64');
  }
  async render(data: PassCardData, photo: Buffer, mime: string, credential: string | null): Promise<Buffer> {
    const external = data.requestType === 'EXTERNAL';
    if (!['PENDING', 'APPROVED'].includes(data.visitStatus) || !['DIGITAL_ID', 'EMPLOYEE_PROJECT', 'EXTERNAL'].includes(data.requestType)
      || typeof credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(credential) || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)
      || !Buffer.isBuffer(photo) || !photo.length || photo.length > 5242880 || !validText(data.personName, 200) || !validText(data.locationName, 150)
      || !validText(data.purpose, 1000) || !validText(data.publicPassNumber, 50) || !Number.isFinite(Date.parse(data.validFromUtc)) || !Number.isFinite(Date.parse(data.validUntilUtc))
      || !Array.isArray(data.assignedProjects) || !Number.isInteger(data.assignedProjectCount) || data.assignedProjectCount < 0 || data.assignedProjectCount > 2147483647
      || data.assignedProjects.length !== Math.min(3, data.assignedProjectCount) || data.assignedProjects.some(p => !p || !validText(p.code, 80) || !validText(p.name, 200))
      || new Set(data.assignedProjects.map(p => p.code)).size !== data.assignedProjects.length
      || (external ? data.employeeId !== null || data.assignedProjectCount !== 0 || !validText(data.hostEmployeeId, 64) || !validText(data.hostName, 200)
        : !validText(data.employeeId, 64) || data.hostEmployeeId !== null || data.hostName !== null)) throw new Error('INVALID_CARD_INPUT');
    const prefix = 'gp-' + createHash('sha256').update(data.publicPassNumber).digest('hex').slice(0, 16);
    const img = (value: string, x: number, y: number, w: number, h: number, alt: string) => `<image aria-label="${alt}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${value}"/>`;
    const p = [`<svg xmlns="http://www.w3.org/2000/svg" width="85.6mm" height="54mm" viewBox="0 0 856 540" role="img" aria-label="Individual Sopra Steria identity card" font-family="Arial,Nirmala UI,sans-serif">`,
      `<defs><linearGradient id="${prefix}-accent"><stop stop-color="#C9002B"/><stop offset="1" stop-color="#FF7800"/></linearGradient><clipPath id="${prefix}-photo"><rect x="28" y="132" width="156" height="176" rx="10"/></clipPath></defs>`,
      `<rect width="856" height="540" fill="white"/><rect width="856" height="6" fill="url(#${prefix}-accent)"/>`,
      img(this.#organisation, 28, 24, 320, 42, 'Sopra Steria'),
      text(828, 47, data.requestType === 'DIGITAL_ID' ? 'EMPLOYEE DIGITAL ID' : external ? 'VISITOR PASS' : 'EMPLOYEE PASS', 20, 700, '#182230', 'end'),
      '<path d="M28 100H828" stroke="#E4E7EC"/>',
      `<g clip-path="url(#${prefix}-photo)"><rect x="28" y="132" width="156" height="176" fill="#EEF1F6"/><image x="28" y="132" width="156" height="176" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${photo.toString('base64')}"/></g>`,
      label(207, 130, 'Name')];
    const name = fit(data.personName, 390, 2, 28, 18); const shift = name.lines.length > 1 ? 20 : 0; p.push(block(207, 161, 390, name, 700));
    p.push(label(28, 340, 'Location'), block(28, 365, 156, fit(data.locationName, 156, 2, 22, 16)));
    if (!external) {
      const codes = data.assignedProjects.map(project => clean(project.code)); const additional = data.assignedProjectCount - codes.length;
      const summary = codes.length ? codes.join(' · ') + (additional ? ` · +${additional} more` : '') : 'No active project';
      const employeeId = fit(data.employeeId!, 390, 2, 21, 15); const detailShift = shift + (employeeId.lines.length > 1 ? 15 : 0);
      p.push(label(207, 190 + shift, 'Employee ID'), block(207, 214 + shift, 390, employeeId),
        label(207, 249 + detailShift, 'Assigned projects'), block(207, 273 + detailShift, 390, fit(summary, 390, 2, 20, 16)),
        label(207, 329 + detailShift, data.requestType === 'DIGITAL_ID' ? 'Reason' : 'Purpose'), block(207, 353 + detailShift, 390, fit(data.purpose, 390, 2, 19, 17)));
      if (additional) p.push(text(597, 322 + detailShift, `${data.assignedProjectCount} assigned`, 10, 400, '#667085', 'end'));
    } else {
      const host = fit(data.hostName!, 390, 2, 22, 18); const hostIdY = 214 + shift + (host.lines.length - 1) * (host.size + 2) + 25;
      const hostId = fit('Employee ID: ' + data.hostEmployeeId!, 390, 2, 17, 15); const purposeY = hostIdY + (hostId.lines.length - 1) * (hostId.size + 2) + 34;
      p.push(label(207, 190 + shift, 'Host'), block(207, 214 + shift, 390, host), block(207, hostIdY, 390, hostId, 600, '#667085'),
        label(207, purposeY, 'Purpose'), block(207, purposeY + 24, 390, fit(data.purpose, 390, 2, 20, 16)));
    }
    const matrix = await this.#encoder.encode(credential); const n = matrix.length;
    if (n !== 37 || matrix.some(row => !Array.isArray(row) || row.length !== n || row.some(bit => typeof bit !== 'boolean'))) throw new Error('INVALID_QR_MATRIX');
    p.push('<rect x="619" y="127" width="218" height="218" rx="8" fill="white" stroke="#E4E7EC"/>',
      '<svg x="624" y="132" width="208" height="208" viewBox="0 0 45 45" shape-rendering="crispEdges"><rect width="45" height="45" fill="white"/><g fill="black">');
    matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) p.push(`<rect x="${x + 4}" y="${y + 4}" width="1" height="1"/>`); }));
    p.push('</g><rect x="19" y="19" width="7" height="7" fill="white"/>', img(this.#icon, 19.75, 19.75, 5.5, 5.5, 'Sopra Steria QR icon'), '</svg>',
      block(619, 373, 218, fit(data.publicPassNumber, 218, 2, 12, 10), 600, '#667085'));
    const formatter = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const time = (value: string) => formatter.format(new Date(value)).replace(',', ' ·') + ' IST';
    p.push('<path d="M28 425H828" stroke="#E4E7EC"/>', text(28, 461, 'VALID FROM', 13, 700, '#667085'), text(148, 461, time(data.validFromUtc), 18),
      text(28, 494, 'VALID UNTIL', 13, 700, '#667085'), text(148, 494, time(data.validUntilUtc), 18), img(this.#logo, 780, 473, 48, 48, 'GatePass'),
      `<rect y="534" width="856" height="6" fill="url(#${prefix}-accent)"/></svg>`);
    const output = Buffer.from(p.join(''), 'utf8'); if (output.length > 10485760) throw new Error('CARD_TOO_LARGE'); return output;
  }
}
