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

const dataPath = path.join(__dirname,"data/vendorProfiles.json");

// Load vendorProfiles from JSON
let vendorProfiles = {};
if(fs.existsSync(dataPath)){
    const raw = fs.readFileSync(dataPath);
    try { vendorProfiles = JSON.parse(raw); } catch(e){ vendorProfiles={}; }
}

// Helper untuk simpan JSON
function saveProfiles(){
    fs.writeFileSync(dataPath, JSON.stringify(vendorProfiles,null,2));
}

// ===== Signup =====
app.post("/signup", async (req,res)=>{
    const { vendorId, password } = req.body;
    if(!vendorId || !password) return res.json({success:false,message:"ID dan password harus diisi"});
    if(vendorProfiles[vendorId]) return res.json({success:false,message:"Gerobak sudah terdaftar"});
    const hash = await bcrypt.hash(password,10);
    vendorProfiles[vendorId] = { password: hash, status:"Tidak berbagi lokasi", profile:{} };
    saveProfiles();
    res.json({success:true});
});

// ===== Login =====
app.post("/login", async (req,res)=>{
    const { vendorId, password } = req.body;
    if(!vendorId || !password) return res.json({success:false,message:"ID dan password harus diisi"});
    const vendor = vendorProfiles[vendorId];
    if(!vendor) return res.json({success:false,message:"Gerobak tidak ditemukan"});
    const valid = await bcrypt.compare(password,vendor.password);
    if(!valid) return res.json({success:false,message:"Password salah"});
    res.json({success:true});
});

// ===== Update profile (status/jam buka/menu/foto) =====
app.post("/updateProfile",(req,res)=>{
    const { vendorId, profile } = req.body;
    if(!vendorId || !vendorProfiles[vendorId]) return res.json({success:false,message:"Gerobak tidak ditemukan"});
    vendorProfiles[vendorId].profile = profile || {};
    saveProfiles();
    res.json({success:true});
});

// ===== Update status lokasi =====
app.post("/updateStatus",(req,res)=>{
    const { vendorId,status } = req.body;
    if(!vendorId || !vendorProfiles[vendorId]) return res.json({success:false,message:"Gerobak tidak ditemukan"});
    vendorProfiles[vendorId].status = status || "Tidak berbagi lokasi";
    saveProfiles();
    res.json({success:true});
});

// ===== Socket.IO =====
const activeVendors = new Map(); // vendorId -> {lat,lng,profile,socketId}

io.on("connection",socket=>{
    console.log("Client connected:",socket.id);

    socket.on("registerVendor",data=>{
        activeVendors.set(data.vendorId,{lat:null,lng:null,profile:vendorProfiles[data.vendorId]?.profile||{},socketId:socket.id});
    });

    socket.on("registerCustomer",()=>{
        socket.emit("activeVendors",Array.from(activeVendors.entries()).map(([vendorId,info])=>({
            vendorId,lat:info.lat,lng:info.lng,meta:info.profile
        })));
    });

    socket.on("vendorLocationUpdate",data=>{
        if(!data.vendorId) return;
        activeVendors.set(data.vendorId,{lat:data.lat,lng:data.lng,profile:data.profile||{},socketId:socket.id});
        // update status
        vendorProfiles[data.vendorId].status = data.profile?.status || "Berbagi lokasi";
        saveProfiles();
        io.emit("vendorPosition",{vendorId:data.vendorId,lat:data.lat,lng:data.lng,meta:data.profile||{}});
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

server.listen(process.env.PORT||3000,()=>console.log("Server running..."));
