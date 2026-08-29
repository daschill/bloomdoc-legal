# BloomDoc — iOS publish (via apple-ship)

This app is registered in the multi-app kit:

`C:\Users\mikes\apple-ship`

```powershell
cd C:\Users\mikes\apple-ship
.\scripts\ship.ps1 status
.\scripts\ship.ps1 sync -Id bloomdoc
.\scripts\ship.ps1 checklist -Id bloomdoc
```

| Field | Value |
|-------|--------|
| App id | `bloomdoc` |
| Kind | `flutter` |
| Bundle ID | `com.schilllabs.bloomdoc` |
| Codemagic ASC integration | `AppleTeam` |
| Repo path | `C:\Users\mikes\bloomdoc` |
| GitHub | `daschill/bloomdoc` |

## Ship loop

1. Develop on Windows (Android / desktop / code).
2. `git push` this repo.
3. Codemagic → start **ios-unsigned-check** / **ios-compile-check**, then **ios-testflight**.
4. Install from TestFlight on a physical iPhone.

## One-time (shared across all your apps)

See `C:\Users\mikes\apple-ship\docs\ONE_TIME_APPLE_SETUP.md` — enroll once, one API key, then add apps.

## IAP product IDs

- `plant_premium_weekly`
- `plant_premium_monthly`
- `plant_premium_yearly`

## Legal URLs (after GitHub Pages is enabled)

- Privacy: https://getbloomdoc.com/legal/privacy.html
- Terms: https://getbloomdoc.com/legal/terms.html
- Support: https://getbloomdoc.com/legal/support.html

Enable Pages: repo Settings → Pages → Deploy from branch `main` / folder `/docs`.

## Notes

Paywall CTA is honest: it says Start Free Trial only when the selected
StoreKit / RevenueCat package has a zero-price intro offer.

