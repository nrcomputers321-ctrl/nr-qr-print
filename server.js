const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const UPI_ID = process.env.UPI_ID || "nageshmr@ybl";
const SHOP_NAME = process.env.SHOP_NAME || "NR QR PRINT SHOP";
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DATA_FILE = path.join(__dirname, "orders.json");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, Date.now() + "-" + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(pdf|jpg|jpeg|png|doc|docx)$/i.test(file.originalname);
    cb(allowed ? null : new Error("Allowed files: PDF, JPG, PNG, DOC, DOCX"), allowed);
  }
});

function readOrders() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return []; }
}
function writeOrders(orders) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
}
function adminOnly(req, res, next) {
  const pin = req.headers["x-admin-pin"];
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: "Admin PIN incorrect." });
  next();
}

app.get("/api/config", async (_req, res) => {
  const upiUri = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(SHOP_NAME)}&cu=INR`;
  try {
    const upiQr = await QRCode.toDataURL(upiUri, { width: 240, margin: 2 });
    const base = process.env.PUBLIC_URL || "";
    const uploadLink = base ? `${base}/` : `${_req.protocol}://${_req.get("host")}/`;
    const uploadQr = await QRCode.toDataURL(uploadLink, { width: 240, margin: 2 });
    res.json({ shopName: SHOP_NAME, upiId: UPI_ID, upiUri, upiQr, uploadQr, uploadLink, printers: [
      "IR 3300", "Epson L3210", "Canon 3010", "Epson L8050", "HP LaserJet M1005"
    ]});
  } catch { res.status(500).json({ error: "Could not generate QR codes." }); }
});

app.post("/api/orders", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Please choose a file." });
  const order = {
    id: "NR" + Date.now().toString().slice(-8),
    customer: String(req.body.customer || "Walk-in customer").slice(0, 100),
    phone: String(req.body.phone || "").slice(0, 20),
    fileName: req.file.originalname,
    storedFile: req.file.filename,
    size: req.file.size,
    paper: String(req.body.paper || "A4"),
    color: String(req.body.color || "Black & White"),
    sides: String(req.body.sides || "Single"),
    copies: Math.max(1, Math.min(500, Number(req.body.copies || 1))),
    printer: String(req.body.printer || "Epson L3210"),
    notes: String(req.body.notes || "").slice(0, 500),
    status: "Pending",
    paymentStatus: "Not verified",
    createdAt: new Date().toISOString()
  };
  const orders = readOrders();
  orders.unshift(order);
  writeOrders(orders);
  res.json({ ok: true, order });
});

app.post("/api/admin/login", (req, res) => {
  if (String(req.body.pin || "") !== ADMIN_PIN) return res.status(401).json({ error: "Wrong Admin PIN." });
  res.json({ ok: true });
});
app.get("/api/admin/orders", adminOnly, (_req, res) => res.json(readOrders()));
app.patch("/api/admin/orders/:id", adminOnly, (req, res) => {
  const allowedStatuses = ["Pending", "Printing", "Printed", "Cancelled"];
  const orders = readOrders();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (req.body.status && allowedStatuses.includes(req.body.status)) order.status = req.body.status;
  if (req.body.paymentStatus && ["Not verified", "Verified", "Rejected"].includes(req.body.paymentStatus)) order.paymentStatus = req.body.paymentStatus;
  writeOrders(orders);
  res.json({ ok: true, order });
});
app.get("/api/admin/files/:id", adminOnly, (req, res) => {
  const order = readOrders().find(o => o.id === req.params.id);
  if (!order) return res.status(404).send("Order not found");
  const filePath = path.join(UPLOAD_DIR, path.basename(order.storedFile));
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");
  res.download(filePath, order.fileName);
});

app.use((err, _req, res, _next) => {
  const status = err instanceof multer.MulterError ? 400 : 400;
  res.status(status).json({ error: err.message || "Upload failed." });
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`NR QR Print Shop running at http://localhost:${PORT}`);
  console.log(`Admin PIN: ${ADMIN_PIN} (change this before using on a network)`);
  console.log(`UPI ID: ${UPI_ID}`);
});
