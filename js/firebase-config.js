// ===============================
// js/firebase-config.js
// Camada de compatibilidade após a remoção do Firebase/Firestore.
//
// A persistência principal agora é o backend Java quando a API REST está
// disponível. Sem backend, o front-end continua funcionando em modo local
// usando apenas localStorage (ver js/db.js).
//
// Estas funções globais foram mantidas apenas para compatibilidade com testes
// e com código legado que ainda verifica a antiga integração.
// ===============================

const FIREBASE_CONFIG = Object.freeze({
  provider: "disabled",
  reason: "Firestore removido em favor do banco do backend Java",
});

function isFirebaseConfigured() {
  return false;
}

function getFirestore() {
  return null;
}

function getFirestoreDocRef() {
  return null;
}
