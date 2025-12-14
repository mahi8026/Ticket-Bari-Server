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

// --- Middleware ---
app.use(express.json());
app.use(cors());

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access - No header" });
  }
  const token = authHeader.split(" ")[1];

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

    const db = client.db("ticket-Bari-DB");
    const usersCollection = db.collection("users");
    const ticketsCollection = db.collection("tickets");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/role/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role || "user" });
    });

    app.get("/users/profile/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden access." });
      }

      try {
        const user = await usersCollection.findOne(
          { email },
          {
            projection: { name: 1, email: 1, photo: 1, role: 1, status: 1 },
          }
        );

        if (!user) {
          return res.status(404).send({ message: "User not found." });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).send({ message: "Internal server error." });
      }
    });

    app.get("/tickets", async (req, res) => {
      try {
        const { search, filter, sort, page, limit } = req.query;

        let query = {
          
          verificationStatus: "approved",
        };

        if (search) {
        
          query.$or = [
            { title: { $regex: search, $options: "i" } },
            { route: { $regex: search, $options: "i" } },
          ];
        }

        if (filter) {
         
        }

        let sortOptions = { dateAdded: -1 };
        if (sort === "price_asc") {
         
          sortOptions = { price: 1 };
        } else if (sort === "price_desc") {
       
          sortOptions = { price: -1 };
        }
       
        const pageNumber = parseInt(page) || 1;
        const limitNumber = parseInt(limit) || 10;
        const skip = (pageNumber - 1) * limitNumber;

        const tickets = await ticketsCollection
          .find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNumber)
          .toArray();

        const totalTickets = await ticketsCollection.countDocuments(query);
        const totalPages = Math.ceil(totalTickets / limitNumber);

        res.send({
          tickets,
          totalTickets,
          totalPages,
          currentPage: pageNumber,
          limit: limitNumber,
        });
      } catch (error) {
        console.error("Error fetching tickets:", error);
        res.status(500).send({ message: "Failed to fetch tickets." });
      }
    });
     app.post("/tickets", verifyToken, verifyVendor, async (req, res) => {
      const ticket = req.body;
      const initialTicket = {
        ...ticket,
        verificationStatus: "pending", 
        isAdvertised: false,
        dateAdded: new Date(),
      };
      const result = await ticketsCollection.insertOne(initialTicket);
      res.send(result);
    });
    app.get("/tickets/advertised", async (req, res) => {
      
      const result = await ticketsCollection
        .find({ verificationStatus: "approved", isAdvertised: true })
        .limit(5)
        .toArray();
      res.send(result);
    });
    app.get("/tickets/all", verifyToken, verifyAdmin, async (req, res) => {
      const tickets = await ticketsCollection.find().toArray();
      res.send(tickets);
    });
     app.get("/tickets/latest", async (req, res) => {
      
      const result = await ticketsCollection
        .find({ verificationStatus: "approved" })
        .sort({ dateAdded: -1 }) 
        .limit(8)
        .toArray();
      res.send(result);
    });
    app.get("/tickets/approved", async (req, res) => {
      const result = await ticketsCollection
        .find({ verificationStatus: "approved" })
        .toArray();
      res.send(result);
    });


  } finally {
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
