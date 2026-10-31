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

Wallet actions (stake to a pool, delegate voting power, withdraw rewards)
------------------------------------------------------------------------
Users sign in THEIR OWN wallet; Frog Labs never sees keys. The signing page is a small web app in /web.
1. Upload everything in this folder to your GitHub repo (both .github/workflows files and the web folder).
2. Repo > Settings > Pages > "Build and deployment" > Source: GitHub Actions.
   (GitHub Pages on a PRIVATE repo needs a paid GitHub plan. On the free plan make the repo public - it holds no secrets -
   or download the "frog-labs-web" artifact from the deploy run and drag it onto Netlify Drop / Cloudflare Pages.)
3. Actions > "Deploy web app (wallet actions)" > Run workflow. When it is green, the run page shows the site address.
4. Put that address into config.js (DAPP_URL, keep the trailing slash), then run "Build Android APK" again.
Users open the link inside their wallet's built-in browser (Eternl, Vespr, Begin ...) or in a desktop browser with a wallet extension.
Try it on a test network (preprod) wallet, or with a small amount on mainnet, before announcing it.

Koios API token for the website (needed so people can see their staking data)
---------------------------------------------------------------------------
Koios blocks browser requests on its anonymous public tier, so the website needs a free API token.
1. Go to https://koios.rest , connect a wallet, sign the message, and create a token on the Free plan.
2. GitHub repo > Settings > Secrets and variables > Actions > New repository secret.
   Name: KOIOS_TOKEN    Value: (paste the token)
3. Actions > "Deploy web app (wallet actions)" > Run workflow.
Note: the token ends up inside the public website code. That only lets others spend your free request quota
(50,000 a day), so keep it separate from anything valuable. Free tokens expire periodically; renew it when the
website says the data service "rejected our API token".
