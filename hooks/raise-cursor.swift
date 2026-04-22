import AppKit
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.todesktop.230313mzl4w4u92")
if let app = apps.first {
    app.activate(options: [.activateIgnoringOtherApps, .activateAllWindows])
} else {
    NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/Cursor.app"))
}
