// ==============================
// server.js
// ==============================

const fs = require("fs");
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");

// ------------------------------
// Ensure data folder and JSON exist
// ------------------------------
const dataDir = path.join(__dirname, "data");
const profilesPath = path.join(dataDir, "vendorProfiles.json");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(profilesPath)) fs.writeFileSync(profilesPath, "{}");

const vendorProfiles = JSON.parse(fs.readFileSync(profilesPath, "utf-8"));

function saveProfiles() {
  fs.writeFileSync(profilesPath, JSON.stringify(vendorProfiles, null, 2));
}

// ------------------------------
// Express + HTTP + Socket.IO setup
// ------------------------------
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Middleware
app.use(express.json()); // for parsing JSON from client
app.use(express.static(path.join(__dirname, "public"))); // serve index.html and images

// ------------------------------
// Vendor Profile Route
// ------------------------------
app.post("/updateProfile", (req, res) => {
  const { vendorId, name, status } = req.body;

  vendorProfiles[vendorId] = {
    name,
    status,
    lastUpdated: new Date().toISOString()
  };

  saveProfiles();

  console.log("Profile updated:", vendorId, name, status);
  res.json({ success: true });
});

// ------------------------------
// Active Vendors Map
// ------------------------------
const activeVendors = new Map(); 
// Structure: vendorId → { lat, lng, meta, socketId }

// ------------------------------
// Socket.IO logic
// ------------------------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Register Vendor
  socket.on("registerVendor", (data) => {
    activeVendors.set(data.vendorId, {
      lat: null,
      lng: null,
      meta: vendorProfiles[data.vendorId] || data.meta || {},
      socketId: socket.id
    });
    console.log("Vendor registered:", data.vendorId);
  });

  // Register Customer
  socket.on("registerCustomer", () => {
    socket.emit(
      "activeVendors",
      Array.from(activeVendors.entries()).map(([vendorId, info]) => ({
        vendorId,
        lat: info.lat,
        lng: info.lng,
        meta: info.meta
      }))
    );
  });

  // Vendor updates location
  socket.on("vendorLocationUpdate", (data) => {
    if (activeVendors.has(data.vendorId)) {
      activeVendors.get(data.vendorId).lat = data.lat;
      activeVendors.get(data.vendorId).lng = data.lng;
    }

    io.emit("vendorPosition", {
      vendorId: data.vendorId,
      lat: data.lat,
      lng: data.lng,
      meta: activeVendors.get(data.vendorId)?.meta || {}
    });
  });

  // Vendor stops sharing
  socket.on("vendorStop", (data) => {
    activeVendors.delete(data.vendorId);
    io.emit("vendorGone", { vendorId: data.vendorId });
  });

  // Handle disconnect
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

// ------------------------------
// Start Server
// ------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
