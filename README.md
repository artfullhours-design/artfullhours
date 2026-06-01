# ArtfullHours Crochet Ecommerce

A full-stack starter for a crochet online business with:
- Signup/Login with persistent accounts
- Visitor tracking (time, route, IP, user-agent)
- Product catalog with stock + active/inactive status
- Owner dashboard to add products and update stock/images
- Cart + wishlist
- Checkout with COD plus real UPI/Card payments via Razorpay
- Order tracking for customer and seller
- Delivery agent phone field for safety

## Project Structure

- `client/index.html` - Frontend storefront + owner dashboard UI
- `server/server.js` - Backend API and static hosting
- `server/uploads/` - Uploaded product images

## 1) Install Dependencies

From the project root:

```powershell
cd server
npm install
```

## 2) Configure Environment

In `server/` create `.env` from `.env.example`:

```powershell
Copy-Item .env.example .env
```

Edit values in `.env`:
- `JWT_SECRET`: set a long random secret
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: owner login credentials
- `MONGO_URI`: local MongoDB or MongoDB Atlas URI

## 3) Start MongoDB

### Option A: Local MongoDB
Install MongoDB Community Server and make sure service is running on `127.0.0.1:27017`.

### Option B: MongoDB Atlas (cloud)
- Create free cluster
- Create DB user and whitelist your IP
- Put Atlas connection string in `MONGO_URI`

## 4) Run App

```powershell
cd server
node server.js
```

Open:
- `http://localhost:5000`

The backend auto-creates owner account from `.env` if not present.

## Important Notes for Production

- Online payments are now integrated with Razorpay for `UPI` and `CARD`.
- `COD` remains available as an offline flow.
- Real India shipping and live GPS tracking need courier APIs (Shiprocket/Delhivery/etc.) and delivery partner integration.
- Add HTTPS, rate-limiting, stronger validation, and secure OTP settings before production launch.

## Real Online Payment Setup (Razorpay)

Set these values in `server/.env`:

```env
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
STORE_NAME=ArtfullHours
```

Then restart:

```powershell
.\stop-local.ps1
.\start-local.ps1
```

If keys are missing, checkout for `UPI`/`CARD` returns a clear setup error while `COD` still works.

## Live OTP Setup (Email and Phone)

By default, OTP runs in demo mode and is returned in API response for local testing.

To send real OTP to user email/phone, configure either provider in `server/.env`:

### A) OTP via Gmail (SMTP)

1. Use a Gmail account for sending OTP.
2. Enable 2-Step Verification on that Gmail account.
3. Generate an App Password in Google Account security settings.
4. Set these values:

```env
OTP_SENDER_EMAIL=your_email@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_16_char_app_password
```

### B) OTP via Twilio SMS

1. Create Twilio account and buy/verify an SMS-enabled number.
2. Copy Account SID, Auth Token and Twilio number.
3. Set these values:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
```

Phone numbers are normalized for India and sent as `+91XXXXXXXXXX` where possible.

After changing `.env`, restart backend:

```powershell
.\stop-local.ps1
.\start-local.ps1
```

## Main API Endpoints

- Auth: `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`
- Account: `PUT /api/account`
- Products: `GET /api/products`, `POST /api/products` (admin), `PUT /api/products/:id` (admin)
- Wishlist: `GET /api/wishlist`, `POST /api/wishlist/:productId`
- Cart: `GET /api/cart`, `POST /api/cart`, `PUT /api/cart/:itemId`, `DELETE /api/cart/:itemId`
- Orders: `POST /api/orders/checkout`, `POST /api/orders/:id/verify-payment`, `GET /api/orders`, `PUT /api/orders/:id/status` (admin)
- Analytics: `GET /api/admin/analytics` (admin)
- Visits: `POST /api/visits`

## Suggested Next Upgrades

1. Add product search, filters, and category pages.
2. Add OTP/email verification and password reset.
3. Add coupon/discount and return workflows.
4. Integrate real payment gateway and shipment provider APIs.
5. Deploy frontend+backend on Render/Railway with MongoDB Atlas.
