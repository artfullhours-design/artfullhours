# Deployment Guide - GitHub & Vercel

## Summary of Your Project Structure

✓ **Files properly committed:**
- `client/index.html`, `auth.js`, `login.html`, `signup.html`
- `server/server.js` and all API code
- `package.json` files for both root and server

✓ **Files correctly excluded (in .gitignore):**
- `tools/mongodb/data/` - Local MongoDB database (binary files)
- `tools/mongodb/mongodb-win32-x86_64-windows-8.2.7/` - MongoDB binaries
- `node_modules/` - Dependencies (Vercel runs `npm install` automatically)
- `.env` - Secrets (never commit!)

---

## Why MongoDB Data is Excluded (THIS IS CORRECT!)

MongoDB data files are:
- **Runtime files**, not source code
- **Binary and large** (100MB+ typically)
- **Environment-specific** (local ≠ production)
- **Auto-generated** - MongoDB creates them on first run

**Vercel needs:** A cloud MongoDB (e.g., MongoDB Atlas) - NOT local data files.

---

## Step-by-Step Deployment to Vercel

### 1. Create a Cloud MongoDB Instance

Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas):

1. Sign up (free tier available)
2. Create a cluster
3. Get connection string: `mongodb+srv://username:password@cluster.mongodb.net/artfullhoursDB`
4. Add your IP address to IP whitelist

### 2. Prepare GitHub

```powershell
cd c:\Users\prati\OneDrive\Desktop\artfullhours

# Commit current changes
git add .
git commit -m "chore: Add Vercel configuration"

# Push to GitHub
git push origin fix/admin-login-fallback  # or your main branch
```

### 3. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Click "New Project"
4. Select your `artfullhours` repository
5. Click "Import"

### 4. Add Environment Variables in Vercel

In the Vercel dashboard, go to **Settings → Environment Variables** and add:

```
MONGO_URI=mongodb+srv://your-username:your-password@your-cluster.mongodb.net/artfullhoursDB
JWT_SECRET=your-super-secret-key-here
ADMIN_EMAIL=owner@artfullhours.com
ADMIN_PASSWORD=Owner@123
OTP_SENDER_EMAIL=your-email@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your_app_password
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
STORE_NAME=ArtfullHours
```

**Important:** Use MongoDB Atlas URI (cloud), NOT localhost!

### 5. Deploy

Click "Deploy" - Vercel will:
- ✓ Clone your GitHub repository
- ✓ Run `npm install && cd server && npm install`
- ✓ Build your frontend (static files from `client/`)
- ✓ Start your server on Vercel Functions
- ✓ Connect to your cloud MongoDB

---

## Troubleshooting

### "MongoDB connection error" on Vercel
→ Update `MONGO_URI` to use MongoDB Atlas (not localhost)

### "Cannot find module 'express'"
→ Add `npm install` to Vercel build settings (already in vercel.json)

### "Files missing on GitHub"
→ Check `git status` - if files show in `git ls-tree -r HEAD --name-only`, they're committed!

### Server/client not connecting
→ Check that `MONGO_URI` is a valid cloud database connection

---

## Local vs Production Differences

| Component | Local | Vercel |
|-----------|-------|--------|
| MongoDB | Local: `tools/mongodb/` | Cloud: MongoDB Atlas |
| Database URI | `mongodb://127.0.0.1:27017/...` | `mongodb+srv://user:pass@cluster.mongodb.net/...` |
| Frontend | Served by Express | Vercel static hosting |
| Backend | Node.js server | Vercel Functions |
| Environment | `.env` file (local) | Vercel dashboard |

---

## File Exclusion Reference

Files in `.gitignore` (correctly excluded from GitHub):

```
node_modules/              # Dependencies installed by npm
tools/mongodb/data/        # Local database files
tools/mongodb/mongodb-*/   # Local MongoDB binaries
.env                       # Secrets (use Vercel env vars instead)
server/uploads/            # Generated files at runtime
```

None of these should be on GitHub - Vercel provides everything needed!

---

## Your Current GitHub Status

✅ All source files are committed:
- client files (HTML, JS, assets)
- server files (server.js, all APIs)
- configuration files

✅ MongoDB data is correctly excluded

✅ Ready for Vercel deployment!
