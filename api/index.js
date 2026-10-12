// Vercel exécute ce fichier comme fonction serverless pour toute requête /api/*.
// On y importe simplement l'app Express (server.js) sans jamais appeler app.listen().
module.exports = require('../server');
