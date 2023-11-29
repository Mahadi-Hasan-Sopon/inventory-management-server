const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
    const cartCollection = database.collection("carts");
    const saleCollection = database.collection("sales");

    // create token
    app.post("/jwt", async (req, res) => {
      const userInfo = req.body;
      try {
        const token = jwt.sign(userInfo, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "10hr",
        });
        // console.log({ userInfo, token });
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

    const verifyAdmin = async (req, res, next) => {
      const userEmail = req.user?.email;
      if (!userEmail)
        return res.status(403).send({ message: "Forbidden Access" });
      const user = await userCollection.findOne({ email: userEmail });
      // console.log({ userEmail, user }, "In verify admin middleware");
      req.admin = user;
      next();
    };

    // get logged in user is admin or not
    app.get("/users/isAdmin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      let isAdmin = false;
      if (user) {
        isAdmin = user?.role === "admin";
      }
      res.send(isAdmin);
    });

    //  check if user own a shop
    app.get("/hasShop", verifyToken, async (req, res) => {
      const userEmail = req.user?.email;
      const user = await userCollection.findOne({ email: userEmail });
      if (!user) return res.status(401).send("Unauthorized Access.");
      const hasShop = user?.shopId ? true : false;
      res.send(hasShop);
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

    // get all shops - Admin
    app.get("/allShop", verifyToken, verifyAdmin, async (req, res) => {
      const shops = await shopCollection.find().toArray();
      res.send(shops);
    });

    // create shop
    app.post("/shops", verifyToken, async (req, res) => {
      const shopInfo = req.body;
      // console.log({ user: req.user, shopInfo });
      const alreadyHasShop = await shopCollection.findOne({
        ownerEmail: req.user?.email,
      });
      if (!alreadyHasShop) {
        const response = await shopCollection.insertOne({
          ...shopInfo,
          productLimit: 3,
        });
        res.status(201).send(response);
      } else {
        res
          .status(403)
          .send({ message: "Forbidden, you can not create more than a shop" });
      }
    });

    // get all products by shop
    app.get("/products", verifyToken, async (req, res) => {
      const userEmail = req.user?.email;
      const products = await productCollection
        .find({ ownerEmail: userEmail })
        .toArray();
      res.send(products);
    });

    // get single product by id
    app.get("/product/:productId", async (req, res) => {
      const productId = req.params.productId;
      // console.log({ productId });
      const result = await productCollection.findOne({
        _id: new ObjectId(productId),
      });
      res.send(result);
    });

    //  create new product
    app.post("/products", verifyToken, async (req, res) => {
      const productInfo = req.body;
      // console.log(productInfo);

      try {
        // get shop info to add product
        const shopInfo = await shopCollection.findOne({
          ownerEmail: req.user?.email,
        });
        if (!shopInfo) {
          return res.status(403).send({ message: "No Shop found" });
        }

        // check if shop product limit reached
        const hasLimit = await productCollection
          .find({ shopId: shopInfo._id })
          .toArray();

        // console.log({ hasLimit });

        if (hasLimit.length >= shopInfo.productLimit) {
          return res.status(403).send({ message: "Product Limit reached." });
        }

        const priceWithVat =
          parseFloat(productInfo?.productCost) +
          parseFloat((productInfo?.productCost * 7.5) / 100);

        const sellingPrice = Math.ceil(
          priceWithVat +
            parseFloat((priceWithVat * productInfo?.profitMargin) / 100)
        );

        const productDetails = {
          ...productInfo,
          shopId: shopInfo._id,
          shopName: shopInfo.shopName,
          ownerEmail: shopInfo.ownerEmail,
          sellingPrice: sellingPrice,
          salesCount: 0,
          createdAt: new Date(),
        };

        const result = await productCollection.insertOne(productDetails);
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(501).send({ message: "something went wrong" });
      }
    });

    // update single product
    app.put("/product/:productId", verifyToken, async (req, res) => {
      const productId = req.params.productId;
      const productInfo = req.body;

      const priceWithVat =
        parseFloat(productInfo?.productCost) +
        parseFloat((productInfo?.productCost * 7.5) / 100);

      const sellingPrice = Math.ceil(
        priceWithVat +
          parseFloat((priceWithVat * productInfo?.profitMargin) / 100)
      );

      productInfo.sellingPrice = sellingPrice;

      const updatedProduct = {
        $set: {
          ...productInfo,
        },
      };

      const result = await productCollection.updateOne(
        { _id: new ObjectId(productId) },
        updatedProduct
      );

      res.send(result);
    });

    // delete a product
    app.delete("/product/:productId", async (req, res) => {
      const productId = req.params.productId;
      const result = await productCollection.deleteOne({
        _id: new ObjectId(productId),
      });
      res.send(result);
    });

    // get cart items by shop
    app.get("/carts", verifyToken, async (req, res) => {
      const result = await cartCollection
        .find({ ownerEmail: req.user?.email })
        .toArray();
      res.send(result);
    });

    // add product to cart, (if exist increase quantity)
    app.put("/carts", verifyToken, async (req, res) => {
      const product = req.body;

      try {
        const isExist = await cartCollection.findOne({
          productId: product.productId,
        });

        if (isExist) {
          const updateQuantity = {
            $set: {
              soldQuantity: isExist.soldQuantity + 1,
            },
          };
          const result = await cartCollection.updateOne(
            { productId: product.productId },
            updateQuantity
          );
          res.send(result);
        } else {
          const result = await cartCollection.insertOne(product);
          res.send(result);
        }
      } catch (error) {
        res.status(501).send({ message: "Server error occurred." });
      }
    });

    // add product to Sales Collection
    app.post("/sales", verifyToken, async (req, res) => {
      const soldProducts = req.body;
      // insert data to sales collection with date time
      soldProducts.products.forEach((product) => {
        product["soldAt"] = new Date();
      });

      try {
        const salesResult = await saleCollection.insertMany(
          soldProducts.products,
          { ordered: true }
        );

        // Increase sales count and decrease quantity for each product

        const updateProductsSalesAndQuantity = soldProducts.products.map(
          async (product) => {
            const filter = {
              _id: new ObjectId(product.productId),
              productQuantity: { $gt: 0 },
            };

            const updateInfo = {
              $inc: {
                salesCount: product.soldQuantity,
              },
              $set: {
                productQuantity: product.productQuantity - product.soldQuantity,
              },
            };
            const updateResult = await productCollection.updateOne(
              filter,
              updateInfo
            );
            return updateResult.modifiedCount;
          }
        );
        const updateStatus = await Promise.all(updateProductsSalesAndQuantity);

        // clear cart
        const deleteFromCart = soldProducts.products.map(async (product) => {
          const cartFilter = {
            ownerEmail: product.ownerEmail,
            productId: product.productId,
          };
          const deleteResult = await cartCollection.deleteOne(cartFilter);
          return deleteResult.deletedCount;
        });
        const deleteStatus = await Promise.all(deleteFromCart);

        res.send({
          salesResult,
          updateStatus,
          deleteStatus,
          message: "Sales data inserted and products updated.",
        });
      } catch (error) {
        console.log("error in sales checkout", error);
        res.status(500).send({
          message: "Server error at adding sales and updating products",
        });
      }
    });

    // sales summary of shop {Total Invest, Profit, Sales}
    app.get("/salesSummary", verifyToken, async (req, res) => {
      const userEmail = req.user?.email;
      const userDetails = await userCollection.findOne({ email: userEmail });

      const salesSummary = await saleCollection
        .aggregate([
          { $match: { shopId: userDetails.shopId } },
          {
            $group: {
              _id: {
                $cond: {
                  if: {
                    $or: [
                      { $eq: ["$soldBy.name", null] },
                      { $eq: ["$soldBy.name", undefined] },
                    ],
                  },
                  then: "anonymous",
                  else: "$soldBy.name",
                },
              },
              totalSales: {
                $sum: { $multiply: ["$soldQuantity", "$sellingPrice"] },
              },
              totalInvest: {
                $sum: { $multiply: ["$soldQuantity", "$productCost"] },
              },
            },
          },
          {
            $addFields: {
              totalProfit: {
                $ceil: {
                  $multiply: [
                    { $subtract: ["$totalSales", "$totalInvest"] },
                    0.925, // 92.5% as a decimal
                  ],
                },
              },
            },
          },
        ])
        .toArray();
      console.log(salesSummary);
      res.send(salesSummary);
    });

    // get all sales by shopId
    app.get("/sales", verifyToken, async (req, res) => {
      const userEmail = req.user?.email;
      const userDetails = await userCollection.findOne({ email: userEmail });
      const sales = await saleCollection
        .find({ shopId: userDetails.shopId })
        .toArray();
      res.send(sales);
    });

    // get all sales for admin
    app.get(
      "/admin/salesSummary",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const adminIncome = req.admin?.income;
        const totalProducts = await productCollection.estimatedDocumentCount();
        const products = await productCollection.find().toArray();
        const totalSales = products.reduce(
          (acc, cur) => acc + parseInt(cur.salesCount * cur.sellingPrice),
          0
        );
        res.send({ totalSales, adminIncome, totalProducts });
      }
    );

    // payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      // console.log({ amount }, "from line 369");
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // increase product limit of shop
    app.put("/shops/increaseProductLimit", verifyToken, async (req, res) => {
      const userEmail = req.user?.email;
      const { productLimit } = req.body;
      // get shop info
      const shop = await shopCollection.findOne({ ownerEmail: userEmail });
      // if shop exist of this user update product limit
      if (shop) {
        const updatedLimit = { $set: { productLimit: productLimit } };
        const result = await shopCollection.updateOne(
          { _id: shop._id },
          updatedLimit
        );
        res.send(result);
      } else {
        res.status(404).send({ message: "No shop Found" });
      }
    });

    // add admin income based on product limit increase
    app.patch("/admin/increaseIncome", async (req, res) => {
      const { income } = req.body;
      const isUser = await userCollection.findOne({ role: "admin" });
      // console.log({ isUser, income });
      if (isUser) {
        const updatedIncome = {
          $set: { income: isUser.income + parseInt(income) },
        };
        const result = await userCollection.updateOne(
          { _id: isUser._id },
          updatedIncome
        );
        res.send(result);
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
