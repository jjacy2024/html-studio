import AppKit
import Foundation
import Darwin

// A small native app host; the editor still opens in the user's browser.
final class ConnectorJob {
    let process = Process()
    let output = Pipe()
    var buffer = Data()
    var ready = false
    var reportedError = false
}

final class EditorLauncher: NSObject, NSApplicationDelegate {
    private let arguments = CommandLine.arguments
    private var jobs: [ConnectorJob] = []
    private var ownedJob: ConnectorJob?
    private var statusItem: NSStatusItem?
    private var statusLabel: NSMenuItem?
    private var window: NSWindow?
    private var windowStatus: NSTextField?
    private var signalSources: [DispatchSourceSignal] = []
    private var quitting = false
    private var opening = false
    private var readyCount = 0
    private var status = "正在启动本地编辑器…"

    private var editorRoot: URL { Bundle.main.resourceURL!.appendingPathComponent("Editor", isDirectory: true) }
    private var diagnostic: Bool { arguments.contains("--diagnostic-no-alerts") }
    private func option(_ name: String) -> String? {
        guard let i = arguments.firstIndex(of: name), i + 1 < arguments.count else { return nil }
        return arguments[i + 1]
    }
    private func event(_ name: String, _ fields: [String: Any] = [:]) {
        // Opt-in diagnostics never contain pairing URLs, tokens, or document data.
        guard let file = option("--diagnostic-events") else { return }
        var value = fields; value["event"] = name; value["pid"] = ProcessInfo.processInfo.processIdentifier
        guard var data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        data.append(10)
        if !FileManager.default.fileExists(atPath: file) { FileManager.default.createFile(atPath: file, contents: nil, attributes: [.posixPermissions: 0o600]) }
        if let handle = FileHandle(forWritingAtPath: file) { handle.seekToEndOfFile(); handle.write(data); try? handle.close() }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenus()
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }; source.resume(); signalSources.append(source)
        }
        event("launched")
        openEditor(nil)
    }
    private func menuItem(_ title: String, _ action: Selector, _ key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key); item.target = self; return item
    }
    private func buildMenus() {
        let menu = NSMenu(), appItem = NSMenuItem(), submenu = NSMenu()
        submenu.addItem(menuItem("打开编辑器", #selector(openEditor(_:)), "o"))
        submenu.addItem(menuItem("应用状态", #selector(showStatus(_:))))
        submenu.addItem(menuItem("使用指南", #selector(openGuide(_:))))
        submenu.addItem(menuItem("打开导出文件夹", #selector(openExports(_:))))
        submenu.addItem(.separator()); submenu.addItem(menuItem("退出 html全能编辑器", #selector(quit(_:)), "q"))
        appItem.submenu = submenu; menu.addItem(appItem); NSApp.mainMenu = menu

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let image = NSImage(named: NSImage.Name("AppIcon")) ?? NSApp.applicationIconImage
        let small = image?.copy() as? NSImage; small?.size = NSSize(width: 18, height: 18)
        item.button?.image = small; item.button?.toolTip = "html全能编辑器"
        let tray = NSMenu(), label = NSMenuItem(title: status, action: nil, keyEquivalent: "")
        tray.addItem(label); tray.addItem(.separator())
        tray.addItem(menuItem("打开编辑器", #selector(openEditor(_:))))
        tray.addItem(menuItem("应用状态", #selector(showStatus(_:))))
        tray.addItem(menuItem("使用指南", #selector(openGuide(_:))))
        tray.addItem(menuItem("打开导出文件夹", #selector(openExports(_:))))
        tray.addItem(.separator()); tray.addItem(menuItem("退出 html全能编辑器", #selector(quit(_:))))
        item.menu = tray; statusItem = item; statusLabel = label
    }
    private func setStatus(_ text: String) { status = text; statusLabel?.title = text; windowStatus?.stringValue = text }

    @objc func openEditor(_ sender: Any?) {
        guard !quitting && !opening else { return }; opening = true
        let job = ConnectorJob(), node = editorRoot.appendingPathComponent("runtime/node")
        guard FileManager.default.isExecutableFile(atPath: node.path) else { opening = false; fail("应用文件不完整，请重新完整解压安装包。", fatal: ownedJob == nil); return }
        job.process.executableURL = node
        var args = [editorRoot.appendingPathComponent("connector/connector.cjs").path, "serve", "--root", editorRoot.path, "--app-host", "--no-open", "--parent-pid", String(ProcessInfo.processInfo.processIdentifier)]
        for name in ["--state-dir", "--port", "--export-dir"] { if let value = option(name) { args += [name, value] } }
        job.process.arguments = args
        job.process.currentDirectoryURL = editorRoot
        job.process.standardOutput = job.output
        job.process.standardError = FileHandle.nullDevice
        job.process.standardInput = FileHandle.nullDevice
        do { try job.process.run() }
        catch { opening = false; fail("无法启动内置运行环境：\(error.localizedDescription)", fatal: ownedJob == nil); return }
        jobs.append(job)
        // One reader preserves protocol-event ordering before handling process exit.
        DispatchQueue.global(qos: .userInitiated).async {
            while true {
                let data = job.output.fileHandleForReading.availableData
                if data.isEmpty { break }
                DispatchQueue.main.async { self.consume(data, from: job) }
            }
            job.process.waitUntilExit()
            DispatchQueue.main.async { self.exited(job) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
            if !job.ready && self.jobs.contains(where: { $0 === job }) && !self.quitting {
                job.reportedError = true; self.opening = false
                if job.process.isRunning { job.process.terminate() }
                self.fail("启动超时，请退出旧版应用或关闭旧版启动窗口后重试。", fatal: self.ownedJob == nil)
            }
        }
    }
    private func consume(_ data: Data, from job: ConnectorJob) {
        guard !quitting else { return }; job.buffer.append(data)
        guard job.buffer.count < 131072 else { job.reportedError = true; if job.process.isRunning { job.process.terminate() }; fail("连接器返回了无效响应，请重新打开应用。", fatal: ownedJob == nil); return }
        while let end = job.buffer.firstIndex(of: 10) {
            let line = job.buffer.prefix(upTo: end); job.buffer.removeSubrange(...end)
            guard let value = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any], let type = value["type"] as? String else { continue }
            if type == "error" {
                job.reportedError = true; opening = false
                fail(value["message"] as? String ?? "启动失败，请重新打开应用。", fatal: ownedJob == nil)
            } else if type == "ready", !job.ready, let text = value["url"] as? String,
                      let url = URL(string: text), url.scheme == "http", url.host == "127.0.0.1", url.port != nil {
                job.ready = true; opening = false
                let owns = value["ownsServer"] as? Bool == true
                if owns { ownedJob = job }
                readyCount += 1; setStatus("编辑器正在运行")
                event("ready", ["ownsServer": owns, "connectorPid": job.process.processIdentifier, "count": readyCount])
                if !arguments.contains("--no-open") {
                    if NSWorkspace.shared.open(url) { event("browser-opened") }
                    else { fail("浏览器未能打开，请从应用菜单再次选择「打开编辑器」。", fatal: false) }
                }
                if arguments.contains("--diagnostic-reopen") && readyCount == 1 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.openEditor(nil) }
                }
            }
        }
    }
    private func exited(_ job: ConnectorJob) {
        jobs.removeAll { $0 === job }
        guard !quitting else { return }
        if ownedJob === job { ownedJob = nil; setStatus("本地连接已停止"); event("connector-stopped") }
        if !job.ready { opening = false }
        if !job.reportedError && (job.process.terminationStatus != 0 || !job.ready) {
            fail("本地连接器已停止。请重新打开应用；如果旧版仍在运行，请先退出旧版。", fatal: !job.ready && ownedJob == nil)
        }
    }
    private func fail(_ message: String, fatal: Bool) {
        setStatus("连接未启动"); event("error", ["message": message])
        if !diagnostic {
            NSApp.activate(ignoringOtherApps: true)
            let alert = NSAlert(); alert.messageText = "html全能编辑器"; alert.informativeText = message; alert.alertStyle = .warning
            alert.addButton(withTitle: "知道了"); alert.runModal()
        }
        if fatal { NSApp.terminate(nil) }
    }
    @objc func showStatus(_ sender: Any?) {
        if window == nil {
            let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 280), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
            panel.title = "html全能编辑器"; panel.isReleasedWhenClosed = false
            let icon = NSImageView(frame: NSRect(x: 186, y: 188, width: 68, height: 68)); icon.image = NSApp.applicationIconImage; panel.contentView?.addSubview(icon)
            let label = NSTextField(labelWithString: status); label.alignment = .center; label.font = .systemFont(ofSize: 17, weight: .semibold); label.frame = NSRect(x: 24, y: 150, width: 392, height: 26); panel.contentView?.addSubview(label); windowStatus = label
            let hint = NSTextField(wrappingLabelWithString: "编辑操作在浏览器中完成。\n关闭此窗口不会停止连接；退出应用会断开 AI 连接。"); hint.alignment = .center; hint.textColor = .secondaryLabelColor; hint.frame = NSRect(x: 24, y: 86, width: 392, height: 50); panel.contentView?.addSubview(hint)
            let button = NSButton(title: "打开编辑器", target: self, action: #selector(openEditor(_:))); button.bezelStyle = .rounded; button.keyEquivalent = "\r"; button.frame = NSRect(x: 150, y: 32, width: 140, height: 34); panel.contentView?.addSubview(button)
            panel.center(); window = panel
        }
        NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil)
    }
    @objc func openGuide(_ sender: Any?) { NSWorkspace.shared.open(editorRoot.appendingPathComponent("02-Agent连接指南.html")) }
    @objc func openExports(_ sender: Any?) {
        let folder = option("--export-dir").map { URL(fileURLWithPath: $0) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads/html全能编辑器导出")
        do { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true); NSWorkspace.shared.open(folder) }
        catch { fail("无法打开导出文件夹：\(error.localizedDescription)", fatal: false) }
    }
    @objc func quit(_ sender: Any?) { NSApp.terminate(nil) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { openEditor(nil); return false }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitting { return .terminateNow }; quitting = true; event("quitting")
        // Only terminate processes launched by this app. A reused connector is not
        // killed; its short-lived opener has already exited.
        let running = jobs.filter { $0.process.isRunning }
        if running.isEmpty { return .terminateNow }
        for job in running { job.process.terminate() }
        DispatchQueue.global().async {
            let deadline = Date().addingTimeInterval(4)
            while Date() < deadline && running.contains(where: { $0.process.isRunning }) { Thread.sleep(forTimeInterval: 0.05) }
            for job in running where job.process.isRunning { kill(job.process.processIdentifier, SIGKILL) }
            // terminate: can enter AppKit's nested run loop while a main-queue
            // signal/error callback is still on the stack. A run-loop block can
            // complete termination there without deadlocking that dispatch queue.
            CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue) { NSApp.reply(toApplicationShouldTerminate: true) }
            CFRunLoopWakeUp(CFRunLoopGetMain())
        }
        return .terminateLater
    }
}

let application = NSApplication.shared
let launcher = EditorLauncher()
application.setActivationPolicy(.regular)
application.delegate = launcher
application.run()
