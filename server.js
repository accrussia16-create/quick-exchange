```js
const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DB_FILE = path.join(__dirname, "data", "db.json");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "change-this-secret";


// ==============================
// DATABASE
// ==============================

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {
      settings: {
        siteName: "Quick Exchange",

        rates: {
          easypaisa: 3.20,
          jazzcash: 3.18,
          usdt: 0.0115
        },

        feePercent: 0,

        minAmount: 100,
        maxAmount: 100000,

        methods: {
          easypaisa: true,
          jazzcash: true,
          usdt: true
        },

        contact: {
          whatsapp: "",
          telegram: ""
        }
      },

      upiLinks: [],
      orders: []
    };
  }
}

function writeDB(db) {
  fs.mkdirSync(path.dirname(DB_FILE), {
    recursive: true
  });

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db, null, 2)
  );
}


// ==============================
// HELPERS
// ==============================

function generateId(prefix) {
  return (
    prefix +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );
}


function isUPIActive(upi) {
  const now = Date.now();

  if (upi.enabled === false) {
    return false;
  }

  if (
    upi.startAt &&
    new Date(upi.startAt).getTime() > now
  ) {
    return false;
  }

  if (
    upi.expiresAt &&
    new Date(upi.expiresAt).getTime() <= now
  ) {
    return false;
  }

  return true;
}


function adminOnly(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }

  return res.status(401).json({
    error: "Unauthorized"
  });
}


// ==============================
// MIDDLEWARE
// ==============================

app.use(express.json({
  limit: "1mb"
}));

app.use(express.urlencoded({
  extended: true
}));

app.use(
  session({
    secret: SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);


// ==============================
// STATIC WEBSITE
// ==============================

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


// ==============================
// PUBLIC SETTINGS
// ==============================

app.get("/api/public", (req, res) => {
  const db = readDB();

  const activeUPI = (db.upiLinks || [])
    .filter(isUPIActive)
    .map(upi => ({
      id: upi.id,
      name: upi.name,
      url: upi.url
    }));

  res.json({
    siteName:
      db.settings.siteName,

    rates:
      db.settings.rates,

    feePercent:
      Number(db.settings.feePercent || 0),

    minAmount:
      Number(db.settings.minAmount || 0),

    maxAmount:
      Number(db.settings.maxAmount || 0),

    methods:
      db.settings.methods || {},

    contact:
      db.settings.contact || {},

    upiLinks:
      activeUPI
  });
});


// ==============================
// CREATE ORDER
// ==============================

app.post("/api/orders", (req, res) => {

  const db = readDB();

  const {
    payMethod,
    receiveMethod,
    amount,
    receiver
  } = req.body;


  // Only UPI is currently supported
  if (payMethod !== "upi") {
    return res.status(400).json({
      error: "Unsupported payment method"
    });
  }


  // Allowed receiving methods
  if (
    ![
      "easypaisa",
      "jazzcash",
      "usdt"
    ].includes(receiveMethod)
  ) {
    return res.status(400).json({
      error: "Invalid receiving method"
    });
  }


  const sendAmount = Number(amount);


  if (
    !Number.isFinite(sendAmount) ||
    sendAmount <= 0
  ) {
    return res.status(400).json({
      error: "Invalid amount"
    });
  }


  const settings =
    db.settings;


  // Amount limits
  if (
    sendAmount <
      Number(settings.minAmount || 0) ||

    sendAmount >
      Number(settings.maxAmount || Infinity)
  ) {
    return res.status(400).json({
      error:
        "Amount is outside the allowed range"
    });
  }


  // Check receiving method enabled
  if (
    settings.methods &&
    settings.methods[receiveMethod] === false
  ) {
    return res.status(400).json({
      error:
        "This receiving method is currently unavailable"
    });
  }


  // Get current rate
  const rate =
    Number(
      settings.rates[receiveMethod]
    );


  if (
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    return res.status(400).json({
      error:
        "Exchange rate is not configured"
    });
  }


  // Fee
  const feePercent =
    Number(
      settings.feePercent || 0
    );


  const grossReceive =
    sendAmount * rate;


  const feeAmount =
    grossReceive *
    (feePercent / 100);


  const finalReceive =
    grossReceive - feeAmount;


  const order = {

    id:
      generateId("EX"),

    createdAt:
      new Date().toISOString(),

    payMethod:
      "upi",

    receiveMethod:
      receiveMethod,

    sendAmount:
      sendAmount,

    // IMPORTANT:
    // Rate is locked when order is created
    rate:
      rate,

    feePercent:
      feePercent,

    receiveAmount:
      Number(
        finalReceive.toFixed(8)
      ),

    receiver:
      receiver || {},

    paymentRef:
      "",

    status:
      "pending",

    note:
      ""
  };


  db.orders.unshift(order);

  writeDB(db);


  res.json({
    ok: true,
    order
  });
});


// ==============================
// GET ORDER
// ==============================

app.get(
  "/api/orders/:id",
  (req, res) => {

    const db = readDB();

    const order =
      (db.orders || [])
        .find(
          order =>
            order.id ===
            req.params.id
        );


    if (!order) {
      return res.status(404).json({
        error: "Order not found"
      });
    }


    res.json({
      order
    });
  }
);


// ==============================
// ADMIN LOGIN
// ==============================

app.post(
  "/api/admin/login",
  (req, res) => {

    const {
      username,
      password
    } = req.body;


    if (
      username === ADMIN_USER &&
      password === ADMIN_PASS
    ) {

      req.session.admin = true;

      return res.json({
        ok: true
      });
    }


    res.status(401).json({
      error: "Invalid username or password"
    });
  }
);


// ==============================
// ADMIN LOGOUT
// ==============================

app.post(
  "/api/admin/logout",
  adminOnly,
  (req, res) => {

    req.session.destroy(() => {

      res.json({
        ok: true
      });

    });
  }
);


// ==============================
// ADMIN DATA
// ==============================

app.get(
  "/api/admin/data",
  adminOnly,
  (req, res) => {

    const db = readDB();

    res.json(db);
  }
);


// ==============================
// UPDATE SETTINGS
// ==============================

app.put(
  "/api/admin/settings",
  adminOnly,
  (req, res) => {

    const db = readDB();

    const body = req.body;


    db.settings.siteName =
      String(
        body.siteName ||
        db.settings.siteName
      );


    db.settings.rates = {

      easypaisa:
        Number(
          body.rates?.easypaisa
        ),

      jazzcash:
        Number(
          body.rates?.jazzcash
        ),

      usdt:
        Number(
          body.rates?.usdt
        )
    };


    db.settings.feePercent =
      Number(
        body.feePercent || 0
      );


    db.settings.minAmount =
      Number(
        body.minAmount || 0
      );


    db.settings.maxAmount =
      Number(
        body.maxAmount || 0
      );


    db.settings.methods = {

      easypaisa:
        Boolean(
          body.methods?.easypaisa
        ),

      jazzcash:
        Boolean(
          body.methods?.jazzcash
        ),

      usdt:
        Boolean(
          body.methods?.usdt
        )
    };


    db.settings.contact = {

      whatsapp:
        String(
          body.contact?.whatsapp || ""
        ),

      telegram:
        String(
          body.contact?.telegram || ""
        )
    };


    writeDB(db);


    res.json({
      ok: true,
      settings:
        db.settings
    });
  }
);


// ==============================
// ADD UPI
// ==============================

app.post(
  "/api/admin/upi",
  adminOnly,
  (req, res) => {

    const db = readDB();

    const {
      name,
      url,
      startAt,
      expiresAt
    } = req.body;


    if (!name || !url) {

      return res.status(400).json({
        error:
          "UPI name and payment URL are required"
      });
    }


    const upi = {

      id:
        generateId("UPI"),

      name:
        String(name),

      url:
        String(url),

      startAt:
        startAt || null,

      expiresAt:
        expiresAt || null,

      enabled:
        true,

      createdAt:
        new Date().toISOString()
    };


    db.upiLinks.push(upi);

    writeDB(db);


    res.json({
      ok: true,
      upi
    });
  }
);


// ==============================
// UPDATE UPI
// ==============================

app.put(
  "/api/admin/upi/:id",
  adminOnly,
  (req, res) => {

    const db = readDB();

    const upi =
      db.upiLinks.find(
        item =>
          item.id ===
          req.params.id
      );


    if (!upi) {

      return res.status(404).json({
        error:
          "UPI link not found"
      });
    }


    if (
      req.body.name !== undefined
    ) {
      upi.name =
        String(req.body.name);
    }


    if (
      req.body.url !== undefined
    ) {
      upi.url =
        String(req.body.url);
    }


    if (
      req.body.startAt !== undefined
    ) {
      upi.startAt =
        req.body.startAt ||
        null;
    }


    if (
      req.body.expiresAt !== undefined
    ) {
      upi.expiresAt =
        req.body.expiresAt ||
        null;
    }


    if (
      req.body.enabled !== undefined
    ) {
      upi.enabled =
        Boolean(req.body.enabled);
    }


    writeDB(db);


    res.json({
      ok: true,
      upi
    });
  }
);


// ==============================
// DELETE UPI
// ==============================

app.delete(
  "/api/admin/upi/:id",
  adminOnly,
  (req, res) => {

    const db = readDB();

    db.upiLinks =
      db.upiLinks.filter(
        upi =>
          upi.id !==
          req.params.id
      );


    writeDB(db);


    res.json({
      ok: true
    });
  }
);


// ==============================
// UPDATE ORDER
// ==============================

app.put(
  "/api/admin/orders/:id",
  adminOnly,
  (req, res) => {

    const db = readDB();

    const order =
      db.orders.find(
        item =>
          item.id ===
          req.params.id
      );


    if (!order) {

      return res.status(404).json({
        error:
          "Order not found"
      });
    }


    if (
      req.body.status
    ) {
      order.status =
        String(req.body.status);
    }


    if (
      req.body.paymentRef !==
      undefined
    ) {
      order.paymentRef =
        String(
          req.body.paymentRef
        );
    }


    if (
      req.body.note !==
      undefined
    ) {
      order.note =
        String(
          req.body.note
        );
    }


    writeDB(db);


    res.json({
      ok: true,
      order
    });
  }
);


// ==============================
// ADMIN PAGE
// ==============================

app.get(
  "/admin",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);


// ==============================
// ORDER PAGE
// ==============================

app.get(
  "/order",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "order.html"
      )
    );
  }
);


// ==============================
// STATUS PAGE
// ==============================

app.get(
  "/status",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "status.html"
      )
    );
  }
);


// ==============================
// START SERVER
// ==============================

app.listen(
  PORT,
  () => {

    console.log(
      `Exchange site running on port ${PORT}`
    );

  }
);
```
