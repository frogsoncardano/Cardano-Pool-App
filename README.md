# Frog Labs App

Quick test (no install): paste App.js into snack.expo.dev.

APK (built in the cloud with GitHub Actions - nothing to install on your computer):
1. Upload all files in this folder to your GitHub repo (incl. .github/workflows/build-apk.yml).
2. Actions > Build Android APK > Run workflow (10-15 min).
3. Download the artifact "frog-labs-apk" and install the APK on your phone.

Widgets (long-press home screen > Widgets > Frog Labs):
  Frog Labs Pool (big), Frog Labs Pool Mini (1x1), Frog Labs ADA / NIGHT / BTC (1x1 price widgets).
  Tap a small widget to refresh it. If a widget ever looks blank, open the app once: it repaints all widgets.
To show a different pool on the pool widgets: Explore > open a pool > "Use for widget", then tap the widget.

Alerts (Alerts tab): new governance proposals, blocks minted by saved pools, pool changes, staking rewards, big price moves.
They run every minute while the app is open, and in the background roughly every 15+ minutes (Android decides; battery savers
can delay). On Xiaomi/MIUI set Frog Labs to "No restrictions" in battery settings and allow autostart.
Tools in Explore: rewards calculator and pool comparison.
