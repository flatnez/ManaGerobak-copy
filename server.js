const fs = require("fs");
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

const vendorProfilesPath="./data/vendorProfiles.json";
if(!fs.existsSync(vendorProfilesPath)) fs.writeFileSync(vendorProfilesPath,"{}");

const vendorProfiles=JSON.parse(fs.readFileSync(vendorProfilesPath));

function saveProfiles(){ fs.writeFileSync(vendorProfilesPath,JSON.stringify(vendorProfiles,null,2)); }

// =======================
// Signup Endpoint
// =======================
app.post("/signup",(req,res)=>{
  const {gerobakId,password} = req.body;
  if(!gerobakId||!password) return res.json({success:false,message:"Fill in all fields"});
  if(vendorProfiles[gerobakId]) return res.json({success:false,message:"Gerobak ID already exists"});
  vendorProfiles[gerobakId]={password,status:"",lastUpdated:new Date().toISOString()};
  saveProfiles();
  res.json({success:true});
});

// =======================
// Login Endpoint
// =======================
app.post("/login",(req,res)=>{
  const {gerobakId,password} = req.body;
  if(!gerobakId||!password) return res.json({success:false,message:"Fill in all fields"});
  const vendor=vendorProfiles[gerobakId];
  if(!vendor) return res.json({success:false,message:"Gerobak ID not found"});
  if(vendor.password!==password) return res.json({success:false,message:"Incorrect password"});
  res.json({success:true});
});

// =======================
// Vendor profile update
// =======================
app.post("/updateProfile",(req,res)=>{
  const {vendorId,status} = req.body;
  if(vendorId && vendorProfiles[vendorId]){
    vendorProfiles[vendorId].status=status||"";
    vendorProfiles[vendorId].lastUpdated=new Date().toISOString();
    saveProfiles();
  }
  res.json({success:true});
});

// =======================
// Socket.IO Real-time
// =======================
const activeVendors = new Map();

io.on("connection", socket=>{
  console.log("Client connected:",socket.id);

  socket.on("registerVendor",data=>{
    activeVendors.set(data.vendorId,{lat:null,lng:null,meta:{name:data.vendorId,status:vendorProfiles[data.vendorId]?.status||""},socketId:socket.id});
    // Send all active vendors to this vendor
    socket.emit("activeVendors",Array.from(activeVendors.entries()).map(([vendorId,info])=>({vendorId,lat:info.lat,lng:info.lng,meta:info.meta})));
    // Broadcast to all others
    socket.broadcast.emit("activeVendors",Array.from(activeVendors.entries()).map(([vendorId,info])=>({vendorId,lat:info.lat,lng:info.lng,meta:info.meta})));
  });

  socket.on("registerCustomer",()=>{
    socket.emit("activeVendors",Array.from(activeVendors.entries()).map(([vendorId,info])=>({vendorId,lat:info.lat,lng:info.lng,meta:info.meta})));
  });

  socket.on("vendorLocationUpdate",data=>{
    if(activeVendors.has(data.vendorId)){
      activeVendors.get(data.vendorId).lat=data.lat;
      activeVendors.get(data.vendorId).lng=data.lng;
      activeVendors.get(data.vendorId).meta=data.profile||activeVendors.get(data.vendorId).meta;
    }
    io.emit("vendorPosition",{vendorId:data.vendorId,lat:data.lat,lng:data.lng,meta:activeVendors.get(data.vendorId)?.meta||{}});
  });

  socket.on("vendorStop",data=>{
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

server.listen(process.env.PORT||3000,()=>{console.log("Server running")});
