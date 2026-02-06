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

    io.emit("vendorGone", {
      vendorId: data.vendorId
    });
  });

  /* -----------------------------
     When ANY client connects,
     send all active vendors
  ----------------------------- */
  socket.emit("initialVendorList",
    Array.from(activeVendors.entries()).map(([vendorId, info]) => ({
      vendorId,
      lat: info.lat,
      lng: info.lng,
      meta: info.meta
    }))
  );

  /* -----------------------------
     Handle Disconnect
  ----------------------------- */
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    for (const [vendorId, info] of activeVendors.entries()) {
      if (info.socketId === socket.id) {
        activeVendors.delete(vendorId);

        io.emit("vendorGone", {
          vendorId: vendorId
        });
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
