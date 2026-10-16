import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.tintColor = .cantusTint // le thème clair/sombre suit ensuite celui choisi dans l'app
        window.rootViewController = MainController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

extension UIColor {
    // Palette de la maquette Figma (voir skin.css) : vert profond, fond crème / forêt de nuit.
    static let cantusTint = UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 134/255, green: 196/255, blue: 162/255, alpha: 1)
        : UIColor(red: 49/255, green: 94/255, blue: 76/255, alpha: 1) }
    static let cantusBackground = UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 14/255, green: 19/255, blue: 16/255, alpha: 1)
        : UIColor(red: 247/255, green: 247/255, blue: 242/255, alpha: 1) }
}

/// Un onglet. Tous partagent le même WKWebView, déplacé dans l'onglet affiché.
final class PageController: UIViewController {
    let key: String
    let pageTitle: String

    init(key: String, title: String) {
        self.key = key
        self.pageTitle = title
        super.init(nibName: nil, bundle: nil)
        navigationItem.largeTitleDisplayMode = .never
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .cantusBackground
    }
}

/// L'app est la PWA de cantus-app.fr dans un WKWebView : même code, même dépôt GitHub, mêmes
/// mises à jour (version.json), mode Live compatible. Le natif fournit la barre d'onglets et les
/// barres de navigation Liquid Glass, l'habillage iOS (skin.css), l'haptique, l'écran allumé,
/// les téléchargements et un écran hors-ligne au premier lancement.
final class MainController: UITabBarController, UITabBarControllerDelegate, WKNavigationDelegate, WKUIDelegate,
                            WKScriptMessageHandler, WKDownloadDelegate {
    static let home = URL(string: "https://cantus-app.fr/")!
    static let tabs = [
        (key: "library", title: "Bibliothèque", symbol: "book"),
        (key: "playlist", title: "Playlists", symbol: "list.bullet"),
        (key: "planner", title: "Messes", symbol: "calendar"),
        (key: "favorites", title: "Favoris", symbol: "heart"),
        (key: "live", title: "Live", symbol: "dot.radiowaves.left.and.right"),
    ]

    private var webView: WKWebView!
    private var pages: [PageController] = []
    private let lightTap = UIImpactFeedbackGenerator(style: .light)
    private let mediumTap = UIImpactFeedbackGenerator(style: .medium)
    private let selection = UISelectionFeedbackGenerator()
    private let success = UINotificationFeedbackGenerator()
    private var downloads: [WKDownload: URL] = [:]
    private var offsetObservation: NSKeyValueObservation?
    private lazy var offlineView = makeOfflineView()

    private var overlayOpen = false
    private var immersive = false
    private var titleShown = false
    private var isAdmin = false
    private var isOffline = false
    private var lastInsets = UIEdgeInsets(top: -1, left: 0, bottom: -1, right: 0)

    private var page: PageController { pages[selectedIndex] }

    override var childForStatusBarHidden: UIViewController? { nil }
    override var childForStatusBarStyle: UIViewController? { nil }
    override var prefersStatusBarHidden: Bool { immersive }
    override var prefersHomeIndicatorAutoHidden: Bool { immersive }

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        view.backgroundColor = .cantusBackground
        setUpWebView()

        pages = Self.tabs.map { PageController(key: $0.key, title: $0.title) }
        viewControllers = zip(pages, Self.tabs).map { page, tab in
            let nav = UINavigationController(rootViewController: page)
            nav.tabBarItem = UITabBarItem(title: tab.title, image: UIImage(systemName: tab.symbol), tag: 0)
            return nav
        }
        attachWebView()
        updateBarItems()

        lightTap.prepare()
        webView.load(URLRequest(url: Self.home))
    }

    private func setUpWebView() {
        let config = WKWebViewConfiguration()
        config.limitsNavigationsToAppBoundDomains = true // requis pour le service worker (hors-ligne)
        config.websiteDataStore = .default()             // cache persistant (PDF, paroles, réglages)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "Mobile/15E148 CantusApp"

        let content = config.userContentController
        if let url = Bundle.main.url(forResource: "skin", withExtension: "css"),
           let skin = try? String(contentsOf: url, encoding: .utf8),
           case let css = Self.fontFaces() + skin,
           let json = try? JSONSerialization.data(withJSONObject: css, options: .fragmentsAllowed),
           let literal = String(data: json, encoding: .utf8) {
            content.addUserScript(WKUserScript(source: "window.__cantusCSS = \(literal);",
                                               injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
           let js = try? String(contentsOf: url, encoding: .utf8) {
            content.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if let tab = UserDefaults.standard.string(forKey: "CantusTab") { // CI : onglet de départ imposé
            content.addUserScript(WKUserScript(source: "window.__cantusTab = '\(tab)';",
                                               injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // ponytail: le contrôleur vit autant que l'app, la référence forte du handler est sans conséquence.
        content.add(self, name: "cantus")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .cantusBackground
        webView.scrollView.backgroundColor = .cantusBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never // insets passés à la page (--ios-top/bottom)
        webView.scrollView.keyboardDismissMode = .interactive
        webView.allowsLinkPreview = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.alpha = 0 // révélé en fondu une fois la page prête : pas de flash au démarrage
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        offsetObservation = webView.scrollView.observe(\.contentOffset, options: .new) { [weak self] scroll, _ in
            self?.setTitleShown(scroll.contentOffset.y > 44, animated: true)
        }
    }

    // MARK: Onglets et barres natives

    /// Place l'unique WKWebView sous les barres de l'onglet affiché.
    private func attachWebView() {
        let page = self.page
        guard webView.superview !== page.view else { return }
        page.loadViewIfNeeded()
        webView.frame = page.view.bounds
        page.view.insertSubview(webView, at: 0)
        page.setContentScrollView(webView.scrollView, for: .all)
        setTitleShown(webView.scrollView.contentOffset.y > 44, animated: false)
    }

    func tabBarController(_ controller: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        if viewController === selectedViewController { // second appui : remonter en haut, comme partout sur iOS
            webView.scrollView.setContentOffset(.zero, animated: true)
        }
        return true
    }

    func tabBarController(_ controller: UITabBarController, didSelect viewController: UIViewController) {
        selection.selectionChanged()
        attachWebView()
        js("showView('\(page.key)', 'native')")
    }

    private func showTab(for view: String) {
        let key = view == "history" ? "favorites" : view
        guard let index = Self.tabs.firstIndex(where: { $0.key == key }), index != selectedIndex else { return }
        selectedIndex = index
        attachWebView()
    }

    private func updateBarItems() {
        for page in pages {
            var right = [UIBarButtonItem(image: UIImage(systemName: "gearshape"), primaryAction: UIAction { [weak self] _ in
                self?.js("openSettings()")
            })]
            if isAdmin {
                right.append(UIBarButtonItem(image: UIImage(systemName: "square.grid.2x2"), primaryAction: UIAction { [weak self] _ in
                    self?.js("openAdminDashboard()")
                }))
            }
            page.navigationItem.rightBarButtonItems = right
            page.navigationItem.leftBarButtonItem = isOffline
                ? UIBarButtonItem(image: UIImage(systemName: "icloud.slash"), primaryAction: UIAction { [weak self] _ in
                    self?.js("showToast('Hors-ligne : les partitions téléchargées restent disponibles')")
                })
                : nil
        }
    }

    /// Polices de la maquette (Newsreader, DM Sans) embarquées dans l'app : disponibles hors-ligne.
    private static func fontFaces() -> String {
        [("Newsreader", "Newsreader"), ("DM Sans", "DMSans")].compactMap { family, file in
            guard let url = Bundle.main.url(forResource: file, withExtension: "woff2"),
                  let data = try? Data(contentsOf: url) else { return nil }
            return "@font-face{font-family:'\(family)';font-weight:400 700;font-display:block;" +
                   "src:url(data:font/woff2;base64,\(data.base64EncodedString())) format('woff2')}"
        }.joined()
    }

    /// Le grand titre est dans la page ; le titre de la barre apparaît quand il passe dessous.
    private func setTitleShown(_ shown: Bool, animated: Bool) {
        guard shown != titleShown || !animated else { return }
        titleShown = shown
        let page = self.page
        let apply = { page.navigationItem.title = shown ? page.pageTitle : nil }
        guard animated, let bar = page.navigationController?.navigationBar else { return apply() }
        UIView.transition(with: bar, duration: 0.2, options: .transitionCrossDissolve, animations: apply)
    }

    /// Hauteur des barres (verre) transmise à la page, qui défile dessous.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        pushInsets()
    }

    private func pushInsets(force: Bool = false) {
        guard !overlayOpen, let bar = page.navigationController?.navigationBar, !bar.isHidden else { return }
        let top = bar.convert(bar.bounds, to: view).maxY
        let bottom = tabBar.frame.minY > view.bounds.midY ? view.bounds.height - tabBar.frame.minY : view.safeAreaInsets.bottom
        let insets = UIEdgeInsets(top: top, left: 0, bottom: bottom, right: 0)
        guard force || insets != lastInsets else { return }
        lastInsets = insets
        js("document.documentElement.style.setProperty('--ios-top','\(top)px');" +
           "document.documentElement.style.setProperty('--ios-bottom','\(bottom)px')")
    }

    /// Visionneuse, feuilles et modales de la page couvrent tout l'écran : on retire les barres.
    private func setOverlay(_ open: Bool, immersive: Bool) {
        if immersive != self.immersive {
            self.immersive = immersive
            UIView.animate(withDuration: 0.25) {
                self.setNeedsStatusBarAppearanceUpdate()
                self.setNeedsUpdateOfHomeIndicatorAutoHidden()
            }
        }
        guard open != overlayOpen else { return }
        overlayOpen = open
        webView.scrollView.isScrollEnabled = !open
        page.navigationController?.setNavigationBarHidden(open, animated: true)
        if #available(iOS 18.0, *) {
            setTabBarHidden(open, animated: true)
        } else {
            UIView.transition(with: tabBar, duration: 0.25, options: .transitionCrossDissolve) { self.tabBar.isHidden = open }
        }
    }

    private func js(_ source: String) {
        webView.evaluateJavaScript(source)
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
        case "view":
            if let v = body["view"] as? String { showTab(for: v) }
        case "overlay":
            setOverlay(body["open"] as? Bool ?? false, immersive: body["immersive"] as? Bool ?? false)
        case "theme":
            let style: UIUserInterfaceStyle = body["dark"] as? Bool == false ? .light : .dark
            guard let window = view.window, window.overrideUserInterfaceStyle != style else { return }
            UIView.transition(with: window, duration: 0.3, options: .transitionCrossDissolve) {
                window.overrideUserInterfaceStyle = style
            }
        case "chrome":
            let admin = body["admin"] as? Bool ?? false
            let offline = (body["status"] as? String ?? "").lowercased().contains("hors")
            guard admin != isAdmin || offline != isOffline else { return }
            isAdmin = admin
            isOffline = offline
            updateBarItems()
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
        pushInsets(force: true)
        if let script = UserDefaults.standard.string(forKey: "CantusEval") { js(script) } // CI uniquement
        guard webView.alpha == 0 else { return }
        UIView.animate(withDuration: 0.35, delay: 0.05, options: .curveEaseOut) { webView.alpha = 1 }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // Le service worker sert la page hors-ligne dès le 2e lancement ; on n'arrive ici que si
        // l'app n'a encore jamais pu charger Cantus (premier lancement sans réseau).
        if webView.alpha == 0 { showOffline() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload() // iOS a tué le moteur web (mémoire) : on recharge
    }

    // alert() / confirm() / prompt() de la page → alertes iOS natives (sans ça WKWebView les ignore :
    // confirm() renverrait toujours false et aucune suppression ne passerait).
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presentDialog(alert, orElse: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Annuler", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presentDialog(alert) { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText; $0.clearButtonMode = .whileEditing }
        alert.addAction(UIAlertAction(title: "Annuler", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        presentDialog(alert) { completionHandler(nil) }
    }

    /// Le gestionnaire doit toujours être rappelé, même si une autre fenêtre est déjà affichée.
    private func presentDialog(_ alert: UIAlertController, orElse fallback: @escaping () -> Void) {
        guard presentedViewController == nil else { return fallback() }
        selection.selectionChanged()
        present(alert, animated: true)
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
        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.contentMode = .scaleAspectFit
        logo.heightAnchor.constraint(equalToConstant: 96).isActive = true

        let label = UILabel()
        label.text = "Pas de connexion.\nCantus doit être ouvert une première fois en ligne, ensuite tout fonctionne hors-ligne."
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .secondaryLabel
        label.font = .preferredFont(forTextStyle: .body)

        var button = UIButton.Configuration.glassIfAvailable()
        button.title = "Réessayer"
        button.cornerStyle = .capsule
        button.buttonSize = .large
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
        container.backgroundColor = .cantusBackground
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: container.layoutMarginsGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: container.layoutMarginsGuide.trailingAnchor, constant: -16),
        ])
        return container
    }
}

private extension UIButton.Configuration {
    /// Bouton Liquid Glass sur iOS 26, bouton plein doré avant.
    static func glassIfAvailable() -> UIButton.Configuration {
        if #available(iOS 26.0, *) { return .prominentGlass() }
        return .filled()
    }
}
