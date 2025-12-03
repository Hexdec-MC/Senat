// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAfg_vr12a1MDv8cUMluEX5f1xkc9GCqFw",
  authDomain: "quispejean.firebaseapp.com",
  projectId: "quispejean",
  storageBucket: "quispejean.firebasestorage.app",
  messagingSenderId: "486753609684",
  appId: "1:486753609684:web:8d679ffdec6fecd1c25841"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);