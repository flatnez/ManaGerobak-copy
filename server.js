const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ====== PostgreSQL Setup ======
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// ====== Vendor Map ======
const activeVendors = new Map(); 
// vendorId → { lat, lng, meta, socketId }

// ================== Signup ==================
app.post("/signup", async (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password) return res.json({ success: false, message: "Vendor ID and password required" });

  try {
    const exists = await pool.query("SELECT * FROM vendors WHERE vendor_id=$1", [vendorId]);
    if (exists.rows.length > 0) return res.json({ success: false, message: "Vendor already exists" });

    const hashed = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO vendors (vendor_id, password) VALUES ($1, $2)", [vendorId, hashed]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Error creating account" });
  }
});

// ================== Login ==================
app.post("/login", async (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password) return res.json({ success: false, message: "Vendor ID and password required" });

  try {
    const result = await pool.query("SELECT * FROM vendors WHERE vendor_id=$1", [vendorId]);
    if (result.rows.length === 0) return res.json({ success: false, message: "Vendor not found" });

    const vendor = result.rows[0];
    const valid = await bcrypt.compare(password, vendor.password);
    if (!valid) return res.json({ success: false, message: "Incorrect password" });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Error logging in" });
  }
});

// ================== Update Status ==================
app.post("/updateProfile", async (req, res) => {
  const { vendorId, status } = req.body;
  if (!vendorId) return res.json({ success: false, message: "Vendor ID required" });

  try {
    await pool.query("UPDATE vendors SET status=$1 WHERE vendor_id=$2", [status || "", vendorId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Error updating status" });
  }
});

// ================== Socket.IO ==================
io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  // Register Vendor
  socket.on("registerVendor", data => {
    activeVendors.set(data.vendorId, {
      lat: null,
      lng: null,
      meta: {},
      socketId: socket.id
    });
  });

  // Register Customer
  socket.on("registerCustomer", () => {
    socket.emit("activeVendors", Array.from(activeVendors.entries()).map(([vendorId, info]) => ({
      vendorId,
      lat: info.lat,
      lng: info.lng,
      meta: info.meta
    })));
  });

  // Vendor location update
  socket.on("vendorLocationUpdate", async data => {
    if (!data.vendorId) return;

    activeVendors.set(data.vendorId, {
      lat: data.lat,
      lng: data.lng,
      meta: data.profile || {},
      socketId: socket.id
    });

    // Update status in DB
    if (data.profile?.status !== undefined) {
      try {
        await pool.query("UPDATE vendors SET status=$1 WHERE vendor_id=$2", [data.profile.status, data.vendorId]);
      } catch (err) { console.error(err); }
    }

    io.emit("vendorPosition", {
      vendorId: data.vendorId,
      lat: data.lat,
      lng: data.lng,
      meta: data.profile || {}
    });
  });

  // Vendor stops sharing
  socket.on("vendorStop", data => {
    activeVendors.delete(data.vendorId);
    io.emit("vendorGone", { vendorId: data.vendorId });
  });

  // Disconnect
  socket.on("disconnect", () => {
    for (const [vendorId, info] of activeVendors.entries()) {
      if (info.socketId === socket.id) {
        activeVendors.delete(vendorId);
        io.emit("vendorGone", { vendorId });
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
