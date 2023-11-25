const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// middlewares
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);
app.use(express.json());
app.use(cookieParser());

// custom middlewares
const verifyToken = (req, res, next) => {
  const token = req.cookies?.userToken;
  if (!token) {
    return res.status(401).send({ message: "Not Authorized" });
  }
  try {
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        console.log(err);
        return res.status(401).send({ message: "Not Authorized" });
      }
      // console.log("decoded user", decoded);
      req.user = decoded;
      next();
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error verifying token" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.y7tfc1b.mongodb.net/?retryWrites=true&w=majority`;

// const localURI = "mongodb://127.0.0.1:27017";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // database
    const database = client.db("inventoryManagement");

    // collections
    const userCollection = database.collection("users");
    const shopCollection = database.collection("shops");
    const productCollection = database.collection("products");

    // create token
    app.post("/jwt", async (req, res) => {
      const userInfo = req.body;
      try {
        const token = jwt.sign(userInfo, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "1hr",
        });
        console.log({ userInfo, token });
        res
          .cookie("userToken", token, {
            httpOnly: true,
            sameSite: "none",
            secure: true,
          })
          .send({ message: "Token generated Successfully.", userToken: token });
      } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Token generating failed." });
      }
    });

    // get all user
    app.get("/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    // create new user
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      // console.log(userInfo);
      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });

    // update user with shop info
    app.put("/user/addShopInfo", verifyToken, async (req, res) => {
      const shopDetails = req.body;
      try {
        // get user
        const user = await userCollection.findOne({ email: req.user?.email });
        if (user) {
          const updateInfo = {
            $set: {
              ...shopDetails,
            },
          };
          const result = await userCollection.updateOne(
            { email: user.email },
            updateInfo
          );
          res.send(result);
        }
      } catch (error) {
        console.log(error);
        res.send({ message: error?.message });
      }
    });

    // create shop
    app.post("/shops", verifyToken, async (req, res) => {
      const shopInfo = req.body;
      // console.log({ user: req.user, shopInfo });
      const alreadyHasShop = await shopCollection.findOne({
        ownerEmail: req.user?.email,
      });
      if (!alreadyHasShop) {
        const response = await shopCollection.insertOne(shopInfo);
        res.status(201).send(response);
      } else {
        res
          .status(403)
          .send({ message: "Forbidden, you can not create more than a shop" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("You have successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send(`
    <h1>
      <center>Server is running at PORT ${port}</center>
    </h1>
  `);
});

app.listen(port, () => {
  console.log(`app is running at PORT ${port}`);
});
