import AppKit
import WebKit

let arguments = CommandLine.arguments
guard arguments.count == 5 else {
	FileHandle.standardError.write(Data("usage: harness <url> <init.js> <drive.js> <out.json>\n".utf8))
	exit(2)
}
let target = URL(string: arguments[1])!
let initScript = try! String(contentsOfFile: arguments[2], encoding: .utf8)
let driveScript = try! String(contentsOfFile: arguments[3], encoding: .utf8)
let outPath = arguments[4]

func finish(_ text: String, code: Int32) -> Never {
	try! text.write(toFile: outPath, atomically: true, encoding: .utf8)
	exit(code)
}

final class Runner: NSObject, NSApplicationDelegate, WKNavigationDelegate {
	var window: NSWindow!
	var webView: WKWebView!
	var started = false

	func applicationDidFinishLaunching(_ notification: Notification) {
		let configuration = WKWebViewConfiguration()
		configuration.preferences.inactiveSchedulingPolicy = .none
		configuration.websiteDataStore = .nonPersistent()
		configuration.userContentController.addUserScript(
			WKUserScript(source: initScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
		let frame = NSRect(x: 40, y: 40, width: 1280, height: 720)
		webView = WKWebView(frame: frame, configuration: configuration)
		webView.navigationDelegate = self
		window = NSWindow(
			contentRect: frame, styleMask: [.titled], backing: .buffered, defer: false)
		window.level = .floating
		window.contentView = webView
		window.makeKeyAndOrderFront(nil)
		NSApp.setActivationPolicy(.regular)
		NSApp.activate(ignoringOtherApps: true)
		webView.load(URLRequest(url: target))
		DispatchQueue.main.asyncAfter(deadline: .now() + 150) {
			finish("{\"error\":\"harness timeout\"}", code: 3)
		}
	}

	func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
		if started { return }
		started = true
		webView.callAsyncJavaScript(
			"return await \(driveScript);", arguments: [:], in: nil, in: .page
		) { result in
			switch result {
			case .success(let value): finish("\(value ?? "null")", code: 0)
			case .failure(let error):
				let message = "\(error)".replacingOccurrences(of: "\"", with: "'")
				finish("{\"error\":\"\(message)\"}", code: 4)
			}
		}
	}
}

let app = NSApplication.shared
let runner = Runner()
app.delegate = runner
app.run()
