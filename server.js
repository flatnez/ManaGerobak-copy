const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// -----------------------------
// Vendor Profiles
// -----------------------------
const DATA_FILE = path.join(__dirname, "data/vendorProfiles.json");

// Ensure JSON file exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, "{}");
}

let vendorProfiles = JSON.parse(fs.readFileSync(DATA_FILE));

function saveProfiles() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(vendorProfiles, null, 2));
}

// -----------------------------
// Signup endpoint
// -----------------------------
app.post("/signup", (req, res) => {
  const { vendorId, password } = req.body;

  if (!vendorId || !password) {
    return res.status(400).json({ success: false, message: "Vendor ID and password required" });
  }

  if (vendorProfiles[vendorId]) {
    return res.status(400).json({ success: false, message: "Vendor ID already exists" });
  }

  // Save new vendor
  vendorProfiles[vendorId] = { password, status: "" };
  saveProfiles();

  return res.json({ success: true, message: "Signup successful" });
});

// -----------------------------
// Login endpoint
// -----------------------------
app.post("/login", (req, res) => {
  const { vendorId, password } = req.body;

  if (!vendorId || !password) {
    return res.status(400).json({ success: false, message: "Vendor ID and password required" });
  }

  const vendor = vendorProfiles[vendorId];

  if (!vendor || vendor.password !== password) {
    return res.status(401).json({ success: false, message: "Invalid Vendor ID or password" });
  }

  return res.json({ success: true, message: "Login successful" });
});

// -----------------------------
// Vendor Profile Update
// -----------------------------
app.post("/updateProfile", (req, res) => {
  const { vendorId, status } = req.body;

  if (!vendorId || !vendorProfiles[vendorId]) {
    return res.status(400).json({ success: false, message: "Invalid vendor" });
  }

  vendorProfiles[vendorId].status = status || "";
  saveProfiles();

  return res.json({ success: true });
});

// -----------------------------
// Real-time vendor location
// -----------------------------
const activeVendors = new Map(); // vendorId → { lat, lng, meta, socketId }

io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  // Vendor registers
  socket.on("registerVendor", data => {
    activeVendors.set(data.vendorId, {
      lat: null,
      lng: null,
      meta: data.meta || {},
      socketId: socket.id
    });
    console.log("Vendor registered:", data.vendorId);
  });

  // Customer registers
  socket.on("registerCustomer", () => {
    socket.emit("activeVendors", Array.from(activeVendors.entries()).map(([vendorId, info]) => ({
      vendorId,
      lat: info.lat,
      lng: info.lng,
      meta: info.meta
    })));
  });

  // Vendor location update
  socket.on("vendorLocationUpdate", data => {
    if (activeVendors.has(data.vendorId)) {
      activeVendors.get(data.vendorId).lat = data.lat;
      activeVendors.get(data.vendorId).lng = data.lng;
      activeVendors.get(data.vendorId).meta = data.profile || {};
    }

    io.emit("vendorPosition", {
      vendorId: data.vendorId,
      lat: data.lat,
      lng: data.lng,
      meta: activeVendors.get(data.vendorId)?.meta || {}
    });
  });

  // Vendor stops sharing
  socket.on("vendorStop", data => {
    activeVendors.delete(data.vendorId);
    io.emit("vendorGone", { vendorId: data.vendorId });
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const [vendorId, info] of activeVendors.entries()) {
      if (info.socketId === socket.id) {
        activeVendors.delete(vendorId);
        io.emit("vendorGone", { vendorId });
      }
    }
  });
});

// -----------------------------
// Start server
// -----------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
