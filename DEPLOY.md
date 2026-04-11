# Raksha Deployment Guide

## Step 1 — Push to GitHub

```bash
git init          # if not already a git repo
git add .
git commit -m "Raksha full app"
git remote add origin https://github.com/YOUR_USERNAME/raksha.git
git push -u origin main
```

---

## Step 2 — Deploy Node Backend to Railway

1. Go to https://railway.app → **New Project** → **Deploy from GitHub repo**
2. Select your repo
3. Set **Root Directory** to `Raksha`
4. Railway auto-detects Node.js and runs `npm run build && npm start`
5. Go to **Variables** tab and add ALL of these:

```
PORT=4000
JWT_SECRET=your_jwt_secret_here
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_CLIENT_EMAIL=your_firebase_client_email
FIREBASE_PRIVATE_KEY=your_firebase_private_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone
CLOUDINARY_CLOUD_NAME=your_cloudinary_name
CLOUDINARY_API_KEY=your_cloudinary_key
CLOUDINARY_API_SECRET=your_cloudinary_secret
SAFE_ROUTE_URL=https://YOUR_PYTHON_SERVICE_URL (fill after Step 3)
```

6. Click **Deploy** — Railway gives you a URL like:
   `https://raksha-production-xxxx.up.railway.app`

---

## Step 3 — Deploy Python Service to Railway

1. In the same Railway project → **New Service** → **GitHub Repo**
2. Select same repo
3. Set **Root Directory** to:
   `Raksha/Safe_route_updated-criminal-profiles/safe_route/backend`
4. Set **Start Command** to:
   `uvicorn app:app --host 0.0.0.0 --port $PORT`
5. No extra env vars needed for Python service
6. Railway gives you a second URL like:
   `https://raksha-python-xxxx.up.railway.app`

7. Go back to the **Node service** Variables and update:
   `SAFE_ROUTE_URL=https://raksha-python-xxxx.up.railway.app`

---

## Step 4 — Update Frontend URL

Open `raksha-web/.env.production` and replace:
```
VITE_API_BASE=https://YOUR_RAILWAY_NODE_URL_HERE
```
with your actual Node URL:
```
VITE_API_BASE=https://raksha-production-xxxx.up.railway.app
```

---

## Step 5 — Build the APK

Run the build script:
```bash
cd raksha-web
build-apk.bat
```

Or manually:
```bash
cd raksha-web
npm run build
npx cap sync android
```

Then in Android Studio:
- **File → Open** → select `raksha-web/android`
- **Build → Generate Signed App Bundle / APK**
- Choose APK → create/use keystore → build

---

## After This

- Your APK works forever without running anything locally
- Backend auto-restarts on Railway if it crashes
- To update the app: push to GitHub → Railway auto-redeploys → rebuild APK only if frontend changed

---

## Verify Deployment

Test your Node backend is live:
```
https://YOUR_RAILWAY_NODE_URL/health
```
Should return: `{"status":"Raksha backend running","websocket":true}`

Test Python service:
```
https://YOUR_PYTHON_URL/risk-map
```
Should return JSON with risk data.
