// Gera os ícones do app: resources/tray/iconTemplate(@2x).png e build/icon.icns.
// Uso: swift scripts/make-icons.swift   (na pasta golive-gui-mac)
// A rosa vem da GUI Windows (golive-gui/build/icon.png) para manter a mesma marca.
import AppKit

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let roseURL = root.appendingPathComponent("../golive-gui/build/icon.png").standardizedFileURL
guard let roseImage = NSImage(contentsOf: roseURL),
      let rose = roseImage.cgImage(forProposedRect: nil, context: nil, hints: nil)
else { fatalError("rosa não encontrada em \(roseURL.path)") }

func png(_ size: Int, _ draw: (CGContext, CGFloat) -> Void) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                             bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let c = NSGraphicsContext.current!.cgContext
  c.interpolationQuality = .high
  draw(c, CGFloat(size))
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

// Pinta a silhueta da rosa (alfa da imagem) com uma cor sólida.
func roseGlyph(_ c: CGContext, in rect: CGRect, color: CGColor) {
  c.saveGState()
  c.clip(to: rect, mask: rose)
  c.setFillColor(color)
  c.fill(rect)
  c.restoreGState()
}

// Barra de menu: template preto, o macOS inverte conforme o tema.
let tray = root.appendingPathComponent("resources/tray")
try FileManager.default.createDirectory(at: tray, withIntermediateDirectories: true)
for (name, size) in [("iconTemplate.png", 18), ("iconTemplate@2x.png", 36)] {
  try png(size) { c, s in
    roseGlyph(c, in: CGRect(x: 0, y: 0, width: s, height: s), color: CGColor(gray: 0, alpha: 1))
  }.write(to: tray.appendingPathComponent(name))
}

// Dock: quadrado arredondado no grid de ícones do macOS, fundo grafite com brilho rosa.
func appIcon(_ c: CGContext, _ s: CGFloat) {
  let space = CGColorSpaceCreateDeviceRGB()
  let m = s * 0.1, box = CGRect(x: m, y: m, width: s - 2 * m, height: s - 2 * m)
  let shape = CGPath(roundedRect: box, cornerWidth: box.width * 0.225, cornerHeight: box.width * 0.225, transform: nil)

  c.saveGState()
  c.setShadow(offset: CGSize(width: 0, height: -s * 0.012), blur: s * 0.03, color: CGColor(gray: 0, alpha: 0.35))
  c.addPath(shape); c.setFillColor(CGColor(gray: 0.1, alpha: 1)); c.fillPath()
  c.restoreGState()

  c.saveGState()
  c.addPath(shape); c.clip()
  let bg = CGGradient(colorsSpace: space, colors: [
    CGColor(red: 0.19, green: 0.17, blue: 0.22, alpha: 1), CGColor(red: 0.07, green: 0.06, blue: 0.09, alpha: 1),
  ] as CFArray, locations: [0, 1])!
  c.drawLinearGradient(bg, start: CGPoint(x: box.midX, y: box.maxY), end: CGPoint(x: box.midX, y: box.minY), options: [])
  let glow = CGGradient(colorsSpace: space, colors: [
    CGColor(red: 0.98, green: 0.30, blue: 0.42, alpha: 0.55), CGColor(red: 0.98, green: 0.30, blue: 0.42, alpha: 0),
  ] as CFArray, locations: [0, 1])!
  let center = CGPoint(x: box.midX, y: box.midY - box.height * 0.04)
  c.drawRadialGradient(glow, startCenter: center, startRadius: 0, endCenter: center, endRadius: box.width * 0.55, options: [])
  // Borda interna sutil, como nos ícones do sistema.
  c.addPath(shape); c.setStrokeColor(CGColor(gray: 1, alpha: 0.08)); c.setLineWidth(s * 0.006); c.strokePath()
  c.restoreGState()

  let g = box.width * 0.68
  let rect = CGRect(x: box.midX - g / 2, y: box.midY - g / 2, width: g, height: g)
  c.saveGState()
  c.setShadow(offset: CGSize(width: 0, height: -s * 0.006), blur: s * 0.02, color: CGColor(gray: 0, alpha: 0.5))
  c.beginTransparencyLayer(auxiliaryInfo: nil)
  roseGlyph(c, in: rect, color: CGColor(gray: 1, alpha: 1))
  c.endTransparencyLayer()
  c.restoreGState()
}

let iconset = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("GoLiveBypass.iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let suffix = scale == 2 ? "@2x" : ""
    try png(base * scale, appIcon).write(to: iconset.appendingPathComponent("icon_\(base)x\(base)\(suffix).png"))
  }
}
let build = root.appendingPathComponent("build")
try FileManager.default.createDirectory(at: build, withIntermediateDirectories: true)
let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", iconset.path, "-o", build.appendingPathComponent("icon.icns").path]
try p.run(); p.waitUntilExit()
guard p.terminationStatus == 0 else { fatalError("iconutil falhou") }
print("ícones gerados")
