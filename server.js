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
const brokerUrl = "mqtts://ded8d24a57f247ba9836a456fc42d9d3.s1.eu.hivemq.cloud"; // Ton broker
const mqttUser = "azerty";   // Identifiant
const mqttPass = "Trailapp18"; // Mot de passe
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

// Route de test GET (optionnel)
app.get("/", (req, res) => {
  res.send("Hello from Render!");
});

/**********************************************
 * 6) Endpoint /updateParticipant
 *    Reçoit { bibNumber, courseId, deviceId, name, status }
 *    => Collection participants/{bibNumber}
 **********************************************/
app.post("/updateParticipant", async (req, res) => {
  try {
    const { bibNumber, courseId, deviceId, name, status } = req.body;
    if (!bibNumber || !courseId || !deviceId || !name || !status) {
      return res.status(400).send("Missing fields: bibNumber, courseId, deviceId, name, status");
    }

    // participants/{bibNumber}
    await db.collection("participants").doc(String(bibNumber)).set({
      bibNumber,
      courseId,
      deviceId,
      name,
      status,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    // Exemple : si status == "abandon", on publie un message MQTT
    if (status === "abandon") {
      client.publish("trail/alerts", JSON.stringify({
        bibNumber,
        courseId,
        deviceId,
        name,
        status,
        timestamp: Date.now()
      }));
      console.log("Alerte MQTT: abandon détecté");
    }

    res.send("Participant mis à jour avec succès.");
  } catch (err) {
    console.error("Erreur dans /updateParticipant:", err);
    res.status(500).send("Erreur serveur");
  }
});

/**********************************************
 * 7) Endpoint /addPosition
 *    Reçoit { bibNumber, latitude, longitude, timestamp }
 *    => Sous-collection participants/{bibNumber}/positions
 **********************************************/
app.post("/addPosition", async (req, res) => {
  try {
    const { bibNumber, latitude, longitude, timestamp } = req.body;
    if (!bibNumber || latitude === undefined || longitude === undefined) {
      return res.status(400).send("Missing fields: bibNumber, latitude, longitude");
    }

    // participants/{bibNumber}/positions/(autoId)
    const docRef = db.collection("participants").doc(String(bibNumber))
                     .collection("positions");
    await docRef.add({
      latitude,
      longitude,
      timestamp: timestamp || new Date().toISOString(),
    });

    res.send("Position ajoutée dans la sous-collection positions.");
  } catch (err) {
    console.error("Erreur dans /addPosition:", err);
    res.status(500).send("Erreur serveur");
  }
});

/**********************************************
 * 8) Endpoint /addCheckpoint
 *    Reçoit { bibNumber, validated, timestamp }
 *    => Sous-collection participants/{bibNumber}/checkpoints
 **********************************************/
app.post("/addCheckpoint", async (req, res) => {
  try {
    const { bibNumber, validated, timestamp } = req.body;
    if (!bibNumber) {
      return res.status(400).send("Missing field: bibNumber");
    }

    // participants/{bibNumber}/checkpoints/(autoId)
    const docRef = db.collection("participants").doc(String(bibNumber))
                     .collection("checkpoints");
    await docRef.add({
      validated: validated ?? true, // si non défini, on met true par défaut
      timestamp: timestamp || new Date().toISOString(),
    });

    res.send("Checkpoint ajouté dans la sous-collection checkpoints.");
  } catch (err) {
    console.error("Erreur dans /addCheckpoint:", err);
    res.status(500).send("Erreur serveur");
  }
});

// 9) Écouter sur le port défini par Render
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Serveur écoute sur le port " + port);
});
