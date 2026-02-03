const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');


const app = express();
const server = http.createServer(app);
const io = new Server(server);


app.use(express.static(path.join(__dirname, 'public')));


const vendors = new Map();


io.on('connection', (socket) => {
console.log('socket connected', socket.id);


socket.on('registerVendor', (data) => {
vendors.set(data.vendorId, { socketId: socket.id, lat: null, lng: null, meta: data.meta || {} });
console.log('vendor registered', data.vendorId);
});


socket.on('vendorLocationUpdate', (data) => {
const v = vendors.get(data.vendorId);
if (v) {
v.lat = data.lat;
v.lng = data.lng;
io.emit('vendorPosition', { vendorId: data.vendorId, lat: data.lat, lng: data.lng, meta: v.meta });
}
});


socket.on('callVendor', (data) => {
const v = vendors.get(data.vendorId);
if (v) {
io.to(v.socketId).emit('incomingCall', { customerId: data.customerId, customerLat: data.customerLat, customerLng: data.customerLng });
} else {
socket.emit('callFailed', { reason: 'vendor_offline' });
}
});


socket.on('disconnect', () => {
for (const [vendorId, info] of vendors.entries()) {
if (info.socketId === socket.id) {
vendors.delete(vendorId);
io.emit('vendorGone', { vendorId });
console.log('vendor disconnected', vendorId);
}
}
});
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on', PORT));