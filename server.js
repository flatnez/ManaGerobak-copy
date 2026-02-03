// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- SQLite Setup ---
const db = new sqlite3.Database('./gerobak.db');
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS gerobak (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      displayName TEXT
    )
  `);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// --- Routes ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/vendor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vendor.html')));
app.get('/customer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'customer.html')));

// --- Register ---
app.post('/register', (req, res) => {
  const { username, password, displayName } = req.body;
  const hash = bcrypt.hashSync(password, 10);

  db.run(
    `INSERT INTO gerobak (username, password, displayName) VALUES (?, ?, ?)`,
    [username, hash, displayName],
    function (err) {
      if (err) return res.send('Username already exists');
      res.cookie('vendorId', username, { maxAge: 7 * 24 * 60 * 60 * 1000 });
      res.redirect('/vendor?vendorId=' + username);
    }
  );
});

// --- Login ---
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM gerobak WHERE username=?`, [username], (err, row) => {
    if (!row) return res.send('Invalid username');
    if (!bcrypt.compareSync(password, row.password)) return res.send('Invalid password');
    res.cookie('vendorId', username, { maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect('/vendor?vendorId=' + username);
  });
});

// --- Socket.io for vendor locations ---
const vendors = new Map();

io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);

  socket.on('registerVendor', (data) => {
    vendors.set(data.vendorId, { socketId: socket.id, lat: null, lng: null, displayName: data.displayName });
  });

  socket.on('vendorLocationUpdate', (data) => {
    const v = vendors.get(data.vendorId);
    if (v) {
      v.lat = data.lat;
      v.lng = data.lng;
      io.emit('vendorPosition', { vendorId: data.vendorId, lat: data.lat, lng: data.lng, displayName: v.displayName });
    }
  });

  socket.on('disconnect', () => {
    for (const [vendorId, info] of vendors.entries()) {
      if (info.socketId === socket.id) {
        vendors.delete(vendorId);
        io.emit('vendorGone', { vendorId });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port', PORT));
