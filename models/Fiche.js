const mongoose = require('mongoose');

const FicheSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  questionnaire: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Questionnaire',
    required: true,
    index: true
  },
  refId: { type: String, required: true }, // identifiant lisible ex: MIT-XXXXX
  data:  { type: mongoose.Schema.Types.Mixed, default: {} }, // { field: valeur, ... }
  // Identifiant généré côté client au moment de l'entretien (avant même l'envoi au serveur).
  // Permet de synchroniser sans créer de doublon si une fiche créée hors-ligne est renvoyée deux fois.
  // Pas de valeur par défaut null : l'index sparse n'ignore que les documents où le champ est ABSENT.
  clientId: { type: String, sparse: true, unique: true }
}, { timestamps: true });

module.exports = mongoose.model('Fiche', FicheSchema);

