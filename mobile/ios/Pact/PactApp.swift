import SwiftUI
import WebKit
import UIKit

@main
struct PactApp: App {
    var body: some Scene { WindowGroup { PactHome() } }
}
struct PactHome: View {
    @State private var reloadID = UUID()
    @State private var reset = false
    @State private var about = false
    var body: some View {
        NavigationStack {
            PactWebView().id(reloadID)
                .navigationTitle("Escrow Global · Demo").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("About") { about = true } }
                    ToolbarItem(placement: .topBarTrailing) { Button("Reset") { reset = true } }
                }
                .alert("Reset local demo data?", isPresented: $reset) {
                    Button("Cancel", role: .cancel) {}
                    Button("Reset", role: .destructive) {
                        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { reloadID = UUID() }
                    }
                } message: { Text("This clears local demo deals and messages. It does not transfer real funds.") }
                .sheet(isPresented: $about) {
                    NavigationStack {
                        VStack(alignment: .leading, spacing: 20) {
                            Text("A marketplace you can explore.").font(.largeTitle)
                            Text("Escrow Global’s native template is an offline demonstration. Listings and balances are fictional. Real escrow, wallet signing, swaps and card purchases are not enabled.")
                            Text("Data stays in this app’s local WebKit storage. Do not enter personal documents, private keys or customer information. External reference links open in your system browser.")
                            Text("A production build requires security, financial, privacy and App Store review. This template is not an approved financial service.").font(.footnote)
                            Spacer()
                        }.padding(28).toolbar { Button("Done") { about = false } }
                    }
                }
        }
    }
}
struct PactWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.userContentController.addUserScript(WKUserScript(source: "window.PACT_NATIVE=true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        if let file = Bundle.main.url(forResource: "index", withExtension: "html") {
            view.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
        }
        return view
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let approved: Set<String> = ["jup.ag", "docs.jup.ag", "developers.jup.ag", "dev.moonpay.com", "solana.com", "docs.solanapay.com", "developers.circle.com", "tether.to", "transak.com", "docs.transak.com", "apps.apple.com", "play.google.com"]
        func external(_ url: URL) {
            guard url.scheme == "https", let host = url.host, approved.contains(host), url.user == nil, url.password == nil, url.port == nil || url.port == 443 else { return }
            UIApplication.shared.open(url)
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if url.isFileURL && url.lastPathComponent == "index.html" { decisionHandler(.allow); return }
            if action.navigationType == .linkActivated { external(url) }
            decisionHandler(.cancel)
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url, action.navigationType == .linkActivated { external(url) }
            return nil
        }
    }
}
