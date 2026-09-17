package app.pact.demo;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

/** Offline mobile review template. No signing bridge, no seeds, no live escrow. */
public final class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private static final int CHOOSE_FILE = 41;
    private static final String START = "file:///android_asset/index.html";
    private static final Set<String> DOC_HOSTS = new HashSet<>(Arrays.asList(
        "jup.ag", "docs.jup.ag", "developers.jup.ag", "dev.moonpay.com",
        "solana.com", "docs.solanapay.com", "developers.circle.com", "tether.to",
        "transak.com", "docs.transak.com", "apps.apple.com", "play.google.com"
    ));
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xfff7fafc);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout toolbar = new LinearLayout(this);
        Button back = new Button(this); back.setText("Back"); back.setOnClickListener(v -> { if (web.canGoBack()) web.goBack(); });
        TextView title = new TextView(this); title.setText("Escrow Global · Demo"); title.setTextSize(15); title.setGravity(17);
        Button reset = new Button(this); reset.setText("Reset"); reset.setOnClickListener(v -> new AlertDialog.Builder(this)
            .setTitle("Reset this device’s demo?").setMessage("This clears local demo deals and messages. It never moves real funds.")
            .setNegativeButton("Cancel", null).setPositiveButton("Reset", (d,w) -> web.evaluateJavascript("localStorage.clear();location.reload();", null)).show());
        toolbar.addView(back); toolbar.addView(title, new LinearLayout.LayoutParams(0, -1, 1)); toolbar.addView(reset);
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(true); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) { return navigate(req.getUrl()); }
            @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) { handler.cancel(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean userGesture, android.os.Message result) {
                if (!userGesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) { navigate(req.getUrl()); v.destroy(); return true; }
                });
                ((WebView.WebViewTransport)result.obj).setWebView(popup); result.sendToTarget(); return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try { startActivityForResult(intent, CHOOSE_FILE); } catch (Exception ex) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(root);
        web.loadUrl(START);
    }
    private boolean navigate(Uri uri) {
        if ("file".equals(uri.getScheme()) && "/android_asset/index.html".equals(uri.getPath())) return false;
        if ("https".equals(uri.getScheme()) && DOC_HOSTS.contains(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ex) { Toast.makeText(this, "No browser available.", Toast.LENGTH_LONG).show(); }
        } else Toast.makeText(this, "External payment or unsupported navigation is disabled in this demo template.", Toast.LENGTH_LONG).show();
        return true;
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == CHOOSE_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null);
            fileCallback = null;
        }
    }
    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (fileCallback != null) fileCallback.onReceiveValue(null); if (web != null) web.destroy(); super.onDestroy(); }
}
