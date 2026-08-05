// ===============================
// js/firebase-config.js
// Configuração e inicialização do Firebase (Firestore), usado por js/db.js
// como banco de dados primário — com localStorage como fallback/cache
// offline (ver js/db.js).
//
// COMO CONFIGURAR: siga o passo a passo no README.md ("Conectando ao
// Firebase") e substitua os valores abaixo pelas credenciais do SEU
// projeto Firebase (Configurações do projeto > Geral > "Seus apps" > SDK
// do Firebase > Config).
//
// Se você deixar os valores de exemplo (começando com "SUA_"/"SEU_"),
// o app detecta automaticamente que o Firebase não está configurado e
// funciona 100% com localStorage, exatamente como antes — nada quebra.
// ===============================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDmqsKcwZUzV1FxJaamRLVmqOjKUD8VOv4",
  authDomain: "fintech-spacecworp.firebaseapp.com",
  projectId: "fintech-spacecworp",
  storageBucket: "fintech-spacecworp.firebasestorage.app",
  messagingSenderId: "233270525145",
  appId: "1:233270525145:web:e23ea3132a95f4daffd2c8",
};

// Todo o "banco" (tenants, users, categories, expenses, budgets, payments,
// _seq) é salvo como um único documento no Firestore — mesmo formato do
// db.json/localStorage. Simples e suficiente para o volume de dados de
// um app pessoal/demo como este.
const FIRESTORE_COLLECTION = "fintech_saas";
const FIRESTORE_DOC_ID = "db_v1";

function isFirebaseConfigured() {
  return (
    typeof FIREBASE_CONFIG === "object" &&
    !!FIREBASE_CONFIG.apiKey &&
    !!FIREBASE_CONFIG.projectId &&
    !FIREBASE_CONFIG.apiKey.startsWith("SUA_") &&
    !FIREBASE_CONFIG.projectId.startsWith("SEU_")
  );
}

let _firebaseApp = null;
let _firestoreDb = null;
let _firebaseInitFailed = false;

// Retorna a instância do Firestore (ou null se o Firebase não estiver
// configurado, o SDK não tiver carregado, ou a inicialização falhar).
// Nunca lança exceção — quem chama trata null como "sem Firebase agora,
// use o fallback local".
function getFirestore() {
  if (!isFirebaseConfigured()) return null;
  if (_firestoreDb) return _firestoreDb;
  if (_firebaseInitFailed) return null;

  try {
    if (typeof firebase === "undefined" || !firebase.initializeApp) {
      // SDK do Firebase (compat) não foi carregado na página.
      return null;
    }
    _firebaseApp = firebase.apps && firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(FIREBASE_CONFIG);
    _firestoreDb = firebase.firestore();

    // Cache/persistência offline nativa do próprio Firestore, além do
    // nosso fallback manual em localStorage (camadas complementares).
    if (_firestoreDb.enablePersistence) {
      _firestoreDb.enablePersistence({ synchronizeTabs: true }).catch(() => {
        // Falha comum em várias abas sem synchronizeTabs, navegadores sem
        // suporte, ou modo privado — não é crítico, seguimos sem cache
        // offline nativo do Firestore (o fallback em localStorage cobre).
      });
    }

    return _firestoreDb;
  } catch (e) {
    console.warn("Fintech Spacecworp: falha ao inicializar o Firebase; usando apenas localStorage.", e);
    _firebaseInitFailed = true;
    return null;
  }
}

function getFirestoreDocRef() {
  const db = getFirestore();
  if (!db) return null;
  return db.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC_ID);
}
