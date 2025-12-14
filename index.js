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

function generateTrackingId() {
  const prefix = "TRK";
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const datePart = `${y}${m}${d}`;
  const randomBytes = crypto.randomBytes(5).toString("hex");
  const randomPart = parseInt(randomBytes, 16)
    .toString(36)
    .toUpperCase()
    .slice(0, 8);
  return `${prefix}-${datePart}-${randomPart}`;
}

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access - No header" });
  }
  const token = authHeader.split(" ")[1]; // Expecting "Bearer <token>"

  try {
    const decodedValue = await admin.auth().verifyIdToken(token);
    req.decoded = decodedValue;
    next();
  } catch (err) {
    return res
      .status(401)
      .send({ message: "unauthorized access - Invalid token" });
  }
};

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
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");

    const db = client.db("ticket-Bari-DB"); // Your Database Name
    const usersCollection = db.collection("users");
    const ticketsCollection = db.collection("tickets");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");
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
