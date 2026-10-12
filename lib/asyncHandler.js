// Express 4 ne capture pas les erreurs des handlers async : une promesse rejetée
// (ex. identifiant MongoDB invalide → CastError) laissait la requête pendre sans réponse.
// Ce wrapper transmet l'erreur au gestionnaire d'erreurs global défini dans server.js.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
