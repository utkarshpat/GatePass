import type { Office } from "./types.ts";
export async function downloadPosterPng(
  office: Office,
  qrDataUrl: string,
  locationName: string,
  officeUrl: string,
  logoImg: HTMLImageElement | null,
  qrImg: HTMLImageElement | null,
  welcomeFont: string,
) {
  if (!qrDataUrl) return;
  const canvas = document.createElement("canvas"),
    width = 1200,
    height = 1600;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const ctx = context;
  function roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number | number[],
  ) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    const radius = typeof r === "number" ? r : Array.isArray(r) ? r[0] : 0;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);
  const mx = 60,
    my = 60,
    cw = width - 120,
    ch = height - 120,
    cr = 28;
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.08)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = "#ffffff";
  roundRect(mx, my, cw, ch, cr);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  roundRect(mx, my, cw, ch, cr);
  ctx.stroke();
  const grad = ctx.createLinearGradient(mx, my, mx + cw, my);
  grad.addColorStop(0, "#c9002b");
  grad.addColorStop(1, "#ff7800");
  ctx.fillStyle = grad;
  roundRect(mx, my, cw, 16, [cr, cr, 0, 0]);
  ctx.fill();

  let topY = my + 60;
  if (logoImg && logoImg.complete && logoImg.naturalWidth) {
    const lw = 400,
      lh = Math.round(lw * (logoImg.naturalHeight / logoImg.naturalWidth));
    ctx.drawImage(logoImg, (width - lw) / 2, topY, lw, lh);
    topY += lh + 24;
  } else {
    ctx.font = "bold 44px Arial, sans-serif";
    ctx.fillStyle = "#182230";
    ctx.textAlign = "center";
    ctx.fillText("sopra steria", width / 2, topY + 44);
    topY += 68;
  }

  ctx.textAlign = "center";
  ctx.font = "600 54px " + welcomeFont;
  ctx.fillStyle = "#334155";
  ctx.fillText("welcomes you", width / 2, topY + 32);

  if (locationName) {
    ctx.font = "bold 22px Arial, sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText(locationName.toUpperCase(), width / 2, topY + 70);
  }

  const qBoxW = 960,
    qBoxH = 960,
    qBoxX = (width - qBoxW) / 2,
    qBoxY = topY + 105;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 3;
  roundRect(qBoxX, qBoxY, qBoxW, qBoxH, 24);
  ctx.fill();
  ctx.stroke();

  if (qrImg && qrImg.complete && qrImg.naturalWidth) {
    const qPad = 28;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      qrImg,
      qBoxX + qPad,
      qBoxY + qPad,
      qBoxW - qPad * 2,
      qBoxH - qPad * 2,
    );
    ctx.restore();
  }

  const pillW = 960,
    pillH = 80,
    pillX = (width - pillW) / 2,
    pillY = qBoxY + qBoxH + 32;
  ctx.fillStyle = "#0f172a";
  roundRect(pillX, pillY, pillW, pillH, 32);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    "📷  Scan the above QR to get your Digital Pass",
    width / 2,
    pillY + 49,
  );

  const footerY = pillY + pillH + 48;
  ctx.fillStyle = "#64748b";
  ctx.font = "bold 22px Arial, sans-serif";
  ctx.fillText(
    "Unable to scan? Visit: " + (officeUrl || ""),
    width / 2,
    footerY,
  );

  ctx.fillStyle = "#94a3b8";
  ctx.font = "20px Arial, sans-serif";
  ctx.fillText("You can ask reception for help", width / 2, footerY + 36);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const blobUrl = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = blobUrl;
    link.download =
      "GatePass-" + (office?.locationCode || "Office") + "-Welcome-Poster.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }, "image/png");
}
