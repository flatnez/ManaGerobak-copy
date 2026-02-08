const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== JSON file for demo backend =====
const vendorProfilesPath = path.join(__dirname, "data", "vendorProfiles.json");

// Load vendor profiles from JSON file
function loadProfiles() {
  try {
    const data = fs.readFileSync(vendorProfilesPath, "utf8");
    return JSON.parse(data || "{}");
  } catch (err) {
    return {};
  }
}

// Save vendor profiles to JSON file
function saveProfiles(profiles) {
  fs.writeFileSync(vendorProfilesPath, JSON.stringify(profiles, null, 2));
}

// ================== Signup ==================
app.post("/signup", (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password) return res.json({ success: false, message: "ID Gerobak dan password wajib diisi" });

  const profiles = loadProfiles();
  if (profiles[vendorId]) return res.json({ success: false, message: "Gerobak sudah terdaftar" });

  profiles[vendorId] = { password, status: "", profile: {} };
  saveProfiles(profiles);

  res.json({ success: true });
});

// ================== Login ==================
app.post("/login", (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password) return res.json({ success: false, message: "ID Gerobak dan password wajib diisi" });

  const profiles = loadProfiles();
  if (!profiles[vendorId]) return res.json({ success: false, message: "Gerobak tidak ditemukan" });
  if (profiles[vendorId].password !== password) return res.json({ success: false, message: "Password salah" });

  res.json({ success: true });
});

// ================== Update Vendor Profile ==================
app.post("/updateProfile", (req, res) => {
  const { vendorId, status, profile } = req.body;
  if (!vendorId) return res.json({ success: false, message: "ID Gerobak wajib" });

  const profiles = loadProfiles();
  if (!profiles[vendorId]) return res.json({ success: false, message: "Gerobak tidak ditemukan" });

  profiles[vendorId].status = status || profiles[vendorId].status;
  profiles[vendorId].profile = profile || profiles[vendorId].profile;
  saveProfiles(profiles);

  res.json({ success: true });
});

// ====== Socket.IO Vendor Tracking ======
const activeVendors = new Map(); // vendorId → { lat, lng, meta, socketId }

io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  socket.on("registerVendor", data => {
    activeVendors.set(data.vendorId, { lat: null, lng: null, meta: {}, socketId: socket.id });
  });

  socket.on("registerCustomer", () => {
    socket.emit("activeVendors", Array.from(activeVendors.entries()).map(([vendorId, info]) => ({
      vendorId,
      lat: info.lat,
      lng: info.lng,
      meta: info.meta
    })));
  });

  socket.on("vendorLocationUpdate", data => {
    if (!data.vendorId) return;

    activeVendors.set(data.vendorId, {
      lat: data.lat,
      lng: data.lng,
      meta: data.profile || {},
      socketId: socket.id
    });

    // update JSON
    const profiles = loadProfiles();
    if (profiles[data.vendorId]) {
      profiles[data.vendorId].status = data.profile?.status || profiles[data.vendorId].status;
      profiles[data.vendorId].profile = data.profile || profiles[data.vendorId].profile;
      saveProfiles(profiles);
    }

    io.emit("vendorPosition", {
      vendorId: data.vendorId,
      lat: data.lat,
      lng: data.lng,
      meta: data.profile || {}
    });
  });

  socket.on("vendorStop", data => {
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

// ====== Catch-all route for Railway deployment ======
const publicPath = path.join(__dirname, "public");
app.use((req, res, next) => {
  res.sendFile(path.join(publicPath, "index.html"), err => {
    if (err) next(err);
  });
});

// ====== Start server ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));
