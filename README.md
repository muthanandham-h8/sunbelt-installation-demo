# Installation App

A simple Expo React Native mobile app with one screen: a clean devices list page for installation devices. This application uses Okta for user authentication.

## Okta Configuration Example

Setting up Okta is a two-way street. You need to configure Okta with your app's redirect scheme, and you need to configure your app with Okta's Issuer URL and Client ID.

### 1. In the Okta Developer Console
1. Go to **Applications** > **Applications** > **Create App Integration**.
2. Select **OIDC - OpenID Connect** and **Native Application**.
3. Under **General Settings**, configure the following:
   - **Sign-in redirect URIs**: `installationapp://redirect`
   - **Sign-out redirect URIs**: `installationapp://` (optional)
   - **Grant type**: Ensure **Authorization Code** is checked (PKCE is required).
4. Save the application. Note down the **Client ID** generated.

### 2. In your local `.env` file
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```

Open `.env` and fill in your Okta details. **Example:**
```env
# Your Okta domain, usually ending in /oauth2/default if using the default custom authorization server
EXPO_PUBLIC_OKTA_ISSUER=https://trial-1234567.okta.com/oauth2/default

# The Client ID you just generated in Okta
EXPO_PUBLIC_OKTA_CLIENT_ID=0oa1234567890abcdef

# Space-separated scopes
EXPO_PUBLIC_OKTA_SCOPES=openid profile email

# Your custom scheme, without the "://"
EXPO_PUBLIC_OKTA_REDIRECT_SCHEME=installationapp
```

---

## How to Run

### Option 1: Running on a Connected Android Device (Recommended)
We have a helper script that checks for prerequisites, sets up the correct Java/Android environment, and runs the application directly on your connected Android device.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Connect your Android device via USB and ensure **USB Debugging** is enabled.
3. Run the deployment script:
   ```bash
   sh scripts/run-android.sh
   ```
*This script will automatically verify your device connection, check prerequisites, and build the app to run on port `8084`.*

### Option 2: Running with Expo Go (Simulators or wireless)
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the Expo development server:
   ```bash
   npm start
   ```
3. Open the app using the Expo Go app on your physical device (by scanning the QR code), or press `i` for iOS Simulator or `a` for Android Emulator.
