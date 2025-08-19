// functions/index.js
const {onRequest} = require("firebase-functions/v2/https");
const {onValueCreated} = require("firebase-functions/v2/database");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Shuffles an array in place using Fisher–Yates algorithm.
 *
 * @param {any[]} arr - The array to shuffle.
 * @return {any[]} The shuffled array (same reference as input).
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * ✅ Matchmaking (Realtime Database trigger)
 * When a user joins the lobby, tries to pair them with another waiting user.
 */
exports.matchmake = onValueCreated("/lobby/{uid}", async (event) => {
  const newUid = event.params.uid;
  const db = admin.database();

  const lobbySnap = await db.ref("lobby").get();
  const lobby = lobbySnap.val();

  if (!lobby) return;

  // Find another user in the lobby
  const opponentId = Object.keys(lobby).find((uid) => uid !== newUid);
  if (!opponentId) return;

  // Create new game
  const gameId = db.ref("games").push().key;
  const pool = shuffleArray(Array.from({length: 81}, (_, i) => i));
  const gameData = {
    numbersPool: pool,
    players: {
      [newUid]: {status: "waiting"},
      [opponentId]: {status: "waiting"},
    },
    state: "active",
    createdAt: Date.now(),
  };

  await db.ref(`games/${gameId}`).set(gameData);

  // Update user's current game
  await db.ref(`userCurrentGame/${newUid}`).set({gameId});
  await db.ref(`userCurrentGame/${opponentId}`).set({gameId});

  // Remove both users from the lobby
  await db.ref(`lobby/${newUid}`).remove();
  await db.ref(`lobby/${opponentId}`).remove();

  console.log(`Game ${gameId} created between ${newUid} and ${opponentId}`);
});

/**
 * ✅ Generate Number (HTTP endpoint)
 * Called from frontend when a player clicks "Generate Number".
 */
exports.generateNumber = onRequest(async (req, res) => {
  // CORS headers
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle preflight OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  // Check auth header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send("Unauthorized: Missing or invalid token");
  }

  try {
    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Find the game this user is in
    const gamesSnap = await admin.database().ref("games").once("value");
    let currentGameId = null;
    gamesSnap.forEach((gameSnap) => {
      const game = gameSnap.val();
      if (game.players && game.players[uid]) {
        currentGameId = gameSnap.key;
      }
    });

    if (!currentGameId) {
      return res.status(400).send("User is not in a game");
    }

    const gameRef = admin.database().ref(`games/${currentGameId}`);

    // --- 🔹 Pick the next number from numbersPool ---
    const poolSnap = await gameRef.child("numbersPool").once("value");
    const pool = poolSnap.val();

    if (!pool || pool.length === 0) {
      return res.status(400).send("No numbers left in the pool");
    }

    // Take first number from pool
    const number = pool[0];

    // Remove it from pool
    await gameRef.child("numbersPool").set(pool.slice(1));

    // Append number to user's numbers list
    await gameRef
        .child(`players/${uid}/numbers`)
        .push({
          number,
          createdAt: admin.database.ServerValue.TIMESTAMP,
        });

    console.log(`User ${uid} in game ${currentGameId} got number: ${number}`);

    return res.status(200).json({success: true, number, gameId: currentGameId});
  } catch (err) {
    console.error("Error generating number:", err);
    return res.status(500).send("Internal Server Error");
  }
});

