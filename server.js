const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const DATA_FILE = path.join(__dirname,"data/vendorProfiles.json");

// make sure vendorProfiles.json exists
if(!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE,"{}");

function readProfiles(){
  const raw=fs.readFileSync(DATA_FILE,"utf8");
  try{ return JSON.parse(raw)||{}; } 
  catch(e){ return {}; }
}
function saveProfiles(profiles){ fs.writeFileSync(DATA_FILE, JSON.stringify(profiles,null,2)); }

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

// -------------------- SIGNUP --------------------
app.post("/signup",(req,res)=>{
  const {vendorId,password}=req.body;
  if(!vendorId || !password) return res.json({success:false,message:"Vendor ID and password required"});
  const profiles=readProfiles();
  if(profiles[vendorId]) return res.json({success:false,message:"Vendor already exists"});
  profiles[vendorId]={password,status:""};
  saveProfiles(profiles);
  res.json({success:true});
});

// -------------------- LOGIN --------------------
app.post("/login",(req,res)=>{
  const {vendorId,password}=req.body;
  if(!vendorId || !password) return res.json({success:false,message:"Vendor ID and password required"});
  const profiles=readProfiles();
  if(!profiles[vendorId] || profiles[vendorId].password!==password)
    return res.json({success:false,message:"Invalid credentials"});
  res.json({success:true});
});

// -------------------- UPDATE STATUS --------------------
app.post("/updateProfile",(req,res)=>{
  const {vendorId,status}=req.body;
  if(!vendorId) return res.json({success:false});
  const profiles=readProfiles();
  if(profiles[vendorId]){
    profiles[vendorId].status=status||"";
    saveProfiles(profiles);
  }
  res.json({success:true});
});

// -------------------- SOCKET.IO --------------------
const activeVendors=new Map(); // vendorId → {lat,lng,meta,socketId}

io.on("connection",socket=>{
  console.log("Client connected:",socket.id);

  socket.on("registerVendor",data=>{
    activeVendors.set(data.vendorId,{lat:null,lng:null,meta:{},socketId:socket.id});
    // send all active vendors to everyone
    io.emit("activeVendors",Array.from(activeVendors.entries()).map(([vendorId,info])=>({vendorId,lat:info.lat,lng:info.lng,meta:info.meta})));
  });

  socket.on("registerCustomer",()=>{
    socket.emit("activeVendors",Array.from(activeVendors.entries()).map(([vendorId,info])=>({vendorId,lat:info.lat,lng:info.lng,meta:info.meta})));
  });

  socket.on("vendorLocationUpdate",data=>{
    if(activeVendors.has(data.vendorId)){
      const info=activeVendors.get(data.vendorId);
      info.lat=data.lat;
      info.lng=data.lng;
      info.meta=data.profile||{};
    }
    io.emit("vendorPosition",data);
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

server.listen(process.env.PORT||3000,()=>console.log("Server running"));
