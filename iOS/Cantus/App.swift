import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

/// L'app est la PWA de cantus-app.fr dans un WKWebView natif : même code, même dépôt GitHub,
/// mêmes mises à jour (version.json). Le natif ajoute haptique, barre d'état, zones sûres,
/// maintien de l'écran allumé, téléchargements et un écran hors-ligne au premier lancement.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    static let home = URL(string: "https://cantus-app.fr/")!

    private var webView: WKWebView!
    private let lightTap = UIImpactFeedbackGenerator(style: .light)
    private let mediumTap = UIImpactFeedbackGenerator(style: .medium)
    private let success = UINotificationFeedbackGenerator()
    private var statusStyle: UIStatusBarStyle = .lightContent
    private var downloads: [WKDownload: URL] = [:]
    private lazy var offlineView = makeOfflineView()

    override var preferredStatusBarStyle: UIStatusBarStyle { statusStyle }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.limitsNavigationsToAppBoundDomains = true // requis pour le service worker
        config.websiteDataStore = .default()             // cache persistant (PDF, paroles, réglages)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "Mobile/15E148 CantusApp"
        if let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
           let js = try? String(contentsOf: url, encoding: .utf8) {
            config.userContentController.addUserScript(
                WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // ponytail: le contrôleur vit autant que l'app, la référence forte du handler est sans conséquence.
        config.userContentController.add(self, name: "cantus")

        let bg = UIColor(red: 9/255, green: 9/255, blue: 9/255, alpha: 1)
        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = bg
        webView.scrollView.backgroundColor = bg
        webView.scrollView.contentInsetAdjustmentBehavior = .never // la page gère env(safe-area-inset-*)
        webView.scrollView.bounces = false
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.alpha = 0 // révélé en fondu une fois la page prête : pas de flash blanc au démarrage

        view = UIView()
        view.backgroundColor = bg
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        lightTap.prepare()
        webView.load(URLRequest(url: Self.home))
    }

    // MARK: Pont JavaScript → natif (voir bridge.js)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "tap":
            lightTap.impactOccurred(intensity: 0.7)
            lightTap.prepare()
        case "vibrate":
            let ms = body["ms"] as? Double ?? 10
            if body["pattern"] as? Bool == true { success.notificationOccurred(.success) }
            else if ms > 25 { mediumTap.impactOccurred() }
            else { lightTap.impactOccurred() }
        case "wake":
            UIApplication.shared.isIdleTimerDisabled = body["on"] as? Bool ?? false
        case "theme":
            guard let hex = body["color"] as? String, let color = UIColor(hex: hex) else { return }
            var white: CGFloat = 0
            color.getWhite(&white, alpha: nil)
            statusStyle = white < 0.5 ? .lightContent : .darkContent
            UIView.animate(withDuration: 0.25) {
                self.view.backgroundColor = color
                self.webView.backgroundColor = color
                self.webView.scrollView.backgroundColor = color
                self.setNeedsStatusBarAppearanceUpdate()
            }
        default: break
        }
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if action.shouldPerformDownload { return decisionHandler(.download, preferences) }
        guard let url = action.request.url else { return decisionHandler(.cancel, preferences) }
        let isInternal = url.host == Self.home.host || ["about", "blob", "data"].contains(url.scheme ?? "")
        if isInternal || action.targetFrame?.isMainFrame == false { return decisionHandler(.allow, preferences) }
        UIApplication.shared.open(url) // liens externes, mailto:, tel: → Safari / app concernée
        decisionHandler(.cancel, preferences)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if url.host == Self.home.host { webView.load(action.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offlineView.removeFromSuperview()
        guard webView.alpha == 0 else { return }
        UIView.animate(withDuration: 0.35, delay: 0, options: .curveEaseOut) { webView.alpha = 1 }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // Le service worker sert la page hors-ligne dès le 2e lancement ; on n'arrive ici que si
        // l'app n'a encore jamais pu charger Cantus (premier lancement sans réseau).
        if webView.alpha == 0 { showOffline() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload() // iOS a tué le moteur web (mémoire) : on recharge sans écran blanc
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == Self.home.host ? .grant : .deny)
    }

    // MARK: Téléchargements (export JSON des playlists…) → feuille de partage iOS

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(suggestedFilename)
        try? FileManager.default.removeItem(at: url)
        downloads[download] = url
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloads.removeValue(forKey: download) else { return }
        success.notificationOccurred(.success)
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: download)
    }

    // MARK: Écran hors-ligne natif

    private func showOffline() {
        guard offlineView.superview == nil else { return }
        offlineView.alpha = 0
        offlineView.frame = view.bounds
        offlineView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(offlineView)
        UIView.animate(withDuration: 0.3) { self.offlineView.alpha = 1 }
    }

    private func makeOfflineView() -> UIView {
        let gold = UIColor(red: 195/255, green: 147/255, blue: 106/255, alpha: 1)
        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.contentMode = .scaleAspectFit
        logo.heightAnchor.constraint(equalToConstant: 96).isActive = true

        let label = UILabel()
        label.text = "Pas de connexion.\nCantus doit être ouvert une première fois en ligne, ensuite tout fonctionne hors-ligne."
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = UIColor(white: 0.85, alpha: 1)
        label.font = .preferredFont(forTextStyle: .body)

        var button = UIButton.Configuration.filled()
        button.title = "Réessayer"
        button.baseBackgroundColor = gold
        button.baseForegroundColor = .black
        button.cornerStyle = .capsule
        let retry = UIButton(configuration: button, primaryAction: UIAction { [weak self] _ in
            self?.lightTap.impactOccurred()
            self?.webView.load(URLRequest(url: Self.home))
        })

        let stack = UIStackView(arrangedSubviews: [logo, label, retry])
        stack.axis = .vertical
        stack.spacing = 24
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        let container = UIView()
        container.backgroundColor = view.backgroundColor
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: container.layoutMarginsGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: container.layoutMarginsGuide.trailingAnchor, constant: -16),
        ])
        return container
    }
}

private extension UIColor {
    convenience init?(hex: String) {
        let s = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                  blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}
