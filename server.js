const fs = require("fs");
const vendorProfiles = JSON.parse(fs.readFileSync("./data/vendorProfiles.json"));

function saveProfiles() {
  fs.writeFileSync("./data/vendorProfiles.json", JSON.stringify(vendorProfiles, null, 2));
}

  /* -----------------------------
     Vendor Profile
  ----------------------------- */
app.post("/updateProfile", (req, res) => {
  const { vendorId, name, status } = req.body;

  vendorProfiles[vendorId] = {
    name,
    status,
    lastUpdated: new Date().toISOString()
  };

  saveProfiles();

  res.json({ success: true });
});

const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, "public")));

const activeVendors = new Map(); 
// Structure:
// vendorId → { lat, lng, meta, socketId }

io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  /* -----------------------------
     Register Vendor
  ----------------------------- */
  socket.on("registerVendor", data => {
    activeVendors.set(data.vendorId, {
      lat: null,
      lng: null,
      meta: data.meta || {},
      socketId: socket.id
    });
    console.log("Vendor registered:", data.vendorId);
  });

  /* -----------------------------
     Register Customer
  ----------------------------- */
  socket.on("registerCustomer", () => {
    // Immediately send all active vendors
    socket.emit("activeVendors", Array.from(activeVendors.entries()).map(([vendorId, info]) => ({
      vendorId,
      lat: info.lat,
      lng: info.lng,
      meta: info.meta
    })));
  });

  /* -----------------------------
     Vendor Updates Location
  ----------------------------- */
  socket.on("vendorLocationUpdate", data => {
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

  /* -----------------------------
     Vendor Stops Sharing
  ----------------------------- */
  socket.on("vendorStop", data => {
    activeVendors.delete(data.vendorId);
    io.emit("vendorGone", { vendorId: data.vendorId });
  });

  /* -----------------------------
     Handle Disconnect
  ----------------------------- */
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

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
