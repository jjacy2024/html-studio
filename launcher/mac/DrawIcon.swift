import AppKit
let size = 1024
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
bitmap.size = NSSize(width: size, height: size)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor.clear.setFill(); NSRect(x: 0, y: 0, width: size, height: size).fill()
let tile = NSBezierPath(roundedRect: NSRect(x: 92, y: 92, width: 840, height: 840), xRadius: 190, yRadius: 190)
NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.18); shadow.shadowBlurRadius = 22; shadow.shadowOffset = NSSize(width: 0, height: -9); shadow.set()
NSColor(calibratedRed: 0.455, green: 0.333, blue: 0.914, alpha: 1).setFill(); tile.fill()
NSGraphicsContext.restoreGraphicsState()
let gradient = NSGradient(starting: NSColor(calibratedRed: 0.52, green: 0.38, blue: 0.98, alpha: 1), ending: NSColor(calibratedRed: 0.36, green: 0.23, blue: 0.80, alpha: 1))!
gradient.draw(in: tile, angle: -90)
let h = NSBezierPath(); h.lineWidth = 90; h.lineCapStyle = .round
h.move(to: NSPoint(x: 340, y: 710)); h.line(to: NSPoint(x: 340, y: 314))
h.move(to: NSPoint(x: 684, y: 710)); h.line(to: NSPoint(x: 684, y: 314))
h.move(to: NSPoint(x: 340, y: 512)); h.line(to: NSPoint(x: 684, y: 512))
NSColor.white.setStroke(); h.stroke()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
