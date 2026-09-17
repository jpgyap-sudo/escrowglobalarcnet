# Escrow Global Settlement — mobile source templates

The two projects package the same offline marketplace demo; they do not point at a public backend. The HTML is generated, not a screenshot. Product/service flows run locally. `PACT_NATIVE=true` disables Jupiter swaps, wallet signing, crypto checkout and payment-QR execution. Official educational links can open in the operating-system browser.

**No APK, AAB or IPA is included. No native device test or full SDK compilation was performed.** Swift syntax parsing passed; that does not type-check UIKit/WebKit or guarantee Xcode build success. Templates require native validation and signing by the operator.

## Rebuild shared assets

From the repository root:

```sh
npm run build:mobile
```

Edit web behavior in `public/` / `src/`, not the generated `assets/index.html`. Rebuild after changes. The local example messages/deals remain on the device’s WebView store; native Reset clears them. Do not store real personal or customer information.

## Android

Project: `mobile/android`. Open that folder in Android Studio. Toolchain declared: AGP 9.3.2, Gradle 9.5.0, JDK 17; compile and target API 36, minimum API 26. Check current tooling requirements when you build.

The repository includes wrapper properties but not the binary wrapper JAR or Gradle distribution. To create the wrapper with an installed Gradle 9.5.0 distribution:

```sh
cd mobile/android
gradle wrapper --gradle-version 9.5.0
./gradlew :app:assembleDebug
```

On Windows, use `bootstrap.cmd` or the generated `gradlew.bat`; on macOS/Linux, `sh bootstrap.sh`. Network access is required to obtain the toolchain and plugins. Set `ANDROID_HOME` / Android Studio’s local SDK path appropriately. `local.properties` must not be committed with machine-specific paths.

Change `applicationId` and `namespace` for your organization, updating the Java package/path and manifest as needed. Run on an emulator and a real device. Use Android Studio’s signed bundle workflow with **your own** securely managed upload key for a release AAB. There is no signing configuration or private key in this package.

The template cancels SSL errors, blocks mixed content, has no JavaScript signing bridge, confines its main page to the bundled asset and opens allowlisted official HTTPS references externally. A file picker supports local evidence selection. Confirm that hashing, back navigation, keyboard insets, storage reset and external navigation behave correctly on all supported API levels.

Official toolchain reference:
https://developer.android.com/build/releases/agp-9-3-0-release-notes

## iOS

Project: `mobile/ios/Pact.xcodeproj`. Open it in Xcode on a Mac with a compatible iOS SDK. Choose the retained technical `Pact` target, replace the placeholder bundle identifier, set your own development team under Signing & Capabilities, then select an iOS 17+ simulator or a registered device and run.

The SwiftUI app hosts a `WKWebView` with bundled HTML. The Xcode project contains the app icon, Info.plist and a draft privacy manifest. About and Reset are native UI. Allowlisted official references open externally. There is no private-key storage or wallet-signing bridge.

For distribution, select a generic device, create an Archive, validate it, and use your organization’s App Store Connect/TestFlight process. Certificates, provisioning profiles, App Store membership and legal/company information are yours to supply. Do not upload the current demo as a finished financial product.

The privacy manifest reflects the intended local-only template and is **not a completed compliance declaration**. Review what the actual SDK/runtime and any added dependencies access or collect. Update reasons, disclosures and policies accordingly. Inspect built resources and console diagnostics in Xcode.

Official release policy reference:
https://developer.apple.com/app-store/review/guidelines/

## Production mobile work remains

Replace switchable identities with real accounts. Choose a reviewed wallet integration, verify associated app/universal links and avoid arbitrary signing bridges. Handle cancellation, resume, network changes, expired sessions and user-readable transaction consent. Add real account deletion/privacy controls, private evidence uploads and support/moderation contact channels. The web marketplace needs backend hardening and custody before a native wrapper can make it a payment app.

Use `docs/MOBILE-RELEASE-CHECKLIST.md` as the release gate. Do not enable hidden functionality after store review or assume external crypto buttons bypass digital-goods payment requirements.
