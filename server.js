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

const vendorFile = path.join(__dirname, "vendorProfiles.json");

// Load vendor profiles
let vendorProfiles = {};
try {
  if (fs.existsSync(vendorFile)) {
    const raw = fs.readFileSync(vendorFile);
    vendorProfiles = JSON.parse(raw || "{}");
  } else {
    fs.writeFileSync(vendorFile, "{}");
  }
} catch (err) {
  console.error("Error reading vendorProfiles.json:", err);
}

// Save vendor profiles to JSON
function saveProfiles() {
  fs.writeFileSync(vendorFile, JSON.stringify(vendorProfiles, null, 2));
}

// ================== Signup ==================
app.post("/signup", async (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password) return res.json({ success: false, message: "Vendor ID and password required" });

  if (vendorProfiles[vendorId]) return res.json({ success: false, message: "Vendor already exists" });

  const hashed = await bcrypt.hash(password, 10);
  vendorProfiles[vendorId] = { password: hashed, status: "" };
  saveProfiles();

  res.json({ success: true });
});

// ================== Login ==================
app.post("/login", async (req, res) => {
  const { vendorId, password } = req.body;
  if (!vendorId || !password) return res.json({ success: false, message: "Vendor ID and password required" });

  const vendor = vendorProfiles[vendorId];
  if (!vendor) return res.json({ success: false, message: "Vendor not found" });

  const valid = await bcrypt.compare(password, vendor.password);
  if (!valid) return res.json({ success: false, message: "Incorrect password" });

  res.json({ success: true });
});

// ================== Update Status ==================
app.post("/updateProfile", (req, res) => {
  const { vendorId, status } = req.body;
  if (!vendorId) return res.json({ success: false, message: "Vendor ID required" });

  if (!vendorProfiles[vendorId]) return res.json({ success: false, message: "Vendor not found" });

  vendorProfiles[vendorId].status = status || "";
  saveProfiles();

  res.json({ success: true });
});

// ================== Socket.IO ==================
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
    activeVendors.set(data.vendorId, { lat: data.lat, lng: data.lng, meta: data.profile || {}, socketId: socket.id });

    // Update status in JSON
    if (data.profile?.status !== undefined && vendorProfiles[data.vendorId]) {
      vendorProfiles[data.vendorId].status = data.profile.status;
      saveProfiles();
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

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port 3000");
});
