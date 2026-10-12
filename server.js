require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const { connectDB } = require('./lib/dbConnect');
const authRoutes = require('./routes/auth');
const questionnaireRoutes = require('./routes/questionnaires');
const ficheRoutes = require('./routes/fiches');

const app = express();

app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

// CORS : utile seulement si le front est servi depuis un autre domaine que l'API.
if (process.env.CLIENT_ORIGIN) {
  app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
}

// S'assure que MongoDB est connecté avant de traiter chaque requête API
// (connexion mise en cache, voir lib/dbConnect.js — nécessaire en serverless).
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Erreur de connexion MongoDB:', err.message);
    res.status(500).json({ error: 'Connexion à la base de données indisponible.' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/questionnaires', questionnaireRoutes);
app.use('/api', ficheRoutes); // expose /api/questionnaires/:qid/fiches et /api/fiches/:id

app.get('/health', (req, res) => res.json({ ok: true }));

// Sert le frontend (public/index.html) — utile en local ; sur Vercel c'est
// géré directement par le hosting statique (voir vercel.json).
app.use(express.static(path.join(__dirname, 'public')));

// En local (node server.js), on connecte et on écoute normalement.
// Sur Vercel, ce fichier est importé par api/index.js sans jamais appeler listen().
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  connectDB()
    .then(() => {
      console.log('[OK] Connecté à MongoDB');
      app.listen(PORT, () => console.log(`[OK] Serveur démarré sur http://localhost:${PORT}`));
    })
    .catch((err) => {
      console.error('[ERREUR] Connexion MongoDB:', err.message);
      process.exit(1);
    });
}

module.exports = app;
