// functions/index.js
const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

// HTTP function — can be called from browser via fetch()
exports.assignRandomNumber = onRequest(async (req, res) => {
  // Handle preflight request for CORS
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).send("");
    return;
  }

  // Allow CORS
  res.set("Access-Control-Allow-Origin", "*");

  // Check auth token from Firebase client
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send("Unauthorized: Missing or invalid token");
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    // Verify the token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Generate a random number (0–99)
    const number = Math.floor(Math.random() * 100);

    console.log(`User ${uid} assigned number: ${number}`);

    // Append to the player's numbers list in Realtime Database
    await admin
        .database()
        .ref(`games/default/${uid}/numbers`)
        .push({
          number,
          createdAt: admin.database.ServerValue.TIMESTAMP,
        });
    // Send response
    res.status(200).send({success: true, number});
  } catch (err) {
    console.error("Token verification error:", err);
    res.status(401).send("Unauthorized");
  }
});
