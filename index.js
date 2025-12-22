const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const crypto = require("crypto");
const admin = require("firebase-admin");
const { connect } = require("http2");

const port = process.env.PORT || 5000;

//const serviceAccount = require("./serviceAccountKey.json");
// const serviceAccount = require("./firebase-admin-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

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

async function run() {
  try {
    //await client.connect();
    //console.log(" Connected to MongoDB Atlas");

    const db = client.db("ticket-Bari-DB");
    const usersCollection = db.collection("users");
    const ticketsCollection = db.collection("tickets");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyVendor = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "vendor") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

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

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { role: "admin" } };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );
    app.patch(
      "/users/vendor/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { role: "vendor" } };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/tickets", async (req, res) => {
      try {
        const { search, filter, sort, page, limit } = req.query;

        let conditions = [{ verificationStatus: "approved" }];

        if (filter) {
          conditions.push({ ticketType: filter });
        }

        if (search) {
          const cleanedSearch = search.replace(/[^a-zA-Z0-9\s]/g, " ").trim();

          const searchKeywords = cleanedSearch
            .split(/\s+/)
            .filter((word) => word.length > 0);

          if (searchKeywords.length > 0) {
            const searchOrConditions = searchKeywords.flatMap((keyword) => [
              { from: { $regex: keyword, $options: "i" } },
              { to: { $regex: keyword, $options: "i" } },
            ]);
            conditions.push({ $or: searchOrConditions });
          }
        }
        let query = {};
        if (conditions.length > 0) {
          query = { $and: conditions };
        }

        // SORT LOGIC
        let sortOptions = { dateAdded: -1 };
        if (sort === "price_asc") {
          sortOptions = { price: 1 };
        } else if (sort === "price_desc") {
          sortOptions = { price: -1 };
        }

        const pageNumber = parseInt(page) || 1;
        const limitNumber = parseInt(limit) || 6;
        const skip = (pageNumber - 1) * limitNumber;

        const totalTickets = await ticketsCollection.countDocuments(query);
        const totalPages = Math.ceil(totalTickets / limitNumber);

        const tickets = await ticketsCollection
          .find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNumber)
          .toArray();

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

    app.patch(
      "/users/fraud/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };

        const updateDoc = { $set: { role: "fraud", status: "banned" } };
        const userUpdateResult = await usersCollection.updateOne(
          filter,
          updateDoc
        );
        const userToUpdate = await usersCollection.findOne({
          _id: new ObjectId(id),
        });
        if (userToUpdate && userToUpdate.email) {
          const ticketUpdateResult = await ticketsCollection.updateMany(
            { vendorEmail: userToUpdate.email },
            { $set: { verificationStatus: "fraud" } }
          );
          return res.send({ userUpdateResult, ticketUpdateResult });
        }

        res.send({ userUpdateResult });
      }
    );

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

    app.get("/tickets/vendor", verifyToken, verifyVendor, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const query = { vendorEmail: email };
      const tickets = await ticketsCollection.find(query).toArray();
      res.send(tickets);
    });

    app.get("/tickets/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(404).send("404 | Invalid Ticket ID Format.");
      }

      try {
        const query = { _id: new ObjectId(id) };
        const ticket = await ticketsCollection.findOne(query);

        if (!ticket) {
          return res.status(404).send("404 | Ticket Not Found.");
        }

        if (ticket.verificationStatus !== "approved") {
          return res
            .status(404)
            .send("404 | Ticket Not Found or Unauthorized Access.");
        }

        res.send(ticket);
      } catch (error) {
        console.error("Error fetching single ticket:", error);
        res.status(500).send("500 | Internal Server Error.");
      }
    });

    app.patch(
      "/tickets/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const newStatus = req.body.status;
        const result = await ticketsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { verificationStatus: newStatus } }
        );
        res.send(result);
      }
    );

    app.patch(
      "/tickets/advertise/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { isAdvertised } = req.body;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            isAdvertised: isAdvertised,
          },
        };
        const result = await ticketsCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    app.delete("/tickets/:id", verifyToken, verifyVendor, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ticketsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/bookings", verifyToken, async (req, res) => {
      const email = req.query.email;

      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden access." });
      }

      const query = { userEmail: email };
      const bookings = await bookingsCollection
        .find(query)
        .sort({ date: -1 })
        .toArray();
      res.send(bookings);
    });

    app.delete("/bookings/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const userEmail = req.decoded.email;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid booking ID format." });
      }

      try {
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).send({ message: "Booking not found." });
        }

        if (booking.userEmail !== userEmail) {
          return res.status(403).send({
            message: "Forbidden access: You do not own this booking.",
          });
        }

        if (booking.status === "paid") {
          return res.status(400).send({
            message:
              "Cannot delete a paid booking. Contact support for refunds.",
          });
        }

        const result = await bookingsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(500).send({ message: "Failed to delete booking." });
        }

        res.send(result);
      } catch (error) {
        console.error("Error deleting booking:", error);
        res
          .status(500)
          .send({ message: "Internal server error during deletion." });
      }
    });

    app.get("/bookings/vendor", verifyToken, verifyVendor, async (req, res) => {
      const vendorEmail = req.query.email;

      const pipeline = [
        {
          $lookup: {
            from: "tickets",
            localField: "ticketId",
            foreignField: "_id",
            as: "ticketInfo",
          },
        },
        {
          $unwind: "$ticketInfo",
        },
        {
          $match: {
            "ticketInfo.vendorEmail": vendorEmail,
          },
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            bookingDate: 1,
            quantity: 1,
            totalPrice: 1,
            status: 1,
            title: "$ticketInfo.title",
          },
        },
      ];

      const result = await bookingsCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    app.post("/bookings", verifyToken, async (req, res) => {
      const { ticketId, quantity, ...bookingData } = req.body;

      const numTickets = parseInt(quantity);

      if (isNaN(numTickets) || numTickets < 1) {
        return res.status(400).send({ message: "Invalid quantity provided." });
      }

      try {
        const updateTicket = await ticketsCollection.updateOne(
          {
            _id: new ObjectId(ticketId),
            seatsAvailable: { $gte: parseInt(numTickets) },
          },
          { $inc: { seatsAvailable: -numTickets } }
        );

        if (updateTicket.modifiedCount === 0) {
          return res.status(400).send({
            message: "This ticket is now sold out!",
          });
        }
        const result = await bookingsCollection.insertOne({
          ticketId,
          quantity: numTickets,
          ...bookingData,
          status: "pending",
          bookingDate: new Date(),
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.patch(
      "/bookings/status/:id",
      verifyToken,
      verifyVendor,
      async (req, res) => {
        const id = req.params.id;
        const newStatus = req.body.status;

        if (!["approved", "rejected"].includes(newStatus)) {
          return res.status(400).send({ message: "Invalid status provided." });
        }

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: newStatus } }
        );
        res.send(result);
      }
    );

    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      if (amount < 1) {
        return res.status(400).send({ message: "Invalid payment amount." });
      }

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).send({ message: "Failed to create payment intent." });
      }
    });

    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalTickets = await ticketsCollection.countDocuments();
        const totalBookings = await bookingsCollection.countDocuments();

        // Revenue is calculated from paid bookings/payments
        const totalRevenueResult = await paymentsCollection
          .aggregate([
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: "$totalPrice" },
              },
            },
          ])
          .toArray();

        const totalRevenue =
          totalRevenueResult.length > 0
            ? totalRevenueResult[0].totalRevenue
            : 0;

        res.send({
          totalUsers,
          totalTickets,
          totalBookings,
          totalRevenue: parseFloat(totalRevenue).toFixed(2),
        });
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).send({ message: "Failed to fetch admin statistics." });
      }
    });

    app.get("/payments", verifyToken, async (req, res) => {
      const email = req.query.email;

      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden access." });
      }

      try {
        const query = { email: email };
        const transactions = await paymentsCollection
          .find(query)
          .sort({ date: -1 })
          .toArray();

        res.send(transactions);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).send({ message: "Internal server error." });
      }
    });

    app.post("/payment", verifyToken, async (req, res) => {
      const payment = req.body;
      const { bookingId, ticketId, quantity } = payment;

      const paymentResult = await paymentsCollection.insertOne(payment);

      const bookingUpdateResult = await bookingsCollection.updateOne(
        { _id: new ObjectId(bookingId) },
        {
          $set: {
            status: "paid",
            transactionId: payment.transactionId,
            paymentDate: new Date(),
          },
        }
      );

      const ticketUpdateResult = await ticketsCollection.updateOne(
        { _id: new ObjectId(ticketId) },
        {
          $inc: {
            quantity: -quantity,
          },
        }
      );

      res.send({
        paymentResult,
        bookingUpdateResult,
        ticketUpdateResult,
        message: "Payment and booking successfully finalized.",
      });
    });

    app.patch("/bookings/pay/:id", verifyToken, async (req, res) => {
      const bookingId = req.params.id;
      const payment = req.body;
      const existingBooking = await bookingsCollection.findOne({
        _id: new ObjectId(bookingId),
      });
      if (!existingBooking || existingBooking.userEmail !== req.decoded.email) {
        return res
          .status(403)
          .send({ success: false, message: "Forbidden or Booking not found" });
      }

      const paymentRecord = {
        ...payment,
        email: req.decoded.email,
        date: new Date(),
        status: "paid",
      };

      try {
        const paymentRecord = {
          ...payment,
          email: req.decoded.email,
          date: new Date(),
          status: "paid",
        };

        const insertResult = await paymentsCollection.insertOne(paymentRecord);

        const bookingQuery = { _id: new ObjectId(bookingId) };
        const bookingUpdate = {
          $set: {
            status: "paid",
            transactionId: payment.transactionId,
            paymentDate: paymentRecord.date,
          },
        };
        const updateBookingResult = await bookingsCollection.updateOne(
          bookingQuery,
          bookingUpdate
        );

        const ticketQuery = { _id: new ObjectId(payment.ticketId) };
        const ticketUpdate = {
          $inc: { quantity: -payment.quantity },
        };
        const updateTicketResult = await ticketsCollection.updateOne(
          ticketQuery,
          ticketUpdate
        );

        res.send({
          success: true,
          message: "Payment processed successfully",
          insertResult,
          updateBookingResult,
          updateTicketResult,
        });
      } catch (error) {
        console.error("Payment finalization error:", error);
        res.status(500).send({
          success: false,
          message: "Server failed to finalize payment details.",
        });
      }
    });

    //await client.db("admin").command({ ping: 1 });
    // console.log(
    //" Pinged your deployment. Successfully connected to MongoDB!"
    //);
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
async function connectDB() {
  try {
    await client.connect();
    console.log(" Connected to MongoDB Atlas");
  } catch (e) {
    console.error(" MongoDB connection error:", e);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Ticket Bari Server is Running..");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;
