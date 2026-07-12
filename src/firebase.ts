import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Configuration for Firebase
// These values are loaded securely via Vite environment variables
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID;

if (!firebaseConfig.apiKey) {
  console.warn("⚠️ Firebase API Key is missing! Please configure VITE_FIREBASE_API_KEY in your .env file.");
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, databaseId);
export const firestoreDatabaseId = databaseId;
