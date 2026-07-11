import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Configuration for Firebase
// These public values are used by both this web dashboard and your ESP32 board.
export const firebaseConfig = {
  apiKey: "AIzaSyCLhGs_2WcPJzP4hwePmz9xeyxw2AMQrCY",
  authDomain: "ageless-mantra-nwrl4.firebaseapp.com",
  projectId: "ageless-mantra-nwrl4",
  storageBucket: "ageless-mantra-nwrl4.firebasestorage.app",
  messagingSenderId: "247081244267",
  appId: "1:247081244267:web:a895c120a202f22357032e"
};

const databaseId = "ai-studio-esp32pzem004tpow-b579b9b2-103a-4514-ba32-90bb3d2e9d82";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, databaseId);
export const firestoreDatabaseId = databaseId;
