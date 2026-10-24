# Frog Labs App

Quick test (no install): paste App.js into snack.expo.dev.

APK builds (cloud, via GitHub Actions) - TWO versions are built on purpose:
  frogs-apk-core     = app only (no widgets)
  frogs-apk-widgets  = app + home-screen widgets
Install "core" first. If core opens but "widgets" crashes, the widget part is the problem.
If the app shows a red-ish "The app hit an error" screen, screenshot it.

Run: GitHub > Actions > Build Android APK > Run workflow.
Template box: leave "blank" (newest SDK). If both crash, try "blank@sdk-54".
