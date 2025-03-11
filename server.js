const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const mqtt = require("mqtt");

// init admin if not done
admin.initializeApp({
  // ou un service account si besoin
});

const db = admin.firestore();

// MQTT connect (HiveMQ, etc.)
const client = mqtt.connect("mqtts://tonbroker:8883", {
  username: "tonUser",
  password: "tonPass"
});

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint test
app.get("/", (req, res) => {
  res.send("Hello from Render!");
});

// Endpoint updateRunner
app.post("/updateRunner", async (req, res) => {
  try {
    const { name, bib, latitude, longitude, alert } = req.body;
    // validations ...
    // ecrire dans Firestore
    await db.collection("coureurs").doc(String(bib)).set({
      name,
      bib,
      latitude,
      longitude,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Publier MQTT si alert === true
    if (alert) {
      client.publish("trail/alerts", JSON.stringify({
        bib, name, latitude, longitude, timestamp: Date.now()
      }));
    }

    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

// Ecoute sur PORT
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Serveur écoute sur le port ${port}`);
});
