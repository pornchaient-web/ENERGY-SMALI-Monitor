import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Configuration for Firebase
// These values are loaded via Vite environment variables with safe defaults for static deployment (e.g. GitHub Pages)
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCLhGs_2WcPJzP4hwePmz9xeyxw2AMQrCY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ageless-mantra-nwrl4.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "ageless-mantra-nwrl4",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ageless-mantra-nwrl4.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "247081244267",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:247081244267:web:a895c120a202f22357032e"
};

const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || "ai-studio-esp32pzem004tpow-b579b9b2-103a-4514-ba32-90bb3d2e9d82";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, databaseId);
export const firestoreDatabaseId = databaseId;
