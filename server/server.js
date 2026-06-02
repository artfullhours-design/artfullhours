const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const Razorpay = require("razorpay");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/artfullhoursDB";
const JWT_SECRET = process.env.JWT_SECRET || "change_this_in_env";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "owner@artfullhours.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Owner@123";
const OTP_SENDER_EMAIL = process.env.OTP_SENDER_EMAIL || "";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false") === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const STORE_NAME = process.env.STORE_NAME || "ArtfullHours";
let isDbConnected = false;
const DB_RETRY_MS = Number(process.env.DB_RETRY_MS || 5000);
let isConnectingDb = false;
let hasEnsuredAdmin = false;
let serverStarted = false;

mongoose.set("strictQuery", false);

const canSendEmailOtp = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && OTP_SENDER_EMAIL);
const canSendSmsOtp = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);
const emailTransporter = canSendEmailOtp
  ? nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  })
  : null;

const twilioClient = canSendSmsOtp ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;
const canUseRazorpay = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
const razorpayClient = canUseRazorpay
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
  : null;

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const upload = multer({ storage });

const detectMediaType = (source) => {
  const url = String(source || "").toLowerCase();
  if (url.includes("video") || url.match(/\.(mp4|mov|webm|ogg|m4v|avi|flv)(\?|$)/)) {
    return "video";
  }
  return "image";
};

const buildMediaList = ({ fileEntries = [], urlList = [] }) => {
  const media = [];
  fileEntries.forEach((file) => {
    media.push({
      url: `/uploads/${file.filename}`,
      type: detectMediaType(file.mimetype || file.originalname)
    });
  });
  urlList.forEach((rawUrl) => {
    const url = String(rawUrl || "").trim();
    if (!url) return;
    media.push({ url, type: detectMediaType(url) });
  });
  return media;
};

const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    return cors(corsOptions)(req, res, next);
  }
  return next();
});
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname, "../client")));

const startServer = () => {
  if (serverStarted) return;
  serverStarted = true;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};

const connectMongoWithRetry = async () => {
  if (isConnectingDb || isDbConnected) return;
  isConnectingDb = true;
  console.log(`Connecting to MongoDB using URI: ${MONGO_URI}`);

  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000
    });
    isDbConnected = true;
    console.log("MongoDB Connected");
    if (!hasEnsuredAdmin) {
      await ensureAdminUser();
      hasEnsuredAdmin = true;
    }
    startServer();
  } catch (err) {
    isDbConnected = false;
    console.error("MongoDB connection failed:", err.message);
    setTimeout(connectMongoWithRetry, DB_RETRY_MS);
  } finally {
    isConnectingDb = false;
  }
};

connectMongoWithRetry();

mongoose.connection.on("connected", () => {
  isDbConnected = true;
});

mongoose.connection.on("disconnected", () => {
  isDbConnected = false;
  console.warn("MongoDB disconnected. Retrying...");
  setTimeout(connectMongoWithRetry, DB_RETRY_MS);
});

mongoose.connection.on("error", (err) => {
  isDbConnected = false;
  console.error("MongoDB error:", err.message);
  setTimeout(connectMongoWithRetry, DB_RETRY_MS);
});

const AddressSchema = new mongoose.Schema({
  fullName: String,
  phone: String,
  line1: String,
  line2: String,
  city: String,
  state: String,
  pincode: String
}, { _id: false });

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["customer", "admin"], default: "customer" },
  phone: { type: String, unique: true, sparse: true },
  address: AddressSchema,
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: Date,
  otpCode: String,
  otpPurpose: String,
  otpExpiresAt: Date
});

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: "" },
  category: { type: String, default: "Crochet" },
  price: { type: Number, required: true },
  stock: { type: Number, default: 0 },
  imageUrl: { type: String, default: "" },
  media: [{
    url: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], default: "image" }
  }],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const VisitSchema = new mongoose.Schema({
  visitedAt: { type: Date, default: Date.now },
  route: String,
  ip: String,
  userAgent: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
});

const CartItemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, default: 1, min: 1 }
}, { timestamps: true });

const WishlistSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true }
}, { timestamps: true });
WishlistSchema.index({ userId: 1, productId: 1 }, { unique: true });

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: String,
    imageUrl: String,
    price: Number,
    quantity: Number
  }],
  totalAmount: Number,
  supportEmail: { type: String, default: "" },
  paymentMethod: { type: String, enum: ["COD", "UPI", "CARD"], required: true },
  paymentStatus: { type: String, enum: ["PENDING", "PAID"], default: "PENDING" },
  paymentGateway: { type: String, default: "" },
  paymentGatewayOrderId: { type: String, default: "" },
  paymentGatewayPaymentId: { type: String, default: "" },
  paymentGatewaySignature: { type: String, default: "" },
  paidAt: Date,
  orderStatus: {
    type: String,
    enum: ["PLACED", "CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
    default: "PLACED"
  },
  shippingAddress: AddressSchema,
  deliveryAgentPhone: String,
  ownerReply: { type: String, default: "" },
  trackingLocation: {
    note: String,
    lat: Number,
    lng: Number,
    updatedAt: Date
  },
  createdAt: { type: Date, default: Date.now }
});

const FeedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  productName: { type: String, default: "" },
  message: { type: String, default: "" },
  media: [{
    url: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], default: "image" }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
FeedbackSchema.index({ userId: 1, orderId: 1, productId: 1 }, { unique: true });

const Feedback = mongoose.model("Feedback", FeedbackSchema);

const CustomRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  customerName: { type: String, default: "" },
  customerEmail: { type: String, default: "" },
  customerPhone: { type: String, default: "" },
  title: { type: String, required: true },
  description: { type: String, required: true },
  referenceImageUrl: { type: String, default: "" },
  status: {
    type: String,
    enum: ["NEW", "REVIEWING", "POSSIBLE", "NOT_POSSIBLE", "COMPLETED"],
    default: "NEW"
  },
  adminReply: { type: String, default: "" },
  repliedAt: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const ActivitySchema = new mongoose.Schema({
  action: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  actorName: String,
  actorEmail: String,
  actorPhone: String,
  route: String,
  ip: String,
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);
const Product = mongoose.model("Product", ProductSchema);
const Visit = mongoose.model("Visit", VisitSchema);
const CartItem = mongoose.model("CartItem", CartItemSchema);
const Wishlist = mongoose.model("Wishlist", WishlistSchema);
const Order = mongoose.model("Order", OrderSchema);
const Activity = mongoose.model("Activity", ActivitySchema);
const CustomRequest = mongoose.model("CustomRequest", CustomRequestSchema);

const logActivity = async ({ action, user = null, req = null, meta = {} }) => {
  try {
    await Activity.create({
      action,
      userId: user ? user._id : null,
      actorName: user ? user.name : "Guest",
      actorEmail: user ? (user.email || "") : "",
      actorPhone: user ? (user.phone || "") : "",
      route: req ? req.path : "",
      ip: req ? req.ip : "",
      meta
    });
  } catch (_e) {
  }
};

const auth = async (req, res, next) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    req.user = user;
    next();
  } catch (_e) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
};

const signToken = (user) => jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email || "",
  role: user.role,
  phone: user.phone || "",
  address: user.address || null,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt || null
});

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildOrderItemsFromCart = async (userId) => {
  const cartItems = await CartItem.find({ userId }).populate("productId");
  if (cartItems.length === 0) {
    throw new Error("Cart is empty");
  }

  let totalAmount = 0;
  const orderItems = [];

  for (const cartItem of cartItems) {
    const product = cartItem.productId;
    if (!product || !product.isActive) {
      throw new Error("One or more products are unavailable");
    }

    orderItems.push({
      productId: product._id,
      name: product.name,
      imageUrl: product.imageUrl,
      price: product.price,
      quantity: cartItem.quantity
    });
    totalAmount += product.price * cartItem.quantity;
  }

  return { orderItems, totalAmount };
};

const reserveStockForOrder = async (orderItems) => {
  for (const item of orderItems) {
    const product = await Product.findById(item.productId);
    if (!product || !product.isActive) {
      throw new Error(`Product unavailable: ${item.name}`);
    }
    if (product.stock < item.quantity) {
      throw new Error(`Not enough stock for ${product.name}`);
    }
    product.stock -= item.quantity;
    await product.save();
  }
};

const normalizeEmail = (value) => {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
};

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits || null;
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const otpMessageText = (otp, purpose) => {
  const context = purpose === "RESET_PASSWORD" ? "password reset" : "login";
  return `Your ArtfullHours OTP for ${context} is ${otp}. It is valid for 10 minutes.`;
};

const toE164India = (phone) => {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+91${digits.slice(1)}`;
  return null;
};

const sendOtpToUser = async (user, otp, purpose) => {
  const result = {
    deliveredVia: [],
    demoMode: false,
    errors: []
  };
  const message = otpMessageText(otp, purpose);

  if (canSendEmailOtp && user.email) {
    try {
      await emailTransporter.sendMail({
        from: OTP_SENDER_EMAIL,
        to: user.email,
        subject: "ArtfullHours OTP",
        text: message
      });
      result.deliveredVia.push("email");
    } catch (error) {
      result.errors.push(`Email send failed: ${error.message}`);
    }
  }

  if (canSendSmsOtp && user.phone) {
    const to = toE164India(user.phone);
    if (!to) {
      result.errors.push("Phone must be a valid Indian number for SMS OTP");
    } else {
      try {
        await twilioClient.messages.create({
          body: message,
          from: TWILIO_PHONE_NUMBER,
          to
        });
        result.deliveredVia.push("phone");
      } catch (error) {
        result.errors.push(`SMS send failed: ${error.message}`);
      }
    }
  }

  if (result.deliveredVia.length === 0) {
    result.demoMode = true;
  }

  return result;
};

const findUserByIdentifier = async (identifier) => {
  const maybeEmail = normalizeEmail(identifier);
  const maybePhone = normalizePhone(identifier);
  const query = [];
  if (maybeEmail && maybeEmail.includes("@")) {
    query.push({ email: maybeEmail });
  }
  if (maybePhone) {
    query.push({ phone: maybePhone });
  }
  if (query.length === 0) return null;
  return User.findOne({ $or: query });
};

const sendAdminCustomRequestEmail = async (customRequest) => {
  if (!emailTransporter || !OTP_SENDER_EMAIL || !ADMIN_EMAIL) return;
  await emailTransporter.sendMail({
    from: OTP_SENDER_EMAIL,
    to: ADMIN_EMAIL,
    subject: `New customization request from ${customRequest.customerName || "customer"}`,
    text: [
      "A new customization request was submitted on ArtfullHours.",
      `Name: ${customRequest.customerName || "-"}`,
      `Email: ${customRequest.customerEmail || "-"}`,
      `Phone: ${customRequest.customerPhone || "-"}`,
      `Title: ${customRequest.title}`,
      `Description: ${customRequest.description}`,
      `Reference image: ${customRequest.referenceImageUrl || "No image uploaded"}`
    ].join("\n")
  });
};

const sendCustomerCustomReplyEmail = async (customRequest) => {
  if (!emailTransporter || !OTP_SENDER_EMAIL || !customRequest.customerEmail) return;
  await emailTransporter.sendMail({
    from: OTP_SENDER_EMAIL,
    to: customRequest.customerEmail,
    subject: `Update on your customization request: ${customRequest.title}`,
    text: [
      `Hello ${customRequest.customerName || "there"},`,
      "",
      `Your customization request is now marked as: ${customRequest.status.replace(/_/g, " ")}`,
      customRequest.adminReply ? `Owner reply: ${customRequest.adminReply}` : "The owner reviewed your request.",
      "",
      "You can log in to ArtfullHours to check the latest update."
    ].join("\n")
  });
};

const formatAddressBlock = (address = {}) => {
  const parts = [
    address.fullName,
    address.phone,
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.pincode
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "No shipping address provided";
};

const sendAdminOrderEmail = async ({ order, user }) => {
  if (!emailTransporter || !OTP_SENDER_EMAIL || !ADMIN_EMAIL || !order) return;

  const items = (order.items || [])
    .map((item) => `- ${item.name} x${item.quantity} | INR ${item.price}`)
    .join("\n");

  const customerEmail = user && user.email ? user.email : "";
  const supportEmail = order.supportEmail || customerEmail || "";
  const customerPhone = user && user.phone ? user.phone : "";
  const shippingAddress = formatAddressBlock(order.shippingAddress || {});

  await emailTransporter.sendMail({
    from: OTP_SENDER_EMAIL,
    to: ADMIN_EMAIL,
    replyTo: supportEmail || undefined,
    subject: `New order received: #${String(order._id).slice(-6)} | ${order.paymentMethod}`,
    text: [
      "A new order was placed on ArtfullHours.",
      `Order ID: ${order._id}`,
      `Customer: ${user && user.name ? user.name : "Customer"}`,
      `Customer Email: ${customerEmail || "Not provided"}`,
      `Customer Support Email: ${supportEmail || "Not provided"}`,
      `Customer Phone: ${customerPhone || "Not provided"}`,
      `Payment Method: ${order.paymentMethod}`,
      `Payment Status: ${order.paymentStatus}`,
      `Order Status: ${order.orderStatus}`,
      `Total Amount: INR ${order.totalAmount}`,
      `Shipping Address: ${shippingAddress}`,
      "",
      "Items:",
      items || "No items",
      "",
      supportEmail
        ? "Reply to this email to respond directly to the customer."
        : "Customer email not available. Use phone/admin panel to contact the customer."
    ].join("\n")
  });
};

const sendCustomerOrderUpdateEmail = async ({ order, user }) => {
  const targetEmail = order.supportEmail || (user && user.email) || "";
  if (!emailTransporter || !OTP_SENDER_EMAIL || !targetEmail || !order) return;

  const items = (order.items || [])
    .map((item) => `${item.name} x${item.quantity}`)
    .join(", ");

  await emailTransporter.sendMail({
    from: OTP_SENDER_EMAIL,
    to: targetEmail,
    subject: `Order update: #${String(order._id).slice(-6)} is now ${order.orderStatus}`,
    text: [
      `Hello ${user && user.name ? user.name : "there"},`,
      "",
      `Your order #${String(order._id).slice(-6)} has been updated.`,
      `Order Status: ${order.orderStatus}`,
      `Payment Status: ${order.paymentStatus}`,
      `Payment Method: ${order.paymentMethod}`,
      `Items: ${items || "No items"}`,
      `Tracking Note: ${(order.trackingLocation && order.trackingLocation.note) || "Pending update"}`,
      `Delivery Agent Phone: ${order.deliveryAgentPhone || "Will be assigned"}`,
      order.ownerReply ? `Owner Reply: ${order.ownerReply}` : "",
      "",
      "Thank you for shopping with ArtfullHours."
    ].filter(Boolean).join("\n")
  });
};

async function ensureAdminUser() {
  const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });
  if (!existing) {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await User.create({
      name: "Store Owner",
      email: ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      role: "admin"
    });
    console.log(`Admin user created: ${ADMIN_EMAIL}`);
  }
}

app.get("/api/health", (_req, res) => {
  return res.json({
    server: "online",
    database: isDbConnected ? "connected" : "disconnected"
  });
});

app.use("/api", (req, res, next) => {
  if (!isDbConnected && req.path !== "/health") {
    return res.status(503).json({
      message: "Database is not connected. Start MongoDB or set a valid MONGO_URI in server/.env"
    });
  }
  return next();
});

app.post("/api/visits", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    let userId = null;
    if (authHeader.startsWith("Bearer ")) {
      try {
        const payload = jwt.verify(authHeader.replace("Bearer ", ""), JWT_SECRET);
        userId = payload.userId;
      } catch (_e) {
        userId = null;
      }
    }

    await Visit.create({
      route: req.body.route || "/",
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "unknown",
      userId
    });

    if (userId) {
      const visitor = await User.findById(userId).select("name email phone");
      if (visitor) {
        await logActivity({
          action: "VISIT_RECORDED",
          user: visitor,
          req,
          meta: { route: req.body.route || "/" }
        });
      }
    }

    return res.json({ message: "Visit recorded" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to record visit", error: error.message });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !password) {
      return res.status(400).json({ message: "Name and password are required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedEmail && !normalizedPhone) {
      return res.status(400).json({ message: "Email or phone is required" });
    }

    if (normalizedEmail && !normalizedEmail.includes("@")) {
      return res.status(400).json({ message: "Enter a valid email" });
    }

    const duplicate = await User.findOne({
      $or: [
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ...(normalizedPhone ? [{ phone: normalizedPhone }] : [])
      ]
    });
    if (duplicate) {
      return res.status(409).json({ message: "Email or phone already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash,
      role: "customer"
    });
    await logActivity({
      action: "ACCOUNT_CREATED",
      user,
      req,
      meta: { via: "signup" }
    });
    const token = signToken(user);
    return res.status(201).json({ message: "Signup successful", token, user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ message: "Signup failed", error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password || "", user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    user.lastLoginAt = new Date();
    await user.save();

    await logActivity({
      action: "LOGIN_PASSWORD",
      user,
      req,
      meta: { identifier: req.body.identifier || "" }
    });

    const token = signToken(user);
    return res.json({ message: "Login successful", token, user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ message: "Login failed", error: error.message });
  }
});

app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const { identifier, purpose } = req.body;
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ message: "User not found" });

    const allowedPurpose = ["LOGIN", "RESET_PASSWORD"];
    if (!allowedPurpose.includes(purpose)) {
      return res.status(400).json({ message: "Invalid OTP purpose" });
    }

    const otp = generateOtp();
    user.otpCode = otp;
    user.otpPurpose = purpose;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const delivery = await sendOtpToUser(user, otp, purpose);

    await logActivity({
      action: "OTP_REQUESTED",
      user,
      req,
      meta: { purpose, deliveredVia: delivery.deliveredVia }
    });

    if (delivery.demoMode) {
      return res.json({
        message: "OTP generated in demo mode. Configure SMTP or Twilio env values for live delivery.",
        otp,
        deliveredVia: [],
        deliveryErrors: delivery.errors,
        expiresInMinutes: 10
      });
    }

    return res.json({
      message: `OTP sent successfully via ${delivery.deliveredVia.join(" and ")}`,
      deliveredVia: delivery.deliveredVia,
      deliveryErrors: delivery.errors,
      expiresInMinutes: 10
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to request OTP", error: error.message });
  }
});

app.post("/api/auth/login-otp", async (req, res) => {
  try {
    const { identifier, otp } = req.body;
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.otpCode || user.otpPurpose !== "LOGIN" || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(400).json({ message: "OTP expired or invalid. Request a new OTP" });
    }

    if (String(user.otpCode) !== String(otp || "")) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    user.otpCode = undefined;
    user.otpPurpose = undefined;
    user.otpExpiresAt = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    await logActivity({
      action: "LOGIN_OTP",
      user,
      req,
      meta: { identifier: req.body.identifier || "" }
    });

    const token = signToken(user);
    return res.json({ message: "Login successful", token, user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ message: "OTP login failed", error: error.message });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { identifier } = req.body;
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ message: "User not found" });

    const otp = generateOtp();
    user.otpCode = otp;
    user.otpPurpose = "RESET_PASSWORD";
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const delivery = await sendOtpToUser(user, otp, "RESET_PASSWORD");

    await logActivity({
      action: "RESET_OTP_REQUESTED",
      user,
      req,
      meta: { deliveredVia: delivery.deliveredVia }
    });

    if (delivery.demoMode) {
      return res.json({
        message: "Password reset OTP generated in demo mode. Configure SMTP or Twilio env values for live delivery.",
        otp,
        deliveredVia: [],
        deliveryErrors: delivery.errors,
        expiresInMinutes: 10
      });
    }

    return res.json({
      message: `Password reset OTP sent via ${delivery.deliveredVia.join(" and ")}`,
      deliveredVia: delivery.deliveredVia,
      deliveryErrors: delivery.errors,
      expiresInMinutes: 10
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to generate reset OTP", error: error.message });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { identifier, otp, newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.otpCode || user.otpPurpose !== "RESET_PASSWORD" || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return res.status(400).json({ message: "OTP expired or invalid. Request a new OTP" });
    }

    if (String(user.otpCode) !== String(otp || "")) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.otpCode = undefined;
    user.otpPurpose = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    await logActivity({
      action: "PASSWORD_RESET",
      user,
      req
    });

    return res.json({ message: "Password reset successful" });
  } catch (error) {
    return res.status(500).json({ message: "Password reset failed", error: error.message });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  return res.json({ user: sanitizeUser(req.user) });
});

app.put("/api/account", auth, async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    if (typeof name === "string") req.user.name = name;
    if (typeof phone === "string") req.user.phone = phone;
    if (address && typeof address === "object") req.user.address = address;
    await req.user.save();
    await logActivity({
      action: "ACCOUNT_UPDATED",
      user: req.user,
      req
    });
    return res.json({ message: "Account updated", user: sanitizeUser(req.user) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update account", error: error.message });
  }
});

app.get("/api/products", async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const query = includeInactive ? {} : { isActive: true };
  const products = await Product.find(query).sort({ createdAt: -1 });
  return res.json({ products });
});

app.post("/api/products", auth, adminOnly, upload.fields([{ name: "image", maxCount: 1 }, { name: "media", maxCount: 20 }]), async (req, res) => {
  try {
    const imageUrl = req.files && req.files.image && req.files.image[0]
      ? `/uploads/${req.files.image[0].filename}`
      : (req.body.imageUrl || "");

    const mediaUrls = String(req.body.mediaUrls || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
    const mediaFiles = (req.files && req.files.media) || [];
    const mediaList = buildMediaList({ fileEntries: mediaFiles, urlList: mediaUrls });

    if (!mediaList.length && imageUrl) {
      mediaList.push({ url: imageUrl, type: detectMediaType(imageUrl) });
    }

    const product = await Product.create({
      name: req.body.name,
      description: req.body.description || "",
      category: req.body.category || "Crochet",
      price: toNumber(req.body.price, 0),
      stock: toNumber(req.body.stock, 0),
      imageUrl,
      media: mediaList,
      isActive: String(req.body.isActive ?? "true") !== "false"
    });
    await logActivity({
      action: "PRODUCT_CREATED",
      user: req.user,
      req,
      meta: { productId: product._id, name: product.name }
    });
    return res.status(201).json({ message: "Product created", product });
  } catch (error) {
    return res.status(400).json({ message: "Failed to create product", error: error.message });
  }
});

app.put("/api/products/:id", auth, adminOnly, upload.fields([{ name: "image", maxCount: 1 }, { name: "media", maxCount: 20 }]), async (req, res) => {
  try {
    const update = {
      updatedAt: new Date()
    };
    if (req.body.name !== undefined) update.name = req.body.name;
    if (req.body.description !== undefined) update.description = req.body.description;
    if (req.body.category !== undefined) update.category = req.body.category;
    if (req.body.price !== undefined) update.price = toNumber(req.body.price, 0);
    if (req.body.stock !== undefined) update.stock = toNumber(req.body.stock, 0);
    if (req.body.isActive !== undefined) update.isActive = String(req.body.isActive) !== "false";
    if (req.body.imageUrl !== undefined) update.imageUrl = req.body.imageUrl;
    if (req.files && req.files.image && req.files.image[0]) update.imageUrl = `/uploads/${req.files.image[0].filename}`;

    const mediaUrls = String(req.body.mediaUrls || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
    const mediaFiles = (req.files && req.files.media) || [];
    if (mediaUrls.length || mediaFiles.length) {
      update.media = buildMediaList({ fileEntries: mediaFiles, urlList: mediaUrls });
    }

    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!product) return res.status(404).json({ message: "Product not found" });
    await logActivity({
      action: "PRODUCT_UPDATED",
      user: req.user,
      req,
      meta: { productId: product._id, name: product.name }
    });
    return res.json({ message: "Product updated", product });
  } catch (error) {
    return res.status(400).json({ message: "Failed to update product", error: error.message });
  }
});

app.delete("/api/products/:id", auth, adminOnly, async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { isActive: false, updatedAt: new Date() }, { new: true });
  if (!product) return res.status(404).json({ message: "Product not found" });
  await logActivity({
    action: "PRODUCT_DEACTIVATED",
    user: req.user,
    req,
    meta: { productId: product._id, name: product.name }
  });
  return res.json({ message: "Product marked inactive", product });
});

app.get("/api/wishlist", auth, async (req, res) => {
  const items = await Wishlist.find({ userId: req.user._id }).populate("productId");
  return res.json({ items });
});

app.post("/api/wishlist/:productId", auth, async (req, res) => {
  const existing = await Wishlist.findOne({ userId: req.user._id, productId: req.params.productId });
  if (existing) {
    await existing.deleteOne();
    await logActivity({
      action: "WISHLIST_REMOVED",
      user: req.user,
      req,
      meta: { productId: req.params.productId }
    });
    return res.json({ message: "Removed from wishlist", inWishlist: false });
  }
  await Wishlist.create({ userId: req.user._id, productId: req.params.productId });
  await logActivity({
    action: "WISHLIST_ADDED",
    user: req.user,
    req,
    meta: { productId: req.params.productId }
  });
  return res.json({ message: "Added to wishlist", inWishlist: true });
});

app.get("/api/cart", auth, async (req, res) => {
  const items = await CartItem.find({ userId: req.user._id }).populate("productId");
  return res.json({ items });
});

app.post("/api/cart", auth, async (req, res) => {
  const { productId, quantity } = req.body;
  const qty = Math.max(1, toNumber(quantity, 1));
  const product = await Product.findById(productId);
  if (!product || !product.isActive) return res.status(404).json({ message: "Product not found" });
  if (product.stock < qty) return res.status(400).json({ message: "Not enough stock" });

  const existing = await CartItem.findOne({ userId: req.user._id, productId });
  if (existing) {
    existing.quantity += qty;
    await existing.save();
    await logActivity({
      action: "CART_UPDATED",
      user: req.user,
      req,
      meta: { productId, quantity: existing.quantity }
    });
    return res.json({ message: "Cart updated", item: existing });
  }
  const item = await CartItem.create({ userId: req.user._id, productId, quantity: qty });
  await logActivity({
    action: "CART_ADDED",
    user: req.user,
    req,
    meta: { productId, quantity: qty }
  });
  return res.status(201).json({ message: "Added to cart", item });
});

app.put("/api/cart/:itemId", auth, async (req, res) => {
  const qty = Math.max(1, toNumber(req.body.quantity, 1));
  const item = await CartItem.findOne({ _id: req.params.itemId, userId: req.user._id });
  if (!item) return res.status(404).json({ message: "Cart item not found" });

  const product = await Product.findById(item.productId);
  if (!product || product.stock < qty) return res.status(400).json({ message: "Not enough stock" });

  item.quantity = qty;
  await item.save();
  await logActivity({
    action: "CART_QUANTITY_CHANGED",
    user: req.user,
    req,
    meta: { itemId: item._id, quantity: qty }
  });
  return res.json({ message: "Quantity updated", item });
});

app.delete("/api/cart/:itemId", auth, async (req, res) => {
  const item = await CartItem.findOneAndDelete({ _id: req.params.itemId, userId: req.user._id });
  if (!item) return res.status(404).json({ message: "Cart item not found" });
  await logActivity({
    action: "CART_REMOVED",
    user: req.user,
    req,
    meta: { itemId: req.params.itemId }
  });
  return res.json({ message: "Removed from cart" });
});

app.post("/api/orders/checkout", auth, async (req, res) => {
  try {
    const { paymentMethod, shippingAddress, supportEmail } = req.body;
    if (!["COD", "UPI", "CARD"].includes(paymentMethod)) {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    const { orderItems, totalAmount } = await buildOrderItemsFromCart(req.user._id);

    if (paymentMethod === "COD") {
      await reserveStockForOrder(orderItems);

      const order = await Order.create({
        userId: req.user._id,
        items: orderItems,
        totalAmount,
        supportEmail: normalizeEmail(supportEmail) || req.user.email || "",
        paymentMethod,
        paymentStatus: "PENDING",
        shippingAddress: shippingAddress || req.user.address || {},
        trackingLocation: {
          note: "Order placed",
          lat: null,
          lng: null,
          updatedAt: new Date()
        }
      });

      await CartItem.deleteMany({ userId: req.user._id });
      await logActivity({
        action: "ORDER_PLACED",
        user: req.user,
        req,
        meta: { orderId: order._id, totalAmount: order.totalAmount, paymentMethod: order.paymentMethod }
      });

      try {
        await sendAdminOrderEmail({ order, user: req.user });
      } catch (_e) {
      }

      return res.status(201).json({ message: "Order placed", order, onlinePayment: false });
    }

    if (!canUseRazorpay) {
      return res.status(503).json({
        message: "Online payment is not configured yet. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server/.env"
      });
    }

    const receipt = `afh_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const amountPaise = Math.round(totalAmount * 100);
    const gatewayOrder = await razorpayClient.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt,
      notes: {
        userId: String(req.user._id)
      }
    });

    const order = await Order.create({
      userId: req.user._id,
      items: orderItems,
      totalAmount,
      supportEmail: normalizeEmail(supportEmail) || req.user.email || "",
      paymentMethod,
      paymentStatus: "PENDING",
      paymentGateway: "RAZORPAY",
      paymentGatewayOrderId: gatewayOrder.id,
      shippingAddress: shippingAddress || req.user.address || {},
      trackingLocation: {
        note: "Waiting for payment",
        lat: null,
        lng: null,
        updatedAt: new Date()
      }
    });

    await logActivity({
      action: "ORDER_CREATED_PAYMENT_PENDING",
      user: req.user,
      req,
      meta: { orderId: order._id, totalAmount: order.totalAmount, paymentMethod: order.paymentMethod }
    });

    return res.status(201).json({
      message: "Payment initiated",
      onlinePayment: true,
      order,
      razorpay: {
        keyId: RAZORPAY_KEY_ID,
        orderId: gatewayOrder.id,
        amount: gatewayOrder.amount,
        currency: gatewayOrder.currency,
        name: STORE_NAME,
        description: "ArtfullHours Order Payment",
        prefill: {
          name: req.user.name || "",
          email: req.user.email || "",
          contact: req.user.phone || ""
        }
      }
    });
  } catch (error) {
    if (error.message === "Cart is empty" || error.message.includes("unavailable") || error.message.includes("Not enough stock")) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Checkout failed", error: error.message });
  }
});

app.post("/api/orders/:id/verify-payment", auth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment verification fields" });
    }

    if (!canUseRazorpay) {
      return res.status(503).json({ message: "Online payment verification is not configured" });
    }

    const order = await Order.findOne({ _id: req.params.id, userId: req.user._id });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.paymentStatus === "PAID") {
      return res.json({ message: "Payment already verified", order });
    }
    if (order.paymentGatewayOrderId !== razorpay_order_id) {
      return res.status(400).json({ message: "Payment order mismatch" });
    }

    const expected = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(401).json({ message: "Invalid payment signature" });
    }

    await reserveStockForOrder(order.items || []);

    order.paymentStatus = "PAID";
    order.paymentGatewayPaymentId = razorpay_payment_id;
    order.paymentGatewaySignature = razorpay_signature;
    order.paidAt = new Date();
    order.trackingLocation = {
      note: "Payment received. Order confirmed",
      lat: null,
      lng: null,
      updatedAt: new Date()
    };
    await order.save();

    await CartItem.deleteMany({ userId: req.user._id });

    await logActivity({
      action: "PAYMENT_VERIFIED",
      user: req.user,
      req,
      meta: {
        orderId: order._id,
        paymentGatewayOrderId: razorpay_order_id,
        paymentGatewayPaymentId: razorpay_payment_id,
        totalAmount: order.totalAmount
      }
    });

    try {
      await sendAdminOrderEmail({ order, user: req.user });
    } catch (_e) {
    }

    return res.json({ message: "Payment verified and order placed", order });
  } catch (error) {
    if (error.message.includes("Not enough stock") || error.message.includes("unavailable")) {
      return res.status(409).json({ message: error.message });
    }
    return res.status(500).json({ message: "Payment verification failed", error: error.message });
  }
});

app.get("/api/orders", auth, async (req, res) => {
  const query = req.user.role === "admin" ? {} : { userId: req.user._id };
  const orders = await Order.find(query).sort({ createdAt: -1 }).populate("userId", "name email phone");
  return res.json({ orders });
});

app.post("/api/products/:productId/feedback", auth, upload.fields([{ name: "media", maxCount: 10 }]), async (req, res) => {
  try {
    const { orderId, message } = req.body;
    const productId = req.params.productId;
    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (String(order.userId) !== String(req.user._id) && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to add feedback for this order" });
    }
    if (order.orderStatus !== "DELIVERED") {
      return res.status(400).json({ message: "Feedback can only be added after delivery" });
    }
    const orderedItem = (order.items || []).find((i) => String(i.productId) === String(productId));
    if (!orderedItem) {
      return res.status(400).json({ message: "Product not part of this order" });
    }

    const mediaUrls = String(req.body.mediaUrls || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
    const mediaFiles = (req.files && req.files.media) || [];
    const mediaList = buildMediaList({ fileEntries: mediaFiles, urlList: mediaUrls });

    const feedbackData = {
      userId: req.user._id,
      orderId: order._id,
      productId,
      productName: orderedItem.name || "",
      message: String(message || "").trim(),
      media: mediaList,
      updatedAt: new Date()
    };

    let feedback = await Feedback.findOne({ userId: req.user._id, orderId: order._id, productId });
    if (feedback) {
      feedback.message = feedbackData.message;
      feedback.media = feedbackData.media;
      feedback.updatedAt = new Date();
      await feedback.save();
    } else {
      feedback = await Feedback.create(feedbackData);
    }

    await logActivity({
      action: "FEEDBACK_SUBMITTED",
      user: req.user,
      req,
      meta: { feedbackId: feedback._id, productId, orderId: order._id }
    });

    return res.status(201).json({ message: "Feedback submitted", feedback });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Feedback already exists for this product order" });
    }
    return res.status(500).json({ message: "Failed to submit feedback", error: error.message });
  }
});

app.get("/api/products/:productId/feedback", auth, async (req, res) => {
  const feedback = await Feedback.find({ productId: req.params.productId })
    .sort({ createdAt: -1 })
    .populate("userId", "name");
  return res.json({ feedback });
});

app.get("/api/admin/feedback", auth, adminOnly, async (req, res) => {
  const query = {};
  if (req.query.productId) {
    query.productId = req.query.productId;
  }
  const feedback = await Feedback.find(query)
    .sort({ createdAt: -1 })
    .populate("userId", "name email")
    .populate("productId", "name");
  return res.json({ feedback });
});

app.post("/api/custom-requests", auth, upload.single("referenceImage"), async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    if (!title || !description) {
      return res.status(400).json({ message: "Title and description are required" });
    }

    const referenceImageUrl = req.file
      ? `/uploads/${req.file.filename}`
      : String(req.body.referenceImageUrl || "").trim();

    const customRequest = await CustomRequest.create({
      userId: req.user._id,
      customerName: req.user.name || "",
      customerEmail: req.user.email || "",
      customerPhone: req.user.phone || "",
      title,
      description,
      referenceImageUrl
    });

    try {
      await sendAdminCustomRequestEmail(customRequest);
    } catch (_e) {
    }

    await logActivity({
      action: "CUSTOM_REQUEST_CREATED",
      user: req.user,
      req,
      meta: { customRequestId: customRequest._id, title: customRequest.title }
    });

    return res.status(201).json({ message: "Customization request sent to the owner", customRequest });
  } catch (error) {
    return res.status(500).json({ message: "Failed to send customization request", error: error.message });
  }
});

app.get("/api/custom-requests", auth, async (req, res) => {
  const query = req.user.role === "admin" ? {} : { userId: req.user._id };
  const requests = await CustomRequest.find(query)
    .sort({ updatedAt: -1, createdAt: -1 })
    .populate("userId", "name email phone");
  return res.json({ requests });
});

app.put("/api/admin/custom-requests/:id", auth, adminOnly, async (req, res) => {
  try {
    const customRequest = await CustomRequest.findById(req.params.id);
    if (!customRequest) {
      return res.status(404).json({ message: "Customization request not found" });
    }

    const allowedStatus = ["NEW", "REVIEWING", "POSSIBLE", "NOT_POSSIBLE", "COMPLETED"];
    if (req.body.status && !allowedStatus.includes(req.body.status)) {
      return res.status(400).json({ message: "Invalid request status" });
    }

    if (req.body.status) customRequest.status = req.body.status;
    if (req.body.adminReply !== undefined) customRequest.adminReply = String(req.body.adminReply || "").trim();
    customRequest.repliedAt = new Date();
    customRequest.updatedAt = new Date();
    await customRequest.save();

    try {
      await sendCustomerCustomReplyEmail(customRequest);
    } catch (_e) {
    }

    await logActivity({
      action: "CUSTOM_REQUEST_UPDATED",
      user: req.user,
      req,
      meta: {
        customRequestId: customRequest._id,
        status: customRequest.status,
        hasReply: Boolean(customRequest.adminReply)
      }
    });

    return res.json({ message: "Customization request updated", customRequest });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update customization request", error: error.message });
  }
});

app.put("/api/orders/:id/status", auth, adminOnly, async (req, res) => {
  const { orderStatus, deliveryAgentPhone, trackingLocation, ownerReply } = req.body;
  const update = {};
  if (orderStatus) update.orderStatus = orderStatus;
  if (deliveryAgentPhone !== undefined) update.deliveryAgentPhone = deliveryAgentPhone;
  if (ownerReply !== undefined) update.ownerReply = String(ownerReply || "").trim();
  if (trackingLocation) {
    update.trackingLocation = {
      note: trackingLocation.note || "Status updated",
      lat: trackingLocation.lat,
      lng: trackingLocation.lng,
      updatedAt: new Date()
    };
  }
  const order = await Order.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!order) return res.status(404).json({ message: "Order not found" });
  const customer = await User.findById(order.userId).select("name email phone");

  try {
    await sendCustomerOrderUpdateEmail({ order, user: customer });
  } catch (_e) {
  }

  await logActivity({
    action: "ORDER_STATUS_UPDATED",
    user: req.user,
    req,
    meta: { orderId: order._id, orderStatus: order.orderStatus, hasOwnerReply: Boolean(order.ownerReply) }
  });
  return res.json({ message: "Order updated", order });
});

app.get("/api/admin/analytics", auth, adminOnly, async (_req, res) => {
  const totalUsers = await User.countDocuments({ role: "customer" });
  const totalOrders = await Order.countDocuments();
  const totalVisits = await Visit.countDocuments();
  const recentVisits = await Visit.find()
    .sort({ visitedAt: -1 })
    .limit(12)
    .populate("userId", "name email phone lastLoginAt");
  const customers = await User.find({ role: "customer" })
    .select("name email phone createdAt lastLoginAt")
    .sort({ createdAt: -1 })
    .limit(20);
  const products = await Product.find()
    .select("name category price stock isActive updatedAt imageUrl media")
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(30);
  const recentActivities = await Activity.find()
    .sort({ createdAt: -1 })
    .limit(120)
    .populate("userId", "name email phone role");
  const customRequests = await CustomRequest.find()
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(60)
    .populate("userId", "name email phone");
  return res.json({
    totalUsers,
    totalOrders,
    totalVisits,
    recentVisits,
    customers,
    products,
    recentActivities,
    customRequests
  });
});

app.get("/api/admin/activities", auth, adminOnly, async (req, res) => {
  const limit = Math.min(Math.max(toNumber(req.query.limit, 120), 20), 400);
  const activities = await Activity.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("userId", "name email phone role lastLoginAt");
  return res.json({ activities });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

app.get("/index.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

app.get("/login.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "../client/login.html"));
});

app.get("/signup.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "../client/signup.html"));
});

app.get("/app.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "../client/app.html"));
});

app.get(/.*/, (req, res) => {
  const requestPath = req.path;
  if (requestPath.startsWith("/api")) {
    return res.status(404).json({ message: "API route not found" });
  }
  if (requestPath.includes(".")) {
    return res.status(404).send("Not found");
  }
  res.sendFile(path.join(__dirname, "../client/index.html"));
});