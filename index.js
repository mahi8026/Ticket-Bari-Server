const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); 
const port = process.env.PORT || 5000;
const crypto = require("crypto");
const admin = require("firebase-admin"); 
const serviceAccount = require("./serviceAccountKey.json");



admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});



// --- Middleware ---
app.use(express.json());
app.use(cors());



// --- Database Connection ---
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.ocjxb4e.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    
  } finally {
    
    // await client.close();
  }
}
run().catch(console.dir);

// --- Server Routes ---
app.get("/", (req, res) => {
  res.send("Ticket Bari Server is Running");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
