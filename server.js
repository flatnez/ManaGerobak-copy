const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ====== JSON database for demo ======
const DATA_FILE = path.join(__dirname, "data", "vendorProfiles.json");

// Load vendor profiles from JSON
let vendorProfiles = {};
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE);
    vendorProfiles = JSON.parse(raw || "{}");
  }
} catch (err) {
  console.error("Error reading vendorProfiles.json:", err);
}

// Helper to save vendorProfiles to JSON
function saveProfiles() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(vendorProfiles, null, 2));
}

// ====== Vendor Signup ======
app.post("/signup", async (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password)
    return res.json({ success: false, message: "ID Gerobak dan password dibutuhkan" });

  if (vendorProfiles[vendorId])
    return res.json({ success: false, message: "Gerobak sudah terdaftar" });

  try {
    const hashed = await bcrypt.hash(password, 10);
    vendorProfiles[vendorId] = { password: hashed, status: "", profile: {} };
    saveProfiles();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Terjadi kesalahan saat membuat akun" });
  }
});

// ====== Vendor Login ======
app.post("/login", async (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password)
    return res.json({ success: false, message: "ID Gerobak dan password dibutuhkan" });

  const vendor = vendorProfiles[vendorId];
  if (!vendor) return res.json({ success: false, message: "Gerobak tidak ditemukan" });

  try {
    const valid = await bcrypt.compare(password, vendor.password);
    if (!valid) return res.json({ success: false, message: "Password salah" });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Terjadi kesalahan saat login" });
  }
});

// ====== Update Gerobak Profile/Status ======
app.post("/updateProfile", (req, res) => {
  const { vendorId, status, profile } = req.body;
  if (!vendorId) return res.json({ success: false, message: "ID Gerobak dibutuhkan" });

  if (!vendorProfiles[vendorId]) return res.json({ success: false, message: "Gerobak tidak ditemukan" });

  if (status !== undefined) vendorProfiles[vendorId].status = status;
  if (profile !== undefined) vendorProfiles[vendorId].profile = profile;

  saveProfiles();
  res.json({ success: true });
});

// ====== Socket.IO: Live Vendor Map ======
const activeVendors = new Map(); // vendorId -> { lat, lng, meta, socketId }

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("registerVendor", (data) => {
    activeVendors.set(data.vendorId, {
      lat: null,
      lng: null,
      meta: vendorProfiles[data.vendorId]?.profile || {},
      socketId: socket.id,
    });
  });

  socket.on("registerCustomer", () => {
    socket.emit(
      "activeVendors",
      Array.from(activeVendors.entries()).map(([vendorId, info]) => ({
        vendorId,
        lat: info.lat,
        lng: info.lng,
        meta: info.meta,
      }))
    );
  });

  socket.on("vendorLocationUpdate", (data) => {
    if (!data.vendorId) return;

    activeVendors.set(data.vendorId, {
      lat: data.lat,
      lng: data.lng,
      meta: data.profile || {},
      socketId: socket.id,
    });

    // Update JSON profile status
    if (data.profile?.status !== undefined) {
      if (!vendorProfiles[data.vendorId]) vendorProfiles[data.vendorId] = {};
      vendorProfiles[data.vendorId].status = data.profile.status;
      vendorProfiles[data.vendorId].profile = data.profile;
      saveProfiles();
    }

    io.emit("vendorPosition", {
      vendorId: data.vendorId,
      lat: data.lat,
      lng: data.lng,
      meta: data.profile || {},
    });
  });

  socket.on("vendorStop", (data) => {
    activeVendors.delete(data.vendorId);
    io.emit("vendorGone", { vendorId: data.vendorId });
  });

  socket.on("disconnect", () => {
    for (const [vendorId, info] of activeVendors.entries()) {
      if (info.socketId === socket.id) {
        activeVendors.delete(vendorId);
        io.emit("vendorGone", { vendorId });
      }
    }
  });
});

// ====== Catch-all route for SPA (needed for query params) ======
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ====== Start server ======
server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
