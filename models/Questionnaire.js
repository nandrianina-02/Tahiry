const mongoose = require('mongoose');

// Une option de réponse (pour les questions type "sel" ou "multi")
const OptionSchema = new mongoose.Schema({
  v:  { type: String, required: true },   // valeur stockée
  fr: { type: String, required: true },   // libellé en français
  mg: { type: String, default: '' }       // libellé en malagasy (optionnel)
}, { _id: false });

// Condition d'affichage : la question ne s'affiche que si une question précédente
// (identifiée par son "field") a une valeur qui satisfait l'opérateur donné.
const ShowIfSchema = new mongoose.Schema({
  field: { type: String, default: '' },   // field de la question dont on dépend
  op:    { type: String, enum: ['eq', 'neq', 'contains'], default: 'eq' },
  value: { type: String, default: '' }
}, { _id: false });

// Une question du questionnaire
const QuestionSchema = new mongoose.Schema({
  id:    { type: String, required: true },  // identifiant stable côté client (uuid court)
  field: { type: String, required: true },  // nom de la clé dans les réponses (fiche.data[field])
  block: { type: String, default: '' },     // regroupement / section affichée (ex: "A", "Section F")
  fr:    { type: String, required: true },  // intitulé de la question en français
  mg:    { type: String, default: '' },     // intitulé en malagasy (optionnel)
  type: {
    type: String,
    enum: ['sel', 'multi', 'txt', 'textarea', 'date', 'num', 'consent', 'scale', 'geo', 'photo'],
    required: true
  },
  options:  { type: [OptionSchema], default: [] }, // pour 'sel' et 'multi'
  autre:    { type: Boolean, default: false },     // ajoute un champ libre "Autre..." (pour multi)
  required: { type: Boolean, default: false },     // question obligatoire
  order:    { type: Number, default: 0 },
  scaleMin: { type: Number, default: 1 },          // pour le type 'scale'
  scaleMax: { type: Number, default: 5 },          // pour le type 'scale'
  showIf:   { type: ShowIfSchema, default: null }  // logique conditionnelle (facultative)
}, { _id: false });

const QuestionnaireSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  questions:   { type: [QuestionSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Questionnaire', QuestionnaireSchema);

