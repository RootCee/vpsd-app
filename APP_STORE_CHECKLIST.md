# Hope Bridge App Store / TestFlight Checklist

## Already Configured In Code

- App display name is set to `Hope Bridge` in `mobile/vpsd-mobile/app.json`.
- Expo slug is set to `hope-bridge`.
- iOS URL scheme is set to `hopebridge`.
- iOS bundle identifier is set to `com.rootcee.hopebridge`.
- iOS version is set to `1.0.0`.
- iOS build number is set to `1`.
- Android package/versionCode are present for store readiness parity.
- EAS production profile is configured in `mobile/vpsd-mobile/eas.json`.
- Production builds use the hosted API by default in `mobile/vpsd-mobile/src/config.ts`.
- Demo seeding UI on the Hotspots screen is hidden outside dev builds.
- App Store metadata placeholders are present in `mobile/vpsd-mobile/app.json` under `expo.extra.appStore`.

## Manual Items Still Required In App Store Connect

- Verify that `com.rootcee.hopebridge` is the exact bundle identifier you want to keep permanently.
- Create or confirm the App Store Connect app record for the bundle identifier.
- Fill in the final privacy policy URL.
- Fill in the final support URL and/or support email.
- Add the app description, subtitle, keywords, and promotional text.
- Upload App Store screenshots for all required device sizes.
- Upload the final app icon/marketing assets if any branding changes are still pending.
- Complete App Privacy nutrition labels.
- Complete age rating questionnaire.
- Provide export compliance answers if your release process requires more than the current default.
- Add TestFlight tester groups and internal/external testers.
- Fill in review contact information and demo account details if Apple requests them.

## TestFlight Build Commands

Run from `~/Desktop/MVPAPP/vpsd/mobile/vpsd-mobile`.

### 1. Log in to Expo/EAS if needed

```bash
npx eas login
```

### 2. Build the iOS production binary for TestFlight

```bash
npx eas build --platform ios --profile production
```

### 3. Submit the latest iOS build to App Store Connect / TestFlight

```bash
npx eas submit --platform ios --profile production
```

### 4. Optional: build and submit in one flow

```bash
npx eas build --platform ios --profile production --auto-submit
```

## Notes

- Restart Expo after changing any `EXPO_PUBLIC_*` environment values.
- Production builds intentionally ignore local `EXPO_PUBLIC_API_BASE` overrides and use the hosted backend.
- Keep local device/LAN testing values in an untracked `.env` file only.
