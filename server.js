/*****************
 * server.js
 *****************/
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const mqtt = require("mqtt");

// 1) Charger la clé de service Firebase depuis la variable d'environnement
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

// 2) Initialiser firebase-admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// 3) Accéder à Firestore
const db = admin.firestore();

// 4) Configuration MQTT (HiveMQ, etc.)
const brokerUrl = "mqtts://ded8d24a57f247ba9836a456fc42d9d3.s1.eu.hivemq.cloud"; // Ex. HiveMQ
const mqttUser = "azerty"; // identifiant
const mqttPass = "Trailapp18"; // mot de passe
// Connecter le client MQTT
const client = mqtt.connect(brokerUrl, {
  username: mqttUser,
  password: mqttPass,
});
client.on("connect", () => {
  console.log("Connecté au broker MQTT");
});

// 5) Créer l'app Express
const app = express();
app.use(cors());
app.use(express.json());

// (Optionnel) Route de test GET
app.get("/", (req, res) => {
  res.send("Hello from Render!");
});

// 6) Endpoint /updateRunner : reçoit { name, bib, latitude, longitude, alert }
app.post("/updateRunner", async (req, res) => {
  try {
    const { name, bib, latitude, longitude, alert } = req.body;

    // Validation basique
    if (!name || !bib || latitude === undefined || longitude === undefined) {
      return res.status(400).send("Missing fields: name, bib, latitude, longitude");
    }

    // 6.1 Écrire/mettre à jour Firestore - doc coureurs/<dossard>
    await db.collection("coureurs").doc(String(bib)).set({
      name,
      bib,
      latitude,
      longitude,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    // 6.2 Si alert == true, publier un message sur MQTT
    if (alert) {
      client.publish("trail/alerts", JSON.stringify({
        bib,
        name,
        latitude,
        longitude,
        timestamp: Date.now()
      }));
      console.log("Alerte publiée sur le topic 'trail/alerts'");
    }

    res.send("OK");
  } catch (err) {
    console.error("Erreur dans /updateRunner:", err);
    res.status(500).send("Erreur serveur");
  }
});

// 7) Écouter sur le port défini par Render
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Serveur écoute sur le port " + port);
});
