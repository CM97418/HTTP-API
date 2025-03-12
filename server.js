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

// 4) Configuration MQTT (optionnel, si tu veux toujours publier des alertes)
const brokerUrl = "mqtts://ded8d24a57f247ba9836a456fc42d9d3.s1.eu.hivemq.cloud";
const mqttUser = "azerty";
const mqttPass = "Trailapp18";

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

/**********************************************
 * A) Endpoint /createUserAndParticipant
 *    Permet de créer/mettre à jour l'utilisateur (users)
 *    ET le participant (participants) en une requête
 *    Reçoit:
 *    {
 *      email, firstname, lastname, role,
 *      bibNumber, courseId, deviceId, status
 *    }
 **********************************************/
app.post("/createUserAndParticipant", async (req, res) => {
  try {
    const {
      email,
      firstname,
      lastname,
      role,
      bibNumber,
      courseId,
      deviceId,
      status
    } = req.body;

    if (!email || !bibNumber || !courseId || !deviceId || !status) {
      return res.status(400).send("Missing fields: email, bibNumber, courseId, deviceId, status");
    }

    // 1) Chercher l'utilisateur par email
    const usersRef = db.collection("users");
    const querySnap = await usersRef.where("email", "==", email).get();
    let userDocId;

    if (!querySnap.empty) {
      // L'utilisateur existe déjà
      userDocId = querySnap.docs[0].id;
      console.log("User found with id:", userDocId);
    } else {
      // 2) Créer le doc user
      const newUserRef = await usersRef.add({
        email,
        firstname: firstname || "",
        lastname: lastname || "",
        role: role || "coureur",
        createdAt: new Date().toISOString()
      });
      userDocId = newUserRef.id;
      console.log("New user created with id:", userDocId);
    }

    // 3) Créer/Mettre à jour le doc participant participants/{bibNumber}
    await db.collection("participants").doc(String(bibNumber)).set({
      userId: userDocId,
      bibNumber,
      courseId,
      deviceId,
      status,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Si status == "abandon", on publie un message MQTT
    if (status === "abandon") {
      client.publish("trail/alerts", JSON.stringify({
        userId: userDocId,
        bibNumber,
        courseId,
        deviceId,
        status,
        timestamp: Date.now()
      }));
    }

    res.send("User and participant created/updated successfully");
  } catch (err) {
    console.error("Erreur /createUserAndParticipant:", err);
    res.status(500).send("Erreur serveur");
  }
});

/**********************************************
 * B) Endpoint /updateParticipant
 *    Reçoit { userId, bibNumber, courseId, deviceId, name, status }
 **********************************************/
app.post("/updateParticipant", async (req, res) => {
  try {
    const { userId, bibNumber, courseId, deviceId, name, status } = req.body;
    if (!userId || !bibNumber || !courseId || !deviceId || !name || !status) {
      return res.status(400).send("Missing fields: userId, bibNumber, courseId, deviceId, name, status");
    }

    await db.collection("participants").doc(String(bibNumber)).set({
      userId,
      bibNumber,
      courseId,
      deviceId,
      name,
      status,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    if (status === "abandon") {
      client.publish("trail/alerts", JSON.stringify({
        userId,
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
 * C) Endpoint /addPosition
 *    Reçoit { bibNumber, latitude, longitude, timestamp }
 **********************************************/
app.post("/addPosition", async (req, res) => {
  try {
    const { bibNumber, latitude, longitude, timestamp } = req.body;
    if (!bibNumber || latitude === undefined || longitude === undefined) {
      return res.status(400).send("Missing fields: bibNumber, latitude, longitude");
    }

    await db.collection("participants").doc(String(bibNumber))
      .collection("positions")
      .add({
        latitude,
        longitude,
        timestamp: timestamp || new Date().toISOString()
      });

    res.send("Position ajoutée dans la sous-collection positions.");
  } catch (err) {
    console.error("Erreur dans /addPosition:", err);
    res.status(500).send("Erreur serveur");
  }
});

/**********************************************
 * D) Endpoint /addCheckpoint
 *    Reçoit { bibNumber, validated, timestamp }
 **********************************************/
app.post("/addCheckpoint", async (req, res) => {
  try {
    const { bibNumber, validated, timestamp } = req.body;
    if (!bibNumber) {
      return res.status(400).send("Missing field: bibNumber");
    }

    await db.collection("participants").doc(String(bibNumber))
      .collection("checkpoints")
      .add({
        validated: validated ?? true,
        timestamp: timestamp || new Date().toISOString()
      });

    res.send("Checkpoint ajouté dans la sous-collection checkpoints.");
  } catch (err) {
    console.error("Erreur dans /addCheckpoint:", err);
    res.status(500).send("Erreur serveur");
  }
});

/**********************************************
 * E) Endpoint /listUsers
 *    Récupère tous les docs users,
 *    pour chacun, on récupère participants
 **********************************************/
app.get("/listUsers", async (req, res) => {
  try {
    const usersSnap = await db.collection("users").get();
    const usersArray = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;

      // Récupérer les participants liés à userId
      const partsSnap = await db.collection("participants")
        .where("userId", "==", userId)
        .get();
      const partList = partsSnap.docs.map(d => d.data());

      usersArray.push({
        userId,
        ...userData,
        participants: partList
      });
    }

    res.json(usersArray);
  } catch (err) {
    console.error("Erreur /listUsers:", err);
    res.status(500).send("Erreur serveur");
  }
});

// 9) Écouter sur le port défini par Render
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Serveur écoute sur le port " + port);
});
