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

const dataFile = path.join(__dirname, "data/vendorProfiles.json");

// ===== Helper: load & save JSON =====
function loadProfiles() {
  if(!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, "{}");
  return JSON.parse(fs.readFileSync(dataFile));
}

function saveProfiles(profiles) {
  fs.writeFileSync(dataFile, JSON.stringify(profiles, null, 2));
}

// ===== Signup/Login (demo, simple JSON-based) =====
app.post("/signup", (req,res)=>{
  const {vendorId,password} = req.body;
  if(!vendorId || !password) return res.json({success:false,message:"Vendor ID dan password dibutuhkan"});
  let profiles = loadProfiles();
  if(profiles[vendorId]) return res.json({success:false,message:"Gerobak sudah terdaftar"});
  profiles[vendorId] = {password, profile:{}};
  saveProfiles(profiles);
  res.json({success:true});
});

app.post("/login",(req,res)=>{
  const {vendorId,password} = req.body;
  if(!vendorId || !password) return res.json({success:false,message:"Vendor ID dan password dibutuhkan"});
  let profiles = loadProfiles();
  if(!profiles[vendorId]) return res.json({success:false,message:"Gerobak tidak ditemukan"});
  if(profiles[vendorId].password !== password) return res.json({success:false,message:"Password salah"});
  res.json({success:true});
});

// ===== Update Gerobak Profile =====
app.post("/updateProfile",(req,res)=>{
  const {vendorId, profile} = req.body;
  if(!vendorId) return res.json({success:false,message:"Vendor ID dibutuhkan"});
  let profiles = loadProfiles();
  if(!profiles[vendorId]) return res.json({success:false,message:"Gerobak tidak ditemukan"});
  profiles[vendorId].profile = profile;
  saveProfiles(profiles);
  res.json({success:true});
});

// ===== Get Gerobak Profile =====
app.get("/getProfile",(req,res)=>{
  const vendorId = req.query.vendorId;
  if(!vendorId) return res.json({success:false,message:"Vendor ID dibutuhkan"});
  let profiles = loadProfiles();
  if(!profiles[vendorId]) return res.json({success:false,message:"Profil tidak ditemukan"});
  res.json({success:true, profile: profiles[vendorId].profile});
});

// ===== Socket.IO (vendor location sharing) =====
const activeVendors = new Map();
io.on("connection", socket=>{
  console.log("Client connected:", socket.id);

  socket.on("registerVendor", data=>{
    activeVendors.set(data.vendorId,{lat:null,lng:null,meta:{},socketId:socket.id});
  });
  socket.on("registerCustomer", ()=>{
    socket.emit("activeVendors", Array.from(activeVendors.entries()).map(([vendorId,info])=>({
      vendorId, lat:info.lat, lng:info.lng, meta: info.meta
    })));
  });
  socket.on("vendorLocationUpdate", async data=>{
    if(!data.vendorId) return;
    activeVendors.set(data.vendorId,{lat:data.lat,lng:data.lng,meta:data.profile||{},socketId:socket.id});
    io.emit("vendorPosition",{vendorId:data.vendorId, lat:data.lat, lng:data.lng, meta:data.profile||{}});
  });
  socket.on("vendorStop", data=>{
    activeVendors.delete(data.vendorId);
    io.emit("vendorGone",{vendorId:data.vendorId});
  });
  socket.on("disconnect",()=>{
    for(const [vendorId,info] of activeVendors.entries()){
      if(info.socketId===socket.id){
        activeVendors.delete(vendorId);
        io.emit("vendorGone",{vendorId});
      }
    }
  });
});

server.listen(process.env.PORT||3000,()=>console.log("Server running"));
