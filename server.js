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

const dataFile = path.join(__dirname, "data/vendorProfiles.json");
let vendorProfiles = {};

// Load vendorProfiles.json
try {
  vendorProfiles = JSON.parse(fs.readFileSync(dataFile));
} catch (err) {
  vendorProfiles = {};
}

function saveProfiles() {
  fs.writeFileSync(dataFile, JSON.stringify(vendorProfiles, null, 2));
}

// ------------------------
// Signup
// ------------------------
app.post("/signup", (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password) return res.json({ success: false, message: "Vendor ID and password required" });
  if (vendorProfiles[vendorId]) return res.json({ success: false, message: "Vendor already exists" });

  vendorProfiles[vendorId] = { password, status: "" };
  saveProfiles();
  res.json({ success: true });
});

// ------------------------
// Login
// ------------------------
app.post("/login", (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password) return res.json({ success: false, message: "Vendor ID and password required" });
  if (!vendorProfiles[vendorId] || vendorProfiles[vendorId].password !== password)
    return res.json({ success: false, message: "Invalid credentials" });

  res.json({ success: true, status: vendorProfiles[vendorId].status });
});

// ------------------------
// Update Profile (status)
// ------------------------
const activeVendors = new Map();

app.post("/updateProfile", (req, res) => {
  const { vendorId, status } = req.body;
  if (!vendorProfiles[vendorId]) vendorProfiles[vendorId] = { password: "", status: "" };
  vendorProfiles[vendorId].status = status;
  saveProfiles();

  // Update in-memory activeVendors
  if (activeVendors.has(vendorId)) {
    activeVendors.get(vendorId).meta.status = status;
    io.emit("vendorPosition", {
      vendorId,
      lat: activeVendors.get(vendorId).lat,
      lng: activeVendors.get(vendorId).lng,
      meta: activeVendors.get(vendorId).meta
    });
  }

  res.json({ success: true });
});

// ------------------------
// Socket.IO
// ------------------------
io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  // Vendor registration
  socket.on("registerVendor", data => {
    activeVendors.set(data.vendorId, {
      lat: null,
      lng: null,
      meta: { name: data.vendorId, status: vendorProfiles[data.vendorId]?.status || "" },
      socketId: socket.id
    });
    io.emit("vendorPosition", {
      vendorId: data.vendorId,
      lat: null,
      lng: null,
      meta: activeVendors.get(data.vendorId).meta
    });
  });

  // Customer registration
  socket.on("registerCustomer", () => {
    socket.emit("activeVendors", Array.from(activeVendors.entries()).map(([vendorId, info]) => ({
      vendorId,
      lat: info.lat,
      lng: info.lng,
      meta: info.meta
    })));
  });

  // Vendor updates location
  socket.on("vendorLocationUpdate", data => {
    if (activeVendors.has(data.vendorId)) {
      const vendor = activeVendors.get(data.vendorId);
      vendor.lat = data.lat;
      vendor.lng = data.lng;
      vendor.meta = { ...vendor.meta, status: data.profile?.status || vendor.meta.status };
    }

    io.emit("vendorPosition", {
      vendorId: data.vendorId,
      lat: data.lat,
      lng: data.lng,
      meta: activeVendors.get(data.vendorId).meta
    });
  });

  // Vendor stops sharing
  socket.on("vendorStop", data => {
    activeVendors.delete(data.vendorId);
    io.emit("vendorGone", { vendorId: data.vendorId });
  });

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

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
