export function photoCropSource(
  width: number,
  height: number,
  preview: { width: number; height: number; left: number; top: number },
  frame: { width: number; height: number; left: number; top: number },
  flipped = false,
) {
  if (
    ![
      width,
      height,
      preview.width,
      preview.height,
      frame.width,
      frame.height,
    ].every((n) => Number.isFinite(n) && n > 0) ||
    ![preview.left, preview.top, frame.left, frame.top].every(Number.isFinite)
  )
    throw Error("Invalid photo crop.");
  const scale = Math.max(preview.width / width, preview.height / height),
    left = preview.left + (preview.width - width * scale) / 2,
    top = preview.top + (preview.height - height * scale) / 2,
    sw = frame.width / scale,
    sh = frame.height / scale;
  let sx = (frame.left - left) / scale,
    sy = (frame.top - top) / scale;
  if (sx < -0.5 || sy < -0.5 || sx + sw > width + 0.5 || sy + sh > height + 0.5)
    throw Error("Keep the photo inside the frame.");
  sx = Math.max(0, Math.min(sx, width - sw));
  sy = Math.max(0, Math.min(sy, height - sh));
  return { sx: flipped ? width - sx - sw : sx, sy, sw, sh };
}
