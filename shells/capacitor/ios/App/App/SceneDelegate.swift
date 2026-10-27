import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = BridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Registers the plugins that live in the app target itself.
class BridgeViewController: CAPBridgeViewController {
    /// Keeps the IRC connections through a quick trip to another app.
    private let grace = BackgroundGrace()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PowerPlugin())
    }
}

/// A grace period in the background. iOS suspends an app a few seconds after
/// it leaves the screen, and the WebView's IRC sockets die with it, so every
/// app switch cost a reconnect. A background task asks iOS for more time
/// (it grants about 30 s): the page keeps running hidden for `seconds`, and a
/// return within them finds its connections where it left them (the page's
/// foreground probe confirms each one with a PING). Ended when the app comes
/// back, when the grace is over, or when iOS says time is up — whichever is
/// first — so a long absence costs at most `seconds` of a hidden page.
///
/// Not yet checked on a device: whether WebKit keeps the WebView's process
/// running for as long as the app holds the task.
final class BackgroundGrace {
    static let seconds: TimeInterval = 25

    private var task: UIBackgroundTaskIdentifier = .invalid
    private var timer: Timer?

    init() {
        let center = NotificationCenter.default
        center.addObserver(
            self,
            selector: #selector(didEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(willEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func didEnterBackground() {
        end()
        task = UIApplication.shared.beginBackgroundTask(withName: "IRC connections") { [weak self] in
            self?.end()
        }

        guard task != .invalid else {
            return
        }

        timer = Timer.scheduledTimer(withTimeInterval: Self.seconds, repeats: false) { [weak self] _ in
            self?.end()
        }
    }

    @objc private func willEnterForeground() {
        end()
    }

    private func end() {
        timer?.invalidate()
        timer = nil

        if task != .invalid {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
    }
}

/// `Power`: Low Power Mode, for the ps scene's Auto (client/js/themeScene.ts).
/// WebKit holds a Safari page to 30 fps in Low Power Mode but not this web
/// view (measured 2026-10-17), so the shell has to say it.
///
/// - `status()`: `{lowPower}`.
/// - event `changed`: the same, whenever it changes.
class PowerPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PowerPlugin"
    let jsName = "Power"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    override func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(powerStateChanged),
            name: .NSProcessInfoPowerStateDidChange,
            object: nil
        )
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled])
    }

    /// Posted on an arbitrary thread.
    @objc private func powerStateChanged() {
        let lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        DispatchQueue.main.async {
            self.notifyListeners("changed", data: ["lowPower": lowPower])
        }
    }
}
