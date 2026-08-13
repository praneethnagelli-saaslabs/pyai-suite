#!/usr/bin/env swift
import AppKit
import Foundation

let icons = URL(fileURLWithPath: CommandLine.arguments[1])

/// Lucide Mic2 (web UI Scrib / sidebar mark) in a 24×24 viewBox.
func addMic2(_ ctx: CGContext, stroke: CGFloat) {
  ctx.setLineWidth(stroke)
  ctx.setLineCap(.round)
  ctx.setLineJoin(.round)
  ctx.setMiterLimit(2)

  ctx.addEllipse(in: CGRect(x: 12, y: 2, width: 10, height: 10))
  ctx.strokePath()

  let path = CGMutablePath()
  path.move(to: CGPoint(x: 12, y: 8))
  path.addLine(to: CGPoint(x: 2.96, y: 17.06))
  addSVGArc(
    path,
    from: CGPoint(x: 2.96, y: 17.06),
    to: CGPoint(x: 6.94, y: 21.04),
    rx: 2.82,
    ry: 2.82,
    largeArc: true,
    sweep: false
  )
  path.addLine(to: CGPoint(x: 16, y: 12))
  ctx.addPath(path)
  ctx.strokePath()
}

func addSVGArc(
  _ path: CGMutablePath,
  from: CGPoint,
  to: CGPoint,
  rx inRx: CGFloat,
  ry inRy: CGFloat,
  largeArc: Bool,
  sweep: Bool
) {
  var rx = abs(inRx)
  var ry = abs(inRy)
  if rx == 0 || ry == 0 {
    path.addLine(to: to)
    return
  }
  let dx = (from.x - to.x) / 2
  let dy = (from.y - to.y) / 2
  let lam = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
  if lam > 1 {
    let s = sqrt(lam)
    rx *= s
    ry *= s
  }
  let sign: CGFloat = largeArc != sweep ? 1 : -1
  let num = max(0, rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx)
  let den = rx * rx * dy * dy + ry * ry * dx * dx
  let coef = sign * sqrt(num / den)
  let cxp = coef * (rx * dy) / ry
  let cyp = coef * (-ry * dx) / rx
  let cx = cxp + (from.x + to.x) / 2
  let cy = cyp + (from.y + to.y) / 2

  func vectorAngle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
    let dot = ux * vx + uy * vy
    let len = hypot(ux, uy) * hypot(vx, vy)
    var a = acos(min(1, max(-1, dot / len)))
    if ux * vy - uy * vx < 0 { a = -a }
    return a
  }

  let start = vectorAngle(1, 0, (dx - cxp) / rx, (dy - cyp) / ry)
  var delta = vectorAngle(
    (dx - cxp) / rx, (dy - cyp) / ry,
    (-dx - cxp) / rx, (-dy - cyp) / ry
  )
  if !sweep && delta > 0 { delta -= 2 * .pi }
  if sweep && delta < 0 { delta += 2 * .pi }

  path.addArc(
    center: CGPoint(x: cx, y: cy),
    radius: rx,
    startAngle: start,
    endAngle: start + delta,
    clockwise: !sweep
  )
}

func makePNG(size: Int, draw: (CGContext, CGFloat) -> Void) -> Data {
  let s = size
  guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: s,
    pixelsHigh: s,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    fputs("bitmap failed\n", stderr)
    exit(1)
  }
  rep.size = NSSize(width: s, height: s)
  NSGraphicsContext.saveGraphicsState()
  guard let ns = NSGraphicsContext(bitmapImageRep: rep) else {
    fputs("context failed\n", stderr)
    exit(1)
  }
  NSGraphicsContext.current = ns
  let ctx = ns.cgContext
  ctx.setShouldAntialias(true)
  ctx.setAllowsAntialiasing(true)
  ctx.interpolationQuality = .high
  ctx.clear(CGRect(x: 0, y: 0, width: s, height: s))
  // SVG / Lucide y-down
  ctx.translateBy(x: 0, y: CGFloat(s))
  ctx.scaleBy(x: 1, y: -1)
  draw(ctx, CGFloat(s))
  NSGraphicsContext.restoreGraphicsState()
  guard let data = rep.representation(using: .png, properties: [:]) else {
    fputs("png encode failed\n", stderr)
    exit(1)
  }
  return data
}

func write(_ data: Data, _ name: String) {
  let dest = icons.appendingPathComponent(name)
  try! FileManager.default.createDirectory(
    at: dest.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try! data.write(to: dest)
  fputs("wrote \(name)\n", stderr)
}

func appIcon(_ size: Int) -> Data {
  makePNG(size: size) { ctx, s in
    let radius = s * 0.22
    let tile = CGRect(x: 0, y: 0, width: s, height: s)
    let path = CGPath(roundedRect: tile, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.setFillColor(NSColor(srgbRed: 17 / 255, green: 27 / 255, blue: 38 / 255, alpha: 1).cgColor)
    ctx.addPath(path)
    ctx.fillPath()

    let inset = s * 0.18
    let box = s - inset * 2
    let scale = box / 24
    ctx.saveGState()
    ctx.translateBy(x: inset, y: inset)
    ctx.scaleBy(x: scale, y: scale)
    ctx.setStrokeColor(NSColor.white.cgColor)
    addMic2(ctx, stroke: 2)
    ctx.restoreGState()
  }
}

func trayIcon(_ size: Int) -> Data {
  makePNG(size: size) { ctx, s in
    let pad = s * 0.08
    let scale = (s - pad * 2) / 24
    ctx.translateBy(x: pad, y: pad)
    ctx.scaleBy(x: scale, y: scale)
    ctx.setStrokeColor(NSColor.black.cgColor)
    addMic2(ctx, stroke: 2)
  }
}

write(appIcon(32), "32x32.png")
write(appIcon(128), "128x128.png")
write(appIcon(256), "128x128@2x.png")
write(appIcon(256), "256x256.png")
write(appIcon(512), "512x512.png")
write(appIcon(1024), "1024x1024.png")
write(appIcon(1024), "icon.png")
write(trayIcon(64), "tray.png")

let set = icons.appendingPathComponent("icon.iconset")
try? FileManager.default.removeItem(at: set)
try! FileManager.default.createDirectory(at: set, withIntermediateDirectories: true)
let iconset: [(Int, String)] = [
  (16, "icon_16x16.png"),
  (32, "icon_16x16@2x.png"),
  (32, "icon_32x32.png"),
  (64, "icon_32x32@2x.png"),
  (128, "icon_128x128.png"),
  (256, "icon_128x128@2x.png"),
  (256, "icon_256x256.png"),
  (512, "icon_256x256@2x.png"),
  (512, "icon_512x512.png"),
  (1024, "icon_512x512@2x.png"),
]
for (size, name) in iconset {
  write(appIcon(size), "icon.iconset/\(name)")
}
let icns = icons.appendingPathComponent("icon.icns")
let proc = Process()
proc.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
proc.arguments = ["-c", "icns", "-o", icns.path, set.path]
try! proc.run()
proc.waitUntilExit()
if proc.terminationStatus != 0 {
  fputs("iconutil failed\n", stderr)
  exit(1)
}
try? FileManager.default.removeItem(at: set)
fputs("wrote icon.icns\n", stderr)
