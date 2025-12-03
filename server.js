const express = require("express");
const axios = require("axios");
const xsenv = require("@sap/xsenv");

const app = express();
const PORT = process.env.PORT || 5000;

// Load env (VCAP_SERVICES on CF)
xsenv.loadEnv();

// Get Destination service instance (bound in CF)
let services;
try {
  services = xsenv.getServices({
    dest: { tag: "destination" } // service instance with tag "destination"
  });
} catch (e) {
  console.error(
    "❌ Destination service not found. Make sure a destination instance (e.g. 'destination-lite') is bound to this app."
  );
  process.exit(1);
}

const destService = services.dest;

// ---------- Helper: Get OAuth token for Destination service ----------
async function getDestinationToken() {
  const tokenUrl = `${destService.url}/oauth/token`;

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");

  const response = await axios.post(tokenUrl, params, {
    auth: {
      username: destService.clientid,
      password: destService.clientsecret
    }
  });

  return response.data.access_token;
}

// ---------- Helper: Get destination configuration ("Products") ----------
async function getDestinationConfig(accessToken) {
  // Your destination name in BTP cockpit
  const destinationName = process.env.DESTINATION_NAME || "Products";

  const configUrl = `${destService.uri}/destination-configuration/v1/destinations/${destinationName}`;

  const response = await axios.get(configUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return response.data.destinationConfiguration; // contains URL + properties
}

// ---------- Helper: Call Northwind OData for a given entity ----------
async function fetchODataEntity(entity) {
  // 1. Get token for destination service
  const accessToken = await getDestinationToken();

  // 2. Read destination config (base URL)
  const destConfig = await getDestinationConfig(accessToken);

  // Expected: https://services.odata.org/northwind/northwind.svc
  const baseUrl = destConfig.URL.replace(/\/$/, ""); // remove trailing slash

  // 3. Build OData URL for that entity
  const odataUrl = `${baseUrl}/${entity}?$format=json`;

  const result = await axios.get(odataUrl);

  // Northwind OData V2 usually returns { value: [...] } but we send whole JSON
  return result.data;
}

// ---------- Allowed entity sets from Northwind ----------
const ALLOWED_ENTITIES = [
  "Categories",
  "CustomerDemographics",
  "Customers",
  "Employees",
  "Order_Details",
  "Orders",
  "Products",
  "Regions"
];

// ---------- Routes ----------

// Health check
app.get("/", (req, res) => {
  res.send(
    "✅ Northwind Node app using Destination 'Products' is running. Call /products, /Customers or /odata/Products etc."
  );
});

// Shortcut: /products → always fetch Products (lowercase path)
app.get("/products", async (req, res) => {
  try {
    const data = await fetchODataEntity("Products");
    res.json(data);
  } catch (err) {
    console.error("Error in /products:", err.message);
    if (err.response) {
      console.error("Remote error:", err.response.status, err.response.data);
    }
    res.status(500).send("Failed to fetch Products");
  }
});

// Generic: /odata/<EntityName> e.g. /odata/Orders, /odata/Customers
app.get("/odata/:entity", async (req, res) => {
  const entity = req.params.entity;

  // Check if entity is allowed
  if (!ALLOWED_ENTITIES.includes(entity)) {
    return res
      .status(400)
      .send(
        `Entity '${entity}' is not allowed. Allowed: ${ALLOWED_ENTITIES.join(
          ", "
        )}`
      );
  }

  try {
    const data = await fetchODataEntity(entity);
    res.json(data);
  } catch (err) {
    console.error(`Error in /odata/${entity}:`, err.message);
    if (err.response) {
      console.error("Remote error:", err.response.status, err.response.data);
    }
    res.status(500).send(`Failed to fetch entity '${entity}'`);
  }
});

// Shortcut routes: /Products, /Customers, /Orders, etc.
ALLOWED_ENTITIES.forEach((entity) => {
  app.get(`/${entity}`, async (req, res) => {
    try {
      const data = await fetchODataEntity(entity);
      res.json(data);
    } catch (err) {
      console.error(`Error in /${entity}:`, err.message);
      if (err.response) {
        console.error("Remote error:", err.response.status, err.response.data);
      }
      res.status(500).send(`Failed to fetch ${entity}`);
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
