const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const app = express();

// Railway / reverse proxy
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

const DB_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DB_DIR, "db.json");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me";

const SESSION_SECRET =
  process.env.SESSION_SECRET || "change-this-session-secret";

// =====================================================
// DEFAULT DATABASE
// =====================================================

const DEFAULT_DB = {
  settings: {
    siteName: "Quick Exchange",
    feePercent: 0,
    minAmount: 100,
    maxAmount: 100000,
    contact: {
      whatsapp: "",
      telegram: ""
    }
  },

  paymentMethods: [
    {
      id: "easypaisa",
      name: "EasyPaisa",
      description: "Receive through EasyPaisa",
      rate: 3.2,
      flag: "🇵🇰",
      logo: "",
      enabled: true,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "jazzcash",
      name: "JazzCash",
      description: "Receive through JazzCash",
      rate: 3.18,
      flag: "🇵🇰",
      logo: "",
      enabled: true,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "usdt",
      name: "USDT",
      description: "Receive USDT cryptocurrency",
      rate: 0.0115,
      flag: "🌐",
      logo: "",
      enabled: true,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],

  upiLinks: [],
  orders: []
};

// =====================================================
// DATABASE
// =====================================================

function ensureDatabase() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(DEFAULT_DB, null, 2),
      "utf8"
    );
  }
}

function readDatabase() {
  ensureDatabase();

  const raw = fs.readFileSync(DB_FILE, "utf8");

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("db.json contains invalid JSON.");
  }

  // Migration from older version
  let paymentMethods = parsed.paymentMethods;

  if (!Array.isArray(paymentMethods)) {
    paymentMethods = [
      {
        id: "easypaisa",
        name: "EasyPaisa",
        description: "Receive through EasyPaisa",
        rate: parsed.settings?.rates?.easypaisa || 3.2,
        flag: "🇵🇰",
        logo: "",
        enabled:
          parsed.settings?.methods?.easypaisa !== false,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "jazzcash",
        name: "JazzCash",
        description: "Receive through JazzCash",
        rate: parsed.settings?.rates?.jazzcash || 3.18,
        flag: "🇵🇰",
        logo: "",
        enabled:
          parsed.settings?.methods?.jazzcash !== false,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "usdt",
        name: "USDT",
        description: "Receive USDT cryptocurrency",
        rate: parsed.settings?.rates?.usdt || 0.0115,
        flag: "🌐",
        logo: "",
        enabled:
          parsed.settings?.methods?.usdt !== false,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }

  return {
    settings: {
      ...DEFAULT_DB.settings,
      ...(parsed.settings || {}),
      contact: {
        ...DEFAULT_DB.settings.contact,
        ...(parsed.settings?.contact || {})
      }
    },

    paymentMethods,

    upiLinks: Array.isArray(parsed.upiLinks)
      ? parsed.upiLinks
      : [],

    orders: Array.isArray(parsed.orders)
      ? parsed.orders
      : []
  };
}

function writeDatabase(db) {
  ensureDatabase();

  const temp = DB_FILE + ".tmp";

  fs.writeFileSync(
    temp,
    JSON.stringify(db, null, 2),
    "utf8"
  );

  fs.renameSync(temp, DB_FILE);
}

// =====================================================
// HELPERS
// =====================================================

function cleanString(value, max = 500) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim().slice(0, max);
}

function numberValue(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  return n;
}

function generateId(prefix) {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random()
      .toString(36)
      .substring(2, 8)
  ).toUpperCase();
}

function validDate(value) {
  if (!value) return null;

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return d;
}

// =====================================================
// UPI STATUS
// =====================================================

function getUpiState(upi) {
  if (!upi) return "disabled";

  if (upi.archived) {
    return "archived";
  }

  if (upi.enabled === false) {
    return "disabled";
  }

  const now = Date.now();

  if (upi.startAt) {
    const start = new Date(upi.startAt).getTime();

    if (Number.isFinite(start) && now < start) {
      return "scheduled";
    }
  }

  if (upi.expiryAt) {
    const expiry = new Date(upi.expiryAt).getTime();

    if (
      Number.isFinite(expiry) &&
      now >= expiry
    ) {
      return "expired";
    }
  }

  return "active";
}

// Automatically archive expired UPI records
function archiveExpiredUpi(db) {
  let changed = false;

  for (const upi of db.upiLinks) {
    if (
      !upi.archived &&
      upi.expiryAt &&
      Date.now() >=
        new Date(upi.expiryAt).getTime()
    ) {
      upi.archived = true;
      upi.enabled = false;
      upi.updatedAt = new Date().toISOString();

      changed = true;
    }
  }

  if (changed) {
    writeDatabase(db);
  }
}

function publicUpi(upi) {
  return {
    id: upi.id,
    name: upi.name,
    label: upi.label || "",
    url: upi.url,
    startAt: upi.startAt || null,
    expiryAt: upi.expiryAt || null,
    state: getUpiState(upi)
  };
}

// =====================================================
// EXPRESS
// =====================================================

app.use(
  express.json({
    limit: "6mb"
  })
);

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

// =====================================================
// ADMIN AUTH
// =====================================================

function adminOnly(req, res, next) {
  if (
    req.session &&
    req.session.admin === true
  ) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message:
      "Unauthorized. Please login again."
  });
}

// =====================================================
// PUBLIC DATA
// =====================================================

app.get("/api/public", (req, res) => {
  try {
    const db = readDatabase();

    archiveExpiredUpi(db);

    const methods = db.paymentMethods
      .filter(
        method =>
          method.enabled &&
          !method.archived
      )
      .map(method => ({
        id: method.id,
        name: method.name,
        description: method.description,
        rate: method.rate,
        flag: method.flag,
        logo: method.logo || ""
      }));

    const upiLinks = db.upiLinks
      .filter(
        upi =>
          getUpiState(upi) === "active"
      )
      .map(publicUpi);

    res.json({
      success: true,

      settings: {
        siteName:
          db.settings.siteName,

        feePercent:
          db.settings.feePercent,

        minAmount:
          db.settings.minAmount,

        maxAmount:
          db.settings.maxAmount,

        contact:
          db.settings.contact
      },

      paymentMethods: methods,

      upiLinks
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message:
        "Unable to load exchange information."
    });
  }
});

// =====================================================
// CREATE ORDER
// =====================================================

app.post("/api/orders", (req, res) => {
  try {
    const db = readDatabase();

    const amount = numberValue(
      req.body.amount
    );

    const receiveMethod =
      cleanString(
        req.body.receiveMethod,
        100
      );

    const receiverName =
      cleanString(
        req.body.receiverName,
        150
      );

    const receiverNumber =
      cleanString(
        req.body.receiverNumber,
        150
      );

    const wallet =
      cleanString(
        req.body.wallet,
        300
      );

    const network =
      cleanString(
        req.body.network,
        50
      ).toUpperCase();

    if (
      amount === null ||
      amount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter a valid amount."
      });
    }

    if (
      amount <
      Number(db.settings.minAmount)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Minimum amount is " +
          db.settings.minAmount
      });
    }

    if (
      amount >
      Number(db.settings.maxAmount)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Maximum amount is " +
          db.settings.maxAmount
      });
    }

    const method =
      db.paymentMethods.find(
        item =>
          item.id === receiveMethod &&
          item.enabled &&
          !item.archived
      );

    if (!method) {
      return res.status(400).json({
        success: false,
        message:
          "Selected payment method is unavailable."
      });
    }

    if (
      method.id === "easypaisa" ||
      method.id === "jazzcash"
    ) {
      if (!receiverName) {
        return res.status(400).json({
          success: false,
          message:
            "Receiver name is required."
        });
      }

      if (!receiverNumber) {
        return res.status(400).json({
          success: false,
          message:
            "Receiver number is required."
        });
      }
    }

    if (method.id === "usdt") {
      if (!wallet) {
        return res.status(400).json({
          success: false,
          message:
            "USDT wallet address is required."
        });
      }

      if (
        ![
          "TRC20",
          "BEP20",
          "ERC20"
        ].includes(network)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Please select a valid USDT network."
        });
      }
    }

    const rate =
      numberValue(method.rate);

    if (
      rate === null ||
      rate <= 0
    ) {
      return res.status(500).json({
        success: false,
        message:
          "Exchange rate is not configured."
      });
    }

    const feePercent =
      numberValue(
        db.settings.feePercent
      ) || 0;

    const gross =
      amount * rate;

    const fee =
      gross *
      (feePercent / 100);

    const receiveAmount =
      gross - fee;

    let orderId;

    do {
      orderId =
        generateId("QE-");
    } while (
      db.orders.some(
        order =>
          order.id === orderId
      )
    );

    const order = {
      id: orderId,

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),

      status: "pending",

      amount,

      paymentMethod:
        method.id,

      paymentMethodName:
        method.name,

      rate,

      feePercent,

      feeAmount:
        Number(fee.toFixed(8)),

      receiveAmount:
        Number(
          receiveAmount.toFixed(8)
        ),

      receiver: {
        name: receiverName,
        number: receiverNumber,
        wallet,
        network
      },

      selectedUpiId: null,

      paymentReference: "",

      adminNote: ""
    };

    db.orders.push(order);

    writeDatabase(db);

    res.status(201).json({
      success: true,

      order: {
        id: order.id,
        createdAt:
          order.createdAt,
        status:
          order.status,
        amount:
          order.amount,
        paymentMethod:
          order.paymentMethod,
        paymentMethodName:
          order.paymentMethodName,
        rate:
          order.rate,
        feePercent:
          order.feePercent,
        feeAmount:
          order.feeAmount,
        receiveAmount:
          order.receiveAmount
      }
    });
  } catch (error) {
    console.error(
      "Create order:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to create order."
    });
  }
});

// =====================================================
// GET ORDER
// =====================================================

app.get(
  "/api/orders/:id",
  (req, res) => {
    try {
      const db = readDatabase();

      const order =
        db.orders.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found."
        });
      }

      res.json({
        success: true,

        order
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to load order."
      });
    }
  }
);

// =====================================================
// UPDATE CUSTOMER PAYMENT REFERENCE
// =====================================================

app.put(
  "/api/orders/:id",
  (req, res) => {
    try {
      const db = readDatabase();

      const order =
        db.orders.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found."
        });
      }

      if (
        req.body.paymentReference !==
        undefined
      ) {
        order.paymentReference =
          cleanString(
            req.body.paymentReference,
            200
          );
      }

      order.updatedAt =
        new Date().toISOString();

      writeDatabase(db);

      res.json({
        success: true,
        message:
          "Payment reference saved."
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to update order."
      });
    }
  }
);

// =====================================================
// SELECT UPI
// =====================================================

app.post(
  "/api/orders/:id/select-upi",
  (req, res) => {
    try {
      const db = readDatabase();

      archiveExpiredUpi(db);

      const order =
        db.orders.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found."
        });
      }

      const upiId =
        cleanString(
          req.body.upiId,
          100
        );

      const upi =
        db.upiLinks.find(
          item =>
            item.id === upiId
        );

      if (!upi) {
        return res.status(404).json({
          success: false,
          message:
            "UPI not found."
        });
      }

      if (
        getUpiState(upi) !==
        "active"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This UPI payment option has expired."
        });
      }

      order.selectedUpiId =
        upi.id;

      order.updatedAt =
        new Date().toISOString();

      writeDatabase(db);

      res.json({
        success: true,
        url: upi.url
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to select UPI."
      });
    }
  }
);

// =====================================================
// ADMIN LOGIN
// =====================================================

app.post(
  "/api/admin/login",
  (req, res) => {
    const username =
      cleanString(
        req.body.username,
        100
      );

    const password =
      String(
        req.body.password || ""
      );

    if (
      username !== ADMIN_USER ||
      password !== ADMIN_PASS
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid username or password."
      });
    }

    req.session.admin = true;
    req.session.username =
      ADMIN_USER;

    req.session.save(error => {
      if (error) {
        console.error(
          "Session error:",
          error
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to create session."
        });
      }

      res.json({
        success: true,
        message:
          "Login successful."
      });
    });
  }
);

// =====================================================
// ADMIN LOGOUT
// =====================================================

app.post(
  "/api/admin/logout",
  (req, res) => {
    req.session.destroy(
      error => {
        if (error) {
          return res.status(500).json({
            success: false
          });
        }

        res.clearCookie(
          "connect.sid"
        );

        res.json({
          success: true
        });
      }
    );
  }
);

// =====================================================
// ADMIN ME
// =====================================================

app.get(
  "/api/admin/me",
  (req, res) => {
    if (
      req.session &&
      req.session.admin
    ) {
      return res.json({
        success: true,
        authenticated: true,
        username:
          req.session.username
      });
    }

    res.status(401).json({
      success: false,
      authenticated: false
    });
  }
);

// =====================================================
// ADMIN DATA
// =====================================================

app.get(
  "/api/admin/data",
  adminOnly,
  (req, res) => {
    try {
      const db = readDatabase();

      archiveExpiredUpi(db);

      res.json({
        success: true,

        settings:
          db.settings,

        paymentMethods:
          db.paymentMethods,

        upiLinks:
          db.upiLinks.map(
            upi => ({
              ...upi,
              state:
                getUpiState(upi)
            })
          ),

        orders:
          db.orders
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to load admin data."
      });
    }
  }
);

// =====================================================
// UPDATE SETTINGS
// =====================================================

app.put(
  "/api/admin/settings",
  adminOnly,
  (req, res) => {
    try {
      const db = readDatabase();

      if (
        req.body.siteName !==
        undefined
      ) {
        db.settings.siteName =
          cleanString(
            req.body.siteName,
            100
          );
      }

      if (
        req.body.feePercent !==
        undefined
      ) {
        const fee =
          numberValue(
            req.body.feePercent
          );

        if (
          fee === null ||
          fee < 0 ||
          fee > 100
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid fee."
          });
        }

        db.settings.feePercent =
          fee;
      }

      if (
        req.body.minAmount !==
        undefined
      ) {
        const value =
          numberValue(
            req.body.minAmount
          );

        if (
          value === null ||
          value < 0
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid minimum amount."
          });
        }

        db.settings.minAmount =
          value;
      }

      if (
        req.body.maxAmount !==
        undefined
      ) {
        const value =
          numberValue(
            req.body.maxAmount
          );

        if (
          value === null ||
          value <= 0
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid maximum amount."
          });
        }

        db.settings.maxAmount =
          value;
      }

      if (
        db.settings.minAmount >
        db.settings.maxAmount
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Minimum amount cannot exceed maximum."
        });
      }

      if (req.body.contact) {
        db.settings.contact =
          {
            ...db.settings.contact,
            whatsapp:
              cleanString(
                req.body.contact.whatsapp,
                300
              ),
            telegram:
              cleanString(
                req.body.contact.telegram,
                300
              )
          };
      }

      writeDatabase(db);

      res.json({
        success: true,
        message:
          "Settings saved."
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to save settings."
      });
    }
  }
);

// =====================================================
// ADD PAYMENT METHOD
// =====================================================

app.post(
  "/api/admin/payment-methods",
  adminOnly,
  (req, res) => {
    try {
      const db = readDatabase();

      const name =
        cleanString(
          req.body.name,
          100
        );

      const description =
        cleanString(
          req.body.description,
          250
        );

      const flag =
        cleanString(
          req.body.flag,
          20
        );

      const rate =
        numberValue(
          req.body.rate
        );

      const logo =
        cleanString(
          req.body.logo,
          500000
        );

      if (!name) {
        return res.status(400).json({
          success: false,
          message:
            "Payment method name is required."
        });
      }

      if (
        rate === null ||
        rate <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Enter a valid exchange rate."
        });
      }

      if (
        logo &&
        !logo.startsWith(
          "data:image/"
        ) &&
        !/^https?:\/\//i.test(
          logo
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Logo must be an image upload or image URL."
        });
      }

      const method = {
        id: generateId("PM-"),

        name,

        description,

        flag: flag || "🌐",

        rate,

        logo: logo || "",

        enabled: true,

        archived: false,

        createdAt:
          new Date().toISOString(),

        updatedAt:
          new Date().toISOString()
      };

      db.paymentMethods.push(
        method
      );

      writeDatabase(db);

      res.status(201).json({
        success: true,
        message:
          "Payment method added.",
        method
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to add payment method."
      });
    }
  }
);

// =====================================================
// EDIT PAYMENT METHOD
// =====================================================

app.put(
  "/api/admin/payment-methods/:id",
  adminOnly,
  (req, res) => {
    try {
      const db = readDatabase();

      const method =
        db.paymentMethods.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!method) {
        return res.status(404).json({
          success: false,
          message:
            "Payment method not found."
        });
      }

      if (
        req.body.name !==
        undefined
      ) {
        method.name =
          cleanString(
            req.body.name,
            100
          );
      }

      if (
        req.body.description !==
        undefined
      ) {
        method.description =
          cleanString(
            req.body.description,
            250
          );
      }

      if (
        req.body.flag !==
        undefined
      ) {
        method.flag =
          cleanString(
            req.body.flag,
            20
          );
      }

      if (
        req.body.rate !==
        undefined
      ) {
        const rate =
          numberValue(
            req.body.rate
          );

        if (
          rate === null ||
          rate <= 0
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid rate."
          });
        }

        method.rate = rate;
      }

      if (
        req.body.logo !==
        undefined
      ) {
        method.logo =
          cleanString(
            req.body.logo,
            500000
          );
      }

      if (
        req.body.enabled !==
        undefined
      ) {
        method.enabled =
          Boolean(
            req.body.enabled
          );
      }

      method.updatedAt =
        new Date().toISOString();

      writeDatabase(db);

      res.json({
        success: true,
        message:
          "Payment method updated."
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to update payment method."
      });
    }
  }
);

// =====================================================
// REMOVE PAYMENT METHOD
// =====================================================

app.delete(
  "/api/admin/payment-methods/:id",
  adminOnly,
  (req, res) => {
    try {
      const db = readDatabase();

      const method =
        db.paymentMethods.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!method) {
        return res.status(404).json({
          success: false,
          message:
            "Payment method not found."
        });
      }

      method.archived = true;
      method.enabled = false;
      method.updatedAt =
        new Date().toISOString();

      writeDatabase(db);

      res.json({
        success: true,
        message:
          "Payment method removed."
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to remove payment method."
      });
    }
  }
);

// =====================================================
// ADD UPI
// =====================================================

app.post(
  "/api/admin/upi",
  adminOnly,
  (req, res) => {
    try {
      const db = readDatabase();

      const name =
        cleanString(
          req.body.name,
          100
        );

      const label =
        cleanString(
          req.body.label,
          150
        );

      const url =
        cleanString(
          req.body.url,
          1000
        );

      const startAt =
        req.body.startAt
          ? validDate(
              req.body.startAt
            )
          : null;

      const expiryAt =
        req.body.expiryAt
          ? validDate(
              req.body.expiryAt
            )
          : null;

      if (!name) {
        return res.status(400).json({
          success: false,
          message:
            "UPI name is required."
        });
      }

      if (!url) {
        return res.status(400).json({
          success: false,
          message:
            "UPI URL is required."
        });
      }

      try {
        const parsed =
          new URL(url);

        if (
          parsed.protocol !==
            "http:" &&
          parsed.protocol !==
            "https:"
        ) {
          throw new Error();
        }
      } catch {
        return res.status(400).json({
          success: false,
          message:
            "Invalid UPI URL."
        });
      }

      if (
        req.body.startAt &&
        !startAt
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid start time."
        });
      }

      if (
        req.body.expiryAt &&
        !expiryAt
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid expiry time."
        });
      }

      if (
        startAt &&
        expiryAt &&
        expiryAt <= startAt
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Expiry must be after start."
        });
      }

      const upi = {
        id: generateId("UPI-"),

        name,

        label,

        url,

        startAt:
          startAt
            ? startAt.toISOString()
            : null,

        expiryAt:
          expiryAt
            ? expiryAt.toISOString()
            : null,

        enabled: true,

        archived: false,

        createdAt:
          new Date().toISOString(),

        updatedAt:
          new Date().toISOString()
      };

      db.upiLinks.push(upi);

      writeDatabase(db);

      res.status(201).json({
        success: true,
        message:
          "UPI added successfully.",
        upi
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to add UPI."
      });
    }
  }
);

// =====================================================
// EDIT UPI
// =====================================================

app.put(
  "/api/admin/upi/:id",
  adminOnly,
  (req, res) => {
    try {
      const db = readDatabase();

      const upi =
        db.upiLinks.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!upi) {
        return res.status(404).json({
          success: false,
          message:
            "UPI not found."
        });
      }

      if (
        req.body.name !==
        undefined
      ) {
        upi.name =
          cleanString(
            req.body.name,
            100
          );
      }

      if (
        req.body.label !==
        undefined
      ) {
        upi.label =
          cleanString(
            req.body.label,
            150
          );
      }

      if (
        req.body.url !==
        undefined
      ) {
        const url =
          cleanString(
            req.body.url,
            1000
          );

        try {
          const parsed =
            new URL(url);

          if (
            parsed.protocol !==
              "http:" &&
            parsed.protocol !==
              "https:"
          ) {
            throw new Error();
          }
        } catch {
          return res.status(400).json({
            success: false,
            message:
              "Invalid URL."
          });
        }

        upi.url = url;
      }

      if (
        req.body.startAt !==
        undefined
      ) {
        if (!req.body.startAt) {
          upi.startAt = null;
        } else {
          const d =
            validDate(
              req.body.startAt
            );

          if (!d) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid start time."
            });
          }

          upi.startAt =
            d.toISOString();
        }
      }

      if (
        req.body.expiryAt !==
        undefined
      ) {
        if (!req.body.expiryAt) {
          upi.expiryAt = null;
        } else {
          const d =
            validDate(
              req.body.expiryAt
            );

          if (!d) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid expiry time."
            });
          }

          upi.expiryAt =
            d.toISOString();
        }
      }

      if (
        upi.startAt &&
        upi.expiryAt &&
        new Date(
          upi.expiryAt
        ) <=
          new Date(
            upi.startAt
          )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Expiry must be after start."
        });
      }

      if (
        req.body.enabled !==
        undefined
      ) {
        upi.enabled =
          Boolean(
            req.body.enabled
          );
      }

      upi.updatedAt =
        new Date().toISOString();

      writeDatabase(db);

      res.json({
        success: true,
        message:
          "UPI updated."
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to update UPI."
      });
    }
  }
);

// =====================================================
// ARCHIVE UPI
// =====================================================

app.delete(
  "/api/admin/upi/:id",
  adminOnly,
  (req, res) => {
    try {
      const db = readDatabase();

      const upi =
        db.upiLinks.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!upi) {
        return res.status(404).json({
          success: false,
          message:
            "UPI not found."
        });
      }

      upi.archived = true;
      upi.enabled = false;

      upi.updatedAt =
        new Date().toISOString();

      writeDatabase(db);

      res.json({
        success: true,
        message:
          "UPI archived."
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to archive UPI."
      });
    }
  }
);

// =====================================================
// ADMIN ORDER UPDATE
// =====================================================

app.put(
  "/api/admin/orders/:id",
  adminOnly,
  (req, res) => {
    try {
      const db = readDatabase();

      const order =
        db.orders.find(
          item =>
            item.id ===
            req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found."
        });
      }

      if (
        req.body.status !==
        undefined
      ) {
        const statuses = [
          "pending",
          "processing",
          "completed",
          "rejected"
        ];

        const status =
          cleanString(
            req.body.status,
            50
          ).toLowerCase();

        if (
          !statuses.includes(
            status
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid status."
          });
        }

        order.status =
          status;
      }

      if (
        req.body.adminNote !==
        undefined
      ) {
        order.adminNote =
          cleanString(
            req.body.adminNote,
            1000
          );
      }

      order.updatedAt =
        new Date().toISOString();

      writeDatabase(db);

      res.json({
        success: true,
        message:
          "Order updated."
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        message:
          "Unable to update order."
      });
    }
  }
);

// =====================================================
// STATIC FILES
// =====================================================

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

// =====================================================
// PAGES
// =====================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.get("/order", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "order.html"
    )
  );
});

app.get("/status", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "status.html"
    )
  );
});

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "admin.html"
    )
  );
});

// =====================================================
// API 404
// =====================================================

app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message:
      "API endpoint not found."
  });
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "Server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      success: false,
      message:
        "Something went wrong."
    });
  }
);

// =====================================================
// START
// =====================================================

ensureDatabase();

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "Quick Exchange running on port " +
        PORT
    );
  }
);
