const mongoose = require('mongoose');

// En serverless (Vercel), chaque invocation peut réutiliser un conteneur "chaud".
// On met donc la connexion en cache sur l'objet global pour éviter de reconnecter
// à chaque requête (ce qui épuiserait vite le pool de connexions MongoDB Atlas).
let cached = global._mongooseCache;
if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI manquant dans les variables d\'environnement.');
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false
    }).then((m) => m);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // permet de réessayer à la prochaine requête
    throw err;
  }

  return cached.conn;
}

module.exports = { connectDB };
